/* Shared email-provider chooser. Nothing is sent automatically. */
(function () {
  const STORE_KEY = "leadglobe:mail-provider:v1";
  const WEB_LIMIT = 8000;
  const MAILTO_LIMIT = 2000;

  const PROVIDERS = [
    {
      id: "gmail",
      label: "Gmail",
      kind: "web",
      build: (p) =>
        "https://mail.google.com/mail/?view=cm&fs=1&to=" +
        enc(p.to) +
        "&su=" +
        enc(p.subject) +
        "&body=" +
        enc(p.body),
    },
    {
      id: "outlook-live",
      label: "Outlook.com (personal)",
      kind: "web",
      build: (p) =>
        "https://outlook.live.com/mail/0/deeplink/compose?to=" +
        enc(p.to) +
        "&subject=" +
        enc(p.subject) +
        "&body=" +
        enc(p.body),
    },
    {
      id: "outlook-365",
      label: "Outlook / Microsoft 365 (work)",
      kind: "web",
      build: (p) =>
        "https://outlook.office.com/mail/deeplink/compose?to=" +
        enc(p.to) +
        "&subject=" +
        enc(p.subject) +
        "&body=" +
        enc(p.body),
    },
    {
      id: "yahoo",
      label: "Yahoo Mail",
      kind: "web",
      build: (p) =>
        "https://compose.mail.yahoo.com/?to=" +
        enc(p.to) +
        "&subject=" +
        enc(p.subject) +
        "&body=" +
        enc(p.body),
    },
    {
      id: "mailto",
      label: "Default email app (mailto)",
      kind: "mailto",
      build: (p) =>
        "mailto:" +
        enc(p.to) +
        "?subject=" +
        enc(p.subject) +
        "&body=" +
        enc(p.body),
    },
  ];

  let session = null;
  let root, panel, list, warn, backdrop;

  function enc(s) {
    return encodeURIComponent(s == null ? "" : String(s));
  }

  function byId(id) {
    return PROVIDERS.find((p) => p.id === id) || null;
  }

  function getPreferred() {
    try {
      const id = localStorage.getItem(STORE_KEY) || "";
      return byId(id) ? id : "";
    } catch (e) {
      return "";
    }
  }

  function setPreferred(id) {
    const ok = !id || byId(id);
    if (!ok) return getPreferred();
    try {
      if (id) localStorage.setItem(STORE_KEY, id);
      else localStorage.removeItem(STORE_KEY);
    } catch (e) {}
    document.documentElement.dataset.mailProvider = id || "";
    try {
      document.dispatchEvent(new CustomEvent("leadglobe:mail-provider", { detail: { id: id || "" } }));
    } catch (e) {}
    const sel = document.getElementById("az-mail-provider");
    if (sel && sel.value !== (id || "")) sel.value = id || "";
    return id || "";
  }

  function limitFor(kind) {
    return kind === "mailto" ? MAILTO_LIMIT : WEB_LIMIT;
  }

  function inspect(id, payload) {
    const p = byId(id);
    if (!p) return null;
    const url = p.build(payload || {});
    const limit = limitFor(p.kind);
    return {
      id: p.id,
      label: p.label,
      kind: p.kind,
      url: url,
      length: url.length,
      tooLong: url.length > limit,
      limit: limit,
    };
  }

  function buildAll(payload) {
    const out = {};
    PROVIDERS.forEach((p) => {
      out[p.id] = inspect(p.id, payload);
    });
    return out;
  }

  function openUrl(info) {
    if (!info || !info.url) return;
    document.documentElement.dataset.lastMailUrl = info.url;
    document.documentElement.dataset.lastMailProvider = info.id;
    if (typeof api.openUrl === "function") {
      api.openUrl(info.url, info.kind, info.id);
      return;
    }
    if (info.kind === "web") {
      window.open(info.url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = info.url;
    }
  }

  function ensureDom() {
    if (root && document.body.contains(root)) return;
    root = document.createElement("div");
    root.className = "mail-chooser";
    root.id = "mail-chooser";
    root.hidden = true;
    root.innerHTML =
      '<div class="mail-chooser-backdrop" id="mail-chooser-backdrop"></div>' +
      '<div class="mail-chooser-panel" id="mail-chooser-panel" role="dialog" aria-modal="true" aria-labelledby="mail-chooser-title" tabindex="-1">' +
      '<div class="mail-chooser-head">' +
      '<div class="kicker" id="mail-chooser-title">Open this draft in</div>' +
      '<button type="button" class="mail-chooser-x" id="mail-chooser-x" aria-label="Close">×</button>' +
      "</div>" +
      '<p class="mail-chooser-warn" id="mail-chooser-warn" hidden></p>' +
      '<div class="mail-chooser-list" id="mail-chooser-list"></div>' +
      '<div class="mail-chooser-foot">' +
      '<button type="button" class="iv-btn-ghost" data-act="copy">Copy draft</button>' +
      '<button type="button" class="iv-btn-ghost" data-act="cancel">Cancel</button>' +
      "</div></div>";
    document.body.appendChild(root);
    backdrop = root.querySelector(".mail-chooser-backdrop");
    panel = root.querySelector(".mail-chooser-panel");
    list = root.querySelector(".mail-chooser-list");
    warn = root.querySelector(".mail-chooser-warn");
    backdrop.addEventListener("click", close);
    root.querySelector("#mail-chooser-x").addEventListener("click", close);
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act && root.contains(act)) {
        const kind = act.getAttribute("data-act");
        if (kind === "cancel") {
          e.preventDefault();
          close();
          return;
        }
        if (kind === "copy") {
          e.preventDefault();
          copyDraft();
          return;
        }
      }
      const btn = e.target.closest("[data-provider]");
      if (btn && root.contains(btn)) {
        e.preventDefault();
        choose(btn.getAttribute("data-provider"), { force: btn.getAttribute("data-force") === "1" });
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root && !root.hidden) {
        e.preventDefault();
        close();
      }
    });
  }

  function warningText(infos) {
    const bad = infos.filter((i) => i.tooLong);
    if (!bad.length) return "";
    const mailto = bad.find((i) => i.kind === "mailto");
    const web = bad.filter((i) => i.kind === "web");
    const parts = [];
    if (mailto) {
      parts.push(
        "This draft is too long for the default email app (mailto is about " +
          mailto.length.toLocaleString("en-US") +
          " characters; many apps cap around " +
          MAILTO_LIMIT.toLocaleString("en-US") +
          "). Use Copy and paste it in, or try a web provider."
      );
    }
    if (web.length) {
      parts.push(
        "This draft is also too long for " +
          web.map((i) => i.label).join(", ") +
          " (over about " +
          WEB_LIMIT.toLocaleString("en-US") +
          " characters). Copy the draft and paste it into your email instead."
      );
    }
    return parts.join(" ");
  }

  function renderList() {
    const pref = getPreferred();
    const payload = (session && session.payload) || { to: "", subject: "", body: "" };
    const infos = PROVIDERS.map((p) => inspect(p.id, payload));
    const ordered = infos.slice().sort((a, b) => {
      if (a.id === pref) return -1;
      if (b.id === pref) return 1;
      return 0;
    });
    const msg = warningText(infos);
    if (warn) {
      warn.hidden = !msg;
      warn.textContent = msg;
    }
    list.innerHTML = ordered
      .map((i) => {
        const preferred = i.id === pref;
        const cls =
          "mail-chooser-option" +
          (preferred ? " is-preferred" : "") +
          (i.tooLong ? " is-long" : "");
        const rec = preferred ? '<span class="mail-chooser-rec">Last used</span>' : "";
        const note = i.tooLong
          ? '<span class="mail-chooser-limit">Too long — Copy the draft, or click again to try anyway</span>'
          : "";
        return (
          '<button type="button" class="' +
          cls +
          '" data-provider="' +
          i.id +
          '" data-force="' +
          (i.tooLong ? "0" : "1") +
          '"><span class="mail-chooser-name">' +
          escapeHtml(i.label) +
          rec +
          "</span>" +
          note +
          "</button>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function copyDraft() {
    if (!session) return;
    const p = session.payload || {};
    const text = (p.subject ? p.subject + "\n\n" : "") + (p.body || "");
    const done = () => {
      if (session && typeof session.onCopy === "function") session.onCopy(text);
      close();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  }

  function choose(id, opts) {
    if (!session) return null;
    const info = inspect(id, session.payload);
    if (!info) return null;
    if (info.tooLong && !(opts && opts.force)) {
      renderList();
      if (warn) {
        warn.hidden = false;
        if (!warn.textContent) warn.textContent = warningText([info]);
      }
      const btn = list && list.querySelector('[data-provider="' + id + '"]');
      if (btn) {
        btn.setAttribute("data-force", "1");
        const n = btn.querySelector(".mail-chooser-limit");
        if (n) n.textContent = "Click again to try anyway";
      }
      return info;
    }
    setPreferred(id);
    if (typeof session.onOpened === "function") session.onOpened(info);
    openUrl(info);
    close();
    return info;
  }

  function open(payload, opts) {
    ensureDom();
    session = {
      payload: payload || { to: "", subject: "", body: "" },
      onOpened: opts && opts.onOpened,
      onCopy: opts && opts.onCopy,
    };
    renderList();
    root.hidden = false;
    document.body.classList.add("mail-chooser-open");
    document.documentElement.dataset.mailChooser = "open";
    if (panel && panel.focus) {
      try {
        panel.focus({ preventScroll: true });
      } catch (e) {
        panel.focus();
      }
    }
    return true;
  }

  function close() {
    if (root) root.hidden = true;
    document.body.classList.remove("mail-chooser-open");
    document.documentElement.dataset.mailChooser = "closed";
    session = null;
  }

  function isOpen() {
    return !!(root && !root.hidden);
  }

  function launch(id, payload, opts) {
    const info = inspect(id, payload);
    if (!info) return null;
    if (info.tooLong && !(opts && opts.force)) {
      open(payload, opts);
      return info;
    }
    setPreferred(id);
    if (opts && typeof opts.onOpened === "function") opts.onOpened(info);
    openUrl(info);
    return info;
  }

  function preferredLabel() {
    const p = byId(getPreferred());
    return p ? p.label : "";
  }

  function useButtonLabel() {
    const name = preferredLabel();
    return name ? "Use " + name : "";
  }

  const api = {
    providers: PROVIDERS,
    WEB_LIMIT: WEB_LIMIT,
    MAILTO_LIMIT: MAILTO_LIMIT,
    getPreferred: getPreferred,
    setPreferred: setPreferred,
    preferredLabel: preferredLabel,
    useButtonLabel: useButtonLabel,
    inspect: inspect,
    buildAll: buildAll,
    open: open,
    close: close,
    isOpen: isOpen,
    choose: choose,
    launch: launch,
    openUrl: null,
    beforeMailto: null,
  };

  function syncSelect() {
    const sel = document.getElementById("az-mail-provider");
    if (!sel) return;
    sel.value = getPreferred();
    if (sel.dataset.bound) return;
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => setPreferred(sel.value || ""));
  }

  function decodePart(s) {
    try {
      return decodeURIComponent(String(s || "").replace(/\+/g, "%20"));
    } catch (e) {
      return String(s || "");
    }
  }

  function parseMailto(href) {
    if (!href) return null;
    const raw = String(href).trim();
    if (!/^mailto:/i.test(raw)) return null;
    const rest = raw.replace(/^mailto:/i, "");
    const q = rest.indexOf("?");
    const toPart = q === -1 ? rest : rest.slice(0, q);
    const qs = q === -1 ? "" : rest.slice(q + 1);
    let params = {};
    try {
      params = Object.fromEntries(new URLSearchParams(qs).entries());
    } catch (e) {
      params = {};
    }
    const to = decodePart(toPart).split(",")[0].trim();
    return {
      to: to,
      subject: decodePart(params.subject || params.su || ""),
      body: decodePart(params.body || ""),
    };
  }

  function interceptMailto(e) {
    if (e.defaultPrevented) return;
    if (e.button != null && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest && e.target.closest('a[href^="mailto:" i]');
    if (!a || (root && root.contains(a))) return;
    const payload = parseMailto(a.getAttribute("href"));
    if (!payload || !payload.to) return;
    if (typeof api.beforeMailto === "function") {
      try {
        if (api.beforeMailto(payload, a, e) === true) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } catch (err) {}
    }
    e.preventDefault();
    e.stopPropagation();
    const pref = getPreferred();
    if (pref) launch(pref, payload);
    else open(payload);
  }

  function boot() {
    document.documentElement.dataset.mailProvider = getPreferred();
    syncSelect();
    document.addEventListener("click", interceptMailto, true);
  }

  window.MailChooser = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
