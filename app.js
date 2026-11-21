(function () {
  const INVITE = "https://robertwalker.dataearns.com/invite";
  const OSM_ATTRIB =
    'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>.';
  const NE_ATTRIB =
    'Boundaries: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> (public domain).';
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  const CACHE_PREFIX = "leadglobe:osm:v2:";
  const RESULT_CAP = 300;

  const seedLeads = (Array.isArray(window.LEADS) ? window.LEADS : []).map((l) => ({
    ...l,
    source: l.source || "seed",
    fitKind: l.fitKind || "seed",
    regionId: l.regionId || "US-AZ",
  }));

  const els = {
    q: document.getElementById("q"),
    cat: document.getElementById("cat"),
    sort: document.getElementById("sort"),
    minFit: document.getElementById("min-fit"),
    region: document.getElementById("region"),
    count: document.getElementById("count"),
    status: document.getElementById("status"),
    gdpr: document.getElementById("gdpr"),
    attrib: document.getElementById("attrib"),
    list: document.getElementById("list"),
    detail: document.getElementById("detail"),
    panel: document.getElementById("list-panel") || document.querySelector(".panel"),
    globe: document.getElementById("globe"),
    hint: document.getElementById("globe-hint"),
    exportBtn: document.getElementById("export-btn"),
    retry: document.getElementById("osm-retry"),
    more: document.getElementById("osm-more"),
    live: document.getElementById("osm-live"),
    heatToggle: document.getElementById("heatmap-toggle"),
    heatLegend: document.getElementById("heat-legend"),
    panelBack: document.getElementById("panel-back"),
    filtersToggle: document.getElementById("filters-toggle"),
    filters: document.getElementById("filters"),
    regionStats: document.getElementById("region-stats"),
    keyToggle: document.getElementById("key-toggle"),
    listToggle: document.getElementById("list-toggle"),
    bannerDismiss: document.getElementById("banner-dismiss"),
    banner: document.getElementById("compliance-banner"),
    leadModal: document.getElementById("lead-modal"),
    leadBackdrop: document.getElementById("lead-modal-backdrop"),
    leadCard: document.getElementById("lead-modal-card"),
    leadClose: document.getElementById("lead-modal-x"),
    leadPrev: document.getElementById("lead-modal-prev"),
    leadNext: document.getElementById("lead-modal-next"),
  };


  const BANNER_KEY = "leadglobe:banner";
  const MOBILE_MQ = "(max-width: 768px)";

  function isMobileUi() {
    return !!(window.matchMedia && window.matchMedia(MOBILE_MQ).matches);
  }

  function isTouchUi() {
    if (isMobileUi()) return true;
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  let categoryConfig = { categories: [], resultCap: RESULT_CAP, overpassTimeoutSec: 25 };
  let scriptConfig = { categories: {}, inviteUrl: INVITE, reviewNote: "" };
  let payoutConfig = null;
  let regionSets = [];
  let regions = []; // feature-like {properties, geometry}
  let osmByRegion = {}; // regionId -> leads[]
  let selectedLead = null;
  let selectedRegion = null;
  let hoveredRegion = null;
  let globe = null;
  const HEAT_KEY = "leadglobe:heatmap";
  let heatmapOn = readHeatPref();
  let heatManifest = {};
  let heatMin = 1;
  let heatMax = 1;
  let queryGen = 0;
  let queryInFlight = false;
  let queuedRegionId = null;
  let queuedForce = false;
  let queuedMore = false;
  let endpointHealth = {};
  let osmProgress = {};
  let leadersById = {}; // data/leaders.json: published leadership from each company's own site (US/Canada best-fit only)

  function fitColor(fit) {
    if (fit >= 5) return "#08BEC8";
    if (fit >= 4) return "#0874C9";
    return "#f59e0b";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function dash(s) {
    return s ? escapeHtml(s) : "—";
  }

  function readHeatPref() {
    try {
      const v = localStorage.getItem("leadglobe:heatmap");
      if (v === "off") return false;
      if (v === "on") return true;
    } catch (e) {}
    return true;
  }

  function formatCount(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("en-US");
  }

  function heatRaw(id) {
    const info = heatManifest[id];
    if (!info || info.error) return null;
    const n = info.totalMatched != null ? Number(info.totalMatched) : Number(info.count);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  function heatT(id) {
    const n = heatRaw(id);
    if (n == null) return null;
    const lo = Math.log(1 + heatMin);
    const hi = Math.log(1 + heatMax);
    if (!(hi > lo)) return 0.5;
    return Math.max(0, Math.min(1, (Math.log(1 + n) - lo) / (hi - lo)));
  }

  function lerpChan(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function heatRgb(t) {
    const stops = [
      [0, [12, 32, 110]],
      [0.3, [110, 36, 160]],
      [0.58, [230, 86, 42]],
      [0.82, [255, 176, 48]],
      [1, [255, 250, 230]],
    ];
    const x = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      if (x <= stops[i][0]) {
        const t0 = stops[i - 1][0];
        const t1 = stops[i][0];
        const u = (x - t0) / (t1 - t0);
        const c0 = stops[i - 1][1];
        const c1 = stops[i][1];
        return [lerpChan(c0[0], c1[0], u), lerpChan(c0[1], c1[1], u), lerpChan(c0[2], c1[2], u)];
      }
    }
    return stops[stops.length - 1][1];
  }

  function heatRgba(t, a) {
    const c = heatRgb(t);
    return "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + a + ")";
  }

  function applyHeatManifest(man) {
    heatManifest = man && typeof man === "object" ? man : {};
    let lo = Infinity;
    let hi = 0;
    Object.keys(heatManifest).forEach((id) => {
      const n = heatRaw(id);
      if (n == null) return;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    });
    heatMin = Number.isFinite(lo) ? lo : 1;
    heatMax = hi > 0 ? hi : 1;
  }

  function regionLabel(d) {
    if (isTouchUi()) return "";
    const name = escapeHtml(d.properties.name);
    if (!heatmapOn) return name;
    const id = d.properties.id;
    const info = heatManifest[id] || {};
    const raw = heatRaw(id);
    if (raw == null) {
      return '<div class="heat-tip"><b>' + name + "</b><div>No prebuilt list</div></div>";
    }
    const found = info.totalMatched != null ? info.totalMatched : raw;
    const listed = info.count != null ? info.count : raw;
    return (
      '<div class="heat-tip"><b>' +
      name +
      "</b><div>" +
      formatCount(found) +
      " businesses found</div><div>" +
      formatCount(listed) +
      " in list</div></div>"
    );
  }

  function setHeatmap(on) {
    heatmapOn = !!on;
    try {
      localStorage.setItem(HEAT_KEY, heatmapOn ? "on" : "off");
    } catch (e) {}
    document.documentElement.dataset.heatmap = heatmapOn ? "on" : "off";
    if (els.heatToggle) {
      els.heatToggle.setAttribute("aria-pressed", heatmapOn ? "true" : "false");
      els.heatToggle.textContent = heatmapOn ? "Heatmap on" : "Heatmap";
    }
    if (els.heatLegend) els.heatLegend.hidden = !heatmapOn;
    paintPolygons();
  }

  function enabledCategories() {
    return (categoryConfig.categories || []).filter((c) => c.enabled !== false);
  }

  function categoryHash() {
    return enabledCategories()
      .map((c) => c.id)
      .sort()
      .join(",");
  }

  function allLeads() {
    const osm = selectedRegion ? osmByRegion[selectedRegion.properties.id] || [] : [];
    const seed = seedLeads;
    if (!selectedRegion) return seed.slice();
    const rid = selectedRegion.properties.id;
    const regionalSeed = seed.filter((l) => l.regionId === rid);
    const seen = new Set(regionalSeed.map((l) => normName(l.name)));
    const merged = regionalSeed.slice();
    osm.forEach((l) => {
      if (!seen.has(normName(l.name))) merged.push(l);
    });
    return merged;
  }

  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function hideEmail() {
    return !!(selectedRegion && (selectedRegion.properties.privacy === "eu" || selectedRegion.setMeta?.hideEmail));
  }

  function visibleEmail(l) {
    if (!l || !l.email) return "";
    if (hideEmail() && l.source === "OSM") return "";
    return String(l.email).trim();
  }

  function updateRegionStats() {
    const el = els.regionStats;
    if (!el) return;
    if (!selectedRegion) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const id = selectedRegion.properties.id;
    const name = selectedRegion.properties.name || id;
    const info = heatManifest[id] || {};
    const raw = heatRaw(id);
    let body;
    if (raw == null) {
      body = "<div>No prebuilt list</div>";
    } else {
      const found = info.totalMatched != null ? info.totalMatched : raw;
      const listed = info.count != null ? info.count : raw;
      body =
        "<div>Businesses found: " +
        formatCount(found) +
        "</div><div>Businesses in list: " +
        formatCount(listed) +
        "</div>";
    }
    el.hidden = false;
    el.innerHTML = "<b>" + escapeHtml(name) + "</b>" + body;
  }

  function setHint(longHtml, shortText) {
    if (!els.hint) return;
    const short = shortText || "Tap a state, province, or country to open its business list.";
    els.hint.innerHTML =
      '<span class="hint-long">' +
      longHtml +
      '</span><span class="hint-short">' +
      escapeHtml(short) +
      "</span>";
  }

  function setKeysOpen(on) {
    document.body.classList.toggle("keys-open", !!on);
    if (els.keyToggle) els.keyToggle.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setFiltersOpen(on) {
    if (els.filters) els.filters.classList.toggle("is-open", !!on);
    if (els.filtersToggle) {
      els.filtersToggle.setAttribute("aria-expanded", on ? "true" : "false");
      els.filtersToggle.textContent = on ? "Hide filters" : "Filters";
    }
  }

  function applyBannerPref() {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(BANNER_KEY) === "collapsed";
    } catch (e) {}
    document.body.classList.toggle("banner-collapsed", isMobileUi() && collapsed);
  }

  function openListPanel() {
    const panel = els.panel || document.getElementById("list-panel") || document.querySelector(".panel");
    if (!panel) return;
    panel.classList.add("is-open");
    document.documentElement.dataset.listOpen = selectedRegion ? "region" : "seed";
    updateRegionStats();
    if (isMobileUi()) {
      document.body.classList.add("sheet-open");
      setKeysOpen(false);
      window.scrollTo(0, 0);
    } else if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function closeListPanel() {
    const panel = els.panel || document.getElementById("list-panel") || document.querySelector(".panel");
    if (!panel) return;
    panel.classList.remove("is-open");
    document.body.classList.remove("sheet-open");
    document.documentElement.dataset.listOpen = "";
    if (selectedLead) selectLead(null, false);
    if (window.AzOutreach && window.AzOutreach.close) window.AzOutreach.close();
  }

  function leaderKey(l) {
    if (l.osmId) return "osm:" + l.osmId;
    if (l.source === "seed")
      return "seed:" + String(l.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return "";
  }

  function leadersBlock(l) {
    const k = leaderKey(l);
    const rec = k && leadersById[k];
    if (!rec || !Array.isArray(rec.people) || !rec.people.length) return "";
    const people = rec.people
      .map(
        (p) =>
          `<li><span class="leader-name">${escapeHtml(p.name)}</span><span class="leader-title">${escapeHtml(p.title || "")}</span></li>`
      )
      .join("");
    const src = rec.source
      ? ` <a href="${escapeHtml(rec.source)}" target="_blank" rel="noopener" data-contact="1">Source</a>`
      : "";
    return `<div class="card-leaders" data-leaders="${rec.people.length}"><div class="lbl">Leadership (from company website)${src}</div><ul>${people}</ul></div>`;
  }

  function contactRows(l) {
    const email = visibleEmail(l);
    const hiddenEu = hideEmail() && l.source === "OSM" && l.email;
    const rows = [];
    if (l.address) {
      rows.push(`<div class="card-row"><span class="lbl">Address</span><span>${escapeHtml(l.address)}</span></div>`);
    }
    if (l.phone) {
      const tel = String(l.phone).replace(/[^\d+]/g, "");
      rows.push(
        `<div class="card-row"><span class="lbl">Phone</span><a href="tel:${escapeHtml(tel || l.phone)}" data-contact="1">${escapeHtml(l.phone)}</a></div>`
      );
    }
    if (email) {
      rows.push(
        `<div class="card-row"><span class="lbl">Email</span><a href="mailto:${escapeHtml(email)}" data-contact="1">${escapeHtml(email)}</a></div>`
      );
    } else if (hiddenEu) {
      rows.push(`<div class="card-row"><span class="lbl">Email</span><span>Hidden (GDPR)</span></div>`);
    }
    if (l.website) {
      rows.push(
        `<div class="card-row"><span class="lbl">Website</span><a href="${escapeHtml(l.website)}" target="_blank" rel="noopener" data-contact="1">${escapeHtml(l.website)}</a></div>`
      );
    }
    return rows.length ? `<div class="card-contact">${rows.join("")}</div>` : "";
  }

  function filtered() {
    const needle = els.q.value.trim().toLowerCase();
    const cat = els.cat.value;
    const sort = els.sort.value;
    const minFit = Number(els.minFit.value || 1);
    const rows = allLeads().filter((l) => {
      if (Number(l.fit) < minFit) return false;
      if (cat && cat !== "All" && cat.toLowerCase() !== "all" && l.category !== cat) return false;
      if (!needle) return true;
      const blob = [l.name, l.category, l.city, l.phone, l.email, l.reason, l.address, l.source].join(" ").toLowerCase();
      return blob.includes(needle);
    });
    rows.sort((a, b) => {
      if (sort === "fit") return b.fit - a.fit || a.name.localeCompare(b.name);
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "city") return (a.city || "").localeCompare(b.city || "") || a.name.localeCompare(b.name);
      if (sort === "source") return (a.source || "").localeCompare(b.source || "") || a.name.localeCompare(b.name);
      return (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name);
    });
    return rows;
  }

  function setStatus(text, kind) {
    els.status.textContent = text || "";
    els.status.className = "status" + (kind ? " is-" + kind : "");
  }

  function updateQaHooks(rows) {
    const root = document.documentElement;
    root.dataset.globe = globe ? "ready" : "pending";
    root.dataset.region = selectedRegion ? selectedRegion.properties.id : "";
    root.dataset.pins = String(rows.length);
    root.dataset.seedPins = String(rows.filter((r) => r.source === "seed").length);
    root.dataset.osmPins = String(rows.filter((r) => r.source === "OSM").length);
    root.dataset.selectedLead = selectedLead ? selectedLead.name || selectedLead.key : "";
    root.dataset.outreach = selectedLead ? "ready" : "hidden";
    root.dataset.listOpen = selectedRegion ? "region" : "seed";
    window.LeadGlobe = window.LeadGlobe || {};
    window.LeadGlobe.ready = true;
    window.LeadGlobe.getVisible = () => rows.slice();
    window.LeadGlobe.getSelectedRegion = () => (selectedRegion ? selectedRegion.properties.id : null);
    window.LeadGlobe.getSelected = () => selectedLead;
    window.LeadGlobe.selectLead = (key, fly) => selectLead(key, fly);
    window.LeadGlobe.selectRegion = (id, opts) => selectRegion(id, opts);
  }

  function fillCategorySelect() {
    const labels = new Set(enabledCategories().map((c) => c.label));
    seedLeads.forEach((l) => labels.add(l.category));
    const current = els.cat.value || "All";
    els.cat.innerHTML = '<option value="All">All</option>';
    [...labels].sort().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      els.cat.appendChild(opt);
    });
    if ([...els.cat.options].some((o) => o.value === current)) els.cat.value = current;
  }

  function fillRegionSelect() {
    const current = els.region.value;
    els.region.innerHTML = '<option value="">All seed leads</option>';
    const bySet = new Map();
    regions.forEach((r) => {
      const setId = r.properties.set;
      if (!bySet.has(setId)) bySet.set(setId, []);
      bySet.get(setId).push(r);
    });
    regionSets.forEach((set) => {
      const group = document.createElement("optgroup");
      group.label = set.label;
      (bySet.get(set.id) || []).forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.properties.id;
        opt.textContent = r.properties.name;
        group.appendChild(opt);
      });
      if (group.childElementCount) els.region.appendChild(group);
    });
    if (current) els.region.value = current;
  }

  function renderList() {
    updateRegionStats();
    const rows = filtered();
    const total = allLeads().length;
    const place = selectedRegion ? selectedRegion.properties.name : "the seed list";
    const osmState = document.documentElement.dataset.osm;
    if (selectedRegion && osmState === "loading") {
      els.count.textContent = total
        ? `Loading… showing ${rows.length} of ${total} in ${place} so far.`
        : `Loading OpenStreetMap businesses in ${place}…`;
    } else {
      els.count.textContent = `Showing ${rows.length} of ${total} in ${place}.`;
    }
    els.gdpr.hidden = !hideEmail();
    if (!rows.length) {
      const osm = document.documentElement.dataset.osm;
      let msg = "No leads match those filters.";
      let kind = "";
      if (selectedRegion && osm === "loading") {
        msg = "Loading OpenStreetMap businesses for this region…";
        kind = "loading";
      } else if (selectedRegion && osm === "error") {
        msg = "The list could not be loaded. Try Search live for more, or Retry.";
        kind = "error";
      } else if (selectedRegion && osm === "missing") {
        msg = "No prebuilt list for this region yet. Use Search live for more, or check back after the next extract.";
      } else if (selectedRegion && osm === "skipped") {
        msg = "This region is not included in the prebuilt OpenStreetMap extracts.";
      } else if (selectedRegion && (osm === "ok" || osm === "cached" || osm === "static")) {
        msg = "No businesses matched in this region for the current filters.";
      }
      els.list.innerHTML = `<p class="empty${kind ? " is-" + kind : ""}">${msg}</p>`;
    } else {
      const loadingBanner =
        selectedRegion && osmState === "loading"
          ? '<p class="empty is-loading list-loading">Loading more OpenStreetMap businesses for this region…</p>'
          : "";
      els.list.innerHTML =
        loadingBanner +
        rows
          .map((l) => {
            const on = selectedLead && selectedLead.key === l.key ? " is-on" : "";
            const heuristic = l.fitKind === "heuristic" ? '<span class="kind">heuristic</span>' : "";
            return `<article class="card${on}" data-key="${escapeHtml(l.key)}" tabindex="0">
            <div class="card-top">
              <h2>${escapeHtml(l.name)}</h2>
              <span class="fit f${Math.min(5, Math.max(1, l.fit))}">FIT ${l.fit}${heuristic}</span>
            </div>
            <div class="meta">${escapeHtml(l.category)} · ${escapeHtml(l.city || "")} · ${payoutEstimateHtml(l, "chip")} · <span class="badge ${l.source === "seed" ? "seed" : "osm"}">${escapeHtml(l.source)}</span></div>
            ${contactRows(l)}
            ${leadersBlock(l)}
          </article>`;
          })
          .join("");
    }
    renderDetail();
    // Desktop side panel is always on-screen; keep the existing is-open hook.
    // On mobile the list is a sheet — open it only from a region tap, List, or a deep link.
    if (!isMobileUi()) openListPanel();
    if (globe) globe.htmlElementsData(rows);
    els.attrib.innerHTML = selectedRegion
      ? (osmByRegion[selectedRegion.properties.id] ? OSM_ATTRIB + " " : "") + NE_ATTRIB
      : NE_ATTRIB;
    updateQaHooks(rows);
    return rows;
  }


  function publishedEmail(lead) {
    if (!lead || !lead.email) return "";
    if (hideEmail() && lead.source === "OSM") return "";
    return String(lead.email).trim();
  }

  function fillTemplate(text, lead) {
    const invite = (scriptConfig && scriptConfig.inviteUrl) || INVITE;
    const map = {
      business_name: (lead && lead.name) || "",
      city: (lead && lead.city) || "",
      category: (lead && lead.category) || "",
      invite_url: invite,
    };
    return String(text || "").replace(/\{([a-z_]+)\}/gi, (m, key) => {
      const k = key.toLowerCase();
      if (k === "first_name") return m;
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }

  function scriptPackFor(lead) {
    const packs = (scriptConfig && scriptConfig.categories) || {};
    const raw = ((lead && lead.category) || "") + "";
    const lower = raw.toLowerCase();
    // Prefer an exact label or id match from config/categories.json or scripts.json
    for (const [id, pack] of Object.entries(packs)) {
      if (!pack) continue;
      if (id === lower || (pack.label && pack.label.toLowerCase() === lower)) return pack;
    }
    const rules = [
      [/auto dealer|auto group|\bdealer\b|\bautomotive\b|\bauto shop\b|\bcar dealer\b/, "auto"],
      [/home service|\bhvac\b|\bplumb|\belectric|\broof/, "home-services"],
      [/contractor|construction|\bbuilder\b/, "contractors"],
      [/property manag|property mgmt|\bapartments?\b|\bproperty\b/, "property"],
      [/logistics|\bfleet\b|\bfreight\b|\b3pl\b|\btruck/, "logistics"],
      [/call center|\bbpo\b|contact center/, "call-center"],
      [/photo|\bvideo\b|\bstudio\b|\bfilm\b/, "photo"],
      [/retail|e-commerce|ecommerce/, "retail"],
      [/saas|software|\bapp\b/, "saas"],
      [/\bagenc/, "agencies"],
      [/accounting|\bcpa\b|bookkeep|tax prep/, "accounting"],
      [/manufactur|\bfactory\b|fabricat/, "manufacturing"],
      [/\boil\b|oil and gas|oil & gas|\bgas\b|petroleum/, "oil-gas"],
    ];
    for (const [re, id] of rules) {
      if (re.test(lower) && packs[id]) return packs[id];
    }
    return packs.generic || { id: "generic", label: "General", emails: [], calls: [] };
  }


  function payoutConfigReady() {
    return payoutConfig && Array.isArray(payoutConfig.tiers) && payoutConfig.tiers.length;
  }

  function formatPayout(n) {
    const v = Number(n);
    if (!isFinite(v)) return "";
    if (v >= 1000000) {
      const m = v / 1000000;
      const txt = m % 1 === 0 ? String(m) : String(Math.round(m * 10) / 10);
      return "$" + txt + "M";
    }
    if (v >= 1000) {
      const k = v / 1000;
      const txt = k % 1 === 0 ? String(k) : String(Math.round(k * 10) / 10);
      return "$" + txt + "K";
    }
    return "$" + v.toLocaleString("en-US");
  }

  function payoutRangeLabel(tier) {
    if (!tier) return "";
    return formatPayout(tier.min) + "–" + formatPayout(tier.max);
  }

  function payoutTierById(id) {
    if (!payoutConfigReady() || !id) return null;
    return payoutConfig.tiers.find((t) => t.id === id) || null;
  }

  function payoutTierFor(lead) {
    if (!payoutConfigReady()) return null;
    const advertised = payoutConfig.advertised || { min: 100000, max: 5000000 };
    const fallbackId = payoutConfig.defaultTier || "generic";
    const raw = String((lead && lead.category) || "").trim();
    const lower = raw.toLowerCase();
    let found = null;
    if (raw) {
      found = payoutConfig.tiers.find((t) => t.id === lower || (t.label && t.label.toLowerCase() === lower));
    }
    if (!found) {
      const pack = scriptPackFor(lead);
      if (pack && pack.id) found = payoutTierById(pack.id);
    }
    if (!found) {
      const extra = [
        [/medical|\bdental\b|\bclinic\b|\bhospital\b|\bdoctor/, "medical"],
        [/\binsurance\b/, "insurance"],
      ];
      for (const [re, id] of extra) {
        if (re.test(lower)) {
          found = payoutTierById(id);
          if (found) break;
        }
      }
    }
    if (!found) found = payoutTierById(fallbackId);
    if (!found) {
      found = {
        id: fallbackId,
        label: "General / unknown type",
        min: advertised.min,
        max: advertised.max,
      };
    }
    return found;
  }

  function payoutEstimateHtml(lead, kind) {
    const tier = payoutTierFor(lead);
    if (!tier) return "";
    const range = payoutRangeLabel(tier);
    const caveat =
      (payoutConfig && payoutConfig.caveat) ||
      "Your estimate by business type, within the licensing company's advertised $100K–$5M range. Not an offer; only the data licensing company makes an offer.";
    if (kind === "chip") {
      return (
        '<span class="payout-chip" title="' +
        escapeHtml(caveat) +
        '" data-tier="' +
        escapeHtml(tier.id) +
        '">' +
        escapeHtml(range) +
        "</span>"
      );
    }
    const prefix = (payoutConfig && payoutConfig.labelPrefix) || "Rough payout estimate";
    return (
      '<div class="payout-estimate" id="payout-estimate" data-tier="' +
      escapeHtml(tier.id) +
      '" data-min="' +
      String(tier.min) +
      '" data-max="' +
      String(tier.max) +
      '"><div class="payout-label">' +
      escapeHtml(prefix) +
      ": " +
      escapeHtml(range) +
      '</div><p class="payout-caveat">' +
      escapeHtml(caveat) +
      "</p></div>"
    );
  }

  function scriptItems(pack) {
    const emails = (pack.emails || []).map((s, i) => ({
      ...s,
      kind: "email",
      id: s.id || "email-" + (i + 1),
      label: "Email " + (i + 1) + ": " + (s.label || "Variation " + (i + 1)),
    }));
    const calls = (pack.calls || []).map((s, i) => ({
      ...s,
      kind: "call",
      id: s.id || "call-" + (i + 1),
      label: "Call " + (i + 1) + ": " + (s.label || "Script " + (i + 1)),
    }));
    return emails.concat(calls);
  }

  function currentOutreachFields() {
    return {
      subject: (document.getElementById("outreach-subject") || {}).value || "",
      body: (document.getElementById("outreach-body") || {}).value || "",
      scriptId: (document.getElementById("outreach-script") || {}).value || "",
    };
  }

  function buildMailto(email, subject, body) {
    return (
      "mailto:" +
      encodeURIComponent(email) +
      "?subject=" +
      encodeURIComponent(subject || "") +
      "&body=" +
      encodeURIComponent(body || "")
    );
  }


  function regionIdOf() {
    return selectedRegion && selectedRegion.properties ? selectedRegion.properties.id : "";
  }

  function usesOutreachDraft(lead) {
    return !!(window.AzOutreach && AzOutreach.usesOutreachDraft && AzOutreach.usesOutreachDraft(lead, regionIdOf()));
  }

  function leadFromMailtoAnchor(anchor, payload) {
    const card = anchor && anchor.closest && anchor.closest("[data-key]");
    if (card) {
      const key = card.getAttribute("data-key");
      const fromList = allLeads().find((l) => l.key === key);
      if (fromList) return fromList;
      if (selectedLead && selectedLead.key === key) return selectedLead;
    }
    const to = payload && payload.to ? String(payload.to).toLowerCase().trim() : "";
    if (selectedLead && publishedEmail(selectedLead) && publishedEmail(selectedLead).toLowerCase() === to) {
      return selectedLead;
    }
    if (to) {
      const hit = allLeads().find((l) => publishedEmail(l) && publishedEmail(l).toLowerCase() === to);
      if (hit) return hit;
    }
    return null;
  }

  function installMailtoHook() {
    if (!window.MailChooser) return;
    MailChooser.beforeMailto = function (payload, anchor) {
      if (!window.AzOutreach || !AzOutreach.openLeadMail) return false;
      const lead = leadFromMailtoAnchor(anchor, payload);
      if (!lead || !usesOutreachDraft(lead)) return false;
      AzOutreach.openLeadMail(lead, { source: "list", mode: "use" });
      return true;
    };
  }

  function syncMailtoLink(lead) {
    const email = publishedEmail(lead);
    const a = document.getElementById("outreach-mailto");
    const note = document.getElementById("outreach-mail-note");
    const fields = currentOutreachFields();
    const item = scriptItems(scriptPackFor(lead)).find((s) => s.id === fields.scriptId);
    const isCall = !!(item && item.kind === "call");
    if (!a) return;
    if (isCall && !usesOutreachDraft(lead)) {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("disabled", "disabled");
      a.classList.add("is-disabled");
      var changeBtn = document.getElementById("outreach-mail-change");
      if (changeBtn) { changeBtn.hidden = true; changeBtn.disabled = true; }
      if (note) {
        note.hidden = false;
        note.textContent =
          "This is a call script. Copy it, or switch to an email variation to open a single-recipient draft in your own mail client.";
      }
      document.documentElement.dataset.outreachMailto = "no";
      document.documentElement.dataset.outreachDraft = "no";
      document.documentElement.dataset.outreachStatus = "";
      return;
    }
    if (!email) {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("disabled", "disabled");
      a.classList.add("is-disabled");
      var changeBtn2 = document.getElementById("outreach-mail-change");
      if (changeBtn2) { changeBtn2.hidden = true; changeBtn2.disabled = true; }
      if (note) {
        note.hidden = false;
        const phone = lead && lead.phone ? " Published phone: " + lead.phone + "." : "";
        note.textContent =
          "No published email is listed for this business, so Open in email is disabled. Copy the script and use the phone number instead, or paste it into your own mail client." +
          phone;
      }
      document.documentElement.dataset.outreachMailto = "no";
      return;
    }
    const statusEl = document.getElementById("outreach-log-status");
    const az = window.AzOutreach;
    const inOutreach = usesOutreachDraft(lead);
    const st = inOutreach && az && az.statusOf ? az.statusOf(lead) : "";
    if (statusEl) {
      if (st === "opted-out") {
        const when = az.formatStamp && az.statusDate ? az.formatStamp(az.statusDate(lead, "opted-out")) : "";
        statusEl.hidden = false;
        statusEl.className = "outreach-log-status is-opted";
        statusEl.textContent =
          (lead.name || "This business") +
          " opted out" +
          (when ? " on " + when : "") +
          ". Lead Globe will not open a draft.";
      } else if (st === "contacted") {
        const when = az.formatStamp && az.statusDate ? az.formatStamp(az.statusDate(lead, "contacted")) : "";
        statusEl.hidden = false;
        statusEl.className = "outreach-log-status is-contacted";
        statusEl.textContent =
          "Already contacted" +
          (when ? " on " + when : "") +
          ". Opening again will ask you to confirm.";
      } else {
        statusEl.hidden = true;
        statusEl.textContent = "";
        statusEl.className = "outreach-log-status";
      }
    }
    document.documentElement.dataset.outreachStatus = st || "";
    document.documentElement.dataset.outreachDraft = inOutreach ? "yes" : "no";
    if (inOutreach && st === "opted-out") {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("disabled", "disabled");
      a.classList.add("is-disabled");
      a.textContent = "Opted out";
      const changeBtn3 = document.getElementById("outreach-mail-change");
      if (changeBtn3) { changeBtn3.hidden = true; changeBtn3.disabled = true; }
      if (note) {
        note.hidden = false;
        note.textContent = "This business opted out. Honor the opt-out and do not email them.";
      }
      document.documentElement.dataset.outreachMailto = "blocked";
      return;
    }
    a.removeAttribute("href");
    a.removeAttribute("aria-disabled");
    a.removeAttribute("disabled");
    a.classList.remove("is-disabled");
    const useLabel =
      window.MailChooser && MailChooser.getPreferred && MailChooser.getPreferred() && MailChooser.useButtonLabel
        ? MailChooser.useButtonLabel()
        : "Open in email";
    a.textContent = useLabel;
    const change = document.getElementById("outreach-mail-change");
    const hasPref = !!(window.MailChooser && MailChooser.getPreferred && MailChooser.getPreferred());
    if (change) {
      change.hidden = !hasPref;
      change.disabled = !hasPref;
    }
    if (note) {
      note.hidden = false;
      if (inOutreach) {
        const place = az && az.getActiveRegion ? az.getActiveRegion() : "this state";
        note.textContent =
          "Opens the same personalized outreach draft as the outreach desk, prefilled to " +
          email +
          " (subject, the seven-step process, disclaimer, opt-out link, and your signature). Review it and press Send yourself. This tool never sends mail, and it will not BCC or message more than one address.";
      } else {
        note.textContent =
          "Opens a single-recipient draft to " +
          email +
          " in Gmail, Outlook, Yahoo, or your default email app. Review it and press Send yourself. This tool never sends mail, and it will not BCC or message more than one address.";
      }
    }
    document.documentElement.dataset.outreachMailto = "yes";
  }

  function applyScriptChoice(lead, scriptId, keepEdits) {
    const pack = scriptPackFor(lead);
    const items = scriptItems(pack);
    const item = items.find((s) => s.id === scriptId) || items[0];
    const subjectEl = document.getElementById("outreach-subject");
    const bodyEl = document.getElementById("outreach-body");
    const subjectWrap = document.getElementById("outreach-subject-field");
    if (!item || !bodyEl) return;
    const sel = document.getElementById("outreach-script");
    if (sel) sel.value = item.id;
    if (!keepEdits) {
      if (subjectEl) subjectEl.value = fillTemplate(item.subject || "", lead);
      bodyEl.value = fillTemplate(item.body || "", lead);
    }
    if (subjectWrap) subjectWrap.hidden = item.kind === "call";
    if (subjectEl) subjectEl.disabled = item.kind === "call";
    syncMailtoLink(lead);
  }

  function copyOutreach() {
    const fields = currentOutreachFields();
    const packItem = selectedLead
      ? scriptItems(scriptPackFor(selectedLead)).find((s) => s.id === fields.scriptId)
      : null;
    const text =
      packItem && packItem.kind === "email" && fields.subject
        ? fields.subject + "\n\n" + fields.body
        : fields.body;
    const btn = document.getElementById("outreach-copy");
    const done = () => {
      if (!btn) return;
      const prev = btn.dataset.label || btn.textContent;
      btn.dataset.label = prev;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = btn.dataset.label || "Copy";
      }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      if (done) done();
    } finally {
      ta.remove();
    }
  }

  function setLeadModal(on) {
    if (els.leadModal) {
      els.leadModal.hidden = !on;
    }
    document.body.classList.toggle("lead-modal-open", !!on);
    document.documentElement.dataset.leadModal = on ? "open" : "closed";
    if (on && els.leadCard && typeof els.leadCard.focus === "function") {
      try { els.leadCard.focus({ preventScroll: true }); } catch (e) { els.leadCard.focus(); }
    }
  }

  function leadNeighbors() {
    const list = filtered();
    const i = selectedLead ? list.findIndex((x) => x.key === selectedLead.key) : -1;
    return {
      list: list,
      index: i,
      prev: i > 0 ? list[i - 1] : null,
      next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
    };
  }

  function updateLeadModalNav() {
    const n = leadNeighbors();
    if (els.leadPrev) {
      els.leadPrev.disabled = !n.prev;
      els.leadPrev.hidden = false;
    }
    if (els.leadNext) {
      els.leadNext.disabled = !n.next;
      els.leadNext.hidden = false;
    }
    if (els.leadModal) {
      els.leadModal.dataset.leadIndex = n.index >= 0 ? String(n.index + 1) : "";
      els.leadModal.dataset.leadCount = String(n.list.length);
    }
  }

  function renderDetail() {
    const l = selectedLead;
    if (!l) {
      els.detail.hidden = true;
      els.detail.innerHTML = "";
      if (els.panel) els.panel.classList.remove("has-lead");
      els.detail.dataset.leadKey = "";
      document.documentElement.dataset.outreach = "hidden";
      document.documentElement.dataset.outreachCategory = "";
      document.documentElement.dataset.outreachMailto = "";
      document.documentElement.dataset.selectedLead = "";
      setLeadModal(false);
      return;
    }
    els.detail.hidden = false;
    if (els.panel) els.panel.classList.remove("has-lead");
    setLeadModal(true);
    updateLeadModalNav();
    const site = l.website
      ? `<a href="${escapeHtml(l.website)}" target="_blank" rel="noopener">${escapeHtml(l.website)}</a>`
      : "—";
    const osm = l.osmUrl
      ? `<a href="${escapeHtml(l.osmUrl)}" target="_blank" rel="noopener">OpenStreetMap source</a>`
      : "—";
    const emailShown = hideEmail() && l.source === "OSM"
      ? "Hidden (GDPR)"
      : (publishedEmail(l)
          ? `<a href="mailto:${escapeHtml(publishedEmail(l))}" data-contact="1">${escapeHtml(publishedEmail(l))}</a>`
          : dash(l.email));
    const fitLine = l.fitKind === "heuristic" ? `heuristic ${l.fit}` : String(l.fit);
    const pack = scriptPackFor(l);
    const items = scriptItems(pack);
    const prev = els.detail.dataset.leadKey === l.key ? currentOutreachFields().scriptId : "";
    const chosen = items.some((s) => s.id === prev) ? prev : (items[0] && items[0].id) || "";
    const review = escapeHtml(
      (scriptConfig && scriptConfig.reviewNote) ||
        "Custom wording should go through DataEarners platform review before use; one business at a time; stop if asked."
    );
    const options = items
      .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`)
      .join("");
    els.detail.innerHTML = `
      <div class="detail-head">
        <div class="kicker">Selected lead</div>
      </div>
      <h3 id="lead-modal-title">${escapeHtml(l.name)}</h3>
      <div class="meta">${escapeHtml(l.category)} · ${escapeHtml(l.city || "")} · fit ${escapeHtml(fitLine)} · <span class="badge ${l.source === "seed" ? "seed" : "osm"}">${escapeHtml(l.source)}</span></div>
      ${payoutEstimateHtml(l, "card")}
      <p class="contact-line">${dash(l.phone)} · ${emailShown}</p>
      ${leadersBlock(l)}
      <details class="more" open>
        <summary>Address, website, and notes</summary>
        <dl>
          <dt>Address</dt><dd>${dash(l.address)}</dd>
          <dt>Website</dt><dd>${site}</dd>
          <dt>Why</dt><dd>${escapeHtml(l.reason || "")}</dd>
          <dt>OSM</dt><dd>${osm}</dd>
        </dl>
      </details>
      <section class="outreach" id="outreach" data-category="${escapeHtml(pack.id || "generic")}">
        <div class="kicker">Outreach</div>
        <p class="outreach-log-status" id="outreach-log-status" hidden></p>
        <p class="outreach-note">${review}</p>
        <label class="field">Script
          <select id="outreach-script">${options}</select>
        </label>
        <label class="field" id="outreach-subject-field">Subject
          <textarea id="outreach-subject" rows="2" spellcheck="true"></textarea>
        </label>
        <label class="field">Body
          <textarea id="outreach-body" rows="7" spellcheck="true"></textarea>
        </label>
        <div class="outreach-actions">
          <button type="button" class="iv-btn-ghost" id="outreach-copy">Copy</button>
          <div class="mail-open-wrap">
            <button type="button" class="iv-btn" id="outreach-mailto">Open in email</button>
            <button type="button" class="iv-btn-ghost" id="outreach-mail-change">Change</button>
          </div>
        </div>
        <p class="outreach-mail-note" id="outreach-mail-note"></p>
      </section>
    `;
    els.detail.dataset.leadKey = l.key;
    document.documentElement.dataset.outreach = "ready";
    document.documentElement.dataset.outreachCategory = pack.id || "generic";
    document.documentElement.dataset.selectedLead = l.name || l.key;
    applyScriptChoice(l, chosen, false);
  }

  function ensureKeys(list) {
    list.forEach((l) => {
      if (!l.key) l.key = `${l.source || "x"}:${l.osmId || l.name}:${l.lat},${l.lng}`;
    });
    return list;
  }

  function findLeadByQuery(q) {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return null;
    const all = allLeads();
    return (
      all.find((l) => l.key === q) ||
      all.find((l) => (l.name || "").toLowerCase() === s) ||
      all.find((l) => (l.name || "").toLowerCase().includes(s)) ||
      null
    );
  }

  function selectLead(key, fly) {
    selectedLead = allLeads().find((l) => l.key === key) || filtered().find((l) => l.key === key) || findLeadByQuery(key) || null;
    renderList();
    if (selectedLead) {
      const card = els.list.querySelector(`[data-key="${CSS.escape(selectedLead.key)}"]`);
      if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (fly && globe) {
        globe.pointOfView({ lat: selectedLead.lat, lng: selectedLead.lng, altitude: 0.55 }, 800);
      }
    }
  }

  function zoomToRegion(r) {
    if (!globe || !r) return;
    const p = r.properties;
    const b = p.bbox || [p.lng, p.lat, p.lng, p.lat];
    const span = Math.max(b[3] - b[1], (b[2] - b[0]) * Math.cos((p.lat * Math.PI) / 180));
    const altitude = Math.max(0.35, Math.min(2.4, span / 18 + 0.28));
    globe.pointOfView({ lat: p.lat, lng: p.lng, altitude }, 900);
  }

  function paintPolygons() {
    if (!globe) return;
    globe
      .polygonsData(regions)
      .polygonGeoJsonGeometry((d) => d.geometry)
      .polygonCapColor((d) => {
        const outreachDone = window.AzOutreach && window.AzOutreach.isRegionComplete && window.AzOutreach.isRegionComplete(d.properties.id);
        if (heatmapOn) {
          const t = heatT(d.properties.id);
          if (t == null) return outreachDone ? "rgba(246, 194, 107, 0.22)" : "rgba(148, 158, 172, 0.16)";
          if (selectedRegion && d.properties.id === selectedRegion.properties.id) return heatRgba(t, 0.92);
          if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return heatRgba(Math.min(1, t + 0.08), 0.86);
          return heatRgba(t, outreachDone ? 0.82 : 0.72);
        }
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return "rgba(8, 190, 200, 0.42)";
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return "rgba(8, 190, 200, 0.28)";
        if (outreachDone) return "rgba(246, 194, 107, 0.28)";
        return "rgba(8, 116, 201, 0.10)";
      })
      .polygonSideColor(() => (heatmapOn ? "rgba(20, 24, 48, 0.35)" : "rgba(8, 116, 201, 0.12)"))
      .polygonStrokeColor((d) => {
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return "#08BEC8";
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return "#6ff3f0";
        if (window.AzOutreach && window.AzOutreach.isRegionComplete && window.AzOutreach.isRegionComplete(d.properties.id)) return "#f6c26b";
        if (heatmapOn) return heatRaw(d.properties.id) == null ? "rgba(160, 170, 185, 0.28)" : "rgba(8, 12, 28, 0.35)";
        return "rgba(120, 170, 255, 0.28)";
      })
      .polygonAltitude((d) => {
        const outreachDone = window.AzOutreach && window.AzOutreach.isRegionComplete && window.AzOutreach.isRegionComplete(d.properties.id);
        if (heatmapOn) {
          const t = heatT(d.properties.id);
          const base = t == null ? 0.003 : 0.003 + t * 0.016;
          if (selectedRegion && d.properties.id === selectedRegion.properties.id) return base + 0.008;
          if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return base + 0.005;
          return base + (outreachDone ? 0.002 : 0);
        }
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return 0.012;
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return 0.009;
        if (outreachDone) return 0.006;
        return 0.003;
      })
      .polygonLabel((d) => regionLabel(d));
  }

  function selectRegion(id, opts) {
    opts = opts || {};
    const r = regions.find((x) => x.properties.id === id) || null;
    selectedRegion = r;
    selectedLead = null;
    els.region.value = r ? r.properties.id : "";
    if (r) {
      setHint(
        `<b>${escapeHtml(r.properties.name)}.</b> The list is filtered to this region. Seed rows (if any) stay marked seed; OpenStreetMap rows are labelled heuristic.`,
        "Tap another region on the globe, or use Back to globe."
      );
      zoomToRegion(r);
      if (!opts.skipStatic) {
        loadStaticRegion(r);
      } else if (r.properties.allowOverpass === false) {
        setStatus("This region is not included in the prebuilt OpenStreetMap extracts. Seed rows still show if any are in this region.", "muted");
        document.documentElement.dataset.osm = "skipped";
        showLiveSearch(false);
      }
    } else {
      setHint(
        "<b>Click a state, province, or European country</b> to zoom in and open a prebuilt list of matching OpenStreetMap businesses. You can optionally search live OpenStreetMap for more. Seed pins for Arizona are city-level, not rooftop-accurate.",
        "Tap a state, province, or country to open its business list."
      );
      setStatus("");
      showRetry(false);
      showMore(false);
      showLiveSearch(false);
      document.documentElement.dataset.osm = "idle";
      if (globe && !opts.silent) globe.pointOfView({ lat: 33.45, lng: -112.07, altitude: 0.95 }, 800);
    }
    paintPolygons();
    renderList();
    if (window.AzOutreach && window.AzOutreach.syncRegion) {
      window.AzOutreach.syncRegion(r ? r.properties.id : "");
    }
    return r;
  }

  function showLiveSearch(show) {
    if (els.live) els.live.hidden = !show;
  }

  async function loadStaticRegion(region) {
    const id = region.properties.id;
    const gen = ++queryGen;
    document.documentElement.dataset.osm = "loading";
    showRetry(false);
    showMore(false);
    showLiveSearch(false);
    setStatus("Loading prebuilt OpenStreetMap businesses for this region…", "loading");
    openListPanel();
    renderList();
    try {
      const res = await fetch("data/regions/" + encodeURIComponent(id) + ".json");
      if (gen !== queryGen) return;
      if (res.status === 404) {
        if (!osmByRegion[id]) osmByRegion[id] = [];
        if (region.properties.allowOverpass === false) {
          setStatus(
            "This region is not included in the prebuilt OpenStreetMap extracts. Seed rows still show if any are in this region.",
            "muted"
          );
          document.documentElement.dataset.osm = "skipped";
          showLiveSearch(false);
        } else {
          setStatus(
            "No prebuilt list for this region yet. You can search live OpenStreetMap for businesses, or check back after the next extract.",
            "muted"
          );
          document.documentElement.dataset.osm = "missing";
          showLiveSearch(true);
        }
        renderList();
        return;
      }
      if (!res.ok) throw new Error("Could not load prebuilt list (" + res.status + ")");
      const data = await res.json();
      if (gen !== queryGen) return;
      const leads = ensureKeys(data.leads || []);
      osmByRegion[id] = leads;
      const total = data.totalMatched != null ? data.totalMatched : leads.length;
      const capNote =
        data.capped && total > leads.length ? " (top " + leads.length + " of " + total + " matches by fit)" : "";
      setStatus(
        leads.length
          ? "Loaded " + leads.length + " OpenStreetMap businesses from a prebuilt extract" + capNote + "."
          : "No OpenStreetMap businesses matched in this region for the enabled categories."
      );
      document.documentElement.dataset.osm = "ok";
      document.documentElement.dataset.staticCount = String(leads.length);
      showLiveSearch(region.properties.allowOverpass !== false);
      showRetry(false);
      showMore(false);
      renderList();
    } catch (err) {
      if (gen !== queryGen) return;
      if (!osmByRegion[id]) osmByRegion[id] = [];
      const why = err && err.message ? " (" + err.message + ")" : "";
      setStatus("Could not load the prebuilt list" + why + ". You can try searching live OpenStreetMap.", "error");
      document.documentElement.dataset.osm = "error";
      showLiveSearch(region.properties.allowOverpass !== false);
      showRetry(false);
      renderList();
    }
  }

    function cacheKey(regionId) {
    return CACHE_PREFIX + regionId + ":" + categoryHash();
  }

  function readCache(regionId) {
    try {
      const raw = localStorage.getItem(cacheKey(regionId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      // v2 caches must be marked ok. Never reuse a failure or a malformed entry.
      if (!data || data.ok !== true || !Array.isArray(data.leads)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(regionId, leads, prog) {
    try {
      localStorage.setItem(
        cacheKey(regionId),
        JSON.stringify({
          ok: true,
          ts: Date.now(),
          regionId,
          leads,
          nextCat: prog && prog.nextCat,
          moreAvailable: !!(prog && prog.moreAvailable),
          capped: !!(prog && prog.capped),
        })
      );
    } catch (e) {
      /* quota — ignore */
    }
  }

  function clearCache(regionId) {
    try {
      localStorage.removeItem(cacheKey(regionId));
    } catch (e) {
      /* ignore */
    }
  }

  function showRetry(show) {
    if (!els.retry) return;
    els.retry.hidden = !show;
  }

  function showMore(show) {
    if (!els.more) return;
    els.more.hidden = !show;
  }

  function areaSetQL(region) {
    const p = region.properties;
    const tag = String(p.overpassAreaTag || "ISO3166-1").replace(/"/g, "");
    const val = String(p.overpassAreaValue || p.id).replace(/"/g, "");
    // US states and Canadian provinces are admin_level 4; European countries are 2.
    const admin = tag === "ISO3166-2" ? '["admin_level"="4"]' : tag === "ISO3166-1" ? '["admin_level"="2"]' : "";
    // Prefer the admin-level match, but also accept a plain ISO match if admin_level is missing.
    return `(
  area["${tag}"="${val}"]${admin};
  area["${tag}"="${val}"];
)->.a;`;
  }

  function regionSpanDeg(region) {
    const b = (region && region.properties && region.properties.bbox) || [];
    if (b.length < 4) return 0;
    return Math.abs(Number(b[2]) - Number(b[0])) * Math.abs(Number(b[3]) - Number(b[1]));
  }

  function firstWavePlan(region) {
    const span = regionSpanDeg(region);
    // Large states/provinces/countries (TX, CA, ON, DE, FR, etc.) get a tighter first wave
    // so something lands in the list before Overpass times out.
    if (span > 80) return { catCap: 20, waveCap: 80, budgetMs: 35000, timeoutSec: 18 };
    if (span > 20) return { catCap: 25, waveCap: 120, budgetMs: 40000, timeoutSec: 20 };
    return { catCap: 40, waveCap: 200, budgetMs: 45000, timeoutSec: 20 };
  }

  function buildOverpassQuery(region, category, cap, timeoutSec) {
    const timeout = timeoutSec || categoryConfig.overpassTimeoutSec || 20;
    const lines = (category.queries || []).map((q) => {
      const k = String(q.key).replace(/"/g, "");
      const v = String(q.value).replace(/"/g, "");
      return `  nwr["${k}"="${v}"](area.a);`;
    });
    return `[out:json][timeout:${timeout}];
${areaSetQL(region)}
(
${lines.join("\n")}
);
out center tags ${cap};`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function usableEndpoints() {
    const now = Date.now();
    return OVERPASS_ENDPOINTS.filter((u) => !endpointHealth[u] || endpointHealth[u].until < now);
  }

  function markEndpoint(url, ok) {
    if (ok) {
      delete endpointHealth[url];
      return;
    }
    const prev = (endpointHealth[url] && endpointHealth[url].fails) || 0;
    endpointHealth[url] = { fails: prev + 1, until: Date.now() + Math.min(120000, 20000 * (prev + 1)) };
  }

  async function fetchOverpass(query, opts) {
    opts = opts || {};
    let lastErr = null;
    const timeoutMs = opts.timeoutMs || (categoryConfig.overpassTimeoutSec || 20) * 1000 + 5000;
    const endpoints = usableEndpoints();
    const maxAttempts = Math.min(opts.maxAttempts || endpoints.length, endpoints.length);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = endpoints[attempt];
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          body: query,
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
          lastErr = new Error("Overpass " + res.status + " from " + url);
          markEndpoint(url, false);
          await sleep(Math.min(4000, 800 * Math.pow(2, attempt)));
          continue;
        }
        if (!res.ok) throw new Error("Overpass HTTP " + res.status + " from " + url);
        const data = await res.json();
        const remark = data && data.remark ? String(data.remark) : "";
        const timedOut = /timeout|out of memory|error/i.test(remark);
        if (timedOut && !(data.elements && data.elements.length)) {
          lastErr = new Error("Overpass remark: " + remark);
          await sleep(Math.min(8000, 1200 * Math.pow(2, attempt)));
          continue;
        }
        if (timedOut) data._partial = remark;
        markEndpoint(url, true);
        return data;
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
        markEndpoint(url, false);
        await sleep(Math.min(4000, 800 * Math.pow(2, attempt)));
      }
    }
    if (!endpoints.length) {
      throw lastErr || new Error("All Overpass mirrors recently failed; try Retry in a moment");
    }
    throw lastErr || new Error("Overpass request failed");
  }

  function matchCategory(tags) {
    const cats = enabledCategories();
    for (const cat of cats) {
      for (const q of cat.queries || []) {
        if (tags[q.key] === q.value) return cat;
      }
    }
    return null;
  }

  function formatAddress(tags) {
    const parts = [
      [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
      tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
      tags["addr:state"],
      tags["addr:postcode"],
    ].filter(Boolean);
    return parts.join(", ");
  }

  function heuristicFit(base, tags) {
    let fit = Number(base) || 3;
    const hasSite = !!(tags.website || tags["contact:website"] || tags.url);
    const hasPhone = !!(tags.phone || tags["contact:phone"]);
    const hasName = !!tags.name;
    if (!hasName) fit -= 1;
    if (!hasSite && !hasPhone) fit -= 1;
    if (hasSite && hasPhone && hasName) fit = Math.min(5, fit + 0);
    return Math.max(1, Math.min(5, fit));
  }

  function osmToLeads(elements, region) {
    const cap = categoryConfig.resultCap || RESULT_CAP;
    const hide = region.properties.privacy === "eu";
    const out = [];
    const seen = new Set();
    for (const el of elements || []) {
      const tags = el.tags || {};
      const cat = matchCategory(tags);
      if (!cat) continue;
      const lat = el.lat || (el.center && el.center.lat);
      const lng = el.lon || (el.center && el.center.lon);
      if (lat == null || lng == null) continue;
      const name = tags.name || tags.operator || tags.brand;
      if (!name) continue;
      const id = `${el.type}/${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const phone = tags.phone || tags["contact:phone"] || "";
      const email = hide ? "" : tags.email || tags["contact:email"] || "";
      const website = tags.website || tags["contact:website"] || tags.url || "";
      const fit = heuristicFit(cat.baseFit, tags);
      const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || region.properties.name;
      out.push({
        key: "OSM:" + id,
        name,
        category: cat.label,
        city,
        website,
        phone,
        email,
        address: formatAddress(tags),
        fit,
        fitKind: "heuristic",
        reason: `Heuristic fit ${fit} based on OSM tags for ${cat.label.toLowerCase()}. Not a Mode or DataEarners decision.`,
        source: "OSM",
        osmUrl: "https://www.openstreetmap.org/" + id,
        osmId: id,
        regionId: region.properties.id,
        lat,
        lng,
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  function applyProgress(region, collected, prog) {
    const id = region.properties.id;
    osmByRegion[id] = collected;
    osmProgress[id] = prog;
    if (selectedRegion && selectedRegion.properties.id === id) {
      document.documentElement.dataset.osmMore = prog && prog.moreAvailable ? "yes" : "no";
      showMore(!!(prog && prog.moreAvailable));
      renderList();
    }
  }

  async function requestOsm(region, opts) {
    opts = opts || {};
    const id = region.properties.id;
    if (opts.force) {
      clearCache(id);
      delete osmProgress[id];
      osmByRegion[id] = [];
    }
    // Live "search for more" always hits Overpass and appends onto the prebuilt list.
    const cached = opts.force || opts.more || opts.live ? null : readCache(id);
    if (cached && !osmByRegion[id]) {
      osmByRegion[id] = ensureKeys(cached.leads);
      const more = !!cached.moreAvailable;
      osmProgress[id] = {
        nextCat: cached.nextCat || enabledCategories().length,
        moreAvailable: more,
        capped: !!cached.capped,
      };
      setStatus(
        cached.leads.length
          ? `Loaded ${cached.leads.length} OpenStreetMap rows from cache.` +
            (more ? " More results are available." : "")
          : "No OpenStreetMap businesses were cached for this region.",
        "muted"
      );
      document.documentElement.dataset.osm = "cached";
      showRetry(true);
      showMore(more);
      document.documentElement.dataset.osmMore = more ? "yes" : "no";
      renderList();
      return;
    }
    if (queryInFlight) {
      queuedRegionId = id;
      queuedForce = !!opts.force;
      queuedMore = !!opts.more;
      queryGen += 1; // stop the in-flight region at the next category boundary
      setStatus("Waiting for the previous OpenStreetMap query to finish…", "muted");
      return;
    }
    const gen = ++queryGen;
    queryInFlight = true;
    const cap = categoryConfig.resultCap || RESULT_CAP;
    const cats = enabledCategories();
    const plan = firstWavePlan(region);
    const prog0 = osmProgress[id] || { nextCat: 0, moreAvailable: false, capped: false };
    const startCat = opts.more ? prog0.nextCat || 0 : 0;
    const collected = (opts.more || opts.live) && osmByRegion[id] ? osmByRegion[id].slice() : [];
    const seen = new Set(collected.map((l) => l.osmId || l.key));
    const waveCap = opts.more ? cap : Math.min(cap, plan.waveCap);
    const catCap = plan.catCap;
    const budgetMs = opts.more ? 60000 : plan.budgetMs;
    const started = Date.now();
    let failures = 0;
    let lastErr = null;
    let partial = false;
    let stoppedForBudget = false;
    document.documentElement.dataset.osm = "loading";
    showRetry(false);
    if (!opts.more) showMore(false);
    setStatus(
      startCat
        ? "Loading more OpenStreetMap businesses…"
        : opts.live
          ? "Searching live OpenStreetMap for more businesses…"
          : "Querying OpenStreetMap (Overpass) for this region…",
      "loading"
    );
    renderList();
    try {
      let i = startCat;
      for (; i < cats.length; i++) {
        if (collected.length >= waveCap) {
          stoppedForBudget = collected.length >= cap ? false : true;
          break;
        }
        if (gen !== queryGen) break;
        if (Date.now() - started > budgetMs) {
          stoppedForBudget = true;
          break;
        }
        const cat = cats[i];
        setStatus(
          `Querying OpenStreetMap (${i + 1} of ${cats.length}: ${cat.label})… ${collected.length} so far.`,
          "loading"
        );
        try {
          const remain = Math.min(catCap, waveCap - collected.length);
          const data = await fetchOverpass(
            buildOverpassQuery(region, cat, remain, plan.timeoutSec),
            { timeoutMs: plan.timeoutSec * 1000 + 5000, maxAttempts: 2 }
          );
          if (data && data._partial) partial = true;
          const leads = osmToLeads(data.elements || [], region);
          let added = 0;
          leads.forEach((l) => {
            const k = l.osmId || l.key;
            if (seen.has(k)) return;
            seen.add(k);
            collected.push(l);
            added += 1;
          });
          if (added && data.elements && data.elements.length >= remain) partial = true;
          // Show results as they arrive so the list fills right away.
          applyProgress(region, collected, {
            nextCat: i + 1,
            moreAvailable: i + 1 < cats.length || collected.length >= waveCap,
            capped: collected.length >= cap,
          });
        } catch (err) {
          failures += 1;
          lastErr = err;
          if (!collected.length && failures >= 2) break;
        }
      }
      if (stoppedForBudget && !collected.length && !failures) {
        failures = 1;
        lastErr = lastErr || new Error("Overpass first wave timed out before any results arrived");
      }
      const reallyMore = i < cats.length && collected.length < cap;
      const prog = {
        nextCat: i,
        moreAvailable: reallyMore,
        capped: collected.length >= cap,
      };
      osmProgress[id] = prog;
      osmByRegion[id] = collected;
      if (collected.length) {
        writeCache(id, collected, prog);
        if (selectedRegion && selectedRegion.properties.id === id) {
          const bits = [];
          if (prog.capped) bits.push(`capped at ${cap}`);
          else if (prog.moreAvailable) bits.push("more available");
          if (failures) bits.push(`${failures} categor${failures === 1 ? "y" : "ies"} failed`);
          setStatus(
            `Loaded ${collected.length} OpenStreetMap businesses` +
              (bits.length ? " (" + bits.join("; ") + ")" : "") +
              "."
          );
          document.documentElement.dataset.osm = "ok";
          document.documentElement.dataset.osmMore = prog.moreAvailable ? "yes" : "no";
          showRetry(!!failures);
          showMore(!!prog.moreAvailable);
          showLiveSearch(region.properties.allowOverpass !== false && !prog.moreAvailable);
          renderList();
        }
      } else if (failures) {
        if (selectedRegion && selectedRegion.properties.id === id) {
          const why = lastErr && lastErr.message ? " (" + lastErr.message + ")" : "";
          setStatus(
            "OpenStreetMap query failed or timed out" +
              why +
              ". Seed rows still show if any are in this region. Use Retry, or try again in a moment.",
            "error"
          );
          document.documentElement.dataset.osm = "error";
          showRetry(true);
          showMore(false);
          renderList();
        }
      } else {
        writeCache(id, [], { nextCat: cats.length, moreAvailable: false, capped: false });
        if (selectedRegion && selectedRegion.properties.id === id) {
          setStatus("No OpenStreetMap businesses matched in this region for the enabled categories.");
          document.documentElement.dataset.osm = "ok";
          showRetry(true);
          showMore(false);
          renderList();
        }
      }
    } finally {
      queryInFlight = false;
      if (queuedRegionId) {
        const next = queuedRegionId;
        const forceNext = queuedForce;
        const moreNext = queuedMore;
        queuedRegionId = null;
        queuedForce = false;
        queuedMore = false;
        const r = regions.find((x) => x.properties.id === next);
        if (r) requestOsm(r, { force: forceNext, more: moreNext });
      }
    }
  }

  function exportCsv() {
    const rows = filtered();
    const cols = [
      "company_name",
      "category",
      "city",
      "website",
      "phone",
      "email",
      "address",
      "fit_score",
      "fit_kind",
      "fit_reason",
      "source",
      "osm_url",
      "region_id",
    ];
    const hide = hideEmail();
    function cell(v) {
      const s = v == null ? "" : String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    const lines = [cols.join(",")];
    rows.forEach((l) => {
      const email = hide && l.source === "OSM" ? "" : l.email || "";
      lines.push(
        [
          l.name,
          l.category,
          l.city,
          l.website,
          l.phone,
          email,
          l.address,
          l.fit,
          l.fitKind,
          l.reason,
          l.source,
          l.osmUrl || "",
          l.regionId || (selectedRegion && selectedRegion.properties.id) || "",
        ]
          .map(cell)
          .join(",")
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lead-globe-visible.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function pinEl(d) {
    const wrap = document.createElement("div");
    wrap.className =
      "pin" +
      (d.source === "OSM" ? " source-osm" : " source-seed") +
      (selectedLead && selectedLead.key === d.key ? " is-on" : "");
    wrap.style.color = fitColor(d.fit);
    wrap.innerHTML = `<div class="dot"></div><span class="label">${escapeHtml(d.name)}</span>`;
    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectLead(d.key, true);
    });
    return wrap;
  }

  function bindMobileChrome() {
    applyBannerPref();
    if (els.bannerDismiss) {
      els.bannerDismiss.addEventListener("click", () => {
        try {
          localStorage.setItem(BANNER_KEY, "collapsed");
        } catch (e) {}
        applyBannerPref();
        sizeGlobe();
      });
    }
    if (els.panelBack) {
      els.panelBack.addEventListener("click", () => closeListPanel());
    }
    if (els.listToggle) {
      els.listToggle.addEventListener("click", () => openListPanel());
    }
    if (els.keyToggle) {
      els.keyToggle.addEventListener("click", () => {
        setKeysOpen(!document.body.classList.contains("keys-open"));
      });
    }
    if (els.filtersToggle) {
      els.filtersToggle.addEventListener("click", () => {
        const open = !(els.filters && els.filters.classList.contains("is-open"));
        setFiltersOpen(open);
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!isMobileUi()) return;
      if (selectedLead) {
        selectLead(null, false);
        return;
      }
      if (els.panel && els.panel.classList.contains("is-open")) {
        closeListPanel();
        return;
      }
      if (document.body.classList.contains("keys-open")) setKeysOpen(false);
    });
    window.addEventListener("resize", () => {
      applyBannerPref();
      if (!isMobileUi()) {
        document.body.classList.remove("sheet-open");
        setKeysOpen(false);
        if (els.filters) els.filters.classList.add("is-open");
      } else if (els.filters && !els.filters.classList.contains("is-open")) {
        setFiltersOpen(false);
      }
    });
  }

    function sizeGlobe() {
    if (!globe) return;
    const r = els.globe.getBoundingClientRect();
    globe.width(Math.max(320, r.width)).height(Math.max(280, r.height));
  }

  function altitudeForSpan(span) {
    return Math.max(0.35, Math.min(2.4, span / 18 + 0.28));
  }

  els.list.addEventListener("click", (e) => {
    if (e.target.closest("a[data-contact], a[href]")) return;
    const card = e.target.closest("[data-key]");
    if (card) selectLead(card.getAttribute("data-key"), true);
  });
  els.list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("a[href]")) return;
    const card = e.target.closest("[data-key]");
    if (card) {
      e.preventDefault();
      selectLead(card.getAttribute("data-key"), true);
    }
  });
  function closeLeadModal() {
    selectLead(null, false);
  }

  function stepLead(dir) {
    const n = leadNeighbors();
    const next = dir < 0 ? n.prev : n.next;
    if (next) selectLead(next.key, false);
  }

  if (els.leadBackdrop) {
    els.leadBackdrop.addEventListener("click", (e) => {
      e.preventDefault();
      closeLeadModal();
    });
  }
  if (els.leadClose) {
    els.leadClose.addEventListener("click", (e) => {
      e.preventDefault();
      closeLeadModal();
    });
  }
  if (els.leadPrev) els.leadPrev.addEventListener("click", (e) => { e.preventDefault(); stepLead(-1); });
  if (els.leadNext) els.leadNext.addEventListener("click", (e) => { e.preventDefault(); stepLead(1); });
  document.addEventListener("keydown", (e) => {
    if (!els.leadModal || els.leadModal.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeLeadModal();
      return;
    }
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); stepLead(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); stepLead(1); }
  });

  els.detail.addEventListener("change", (e) => {
    if (e.target && e.target.id === "outreach-script" && selectedLead) {
      applyScriptChoice(selectedLead, e.target.value, false);
    }
  });
  els.detail.addEventListener("input", (e) => {
    if (!selectedLead) return;
    if (e.target && (e.target.id === "outreach-subject" || e.target.id === "outreach-body")) {
      syncMailtoLink(selectedLead);
    }
  });
  els.detail.addEventListener("click", (e) => {
    if (e.target && (e.target.id === "detail-close" || e.target.closest("#detail-close"))) {
      e.preventDefault();
      selectLead(null, false);
      return;
    }
    if (e.target && e.target.id === "outreach-copy") {
      e.preventDefault();
      copyOutreach();
      return;
    }
    const mail = e.target.closest && e.target.closest("#outreach-mailto, #outreach-mail-change");
    if (mail) {
      e.preventDefault();
      if (mail.getAttribute("aria-disabled") === "true" || mail.disabled) return;
      if (!selectedLead || !window.MailChooser) return;
      const email = publishedEmail(selectedLead);
      const isChange = mail.id === "outreach-mail-change";
      if (usesOutreachDraft(selectedLead) && window.AzOutreach && AzOutreach.openLeadMail) {
        AzOutreach.openLeadMail(selectedLead, {
          source: "card",
          mode: isChange ? "change" : "use",
        });
        return;
      }
      const fields = currentOutreachFields();
      const pack = scriptItems(scriptPackFor(selectedLead)).find((s) => s.id === fields.scriptId);
      if (pack && pack.kind === "call") return;
      const payload = { to: email, subject: fields.subject, body: fields.body };
      const opts = { onCopy: () => copyOutreach() };
      const pref = MailChooser.getPreferred && MailChooser.getPreferred();
      if (!isChange && pref) MailChooser.launch(pref, payload, opts);
      else MailChooser.open(payload, opts);
    }
  });
  document.addEventListener("leadglobe:mail-provider", () => {
    if (selectedLead) syncMailtoLink(selectedLead);
  });
  document.addEventListener("leadglobe:outreach-log", () => {
    if (selectedLead) syncMailtoLink(selectedLead);
  });
  installMailtoHook();
  els.q.addEventListener("input", renderList);
  els.cat.addEventListener("change", renderList);
  els.sort.addEventListener("change", renderList);
  els.minFit.addEventListener("change", renderList);
  els.region.addEventListener("change", () => selectRegion(els.region.value || null));
  els.exportBtn.addEventListener("click", exportCsv);
  if (els.retry) {
    els.retry.addEventListener("click", () => {
      if (selectedRegion) requestOsm(selectedRegion, { force: true });
    });
  }
  if (els.more) {
    els.more.addEventListener("click", () => {
      if (selectedRegion) requestOsm(selectedRegion, { more: true });
    });
  }
  if (els.live) {
    els.live.addEventListener("click", () => {
      if (selectedRegion) requestOsm(selectedRegion, { live: true });
    });
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  async function init() {
    ensureKeys(seedLeads);
    try {
      const [catCfg, regionCfg, scriptCfg, leadersDoc, manifestDoc, payoutCfg] = await Promise.all([
        loadJson("config/categories.json"),
        loadJson("config/regions.json"),
        loadJson("config/scripts.json").catch(() => ({ categories: {}, inviteUrl: INVITE })),
        loadJson("data/leaders.json").catch(() => ({ leaders: {} })),
        loadJson("data/regions/manifest.json").catch(() => ({})),
        loadJson("config/payout-tiers.json?v=payout1").catch(() => null),
      ]);
      applyHeatManifest(manifestDoc);
      leadersById = (leadersDoc && leadersDoc.leaders) || {};
      document.documentElement.dataset.leadersLoaded = String(Object.keys(leadersById).length);
      categoryConfig = catCfg;
      scriptConfig = scriptCfg || scriptConfig;
      payoutConfig = payoutCfg || payoutConfig;
      document.documentElement.dataset.payoutTiers = payoutConfigReady() ? "ready" : "missing";
      if (scriptConfig.inviteUrl) {
        // Keep the in-app CTA aligned with the scripts file.
      }
      regionSets = regionCfg.sets || [];
      const collections = await Promise.all(
        regionSets.map(async (set) => {
          const fc = await loadJson(set.geojson);
          return (fc.features || []).map((f) => {
            f.setMeta = set;
            if (set.hideEmail) f.properties.privacy = f.properties.privacy || "eu";
            return f;
          });
        })
      );
      regions = collections.flat();
    } catch (err) {
      setStatus("Could not load region or category config.", "error");
      regions = [];
    }

    fillCategorySelect();
    fillRegionSelect();
    setHeatmap(heatmapOn);
    if (els.heatToggle) {
      els.heatToggle.addEventListener("click", () => setHeatmap(!heatmapOn));
    }
    bindMobileChrome();

    if (typeof Globe === "function") {
      globe = Globe()(els.globe)
        .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-night.jpg")
        .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
        .backgroundColor("#04182e")
        .atmosphereColor("#08BEC8")
        .atmosphereAltitude(0.22)
        .showGlobe(true)
        .showAtmosphere(true)
        .htmlElementsData([])
        .htmlLat((d) => d.lat)
        .htmlLng((d) => d.lng)
        .htmlElement(pinEl)
        .htmlAltitude(0.01)
        .onPolygonHover((d) => {
          if (isTouchUi()) return;
          hoveredRegion = d || null;
          paintPolygons();
        })
        .onPolygonClick((d) => {
          if (d) selectRegion(d.properties.id);
        })
        .pointOfView({ lat: 33.45, lng: -112.07, altitude: 0.95 }, 0);
      const mat = globe.globeMaterial && globe.globeMaterial();
      if (mat) {
        if (mat.emissive && mat.emissive.set) mat.emissive.set("#04182e");
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.25;
        if ("shininess" in mat) mat.shininess = 8;
      }
      paintPolygons();
      sizeGlobe();
      window.addEventListener("resize", sizeGlobe);
      // Keep the canvas matched to the stage when the side panel changes width.
      if ("ResizeObserver" in window) {
        let ro = 0;
        new ResizeObserver(() => { cancelAnimationFrame(ro); ro = requestAnimationFrame(sizeGlobe); }).observe(els.globe);
      }
    }

    renderList();
    document.documentElement.dataset.globe = globe ? "ready" : "error";

    window.LeadGlobe = {
      ready: true,
      setHeatmap: (on) => setHeatmap(on),
      heatmapOn: () => heatmapOn,
      heatValue: (id) => heatRaw(id),
      selectRegion: (id, opts) => selectRegion(id, opts),
      refreshPolygons: () => paintPolygons(),
      closeLeadModal: () => selectLead(null, false),
      getRegionName: (id) => {
        const r = regions.find((x) => x.properties.id === id);
        return r && r.properties.name ? r.properties.name : id;
      },
      closePanel: () => closeListPanel(),
      panelOpen: () => !!(els.panel && els.panel.classList.contains("is-open")),
      pointOfView: () => (globe && globe.pointOfView ? globe.pointOfView() : null),
      selectLead: (key, fly) => selectLead(key, fly),
      findLead: (q) => findLeadByQuery(q),
      getVisible: () => filtered(),
      getRegions: () => regions.map((r) => r.properties),
      getSelected: () => selectedLead,
      payoutTierFor: (lead) => payoutTierFor(lead),
      formatPayout: (n) => formatPayout(n),
      requestOsm: (id, force) => {
        const r = regions.find((x) => x.properties.id === id) || selectedRegion;
        if (r) return requestOsm(r, { force: !!force });
      },
      buildOverpassQuery: (id, catId) => {
        const r = regions.find((x) => x.properties.id === id);
        const cat = enabledCategories().find((c) => c.id === catId) || enabledCategories()[0];
        return r && cat ? buildOverpassQuery(r, cat, 50) : "";
      },
    };

    const params = new URLSearchParams(location.search);
    const auto = params.get("region") || params.get("shot");
    const leadQ = params.get("lead");
    const outreachShot = (params.get("shot") || "").toLowerCase() === "outreach";
    if (auto && auto !== "overview" && auto !== "outreach") {
      const id =
        auto.toLowerCase() === "arizona"
          ? "US-AZ"
          : auto.toLowerCase() === "delaware"
            ? "US-DE"
            : auto.toLowerCase() === "luxembourg"
              ? "LU"
              : auto;
      // Delay so the globe can finish its first render
      setTimeout(() => {
        selectRegion(id);
        if (leadQ) {
          setTimeout(() => {
            const found = findLeadByQuery(leadQ);
            if (found) selectLead(found.key, true);
          }, 500);
        }
      }, 400);
    } else if (outreachShot || leadQ) {
      setTimeout(() => {
        selectRegion("US-AZ", { skipOsm: outreachShot });
        setTimeout(() => {
          const found =
            findLeadByQuery(leadQ || "Televerde") ||
            allLeads().find((l) => publishedEmail(l)) ||
            allLeads()[0];
          if (found) selectLead(found.key, true);
        }, 500);
      }, 400);
    }
  }

  init().catch((err) => {
    setStatus("Startup failed: " + (err && err.message ? err.message : err), "error");
  });
})();
