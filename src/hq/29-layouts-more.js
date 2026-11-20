  // ---- more layouts of Today, each from a pattern the top product and award lists share. Every one draws the same items with
  // row(), the same Do next card and the same rail; selecting a name in the header's Layout select is all it takes to try one.
  const lTitle = t => `<h1 class="vg-hq-h1">${esc(t)}</h1>${captureBox()}`;
  const lAll = () => { const seen = new Set(); return ofGroup("needs").concat(ofGroup("today")).filter(i => !seen.has(i.key) && seen.add(i.key)); };
  const lRows = (xs, none = "Nothing here.") => xs.length ? xs.map(row).join("") : `<p class="vg-hq-lede">${esc(none)}</p>`;
  const lLane = (name, xs, none) => `<section class="vg-hq-lane"><h2>${esc(name)}<span>${xs.length}</span></h2>${lRows(xs, none)}</section>`;
  const lPick = (to, label) => `<button class="vg-hq-btn" data-layoutpick="${to}">${esc(label)}</button>`;
  const lPlan = () => new Set(focus().map(i => i.key));
  const lThreadOf = it => { const t = threads().find(x => x.items.includes(it)); return t && t.project ? t.project.title : ""; };
  const lChip = it => `<span class="vg-hq-item vg-hq-chipitem" data-key="${esc(it.key)}"><span class="vg-hq-txt">${esc(it.title)}</span></span>`;

  // Inbox (Superhuman, Linear): one thing at a time, the next few waiting under it
  function inboxLayout() {
    const next = doNext(), rest = lAll().filter(i => !next || i.key !== next.key);
    return lTitle("Today") + `<p class="vg-hq-lede">${plural(lAll().length, "item")} left.</p>` + (nextBig(next) || "") + (rest.length ? `<h2 class="vg-hq-sub">Up next</h2>${rest.slice(0, 5).map(row).join("")}${rest.length > 5 ? `<div class="vg-hq-row">${lPick("queue", `All ${rest.length + 1} in Queue`)}</div>` : ""}` : "");
  }
  // Board (Notion, Linear): columns by where the work stands
  function boardLayout() {
    const done = VGRules.doneToday(DATA, STATE.review, day()), plan = focus(), keys = lPlan();
    return lTitle("Today") + `<div class="vg-hq-board">${lLane("Needs you", ofGroup("needs"))}${lLane("To do", ofGroup("today").filter(i => !keys.has(i.key)))}${lLane("Planned", plan)}<section class="vg-hq-lane"><h2>Done<span>${done.length}</span></h2>${done.length ? `<ul class="vg-hq-wraplist">${done.slice(0, 10).map(d => `<li>${esc(d.text)}</li>`).join("")}</ul>` : `<p class="vg-hq-lede">Nothing finished yet.</p>`}</section></div>`;
  }
  // Brief (Stripe): the numbers first, each one a way in
  function briefLayout() {
    const done = VGRules.doneToday(DATA, STATE.review, day()).length, proj = threads().filter(t => t.project).length;
    const kpi = (n, name, attr) => `<button class="vg-hq-kpi" ${attr}><b>${n}</b><span>${esc(name)}</span></button>`;
    return lTitle("Today") + `<div class="vg-hq-kpis">${kpi(ofGroup("needs").length, "Need you", 'data-go="needs"')}${kpi(ofGroup("today").length, "Open today", 'data-layoutpick="queue"')}${kpi(done, "Done today", 'data-go="wrap"')}${kpi(proj, "Active threads", 'data-go="projects"')}</div>${nextBig(doNext()) || ""}${lRows(lAll().slice(0, 8), "Nothing open.")}`;
  }
  // Focus (Things, Apple): only the next step, everything else out of sight
  function focusLayout() {
    const next = doNext(), n = lAll().length - (next ? 1 : 0);
    return lTitle("Today") + (nextBig(next) || `<p class="vg-hq-lede">Nothing left to do.</p>`) + (n > 0 ? `<div class="vg-hq-row vg-hq-focusmore"><span class="vg-hq-lede">${plural(n, "more item")} after this one.</span>${lPick("inbox", "See what's next")}</div>` : "");
  }
  // Threads (Linear projects): the work grouped by the thread it belongs to
  function threadsLayout() {
    const ts = threads().filter(t => t.items.length);
    return lTitle("Today") + (ts.length ? ts.map(t => `<section class="vg-hq-lane"><h2>${t.project ? `<button class="vg-hq-link" data-proj="${esc(t.project.path)}">${esc(t.project.title)}</button>` : esc(t.title || "Everything else")}<span>${t.items.length}</span></h2>${t.items.map(row).join("")}</section>`).join("") : empty("No open work.", [["Capture something", 'data-go="today"']]));
  }
  // People (a CRM's contact list): who each open item involves
  function peopleLayout() {
    const who = VGRules.hqPeople(DATA, lAll()).filter(p => p.items.length);
    return lTitle("Today") + (who.length ? who.map(p => `<section class="vg-hq-lane"><h2><button class="vg-hq-link" data-open="${esc(p.id)}">${esc(p.name)}</button><span>${p.items.length}</span></h2>${p.items.map(row).join("")}</section>`).join("") : empty("No open item names a person.", [["Queue", 'data-layoutpick="queue"']]));
  }
  // Digest (Apple News, Readwise): a headline, then the rest in two columns
  function digestLayout() {
    const next = doNext(), rest = lAll().filter(i => !next || i.key !== next.key);
    return lTitle("Today") + (nextBig(next) || "") + (rest.length ? `<div class="vg-hq-twocol">${rest.slice(0, 16).map(row).join("")}</div>` : "");
  }
  // Matrix (Eisenhower): decide now, needs you, planned, the rest
  function matrixLayout() {
    const keys = lPlan(), needs = ofGroup("needs"), today = ofGroup("today");
    return lTitle("Today") + `<div class="vg-hq-matrix">${lLane("Decide now", needs.filter(i => keys.has(i.key)), "Nothing starred is waiting on you.")}${lLane("Needs you", needs.filter(i => !keys.has(i.key)))}${lLane("Planned", today.filter(i => keys.has(i.key)), "Star an item to plan it.")}${lLane("The rest", today.filter(i => !keys.has(i.key)))}</div>`;
  }
  // Timeline (a roadmap): one lane per thread, the items as chips along it
  function timelineLayout() {
    const ts = threads().filter(t => t.items.length);
    return lTitle("Today") + (ts.length ? `<div class="vg-hq-lanes">${ts.map(t => `<div class="vg-hq-laneline"><span class="vg-hq-lanename">${esc(t.project ? t.project.title : t.title || "Everything else")}</span><div class="vg-hq-chips">${t.items.map(lChip).join("")}</div></div>`).join("")}</div>` : empty("No open work.", [["Queue", 'data-layoutpick="queue"']]));
  }
  // Cards (Mobbin, Godly galleries): a grid, each item its own card
  function cardsLayout() {
    return lTitle("Today") + `<div class="vg-hq-cards">${lAll().slice(0, 24).map(it => `<article class="vg-hq-card">${row(it)}</article>`).join("") || empty("Nothing open.", [["Queue", 'data-layoutpick="queue"']])}</div>`;
  }
  // Table (Linear's dense list): kind, title, thread and age on one line
  function tableLayout() {
    const line = it => `<div class="vg-hq-item vg-hq-dense" data-key="${esc(it.key)}"><span class="vg-hq-denseKind">${esc(VGRules.kindWords(it.kind))}</span><span class="vg-hq-txt">${esc(it.title)}</span><span class="vg-hq-denseThread">${esc(lThreadOf(it))}</span><span class="vg-hq-denseAge">${it.age ? plural(it.age, "day") : ""}</span><span class="vg-hq-denseAct">${starButton(it)}${buttons(it, false, false)}</span></div>`;
    return lTitle("Today") + `<div class="vg-hq-dense vg-hq-densehead" aria-hidden="true"><span>Kind</span><span>Item</span><span>Thread</span><span>Waiting</span><span></span></div>${lAll().map(line).join("") || empty("Nothing open.", [["Queue", 'data-layoutpick="queue"']])}`;
  }
  // Agenda (Fantastical): grouped by the kind of work
  function agendaLayout() {
    const by = new Map(); lAll().forEach(i => { const k = VGRules.kindWords(i.kind); (by.get(k) || by.set(k, []).get(k)).push(i); });
    return lTitle("Today") + ([...by].map(([k, xs]) => lLane(k, xs)).join("") || empty("Nothing open.", [["Queue", 'data-layoutpick="queue"']]));
  }
  LAYOUTS.push(["inbox", "Inbox", inboxLayout], ["board", "Board", boardLayout], ["brief", "Brief", briefLayout], ["focus", "Focus", focusLayout], ["threads", "Threads", threadsLayout], ["people", "People", peopleLayout], ["digest", "Digest", digestLayout], ["matrix", "Matrix", matrixLayout], ["timeline", "Timeline", timelineLayout], ["cards", "Cards", cardsLayout], ["table", "Table", tableLayout], ["agenda", "Agenda", agendaLayout]);
