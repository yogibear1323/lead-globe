# Robert Walker · Lead Globe (private research tool)

An independent partner’s internal research tool for browsing a seed lead list and expanding it with OpenStreetMap. **It is not an official DataEarners or Mode product.** No DataEarners or Mode logos are used.

Live site: [https://yogibear1323.github.io/lead-globe/](https://yogibear1323.github.io/lead-globe/)

Outreach CTA: [https://robertwalker.dataearns.com/invite](https://robertwalker.dataearns.com/invite)

Personal, one-at-a-time outreach only, per DataEarners partner rules. Do not blast this list. Honor opt-outs the same day. This tool does not contact anyone.

## Run it

From this folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/

Optional query flags for screenshots or testing:

- `/?shot=overview` — default globe view
- `/?region=US-AZ` — select Arizona (seed pins)
- `/?region=US-KS` — select Kansas and load the prebuilt OpenStreetMap list
- `/?region=US-DE` — select Delaware and load its prebuilt list (Search live for more is optional)
- `/?region=LU` — select Luxembourg (emails hidden; GDPR note)
- `/?shot=outreach` or `/?lead=Televerde` — open the outreach panel for a selected business (Televerde by default)

## What it does

- Clickable polygons for all US states (plus DC), Canadian provinces and territories, and European countries (plus Cyprus). Hover highlights a region; click zooms the globe and filters the side list.
- Clicking any US state (plus DC), Canadian province or territory, or European country opens the list panel right away and loads a prebuilt OpenStreetMap extract from `data/regions/<ISO>.json` (up to about 500 best-fit businesses, sorted by heuristic fit, preferring those with a phone or website). Contact details are visible on each card. Live Overpass is optional: use **Search live for more**. Russia is drawn but has no prebuilt extract and is not live-queried.
- Seed leads (Phoenix-metro research list) are merged with OSM rows and marked `seed` or `OSM`.
- OSM fit scores are **heuristic** (1–5), labelled as such, based on category base fit and whether a name, website, or phone is tagged. They are not a Mode or DataEarners decision.
- Emails are included only when OSM tags them. For European regions, emails are hidden and a GDPR note is shown (also omitted from CSV export).
- Min-fit filter and CSV export apply to the visible list. Selecting a state, province, or country opens the list panel right away and lists every visible business with name, category, address, phone, public email, website, and fit on the card itself.
- Medical, dental, and insurance categories exist in the config but are **disabled by default**.
- Selecting a pin or card opens an **outreach panel** with category-specific email and call scripts from `config/scripts.json`. Placeholders are filled from the business (`{business_name}`, `{city}`, `{category}`); `{first_name}` is left for you to fill. Copy a script, or use **Open in email** to create a single-recipient `mailto:` draft in your own mail client — only when a published email is listed. The button is disabled, with a note and the phone number, if no email is published. There is no auto-send, no multi-select, and no BCC.
- The CTA and every script use [https://robertwalker.dataearns.com/invite](https://robertwalker.dataearns.com/invite), the business-facing invite page (“You've been invited. This is about your company.”). The similarly named `robertwalker.dataearners.com/invite` is a different, team/partner recruitment page, so it is not used here.

## Adding regions, categories, or seed CSVs

No code changes are required for ordinary additions.

- **Categories:** edit `config/categories.json`. Each object needs `id`, `label`, `enabled`, `baseFit` (1–5), and `queries` as OSM tag `{key, value}` pairs. Set `enabled` to `false` to keep a category in the file without querying it.
- **Regions:** edit `config/regions.json` and add a GeoJSON file under `data/geo/`. Each feature should include `id`, `name`, `set`, `privacy` (`us`, `ca`, or `eu`), `overpassAreaTag`, `overpassAreaValue`, `allowOverpass`, `lat`, `lng`, and `bbox`. `privacy: "eu"` hides emails.
- **Seed CSVs:** drop a CSV in `seed/` with the same columns as `seed/dataearners-leads-phoenix.csv`, then rebuild `leads.js` (or extend it) so each row has `name`, `category`, `city`, `website`, `phone`, `email`, `address`, `fit`, `reason`, `lat`, `lng`, `regionId`, `source: "seed"`. City-level coordinates are fine; say so in the UI if they are approximate.
- **Outreach scripts:** edit `config/scripts.json`. Each category key (`auto`, `home-services`, `contractors`, `property`, `logistics`, `call-center`, `photo`, `retail`, `saas`, `agencies`, plus `generic`) holds 2–3 email variations and 2 short call scripts. Keep the invite-page voice, the opt-out line, the independent-partner identification, and the `[your phone]` / `[your mailing address]` signature placeholders. Do not add income or dollar claims, advertised payout ranges, or example offers. Custom wording should go through DataEarners platform review before use.

## Data sources and licensing

- **Seed list:** compiled from public business pages for Phoenix-metro research (see the DataEarners funnel plan). Stored in `seed/dataearners-leads-phoenix.csv` and `leads.js`.
- **Region boundaries:** [Natural Earth](https://www.naturalearthdata.com/) 50m admin-1 (US, Canada) and 50m admin-0 (Europe), public domain. Geometries were simplified for the globe. Source extracts were taken from the [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) GeoJSON files.
- **OpenStreetMap:** prebuilt per-region extracts in `data/regions/<ISO>.json`, built from [Geofabrik](https://download.geofabrik.de) regional PBF files with `scripts/extract_region.py`. Optional live results via the Overpass API (**Search live for more**). Map data © OpenStreetMap contributors, licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Each OSM row links back to its OSM object. Attribution is shown in the side panel when OSM data is present.

## Limitations

- Seed pins are city-level approximations, not rooftop-accurate.
- OSM coverage and tags vary widely. Many real businesses are missing; some tagged shops are small or a weak fit. Heuristic scores can be wrong.
- Prebuilt lists are capped at about 500 businesses per region (best heuristic fit, preferring phone or website). OSM coverage and tags still vary; a cap is not a complete business census. **Search live for more** uses Overpass, which may throttle or time out; failed live responses are not cached. Russia is drawn but has no extract and is not live-queried. Rebuild extracts with `scripts/extract_region.py` (and `scripts/build_regions.py` for a batch) from Geofabrik PBFs; delete the large PBF files afterward.
- European country polygons are 50m Natural Earth: a few microstates are included; some dependencies (Faroe Islands, Crown dependencies, Åland) are omitted on purpose.
- Emails on OSM are often missing. European emails are hidden here and should not be treated as a mailing list.
- This is a private research tool, unlisted, and not for mass outreach. The public test URL, if one is running, lasts only while the local static server and tunnel processes are up.

## Rebuilding region extracts

Regional PBF files come from [Geofabrik](https://download.geofabrik.de) (for example `north-america/us/kansas-latest.osm.pbf`). The extractor keeps POIs whose tags match enabled rows in `config/categories.json`, plus name, address (`addr:*`), phone, email, website, coordinates, and OSM id. Heuristic fit matches the in-app formula. European extracts omit emails (GDPR). Usage:

```bash
python3 scripts/extract_region.py --pbf /tmp/osm-extracts/kansas-latest.osm.pbf --region US-KS --name Kansas --out data/regions/US-KS.json --geojson-feature data/geo/us-states.geojson
```

## Visual theme

Matched to the invite page at `robertwalker.dataearns.com/invite` (tokens from `invite.css`, 15 Nov 2026): navy `#04182e`, ink `#e8f0fb`, teal `#08BEC8` / `#009D8D`, blue `#0874C9`, Inter + JetBrains Mono + Caveat, pill teal buttons, glass panels, Feather-style stroke icons. No brand marks were copied.

## Public test URL (unlisted, temporary)

This folder is meant to be served locally and, when the network allows it, exposed with a Cloudflare quick tunnel. No hosting account is required.

```bash
cd /workspace/robert-lead-globe
nohup python3 -m http.server 8765 --bind 127.0.0.1 --directory /workspace/robert-lead-globe > /tmp/lead-globe-http.log 2>&1 &
nohup cloudflared tunnel --url http://localhost:8765 > /tmp/lead-globe-tunnel.log 2>&1 &
```

Then read the `https://*.trycloudflare.com` URL from `/tmp/lead-globe-tunnel.log`. The link lasts only while those two processes are running. To bring it back, rerun the commands above (after stopping any stale process on port 8765) and use the new URL from the log. The page sends `noindex,nofollow` and `robots.txt` disallows all crawlers.

On some locked-down networks, `cloudflared` can create a trycloudflare hostname but fail to connect to the Cloudflare edge (QUIC/HTTP2 on port 7844 blocked, or TLS to `*.v2.argotunnel.com` refused). In that case the hostname returns HTTP 530 until the tunnel is started on a network that can reach the edge. The app itself still works at http://127.0.0.1:8765/.
