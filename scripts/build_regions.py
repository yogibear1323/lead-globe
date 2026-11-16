#!/usr/bin/env python3
"""Download Geofabrik extracts and build data/regions/<ISO>.json for mapped regions."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACT = Path(__file__).resolve().parent / "extract_region.py"
OUT_DIR = ROOT / "data" / "regions"
CACHE = Path("/tmp/osm-extracts")
BASE = "https://download.geofabrik.de"
UA = "lead-globe-extract/1.0 (private research; ODbL attribution)"

SPECIAL_SLUGS = {
    "US-DC": "north-america/us/district-of-columbia",
    "CA-NL": "north-america/canada/newfoundland-and-labrador",
    "CA-NT": "north-america/canada/northwest-territories",
    "CA-PE": "north-america/canada/prince-edward-island",
    "BA": "europe/bosnia-herzegovina",
    "CZ": "europe/czech-republic",
    "GB": "europe/united-kingdom",
    "IE": "europe/ireland-and-northern-ireland",
    "MK": "europe/macedonia",
    "RU": None,  # skipped
    "VA": None,  # no dedicated extract
    "SM": None,  # no dedicated extract
}

CLIP_ISO = {"IE"}  # extract covers a larger area; clip to region polygon


def slugify(name: str) -> str:
    s = name.lower()
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def geofabrik_path(props: dict) -> str | None:
    rid = props["id"]
    if rid in SPECIAL_SLUGS:
        return SPECIAL_SLUGS[rid]
    name = props["name"]
    set_id = props.get("set")
    if set_id == "us-states":
        return "north-america/us/" + slugify(name)
    if set_id == "ca-provinces":
        return "north-america/canada/" + slugify(name)
    if set_id == "european-countries":
        return "europe/" + slugify(name)
    return None


def load_all_regions():
    regions = []
    cfg = json.loads((ROOT / "config" / "regions.json").read_text())
    for s in cfg["sets"]:
        fc = json.loads((ROOT / s["geojson"]).read_text())
        for f in fc["features"]:
            p = f["properties"]
            p = dict(p)
            p["_geom_path"] = str(ROOT / s["geojson"])
            p["_hide_email"] = bool(s.get("hideEmail") or p.get("privacy") == "eu")
            p["_geometry"] = f.get("geometry")
            regions.append(p)
    return regions


def download(url: str, dest: Path, retries: int = 4) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            if tmp.exists():
                tmp.unlink()
            print(f"  downloading {url} -> {dest} (try {attempt})", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                t0 = time.time()
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    if total and got % (1024 * 1024 * 50) < 1024 * 256:
                        pct = 100 * got / total
                        print(f"    {got/1e6:.1f}/{total/1e6:.1f} MB ({pct:.0f}%)", flush=True)
            tmp.rename(dest)
            print(f"  saved {dest} ({dest.stat().st_size/1e6:.1f} MB) in {time.time()-t0:.1f}s", flush=True)
            return
        except Exception as e:
            last_err = e
            print(f"  download failed: {e}", flush=True)
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"download failed after {retries} tries: {last_err}")


def update_manifest(region_id: str, payload: dict | None, error: str | None = None):
    path = OUT_DIR / "manifest.json"
    man = json.loads(path.read_text()) if path.exists() else {}
    if error:
        man[region_id] = {"error": error}
    else:
        man[region_id] = {
            "name": payload.get("name"),
            "count": len(payload.get("leads") or []),
            "totalMatched": payload.get("totalMatched"),
            "capped": payload.get("capped"),
            "extractedAt": payload.get("extractedAt"),
        }
        man.pop("error", None)
    path.write_text(json.dumps(man, indent=2, sort_keys=True) + "\n")


def build_one(props: dict, cap: int, keep_pbf: bool, force: bool) -> dict:
    rid = props["id"]
    name = props["name"]
    out = OUT_DIR / f"{rid}.json"
    if out.exists() and not force:
        data = json.loads(out.read_text())
        print(f"= skip {rid} {name} (already {len(data.get('leads') or [])} leads)", flush=True)
        update_manifest(rid, data)
        return {"id": rid, "status": "exists", "count": len(data.get("leads") or [])}

    if props.get("allowOverpass") is False or geofabrik_path(props) is None:
        why = "skipped (no Geofabrik extract or allowOverpass=false)"
        print(f"! {rid} {name}: {why}", flush=True)
        update_manifest(rid, None, error=why)
        return {"id": rid, "status": "skipped", "why": why}

    rel = geofabrik_path(props)
    url = f"{BASE}/{rel}-latest.osm.pbf"
    pbf = CACHE / f"{rid}.osm.pbf"
    t0 = time.time()
    try:
        if not pbf.exists() or pbf.stat().st_size < 1000:
            download(url, pbf)
        else:
            print(f"  using cached {pbf} ({pbf.stat().st_size/1e6:.1f} MB)", flush=True)
        cmd = [
            sys.executable,
            str(EXTRACT),
            "--pbf",
            str(pbf),
            "--region",
            rid,
            "--name",
            name,
            "--out",
            str(out),
            "--cap",
            str(cap),
            "--geojson-feature",
            props["_geom_path"],
        ]
        if props["_hide_email"] or rid in CLIP_ISO:
            if props["_hide_email"]:
                cmd.append("--hide-email")
        print("  run", " ".join(cmd), flush=True)
        subprocess.check_call(cmd)
        data = json.loads(out.read_text())
        update_manifest(rid, data)
        return {
            "id": rid,
            "status": "ok",
            "count": len(data.get("leads") or []),
            "totalMatched": data.get("totalMatched"),
            "secs": round(time.time() - t0, 1),
        }
    finally:
        if not keep_pbf and pbf.exists():
            pbf.unlink()
            print(f"  deleted {pbf}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated region ids")
    ap.add_argument("--set", dest="set_id", default="", help="us-states, ca-provinces, european-countries")
    ap.add_argument("--cap", type=int, default=500)
    ap.add_argument("--keep-pbf", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    regions = load_all_regions()
    if args.only:
        want = [x.strip() for x in args.only.split(",") if x.strip()]
        regions = [r for r in regions if r["id"] in want]
        # preserve requested order
        order = {k: i for i, k in enumerate(want)}
        regions.sort(key=lambda r: order.get(r["id"], 999))
    if args.set_id:
        regions = [r for r in regions if r.get("set") == args.set_id]
    print(f"building {len(regions)} regions", flush=True)
    results = []
    for r in regions:
        print(f"\n### {r['id']} {r['name']}", flush=True)
        try:
            results.append(build_one(r, args.cap, args.keep_pbf, args.force))
        except Exception as e:
            print(f"ERROR {r['id']}: {e}", flush=True)
            update_manifest(r["id"], None, error=str(e))
            results.append({"id": r["id"], "status": "error", "why": str(e)})
    print("\n=== SUMMARY ===", flush=True)
    for row in results:
        print(row, flush=True)
    (CACHE / "last-build.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
