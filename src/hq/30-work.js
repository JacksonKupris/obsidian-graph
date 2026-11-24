  // ---- Today: Do next, then the day in order: today's journal, the last standup's plan, what's carried over
  // Do next in full: the one card Queue and Day both lead with
  function nextBig(next) {
    return next ? `<section class="vg-hq-next vg-hq-item" data-key="${esc(next.key)}"><div class="vg-hq-eyebrow">Do next</div><h2>${esc(next.title)}</h2><p>${esc(VGRules.whyWords(next.why))}</p><p class="vg-hq-whynext">${esc(whyNext(next))}</p><div class="vg-hq-row">${starButton(next, true)}${railOn() ? "" : ctxButton(next)}${buttons(next, true)}${sessionButton(next, true)}</div>${railOn() ? "" : contextPanel(next)}</section>` : nextStep().key !== "capture" ? `<section class="vg-hq-next vg-hq-item"><div class="vg-hq-eyebrow">Do next</div><h2>${esc(nextStep().label)}</h2><div class="vg-hq-row">${stepButton()}</div></section>` : "";
  }
  function todayQueue() {
    const next = doNext(), tasks = ofKind("task"), plan = ofKind("plan"), carried = ofKind("carried");
    const big = nextBig(next);
    const planFrom = plan.length ? `Plan from ${shortDate((plan[0].path.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "")}` : "Plan";
    const shown = carriedAll ? carried : carried.slice(0, 8);
    const inFocus = focus().filter(t => t !== next);
    const out = big + section("Also in focus", inFocus) + section("Today's journal", tasks.filter(t => t !== next && !inFocus.includes(t))) + section(planFrom, plan.filter(t => t !== next && !inFocus.includes(t))) +
      section("Carried over, newest first", shown.filter(t => t !== next && !inFocus.includes(t)), carried.length ? `<div class="vg-hq-row"><button class="vg-hq-btn" data-go="sweep">Go through them one by one, oldest first</button>${carried.length > shown.length ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-carried>Show all ${carried.length}</button>` : ""}</div>` : "", carried.length);
    return `<h1 class="vg-hq-h1">Today</h1>${captureBox()}${flow()}${journalWarning()}<p class="vg-hq-lede">${esc(VGShared.noon(day()).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))} · ${plural(tasks.length + plan.length, "item")} planned · ${carried.length} carried over</p>` +
      (out || empty(hq() ? "No open tasks in your journals or the plan." : "No journal or standup notes found for HQ.", nextSteps())) + putOffHtml() + planDoneHtml();
  }

  // ---- Needs you: what waits on you. A failed automation can stop everything after it, so it leads; the inbox is tidying, so it comes last.
  const NEED_ORDER = [["job", "Automations needing attention"], ["approval", "Waiting on approval"], ["review", "Drafts to review"], ["report", "Reports to review"], ["backlog", "Vault decisions"], ["inbox", "Inbox to file"]];
  function needsScreen() {
    const items = ofGroup("needs"), filters = [["all", "All"], ["approval", "Approvals"], ["review", "Drafts"], ["inbox", "Inbox"], ["job", "Automations"], ["report", "Reports"], ["backlog", "Vault decisions"]];
    const allBacklog = ofKind("backlog"), shown = (needFilter === "all" ? items : needFilter === "backlog" ? allBacklog : items.filter(i => i.kind === needFilter)).slice().sort((a, b) => NEED_ORDER.findIndex(n => n[0] === a.kind) - NEED_ORDER.findIndex(n => n[0] === b.kind));   // the screen and the one-at-a-time walk share this order
    const chips = pillBar("Filter Needs you", "needfilter", needFilter, filters.map(([k, label]) => [k, label, k === "all" ? items.length : k === "backlog" ? allBacklog.length : items.filter(i => i.kind === k).length]));
    const out = NEED_ORDER.map(([kind, title]) => section(title, shown.filter(i => i.kind === kind), kind === "backlog" && needFilter === "all" && allBacklog.length > 1 ? `<div class="vg-hq-row"><button class="vg-hq-btn" data-needfilter="backlog">All ${allBacklog.length}</button></div>` : "", kind === "backlog" ? allBacklog.length : undefined)).join("");
    const head = `<h1 class="vg-hq-h1">Needs you</h1><p class="vg-hq-lede">${items.length ? `${items.length} waiting on you.` : "Nothing waiting on you."}</p>${chips}`;
    if (needsWalk && shown.length) return head + walkHtml(shown);
    const tools = shown.length > 1 ? `<div class="vg-hq-row vg-hq-needtools"><button class="vg-hq-btn vg-hq-btn-sm" data-walk="on">One at a time</button>${api.hqMark ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-pickall>Select all ${shown.length}</button>` : ""}</div>` : "";
    return head + tools +
      (out || empty(needFilter === "all" ? "No approvals, drafts, failed jobs, reports or vault decisions waiting." : `No ${filters.find(f => f[0] === needFilter)[1].toLowerCase()} waiting.`, [["Show all", 'data-needfilter="all"'], ["Today", 'data-go="today"']]));
  }

  // one decision at a time, in the screen's order: whatever you do to one, the next takes its place. Skip is for this visit.
  let needsWalk = false; const walkSkipped = new Set();
  function walkHtml(items, acts) {
    const left = items.filter(i => !walkSkipped.has(i.key)), it = left[0], off = '<button class="vg-hq-btn vg-hq-btn-ghost" data-walk="off">Back to the list</button>';
    if (!it) return empty("You've been through all of them.", [["Start over", 'data-walk="again"'], ["Back to the list", 'data-walk="off"'], ["Today", 'data-go="today"']]);
    return `<section class="vg-hq-next vg-hq-item vg-hq-walk" data-key="${esc(it.key)}"><div class="vg-hq-eyebrow">${esc(VGRules.kindWords(it.kind))} · ${items.length - left.length + 1} of ${items.length}</div><h2>${esc(it.title)}</h2>${it.why ? `<p>${esc(it.why)}</p>` : ""}${acts ? subsHtml(it) : ""}<div class="vg-hq-row">${acts ? acts(it) : `${buttons(it, true)}<button class="vg-hq-btn" data-walk="skip" data-key="${esc(it.key)}">Skip</button>`}${off}</div>${contextPanel(it, true)}</section>`;
  }
  function walk(how, key) {
    if (how === "on") { needsWalk = true; walkSkipped.clear(); }
    else if (how === "off") needsWalk = false;
    else if (how === "again") walkSkipped.clear();
    else if (how === "skip") walkSkipped.add(key);
    render();
  }

  function automationsScreen() {
    const bad = j => j.state === "failed" || j.state === "late";   // what needs a look comes first, and looks it
    const jobs = VGRules.hqJobs(hq() || {}, now()).sort((a, b) => bad(b) - bad(a)), labels = { ok: "Last result: succeeded", failed: "Last result: failed", late: "Late", never: "No run recorded", unknown: "Run state unknown" };
    const cards = jobs.map(j => `<div class="vg-hq-item"><span class="vg-hq-kind">${icon(bad(j) ? "alert" : "clock", 16)}</span><div class="vg-hq-txt"><b>${esc(j.name)} · <span${bad(j) ? ' class="vg-hq-jobbad"' : ""}>${esc(j.state === "late" && j.ok === false ? "Late · Failed" : labels[j.state])}</span></b>
      <small>${esc(VGRules.placeWords(j.where))}${j.when ? ` · ${esc(j.when)}` : ""}${!j.when && j.every_hours ? ` · runs every ${j.every_hours === 1 ? "hour" : j.every_hours % 24 ? `${j.every_hours} hours` : j.every_hours === 24 ? "day" : `${j.every_hours / 24} days`}` : ""}</small><p>${esc(j.what)}</p>${j.state === "late" ? `<small>Late means no run in twice its usual time.</small>` : ""}<small>${j.last ? `Last run ${esc(VGRules.whenWords(j.last))}` : "No run recorded"}${j.summary ? ` · ${esc(j.summary)}` : ""}${j.device ? ` · ${esc(j.device)}` : ""}</small></div>
      ${api.openNote && (j.report || VGRules.HQ.automations_note) ? `<div class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(j.report || VGRules.HQ.automations_note)}">${j.report ? "Open latest report" : "Details"}</button></div>` : ""}</div>`).join("");
    return `<h1 class="vg-hq-h1">Automations</h1><p class="vg-hq-lede">${plural(jobs.length, "automation")}${jobs.filter(bad).length ? ` · ${jobs.filter(bad).length} need${jobs.filter(bad).length === 1 ? "s" : ""} a look` : ""}.</p>${(() => { const y = syncWords(); return y ? `<p class="vg-hq-status">${esc(y.title)} · ${esc(y.sub)}</p>` : ""; })()}` +
      (cards ? `<section class="vg-hq-sec">${cards}</section>` : empty("No automations configured.", [["Needs you", 'data-go="needs"'], ["Projects", 'data-go="projects"']]));
  }

