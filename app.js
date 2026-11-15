(function () {
  const INVITE = "https://robertwalker.dataearns.com/invite";
  const OSM_ATTRIB =
    'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>.';
  const NE_ATTRIB =
    'Boundaries: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> (public domain).';
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
  ];
  const CACHE_PREFIX = "leadglobe:osm:v1:";
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
    globe: document.getElementById("globe"),
    hint: document.getElementById("globe-hint"),
    exportBtn: document.getElementById("export-btn"),
  };

  let categoryConfig = { categories: [], resultCap: RESULT_CAP, overpassTimeoutSec: 25 };
  let scriptConfig = { categories: {}, inviteUrl: INVITE, reviewNote: "" };
  let regionSets = [];
  let regions = []; // feature-like {properties, geometry}
  let osmByRegion = {}; // regionId -> leads[]
  let selectedLead = null;
  let selectedRegion = null;
  let hoveredRegion = null;
  let globe = null;
  let queryGen = 0;
  let queryInFlight = false;
  let queuedRegionId = null;

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

  function filtered() {
    const needle = els.q.value.trim().toLowerCase();
    const cat = els.cat.value;
    const sort = els.sort.value;
    const minFit = Number(els.minFit.value || 1);
    const rows = allLeads().filter((l) => {
      if (Number(l.fit) < minFit) return false;
      if (cat !== "All" && l.category !== cat) return false;
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
    const rows = filtered();
    const total = allLeads().length;
    const place = selectedRegion ? selectedRegion.properties.name : "the seed list";
    els.count.textContent = `Showing ${rows.length} of ${total} in ${place}.`;
    els.gdpr.hidden = !hideEmail();
    if (!rows.length) {
      els.list.innerHTML = '<p class="empty">No leads match those filters.</p>';
    } else {
      els.list.innerHTML = rows
        .map((l) => {
          const on = selectedLead && selectedLead.key === l.key ? " is-on" : "";
          const heuristic = l.fitKind === "heuristic" ? '<span class="kind">heuristic</span>' : "";
          return `<button type="button" class="card${on}" data-key="${escapeHtml(l.key)}">
            <div class="card-top">
              <h2>${escapeHtml(l.name)}</h2>
              <span class="fit f${Math.min(5, Math.max(1, l.fit))}">FIT ${l.fit}${heuristic}</span>
            </div>
            <div class="meta">${escapeHtml(l.category)} · ${escapeHtml(l.city || l.properties?.name || "")} · <span class="badge ${l.source === "seed" ? "seed" : "osm"}">${escapeHtml(l.source)}</span></div>
            <div class="reason">${escapeHtml(l.reason || "")}</div>
          </button>`;
        })
        .join("");
    }
    renderDetail();
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
    ];
    for (const [re, id] of rules) {
      if (re.test(lower) && packs[id]) return packs[id];
    }
    return packs.generic || { id: "generic", label: "General", emails: [], calls: [] };
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

  function syncMailtoLink(lead) {
    const email = publishedEmail(lead);
    const a = document.getElementById("outreach-mailto");
    const note = document.getElementById("outreach-mail-note");
    const fields = currentOutreachFields();
    const item = scriptItems(scriptPackFor(lead)).find((s) => s.id === fields.scriptId);
    const isCall = !!(item && item.kind === "call");
    if (!a) return;
    if (isCall) {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.classList.add("is-disabled");
      if (note) {
        note.hidden = false;
        note.textContent =
          "This is a call script. Copy it, or switch to an email variation to open a single-recipient draft in your own mail client.";
      }
      document.documentElement.dataset.outreachMailto = "no";
      return;
    }
    if (!email) {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.classList.add("is-disabled");
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
    a.href = buildMailto(email, fields.subject, fields.body);
    a.removeAttribute("aria-disabled");
    a.classList.remove("is-disabled");
    if (note) {
      note.hidden = false;
      note.textContent =
        "Open in email creates a single-recipient draft to " +
        email +
        " in your own mail client. Review it and press Send yourself. This tool never sends mail, and it will not BCC or message more than one address.";
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

  function renderDetail() {
    const l = selectedLead;
    if (!l) {
      els.detail.hidden = true;
      els.detail.innerHTML = "";
      if (els.detail.closest(".panel")) els.detail.closest(".panel").classList.remove("has-lead");
      els.detail.dataset.leadKey = "";
      document.documentElement.dataset.outreach = "hidden";
      document.documentElement.dataset.outreachCategory = "";
      document.documentElement.dataset.outreachMailto = "";
      document.documentElement.dataset.selectedLead = "";
      return;
    }
    els.detail.hidden = false;
    if (els.detail.closest(".panel")) els.detail.closest(".panel").classList.add("has-lead");
    const site = l.website
      ? `<a href="${escapeHtml(l.website)}" target="_blank" rel="noopener">${escapeHtml(l.website)}</a>`
      : "—";
    const osm = l.osmUrl
      ? `<a href="${escapeHtml(l.osmUrl)}" target="_blank" rel="noopener">OpenStreetMap source</a>`
      : "—";
    const emailShown = hideEmail() && l.source === "OSM" ? "Hidden (GDPR)" : dash(l.email);
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
        <button type="button" class="iv-btn-ghost detail-close" id="detail-close">Back to list</button>
      </div>
      <h3>${escapeHtml(l.name)}</h3>
      <div class="meta">${escapeHtml(l.category)} · ${escapeHtml(l.city || "")} · fit ${escapeHtml(fitLine)} · <span class="badge ${l.source === "seed" ? "seed" : "osm"}">${escapeHtml(l.source)}</span></div>
      <p class="contact-line">${dash(l.phone)} · ${emailShown}</p>
      <details class="more">
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
          <a class="iv-btn" id="outreach-mailto">Open in email</a>
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
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return "rgba(8, 190, 200, 0.42)";
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return "rgba(8, 190, 200, 0.28)";
        return "rgba(8, 116, 201, 0.10)";
      })
      .polygonSideColor(() => "rgba(8, 116, 201, 0.12)")
      .polygonStrokeColor((d) => {
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return "#08BEC8";
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return "#6ff3f0";
        return "rgba(120, 170, 255, 0.28)";
      })
      .polygonAltitude((d) => {
        if (selectedRegion && d.properties.id === selectedRegion.properties.id) return 0.012;
        if (hoveredRegion && d.properties.id === hoveredRegion.properties.id) return 0.009;
        return 0.003;
      })
      .polygonLabel((d) => d.properties.name);
  }

  function selectRegion(id, opts) {
    opts = opts || {};
    const r = regions.find((x) => x.properties.id === id) || null;
    selectedRegion = r;
    selectedLead = null;
    els.region.value = r ? r.properties.id : "";
    if (r) {
      els.hint.innerHTML = `<b>${escapeHtml(r.properties.name)}.</b> The list is filtered to this region. Seed rows (if any) stay marked seed; OpenStreetMap rows are labelled heuristic.`;
      zoomToRegion(r);
      if (r.properties.allowOverpass === false) {
        setStatus("This region is too large for a useful live OpenStreetMap query. Seed rows still show if any are in this region.", "muted");
        document.documentElement.dataset.osm = "skipped";
      } else if (!opts.skipOsm) {
        requestOsm(r);
      }
    } else {
      els.hint.innerHTML =
        "<b>Click a state, province, or European country</b> to zoom in, filter the list, and (where allowed) load matching OpenStreetMap businesses. Seed pins for Arizona are city-level, not rooftop-accurate.";
      setStatus("");
      document.documentElement.dataset.osm = "idle";
      if (globe && !opts.silent) globe.pointOfView({ lat: 33.45, lng: -112.07, altitude: 0.95 }, 800);
    }
    paintPolygons();
    renderList();
    return r;
  }

  function cacheKey(regionId) {
    return CACHE_PREFIX + regionId + ":" + categoryHash();
  }

  function readCache(regionId) {
    try {
      const raw = localStorage.getItem(cacheKey(regionId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.leads)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(regionId, leads) {
    try {
      localStorage.setItem(cacheKey(regionId), JSON.stringify({ ts: Date.now(), regionId, leads }));
    } catch (e) {
      /* quota — ignore */
    }
  }

  function buildOverpassQuery(region) {
    const p = region.properties;
    const timeout = categoryConfig.overpassTimeoutSec || 25;
    const cap = categoryConfig.resultCap || RESULT_CAP;
    const lines = [];
    enabledCategories().forEach((cat) => {
      (cat.queries || []).forEach((q) => {
        const k = String(q.key).replace(/"/g, "");
        const v = String(q.value).replace(/"/g, "");
        lines.push(`  nwr["${k}"="${v}"](area.a);`);
      });
    });
    const tag = p.overpassAreaTag || "ISO3166-1";
    const val = p.overpassAreaValue || p.id;
    return `[out:json][timeout:${timeout}];
area["${tag}"="${val}"]->.a;
(
${lines.join("\n")}
);
out center tags ${cap};`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchOverpass(query) {
    let lastErr = null;
    for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
      const url = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), (categoryConfig.overpassTimeoutSec || 25) * 1000 + 5000);
      try {
        const res = await fetch(url, {
          method: "POST",
          body: query,
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (res.status === 429 || res.status === 504 || res.status === 502) {
          lastErr = new Error("Overpass " + res.status);
          await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
          continue;
        }
        if (!res.ok) throw new Error("Overpass HTTP " + res.status);
        return await res.json();
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
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

  async function requestOsm(region) {
    const id = region.properties.id;
    const cached = readCache(id);
    if (cached) {
      osmByRegion[id] = ensureKeys(cached.leads);
      setStatus(`Loaded ${cached.leads.length} OpenStreetMap rows from cache.`, "muted");
      document.documentElement.dataset.osm = "cached";
      renderList();
      return;
    }
    if (queryInFlight) {
      queuedRegionId = id;
      setStatus("Waiting for the previous OpenStreetMap query to finish…", "muted");
      return;
    }
    const gen = ++queryGen;
    queryInFlight = true;
    document.documentElement.dataset.osm = "loading";
    setStatus("Querying OpenStreetMap (Overpass) for this region…");
    try {
      const data = await fetchOverpass(buildOverpassQuery(region));
      if (gen !== queryGen && queuedRegionId) {
        /* a newer click is queued; still store this result */
      }
      const leads = osmToLeads(data.elements || [], region);
      osmByRegion[id] = leads;
      writeCache(id, leads);
      if (selectedRegion && selectedRegion.properties.id === id) {
        setStatus(`Loaded ${leads.length} OpenStreetMap businesses (capped at ${categoryConfig.resultCap || RESULT_CAP}).`);
        document.documentElement.dataset.osm = "ok";
        renderList();
      }
    } catch (err) {
      if (selectedRegion && selectedRegion.properties.id === id) {
        setStatus("OpenStreetMap query failed or timed out. Seed rows still show if any are in this region. Try again in a moment.", "error");
        document.documentElement.dataset.osm = "error";
      }
    } finally {
      queryInFlight = false;
      if (queuedRegionId) {
        const next = queuedRegionId;
        queuedRegionId = null;
        const r = regions.find((x) => x.properties.id === next);
        if (r) requestOsm(r);
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

  function sizeGlobe() {
    if (!globe) return;
    const r = els.globe.getBoundingClientRect();
    globe.width(Math.max(320, r.width)).height(Math.max(280, r.height));
  }

  function altitudeForSpan(span) {
    return Math.max(0.35, Math.min(2.4, span / 18 + 0.28));
  }

  els.list.addEventListener("click", (e) => {
    const card = e.target.closest("[data-key]");
    if (card) selectLead(card.getAttribute("data-key"), true);
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
    const mail = e.target.closest && e.target.closest("#outreach-mailto");
    if (mail && mail.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
    }
  });
  els.q.addEventListener("input", renderList);
  els.cat.addEventListener("change", renderList);
  els.sort.addEventListener("change", renderList);
  els.minFit.addEventListener("change", renderList);
  els.region.addEventListener("change", () => selectRegion(els.region.value || null));
  els.exportBtn.addEventListener("click", exportCsv);

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  async function init() {
    ensureKeys(seedLeads);
    try {
      const [catCfg, regionCfg, scriptCfg] = await Promise.all([
        loadJson("config/categories.json"),
        loadJson("config/regions.json"),
        loadJson("config/scripts.json").catch(() => ({ categories: {}, inviteUrl: INVITE })),
      ]);
      categoryConfig = catCfg;
      scriptConfig = scriptCfg || scriptConfig;
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
    }

    renderList();
    document.documentElement.dataset.globe = globe ? "ready" : "error";

    window.LeadGlobe = {
      ready: true,
      selectRegion: (id, opts) => selectRegion(id, opts),
      selectLead: (key, fly) => selectLead(key, fly),
      findLead: (q) => findLeadByQuery(q),
      getVisible: () => filtered(),
      getRegions: () => regions.map((r) => r.properties),
      getSelected: () => selectedLead,
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
