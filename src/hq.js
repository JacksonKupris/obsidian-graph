// hq.js - Vault HQ, the vault's home screen: what to do next, what needs a decision from you, what the vault is
// telling you, and where each project stands. Four screens (Home, Today, Needs you, Projects) over a week strip and a
// dock. Every list here is the one Today list (VGRules.todayList) filtered by its group, and every button is a shared
// action (VGActions.runToday / runMore), so HQ, the graph and the sidebar agree. Plain DOM: the plugin's HQ view and
// the standalone test page mount the same thing. The build puts this after actions.js.
//   mountVaultHQ(root, data, opts) -> { update(data, state), setScreen(name), screen(), destroy() }
// opts: state { review, hidden } (the shared file: Later/Done marks, hidden items) · api (the plugin's viewActions:
// openNote, openDaily, setTaskStatus, setTaskField, setNoteStatus, hqMark...) · ask(title, text, ok) / input(title,
// text, placeholder) (else HQ's own dialog) · screen / onScreen(name) (the screen to start on, remembered by the host)
// · onDone(message) (the host logs it) · openGraph() · now (a Date: tests)
function mountVaultHQ(root, data, opts) {
  opts = opts || {};
  const SCREENS = [["home", "Home", "home"], ["today", "Today", "tasks"], ["needs", "Needs you", "inbox"], ["projects", "Projects", "folder"]];
  // screens reached from another one (not in the dock): the carried-over sweep, and a report's rows; each has a way back
  const SUB = { sweep: ["Sweep", "today"], rows: ["Report rows", "needs"], automations: ["Automations", "needs"] };
  const known = s => SCREENS.some(x => x[0] === s) || !!SUB[s];
  const api = opts.api || {};
  let DATA = data || { nodes: [], links: [] }, STATE = opts.state || {}, cur = SCREENS.some(s => s[0] === opts.screen) || opts.screen === "automations" ? opts.screen : "home";
  let kept = new Set(), rowsPath = null;   // the sweep's Keep (this visit only); the report whose rows are open
  let gone = new Set(), feedAt = 0, filter = "active", kindFilter = "all", needFilter = "all", systemFilter = "all",
    projectQuery = "", compactProjects = false, drawer = null, focusDrawerOnRender = false, carriedAll = false, clockTimer = null;
  const now = () => opts.now || new Date(), day = () => VGRules.localDay(now());
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + "s"}`;
  const nameOf = p => VGActions.nameOf(p);

  // ---- the one list, and what each screen takes from it
  let LIST = [], BY_KEY = new Map();
  function compute() {
    LIST = VGRules.todayList(DATA, { review: STATE.review, hidden: STATE.hidden, today: day(), now: now() }).filter(it => !gone.has(it.key));
    BY_KEY = new Map(LIST.map(it => [it.key, it]));
  }
  const ofGroup = g => LIST.filter(it => it.group === g);
  const ofKind = k => LIST.filter(it => it.kind === k);
  const doNext = () => LIST.find(it => it.group === "today") || null;
  const hq = () => DATA.hq || null;

  // ---- icons: small line icons drawn here (no icon font outside Obsidian)
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', tasks: '<path d="M4 6h2M4 12h2M4 18h2"/><path d="M9 6h11M9 12h11M9 18h11"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>', folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    journal: '<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    draft: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5"/>', graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8 7l8 1M7 8l2 8M16 10l-5 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const icon = (k, s = 18) => `<svg class="vg-hq-ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;
  const KIND_ICON = { task: "check", plan: "tasks", carried: "clock", approval: "key", review: "draft", job: "alert", backlog: "check", report: "eye" };

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
  });
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
    if (ok && !(kind === "open" || (kind === "main" && VGActions.todayLabel(it) === "Open"))) { gone.add(key); render(); }
  }

  // ---- the parts every screen shares
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortDate = d => { const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : `${MONTHS[x.getMonth()].slice(0, 3)} ${x.getDate()}`; };
  function strip() {
    const h = hq(), t = now(), mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const journals = new Set(((h && h.journals) || []).map(j => j.date)), standups = new Set(((h && h.standups) || []).map(s => s.date));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; }).map(d => {
      const iso = VGRules.localDay(d), on = iso === day(), marks = (journals.has(iso) ? '<i class="is-j" title="Journal"></i>' : "") + (standups.has(iso) ? '<i class="is-s" title="Standup"></i>' : "");
      const j = VGRules.canonicalJournal(h, iso);
      const duplicate = j && ((h && h.journalDuplicates) || []).find(x => x.date === iso);
      return `<button class="vg-hq-day${on ? " is-today" : ""}" ${j ? `data-open="${esc(j.path)}"` : "disabled"} ${duplicate ? `title="Duplicate journal date; using ${esc(j.path)}"` : ""} aria-label="${DAYS[d.getDay()]} ${d.getDate()}${j ? ", open its journal" : ""}${duplicate ? ", duplicate journal paths; canonical copy selected" : ""}"><span>${DAYS[d.getDay()]}</span><b>${d.getDate()}</b><span class="vg-hq-marks">${marks}</span></button>`;
    }).join("");
    const needs = ofGroup("needs").length, projects = VGRules.hqProjects(DATA).filter(p => p.group === "active").length, jobs = VGRules.hqJobs(h || {}, now());
    const badJobs = jobs.filter(j => j.state === "failed" || j.state === "late").length;
    const chip = (screen, ic, title, sub, dot) => `<button class="vg-hq-chip" data-go="${screen}">${icon(ic, 16)}<span><b>${esc(title)}</b>${dot ? '<i class="vg-hq-dot"></i>' : ""}<small>${esc(sub)}</small></span></button>`;
    return `<nav class="vg-hq-strip" aria-label="This week"><div class="vg-hq-week">${days}</div><div class="vg-hq-chips">` +
      chip("needs", "inbox", "Needs you", plural(needs, "item"), needs > 0) + chip("projects", "folder", "Projects", `${projects} active`) +
      (jobs.length ? chip("automations", "clock", "Automations", badJobs ? `${badJobs} need${badJobs === 1 ? "s" : ""} a look` : `${jobs.length} configured`, badJobs > 0) : "") + `</div></nav>`;
  }
  function dock() {
    const needs = ofGroup("needs").length;
    return `<nav class="vg-hq-dock" aria-label="Screens">${SCREENS.map(([k, label, ic]) => `<button class="vg-hq-dockbtn${cur === k || (SUB[cur] && SUB[cur][1] === k) ? " is-on" : ""}" data-go="${k}" aria-label="${label}" ${cur === k ? 'aria-current="page"' : ""} title="${label}">${icon(ic, 20)}${k === "needs" && needs ? `<span class="vg-hq-badge">${needs}</span>` : ""}</button>`).join("")}` +
      (api.openDaily ? `<span class="vg-hq-sep"></span><button class="vg-hq-dockbtn" data-daily aria-label="Open today's journal" title="Open today's journal">${icon("journal", 20)}</button>` : "") + `</nav>`;
  }
  function row(it) {
    return `<div class="vg-hq-item" data-key="${esc(it.key)}"><span class="vg-hq-kind">${icon(KIND_ICON[it.kind] || "graph", 16)}</span>` +
      `<div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.why ? `<small>${esc(it.why)}${it.delegated ? ` · delegated to ${esc(it.delegated)}` : ""}</small>` : ""}</div>` +
      `<div class="vg-hq-acts">${buttons(it)}</div></div>`;
  }
  const duplicateKey = it => VGRules.plainTask(it.text || it.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function taskRows(items) {
    const groups = new Map();
    items.forEach(it => { const key = ["task", "carried", "plan"].includes(it.kind) ? duplicateKey(it) : it.key; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(it); });
    return [...groups.values()].map(group => group.length === 1 ? row(group[0]) :
      `<details class="vg-hq-duplicates"><summary>Possible duplicate wording · ${group.length} source tasks · review separately</summary>${group.map(row).join("")}</details>`).join("");
  }
  const section = (title, items, more) => items.length ? `<section class="vg-hq-sec"><h3>${esc(title)}<span>${items.length}</span></h3>${taskRows(items)}${more || ""}</section>` : "";
  // an empty screen says what's true and where to go next
  const empty = (fact, next) => `<div class="vg-hq-empty"><p>${esc(fact)}</p><div class="vg-hq-row">${next.map(([label, attr]) => `<button class="vg-hq-btn" ${attr}>${esc(label)}</button>`).join("")}</div></div>`;
  const nextSteps = () => [...(api.openDaily ? [["Open today's journal", "data-daily"]] : []), ...(opts.openGraph ? [["Open the graph", "data-graph"]] : []), ["Projects", 'data-go="projects"']];
  const journalWarning = () => ((hq() || {}).journalDuplicates || []).length
    ? `<aside class="vg-hq-warning" role="status"><b>Duplicate journal paths detected.</b> No notes were merged or removed. Vault HQ uses the expected year/month path when available; other copies remain untouched.
      ${hq().journalDuplicates.map(d => `<p>${esc(d.date)} · using <code>${esc(d.canonical)}</code></p><div class="vg-hq-row">${(d.paths || []).map(path => api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(path)}">Open ${esc(path)}</button>` : `<code>${esc(path)}</code>`).join("")}</div>`).join("")}</aside>` : "";

  // ---- Home: what the vault says (the feed), then Do next, Needs you and Projects, and vault upkeep
  function feedCards() {
    const h = hq() || {}, nodes = (DATA.nodes || []).filter(n => !n.person && !n.ghost && !n.moc), cards = [];
    const stale = nodes.filter(n => VGRules.isStale(n, (DATA.quality || {}).stale_days));
    if (nodes.length) cards.push({ id: "state", eyebrow: "Analysis coverage · graph only", title: "Analyzed graph",
      sub: `${plural(nodes.length, "represented note")} · ${plural((DATA.clusters || []).length, "topic")} · ${Number.isFinite(DATA.dailies_used) ? `${DATA.dailies_used} dailies used` : "daily coverage not recorded"}`,
      go: opts.openGraph ? ["Open the graph", "data-graph"] : null });
    const analysisDate = DATA.date, age = analysisDate && /^\d{4}-\d{2}-\d{2}$/.test(analysisDate) ? Math.max(0, Math.floor((Date.parse(`${day()}T12:00:00`) - Date.parse(`${analysisDate}T12:00:00`)) / 864e5)) : null;
    cards.push({ id: "freshness", eyebrow: "Analysis freshness", title: analysisDate ? `Analysis dated ${shortDate(analysisDate)}` : "Analysis date unavailable",
      sub: age === null ? "Freshness cannot be determined from the available data." : age === 0 ? "Analysis is dated today." : `${plural(age, "day")} since the analysis date.` });
    const busy = (DATA.clusters || []).map(c => ({ c, n: nodes.filter(x => x.cluster === c.id).reduce((s, x) => s + (x.recent || 0), 0) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
    if (busy) cards.push({ id: "weather", eyebrow: "Weather", title: `${busy.c.label || busy.c.name} is busiest`, sub: `${plural(busy.n, "mention")} in the dailies over the last ${DATA.recent_days || 30} days`,
      go: opts.openGraph ? ["Open the graph", "data-graph"] : null });
    const keystones = nodes.filter(n => !n.isolated).sort((a, b) => (b.bc || 0) - (a.bc || 0)).slice(0, 30).filter(n => VGRules.isStale(n, (DATA.quality || {}).stale_days));
    if (keystones.length) cards.push({ id: "keystones", eyebrow: "Keystones", title: `${plural(keystones.length, "relied-on note")} going stale`, sub: keystones.slice(0, 3).map(n => n.name).join(" · "), open: keystones[0].id });
    const oldest = ofKind("carried").sort((a, b) => b.age - a.age)[0];
    if (oldest) cards.push({ id: "oldest", eyebrow: "Waiting longest", title: oldest.title, sub: oldest.why, open: oldest.path, item: oldest });
    const gap = (DATA.links || []).find(l => l.kind === "gap" && (DATA.nodes || []).some(n => n.id === l.source));
    if (gap) cards.push({ id: "gap", eyebrow: "A gap between notes", title: `${nameOf(gap.source)} ↔ ${nameOf(gap.target)}`, sub: gap.why || "Named together, never linked", item: LIST.find(it => it.kind === "link" && it.a === gap.source && it.b === gap.target) });
    const week = (h.decisions || []).filter(d => d.date && (Date.parse(day()) - Date.parse(d.date)) / 864e5 <= 7);
    if (week.length) cards.push({ id: "decided", eyebrow: "Decided this week", title: week[0].title, sub: week.length > 1 ? `and ${plural(week.length - 1, "more decision")}: ${week.slice(1, 3).map(d => d.title).join(" · ")}` : week[0].by ? `Decided by ${week[0].by}` : "", open: week[0].path });
    const ups = (h.standups || []).filter(s => (Date.parse(day()) - Date.parse(s.date)) / 864e5 < 7);
    if (ups.length) { const per = {}; ups.forEach(s => s.projects.forEach(p => (per[p] = (per[p] || 0) + 1)));
      const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 3), dev = ups.reduce((s, u) => s + (u.deviation || 0), 0);
      cards.push({ id: "week", eyebrow: "This week's standups", title: top.length ? top.map(([p, n]) => `${p} ${n}d`).join(" · ") : plural(ups.length, "standup"),
        sub: `${plural(ups.length, "standup")} · ${dev} hour${dev === 1 ? "" : "s"} off plan`, open: ups[0].path }); }
    if ((h.runlog || []).length) { const last = h.runlog[h.runlog.length - 1], parts = last.split(" · ");
      cards.push({ id: "runlog", eyebrow: "Latest agent run", title: parts[3] || last, sub: parts.slice(0, 3).join(" · ") }); }
    return cards;
  }
  function home() {
    const cards = feedCards(); feedAt = Math.min(feedAt, Math.max(0, cards.length - 1));
    const card = (c, i) => `<article class="vg-hq-feedcard" data-i="${i}" aria-roledescription="slide" aria-label="${i + 1} of ${cards.length}">${hills(c.id)}
      <div class="vg-hq-feedtxt"><div class="vg-hq-eyebrow">${esc(c.eyebrow)} <span>${String(i + 1).padStart(2, "0")} / ${String(cards.length).padStart(2, "0")}</span></div>
      <h2>${esc(c.title)}</h2><p>${esc(c.sub)}</p><div class="vg-hq-row">${c.open ? `<button class="vg-hq-btn" data-open="${esc(c.open)}">Open</button>` : ""}${c.go ? `<button class="vg-hq-btn" ${c.go[1]}>${esc(c.go[0])}</button>` : ""}${c.item ? buttons(c.item) : ""}</div></div></article>`;
    const feed = cards.length ? `<section class="vg-hq-feed"><div class="vg-hq-feedtrack">${cards.map(card).join("")}</div>
      ${cards.length > 1 ? `<button class="vg-hq-feednav is-prev" data-feed="-1" aria-label="Previous">${icon("left")}</button><button class="vg-hq-feednav is-next" data-feed="1" aria-label="Next">${icon("right")}</button>
      <div class="vg-hq-dots">${cards.map((_, i) => `<button class="${i === feedAt ? "is-on" : ""}" data-feedto="${i}" aria-label="Card ${i + 1}"></button>`).join("")}</div>` : ""}</section>` : "";
    const next = doNext(), needs = ofGroup("needs"), projects = VGRules.hqProjects(DATA), count = g => projects.filter(p => p.group === g).length;
    const needsBy = [["approval", "approval"], ["review", "draft to review", "drafts to review"], ["job", "job"], ["report", "report"], ["backlog", "vault decision"]]
      .map(([k, w, ws]) => [needs.filter(i => i.kind === k).length, w, ws]).filter(([n]) => n).map(([n, w, ws]) => plural(n, w, ws)).join(" · ");
    const tiles = `<div class="vg-hq-tiles">
      <div class="vg-hq-tile"><div class="vg-hq-eyebrow">Do next</div>${next ? `<b>${esc(next.title)}</b><small>${esc(next.why)}</small><div class="vg-hq-row">${buttons(next)}</div>` : `<b>No daily work queued.</b><div class="vg-hq-row">${api.openDaily ? '<button class="vg-hq-btn" data-daily>Open today\'s journal</button>' : ""}</div>`}</div>
      <button class="vg-hq-tile" data-go="needs"><span class="vg-hq-eyebrow">Needs you</span><span class="vg-hq-big">${needs.length}</span><small>${esc(needsBy || "Nothing waiting on you")}</small></button>
      <button class="vg-hq-tile" data-go="projects"><span class="vg-hq-eyebrow">Projects</span><span class="vg-hq-big">${count("active")}</span><small>in progress · ${count("planned")} planned · ${count("waiting")} waiting</small></button></div>`;
    const upkeep = ofGroup("upkeep").slice(0, 3);
    return `<h1 class="vg-hq-h1">${greeting()}</h1>${journalWarning()}${feed}${tiles}` +
      (upkeep.length ? section("Vault upkeep", upkeep, opts.openGraph ? '<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-ghost" data-graph>Open the graph</button></div>' : "") : "");
  }
  const greeting = () => { const h = now().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

  // ---- Today: Do next, then the day in order: today's journal, the last standup's plan, what's carried over
  function todayScreen() {
    const next = doNext(), tasks = ofKind("task"), plan = ofKind("plan"), carried = ofKind("carried");
    const big = next ? `<section class="vg-hq-next vg-hq-item" data-key="${esc(next.key)}"><div class="vg-hq-eyebrow">Do next</div><h2>${esc(next.title)}</h2><p>${esc(next.why)}</p><div class="vg-hq-row">${buttons(next, true)}</div></section>` : "";
    const planFrom = plan.length ? `Plan from ${shortDate((plan[0].path.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "")}` : "Plan";
    const shown = carriedAll ? carried : carried.slice(0, 8);
    const out = big + section("Today's journal", tasks.filter(t => t !== next)) + section(planFrom, plan.filter(t => t !== next)) +
      section("Carried over", shown.filter(t => t !== next), carried.length ? `<div class="vg-hq-row"><button class="vg-hq-btn" data-go="sweep">Sweep them, oldest first</button>${carried.length > shown.length ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-carried>Show all ${carried.length}</button>` : ""}</div>` : "");
    return `<h1 class="vg-hq-h1">Today</h1>${journalWarning()}<p class="vg-hq-lede">${esc(new Date(day() + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))} · ${plural(tasks.length + plan.length, "item")} planned · ${carried.length} carried over</p>` +
      (out || empty(hq() ? "No open tasks in today's journal, the plan or the last 30 days." : "No journal or standup notes found for HQ.", nextSteps()));
  }

  // ---- Needs you: decisions only you can make
  function needsScreen() {
    const items = ofGroup("needs"), filters = [["all", "All"], ["approval", "Approvals"], ["review", "Drafts"], ["job", "Automations"], ["report", "Reports"], ["backlog", "Vault decisions"]];
    const shown = needFilter === "all" ? items : items.filter(i => i.kind === needFilter);
    const chips = filters.map(([k, label]) => `<button class="vg-hq-filter${needFilter === k ? " is-on" : ""}" data-needfilter="${k}" aria-pressed="${needFilter === k}">${label} <span>${k === "all" ? items.length : items.filter(i => i.kind === k).length}</span></button>`).join("");
    const out = section("Waiting on approval", shown.filter(i => i.kind === "approval")) + section("Drafts to review", shown.filter(i => i.kind === "review")) +
      section("Automations needing attention", shown.filter(i => i.kind === "job")) + section("Reports to review", shown.filter(i => i.kind === "report")) +
      section("Vault decisions", shown.filter(i => i.kind === "backlog"));
    return `<h1 class="vg-hq-h1">Needs you</h1><p class="vg-hq-lede">${items.length ? `Decisions only you can make, ${items.length} in all.` : "Nothing waiting on you."}</p><div class="vg-hq-filters" role="group" aria-label="Filter Needs you">${chips}</div>` +
      (out || empty(needFilter === "all" ? "No approvals, drafts, failed jobs, reports or vault decisions waiting." : `No ${filters.find(f => f[0] === needFilter)[1].toLowerCase()} waiting.`, [["Show all", 'data-needfilter="all"'], ["Today", 'data-go="today"']]));
  }

  function automationsScreen() {
    const jobs = VGRules.hqJobs(hq() || {}, now()), labels = { ok: "Last result: succeeded", failed: "Last result: failed", late: "Late", never: "No run recorded", unknown: "Run state unknown" };
    const cards = jobs.map(j => `<div class="vg-hq-item"><span class="vg-hq-kind">${icon("clock", 16)}</span><div class="vg-hq-txt"><b>${esc(j.name)} · ${esc(j.state === "late" && j.ok === false ? "Late · Failed" : labels[j.state])}</b>
      <small>${esc(j.where)}${j.when ? ` · ${esc(j.when)}` : ""}${j.every_hours ? ` · configured interval: ${j.every_hours}h` : ""}</small><p>${esc(j.what)}</p><small>${j.last ? `Last recorded run: ${esc(new Date(j.last).toLocaleString())}` : "No run recorded"}${j.summary ? ` · ${esc(j.summary)}` : ""}${j.device ? ` · ${esc(j.device)}` : ""}</small></div>
      ${api.openNote && (j.report || VGRules.HQ.automations_note) ? `<div class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(j.report || VGRules.HQ.automations_note)}">${j.report ? "Open latest report" : "Details"}</button></div>` : ""}</div>`).join("");
    return `<h1 class="vg-hq-h1">Automations</h1><p class="vg-hq-lede">${plural(jobs.length, "configured automation")}. Run records describe outcomes, not human approval; schedule enablement is shown only when the source records it.</p>` +
      (cards ? `<section class="vg-hq-sec">${cards}</section>` : empty("No automations configured.", [["Needs you", 'data-go="needs"'], ["Projects", 'data-go="projects"']]));
  }

  // ---- Projects: every project (scope of work, project note, user story) as a card; one opens in a drawer, where its
  // status is set
  const FILTERS = [["active", "In progress"], ["planned", "Planned"], ["waiting", "Waiting"], ["closed", "Done"], ["other", "Needs classification"], ["all", "All"]];
  function spark(days) {
    const set = new Set(days || []), t = Date.parse(day()), cells = [];
    for (let i = 29; i >= 0; i--) cells.push(set.has(VGRules.localDay(new Date(t - i * 864e5))));
    return `<span class="vg-hq-spark" title="${plural(set.size, "day")} named in the dailies (last 30 days)">${cells.map(on => `<i${on ? ' class="is-on"' : ""}></i>`).join("")}</span>`;
  }
  function projectsScreen() {
    const every = VGRules.hqProjects(DATA), kinds = [...new Set(every.map(p => p.kind))];
    const systems = [...new Set(every.flatMap(p => p.systems || []))].sort((a, b) => a.localeCompare(b));
    const all = every.filter(p => (kindFilter === "all" || p.kind === kindFilter) && (systemFilter === "all" || (p.systems || []).includes(systemFilter)));
    const query = projectQuery.trim().toLowerCase();
    const list = all.filter(p => (filter === "all" || p.group === filter) && (!query || `${p.title} ${p.summary || ""}`.toLowerCase().includes(query)));
    const pill = p => `<span class="vg-hq-pill is-${esc(p.group)}">${esc(p.status || "no status")}</span>`;
    // a scope's code name (JK_Branch) beside its kind; other notes are named by their title
    const sub = p => [p.kind, /^Scope of Work\b/i.test(p.name) ? p.name.replace(/^.*[—–-]\s*/, "") : ""].filter(Boolean).join(" · ");
    const card = p => `<button class="vg-hq-proj" data-proj="${esc(p.path)}">${hills(p.name, 70)}<span class="vg-hq-projbody"><span class="vg-hq-projhead"><small>${esc(sub(p))}</small>${pill(p)}</span>
      <b>${esc(p.title)}</b><span class="vg-hq-sum">${esc(p.summary || "No summary yet.")}</span>${(p.systems || []).length ? `<small class="vg-hq-project-systems">${esc(p.systems.join(" · "))}</small>` : ""}<span class="vg-hq-projfoot">${spark(p.days)}<small>${esc(p.estimate || (p.updated ? `Updated ${shortDate(p.updated)}` : ""))}</small></span></span></button>`;
    const kindChips = kinds.length > 1 ? `<div class="vg-hq-filters" role="group" aria-label="Kind">${[["all", "All kinds", every.length], ...kinds.map(k => [k, k, every.filter(p => p.kind === k).length])]
      .map(([k, label, n]) => `<button class="vg-hq-filter${kindFilter === k ? " is-on" : ""}" data-kind="${esc(k)}" aria-pressed="${kindFilter === k}">${esc(label)} <span>${n}</span></button>`).join("")}</div>` : "";
    const systemChips = systems.length ? `<div class="vg-hq-filters" role="group" aria-label="System">${[["all", "All systems"], ...systems.map(s => [s, s])]
      .map(([s, label]) => `<button class="vg-hq-filter${systemFilter === s ? " is-on" : ""}" data-system="${esc(s)}" aria-pressed="${systemFilter === s}">${esc(label)}</button>`).join("")}</div>` : "";
    const statusChips = FILTERS.map(([k, label]) => `<button class="vg-hq-filter${filter === k ? " is-on" : ""}" data-filter="${k}" aria-pressed="${filter === k}">${label} <span>${k === "all" ? all.length : all.filter(p => p.group === k).length}</span></button>`).join("");
    const body = list.length ? `<div class="vg-hq-grid${compactProjects ? " is-compact" : ""}">${list.map(card).join("")}</div>` : every.length
      ? empty(`No projects match the current filters${query ? ` or search “${projectQuery.trim()}”` : ""}.`, [["Clear search", 'data-clearsearch'], ["All projects", 'data-filter="all"'], ["All systems", 'data-system="all"']])
      : empty(`No projects yet (notes with type: ${Object.keys(VGRules.PROJECT_TYPES).join(", ") || "scope-of-work"}).`, nextSteps().filter(s => s[1] !== 'data-go="projects"'));
    return `<h1 class="vg-hq-h1">Projects</h1><p class="vg-hq-lede">Every project, newest first.</p>
      <div class="vg-hq-project-tools"><label class="vg-hq-searchlabel">Search title or summary<input class="vg-hq-project-search" type="search" value="${esc(projectQuery)}" aria-label="Search project titles and summaries"></label>
      <button class="vg-hq-filter" data-compact aria-pressed="${compactProjects}">${compactProjects ? "Card view" : "Compact list"}</button></div>
      ${kindChips}${systemChips}<div class="vg-hq-filters" role="group" aria-label="Project status">${statusChips}</div>${body}${drawerHtml(every)}`;
  }
  function drawerHtml(all) {
    const p = drawer && all.find(x => x.path === drawer); if (!p) return "";
    const facts = [["Status", p.status || "—"], ["Estimate", p.estimate || "—"], ["Updated", p.updated ? shortDate(p.updated) : "—"], ["Named in the dailies", `${plural((p.days || []).length, "day")} in 30`],
      ...(p.systems && p.systems.length ? [["Systems", p.systems.join(", ")]] : []), ...(p.tags && p.tags.length ? [["Tags", p.tags.join(", ")]] : [])];
    // its open tasks, in the sweep's rows: Done / Cancel each, or all at once (the shared batch action)
    const tasks = p.tasks || [], canTick = !!api.setTasksStatus;
    const duplicates = new Map();
    tasks.forEach(t => { const key = VGRules.plainTask(t.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); if (key) duplicates.set(key, (duplicates.get(key) || 0) + 1); });
    const taskList = `<h3>Open tasks · ${tasks.length}</h3>` + (!tasks.length ? `<p class="vg-hq-lede">No open tasks.</p>`
      : (canTick ? `<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-sm" data-pbatch="x">Done all</button><button class="vg-hq-btn vg-hq-btn-sm" data-pbatch="-">Cancel all</button></div>` : "")
      + tasks.map(t => { const key = VGRules.plainTask(t.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(), same = duplicates.get(key) > 1;
        const refs = (t.related || []).map(target => `<button class="vg-hq-link" data-open="${esc(target)}">Related: ${esc(target)}</button>`).join("");
        return `<div class="vg-hq-item${t.sub ? " is-sub" : ""}" id="vg-hq-task-${t.line}" data-taskline="${t.line}" tabindex="-1"><div class="vg-hq-txt"><b>${esc(t.title)}</b>
          ${same ? `<small class="vg-hq-duplicate">Possible duplicate wording · review only</small>` : ""}
          ${t.section ? `<small>Source heading: ${esc(t.section)}</small>` : ""}
          ${t.parent ? `<small>Subtask of <button class="vg-hq-inline-link" data-parentline="${t.parent.line}">${esc(t.parent.title)}</button></small>` : ""}
          ${refs}</div>${canTick ? `<div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm" data-ptask="x" data-line="${t.line}">Done</button><button class="vg-hq-btn vg-hq-btn-sm" data-ptask="-" data-line="${t.line}">Cancel</button></div>` : ""}</div>`; }).join(""));
    const relationships = [...(p.parents || []).map(target => [target, "Parent"]), ...(p.related || []).map(target => [target, "Related"])];
    return `<div class="vg-hq-scrim" data-closedrawer></div><aside class="vg-hq-drawer" role="dialog" aria-modal="false" aria-labelledby="vg-hq-drawer-title" tabindex="-1"><button class="vg-hq-x" data-closedrawer aria-label="Close project details">${icon("close")}</button>
      <button class="vg-hq-btn vg-hq-btn-ghost vg-hq-drawer-back" data-closedrawer>${icon("left", 14)} Back to projects</button>
      <small>${esc(p.name)}</small><h2 id="vg-hq-drawer-title">${esc(p.title)}</h2><p>${esc(p.summary || "No summary yet.")}</p>
      <dl class="vg-hq-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>${spark(p.days)}
      ${relationships.length && api.openNote ? `<h3>Relationships</h3>${relationships.map(([target, label]) => `<button class="vg-hq-link" data-open="${esc(target)}">${label}: ${esc(target)}</button>`).join("")}` : ""}
      ${api.setProjectStatus && VGRules.STATUS_CHOICES.length ? `<h3>Status</h3><div class="vg-hq-filters" role="group" aria-label="Set status">${VGRules.STATUS_CHOICES.map(s =>
        `<button class="vg-hq-filter${p.status === s ? " is-on" : ""}" data-setstatus="${esc(s)}" aria-pressed="${p.status === s}">${esc(s)}</button>`).join("")}</div>` : ""}
      ${taskList}
      ${p.decisions.length ? `<h3>Decisions</h3>${p.decisions.map(d => `<button class="vg-hq-link" data-open="${esc(d.path)}">${esc(d.title)}<small>${esc(d.date)}</small></button>`).join("")}` : ""}
      <div class="vg-hq-row">${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-primary" data-open="${esc(p.path)}">Open the note</button>` : ""}</div></aside>`;
  }

  // a project's status from its drawer, as a shared action (its message and Undo): shown at once, the host's redraw
  // brings the note's truth. A closing status with open tasks asks first, then ticks (or cancels) them in the same write.
  async function setStatus(path, status, btn) {
    const p = ((hq() || {}).projects || []).find(x => x.path === path); if (!p || p.status === status) return;
    const open = (p.tasks || []).length, top = (p.tasks || []).filter(t => !t.sub).map(t => t.title);
    const mark = open ? VGRules.closeMark(status) : null, done = mark === "x" ? "ticked" : "cancelled";
    const list = top.slice(0, 6).join("; ") + (top.length > 6 ? `; and ${top.length - 6} more` : "");
    btn.disabled = true;
    const ok = await VGActions.run({ label: () => "Set status", title: () => p.title,
      ask: mark ? () => [`Set ${p.title} to ${status}?`, `${plural(open, "open task")} will be ${done}: ${list}.`, `Set to ${status}, ${done === "ticked" ? "tick" : "cancel"} ${plural(open, "task")}`] : null,
      run: async () => { const n = await api.setProjectStatus(path, status, !!mark); return `${p.title}: ${status}${n ? ` · ${plural(n, "task")} ${done}` : ""}`; } }, p, ctx());
    if (!ok) { if (btn.isConnected) btn.disabled = false; return; }
    Object.assign(p, { status, group: VGRules.statusGroup(status), updated: day() }, mark ? { tasks: [] } : {}); render();
  }
  // Done ("x") or Cancel ("-") on a project's open tasks from its drawer: one (its line) or all of them
  async function projectTasks(how, line, btn) {
    const p = ((hq() || {}).projects || []).find(x => x.path === drawer); if (!p) return;
    const list = (p.tasks || []).filter(t => line === null || t.line === line).map(t => ({ ...t, path: p.path }));
    if (!list.length) return;
    btn.disabled = true;
    const ok = await VGActions.runBatch(list, how, ctx(), p.title);
    if (!ok) { if (btn.isConnected) btn.disabled = false; return; }
    const lines = new Set(list.map(t => t.line)); p.tasks = p.tasks.filter(t => !lines.has(t.line)); render();
  }

  // ---- Sweep: the carried-over tasks a day at a time, oldest first: Done (finished some time ago, so it doesn't go in
  // today's standup), Cancel, or Keep (stays open; gone from the sweep until you come back to it)
  const SWEEP_OLD = 14;   // days: a day this old is marked
  function sweepScreen() {
    const items = ofKind("carried").filter(it => !kept.has(it.key)), days = [...new Set(items.map(it => it.date))].sort();
    const head = `<button class="vg-hq-btn vg-hq-btn-ghost" data-go="today">${icon("left", 14)} Today</button><h1 class="vg-hq-h1">Sweep carried over</h1>`;
    if (!items.length) return head + empty(kept.size ? `Swept. ${plural(kept.size, "task")} kept open.` : "No tasks carried over.", [["Today", 'data-go="today"'], ["Home", 'data-go="home"']]);
    const group = d => { const its = items.filter(it => it.date === d), age = its[0].age;
      return `<section class="vg-hq-sec vg-hq-sweep" data-day="${esc(d)}"><h3><span>${esc(new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))} · ${plural(its.length, "task")} · ${plural(age, "day")} ago${age >= SWEEP_OLD ? ' <em class="vg-hq-old">2+ weeks</em>' : ""}</span>
        <span class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-batch="x" data-day="${esc(d)}">Done all</button><button class="vg-hq-btn vg-hq-btn-sm" data-batch="-" data-day="${esc(d)}">Cancel all</button><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-batch="keep" data-day="${esc(d)}">Keep all</button></span></h3>` +
        its.map(it => `<div class="vg-hq-item" data-key="${esc(it.key)}"><div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.delegated ? `<small>delegated to ${esc(it.delegated)}</small>` : ""}</div><div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm" data-one="x" data-key="${esc(it.key)}">Done</button><button class="vg-hq-btn vg-hq-btn-sm" data-one="-" data-key="${esc(it.key)}">Cancel</button>
          <button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-one="keep" data-key="${esc(it.key)}">Keep</button>${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-open="${esc(it.path)}">Open</button>` : ""}</div></div>`).join("") + `</section>`; };
    const repeats = new Map();
    items.forEach(it => { const key = duplicateKey(it); if (!repeats.has(key)) repeats.set(key, []); repeats.get(key).push(it); });
    const duplicates = [...repeats.values()].filter(g => g.length > 1);
    const review = duplicates.length ? `<details class="vg-hq-duplicates"><summary>Review ${plural(duplicates.length, "repeated wording group")} · no tasks merged</summary>${duplicates.map(g =>
      `<div class="vg-hq-txt"><b>${esc(g[0].title)}</b>${g.map(it => `<p>${api.openNote ? `<button class="vg-hq-inline-link" data-open="${esc(it.path)}">${esc(it.path)}</button>` : esc(it.path)} · line ${it.line + 1}</p>`).join("")}</div>`).join("")}</details>` : "";
    return head + `<p class="vg-hq-lede">${plural(items.length, "task")} from ${plural(days.length, "day")}, oldest first.</p>${review}` + days.map(group).join("");
  }
  async function sweep(how, list, btn, from) {
    if (!list.length) return;
    if (how === "keep") { list.forEach(it => kept.add(it.key)); render(); return; }
    if (btn) btn.disabled = true;
    const ok = await VGActions.runBatch(list, how, ctx(), from);
    if (ok) { list.forEach(it => gone.add(it.key)); render(); } else if (btn && btn.isConnected) btn.disabled = false;
  }

  // ---- Report rows: each row of the report to tick (apply) or skip, in the report itself
  const rowKey = r => `${r.path}|${r.line}`;
  function rowsScreen() {
    const rep = ((hq() || {}).reports || []).find(r => r.path === rowsPath);
    const head = `<button class="vg-hq-btn vg-hq-btn-ghost" data-go="needs">${icon("left", 14)} Needs you</button>${api.openNote && rep ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-open="${esc(rep.path)}">Open source report</button>` : ""}`;
    if (!rep) return head + empty("That report isn't there any more.", [["Needs you", 'data-go="needs"']]);
    const rows = (rep.rows || []).map(r => ({ ...r, path: rep.path })).filter(r => !gone.has(rowKey(r)));
    const sections = [...new Set(rows.map(r => r.section))];
    return head + `<h1 class="vg-hq-h1">${esc(rep.name)}</h1><p class="vg-hq-lede">${rows.length ? `${plural(rows.length, "row")} to tick or skip. Ticked rows are applied by the gardener.` : "Every row is ticked or skipped."}</p>` +
      (rows.length ? sections.map(sec => `<section class="vg-hq-sec"><h3>${esc(sec || rep.name)}<span>${rows.filter(r => r.section === sec).length}</span></h3>` + rows.filter(r => r.section === sec).map(r =>
        `<div class="vg-hq-item"><div class="vg-hq-txt">${r.context ? `<small>${esc(VGRules.plainRowFull(r.context))}</small>` : ""}<b>${esc(VGRules.plainRowFull(r.text))}</b><small>Source report: ${esc(rep.path)}</small></div><div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-primary" data-row="x" data-rline="${r.line}">Tick</button><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-row="-" data-rline="${r.line}">Skip</button></div></div>`).join("") + `</section>`).join("")
        : empty("Every row is ticked or skipped.", [["Needs you", 'data-go="needs"'], ...(api.openNote ? [["Open the report", `data-open="${esc(rep.path)}"`]] : [])]));
  }
  async function tickRow(line, mark, btn) {
    const rep = ((hq() || {}).reports || []).find(r => r.path === rowsPath), row = rep && (rep.rows || []).find(r => r.line === line);
    if (!row) return;
    if (btn) btn.disabled = true;
    const r = { ...row, path: rep.path };
    if (await VGActions.runRow(r, mark, ctx())) { gone.add(rowKey(r)); render(); } else if (btn && btn.isConnected) btn.disabled = false;
  }

  // ---- the frame
  const el = document.createElement("div");
  el.className = "vg-hq" + (opts.mobile ? " is-mobile" : "");
  root.appendChild(el);
  function render() {
    compute();
    const label = SUB[cur] ? SUB[cur][0] : SCREENS.find(s => s[0] === cur)[1], t = now();
    const scroll = el.querySelector(".vg-hq-main") ? el.querySelector(".vg-hq-main").scrollTop : 0;
    const search = el.querySelector(".vg-hq-project-search"), restoreSearch = search && document.activeElement === search ? search.selectionStart : null;
    el.innerHTML = `<header class="vg-hq-top"><span class="vg-hq-crumb"><b>Vault HQ</b> / ${esc(label)}</span><span class="vg-hq-clock"><b>${t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "")}</b> <span>${esc(t.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</span></span></header>` +
      strip() + `<main class="vg-hq-main">${({ home, today: todayScreen, needs: needsScreen, projects: projectsScreen, automations: automationsScreen, sweep: sweepScreen, rows: rowsScreen })[cur]()}</main>` + dock();
    el.appendChild(toastEl);
    const main = el.querySelector(".vg-hq-main"); if (main) { main.scrollTop = scroll; el.style.setProperty("--hq-panel-top", `${main.offsetTop}px`); }
    if (restoreSearch !== null) { const next = el.querySelector(".vg-hq-project-search"); if (next) { next.focus(); next.setSelectionRange(restoreSearch, restoreSearch); } }
    if (focusDrawerOnRender) { focusDrawerOnRender = false; const close = el.querySelector(".vg-hq-drawer .vg-hq-x"); if (close) close.focus(); }
    const track = el.querySelector(".vg-hq-feedtrack"); if (track) { track.scrollLeft = feedAt * track.clientWidth;
      track.onscroll = () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== feedAt) { feedAt = i; el.querySelectorAll(".vg-hq-dots button").forEach((b, k) => b.classList.toggle("is-on", k === i)); } }; }
  }
  // one listener for every button (the screen is redrawn whole)
  el.addEventListener("click", e => {
    const b = e.target.closest("button, [data-closedrawer]"); if (!b || !el.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (d.act) act(d.act, d.key, b);
    else if (d.one) { const it = BY_KEY.get(d.key); if (it) sweep(d.one, [it], b); }
    else if (d.batch) { const its = ofKind("carried").filter(it => it.date === d.day && !kept.has(it.key)); sweep(d.batch, its, b, d.day); }
    else if (d.row) tickRow(+d.rline, d.row, b);
    else if (d.go) setScreen(d.go);
    else if (d.open !== undefined) { if (api.openNote) api.openNote(d.open); }
    else if (d.daily !== undefined) { if (api.openDaily) api.openDaily(day()); }
    else if (d.graph !== undefined) { if (opts.openGraph) opts.openGraph(); }
    else if (d.filter) { filter = d.filter; drawer = null; render(); }
    else if (d.kind) { kindFilter = d.kind; drawer = null; render(); }
    else if (d.system !== undefined) { systemFilter = d.system; drawer = null; render(); }
    else if (d.needfilter) { needFilter = d.needfilter; render(); }
    else if (d.clearsearch !== undefined) { projectQuery = ""; filter = "all"; kindFilter = "all"; systemFilter = "all"; render(); }
    else if (d.compact !== undefined) { compactProjects = !compactProjects; render(); }
    else if (d.setstatus) setStatus(drawer, d.setstatus, b);
    else if (d.ptask) projectTasks(d.ptask, +d.line, b);
    else if (d.pbatch) projectTasks(d.pbatch, null, b);
    else if (d.proj) { drawer = d.proj; focusDrawerOnRender = true; render(); }
    else if (d.parentline !== undefined) { const target = el.querySelector(`#vg-hq-task-${Number(d.parentline)}`); if (target) { target.scrollIntoView({ block: "center" }); target.focus(); } }
    else if (d.closedrawer !== undefined) { const path = drawer; drawer = null; render(); const opener = [...el.querySelectorAll("[data-proj]")].find(x => x.dataset.proj === path); if (opener) opener.focus(); }
    else if (d.carried !== undefined) { carriedAll = true; render(); }
    else if (d.feed || d.feedto) { const n = el.querySelectorAll(".vg-hq-feedcard").length, track = el.querySelector(".vg-hq-feedtrack");
      feedAt = d.feedto ? +d.feedto : (feedAt + +d.feed + n) % n; if (track) track.scrollTo({ left: feedAt * track.clientWidth, behavior: "smooth" });
      el.querySelectorAll(".vg-hq-dots button").forEach((x, k) => x.classList.toggle("is-on", k === feedAt)); }
  });
  el.addEventListener("input", e => { if (e.target.matches(".vg-hq-project-search")) { projectQuery = e.target.value; render(); } });
  el.addEventListener("keydown", e => {
    if (e.key === "Escape" && drawer) {
      e.preventDefault(); const path = drawer; drawer = null; render();
      const opener = [...el.querySelectorAll("[data-proj]")].find(x => x.dataset.proj === path); if (opener) opener.focus();
    }
  });
  el.addEventListener("keydown", e => {
    if (e.target.matches("[data-taskline]") && (e.key === "Enter" || e.key === " ")) {
      const line = e.target.dataset.taskline;
      if (line && e.target.matches(".vg-hq-item")) { e.preventDefault(); e.target.scrollIntoView({ block: "center" }); }
    }
  });
  function setScreen(s) { if (!known(s)) return; if (s === "sweep" && cur !== "sweep") kept = new Set(); cur = s; drawer = null; render(); const m = el.querySelector(".vg-hq-main"); if (m) m.scrollTop = 0; if (opts.onScreen) opts.onScreen(s); }
  render();
  clockTimer = opts.now ? null : setInterval(() => { const c = el.querySelector(".vg-hq-clock b"); if (c) c.textContent = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, ""); }, 30000);
  return {
    update(data, state) { DATA = data || DATA; if (state) STATE = state; gone = new Set(); render(); },
    setScreen, screen: () => cur,
    showRows: path => ctx().showRows(path),   // a report's rows (the sidebar's Review rows opens HQ there)
    items: () => LIST.slice(),
    destroy() { clearInterval(clockTimer); clearTimeout(toastTimer); el.remove(); },
  };
}
