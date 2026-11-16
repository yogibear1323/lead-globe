# Robert Walker · Lead Globe (private research tool)

An independent partner’s internal research tool for browsing a seed lead list and expanding it with OpenStreetMap. **It is not an official DataEarners or Mode product.** No DataEarners or Mode logos are used.

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
- `/?region=US-DE` — select Delaware and query Overpass
- `/?region=LU` — select Luxembourg (emails hidden; GDPR note)
- `/?shot=outreach` or `/?lead=Televerde` — open the outreach panel for a selected business (Televerde by default)

## What it does

- Clickable polygons for all US states (plus DC), Canadian provinces and territories, and European countries (plus Cyprus). Hover highlights a region; click zooms the globe and filters the side list.
- Clicking any US state (plus DC), Canadian province or territory, or European country opens the list panel right away. OpenStreetMap businesses are loaded with area queries keyed to ISO 3166-2 (US/Canada) or ISO 3166-1 (Europe), one category chunk at a time. Large regions (for example Texas, California, Ontario, Germany, France) use a tighter first wave so results appear before timeout; use Load more for the rest, up to a cap of about 300. Failed responses are not cached. Russia is drawn but not auto-queried.
- Seed leads (Phoenix-metro research list) are merged with OSM rows and marked `seed` or `OSM`.
- OSM fit scores are **heuristic** (1–5), labelled as such, based on category base fit and whether a name, website, or phone is tagged. They are not a Mode or DataEarners decision.
- Emails are included only when OSM tags them. For European regions, emails are hidden and a GDPR note is shown (also omitted from CSV export).
- Min-fit filter and CSV export apply to the visible list. Selecting a state, province, or country opens the list panel right away, shows a loading state while OpenStreetMap results come in, and lists every visible business with name, category, address, phone, public email, website, and fit on the card itself.
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
- **OpenStreetMap:** live results via the Overpass API. Map data © OpenStreetMap contributors, licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Each OSM row links back to its OSM object. Attribution is shown in the side panel when OSM data is present.

## Limitations

- Seed pins are city-level approximations, not rooftop-accurate.
- OSM coverage and tags vary widely. Many real businesses are missing; some tagged shops are small or a weak fit. Heuristic scores can be wrong.
- Overpass may throttle, time out, or return a partial cap of 300. Queries run one category at a time (area filter by ISO 3166 code) against several public mirrors, and failed responses are not cached. If a region comes up empty, use Retry. Russia is drawn but not auto-queried (too large for a useful search).
- European country polygons are 50m Natural Earth: a few microstates are included; some dependencies (Faroe Islands, Crown dependencies, Åland) are omitted on purpose.
- Emails on OSM are often missing. European emails are hidden here and should not be treated as a mailing list.
- This is a private research tool, unlisted, and not for mass outreach. The public test URL, if one is running, lasts only while the local static server and tunnel processes are up.

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
