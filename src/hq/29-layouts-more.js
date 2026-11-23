  // ---- five working layouts of Today. Each one is a different way to do the same job, and each acts through the same layer
  // as Queue: a move is act(), toggleFocus(), putOffTo() or bringBack(), so the list, the rail, the week strip, the dock, the
  // status bar and the host's files all follow. Triage is one card at a time, Board and Week move work by dragging (or by the
  // Move select, which is what a phone uses), Table sorts, filters and selects in bulk, Threads works one project at a time.
  const lTitle = t => `<h1 class="vg-hq-h1">${esc(t)}</h1>${captureBox()}`;
  const lAll = () => { const seen = new Set(); return ofGroup("needs").concat(ofGroup("today")).filter(i => !seen.has(i.key) && seen.add(i.key)); };
  const lAfter = (date, n) => { const t = VGShared.noon(date); t.setDate(t.getDate() + n); return VGRules.localDay(t); };
  const lThread = it => { const t = threads().find(x => x.items.includes(it)); return t ? t.title : ""; };
  const lPick = (to, label) => `<button class="vg-hq-btn" data-layoutpick="${to}">${esc(label)}</button>`;
  const lEmpty = (fact, then) => empty(fact, [[then || "Queue", 'data-layoutpick="queue"']]);

  // one way to move an item, used by a drop, the Move select and a button alike
  async function putOffTo(key, date) {
    const it = BY_KEY.get(key); if (!it || !api.hqMark) return;
    if (date <= day()) { toast("Pick a day after today.", null, true); return; }
    const mark = `until:${date}`;
    STATE = { ...STATE, review: { ...(STATE.review || {}), hq: { ...((STATE.review || {}).hq || {}), [key]: mark } } }; relist(); render();
    await api.hqMark(key, mark); toast(`Back ${shortDate(date)}: ${it.title}`, () => bringBack(key));
  }
  const isHeld = key => { const m = ((STATE.review || {}).hq || {})[key]; return !!m && (m === `later:${day()}` || (String(m).startsWith("until:") && String(m).slice(6) > day())); };
  // where an item may go: "plan" and "todo" are today's own, "later" is tomorrow, a date is that day, "done" finishes it
  async function moveTo(key, target) {
    compute(); const it = BY_KEY.get(key) || heldList().find(h => h.key === key); if (!it || !target) return;
    if (target === "done") { if (BY_KEY.has(key) && VGActions.todayWhen(it, ctx())) await act("main", key); else toast("That can't be finished from here.", null, true); return; }
    if (target === "later") { if (BY_KEY.has(key)) await act("later", key); return; }
    if (/^[0-9]{4}-/.test(target)) { await putOffTo(key, target); return; }
    const wantPlan = target === "plan";
    if (isHeld(key)) await bringBack(key);
    compute(); const now1 = BY_KEY.get(key); if (!now1) return;
    if (wantPlan) { if (now1.group !== "today") toast("Only today's tasks go in the plan.", null, true); else if (!isFocus(now1)) await toggleFocus(key); }
    else if (isFocus(now1)) await toggleFocus(key);
  }
  const moveSelect = (it, targets) => `<select class="vg-hq-movesel" data-move="${esc(it.key)}" aria-label="Move: ${esc(it.title)}"><option value="">Move to…</option>${targets.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  const kcard = (it, targets, drag = true) => `<div class="vg-hq-item vg-hq-kcard${selected() === it && railOn() ? " is-sel" : ""}" data-key="${esc(it.key)}"${drag ? ` draggable="true" data-dragkey="${esc(it.key)}"` : ""}><div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.why ? `<small>${esc(VGRules.whyWords(it.why))}</small>` : ""}</div><div class="vg-hq-acts">${starButton(it)}${targets && targets.length ? moveSelect(it, targets) : ""}${buttons(it)}</div></div>`;
  const kcol = (name, count, drop, body, note) => `<section class="vg-hq-lane vg-hq-kcol"${drop ? ` data-drop="${esc(drop)}"` : ""}><h2>${esc(name)}<span>${count}</span></h2>${note ? `<p class="vg-hq-lede">${esc(note)}</p>` : ""}${body}</section>`;
  // the drag's events live in the frame; this is what a drop means
  function dropOn(key, target) { if (target) moveTo(key, target); }

  // ---- Triage: one card, the rest behind it. x done, l later, f plan, → skip, ← back
  let triSkipped = [];
  const triQueue = () => { const next = doNext(), all = lAll(), first = next ? [next].concat(all.filter(i => i.key !== next.key)) : all, skip = new Set(triSkipped); return first.filter(i => !skip.has(i.key)).concat(first.filter(i => skip.has(i.key))); };
  const triCurrent = () => { const q = triQueue(), skip = new Set(triSkipped), live = q.filter(i => !skip.has(i.key)); return live[0] || null; };
  function triageLayout() {
    const cur1 = triCurrent(), total = lAll().length, left = total - triSkipped.filter(k => BY_KEY.has(k)).length;
    if (cur1) { cursorKey = cur1.key; selKey = cur1.key; }
    const bar = total ? `<div class="vg-hq-tribar" role="img" aria-label="${left} to go, ${triSkipped.length} skipped"><i style="width:${Math.round((total - left) / total * 100)}%"></i></div>` : "";
    // the key hint names only what this card offers, and nothing on a phone, which has no keys
    const btns = cur1 ? buttons(cur1, true, true) : "", has = a => btns.includes(`data-act="${a}"`), starred = cur1 && starButton(cur1, true);
    const keyless = window.matchMedia && window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
    const hint = [has("main") || has("done") ? "x done" : "", has("later") ? "l later" : "", starred ? "f plan" : "", "→ skip", triSkipped.length ? "← back" : ""].filter(Boolean).join(" · ");
    const keys = keyless ? "" : `<p class="vg-hq-lede vg-hq-trikeys">${hint}</p>`;
    if (!cur1) return lTitle("Triage") + (total ? `<div class="vg-hq-empty"><b>${plural(total, "item")} skipped.</b><div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-primary" data-triage="again">Go through them again</button>${lPick("queue", "Queue")}</div></div>` : lEmpty("Nothing left to triage."));
    return lTitle("Triage") + `<p class="vg-hq-lede">${plural(left, "item")} to go${triSkipped.length ? ` · ${triSkipped.length} skipped` : ""}.</p>${bar}` +
      `<article class="vg-hq-tricard vg-hq-item" data-key="${esc(cur1.key)}" tabindex="-1"><div class="vg-hq-eyebrow">${esc(VGRules.kindWords(cur1.kind))}${lThread(cur1) ? ` · ${esc(lThread(cur1))}` : ""}${cur1.age ? ` · waiting ${plural(cur1.age, "day")}` : ""}</div><h2 class="vg-hq-tritext">${esc(cur1.title)}</h2>${cur1.why ? `<p class="vg-hq-lede">${esc(VGRules.whyWords(cur1.why))}</p>` : ""}<div class="vg-hq-row vg-hq-tribtns">${buttons(cur1, true, true)}${starButton(cur1, true)}<button class="vg-hq-btn" data-triage="skip" title="Moves this to the end of the queue. Back brings it back.">Skip for now</button>${triSkipped.length ? '<button class="vg-hq-btn vg-hq-btn-ghost" data-triage="back">Back</button>' : ""}</div>${contextPanel(cur1, true)}</article>${keys}`;
  }
  function triageDo(how) {
    if (how === "skip") { const c1 = triCurrent(); if (c1) triSkipped.push(c1.key); }
    else if (how === "back") triSkipped.pop();
    else if (how === "again") triSkipped = [];
    render();
  }

  // ---- Board: where each item stands, one column each. A drop does what the column says
  function boardLayout() {
    const held = heldList(), keys = new Set(focus().map(i => i.key)), done = VGRules.doneToday(DATA, STATE.review, day());
    const todo = ofGroup("today").filter(i => !keys.has(i.key)), plan = focus(), needs = ofGroup("needs");
    const to = (...v) => v.map(k => ({ plan: ["plan", "Planned"], todo: ["todo", "To do"], later: ["later", "Later"], done: ["done", "Done"] })[k]);
    const full = plan.length >= VGRules.FOCUS_MAX;
    return lTitle("Board") + `<div class="vg-hq-board">${kcol("Needs you", needs.length, "", needs.map(i => kcard(i, to("later"), false)).join("") || `<p class="vg-hq-lede">Nothing waiting on you.</p>`)}` +
      kcol("To do", todo.length, "todo", todo.map(i => kcard(i, to("plan", "later", "done"))).join("") || `<p class="vg-hq-lede">Drop something here to take it out of the plan.</p>`) +
      kcol("Planned", `${plan.length} of ${VGRules.FOCUS_MAX}`, "plan", plan.map(i => kcard(i, to("todo", "later", "done"))).join("") || `<p class="vg-hq-lede">Drop up to ${VGRules.FOCUS_MAX} things here.</p>`, full ? "Full. Take one out first." : "") +
      kcol("Later", held.length, "later", held.map(i => kcard(i, to("plan", "todo"))).join("") || `<p class="vg-hq-lede">Nothing put off.</p>`) +
      kcol("Done today", done.length, "done", done.length ? `<ul class="vg-hq-wraplist">${done.slice(0, 12).map(d => `<li>${esc(d.text)}</li>`).join("")}</ul>` : `<p class="vg-hq-lede">Drop to finish.</p>`) + `</div>`;
  }

  // ---- Week: plan the days by dragging. Today holds the plan, a later day holds what comes back that day
  function weekLayout() {
    const t0 = day(), monday = VGRules.weekStart(t0), sunday = lAfter(monday, 6), back = comingBack(), plan = focus(), keys = new Set(plan.map(i => i.key));
    const pool = ofGroup("today").filter(i => !keys.has(i.key)), days = Array.from({ length: 7 }, (_, n) => lAfter(monday, n));
    const label = d => `${DAYS[VGShared.noon(d).getDay()]} ${VGShared.noon(d).getDate()}`;
    const dayTargets = days.filter(d => d > t0).map(d => [d, label(d)]);
    const cols = days.map(d => {
      if (d < t0) { const done = VGRules.doneToday(DATA, STATE.review, d); return kcol(label(d), done.length, "", done.length ? `<ul class="vg-hq-wraplist">${done.slice(0, 6).map(x => `<li>${esc(x.text)}</li>`).join("")}${done.length > 6 ? `<li>+${done.length - 6} more</li>` : ""}</ul>` : "", "") .replace('class="vg-hq-lane vg-hq-kcol"', 'class="vg-hq-lane vg-hq-kcol is-past"'); }
      if (d === t0) return kcol("Today", `${plan.length} of ${VGRules.FOCUS_MAX}`, "plan", plan.map(i => kcard(i, [["todo", "Unplan"], ...dayTargets, ["done", "Done"]])).join("") || `<p class="vg-hq-lede">Drop up to ${VGRules.FOCUS_MAX} things here.</p>`, "").replace('class="vg-hq-lane vg-hq-kcol"', 'class="vg-hq-lane vg-hq-kcol is-today"');
      const its = back.get(d) || []; return kcol(label(d), its.length, d, its.map(i => kcard(i, [["plan", "Today"], ...dayTargets.filter(x => x[0] !== d)])).join("") || `<p class="vg-hq-lede">Free.</p>`);
    });
    const beyond = heldList().filter(h => h.until && h.until > sunday), nextMon = lAfter(monday, 7);
    return lTitle("Week") + `<div class="vg-hq-weekgrid">${kcol("To place", pool.length, "todo", pool.map(i => kcard(i, [["plan", "Today"], ...dayTargets, [nextMon, "Next week"]])).join("") || `<p class="vg-hq-lede">Everything is placed.</p>`)}${cols.join("")}${kcol("After this week", beyond.length, nextMon, beyond.map(i => kcard(i, [["plan", "Today"], ["todo", "To place"]])).join("") || `<p class="vg-hq-lede">Nothing put off that far.</p>`)}</div>`;
  }

  // ---- Table: sort, filter and select a lot at once
  let tbl = { sort: "age", dir: -1, q: "", kind: "all" };
  const TCOLS = [["kind", "Kind"], ["title", "Item"], ["thread", "Thread"], ["age", "Waiting"]];
  const tblVal = (it, k) => k === "kind" ? VGRules.kindWords(it.kind) : k === "title" ? it.title.toLowerCase() : k === "thread" ? lThread(it).toLowerCase() : (it.age || 0);
  const tblRows = () => { const q = tbl.q.trim().toLowerCase(); return lAll().filter(i => (tbl.kind === "all" || i.kind === tbl.kind) && (!q || `${i.title} ${lThread(i)}`.toLowerCase().includes(q))).sort((a, b) => { const x = tblVal(a, tbl.sort), y = tblVal(b, tbl.sort); return (x > y ? 1 : x < y ? -1 : 0) * tbl.dir || a.title.localeCompare(b.title); }); };
  function tableLayout() {
    const all = lAll(), shown = tblRows(), kinds = [...new Set(all.map(i => i.kind))];
    const head = TCOLS.map(([k, n]) => `<button class="vg-hq-th${tbl.sort === k ? " is-on" : ""}" data-tsort="${k}" aria-label="Sort by ${n}${tbl.sort === k ? (tbl.dir > 0 ? ", ascending" : ", descending") : ""}">${n}${tbl.sort === k ? (tbl.dir > 0 ? " ▲" : " ▼") : ""}</button>`).join("");
    const line = it => `<div class="vg-hq-item vg-hq-trow${selected() === it && railOn() ? " is-sel" : ""}${picked.has(it.key) ? " is-picked" : ""}" data-key="${esc(it.key)}">${pickBox(it) || "<span></span>"}<span class="vg-hq-tkind">${esc(VGRules.kindWords(it.kind))}</span><div class="vg-hq-txt"><b>${esc(it.title)}</b></div><span class="vg-hq-tthread">${esc(lThread(it))}</span><span class="vg-hq-tage">${it.age ? plural(it.age, "day") : ""}</span><div class="vg-hq-acts">${starButton(it)}${buttons(it)}</div></div>`;
    const tools = `<div class="vg-hq-row vg-hq-ttools"><input class="vg-hq-input" data-tq placeholder="Filter by words" aria-label="Filter the table" value="${esc(tbl.q)}"><select class="vg-hq-layoutsel" data-tkind aria-label="Kind"><option value="all">All kinds</option>${kinds.map(k => `<option value="${esc(k)}"${tbl.kind === k ? " selected" : ""}>${esc(VGRules.kindWords(k))}</option>`).join("")}</select>${shown.some(pickable) ? `<button class="vg-hq-btn vg-hq-btn-sm" data-tall>${shown.filter(pickable).every(i => picked.has(i.key)) ? "Clear selection" : "Select all shown"}</button>` : ""}<span class="vg-hq-lede">${shown.length} of ${all.length}</span></div>`;
    return lTitle("Table") + tools + bulkBar() + `<div class="vg-hq-thead" aria-label="Sort"><span></span>${head}</div>` + (shown.length ? shown.map(line).join("") : all.length ? `<div class="vg-hq-empty"><b>Nothing matches.</b><div class="vg-hq-row"><button class="vg-hq-btn" data-tclear>Clear the filter</button></div></div>` : lEmpty("Nothing open."));
  }
  function tableDo(e) {
    const s = e.target.closest("[data-tsort]"); if (s) { const k = s.dataset.tsort; tbl = { ...tbl, sort: k, dir: tbl.sort === k ? -tbl.dir : k === "age" ? -1 : 1 }; render(); return true; }
    if (e.target.closest("[data-tclear]")) { tbl = { ...tbl, q: "", kind: "all" }; render(); return true; }
    if (e.target.closest("[data-tall]")) { const rows1 = tblRows().filter(pickable); const every = rows1.every(i => picked.has(i.key)); rows1.forEach(i => every ? picked.delete(i.key) : picked.add(i.key)); render(); return true; }
    return false;
  }
  function tableFilter(e) {
    if (e.target.matches("[data-tq]")) { tbl = { ...tbl, q: e.target.value }; const at = e.target.selectionStart; render(); const i = el.querySelector("[data-tq]"); if (i) { i.focus(); i.setSelectionRange(at, at); } return true; }
    if (e.target.matches("[data-tkind]")) { tbl = { ...tbl, kind: e.target.value }; render(); return true; }
    return false;
  }

  // ---- Threads: one project at a time. The list on the left is each thread's open work and how far along it is
  let thrSel = null;
  function threadsLayout() {
    const ts = threads().filter(t => t.items.length); if (!ts.length) return lTitle("Threads") + lEmpty("No open work.");
    const cur1 = ts.find(t => t.title === thrSel) || ts[0], most = Math.max(...ts.map(t => t.items.length));
    const list = ts.map(t => `<button class="vg-hq-lensbtn${t === cur1 ? " is-on" : ""}" data-thread="${esc(t.title)}" aria-pressed="${t === cur1}">${esc(t.title)}<span>${t.items.length}</span></button>`).join("");
    const focusIn = new Set(focus().map(i => i.key)), nextIn = cur1.items.find(i => focusIn.has(i.key)) || cur1.items.find(i => i.group === "today") || cur1.items[0];
    const head = `<div class="vg-hq-row vg-hq-thead2"><h2>${esc(cur1.title)}</h2><span class="vg-hq-lede">${plural(cur1.items.length, "open item")}${cur1.project && cur1.project.status ? ` · ${esc(statusWord(cur1.project))}` : ""}</span>${cur1.project ? `<button class="vg-hq-btn vg-hq-btn-sm" data-proj="${esc(cur1.project.path)}">Open the project</button>` : ""}${api.hqSession && nextIn && nextIn.group === "today" ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-primary" data-session="${esc(nextIn.key)}">Work on this</button>` : ""}</div>`;
    return lTitle("Threads") + `<div class="vg-hq-bench"><nav class="vg-hq-lenses" aria-label="Threads">${list}</nav><div class="vg-hq-benchlist">${head}${cur1.items.map(row).join("")}</div></div>`;
  }

  // what each layout does with a key, and which keep out of the rail (they hold their own detail)
  function layoutKey(e) {
    if (layoutNow() === "triage" && cur === "today") {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); triageDo("skip"); return true; }
      if (e.key === "ArrowLeft") { e.preventDefault(); triageDo("back"); return true; }
    }
    return false;
  }
  const LAYOUT_NO_RAIL = new Set(["triage", "week"]);
  LAYOUTS.push(["triage", "Triage", triageLayout], ["board", "Board", boardLayout], ["week", "Week", weekLayout], ["table", "Table", tableLayout], ["threads", "Threads", threadsLayout]);
