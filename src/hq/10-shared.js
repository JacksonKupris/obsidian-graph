  // ---- the parts every screen shares
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortDate = d => { const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : `${MONTHS[x.getMonth()].slice(0, 3)} ${x.getDate()}`; };
  function chooseDaily(date, source) {
    const h = hq() || {}, journal = VGRules.canonicalJournal(h, date);
    const standup = VGRules.canonicalDailyPath(h.standups, date, "standup");
    const box = document.createElement("div"); box.className = "vg-hq-dialog";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", `Daily notes for ${date}`);
    const button = (kind, path, create) => path || create
      ? `<button class="vg-hq-btn" data-daynote="${kind}" data-date="${esc(date)}"${path ? ` data-path="${esc(path)}"` : ""}>${path ? "Open" : "Create"} ${kind}</button>` : "";
    box.innerHTML = `<div class="vg-hq-dialog-card"><b>${esc(date)}</b><div class="vg-hq-row">${button("journal", journal && journal.path, api.openDaily)}${button("standup", standup, api.openStandup)}</div><div class="vg-hq-row-end"><button class="vg-hq-btn" data-cancelday>Cancel</button></div></div>`;
    const shut = openDialog(box, box.querySelector("button")), close = () => { shut(); if (source && source.isConnected) source.focus(); };
    box.querySelector("[data-cancelday]").onclick = close;
    box.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", async e => {
      const b = e.target.closest("[data-daynote]"); if (!b || b.disabled) return;
      box.querySelectorAll("button").forEach(x => { x.disabled = true; });
      try {
        const action = b.dataset.daynote === "standup" ? api.openStandup : api.openDaily;
        if (action) await action(date);
        else if (api.openNote) await api.openNote(b.dataset.path);
        close();
      } catch (error) {
        let message = box.querySelector('[role="alert"]');
        if (!message) { message = document.createElement("p"); message.setAttribute("role", "alert"); box.querySelector(".vg-hq-dialog-card").appendChild(message); }
        message.textContent = error.message || "Could not open daily note";
        box.querySelectorAll("button").forEach(x => { x.disabled = false; });
      }
    });
  }
  async function openJournal(date, button) {
    button.disabled = true;
    try { await api.openDaily(date); }
    catch (error) { toast(error.message || "Could not open journal", null, true); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function strip() {
    const h = hq(), t = now(), mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const journals = new Set(((h && h.journals) || []).map(j => j.date)), standups = new Set(((h && h.standups) || []).map(s => s.date));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; }).map(d => {
      const iso = VGRules.localDay(d), on = iso === day(), marks = (journals.has(iso) ? '<i class="is-j" title="Journal"></i>' : "") + (standups.has(iso) ? '<i class="is-s" title="Standup"></i>' : "");
      const j = VGRules.canonicalJournal(h, iso);
      const duplicate = j && ((h && h.journalDuplicates) || []).find(x => x.date === iso);
      const canChoose = api.openDaily || api.openStandup || (api.openNote && (j || standups.has(iso)));
      return `<button class="vg-hq-day${on ? " is-today" : ""}" ${canChoose ? `data-weekday="${iso}"` : "disabled"} ${duplicate ? `title="Duplicate journal date; using ${esc(j.path)}"` : ""} aria-label="${DAYS[d.getDay()]} ${d.getDate()}, journal and standup${duplicate ? ", duplicate journal paths; canonical copy selected" : ""}"><span>${DAYS[d.getDay()]}</span><b>${d.getDate()}</b><span class="vg-hq-marks">${marks}</span></button>`;
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
    const nextAt = nextStep().screen, nextHome = SUB[nextAt] ? SUB[nextAt][1] : nextAt;
    return `<nav class="vg-hq-dock" aria-label="Screens">${SCREENS.map(([k, label, ic]) => `<button class="vg-hq-dockbtn${cur === k || (SUB[cur] && SUB[cur][1] === k) ? " is-on" : ""}${nextHome === k && cur !== nextAt ? " has-next" : ""}" data-go="${k}" aria-label="${label}" ${cur === k ? 'aria-current="page"' : ""} title="${label}">${icon(ic, 20)}${k === "needs" && needs ? `<span class="vg-hq-badge">${needs}</span>` : ""}</button>`).join("")}` +
      (api.openDaily ? `<span class="vg-hq-sep"></span><button class="vg-hq-dockbtn" data-daily aria-label="Open today's journal" title="Open today's journal">${icon("journal", 20)}</button>` : "") + `</nav>`;
  }
  // ---- picking several: tick rows (shift for a run of them, v on the keyboard), then one bar acts on them all. Done on old
  // tasks is one write with one Undo, and stays out of the standup, as in the sweep; today's go in the standup one by one.
  const picked = new Set(); let pickAnchor = null;
  // the work you do, and what's waiting on you. For those the bar only puts things off: each decision still gets its own look.
  const isWork = it => it.kind === "task" || it.kind === "carried" || it.kind === "plan";
  const pickable = it => (isWork(it) && !!api.setTasksStatus && !!api.hqMark) || (it.group === "needs" && !!api.hqMark);
  const pickBox = it => pickable(it) ? `<input type="checkbox" class="vg-hq-pick" data-pick="${esc(it.key)}" aria-label="Select: ${esc(it.title)}"${picked.has(it.key) ? " checked" : ""}>` : "";
  function togglePick(key, range) {
    const boxes = [...el.querySelectorAll("[data-pick]")].map(b => b.dataset.pick);
    if (range && pickAnchor && boxes.includes(pickAnchor) && boxes.includes(key)) { const [a, b] = [boxes.indexOf(pickAnchor), boxes.indexOf(key)].sort((x, y) => x - y); boxes.slice(a, b + 1).forEach(k => picked.add(k)); }
    else if (picked.has(key)) picked.delete(key); else picked.add(key);
    pickAnchor = key; render();
  }
  const pickedItems = () => [...picked].map(k => BY_KEY.get(k)).filter(Boolean);
  function bulkBar() {
    const its = pickedItems(); if (!its.length) return "";
    const work = its.every(isWork), words = pickWords(its);
    return `<div class="vg-hq-bulk" role="toolbar" aria-label="${words} selected"><b>${words}</b>${work ? '<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-primary" data-bulk="x">Done</button>' : ""}<button class="vg-hq-btn vg-hq-btn-sm" data-bulk="later">Later</button>${its.every(it => it.group === "today") ? '<button class="vg-hq-btn vg-hq-btn-sm" data-bulk="nextweek">Next week</button>' : ""}${!work || its.some(it => it.kind === "plan") ? "" /* a plan item has no checkbox to cancel */ : '<button class="vg-hq-btn vg-hq-btn-sm" data-bulk="-">Cancel them</button>'}<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-bulk="clear">Clear</button></div>`;
  }
  const pickWords = its => plural(its.length, its.every(isWork) ? "task" : "item");
  async function bulkAct(how, btn) {
    const its = pickedItems(), c = ctx(); if (how === "clear") { picked.clear(); render(); return; } if (!its.length) return;
    if (btn) btn.disabled = true;
    const gain = list => { list.forEach(it => { gone.add(it.key); picked.delete(it.key); }); relist(); render(); };
    if (how === "nextweek" || how === "later") { const t = now(), d = new Date(t); d.setDate(t.getDate() + ((8 - t.getDay()) % 7 || 7)); const mark = how === "later" ? "later" : `until:${VGRules.localDay(d)}`; await Promise.all(its.map(it => api.hqMark(it.key, mark))); gain(its); toast(`${how === "later" ? "Later" : "Next week"}: ${pickWords(its)}`, async () => { await Promise.all(its.map(it => api.hqMark(it.key, null))); its.forEach(it => gone.delete(it.key)); relist(); render(); }); return; }
    if (how === "-") { if (await VGActions.runBatch(its, "-", c, "the selection")) gain(its); else if (btn && btn.isConnected) btn.disabled = false; return; }
    const old = its.filter(it => it.kind === "carried"), todays = its.filter(it => it.kind !== "carried");
    if (old.length && await VGActions.runBatch(old, "x", c)) gain(old);
    for (const it of todays) if (await VGActions.runToday(it, c)) gain([it]);
    if (btn && btn.isConnected) btn.disabled = false;
  }
  function row(it) {
    return `<div class="vg-hq-item${selected() === it && railOn() ? " is-sel" : ""}${picked.has(it.key) ? " is-picked" : ""}${(it.age || 0) >= 14 ? " is-old" : ""}" data-key="${esc(it.key)}">${pickBox(it)}<span class="vg-hq-kind">${icon(KIND_ICON[it.kind] || "graph", 16)}</span>` +
      `<div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.why ? `<small>${esc(VGRules.whyWords(it.why))}${it.delegated ? ` · delegated to ${esc(it.delegated)}` : ""}</small>` : ""}</div>` +
      `<div class="vg-hq-acts">${starButton(it)}${railOn() ? "" : ctxButton(it)}${it.kind === "job" ? '<button class="vg-hq-btn vg-hq-btn-sm" data-go="automations">See all runs</button>' : ""}${buttons(it)}${reactButtons(it)}</div>${railOn() ? "" : contextPanel(it)}</div>`;
  }
  // ---- what your notes already know about an item: the second brain's main trick. Opens from any row (the arrow, or Enter
  // on the keyboard); Do next opens with it. Results are kept for the visit, so going back and forth costs nothing.
  const ctxCache = new Map(); let ctxOpen = null;
  const ctxQuery = it => VGRules.plainTask(it.text || it.title || "").replace(/\[\[|\]\]/g, "");
  const ctxButton = it => api.searchNotes ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost vg-hq-ctxbtn" data-ctx="${esc(it.key)}" aria-expanded="${ctxOpen === it.key}" title="What your notes know about this (Enter)" aria-label="What your notes know about this">${icon("down", 14)}</button>` : "";
  function loadContext(it) {
    if (!api.searchNotes || ctxCache.has(it.key)) return; ctxCache.set(it.key, null);
    Promise.resolve(api.searchNotes(ctxQuery(it), 8)).then(hits => { const own = it.path; ctxCache.set(it.key, (Array.isArray(hits) ? hits : []).filter(h => h.path !== own).filter((h, i, a) => a.findIndex(x => x.path === h.path) === i).slice(0, 4)); if (railOn()) updateRail(); else render(); }, () => { ctxCache.set(it.key, []); if (railOn()) updateRail(); else render(); });
  }
  function contextPanel(it, always) {
    if (!api.searchNotes || (!always && ctxOpen !== it.key)) return "";
    loadContext(it); const hits = ctxCache.get(it.key);
    const body = hits === null ? `<p class="vg-hq-ctx-none">Looking in your notes…</p>` : !hits || !hits.length ? `<p class="vg-hq-ctx-none">Nothing related in your notes.</p>`
      : hits.map(h => `<button class="vg-hq-ctxhit" ${api.readNote ? "data-peek" : "data-open"}="${esc(h.path)}"><b>${esc(nameOf(h.path))}</b>${h.heading && h.heading !== nameOf(h.path) ? `<small>${esc(h.heading)}</small>` : ""}${h.snippet ? `<span>${esc(VGRules.plainSnippet(h.snippet))}</span>` : ""}</button>`).join("");
    return `<div class="vg-hq-ctx"><div class="vg-hq-eyebrow">From your notes</div><div class="vg-hq-ctxhits">${body}</div></div>`;
  }
  // More / Less like this: on every item when the host can keep them
  const isFocus = it => VGRules.focusKeys(STATE.review, day()).includes(it.key);
  // worded: on Do next, where it's what the day's Plan step asks for; a row keeps just the star
  const starButton = (it, worded) => api.hqFocus && it.group === "today" ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost vg-hq-star${isFocus(it) ? " is-on" : ""}" data-star="${esc(it.key)}" aria-pressed="${isFocus(it)}" aria-label="Today's focus" title="${isFocus(it) ? "Take out of today's focus" : "Add to today's focus"} (f)">${isFocus(it) ? "★" : "☆"}${worded ? ` ${isFocus(it) ? "Starred" : "Star"}` : ""}</button>` : "";
  // why this one leads the list, in the order the list is ranked
  const whyNext = it => isFocus(it) ? "First because you starred it for today." : it.urgent ? "First because it's urgent." : it.kind === "task" ? "First because nothing's starred, and today's journal comes first." : it.kind === "plan" ? "First because nothing's starred or in today's journal, and it's next in your last standup's plan." : it.kind === "carried" ? "First because nothing newer is planned, and this is the most recent left over." : "First on the list.";
  const statusWord = p => VGRules.statusWords(p && p.status) || "no status";
  // what Later and Next week have taken off the list, still in sight, with a way back. Open by itself if something urgent is in it.
  function putOffHtml() {
    const held = VGRules.hqPutOff(DATA, { review: STATE.review, hidden: STATE.hidden, today: day(), now: now() }); if (!held.length || !api.hqMark) return "";
    const urgent = held.filter(it => it.urgent).length;
    return `<details class="vg-hq-sec vg-hq-putoff"${urgent ? " open" : ""}><summary><span>Put off${urgent ? ` · <b class="vg-hq-jobbad">${urgent} urgent</b>` : ""}</span><span>${held.length}</span></summary>${held.map(it => `<div class="vg-hq-item${it.urgent ? " is-old" : ""}"><span class="vg-hq-kind">${icon(KIND_ICON[it.kind] || "clock", 16)}</span><div class="vg-hq-txt"><b>${esc(it.title)}</b><small>${esc(it.until ? `Back on ${shortDate(it.until)}` : "Back tomorrow")} · ${esc(it.why || "")}</small></div><div class="vg-hq-acts vg-hq-keepacts"><button class="vg-hq-btn vg-hq-btn-sm" data-bringback="${esc(it.key)}">Bring back</button></div></div>`).join("")}</details>`;
  }
  async function bringBack(key) { const marks = { ...((STATE.review || {}).hq || {}) }; delete marks[key]; STATE = { ...STATE, review: { ...(STATE.review || {}), hq: marks } }; gone.delete(key); relist(); render(); await api.hqMark(key, null); }
  async function toggleFocus(key) {
    const keys = VGRules.focusKeys(STATE.review, day()), on = keys.includes(key);
    if (!on && keys.length >= VGRules.FOCUS_MAX) { toast(`Today's focus holds ${VGRules.FOCUS_MAX}. Take one out first.`, null, true); return; }
    const next = on ? keys.filter(k => k !== key) : [...keys, key]; STATE = { ...STATE, review: { ...(STATE.review || {}), focus: { day: day(), keys: next } } }; relist(); render(); await api.hqFocus(next);
  }
  // the day's loop, the same line wherever you are: pick, do, wrap up
  // the one next step (VGRules.hqNextStep), and everything that points at it
  function nextStep() {
    const h = hq() || {}, done = VGRules.doneToday(DATA, STATE.review, day()).length, standup = (h.standups || []).some(s => s.date === day());
    return VGRules.hqNextStep({ list: LIST, review: STATE.review, day: day(), hour: now().getHours(), done, standup, session: session && BY_KEY.get(session.key) ? { title: session.title } : null });
  }
  const nextChip = () => { const n = nextStep(); return `<button class="vg-hq-nextchip" data-nextstep title="${esc(n.label)}"><span class="vg-hq-nextdot" aria-hidden="true"></span><small>Next</small><b>${esc(n.label)}</b></button>`; };
  // the beacon sits on the one control that is the next step, on the screen that has it
  function markNext(again) {
    if (opts.onNext) opts.onNext();
    const n = nextStep(); el.querySelectorAll(".is-nextstep").forEach(x => x.classList.remove("is-nextstep"));
    if (n.screen !== cur || globalQuery.trim()) return null;
    const t = el.querySelector(n.target); if (!t) return null;
    t.classList.add("is-nextstep");
    if (again) { t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; }
    return t;
  }
  function goNext() { const n = nextStep(); globalQuery = ""; noteHits = []; if (n.key === "session" && cur !== "session") { setScreen("session"); } else if (cur !== n.screen) setScreen(n.screen); else render(); const t = markNext(true); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); if (t.focus) t.focus({ preventScroll: true }); } }
  function flow() {
    if (!api.hqFocus) return ""; const f = focus(), nextKey = nextStep().key, done = VGRules.doneToday(DATA, STATE.review, day()), h = hq() || {}, standup = (h.standups || []).find(s => s.date === day());
    const step = (go, on, n, title, sub) => `<button class="vg-hq-step${on ? " is-on" : ""}" data-go="${go}"><i>${n}</i><span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>`;
    return `<nav class="vg-hq-flow" aria-label="Today's loop">${step("today", nextKey === "plan", "1", "Plan", f.length ? `${f.length} of ${VGRules.FOCUS_MAX} picked` : `Star up to ${VGRules.FOCUS_MAX} for today`)}${step("session", nextKey === "do" || nextKey === "session", "2", "Do", session ? `${session.since ? "On" : "Paused"} · ${sessionClock()}` : f.length ? `Next: ${f[0].title.slice(0, 44)}` : "Start a focus session")}${step("wrap", nextKey === "standup" || cur === "wrap", "3", "Wrap up", `${plural(done.length, "thing")} done · ${standup ? "standup started" : "no standup yet"}`)}</nav>`;
  }
  // ---- Wrap up: what got done goes in the standup, what didn't goes in tomorrow's plan
  function wrapScreen() {
    const done = VGRules.doneToday(DATA, STATE.review, day()), h = hq() || {}, standup = (h.standups || []).find(s => s.date === day()), left = focus();
    const doneRows = done.map(d => `<div class="vg-hq-item"><span class="vg-hq-kind">${icon("check", 16)}</span><div class="vg-hq-txt"><b>${esc(d.text)}</b></div></div>`).join("");
    const leftRows = left.map(it => `<div class="vg-hq-item"><span class="vg-hq-kind">${icon("clock", 16)}</span><div class="vg-hq-txt"><b>${esc(it.title)}</b></div><div class="vg-hq-acts">${standup && api.planLine ? `<button class="vg-hq-btn vg-hq-btn-sm" data-plan="${esc(it.key)}">Plan for tomorrow</button>` : ""}${buttons(it)}</div></div>`).join("");
    const focused = VGRules.sessionMinutes(STATE.review, day());
    return `<h1 class="vg-hq-h1">Wrap up</h1>${flow()}<p class="vg-hq-lede">${plural(done.length, "thing")} done today${focused ? ` · ${VGRules.minutesWords(focused)} focused` : ""}${left.length ? ` · ${left.length} still in focus` : ""}.</p>
      <div class="vg-hq-row vg-hq-wrapacts">${standup ? `${done.length && api.logWork ? '<button class="vg-hq-btn vg-hq-btn-primary" data-logall>Add all to the standup</button>' : ""}${api.openNote ? `<button class="vg-hq-btn" data-open="${esc(standup.path)}">Open the standup</button>` : ""}` : api.openStandup ? `<button class="vg-hq-btn vg-hq-btn-primary" data-makestandup>Start today's standup</button>` : ""}</div>
      ${doneRows ? `<section class="vg-hq-sec"><h3>Done today<span>${done.length}</span></h3>${doneRows}</section>` : empty("Nothing marked done today yet.", [["Today", 'data-go="today"']])}
      ${leftRows ? `<section class="vg-hq-sec"><h3>Still in focus<span>${left.length}</span></h3>${leftRows}</section>` : ""}`;
  }
  async function logAll(btn) { btn.disabled = true; let n = 0; for (const d of VGRules.doneToday(DATA, STATE.review, day())) { if (await api.logWork(d.text)) n++; } toast(n ? `${plural(n, "line")} added to the standup` : "The standup already has them"); if (btn.isConnected) btn.disabled = false; }
  const reactButtons = it => api.hqReact ? `<span class="vg-hq-react" role="group" aria-label="More or less like this"><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-react="more" data-kind="${esc(it.kind)}" aria-label="More like this" title="More ${esc(VGRules.kindWords(it.kind))}">▲</button><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-react="less" data-kind="${esc(it.kind)}" aria-label="Less like this" title="Fewer ${esc(VGRules.kindWords(it.kind))}">▼</button></span>` : "";
  async function react(how, kind) {
    const words = VGRules.kindWords(kind), was = (((STATE.review || {}).reactions || {})[kind] || {}).less || 0;
    await api.hqReact(kind, how);
    toast(how === "more" ? `More ${words}` : `Fewer ${words}`, () => api.hqReact(kind, `undo-${how}`));
    if (how === "less" && was + 1 >= 3 && VGRules.canHideKind(kind) && await ctx().ask(`Hide ${words}?`, `You've asked for fewer of these ${was + 1} times. Hide them all? Home has a Show button to bring them back.`, "Hide")) {
      await api.hqReact(kind, "hide"); toast(`Hidden: ${words}`, () => api.hqReact(kind, "show")); }
  }
  // kinds hidden with Less like this, each with its way back
  const hiddenKindsLine = () => { const kinds = ((STATE.review || {}).hiddenKinds || []); return kinds.length && api.hqReact ? `<p class="vg-hq-lede vg-hq-hiddenkinds">Hidden: ${kinds.map(k => `${esc(VGRules.kindWords(k))} <button class="vg-hq-btn vg-hq-btn-sm" data-showkind="${esc(k)}">Show</button>`).join(" ")}</p>` : ""; };
  const duplicateKey = it => VGRules.plainTask(it.text || it.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function taskRows(items) {
    const groups = new Map();
    items.forEach(it => { const key = ["task", "carried", "plan"].includes(it.kind) ? duplicateKey(it) : it.key; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(it); });
    return [...groups.values()].map(group => group.length === 1 ? row(group[0]) :
      `<details class="vg-hq-duplicates"><summary>Possible duplicate wording · ${group.length} source tasks · review separately</summary>${group.map(row).join("")}</details>`).join("");
  }
  const PAGE = 30, opened = new Set();   // long lists come a page at a time, whatever the vault's size
  const pageOf = (title, items) => opened.has(title) || items.length <= PAGE ? items : items.slice(0, PAGE);
  // total: when the list shows only part of what there is, the heading says so
  const section = (title, items, more, total) => items.length ? `<section class="vg-hq-sec"><h3>${esc(title)}<span>${total > items.length ? `${items.length} of ${total}` : items.length}</span></h3>${taskRows(pageOf(title, items))}${pageOf(title, items).length < items.length ? `<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-ghost" data-page="${esc(title)}">Show ${items.length - PAGE} more</button></div>` : ""}${more || ""}</section>` : "";
  // an empty screen says what's true and where to go next
  const empty = (fact, next) => `<div class="vg-hq-empty"><p>${esc(fact)}</p><div class="vg-hq-row">${next.map(([label, attr]) => `<button class="vg-hq-btn" ${attr}>${esc(label)}</button>`).join("")}</div></div>`;
  const nextSteps = () => [...(api.openDaily ? [["Open today's journal", "data-daily"]] : []), ...(opts.openGraph ? [["Open the graph", "data-graph"]] : []), ["Projects", 'data-go="projects"']];
  const journalWarning = () => ((hq() || {}).journalDuplicates || []).length
    ? `<aside class="vg-hq-warning" role="status"><b>Journals with the same date in two places.</b>
      ${hq().journalDuplicates.map(d => `<p>${esc(d.date)} · using <code>${esc(d.canonical)}</code></p><div class="vg-hq-row">${(d.paths || []).map(path => api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(path)}">Open ${esc(path)}</button>` : `<code>${esc(path)}</code>`).join("")}</div>`).join("")}</aside>` : "";

