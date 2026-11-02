// hq.js - Vault HQ, the vault's home screen: what to do next, what needs a decision from you, what the vault is
// telling you, and where each project stands. Four screens (Home, Today, Needs you, Projects) over a week strip and a
// dock. Every list here is the one Today list (VGRules.todayList) filtered by its group, and every button is a shared
// action (VGActions.runToday / runMore), so HQ, the graph and the sidebar agree. Plain DOM: the plugin's HQ view and
// the standalone test page mount the same thing. The build puts this after actions.js.
//   mountVaultHQ(root, data, opts) -> { update(data, state), setScreen(name), screen(), destroy() }
// opts: state { review, hidden } (the shared file: Later/Done marks, hidden items) · api (the plugin's viewActions:
// openNote, openDaily, openStandup, setTaskStatus, setTaskField, setNoteStatus, hqMark...) · ask(title, text, ok) / input(title,
// text, placeholder) (else HQ's own dialog) · screen / onScreen(name) (the screen to start on, remembered by the host)
// · onDone(message) (the host logs it) · openGraph() · now (a Date: tests)
function mountVaultHQ(root, data, opts) {
  opts = opts || {};
  const SCREENS = [["home", "Home", "home"], ["today", "Today", "tasks"], ["needs", "Needs you", "inbox"], ["people", "People", "people"], ["projects", "Projects", "folder"], ["calendar", "Calendar", "calendar"]];
  // screens reached from another one (not in the dock): the carried-over sweep, and a report's rows; each has a way back
  const SUB = { session: ["Focus", "today"], threads: ["Threads", "today"], review: ["Weekly review", "today"], wrap: ["Wrap up", "today"], sweep: ["Sweep", "today"], rows: ["Report rows", "needs"], automations: ["Automations", "needs"] };
  const known = s => SCREENS.some(x => x[0] === s) || !!SUB[s];
  const api = opts.api || {};
  let DATA = data || { nodes: [], links: [] }, STATE = opts.state || {}, cur = SCREENS.some(s => s[0] === opts.screen) || opts.screen === "automations" ? opts.screen : "home";
  let kept = new Set(), rowsPath = null;   // the sweep's Keep (this visit only); the report whose rows are open
  let gone = new Set(), feedAt = 0, filter = "active", kindFilter = "all", needFilter = "all", systemFilter = "all",
    globalQuery = "", noteHits = [], noteSearchError = "", searchPending = false, searchTimer = null, searchToken = 0,
    compactProjects = false, drawer = null, focusDrawerOnRender = false, carriedAll = false, clockTimer = null;
  const now = () => opts.now || new Date(), day = () => VGRules.localDay(now());
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + "s"}`;
  const nameOf = p => VGActions.nameOf(p);

  // ---- the one list, and what each screen takes from it
  let LIST = [], BY_KEY = new Map();
  let listStale = true;   // the list is worked out once per change, not once per drawing: it's the costly part on a big vault
  const relist = () => { listStale = true; };
  function compute() {
    if (!listStale) return; listStale = false; threadsCache = null;
    LIST = VGRules.todayList(DATA, { review: STATE.review, hidden: STATE.hidden, today: day(), now: now() }).filter(it => !gone.has(it.key));
    BY_KEY = new Map(LIST.map(it => [it.key, it]));
  }
  const ofGroup = g => LIST.filter(it => it.group === g);
  const ofKind = k => LIST.filter(it => it.kind === k);
  const focus = () => VGRules.hqFocusItems(LIST, STATE.review, day());
  const doNext = () => focus()[0] || LIST.find(it => it.group === "today") || null;
  const hq = () => DATA.hq || null;

  // ---- icons: small line icons drawn here (no icon font outside Obsidian)
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', tasks: '<path d="M4 6h2M4 12h2M4 18h2"/><path d="M9 6h11M9 12h11M9 18h11"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>', folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    journal: '<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    draft: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5"/>', graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8 7l8 1M7 8l2 8M16 10l-5 6"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.8 3.1-6 6.5-6s5.9 2.2 6.5 6"/><path d="M16 5a3.5 3.5 0 0 1 0 6.5M18 14.4c2 .8 3.2 2.7 3.5 5.6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  };
  const icon = (k, s = 18) => `<svg class="vg-hq-ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;
  const KIND_ICON = { inbox: "inbox", task: "check", plan: "tasks", carried: "clock", approval: "key", review: "draft", job: "alert", backlog: "check", report: "eye" };

  // ---- card art: soft hills under a low sun, seeded by the card, tinted from the theme's accent
  const seedOf = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function hills(seed, h = 120) {
    let r = seedOf(seed); const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
    const layer = (y, amp, o) => { let d = `M0 ${h}L0 ${y}`; for (let x = 0; x <= 400; x += 50) d += ` Q${x + 25} ${y - amp * (rnd() - 0.3)} ${x + 50} ${y + amp * (rnd() - 0.5) * 0.6}`; return `<path d="${d} L400 ${h}Z" fill="currentColor" opacity="${o}"/>`; };
    const sx = 260 + rnd() * 110, sy = 38 + rnd() * 16;
    return `<svg class="vg-hq-art" viewBox="0 0 400 ${h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><circle class="vg-hq-sun" cx="${sx}" cy="${sy}" r="16"/>${layer(h * 0.55, 30, 0.22)}${layer(h * 0.7, 24, 0.32)}${layer(h * 0.85, 18, 0.5)}</svg>`;
  }

  // ---- the actions: a context for VGActions, with HQ's own dialog and toast when the host gives none
  const toastEl = document.createElement("div");
  let toastTimer = null;
  function toast(msg, undo, bad) {
    clearTimeout(toastTimer);
    toastEl.className = "vg-hq-toast" + (bad ? " is-bad" : "");
    toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="vg-hq-btn vg-hq-btn-sm" data-undo>Undo</button>' : ""}`;
    toastEl.hidden = false;
    const b = toastEl.querySelector("[data-undo]"); if (b) b.onclick = () => { toastEl.hidden = true; undo(); };
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, undo ? 8000 : 3500);
  }
  function dialog(title, text, ok, withInput) {
    return new Promise(resolve => {
      const box = document.createElement("div"); box.className = "vg-hq-dialog"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", title);
      box.innerHTML = `<div class="vg-hq-dialog-card"><b>${esc(title)}</b><p>${esc(text)}</p>${withInput ? `<input class="vg-hq-input" placeholder="${esc(withInput)}">` : ""}
        <div class="vg-hq-row-end"><button class="vg-hq-btn" data-no>Cancel</button><button class="vg-hq-btn vg-hq-btn-primary" data-ok>${esc(ok || "OK")}</button></div></div>`;
      const end = v => { box.remove(); resolve(v); };
      box.querySelector("[data-no]").onclick = () => end(withInput ? null : false);
      box.querySelector("[data-ok]").onclick = () => end(withInput ? box.querySelector("input").value.trim() : true);
      box.onkeydown = e => { if (e.key === "Escape") end(withInput ? null : false); if (e.key === "Enter" && withInput) end(box.querySelector("input").value.trim()); };
      el.appendChild(box); (box.querySelector("input") || box.querySelector("[data-ok]")).focus();
    });
  }
  const ctx = () => ({
    api, data: DATA,
    ask: opts.ask || ((t, x, ok) => dialog(t, x, ok)),
    input: opts.input || ((t, x, ph) => dialog(t, x, "Reject", ph || "Reason")),
    done: (msg, undo) => { toast(msg, undo); if (opts.onDone) opts.onDone(msg); },
    fail: msg => toast(msg, null, true),
    showRows: path => { rowsPath = path; setScreen("rows"); },
    chooseFolder,
  });
  // where a note can be filed: the folders the vault's notes already live in, biggest first, and a filter to find one
  function chooseFolder(it) {
    const counts = new Map(); (DATA.nodes || []).forEach(n => { const parts = String(n.folder || "").split("/"); [1, 2, 3].forEach(d => { if (parts.length >= d && parts[0]) { const f = parts.slice(0, d).join("/"); counts.set(f, (counts.get(f) || 0) + 1); } }); });
    const inbox = VGRules.folders.inbox, all = [...counts].filter(([f]) => !f.startsWith(inbox) && !f.startsWith(VGRules.folders.archive) && !f.startsWith("_") && f.includes("/")).sort((a, b) => b[1] - a[1]).map(([f]) => f);
    return new Promise(resolve => {
      const box = document.createElement("div"); box.className = "vg-hq-dialog"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "File the note");
      const title = it.title.toLowerCase(), ranked = all.slice().sort((a, b) => (title.includes(b.split("/").pop().toLowerCase().split(" ")[0]) ? 1 : 0) - (title.includes(a.split("/").pop().toLowerCase().split(" ")[0]) ? 1 : 0));
      const list = q => ranked.filter(f => !q || f.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map(f => `<button class="vg-hq-link" data-to="${esc(f)}">${esc(f)}</button>`).join("") || '<p class="vg-hq-ctx-none">No folder matches.</p>';
      box.innerHTML = `<div class="vg-hq-dialog-card"><b>File “${esc(it.title)}”</b><input class="vg-hq-input" placeholder="Filter folders" aria-label="Filter folders"><div class="vg-hq-folderlist">${list("")}</div><div class="vg-hq-row-end"><button class="vg-hq-btn" data-no>Cancel</button></div></div>`;
      const end = v => { box.remove(); resolve(v); }, input = box.querySelector("input"), out = box.querySelector(".vg-hq-folderlist");
      input.oninput = () => { out.innerHTML = list(input.value); };
      box.addEventListener("click", e => { const b = e.target.closest("[data-to]"); if (b) end(b.dataset.to); else if (e.target.closest("[data-no]")) end(null); });
      box.onkeydown = e => { e.stopPropagation(); if (e.key === "Escape") end(null); if (e.key === "Enter") { const b = box.querySelector("[data-to]"); if (b) end(b.dataset.to); } };
      el.appendChild(box); input.focus();
    });
  }
  // an item's buttons: its main action, then Later / Reject / Delegate / Open
  function buttons(it, big) {
    const c = ctx(), main = VGActions.todayWhen(it, c) ? `<button class="vg-hq-btn vg-hq-btn-primary${big ? "" : " vg-hq-btn-sm"}" data-act="main" data-key="${esc(it.key)}">${esc(VGActions.todayLabel(it))}</button>` : "";
    const more = VGActions.todayMore(it, c).filter(m => !(m.key === "open" && (VGActions.todayLabel(it) === "Open" || it.reviewOnly)))
      .map(m => `<button class="vg-hq-btn${big ? "" : " vg-hq-btn-sm"}${m.key === "later" ? " vg-hq-btn-ghost" : ""}" data-act="${m.key}" data-key="${esc(it.key)}" title="${esc(typeof m.title === "function" ? m.title(it) : m.title)}">${esc(m.label)}</button>`).join("");
    return main + more;
  }
  async function act(kind, key, btn) {
    const it = BY_KEY.get(key); if (!it) return;
    if (btn) btn.disabled = true;
    const c = ctx();
    const ok = kind === "main" ? await VGActions.runToday(it, c) : await VGActions.runMore(kind, it, c);
    if (btn && btn.isConnected) btn.disabled = false;
    // a write that changes the item (Done, Later, Accept...) takes it off at once; the host's update brings the truth
    if (ok && !(kind === "open" || (kind === "main" && VGActions.todayLabel(it) === "Open"))) { gone.add(key); picked.delete(key); relist(); if (session && session.key === key) sessionNext(); render(); }
  }

