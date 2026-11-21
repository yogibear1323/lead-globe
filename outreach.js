/* One-to-one outreach drafting. Arizona first; other US states unlock after AZ is complete. Nothing is sent automatically. */
(function () {
  const INVITE = "https://robertwalker.dataearns.com/invite";
  const STORE_KEY = "leadglobe:az-outreach:v1";
  const DRAFT_TEMPLATE_VERSION = "v3";
  const DRAFT_VER_KEY = "leadglobe:draft-template-version";
  const TZ = "America/Phoenix";
  const FIRST_REGION = "US-AZ";
  const TERRITORIES = { "US-PR": 1, "US-VI": 1, "US-GU": 1, "US-AS": 1, "US-MP": 1 };

  const DISCLAIMER =
    "DataEarners is an independent team that introduces businesses to the data licensing company. We don't sign anything for you or speak for the data licensing company; any agreement is between your company and the data licensing company. If you sign, the data licensing company pays us; you never pay us anything.";
  const DISCLAIMER_CONFIRMED = true;

  const PROCESS =
    "Here's the process, start to finish:\n" +
    "1. Build your profile: describe your systems with us beside you. No data, files or logins.\n" +
    "2. Request an offer when you're ready. Asking commits you to nothing.\n" +
    "3. Receive a fixed offer in writing, covering the systems and dates.\n" +
    "4. Sign only if you choose to. This is the first point you're committed; have your attorney review it.\n" +
    "5. Your team exports copies. Your systems keep running. No passwords are shared.\n" +
    "6. The data licensing company removes sensitive material and de-identifies personal details.\n" +
    "7. You're paid directly under the agreement. You never pay DataEarners anything.";

  const COMPLIANCE =
    "One-to-one outreach only — review and send each email yourself, one business at a time. This tool never sends mail. Honor opt-outs the same day; anyone marked contacted or opted out is kept out of future batches, in every state. CAN-SPAM requires a valid physical mailing address in commercial email; add yours below so it appears in the signature. No dollar claims or promised offers. Outreach stays off for Canadian provinces (CASL) and European countries (GDPR).";

  const els = {};
  const cache = {}; // regionId -> { emails, alt, loaded, error }
  let viewRegion = FIRST_REGION;
  let selectedId = "";
  let store = emptyStore();
  let loadError = "";

  function emptyStore() {
    return {
      version: 2,
      profile: {
        name: "Robert Walker",
        email: "",
        address: "",
        signature: "Independent DataEarners partner",
        batchSize: 10,
      },
      entries: [],
      batches: {},
      activeRegion: FIRST_REGION,
      completedRegions: [],
    };
  }

  function todayStamp() {
    return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isUsState(id) {
    if (!id || !/^US-[A-Z]{2}$/.test(id)) return false;
    return !TERRITORIES[id];
  }

  function migrateBatches(raw) {
    if (!raw || typeof raw !== "object") return {};
    const keys = Object.keys(raw);
    if (!keys.length) return {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(keys[0])) {
      return { [FIRST_REGION]: raw };
    }
    return raw;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      const base = emptyStore();
      const profile = Object.assign(base.profile, parsed.profile || {});
      profile.batchSize = Number(profile.batchSize) === 20 ? 20 : 10;
      const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).map((e) =>
        Object.assign({ region: FIRST_REGION }, e)
      );
      const completed = Array.isArray(parsed.completedRegions) ? parsed.completedRegions.slice() : [];
      return {
        version: 2,
        profile: profile,
        entries: entries,
        batches: migrateBatches(parsed.batches),
        activeRegion: parsed.activeRegion || FIRST_REGION,
        completedRegions: completed,
      };
    } catch (e) {
      return emptyStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  function validEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  }

  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function statusOf(lead) {
    const email = String((lead && lead.email) || "").toLowerCase().trim();
    const name = normName(lead && lead.name);
    const key = (lead && lead.key) || "";
    const hits = store.entries.filter((e) => {
      if (key && e.id && e.id === key) return true;
      if (email && e.email && String(e.email).toLowerCase().trim() === email) return true;
      if (name && e.name && normName(e.name) === name) return true;
      return false;
    });
    if (hits.some((e) => e.status === "opted-out")) return "opted-out";
    if (hits.some((e) => e.status === "contacted")) return "contacted";
    return "";
  }

  function currentPack() {
    return cache[viewRegion] || { emails: [], alt: [], loaded: false };
  }

  function currentLeads() {
    return currentPack().emails || [];
  }

  function currentAlt() {
    return currentPack().alt || [];
  }

  function counts(regionId) {
    const rid = regionId || viewRegion;
    const pack = cache[rid] || { emails: [], alt: [], loaded: false };
    const leads = pack.emails || [];
    const contactedKeys = new Set();
    const optedKeys = new Set();
    store.entries.forEach((e) => {
      const k = (e.email || e.id || "").toLowerCase();
      if (!k) return;
      if (e.status === "opted-out") optedKeys.add(k);
      if (e.status === "contacted") contactedKeys.add(k);
    });
    optedKeys.forEach((k) => contactedKeys.delete(k));
    const remaining = leads.filter((l) => !statusOf(l)).length;
    const contactedHere = leads.filter((l) => statusOf(l) === "contacted").length;
    const optedHere = leads.filter((l) => statusOf(l) === "opted-out").length;
    return {
      region: rid,
      withEmailRows: leads._rows || leads.length,
      uniqueEmail: leads.length,
      remaining: remaining,
      contacted: contactedKeys.size,
      optedOut: optedKeys.size,
      contactedHere: contactedHere,
      optedHere: optedHere,
      alt: (pack.alt || []).length,
    };
  }

  function eligible(regionId) {
    const rid = regionId || viewRegion;
    const pack = cache[rid] || { emails: [] };
    return (pack.emails || []).filter((l) => !statusOf(l));
  }

  function isRegionComplete(id) {
    if (!id) return false;
    if (store.completedRegions && store.completedRegions.indexOf(id) !== -1) return true;
    const pack = cache[id];
    if (!pack || !pack.loaded || !pack.emails || !pack.emails.length) return false;
    return pack.emails.filter((l) => !statusOf(l)).length === 0;
  }

  function arizonaComplete() {
    return isRegionComplete(FIRST_REGION);
  }

  function outreachAllowed(id) {
    if (!isUsState(id)) return false;
    if (id === FIRST_REGION) return true;
    return arizonaComplete();
  }

  function markComplete(id, via) {
    if (!id) return false;
    if (!store.completedRegions) store.completedRegions = [];
    if (store.completedRegions.indexOf(id) !== -1) return false;
    store.completedRegions.push(id);
    saveStore();
    notifyGlobe();
    return true;
  }

  function maybeComplete(id) {
    const rid = id || viewRegion;
    if (!rid) return;
    if (store.completedRegions && store.completedRegions.indexOf(rid) !== -1) return;
    const pack = cache[rid];
    if (!pack || !pack.loaded || !pack.emails || !pack.emails.length) return;
    if (pack.emails.filter((l) => !statusOf(l)).length === 0) markComplete(rid, "exhausted");
  }

  function regionName(id) {
    if (window.LeadGlobe && typeof window.LeadGlobe.getRegionName === "function") {
      const n = window.LeadGlobe.getRegionName(id);
      if (n) return n;
    }
    try {
      const opt = document.querySelector("#region option[value=\"" + (id || "") + "\"]");
      if (opt && opt.textContent.trim()) return opt.textContent.trim();
    } catch (e) {}
    return id || "";
  }

  function hashNum(key) {
    let h = 0;
    String(key || "").split("").forEach((ch) => {
      h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    });
    return h;
  }

  function hashVar(key, n) {
    return hashNum(key) % (n || 3);
  }

  function wordCount(text) {
    return String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  function stampFromIso(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
    } catch (e) {
      return "";
    }
  }

  const CATEGORY_LINES = {
    home: {
      id: "home",
      label: "trades / home services",
      noun: "home-services company",
      asset: "every quote, job and invoice in systems like QuickBooks or ServiceTitan",
    },
    auto: {
      id: "auto",
      label: "auto",
      noun: "auto business",
      asset: "every lead, service job and invoice in the systems a dealership already runs",
    },
    contractors: {
      id: "contractors",
      label: "contractors",
      noun: "contractor",
      asset: "every bid, job, change order and invoice in the systems you already use",
    },
    property: {
      id: "property",
      label: "property management",
      noun: "property-management company",
      asset: "every work order, lease file and invoice in the systems you already run",
    },
    logistics: {
      id: "logistics",
      label: "logistics",
      noun: "logistics or fleet business",
      asset: "every dispatch, route, job and invoice in the systems you already run",
    },
    retail: {
      id: "retail",
      label: "retail",
      noun: "retail business",
      asset: "every order, inventory movement and customer record in the systems you already use",
    },
    professional: {
      id: "professional",
      label: "professional services",
      noun: "professional-services firm",
      asset: "every engagement, client file and invoice in the systems you already use",
    },
    default: {
      id: "default",
      label: "default",
      noun: "local business",
      asset: "every request, quote, job and invoice, and the emails in between, in the systems you already use",
    },
  };

  function categoryKind(cat) {
    const c = String(cat || "").toLowerCase();
    if (c.indexOf("home service") !== -1 || c.indexOf("hvac") !== -1 || c.indexOf("plumb") !== -1) return "home";
    if (c.indexOf("auto") !== -1 || c.indexOf("dealer") !== -1 || c.indexOf("tyre") !== -1 || c.indexOf("tire") !== -1) return "auto";
    if (c.indexOf("contractor") !== -1 || c.indexOf("construction") !== -1) return "contractors";
    if (c.indexOf("property") !== -1) return "property";
    if (c.indexOf("logistics") !== -1 || c.indexOf("fleet") !== -1 || c.indexOf("trucking") !== -1 || c.indexOf("freight") !== -1) return "logistics";
    if (c.indexOf("retail") !== -1 || c.indexOf("e-commerce") !== -1 || c.indexOf("ecommerce") !== -1) return "retail";
    if (
      c.indexOf("professional") !== -1 ||
      c.indexOf("account") !== -1 ||
      c.indexOf("law") !== -1 ||
      c.indexOf("legal") !== -1 ||
      c.indexOf("insur") !== -1 ||
      c.indexOf("agenc") !== -1 ||
      c.indexOf("consult") !== -1
    ) {
      return "professional";
    }
    return "default";
  }

  function categoryInfo(cat) {
    return CATEGORY_LINES[categoryKind(cat)] || CATEGORY_LINES.default;
  }

  function profileSignature() {
    const p = store.profile;
    const name = (p.name || "Robert Walker").trim();
    const extra = (p.signature || "").trim();
    const email = (p.email || "").trim();
    const address = (p.address || "").trim();
    const lines = [name];
    if (extra) lines.push(extra);
    else lines.push("Independent DataEarners partner");
    if (email) lines.push(email);
    if (address) lines.push(address);
    else lines.push("[Add your physical mailing address in Outreach settings]");
    return lines.join("\n");
  }

  function optoutBlock(lead) {
    return 'If this is not for you, reply "unsubscribe" and I will not email you again.';
  }

  function categoryPhrase(cat) {
    const c = String(cat || "local business").trim();
    return c.charAt(0).toLowerCase() + c.slice(1);
  }

  function typeLine(cat) {
    return categoryInfo(cat).asset;
  }

  function subjectLines(name, city) {
    return [
      name + " in " + city + ": a data asset with no name on it",
      "A question about the records " + name + " already has",
      name + ": start a free profile of the systems you already run",
    ];
  }

  function openingVariants(lead, sender) {
    const name = lead.name || "your company";
    const city = lead.city || regionName(viewRegion) || "your city";
    const info = categoryInfo(lead.category);
    const asset = info.asset;
    const noun = info.noun;
    const article = /^[aeiou]/i.test(noun) ? "An " : "A ";
    return [
      "Hi,\n\nI'm " +
        sender +
        ", an independent DataEarners partner, writing only to " +
        name +
        " in " +
        city +
        ".\n\nFor years, " +
        name +
        " has been quietly building a data asset — " +
        asset +
        " — and it never had a name.",
      "Hi,\n\nThis is " +
        sender +
        ". I work independently with DataEarners and I'm reaching out one-to-one to " +
        name +
        " in " +
        city +
        ".\n\n" +
        name +
        " already has a data asset sitting in day-to-day systems — " +
        asset +
        " — most companies just never look at it that way.",
      "Hi,\n\nI'm " +
        sender +
        ", writing personally to " +
        name +
        " in " +
        city +
        ", not a list.\n\n" +
        article +
        noun +
        " in " +
        city +
        " builds a record over years — " +
        asset +
        " — and that record can be described without sharing the data itself.",
    ];
  }

  function corePitch() {
    return (
      "AI developers need real examples of how businesses like yours actually operate. The data licensing company licenses those examples under a written agreement, and only that company makes an offer.\n\n" +
      "The first step is a free Company Data Asset Profile: a written description of the systems you run, how much they hold, and how far back they go. It contains no data, no files and no passwords. There's no commitment unless you later choose to sign.\n\n" +
      "The page takes a few minutes and shows exactly how a written offer is reached for a company like yours:\n" +
      INVITE
    );
  }

  function closingCta() {
    return "Start your free profile here:\n" + INVITE + "\n\nQuestions? Just reply.";
  }

  function buildDraft(lead, opts) {
    const name = lead.name || "your company";
    const city = lead.city || regionName(viewRegion) || "your city";
    const sender = (store.profile.name || "Robert Walker").trim();
    const info = categoryInfo(lead.category);
    const key = lead.key || lead.email || name;
    const o = opts || {};
    const subjectVar = o.subjectVar != null ? Number(o.subjectVar) % 3 : hashVar(key, 3);
    const openingVar = o.openingVar != null ? Number(o.openingVar) % 3 : hashVar(key + ":open", 3);
    const subjects = subjectLines(name, city);
    const openings = openingVariants(lead, sender);
    const opening = openings[openingVar];
    const mainBody = opening + "\n\n" + corePitch();
    const body =
      mainBody +
      "\n\n" +
      PROCESS +
      "\n\n" +
      closingCta() +
      "\n\n" +
      DISCLAIMER +
      "\n\n" +
      optoutBlock(lead) +
      "\n\n" +
      profileSignature();
    return {
      subject: subjects[subjectVar],
      body: body,
      mainBody: mainBody,
      wordCount: wordCount(mainBody),
      variation: openingVar,
      subjectVar: subjectVar,
      openingVar: openingVar,
      category: info.id,
      kind: "initial",
    };
  }

  function buildFollowUp(lead) {
    const name = lead.name || "your company";
    const city = lead.city || regionName(viewRegion) || "your city";
    const sender = (store.profile.name || "Robert Walker").trim();
    const asset = typeLine(lead.category);
    const fv = hashVar((lead.key || lead.email || name) + ":fu", 2);
    const subjects = [
      "Following up: " + name + "'s Company Data Asset Profile",
      "Still here if useful, " + name,
    ];
    const openings = [
      "Hi,\n\nI wrote last week about a data asset " +
        name +
        " in " +
        city +
        " may already have — " +
        asset +
        " — and a free Company Data Asset Profile that describes it, with no data, files or passwords attached.",
      "Hi,\n\nJust a short follow-up for " +
        name +
        " in " +
        city +
        ". I had asked whether the records you already run — " +
        asset +
        " — would be worth describing in a free Company Data Asset Profile. No data, files or passwords are involved.",
    ];
    const mid =
      "If this didn't land at the right time, the page is still here. It takes a few minutes and shows exactly how a written offer is reached for a company like yours. Only the data licensing company makes an offer.\n\n" +
      INVITE;
    const end = "Start your free profile here when you're ready:\n" + INVITE + "\n\nQuestions? Just reply.";
    const mainBody = openings[fv] + "\n\n" + mid;
    const body =
      mainBody +
      "\n\n" +
      end +
      "\n\n" +
      DISCLAIMER +
      "\n\n" +
      optoutBlock(lead) +
      "\n\n" +
      profileSignature();
    return {
      subject: subjects[fv],
      body: body,
      mainBody: mainBody,
      wordCount: wordCount(mainBody),
      variation: fv,
      category: categoryKind(lead.category),
      kind: "follow-up",
    };
  }

  function buildCallScript(lead) {
    const name = lead.name || "your company";
    const city = lead.city || regionName(viewRegion) || "your city";
    const sender = (store.profile.name || "Robert Walker").trim();
    const asset = typeLine(lead.category);
    const body =
      "Hi, this is " +
      sender +
      ", an independent DataEarners partner. I'm calling about " +
      name +
      " in " +
      city +
      ". Do you have a minute?\n\nFor years, " +
      name +
      " has been quietly building a data asset — " +
      asset +
      " — and it never had a name.\n\nThere's a short page that shows how a written offer is reached for a company like yours. The first step is a free Company Data Asset Profile: a written description of the systems you run, how much they hold, and how far back they go. It contains no data, no files and no passwords, and there's no commitment unless you later choose to sign. Only the data licensing company makes an offer.\n\nI can email you the link, or you can open it now:\n" +
      INVITE +
      "\n\nStart your free profile there when you have a few minutes. Questions? I'm happy to stay on the line, or you can reply by email.\n\nIf this is not for you, just say so and I will not contact you again.\n\n" +
      DISCLAIMER;
    return { subject: "", body: body, kind: "call", category: categoryKind(lead.category) };
  }

  function buildVoicemail(lead) {
    const name = lead.name || "your company";
    const city = lead.city || regionName(viewRegion) || "your city";
    const sender = (store.profile.name || "Robert Walker").trim();
    const asset = typeLine(lead.category);
    const body =
      "Hi, this is " +
      sender +
      ", an independent DataEarners partner, calling about " +
      name +
      " in " +
      city +
      ".\n\nI'm reaching out about a data asset " +
      name +
      " may already have in day-to-day systems — " +
      asset +
      ". There's a short page that shows how a written offer is reached for a company like yours, starting with a free Company Data Asset Profile. No data, files or passwords. Only the data licensing company makes an offer.\n\nThe page is " +
      INVITE +
      " — start your free profile there when you have a few minutes, or email me back with questions.\n\nIf you'd rather I not contact you again, just let me know.";
    return { subject: "", body: body, kind: "voicemail", category: categoryKind(lead.category) };
  }

  function isStaleDraftText(text) {
    return /At a glance|Mode's ads|\bMode says\b|\$100K|\$5M|walkthrough call|You've been invited\. This is about|optout\.html|github\.io|yogibear1323|You can also use this opt-out page/i.test(
      String(text || "")
    );
  }


  function mailPayload(id) {
    const lead = leadByKey(id);
    if (!lead) return null;
    const f = draftFields(id);
    return {
      lead: lead,
      to: lead.email || "",
      subject: f.subject || "",
      body: f.body || "",
    };
  }

  function mailActionButtons(id, disabled) {
    const pref = window.MailChooser && MailChooser.getPreferred && MailChooser.getPreferred();
    const useLabel =
      pref && MailChooser.useButtonLabel ? MailChooser.useButtonLabel() : "Open in email";
    const change = pref
      ? '<button type="button" class="iv-btn-ghost az-mail-change" data-id="' +
        escapeHtml(id) +
        '"' +
        (disabled ? " disabled" : "") +
        ">Change</button>"
      : "";
    return (
      '<div class="mail-open-wrap">' +
      '<button type="button" class="iv-btn az-mail-use" data-id="' +
      escapeHtml(id) +
      '"' +
      (disabled ? " disabled" : "") +
      ">" +
      escapeHtml(useLabel) +
      "</button>" +
      change +
      "</div>"
    );
  }

  function launchDraft(pack, mode, extraOpts) {
    if (!pack || !window.MailChooser) return;
    const extra = extraOpts || {};
    const logStatus = extra.logStatus || "contacted";
    const opts = Object.assign({
      onOpened: (info) => {
        logEntry(pack.lead, logStatus, (info && info.id) || "mail");
        refreshAfterLog();
      },
      onCopy: () => {
        logEntry(pack.lead, logStatus, "copy");
        refreshAfterLog();
      },
    }, extra);
    const pref = MailChooser.getPreferred && MailChooser.getPreferred();
    if (mode === "use" && pref) {
      return MailChooser.launch(pref, pack, opts);
    }
    MailChooser.open(pack, opts);
  }

  function openDraftChooser(id, mode) {
    const pack = mailPayload(id);
    if (!pack) return;
    gateForLead(pack.lead, { fromDesk: true }, function () {
      launchDraft(pack, mode, { onCopy: () => handleAction("copy", id) });
    });
  }

  function followUpPayload(id) {
    const lead = leadByKey(id);
    if (!lead) return null;
    const built = buildFollowUp(lead);
    const f = followUpFields(id);
    return {
      lead: lead,
      to: lead.email || "",
      subject: f.subject || built.subject,
      body: f.body || built.body,
    };
  }

  function openFollowUpChooser(id, mode) {
    const lead = leadByKey(id);
    if (!lead || !canFollowUp(lead)) return;
    const pack = followUpPayload(id);
    if (!pack) return;
    gateForLead(lead, { fromDesk: true }, function () {
      launchDraft(pack, mode, {
        logStatus: "follow-up",
        onCopy: () => handleAction("fu-copy", id),
      });
    });
  }

  function mailtoHref(email, subject, body) {
    return (
      "mailto:" +
      encodeURIComponent(email || "") +
      "?subject=" +
      encodeURIComponent(subject || "") +
      "&body=" +
      encodeURIComponent(body || "")
    );
  }

  function logEntry(lead, status, via) {
    store.entries.push({
      id: lead.key || "",
      name: lead.name || "",
      email: lead.email || "",
      region: store.activeRegion || viewRegion || lead.regionId || "",
      status: status,
      date: nowIso(),
      via: via || "",
    });
    saveStore();
    maybeComplete(store.activeRegion || viewRegion);
    try {
      document.dispatchEvent(new CustomEvent("leadglobe:outreach-log", { detail: { id: lead && lead.key, status: status, via: via || "" } }));
    } catch (e) {}
  }

  function parseLeads(doc) {
    const rows = Array.isArray(doc && doc.leads) ? doc.leads : [];
    const seenEmail = new Set();
    const emails = [];
    const alt = [];
    const seenAlt = new Set();
    let emailRows = 0;
    rows.forEach((l) => {
      const email = String(l.email || "").trim();
      if (email && validEmail(email)) {
        emailRows += 1;
        const k = email.toLowerCase();
        if (seenEmail.has(k)) return;
        seenEmail.add(k);
        emails.push({
          key: l.key || "",
          name: l.name || "",
          email: email,
          category: l.category || "",
          city: l.city || "",
          website: l.website || "",
          phone: l.phone || "",
          address: l.address || "",
          fit: Number(l.fit) || 0,
          regionId: l.regionId || "",
        });
        return;
      }
      if (l.website || l.phone) {
        const altKey =
          String(l.name || "").toLowerCase() +
          "|" +
          String(l.phone || "") +
          "|" +
          String(l.website || "").toLowerCase();
        if (seenAlt.has(altKey)) return;
        seenAlt.add(altKey);
        alt.push({
          key: l.key || "",
          name: l.name || "",
          email: "",
          category: l.category || "",
          city: l.city || "",
          website: l.website || "",
          phone: l.phone || "",
          fit: Number(l.fit) || 0,
          regionId: l.regionId || "",
        });
      }
    });
    emails.sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));
    alt.sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));
    emails._rows = emailRows;
    return { emails: emails, alt: alt };
  }

  async function ensureData(regionId) {
    const id = regionId || viewRegion || FIRST_REGION;
    if (cache[id] && cache[id].loaded) {
      loadError = "";
      return cache[id];
    }
    try {
      const res = await fetch("data/regions/" + encodeURIComponent(id) + ".json");
      if (!res.ok) throw new Error("Could not load the " + regionName(id) + " list");
      const parsed = parseLeads(await res.json());
      cache[id] = { emails: parsed.emails, alt: parsed.alt, loaded: true, error: "" };
      loadError = "";
      maybeComplete(id);
      return cache[id];
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      cache[id] = { emails: [], alt: [], loaded: false, error: msg };
      loadError = msg;
      return cache[id];
    }
  }

  function todaysBatch() {
    const day = todayStamp();
    const byRegion = store.batches[viewRegion];
    return (byRegion && byRegion[day]) || null;
  }

  function buildToday(force) {
    if (isRegionComplete(viewRegion)) return todaysBatch();
    const day = todayStamp();
    const size = store.profile.batchSize === 20 ? 20 : 10;
    if (!store.batches[viewRegion] || typeof store.batches[viewRegion] !== "object") {
      store.batches[viewRegion] = {};
    }
    const cur = store.batches[viewRegion][day];
    if (!force && cur && cur.ids && cur.ids.length) return cur;
    const already = new Set((cur && cur.ids) || []);
    const pool = eligible().filter((l) => !already.has(l.key));
    const need = Math.max(0, size - already.size);
    const added = pool.slice(0, need).map((l) => l.key);
    const ids = cur && !force ? (cur.ids || []).concat(added) : pool.slice(0, size).map((l) => l.key);
    store.batches[viewRegion][day] = { date: day, size: size, ids: ids, region: viewRegion };
    saveStore();
    return store.batches[viewRegion][day];
  }

  function leadByKey(id) {
    return currentLeads().find((l) => l.key === id) || currentAlt().find((l) => l.key === id) || null;
  }

  function draftFields(id, prefix) {
    const pfx = prefix || "az";
    const sub = document.getElementById(pfx + "-sub-" + cssId(id));
    const body = document.getElementById(pfx + "-body-" + cssId(id));
    return {
      subject: sub ? sub.value : "",
      body: body ? body.value : "",
    };
  }

  function followUpFields(id) {
    return draftFields(id, "az-fu");
  }

  function leadMatchesEntry(lead, e) {
    const email = String((lead && lead.email) || "").toLowerCase().trim();
    const name = normName(lead && lead.name);
    const key = (lead && lead.key) || "";
    if (key && e.id && e.id === key) return true;
    if (email && e.email && String(e.email).toLowerCase().trim() === email) return true;
    if (name && e.name && normName(e.name) === name) return true;
    return false;
  }

  function hasFollowUp(lead) {
    return store.entries.some((e) => e.status === "follow-up" && leadMatchesEntry(lead, e));
  }

  function firstContactedDate(lead) {
    const hits = store.entries.filter((e) => e.status === "contacted" && leadMatchesEntry(lead, e));
    if (!hits.length) return "";
    hits.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    return hits[0].date || "";
  }

  function daysSinceContact(lead) {
    const day = stampFromIso(firstContactedDate(lead));
    if (!day) return -1;
    const today = todayStamp();
    return Math.round((Date.parse(today + "T00:00:00") - Date.parse(day + "T00:00:00")) / 86400000);
  }

  function canFollowUp(lead) {
    if (!lead || !String(lead.email || "").trim()) return false;
    if (statusOf(lead) !== "contacted") return false;
    if (hasFollowUp(lead)) return false;
    return daysSinceContact(lead) >= 4;
  }

  function followUpCandidates() {
    return currentLeads().filter(canFollowUp);
  }


  function cssId(id) {
    return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function bindEls() {
    els.open = document.getElementById("az-outreach-open");
    els.back = document.getElementById("az-outreach-back");
    els.desk = document.getElementById("az-desk");
    els.deskModal = document.getElementById("az-desk-modal");
    els.deskBackdrop = document.getElementById("az-desk-modal-backdrop");
    els.deskClose = document.getElementById("az-desk-x");
    els.deskTitle = document.getElementById("az-desk-title");
    els.flag = document.getElementById("az-outreach-flag");
    els.globeFlag = document.getElementById("outreach-globe-flag");
    els.stats = document.getElementById("az-stats");
    els.complete = document.getElementById("az-complete");
    els.batchBar = document.getElementById("az-batch-bar");
    els.batch = document.getElementById("az-batch");
    els.followups = document.getElementById("az-followups");
    els.build = document.getElementById("az-build");
    els.size = document.getElementById("az-batch-size");
    els.compliance = document.getElementById("az-compliance");
    els.name = document.getElementById("az-name");
    els.email = document.getElementById("az-email");
    els.address = document.getElementById("az-address");
    els.signature = document.getElementById("az-signature");
    els.settingsNote = document.getElementById("az-settings-note");
    els.debugComplete = document.getElementById("az-debug-complete");
    els.alt = document.getElementById("az-alt");
    els.altSummary = document.getElementById("az-alt-summary");
    els.log = document.getElementById("az-log");
    els.logSummary = document.getElementById("az-log-summary");
    els.exportJson = document.getElementById("az-export-json");
    els.exportCsv = document.getElementById("az-export-csv");
    els.import = document.getElementById("az-import");
    els.panel = document.getElementById("list-panel") || document.querySelector(".panel");
  }

  function fillProfileForm() {
    if (els.name) els.name.value = store.profile.name || "";
    if (els.email) els.email.value = store.profile.email || "";
    if (els.address) els.address.value = store.profile.address || "";
    if (els.signature) els.signature.value = store.profile.signature || "";
    if (els.size) els.size.value = String(store.profile.batchSize === 20 ? 20 : 10);
    updateSettingsNote();
  }

  function readProfileForm() {
    if (els.name) store.profile.name = els.name.value.trim() || "Robert Walker";
    if (els.email) store.profile.email = els.email.value.trim();
    if (els.address) store.profile.address = els.address.value.trim();
    if (els.signature) store.profile.signature = els.signature.value.trim();
    if (els.size) store.profile.batchSize = Number(els.size.value) === 20 ? 20 : 10;
    saveStore();
    updateSettingsNote();
  }

  function updateSettingsNote() {
    if (!els.settingsNote) return;
    if (!(store.profile.address || "").trim()) {
      els.settingsNote.textContent =
        "Add a physical mailing address so it can appear in the signature. CAN-SPAM requires one in commercial email.";
      els.settingsNote.className = "az-hint is-warn";
    } else {
      els.settingsNote.textContent = "These details stay in this browser until you export the log.";
      els.settingsNote.className = "az-hint";
    }
  }

  function updateFlags() {
    const active = store.activeRegion || FIRST_REGION;
    const azDone = arizonaComplete();
    const label = azDone && isRegionComplete(active)
      ? (active === FIRST_REGION
          ? "AZ complete — pick a US state"
          : regionName(active) + " complete — pick a US state")
      : "Outreach: " + regionName(active);
    const doneClass = azDone && isRegionComplete(active);
    [els.flag, els.globeFlag].forEach((node) => {
      if (!node) return;
      node.textContent = label;
      node.classList.toggle("is-on", true);
      node.classList.toggle("is-done", !!doneClass);
      node.hidden = false;
    });
    if (els.deskTitle) els.deskTitle.textContent = regionName(viewRegion) + " outreach";
    document.documentElement.dataset.azActive = active;
    document.documentElement.dataset.azUnlocked = azDone ? "on" : "off";
    document.documentElement.dataset.azComplete = isRegionComplete(viewRegion) ? "on" : "off";
    document.documentElement.dataset.azRegion = viewRegion || "";
  }

  function notifyGlobe() {
    updateFlags();
    if (window.LeadGlobe && typeof window.LeadGlobe.refreshPolygons === "function") {
      window.LeadGlobe.refreshPolygons();
    }
  }

  function renderComplete() {
    if (!els.complete) return;
    const done = isRegionComplete(viewRegion);
    const place = regionName(viewRegion);
    const c = counts();
    els.complete.hidden = !done;
    els.complete.classList.toggle("is-on", done);
    if (els.batchBar) els.batchBar.hidden = done;
    if (els.desk) els.desk.classList.toggle("is-complete", done);
    if (els.panel) els.panel.classList.toggle("is-complete", done);
    if (!done) {
      els.complete.innerHTML = "";
      return;
    }
    const natural = (c.uniqueEmail > 0 && c.remaining === 0);
    const head = place + " complete";
    const lead = natural
      ? "There are no remaining " +
        place +
        " businesses with a published email to contact."
      : place +
        " was marked complete so you can pick a next state. " +
        c.remaining +
        " businesses with email have not been contacted yet in this list.";
    const next =
      viewRegion === FIRST_REGION
        ? "Pick your next state on the globe to continue one-to-one outreach. Click any US state or the District of Columbia, then open Outreach. Switching is always a manual click — nothing will move you automatically. Outreach is not offered for Canadian provinces (CASL) or European countries (GDPR)."
        : "If you want to work another state, click it on the globe and open Outreach. Switching is always a manual click. Outreach is not offered for Canadian provinces (CASL) or European countries (GDPR).";
    els.complete.innerHTML =
      "<h3>" +
      escapeHtml(head) +
      "</h3><p>" +
      escapeHtml(lead) +
      "</p><p class=\"az-counts\"><b>This state:</b> " +
      c.uniqueEmail +
      " unique emails · " +
      c.contactedHere +
      " contacted · " +
      c.optedHere +
      " opted out · " +
      c.remaining +
      " remaining</p><p class=\"az-counts\"><b>Shared log:</b> " +
      c.contacted +
      " contacted · " +
      c.optedOut +
      " opted out</p><p>" +
      escapeHtml(next) +
      "</p>";
  }

  function renderStats() {
    const c = counts();
    const place = regionName(viewRegion);
    if (els.stats) {
      els.stats.innerHTML =
        "<p><b>" +
        c.uniqueEmail +
        " " +
        escapeHtml(place) +
        " businesses</b> in the prebuilt list have a published email" +
        (c.withEmailRows && c.withEmailRows !== c.uniqueEmail
          ? " (" + c.withEmailRows + " rows, " + (c.withEmailRows - c.uniqueEmail) + " duplicate addresses removed)"
          : "") +
        ". " +
        c.remaining +
        " remain eligible. " +
        c.contacted +
        " contacted and " +
        c.optedOut +
        " opted out in the shared log.</p>" +
        (c.uniqueEmail < 30
          ? "<p class=\"az-hint is-warn\">Relatively few of the listed " +
            escapeHtml(place) +
            " businesses include an email. A larger “contact via their site” list is below, with no email draft.</p>"
          : "<p class=\"az-hint\">" +
            c.alt +
            " additional listed businesses have a website or phone but no email; they appear in the separate list below, with no email draft.</p>");
    }
    if (els.altSummary) {
      els.altSummary.textContent = "Contact via their site (no email) — " + c.alt;
    }
    if (els.logSummary) {
      els.logSummary.textContent =
        "Outreach log — " + c.contacted + " contacted, " + c.optedOut + " opted out, " + c.remaining + " remaining in " + place;
    }
    document.documentElement.dataset.azEmailCount = String(c.uniqueEmail);
    document.documentElement.dataset.azRemaining = String(c.remaining);
  }

  function renderBatch() {
    if (!els.batch) return;
    if (isRegionComplete(viewRegion)) {
      els.batch.innerHTML = "";
      document.documentElement.dataset.azBatch = "0";
      return;
    }
    if (loadError) {
      els.batch.innerHTML = "<p class=\"az-hint is-warn\">" + escapeHtml(loadError) + "</p>";
      return;
    }
    const batch = todaysBatch();
    if (!batch || !batch.ids.length) {
      const remain = eligible().length;
      els.batch.innerHTML =
        remain > 0
          ? "<p class=\"az-empty\">No batch for today yet. Choose 10 or 20, then build today’s list. Only unused emails in " +
            escapeHtml(regionName(viewRegion)) +
            " are included. Anyone already contacted or opted out, in any state, is left out.</p>"
          : "<p class=\"az-empty\">No eligible businesses with email are left to put in a batch.</p>";
      document.documentElement.dataset.azBatch = "0";
      return;
    }
    const cards = [];
    batch.ids.forEach((id, idx) => {
      const lead = leadByKey(id);
      if (!lead) return;
      const st = statusOf(lead);
      const draft = buildDraft(lead);
      const cid = cssId(id);
      const disabled = st === "contacted" || st === "opted-out";
      const href = mailtoHref(lead.email, draft.subject, draft.body);
      cards.push(
        "<article class=\"az-draft" +
          (disabled ? " is-done" : "") +
          "\" data-az-id=\"" +
          escapeHtml(id) +
          "\">" +
          "<div class=\"az-draft-top\"><h3>" +
          (idx + 1) +
          ". " +
          escapeHtml(lead.name || "Business") +
          "</h3>" +
          (st
            ? "<span class=\"badge " +
              (st === "opted-out" ? "opted-out" : "contacted") +
              "\">" +
              (st === "opted-out" ? "Opted out" : "Contacted") +
              "</span>"
            : "<span class=\"badge ready\">Ready</span>") +
          "</div>" +
          "<p class=\"meta\">" +
          escapeHtml(lead.category || "") +
          (lead.city ? " · " + escapeHtml(lead.city) : "") +
          " · " +
          escapeHtml(lead.email) +
          "</p>" +
          "<label class=\"field\">Subject" +
          "<input id=\"az-sub-" +
          cid +
          "\" type=\"text\" value=\"" +
          escapeHtml(draft.subject) +
          "\"" +
          (disabled ? " readonly" : "") +
          "></label>" +
          "<label class=\"field\">Draft" +
          "<textarea id=\"az-body-" +
          cid +
          "\"" +
          (disabled ? " readonly" : "") +
          ">" +
          escapeHtml(draft.body) +
          "</textarea></label>" +
          "<div class=\"az-actions\">" +
          mailActionButtons(id, disabled) +
          "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"copy\" data-id=\"" +
          escapeHtml(id) +
          "\">Copy</button>" +
          "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"sent\" data-id=\"" +
          escapeHtml(id) +
          "\">Mark sent</button>" +
          "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"optout\" data-id=\"" +
          escapeHtml(id) +
          "\">Mark opted out</button>" +
          "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"skip\" data-id=\"" +
          escapeHtml(id) +
          "\">Skip</button>" +
          "</div></article>"
      );
    });
    els.batch.innerHTML =
      "<h3 class=\"az-batch-title\">Today’s batch (" + todayStamp() + ")</h3>" + cards.join("");
    document.documentElement.dataset.azBatch = String(batch.ids.length);
  }

  function renderAlt() {
    if (!els.alt) return;
    const rows = currentAlt().filter((l) => !statusOf(l)).slice(0, 30);
    if (!rows.length) {
      els.alt.innerHTML =
        "<p class=\"az-hint\">No remaining website/phone-only businesses, or all have been logged.</p>";
      return;
    }
    els.alt.innerHTML =
      "<ul class=\"az-alt-list\">" +
      rows
        .map((l) => {
          const site = l.website
            ? "<a href=\"" + escapeHtml(l.website) + "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(l.website) + "</a>"
            : "";
          const ph = l.phone ? escapeHtml(l.phone) : "";
          return (
            "<li data-az-id=\"" +
            escapeHtml(l.key) +
            "\"><div><b>" +
            escapeHtml(l.name) +
            "</b><div class=\"meta\">" +
            escapeHtml(l.category || "") +
            (l.city ? " · " + escapeHtml(l.city) : "") +
            (ph ? " · " + ph : "") +
            (site ? " · " + site : "") +
            "</div></div>" +
            "<div class=\"az-actions compact\">" +
            "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"sent\" data-id=\"" +
            escapeHtml(l.key) +
            "\">Mark contacted</button>" +
            "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"optout\" data-id=\"" +
            escapeHtml(l.key) +
            "\">Mark opted out</button>" +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>" +
      (currentAlt().filter((l) => !statusOf(l)).length > 30
        ? "<p class=\"az-hint\">Showing the first 30 remaining. " +
          (currentAlt().filter((l) => !statusOf(l)).length - 30) +
          " more are held back so this list stays usable.</p>"
        : "");
  }

  function renderLog() {
    if (!els.log) return;
    if (!store.entries.length) {
      els.log.innerHTML =
        "<p class=\"az-hint\">Nothing logged yet. Open, copy, or mark a draft to record it. This log is shared across states.</p>";
      return;
    }
    const rows = store.entries
      .slice()
      .reverse()
      .map((e) => {
        return (
          "<tr><td>" +
          escapeHtml((e.date || "").slice(0, 10)) +
          "</td><td>" +
          escapeHtml(e.region || "") +
          "</td><td>" +
          escapeHtml(e.name || "") +
          "</td><td>" +
          escapeHtml(e.email || "") +
          "</td><td>" +
          escapeHtml(e.status || "") +
          "</td><td>" +
          escapeHtml(e.via || "") +
          "</td></tr>"
        );
      })
      .join("");
    els.log.innerHTML =
      "<div class=\"az-log-actions\"></div><table class=\"az-log-table\"><thead><tr><th>Date</th><th>State</th><th>Name</th><th>Email</th><th>Status</th><th>Via</th></tr></thead><tbody>" +
      rows +
      "</tbody></table>";
  }

  function renderFollowups() {
    if (!els.followups) return;
    const rows = followUpCandidates();
    document.documentElement.dataset.azFollowups = String(rows.length);
    if (!rows.length) {
      const contacted = currentLeads().filter((l) => statusOf(l) === "contacted" && !hasFollowUp(l)).length;
      els.followups.innerHTML =
        "<h3 class=\"az-batch-title\">Follow-ups</h3>" +
        "<p class=\"az-hint\">A short bump is available 4 days after first contact, once per business, and only if they have not opted out. " +
        (contacted
          ? contacted + " contacted " + (contacted === 1 ? "business is" : "businesses are") + " waiting for the 4-day mark."
          : "None are waiting right now.") +
        " This is a manual step; nothing is sent automatically.</p>";
      return;
    }
    const cards = rows.map((lead, idx) => {
      const draft = buildFollowUp(lead);
      const id = lead.key;
      const cid = cssId(id);
      const days = daysSinceContact(lead);
      return (
        "<article class=\"az-draft az-followup\" data-az-id=\"" +
        escapeHtml(id) +
        "\" data-kind=\"follow-up\">" +
        "<div class=\"az-draft-top\"><h3>" +
        (idx + 1) +
        ". " +
        escapeHtml(lead.name || "Business") +
        "</h3>" +
        "<span class=\"badge ready\">Follow-up · day " +
        days +
        "</span></div>" +
        "<p class=\"meta\">" +
        escapeHtml(lead.category || "") +
        (lead.city ? " · " + escapeHtml(lead.city) : "") +
        " · " +
        escapeHtml(lead.email) +
        "</p>" +
        "<label class=\"field\">Subject" +
        "<input id=\"az-fu-sub-" +
        cid +
        "\" type=\"text\" value=\"" +
        escapeHtml(draft.subject) +
        "\"></label>" +
        "<label class=\"field\">Draft" +
        "<textarea id=\"az-fu-body-" +
        cid +
        "\">" +
        escapeHtml(draft.body) +
        "</textarea></label>" +
        "<div class=\"az-actions\">" +
        mailActionButtons(id, false).replace(/az-mail-use/g, "az-mail-use az-fu-use").replace(/az-mail-change/g, "az-mail-change az-fu-change") +
        "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"fu-copy\" data-id=\"" +
        escapeHtml(id) +
        "\">Copy</button>" +
        "<button type=\"button\" class=\"iv-btn-ghost\" data-act=\"optout\" data-id=\"" +
        escapeHtml(id) +
        "\">Mark opted out</button>" +
        "</div></article>"
      );
    });
    els.followups.innerHTML =
      "<h3 class=\"az-batch-title\">Follow-ups (" +
      rows.length +
      ")</h3>" +
      "<p class=\"az-hint\">Best 4–7 days after first contact. One follow-up per business. Review and send it yourself.</p>" +
      cards.join("");
  }

  function renderAll() {
    if (els.compliance) els.compliance.textContent = COMPLIANCE;
    maybeComplete(viewRegion);
    updateFlags();
    renderComplete();
    renderStats();
    renderBatch();
    renderFollowups();
    renderAlt();
    renderLog();
  }

  function refreshAfterLog() {
    maybeComplete(viewRegion);
    renderAll();
    notifyGlobe();
  }

  function handleAction(act, id, ev) {
    const lead = leadByKey(id);
    if (!lead) return;
    if (act === "fu-copy") {
      if (!canFollowUp(lead)) return;
      const f = followUpFields(id);
      const built = buildFollowUp(lead);
      const text = (f.subject || built.subject) + "\n\n" + (f.body || built.body);
      const done = () => {
        logEntry(lead, "follow-up", "copy");
        refreshAfterLog();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        done();
      }
      return;
    }
    if (act === "copy") {
      const f = draftFields(id);
      const text = (f.subject || "") + "\n\n" + (f.body || "");
      const done = () => {
        logEntry(lead, "contacted", "copy");
        refreshAfterLog();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        done();
      }
      return;
    }
    if (act === "sent") {
      logEntry(lead, "contacted", "sent");
      refreshAfterLog();
      return;
    }
    if (act === "optout") {
      logEntry(lead, "opted-out", "opt-out");
      refreshAfterLog();
      return;
    }
    if (act === "skip") {
      const day = todayStamp();
      if (!store.batches[viewRegion]) store.batches[viewRegion] = {};
      const cur = store.batches[viewRegion][day];
      if (cur && Array.isArray(cur.ids)) {
        cur.ids = cur.ids.filter((x) => x !== id);
        saveStore();
      }
      refreshAfterLog();
      return;
    }
    if (act === "mailto") {
      const f = draftFields(id);
      const a = ev && ev.currentTarget;
      if (a && a.tagName === "A") a.href = mailtoHref(lead.email, f.subject, f.body);
      logEntry(lead, "contacted", "mailto");
      refreshAfterLog();
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    download(blob, "outreach-log.json");
  }

  function exportCSV() {
    const header = "id,name,email,region,status,date,via";
    const lines = store.entries.map((e) =>
      [e.id, e.name, e.email, e.region, e.status, e.date, e.via].map((x) => csvCell(x)).join(",")
    );
    const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv" });
    download(blob, "outreach-log.csv");
  }

  function csvCell(x) {
    const s = String(x == null ? "" : x);
    if (/[",\n]/.test(s)) return "\"" + s.replace(/"/g, "\"\"") + "\"";
    return s;
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        if (file.name.toLowerCase().endsWith(".csv") || text.trim().indexOf("id,") === 0) {
          importCsv(text);
        } else {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.entries)) {
            store.entries = store.entries.concat(parsed.entries.map((e) => Object.assign({ region: FIRST_REGION }, e)));
            if (parsed.profile) store.profile = Object.assign(store.profile, parsed.profile);
            if (parsed.batches) store.batches = Object.assign(store.batches, migrateBatches(parsed.batches));
            if (Array.isArray(parsed.completedRegions)) {
              parsed.completedRegions.forEach((id) => {
                if (store.completedRegions.indexOf(id) === -1) store.completedRegions.push(id);
              });
            }
          } else if (Array.isArray(parsed)) {
            store.entries = store.entries.concat(parsed);
          } else {
            throw new Error("Unrecognized JSON");
          }
        }
        saveStore();
        fillProfileForm();
        refreshAfterLog();
      } catch (e) {
        alert("Could not import that file: " + (e.message || e));
      }
    };
    reader.readAsText(file);
  }

  function importCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    const header = lines[0].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const idx = (n) => header.findIndex((h) => h.toLowerCase() === n);
    lines.slice(1).forEach((line) => {
      const cols = splitCsvLine(line);
      store.entries.push({
        id: cols[idx("id")] || "",
        name: cols[idx("name")] || "",
        email: cols[idx("email")] || "",
        region: cols[idx("region")] || FIRST_REGION,
        status: cols[idx("status")] || "contacted",
        date: cols[idx("date")] || nowIso(),
        via: cols[idx("via")] || "import",
      });
    });
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === "\"" && line[i + 1] === "\"") {
          cur += "\"";
          i += 1;
        } else if (ch === "\"") q = false;
        else cur += ch;
      } else if (ch === "\"") q = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function setOpen(on) {
    if (!els.desk) return;
    if (els.deskModal) els.deskModal.hidden = !on;
    els.desk.hidden = !on;
    if (els.panel) els.panel.classList.remove("has-outreach");
    document.body.classList.toggle("az-outreach-open", !!on);
    document.documentElement.dataset.azOutreach = on ? "open" : "closed";
    if (on) {
      document.documentElement.dataset.listOpen = "az-outreach";
      try { els.desk.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  async function openDesk() {
    const id = selectedId || FIRST_REGION;
    if (!outreachAllowed(id)) return;
    if (window.LeadGlobe && typeof window.LeadGlobe.closeLeadModal === "function") {
      window.LeadGlobe.closeLeadModal();
    }
    viewRegion = id;
    if (store.activeRegion !== id) {
      store.activeRegion = id;
      saveStore();
    }
    await ensureData(id);
    fillProfileForm();
    if (!isRegionComplete(id) && !todaysBatch()) buildToday(false);
    renderAll();
    setOpen(true);
    notifyGlobe();
    if (els.desk && els.desk.scrollTo) els.desk.scrollTop = 0;
    if (els.desk && document.getElementById("az-desk-body") && document.getElementById("az-desk-body").scrollTo) {
      document.getElementById("az-desk-body").scrollTop = 0;
    }
  }

  function closeDesk() {
    setOpen(false);
  }

  function syncRegion(id) {
    selectedId = id || "";
    const allowed = outreachAllowed(id);
    if (els.open) els.open.hidden = !allowed;
    if (id !== viewRegion && els.desk && !els.desk.hidden) closeDesk();
    document.documentElement.dataset.azButton = allowed ? "on" : "off";
    updateFlags();
  }

  function bind() {
    bindEls();
    if (!els.open) return;
    store = loadStore();
    fillProfileForm();
    if (els.compliance) els.compliance.textContent = COMPLIANCE;
    const params = new URLSearchParams(window.location.search);
    const debugOn = params.get("outreachDebug") === "1" || params.get("debug") === "1";
    if (els.debugComplete) {
      els.debugComplete.hidden = !debugOn;
      els.debugComplete.addEventListener("click", () => {
        debugMarkRegionComplete(viewRegion || selectedId || FIRST_REGION);
      });
    }
    els.open.addEventListener("click", () => openDesk());
    if (els.back) els.back.addEventListener("click", () => closeDesk());
    if (els.deskClose) els.deskClose.addEventListener("click", () => closeDesk());
    if (els.deskBackdrop) els.deskBackdrop.addEventListener("click", () => closeDesk());
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.deskModal && !els.deskModal.hidden) {
        const chooser = document.getElementById("mail-chooser");
        const gate = document.getElementById("az-gate");
        if ((chooser && !chooser.hidden) || (gate && !gate.hidden)) return;
        closeDesk();
      }
    });
    if (els.build) {
      els.build.addEventListener("click", async () => {
        await ensureData(viewRegion);
        readProfileForm();
        buildToday(false);
        renderAll();
      });
    }
    ["name", "email", "address", "signature", "size"].forEach((k) => {
      if (els[k]) {
        els[k].addEventListener("change", () => {
          readProfileForm();
          renderAll();
        });
        els[k].addEventListener("input", () => {
          readProfileForm();
          updateSettingsNote();
        });
      }
    });
    if (els.batch) {
      els.batch.addEventListener("click", (e) => {
        const use = e.target.closest && e.target.closest(".az-mail-use, .az-mail-change");
        if (use) {
          e.preventDefault();
          if (use.disabled) return;
          const id = use.getAttribute("data-id");
          openDraftChooser(id, use.classList.contains("az-mail-change") ? "change" : "use");
          return;
        }
        const btn = e.target.closest && e.target.closest("[data-act]");
        if (btn) handleAction(btn.getAttribute("data-act"), btn.getAttribute("data-id"), e);
      });
      els.batch.addEventListener("input", (e) => {
        const t = e.target;
        if (!t || !t.id) return;
        const art = t.closest(".az-draft");
        if (!art) return;
        const id = art.getAttribute("data-az-id");
        const lead = leadByKey(id);
        const a = art.querySelector("a.az-mailto");
        if (lead && a) {
          const f = draftFields(id);
          a.href = mailtoHref(lead.email, f.subject, f.body);
        }
      });
    }
    if (els.followups) {
      els.followups.addEventListener("click", (e) => {
        const use = e.target.closest && e.target.closest(".az-mail-use, .az-mail-change");
        if (use) {
          e.preventDefault();
          if (use.disabled) return;
          const id = use.getAttribute("data-id");
          openFollowUpChooser(id, use.classList.contains("az-mail-change") ? "change" : "use");
          return;
        }
        const btn = e.target.closest && e.target.closest("[data-act]");
        if (btn) handleAction(btn.getAttribute("data-act"), btn.getAttribute("data-id"), e);
      });
    }
    if (els.alt) {
      els.alt.addEventListener("click", (e) => {
        const btn = e.target.closest && e.target.closest("[data-act]");
        if (btn) handleAction(btn.getAttribute("data-act"), btn.getAttribute("data-id"), e);
      });
    }
    if (els.exportJson) els.exportJson.addEventListener("click", exportJSON);
    if (els.exportCsv) els.exportCsv.addEventListener("click", exportCSV);
    if (els.import) {
      els.import.addEventListener("change", () => {
        const file = els.import.files && els.import.files[0];
        if (file) importFile(file);
        els.import.value = "";
      });
    }
    updateFlags();
  }

  document.addEventListener("leadglobe:mail-provider", () => {
    if (els.batch && els.desk && !els.desk.hidden) renderAll();
  });

  function debugMarkRegionComplete(id) {

    const rid = id || viewRegion || FIRST_REGION;
    markComplete(rid, "debug");
    renderAll();
    notifyGlobe();
    return true;
  }

  function debugClearComplete(id) {
    const rid = id || viewRegion || FIRST_REGION;
    store.completedRegions = (store.completedRegions || []).filter((x) => x !== rid);
    saveStore();
    renderAll();
    notifyGlobe();
    return true;
  }

  function debugUpsertLog(entry) {
    store.entries.push(
      Object.assign(
        { id: "", name: "", email: "", region: viewRegion || FIRST_REGION, status: "contacted", date: nowIso(), via: "debug" },
        entry || {}
      )
    );
    saveStore();
    maybeComplete(viewRegion);
    renderAll();
    return true;
  }


  function profileReady() {
    const p = store.profile || {};
    return !!(p.name || "").trim() && !!(p.address || "").trim();
  }

  function usesOutreachDraft(lead, regionId) {
    if (!lead || !String(lead.email || "").trim()) return false;
    const region = regionId || lead.regionId || selectedId || "";
    return isUsState(region);
  }

  function statusDate(lead, status) {
    const email = String((lead && lead.email) || "").toLowerCase().trim();
    const name = normName(lead && lead.name);
    const key = (lead && lead.key) || "";
    const hits = store.entries.filter((e) => {
      if (e.status !== status) return false;
      if (key && e.id && e.id === key) return true;
      if (email && e.email && String(e.email).toLowerCase().trim() === email) return true;
      if (name && e.name && normName(e.name) === name) return true;
      return false;
    });
    const last = hits[hits.length - 1];
    return last ? last.date : "";
  }

  function formatStamp(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-US", {
        timeZone: TZ,
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (e) {
      return String(iso);
    }
  }

  function draftForLead(lead) {
    if (!lead || !String(lead.email || "").trim()) return null;
    const built = buildDraft(lead);
    const f = lead.key ? draftFields(lead.key) : { subject: "", body: "" };
    const subject = f.subject || built.subject;
    const body = f.body || built.body;
    return {
      lead: lead,
      to: lead.email,
      subject: subject,
      body: body,
      variation: built.variation,
    };
  }

  let gateRoot = null;
  let gateOnConfirm = null;
  let gateOnCancel = null;

  function ensureGate() {
    if (gateRoot && document.body.contains(gateRoot)) return gateRoot;
    gateRoot = document.createElement("div");
    gateRoot.id = "az-gate";
    gateRoot.className = "mail-chooser az-gate";
    gateRoot.hidden = true;
    gateRoot.innerHTML =
      '<div class="mail-chooser-backdrop" data-act="cancel"></div>' +
      '<div class="mail-chooser-panel" id="az-gate-panel" role="dialog" aria-modal="true" aria-labelledby="az-gate-title" tabindex="-1">' +
      '<div class="mail-chooser-head"><p class="kicker" id="az-gate-title"></p>' +
      '<button type="button" class="mail-chooser-x" data-act="cancel" aria-label="Close">×</button></div>' +
      '<p class="az-gate-body" id="az-gate-body"></p>' +
      '<div class="az-gate-fields" id="az-gate-fields" hidden>' +
      '<label class="field">Your name<input id="az-gate-name" type="text" autocomplete="name"></label>' +
      '<label class="field">Physical mailing address (required for CAN-SPAM)' +
      '<textarea id="az-gate-address" rows="2" placeholder="Street, city, state, ZIP"></textarea></label>' +
      '<label class="field">Your email (optional)<input id="az-gate-email" type="email" autocomplete="email"></label>' +
      '</div>' +
      '<p class="az-gate-error" id="az-gate-error" hidden></p>' +
      '<div class="mail-chooser-foot">' +
      '<button type="button" class="iv-btn" id="az-gate-confirm" data-act="confirm">Continue</button>' +
      '<button type="button" class="iv-btn-ghost" id="az-gate-cancel" data-act="cancel">Cancel</button>' +
      "</div></div>";
    document.body.appendChild(gateRoot);
    gateRoot.addEventListener("click", (e) => {
      const act = e.target && e.target.closest && e.target.closest("[data-act]");
      if (!act || !gateRoot.contains(act)) return;
      const kind = act.getAttribute("data-act");
      if (kind === "confirm") confirmGate();
      else if (kind === "cancel") closeGate(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && gateRoot && !gateRoot.hidden) {
        e.preventDefault();
        closeGate(true);
      }
    });
    return gateRoot;
  }

  function setGateOpen(on, kind) {
    ensureGate();
    gateRoot.hidden = !on;
    document.body.classList.toggle("az-gate-open", !!on);
    document.documentElement.dataset.azGate = on ? (kind || "open") : "closed";
  }

  function closeGate(runCancel) {
    const cancel = gateOnCancel;
    gateOnConfirm = null;
    gateOnCancel = null;
    setGateOpen(false, "closed");
    if (runCancel && typeof cancel === "function") cancel();
  }

  function confirmGate() {
    const kind = document.documentElement.dataset.azGate;
    if (kind === "profile") {
      const nameEl = document.getElementById("az-gate-name");
      const addrEl = document.getElementById("az-gate-address");
      const emailEl = document.getElementById("az-gate-email");
      const err = document.getElementById("az-gate-error");
      const name = nameEl ? nameEl.value.trim() : "";
      const address = addrEl ? addrEl.value.trim() : "";
      const email = emailEl ? emailEl.value.trim() : "";
      if (!name || !address) {
        if (err) {
          err.hidden = false;
          err.textContent = "Add your name and a physical mailing address before opening a draft. CAN-SPAM requires a valid address in commercial email.";
        }
        return;
      }
      store.profile.name = name;
      store.profile.address = address;
      if (emailEl) store.profile.email = email;
      saveStore();
      fillProfileForm();
    }
    const fn = gateOnConfirm;
    gateOnConfirm = null;
    gateOnCancel = null;
    setGateOpen(false, "closed");
    if (typeof fn === "function") fn();
  }

  function showGate(opts) {
    ensureGate();
    const o = opts || {};
    const title = document.getElementById("az-gate-title");
    const body = document.getElementById("az-gate-body");
    const fields = document.getElementById("az-gate-fields");
    const err = document.getElementById("az-gate-error");
    const confirmBtn = document.getElementById("az-gate-confirm");
    const cancelBtn = document.getElementById("az-gate-cancel");
    if (title) title.textContent = o.title || "";
    if (body) body.textContent = o.body || "";
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (fields) fields.hidden = o.kind !== "profile";
    if (o.kind === "profile") {
      const nameEl = document.getElementById("az-gate-name");
      const addrEl = document.getElementById("az-gate-address");
      const emailEl = document.getElementById("az-gate-email");
      if (nameEl) nameEl.value = (store.profile.name || "").trim();
      if (addrEl) addrEl.value = (store.profile.address || "").trim();
      if (emailEl) emailEl.value = (store.profile.email || "").trim();
    }
    if (confirmBtn) {
      confirmBtn.textContent = o.confirmLabel || "Continue";
      confirmBtn.hidden = !!o.hideConfirm;
    }
    if (cancelBtn) {
      cancelBtn.textContent = o.cancelLabel || "Cancel";
      cancelBtn.hidden = !!o.hideCancel;
    }
    gateOnConfirm = o.onConfirm || null;
    gateOnCancel = o.onCancel || null;
    setGateOpen(true, o.kind || "open");
    const panel = document.getElementById("az-gate-panel");
    if (panel && panel.focus) panel.focus();
    if (o.kind === "profile") {
      const first = document.getElementById((store.profile.name || "").trim() ? "az-gate-address" : "az-gate-name");
      if (first && first.focus) first.focus();
    }
  }

  function gateForLead(lead, opts, proceed) {
    if (!lead || typeof proceed !== "function") return;
    const fromDesk = !!(opts && opts.fromDesk);
    const st = statusOf(lead);
    if (st === "opted-out") {
      const when = formatStamp(statusDate(lead, "opted-out"));
      showGate({
        kind: "opted-out",
        title: "This business opted out",
        body:
          (lead.name || "This business") +
          " opted out" +
          (when ? " on " + when : "") +
          ". Lead Globe will not open a draft. Honor the opt-out and do not email them.",
        confirmLabel: "OK",
        hideCancel: true,
      });
      return;
    }
    const afterProfile = function () {
      if (st === "contacted" && !fromDesk) {
        const when = formatStamp(statusDate(lead, "contacted"));
        showGate({
          kind: "contacted",
          title: "Already contacted",
          body:
            "You already marked " +
            (lead.name || "this business") +
            " as contacted" +
            (when ? " on " + when : "") +
            ". Open another prefilled draft anyway? This will log another contacted entry if you open it.",
          confirmLabel: "Open anyway",
          cancelLabel: "Cancel",
          onConfirm: proceed,
        });
        return;
      }
      proceed();
    };
    if (!profileReady()) {
      showGate({
        kind: "profile",
        title: "Your sending details",
        body: "Add your name and a physical mailing address before opening a draft. They appear in the signature. CAN-SPAM requires a valid address in commercial email. Nothing is sent automatically.",
        confirmLabel: "Save and continue",
        cancelLabel: "Cancel",
        onConfirm: afterProfile,
      });
      return;
    }
    afterProfile();
  }

  function openLeadMail(lead, opts) {
    const o = opts || {};
    let pack = null;
    if (o.payload && (o.payload.subject != null || o.payload.body != null)) {
      pack = {
        lead: lead,
        to: lead.email || "",
        subject: o.payload.subject || "",
        body: o.payload.body || "",
      };
    } else if (o.kind === "follow-up") {
      const built = buildFollowUp(lead);
      const f = lead && lead.key ? followUpFields(lead.key) : { subject: "", body: "" };
      pack = {
        lead: lead,
        to: lead.email || "",
        subject: f.subject || built.subject,
        body: f.body || built.body,
      };
    } else {
      pack = draftForLead(lead);
    }
    if (!pack) return false;
    const logStatus = o.logStatus || (o.kind === "follow-up" ? "follow-up" : "contacted");
    if (logStatus === "follow-up" && hasFollowUp(lead)) return false;
    gateForLead(lead, o, function () {
      const extra = { logStatus: logStatus };
      if (o.onCopy) extra.onCopy = o.onCopy;
      launchDraft(pack, o.mode || "use", extra);
    });
    return true;
  }

  const api = {
    DISCLAIMER: DISCLAIMER,
    DISCLAIMER_CONFIRMED: DISCLAIMER_CONFIRMED,
    INVITE: INVITE,
    PROCESS: PROCESS,
    syncRegion: syncRegion,
    open: openDesk,
    close: closeDesk,
    isOpen: () => !!(els.desk && !els.desk.hidden),
    ensureData: ensureData,
    buildToday: buildToday,
    getBatch: () => todaysBatch(),
    getStats: counts,
    getEligible: (id) => eligible(id).map((l) => l.key),
    getLead: leadByKey,
    getDraft: (id) => {
      const lead = leadByKey(id);
      if (!lead) return null;
      const built = buildDraft(lead);
      const f = draftFields(id);
      const subject = f.subject || built.subject;
      const body = f.body || built.body;
      return {
        id: id,
        name: lead.name,
        email: lead.email,
        subject: subject,
        body: body,
        mailto: mailtoHref(lead.email, subject, body),
        compose: window.MailChooser ? MailChooser.buildAll({ to: lead.email, subject: subject, body: body }) : null,
        variation: built.variation,
        subjectVar: built.subjectVar,
        openingVar: built.openingVar,
        category: built.category,
        kind: built.kind,
        mainBody: built.mainBody,
        wordCount: built.wordCount,
      };
    },
    getFollowUp: (id) => {
      const lead = typeof id === "object" && id ? id : leadByKey(id);
      if (!lead) return null;
      const built = buildFollowUp(lead);
      const f = lead.key ? followUpFields(lead.key) : { subject: "", body: "" };
      const subject = f.subject || built.subject;
      const body = f.body || built.body;
      return Object.assign({}, built, {
        id: lead.key,
        name: lead.name,
        email: lead.email,
        subject: subject,
        body: body,
        mailto: mailtoHref(lead.email, subject, body),
        compose: window.MailChooser ? MailChooser.buildAll({ to: lead.email, subject: subject, body: body }) : null,
      });
    },
    canFollowUp: canFollowUp,
    hasFollowUp: hasFollowUp,
    daysSinceContact: daysSinceContact,
    followUpCandidates: () => followUpCandidates().map((l) => l.key),
    categoryKind: categoryKind,
    categoryInfo: categoryInfo,
    subjectLines: subjectLines,
    buildDraft: buildDraft,
    buildFollowUp: buildFollowUp,
    buildCallScript: buildCallScript,
    buildVoicemail: buildVoicemail,
    isStaleDraftText: isStaleDraftText,
    DRAFT_TEMPLATE_VERSION: DRAFT_TEMPLATE_VERSION,
    markSent: (id) => handleAction("sent", id),
    markOptedOut: (id) => handleAction("optout", id),
    skip: (id) => handleAction("skip", id),
    getLog: () => store.entries.slice(),
    getProfile: () => Object.assign({}, store.profile),
    setProfile: (p) => {
      store.profile = Object.assign(store.profile, p || {});
      saveStore();
      fillProfileForm();
    },
    isUsState: isUsState,
    isRegionComplete: isRegionComplete,
    arizonaComplete: arizonaComplete,
    outreachAllowed: outreachAllowed,
    getActiveRegion: () => store.activeRegion,
    getCompletedRegions: () => (store.completedRegions || []).slice(),
    getViewRegion: () => viewRegion,
    usesOutreachDraft: usesOutreachDraft,
    profileReady: profileReady,
    statusOf: statusOf,
    statusDate: statusDate,
    draftForLead: draftForLead,
    openLeadMail: openLeadMail,
    formatStamp: formatStamp,
    debugMarkRegionComplete: debugMarkRegionComplete,
    debugClearComplete: debugClearComplete,
    debugUpsertLog: debugUpsertLog,
  };

  function attachLeadGlobe() {
    window.AzOutreach = api;
    window.LeadGlobe = window.LeadGlobe || {};
    window.LeadGlobe.openOutreach = () => openDesk();
    window.LeadGlobe.closeOutreach = () => closeDesk();
    window.LeadGlobe.azOutreach = api;
  }

  function boot() {
    store = loadStore();
    try {
      localStorage.setItem(DRAFT_VER_KEY, DRAFT_TEMPLATE_VERSION);
    } catch (e) {}
    bind();
    attachLeadGlobe();
    notifyGlobe();
    const params = new URLSearchParams(window.location.search);
    const shot = (params.get("shot") || "").toLowerCase();
    if (shot === "az-outreach" || params.get("outreach") === "1") {
      const start = () => {
        if (window.LeadGlobe && window.LeadGlobe.selectRegion) {
          window.LeadGlobe.selectRegion(FIRST_REGION);
        }
        setTimeout(() => openDesk(), 700);
      };
      if (document.documentElement.dataset.globe === "ready") start();
      else setTimeout(start, 800);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
