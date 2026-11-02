  // ---- the frame
  const el = document.createElement("div");
  el.className = "vg-hq" + (opts.mobile ? " is-mobile" : "");
  root.appendChild(el);
  // results alone, so the box keeps its text, cursor and any unfinished composition while results change under it
  const SEARCH_PAUSE = 90;
  function renderResults() { const col = el.querySelector(".vg-hq-col"); if (!col || !globalQuery.trim()) return render(); compute(); col.innerHTML = searchScreen(); const r = el.querySelector(".vg-hq-rail"); if (r) r.remove(); }
  function render() {
    compute(); el.classList.toggle("has-picks", picked.size > 0);
    const label = SUB[cur] ? SUB[cur][0] : SCREENS.find(s => s[0] === cur)[1], t = now();
    const scroll = el.querySelector(".vg-hq-main") ? el.querySelector(".vg-hq-main").scrollTop : 0;
    const search = el.querySelector(".vg-hq-global-search"), restoreSearch = search && document.activeElement === search
      ? [search.selectionStart, search.selectionEnd] : null;
    const focusedFilter = document.activeElement && document.activeElement.dataset.projectFilter;
    const onRow = document.activeElement && document.activeElement.matches && document.activeElement.matches(".vg-hq-item[data-key]") ? document.activeElement.dataset.key : null;
    el.innerHTML = `<header class="vg-hq-top"><span class="vg-hq-crumb"><b>Vault HQ</b> / ${esc(label)}</span>${nextChip()}
      <div class="vg-hq-global-tools"><label class="vg-hq-global-searchlabel"><input class="vg-hq-global-search vg-hq-project-search" type="search" value="${esc(globalQuery)}"
        placeholder="Search projects, tasks, and notes  ( / )" aria-label="Search all HQ and vault notes"></label>
        ${globalQuery ? '<button class="vg-hq-btn vg-hq-btn-sm vg-hq-global-clear" data-clear-global aria-label="Clear HQ search">Clear</button>' : ""}<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost vg-hq-keysbtn" data-keys aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button></div>
      <span class="vg-hq-clock"><b>${t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "")}</b> <span>${esc(t.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}${(() => { const d = VGRules.doneToday(DATA, STATE.review, day()).length, m = VGRules.sessionMinutes(STATE.review, day()); return d || m ? ` · ${d} done${m ? ` · ${VGRules.minutesWords(m)}` : ""}` : ""; })()}</span></span></header>` +
      strip() + `<main class="vg-hq-main"><div class="vg-hq-cols"><div class="vg-hq-col">${globalQuery.trim() ? searchScreen() : ({ home, session: sessionScreen, calendar: calendarScreen, threads: threadsScreen, review: reviewScreen, wrap: wrapScreen, today: todayScreen, needs: needsScreen, people: peopleScreen, projects: projectsScreen, automations: automationsScreen, sweep: sweepScreen, rows: rowsScreen })[cur]()}</div>${railAside()}</div></main>` + dock() + bulkBar() + peekHtml();
    el.appendChild(toastEl); markNext();
    const main = el.querySelector(".vg-hq-main"); if (main) { main.scrollTop = scroll; el.style.setProperty("--hq-panel-top", `${main.offsetTop}px`); }
    if (restoreSearch !== null) { const next = el.querySelector(".vg-hq-global-search"); if (next) { next.focus(); next.setSelectionRange(...restoreSearch); } }
    if (focusedFilter) { const next = el.querySelector(`[data-project-filter="${focusedFilter}"]`); if (next) next.focus(); }
    if (onRow) focusRow(onRow);
    if (focusDrawerOnRender) { focusDrawerOnRender = false; const close = el.querySelector(".vg-hq-drawer .vg-hq-x"); if (close) close.focus(); }
    const track = el.querySelector(".vg-hq-feedtrack"); if (track) { track.scrollLeft = feedAt * track.clientWidth;
      track.onscroll = () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== feedAt) { feedAt = i; el.querySelectorAll(".vg-hq-dots button").forEach((b, k) => b.classList.toggle("is-on", k === i)); } }; }
  }
  // one listener for every button (the screen is redrawn whole)
  el.addEventListener("click", e => {
    const txt = e.target.closest(".vg-hq-item[data-key] .vg-hq-txt"); if (txt && !e.target.closest("button, a") && !String(window.getSelection && window.getSelection()).length) { const k = txt.closest(".vg-hq-item").dataset.key; if (railOn()) selectItem(k); else if (api.searchNotes) toggleContext(k); return; }
    const box = e.target.closest("[data-pick]"); if (box) { togglePick(box.dataset.pick, e.shiftKey); return; }
    const b = e.target.closest("button, [data-closedrawer], [data-peekclose]"); if (!b || !el.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (d.nextstep !== undefined) goNext();
    else if (d.peek) peekOpen(d.peek);
    else if (d.peekclose !== undefined) { peek = null; render(); }
    else if (d.keys !== undefined) keySheet();
    else if (d.addq || d.dropq) { const words = globalQuery.trim(); globalQuery = d.addq ? `${words} ${d.addq}`.trim() : words.split(/\s+/).filter(w => w.toLowerCase() !== d.dropq).join(" "); drawer = null; searchNotes(globalQuery); render(); const field = el.querySelector(".vg-hq-global-search"); if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } }
    else if (d.weekcopy) weekCopy(d.weekcopy);
    else if (d.weeksave) weekSave(d.weeksave, b);
    else if (d.session !== undefined) sessionStart(d.session);
    else if (d.sessionctl) ({ pause: sessionPause, end: sessionEnd, next: sessionNext })[d.sessionctl]();
    else if (d.sesslen) sessionSetLength(+d.sesslen);
    else if (d.bulk) bulkAct(d.bulk, b);
    else if (d.calday) { calDay = d.calday; render(); }
    else if (d.calmonth) { calMonth = d.calmonth === "0" ? null : VGRules.monthShift(calMonth || day().slice(0, 7), +d.calmonth); calDay = null; render(); }
    else if (d.calcopy) calendarCopy(d.calcopy);
    else if (d.board !== undefined) { projectBoard = !projectBoard; render(); }
    else if (d.boardmore) { boardOpen.add(d.boardmore); render(); }
    else if (d.pmove) boardMove(d.path, d.pmove, b);
    else if (d.act) act(d.act, d.key, b);
    else if (d.react) react(d.react, d.kind);
    else if (d.ctx) toggleContext(d.ctx);
    else if (d.capture) capture(d.capture);
    else if (d.page) { opened.add(d.page); render(); }
    else if (d.homepart) toggleHomePart(d.homepart);
    else if (d.customize !== undefined) { customizing = !customizing; render(); }
    else if (d.star) toggleFocus(d.star);
    else if (d.plan) { const it = BY_KEY.get(d.plan); if (it) api.planLine(VGRules.plainTask(it.text || it.title)).then(ok => toast(ok ? "In tomorrow's plan" : "Couldn't find that heading in the standup", null, !ok)); }
    else if (d.logall !== undefined) logAll(b);
    else if (d.makestandup !== undefined) api.openStandup(day());
    else if (d.showkind) api.hqReact(d.showkind, "show");
    else if (d.one) { const it = BY_KEY.get(d.key); if (it) sweep(d.one, [it], b); }
    else if (d.batch) { const its = ofKind("carried").filter(it => it.date === d.day && !kept.has(it.key)); sweep(d.batch, its, b, d.day); }
    else if (d.row) tickRow(+d.rline, d.row, b);
    else if (d.go) { if (d.needsTo) needFilter = d.needsTo; setScreen(d.go); }
    else if (d.open !== undefined) { if (api.openNote) api.openNote(d.open); }
    else if (d.weekday) chooseDaily(d.weekday, b);
    else if (d.daily !== undefined) { if (api.openDaily) openJournal(day(), b); }
    else if (d.graph !== undefined) { if (opts.openGraph) opts.openGraph(); }
    else if (d.filter) { filter = d.filter; drawer = null; render(); }
    else if (d.kind) { kindFilter = d.kind; drawer = null; render(); }
    else if (d.system !== undefined) { systemFilter = d.system; drawer = null; render(); }
    else if (d.needfilter) { needFilter = d.needfilter; render(); }
    else if (d.clearGlobal !== undefined) { globalQuery = ""; noteHits = []; noteSearchError = ""; searchPending = false; searchToken++; clearTimeout(searchTimer); render(); const field = el.querySelector(".vg-hq-global-search"); if (field) field.focus(); }
    else if (d.clearsearch !== undefined) { filter = "all"; kindFilter = "all"; systemFilter = "all"; render(); }
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
  // the board's drag: one path at a time, dropped on a column
  let dragging = null;
  el.addEventListener("dragstart", e => { const c = e.target.closest && e.target.closest("[data-card]"); if (!c) return; dragging = c.dataset.card; c.classList.add("is-dragging"); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragging); } });
  el.addEventListener("dragend", () => { dragging = null; el.querySelectorAll(".is-dragging, .is-drop").forEach(x => x.classList.remove("is-dragging", "is-drop")); });
  el.addEventListener("dragover", e => { const col = dragging && e.target.closest && e.target.closest("[data-column]"); if (!col || col.dataset.column === "other") return; e.preventDefault(); el.querySelectorAll(".is-drop").forEach(x => x !== col && x.classList.remove("is-drop")); col.classList.add("is-drop"); });
  el.addEventListener("drop", e => { const col = dragging && e.target.closest && e.target.closest("[data-column]"); if (!col) return; e.preventDefault(); const path = dragging; dragging = null; col.classList.remove("is-drop"); boardMove(path, col.dataset.column); });
  let typeTimer = null;
  el.addEventListener("input", e => { if (e.target.matches(".vg-hq-global-search")) { const had = !!globalQuery; globalQuery = e.target.value; drawer = null; searchNotes(globalQuery); clearTimeout(typeTimer);
    if (!had !== !globalQuery) render(); else typeTimer = setTimeout(renderResults, SEARCH_PAUSE); } });
  el.addEventListener("change", e => {
    const key = e.target.dataset.projectFilter;
    if (!key) return;
    if (key === "kind") kindFilter = e.target.value;
    else if (key === "system") systemFilter = e.target.value;
    else if (key === "status") filter = e.target.value;
    drawer = null; render();
  });
  // ---- the keyboard: j / k move through the items, x does the main action, l is Later, o opens, Enter shows what your
  // notes know; c goes to capture, / to search, 1-5 to a screen, ? lists them
  // every key, on one card
  function keySheet() {
    const rows = [["Ctrl K", "Find or do anything"], ["c", "Capture"], ["/", "Search"], ["j k", "Move through items"], ["x", "Done"], ["f", "Today's focus"], ["n", "Go to the next step"], ["s", "Focus session"], ["p", "Pause the session"], ["v", "Select the item"], ["l", "Later"], ["o", "Open the note"], ["Enter", "What your notes know"], ["w", "Wrap up"], ["r", "Weekly review"], ["1 to 6", "Screens"], ["?", "This list"]];
    const box = document.createElement("div"); box.className = "vg-hq-dialog"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Keyboard shortcuts");
    box.innerHTML = `<div class="vg-hq-dialog-card"><b>Keyboard</b><table class="vg-hq-keys">${rows.map(([k, w]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(w)}</td></tr>`).join("")}</table><div class="vg-hq-row-end"><button class="vg-hq-btn vg-hq-btn-primary" data-no>Close</button></div></div>`;
    const end = () => box.remove(); box.querySelector("[data-no]").onclick = end; box.onkeydown = ev => { ev.stopPropagation(); if (ev.key === "Escape" || ev.key === "?") end(); }; el.appendChild(box); box.querySelector("[data-no]").focus();
  }
  const KEY_HELP = "j k move · x done · f focus · s session · v select · l later · o open · Enter context · c capture · w wrap up · r review · Ctrl K everything · / search · 1-6 screens";
  const rows = () => [...el.querySelectorAll(".vg-hq-item[data-key]")];
  function focusRow(key) { const r = rows().find(x => x.dataset.key === key); if (r) { r.setAttribute("tabindex", "-1"); r.focus({ preventScroll: true }); r.scrollIntoView({ block: "nearest" }); } }
  function toggleContext(key) { ctxOpen = ctxOpen === key ? null : key; cursorKey = key; const it = BY_KEY.get(key); render(); focusRow(key); }
  let cursorKey = null;
  el.addEventListener("keydown", e => {
    if (e.target.matches(".vg-hq-captureinput")) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); capture(e.shiftKey ? "note" : "task"); }
      else if (e.key === "Escape") { e.target.blur(); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey || el.querySelector(".vg-hq-dialog")) return;
    const k = e.key, go = d => { const list = rows(); if (!list.length) return; const i = list.findIndex(r => r.dataset.key === cursorKey), next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + d))]; cursorKey = next.dataset.key; focusRow(cursorKey); if (railOn()) selectItem(cursorKey); };
    const onRow = () => { const r = e.target.closest && e.target.closest(".vg-hq-item[data-key]"); return (r && r.dataset.key) || cursorKey; };
    if (k === "j" || k === "ArrowDown" && e.target.matches(".vg-hq-item")) { e.preventDefault(); go(1); }
    else if (k === "k" || k === "ArrowUp" && e.target.matches(".vg-hq-item")) { e.preventDefault(); go(-1); }
    else if (k === "x" && onRow()) { e.preventDefault(); act("main", onRow()); }
    else if (k === "l" && onRow()) { e.preventDefault(); act("later", onRow()); }
    else if (k === "f" && onRow() && api.hqFocus) { e.preventDefault(); toggleFocus(onRow()); }
    else if (k === "n") { e.preventDefault(); goNext(); }
    else if (k === "s" && api.hqSession) { e.preventDefault(); sessionStart(onRow()); }
    else if (k === "p" && session) { e.preventDefault(); sessionPause(); }
    else if (k === "v" && onRow() && BY_KEY.get(onRow()) && pickable(BY_KEY.get(onRow()))) { e.preventDefault(); togglePick(onRow(), e.shiftKey); }
    else if (k === "Escape" && picked.size && !drawer) { e.preventDefault(); picked.clear(); render(); }
    else if (k === "w") { e.preventDefault(); setScreen("wrap"); }
    else if (k === "r") { e.preventDefault(); setScreen("review"); }
    else if (k === "o" && onRow()) { const it = BY_KEY.get(onRow()); if (it && (it.path || (it.ids || [])[0]) && api.openNote) { e.preventDefault(); api.openNote(it.path || it.ids[0]); } }
    else if (k === "Enter" && e.target.matches(".vg-hq-item[data-key]")) { e.preventDefault(); toggleContext(e.target.dataset.key); }
    else if (k === "c") { const b = el.querySelector(".vg-hq-captureinput"); if (b) { e.preventDefault(); b.focus(); } else { setScreen("today"); const n = el.querySelector(".vg-hq-captureinput"); if (n) { e.preventDefault(); n.focus(); } } }
    else if (k === "/") { const b = el.querySelector(".vg-hq-global-search"); if (b) { e.preventDefault(); b.focus(); } }
    else if (/^[1-6]$/.test(k) && SCREENS[+k - 1]) { e.preventDefault(); setScreen(SCREENS[+k - 1][0]); }
    else if (k === "?") { e.preventDefault(); keySheet(); }
  });
  el.addEventListener("input", e => { if (e.target.matches(".vg-hq-captureinput")) captureText = e.target.value; });
  el.addEventListener("keydown", e => {
    if (e.key === "Escape" && peek) { e.preventDefault(); peek = null; render(); return; }
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
  function setScreen(s) { if (!known(s)) return; const moved = s !== cur; if (moved) selKey = null; if (s === "sweep" && cur !== "sweep") kept = new Set(); cur = s; drawer = null; peek = null; render(); const m = el.querySelector(".vg-hq-main"); if (m) { m.scrollTop = 0; if (moved) { const col = m.querySelector(".vg-hq-col"); if (col) col.classList.add("vg-hq-enter"); } } if (opts.onScreen) opts.onScreen(s); }
  render();
  clockTimer = opts.now ? null : setInterval(() => { const c = el.querySelector(".vg-hq-clock b"); if (c) c.textContent = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, ""); }, 30000);
  return {
    update(data, state) { DATA = data || DATA; if (state) STATE = state; gone = new Set(); relist(); searchNotes(globalQuery, 80); render(); },
    setScreen, screen: () => cur, palette: () => openPalette(), session: () => session, next: () => goNext(),
    showRows: path => ctx().showRows(path),   // a report's rows (the sidebar's Review rows opens HQ there)
    items: () => LIST.slice(),
    destroy() { sessionLog(); clearInterval(sessionTick); clearInterval(clockTimer); clearTimeout(toastTimer); clearTimeout(searchTimer); clearTimeout(typeTimer); searchToken++; el.remove(); },
  };
}
