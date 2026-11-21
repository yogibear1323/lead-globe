#!/usr/bin/env python3
"""Extract category-matching business POIs from an OSM PBF into a compact region JSON.

Uses a streaming PBF reader (stdlib + zlib) because pyosmium/osmium-tool could not
be installed in this environment (apt repo errors; PyPI returned no distributions).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

# Protobuf wire types
WT_VARINT = 0
WT_64 = 1
WT_LEN = 2
WT_32 = 5


def read_varint(buf: memoryview, i: int) -> Tuple[int, int]:
    shift = 0
    n = 0
    length = len(buf)
    while i < length:
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if b < 0x80:
            return n, i
        shift += 7
        if shift > 70:
            raise ValueError("varint too long")
    raise ValueError("truncated varint")


def read_svarint(buf: memoryview, i: int) -> Tuple[int, int]:
    n, i = read_varint(buf, i)
    return (n >> 1) ^ -(n & 1), i


def decode_fields(data: bytes | memoryview):
    buf = memoryview(data)
    i = 0
    n = len(buf)
    while i < n:
        key, i = read_varint(buf, i)
        field, wt = key >> 3, key & 7
        if wt == WT_VARINT:
            val, i = read_varint(buf, i)
            yield field, wt, val
        elif wt == WT_LEN:
            ln, i = read_varint(buf, i)
            yield field, wt, buf[i : i + ln].tobytes()
            i += ln
        elif wt == WT_32:
            yield field, wt, buf[i : i + 4].tobytes()
            i += 4
        elif wt == WT_64:
            yield field, wt, buf[i : i + 8].tobytes()
            i += 8
        else:
            raise ValueError(f"unknown wire type {wt} at {i}")


def packed_varints(data: bytes) -> List[int]:
    buf = memoryview(data)
    i = 0
    out = []
    n = len(buf)
    while i < n:
        v, i = read_varint(buf, i)
        out.append(v)
    return out


def packed_svarints(data: bytes) -> List[int]:
    buf = memoryview(data)
    i = 0
    out = []
    n = len(buf)
    while i < n:
        v, i = read_svarint(buf, i)
        out.append(v)
    return out


def zig64(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


class PbfReader:
    def __init__(self, path: Path):
        self.path = path

    def iter_blocks(self):
        with self.path.open("rb") as f:
            while True:
                raw = f.read(4)
                if not raw:
                    return
                if len(raw) < 4:
                    return
                header_size = int.from_bytes(raw, "big")
                if header_size <= 0 or header_size > 64 * 1024:
                    raise ValueError(f"implausible BlobHeader size {header_size}")
                header = f.read(header_size)
                typ = None
                datasize = None
                for field, wt, val in decode_fields(header):
                    if field == 1 and wt == WT_LEN:
                        typ = val.decode("utf-8")
                    elif field == 3 and wt == WT_VARINT:
                        datasize = val
                if not typ or datasize is None:
                    raise ValueError("invalid BlobHeader")
                blob = f.read(datasize)
                if len(blob) < datasize:
                    raise ValueError("truncated Blob")
                raw_data = None
                zlib_data = None
                lzma_data = None
                for field, wt, val in decode_fields(blob):
                    if field == 1 and wt == WT_LEN:
                        raw_data = val
                    elif field == 3 and wt == WT_LEN:
                        zlib_data = val
                    elif field == 4 and wt == WT_LEN:
                        lzma_data = val
                if zlib_data is not None:
                    payload = zlib.decompress(zlib_data)
                elif raw_data is not None:
                    payload = raw_data
                elif lzma_data is not None:
                    import lzma

                    payload = lzma.decompress(lzma_data)
                else:
                    raise ValueError("Blob has no payload")
                yield typ, payload


def parse_stringtable(data: bytes) -> List[bytes]:
    table = []
    for field, wt, val in decode_fields(data):
        if field == 1 and wt == WT_LEN:
            table.append(val)
    return table


def decode_str(table: List[bytes], idx: int) -> str:
    if idx < 0 or idx >= len(table):
        return ""
    try:
        return table[idx].decode("utf-8")
    except UnicodeDecodeError:
        return table[idx].decode("utf-8", "replace")


def parse_dense_nodes(data: bytes, table: List[bytes], gran: int, lat_off: int, lon_off: int, wanted, out_nodes, needed: Optional[Set[int]]):
    ids = lats = lons = keys_vals = None
    for field, wt, val in decode_fields(data):
        if field == 1 and wt == WT_LEN:
            ids = packed_svarints(val)
        elif field == 8 and wt == WT_LEN:
            lats = packed_svarints(val)
        elif field == 9 and wt == WT_LEN:
            lons = packed_svarints(val)
        elif field == 10 and wt == WT_LEN:
            keys_vals = packed_varints(val)
        # skip denseinfo (2)
    if not ids or lats is None or lons is None:
        return
    # keys_vals may be missing if no tags at all
    kv = keys_vals or []
    ki = 0
    nid = lat = lon = 0
    n = len(ids)
    for i in range(n):
        nid += ids[i]
        lat += lats[i]
        lon += lons[i]
        tags = {}
        if kv:
            while ki < len(kv) and kv[ki] != 0:
                k = kv[ki]
                v = kv[ki + 1] if ki + 1 < len(kv) else 0
                ki += 2
                tags[decode_str(table, k)] = decode_str(table, v)
            if ki < len(kv) and kv[ki] == 0:
                ki += 1
        lat_deg = (lat_off + gran * lat) / 1e9
        lon_deg = (lon_off + gran * lon) / 1e9
        if needed is not None and nid in needed:
            out_nodes[nid] = (lat_deg, lon_deg)
        if tags and wanted(tags):
            out_nodes.setdefault("__poi_nodes__", []).append((nid, lat_deg, lon_deg, tags))


def parse_way(data: bytes, table: List[bytes]):
    wid = None
    keys = []
    vals = []
    refs = []
    for field, wt, val in decode_fields(data):
        if field == 1 and wt == WT_VARINT:
            wid = val
        elif field == 2 and wt == WT_LEN:
            keys = packed_varints(val)
        elif field == 3 and wt == WT_LEN:
            vals = packed_varints(val)
        elif field == 8 and wt == WT_LEN:
            refs = packed_svarints(val)
    if wid is None:
        return None
    tags = {decode_str(table, k): decode_str(table, v) for k, v in zip(keys, vals)}
    node_ids = []
    rid = 0
    for d in refs:
        rid += d
        node_ids.append(rid)
    return wid, tags, node_ids


def parse_primitive_block(payload: bytes, wanted, poi_nodes: list, ways_out: list, loc: dict, needed: Optional[Set[int]], collect_ways: bool):
    table = []
    gran = 100
    lat_off = 0
    lon_off = 0
    groups = []
    for field, wt, val in decode_fields(payload):
        if field == 1 and wt == WT_LEN:
            table = parse_stringtable(val)
        elif field == 2 and wt == WT_LEN:
            groups.append(val)
        elif field == 17 and wt == WT_VARINT:
            gran = val if val else 100
        elif field == 19 and wt == WT_VARINT:
            lat_off = val
        elif field == 20 and wt == WT_VARINT:
            lon_off = val
    scratch = {}
    for g in groups:
        for field, wt, val in decode_fields(g):
            if field == 2 and wt == WT_LEN:  # dense
                scratch.clear()
                parse_dense_nodes(val, table, gran, lat_off, lon_off, wanted, scratch, needed)
                poi_nodes.extend(scratch.pop("__poi_nodes__", []))
                if needed is not None:
                    for k, v in scratch.items():
                        loc[k] = v
            elif field == 1 and wt == WT_LEN:  # regular nodes
                nid = lat = lon = None
                keys = []
                vals = []
                for f2, w2, v2 in decode_fields(val):
                    if f2 == 1 and w2 == WT_VARINT:
                        nid = v2
                    elif f2 == 8 and w2 == WT_VARINT:
                        # sint64 in proto3 might be zigzag if defined as sint64
                        # Node lat/lon in regular Node are sint64
                        lat = zig64(v2)
                    elif f2 == 9 and w2 == WT_VARINT:
                        lon = zig64(v2)
                    elif f2 == 2 and w2 == WT_LEN:
                        keys = packed_varints(v2)
                    elif f2 == 3 and w2 == WT_LEN:
                        vals = packed_varints(v2)
                if nid is None or lat is None or lon is None:
                    continue
                lat_deg = (lat_off + gran * lat) / 1e9
                lon_deg = (lon_off + gran * lon) / 1e9
                tags = {decode_str(table, k): decode_str(table, v) for k, v in zip(keys, vals)}
                if needed is not None and nid in needed:
                    loc[nid] = (lat_deg, lon_deg)
                if tags and wanted(tags):
                    poi_nodes.append((nid, lat_deg, lon_deg, tags))
            elif field == 3 and wt == WT_LEN and collect_ways:
                parsed = parse_way(val, table)
                if parsed and parsed[1] and wanted(parsed[1]):
                    ways_out.append(parsed)


def load_categories(path: Path):
    cfg = json.loads(path.read_text())
    cats = [c for c in cfg.get("categories", []) if c.get("enabled", True)]
    # map (key,value) -> category, first match wins (same as app.js)
    order = []
    lookup = {}
    for cat in cats:
        for q in cat.get("queries") or []:
            pair = (q["key"], q["value"])
            if pair not in lookup:
                lookup[pair] = cat
                order.append(pair)
    return cats, lookup


def match_category(tags: dict, lookup: dict):
    for (k, v), cat in lookup.items():
        if tags.get(k) == v:
            return cat
    return None


def format_address(tags: dict) -> str:
    parts = [
        " ".join(p for p in [tags.get("addr:housenumber"), tags.get("addr:street")] if p),
        tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village"),
        tags.get("addr:state"),
        tags.get("addr:postcode"),
    ]
    return ", ".join(p for p in parts if p)


def heuristic_fit(base, tags: dict) -> int:
    fit = int(base or 3)
    has_site = bool(tags.get("website") or tags.get("contact:website") or tags.get("url"))
    has_phone = bool(tags.get("phone") or tags.get("contact:phone"))
    has_name = bool(tags.get("name"))
    if not has_name:
        fit -= 1
    if not has_site and not has_phone:
        fit -= 1
    return max(1, min(5, fit))


def point_in_ring(lon, lat, ring) -> bool:
    # ray casting; ring is list of [lon,lat]
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            xint = (xj - xi) * (lat - yi) / (yj - yi + 0.0) + xi
            if lon < xint:
                inside = not inside
        j = i
    return inside


def point_in_geom(lon, lat, geom) -> bool:
    if not geom:
        return True
    typ = geom.get("type")
    coords = geom.get("coordinates")
    if typ == "Polygon":
        if not coords:
            return True
        if not point_in_ring(lon, lat, coords[0]):
            return False
        for hole in coords[1:]:
            if point_in_ring(lon, lat, hole):
                return False
        return True
    if typ == "MultiPolygon":
        for poly in coords or []:
            if point_in_geom(lon, lat, {"type": "Polygon", "coordinates": poly}):
                return True
        return False
    return True


def in_bbox(lon, lat, bbox) -> bool:
    if not bbox or len(bbox) != 4:
        return True
    minx, miny, maxx, maxy = bbox
    return minx <= lon <= maxx and miny <= lat <= maxy


def tags_to_lead(osm_type: str, osm_id: int, lat: float, lon: float, tags: dict, cat: dict, region_id: str, region_name: str, hide_email: bool) -> dict:
    name = tags.get("name") or tags.get("operator") or tags.get("brand")
    phone = tags.get("phone") or tags.get("contact:phone") or ""
    email = "" if hide_email else (tags.get("email") or tags.get("contact:email") or "")
    website = tags.get("website") or tags.get("contact:website") or tags.get("url") or ""
    fit = heuristic_fit(cat.get("baseFit"), tags)
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or region_name
    oid = f"{osm_type}/{osm_id}"
    return {
        "key": "OSM:" + oid,
        "name": name,
        "category": cat["label"],
        "city": city,
        "website": website,
        "phone": phone,
        "email": email,
        "address": format_address(tags),
        "fit": fit,
        "fitKind": "heuristic",
        "reason": f"Heuristic fit {fit} based on OSM tags for {cat['label'].lower()}. Not a DataEarners or licensing-company decision.",
        "source": "OSM",
        "osmUrl": "https://www.openstreetmap.org/" + oid,
        "osmId": oid,
        "regionId": region_id,
        "lat": round(lat, 6),
        "lng": round(lon, 6),
    }


def sort_key(lead: dict):
    return (
        -int(lead.get("fit") or 0),
        0 if lead.get("phone") else 1,
        0 if lead.get("website") else 1,
        0 if lead.get("email") else 1,
        0 if lead.get("address") else 1,
        (lead.get("name") or "").lower(),
    )


def dedupe(leads: List[dict]) -> List[dict]:
    best = {}
    for lead in leads:
        name = "".join(ch.lower() if ch.isalnum() else " " for ch in (lead.get("name") or "")).split()
        name_k = " ".join(name)
        lat = lead.get("lat") or 0
        lng = lead.get("lng") or 0
        key = (name_k, round(lat, 3), round(lng, 3))
        prev = best.get(key)
        if prev is None or sort_key(lead) < sort_key(prev):
            best[key] = lead
    # also unique by osmId
    by_id = {}
    for lead in best.values():
        by_id[lead["osmId"]] = lead
    return list(by_id.values())


def extract(pbf: Path, categories_path: Path, region_id: str, region_name: str, out_path: Path, cap: int, hide_email: bool, bbox=None, geom=None):
    cats, lookup = load_categories(categories_path)

    def wanted(tags: dict) -> bool:
        if not (tags.get("name") or tags.get("operator") or tags.get("brand")):
            return False
        return match_category(tags, lookup) is not None

    reader = PbfReader(pbf)
    t0 = time.time()
    poi_nodes: list = []
    ways: list = []
    print(f"[pass 1] scan {pbf} for tagged POIs…", flush=True)
    blocks = 0
    for typ, payload in reader.iter_blocks():
        if typ != "OSMData":
            continue
        blocks += 1
        parse_primitive_block(payload, wanted, poi_nodes, ways, {}, None, True)
        if blocks % 200 == 0:
            print(f"  blocks={blocks} poi_nodes={len(poi_nodes)} ways={len(ways)}", flush=True)
    print(f"[pass 1] done in {time.time()-t0:.1f}s: nodes={len(poi_nodes)} ways={len(ways)}", flush=True)

    needed: Set[int] = set()
    for _wid, _tags, refs in ways:
        needed.update(refs)
    loc: dict = {}
    if needed:
        t1 = time.time()
        print(f"[pass 2] collect {len(needed)} way-node locations…", flush=True)
        blocks = 0
        for typ, payload in reader.iter_blocks():
            if typ != "OSMData":
                continue
            blocks += 1
            parse_primitive_block(payload, lambda tags: False, [], [], loc, needed, False)
            if blocks % 200 == 0:
                print(f"  blocks={blocks} resolved={len(loc)}/{len(needed)}", flush=True)
        print(f"[pass 2] done in {time.time()-t1:.1f}s: resolved={len(loc)}/{len(needed)}", flush=True)

    leads = []
    skipped_geom = 0
    for nid, lat, lon, tags in poi_nodes:
        if bbox and not in_bbox(lon, lat, bbox):
            skipped_geom += 1
            continue
        if geom and not point_in_geom(lon, lat, geom):
            skipped_geom += 1
            continue
        cat = match_category(tags, lookup)
        if not cat:
            continue
        leads.append(tags_to_lead("node", nid, lat, lon, tags, cat, region_id, region_name, hide_email))

    for wid, tags, refs in ways:
        pts = [loc[r] for r in refs if r in loc]
        if not pts:
            continue
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        if bbox and not in_bbox(lon, lat, bbox):
            skipped_geom += 1
            continue
        if geom and not point_in_geom(lon, lat, geom):
            skipped_geom += 1
            continue
        cat = match_category(tags, lookup)
        if not cat:
            continue
        leads.append(tags_to_lead("way", wid, lat, lon, tags, cat, region_id, region_name, hide_email))

    before = len(leads)
    leads = dedupe(leads)
    leads.sort(key=sort_key)
    total = len(leads)
    capped = total > cap
    leads = leads[:cap]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "regionId": region_id,
        "name": region_name,
        "source": "OpenStreetMap",
        "extract": "Geofabrik PBF",
        "license": "ODbL",
        "attribution": "© OpenStreetMap contributors",
        "extractedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalMatched": total,
        "capped": capped,
        "cap": cap,
        "hideEmail": bool(hide_email),
        "leads": leads,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    with_phone = sum(1 for l in leads if l.get("phone"))
    with_site = sum(1 for l in leads if l.get("website"))
    print(
        f"[write] {out_path} leads={len(leads)} totalMatched={total} raw={before} "
        f"skipped_geom={skipped_geom} phone={with_phone} website={with_site} "
        f"bytes={out_path.stat().st_size} sec={time.time()-t0:.1f}",
        flush=True,
    )
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--region", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--categories", default=str(Path(__file__).resolve().parents[1] / "config" / "categories.json"))
    ap.add_argument("--cap", type=int, default=500)
    ap.add_argument("--hide-email", action="store_true")
    ap.add_argument("--bbox", default="", help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--geojson-feature", default="", help="optional geojson file to clip with (feature id = --region)")
    args = ap.parse_args()
    bbox = None
    if args.bbox:
        bbox = [float(x) for x in args.bbox.split(",")]
    geom = None
    if args.geojson_feature:
        fc = json.loads(Path(args.geojson_feature).read_text())
        for f in fc.get("features") or []:
            if (f.get("properties") or {}).get("id") == args.region:
                geom = f.get("geometry")
                if not bbox and (f["properties"].get("bbox")):
                    bbox = f["properties"]["bbox"]
                break
    extract(
        Path(args.pbf),
        Path(args.categories),
        args.region,
        args.name,
        Path(args.out),
        args.cap,
        args.hide_email,
        bbox=bbox,
        geom=geom,
    )


if __name__ == "__main__":
    main()
