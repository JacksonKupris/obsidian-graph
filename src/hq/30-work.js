  // ---- Today: Do next, then the day in order: today's journal, the last standup's plan, what's carried over
  function todayScreen() {
    const next = doNext(), tasks = ofKind("task"), plan = ofKind("plan"), carried = ofKind("carried");
    const big = next ? `<section class="vg-hq-next vg-hq-item" data-key="${esc(next.key)}"><div class="vg-hq-eyebrow">Do next</div><h2>${esc(next.title)}</h2><p>${esc(next.why)}</p><div class="vg-hq-row">${starButton(next)}${buttons(next, true)}</div>${railOn() ? "" : contextPanel(next, true)}</section>` : "";
    const planFrom = plan.length ? `Plan from ${shortDate((plan[0].path.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "")}` : "Plan";
    const shown = carriedAll ? carried : carried.slice(0, 8);
    const inFocus = focus().filter(t => t !== next);
    const out = big + section("Also in focus", inFocus) + section("Today's journal", tasks.filter(t => t !== next && !inFocus.includes(t))) + section(planFrom, plan.filter(t => t !== next && !inFocus.includes(t))) +
      section("Carried over", shown.filter(t => t !== next && !inFocus.includes(t)), carried.length ? `<div class="vg-hq-row"><button class="vg-hq-btn" data-go="sweep">Sweep them, oldest first</button>${carried.length > shown.length ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-carried>Show all ${carried.length}</button>` : ""}</div>` : "");
    return `<h1 class="vg-hq-h1">Today</h1>${captureBox()}${flow()}${journalWarning()}<p class="vg-hq-lede">${esc(new Date(day() + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))} · ${plural(tasks.length + plan.length, "item")} planned · ${carried.length} carried over</p>` +
      (out || empty(hq() ? "No open tasks in today's journal, the plan or the last 30 days." : "No journal or standup notes found for HQ.", nextSteps()));
  }

  // ---- Needs you: decisions only you can make
  function needsScreen() {
    const items = ofGroup("needs"), filters = [["all", "All"], ["approval", "Approvals"], ["review", "Drafts"], ["inbox", "Inbox"], ["job", "Automations"], ["report", "Reports"], ["backlog", "Vault decisions"]];
    const shown = needFilter === "all" ? items : items.filter(i => i.kind === needFilter);
    const chips = filters.map(([k, label]) => `<button class="vg-hq-filter${needFilter === k ? " is-on" : ""}" data-needfilter="${k}" aria-pressed="${needFilter === k}">${label} <span>${k === "all" ? items.length : items.filter(i => i.kind === k).length}</span></button>`).join("");
    const out = section("Waiting on approval", shown.filter(i => i.kind === "approval")) + section("Drafts to review", shown.filter(i => i.kind === "review")) +
      section("Automations needing attention", shown.filter(i => i.kind === "job")) + section("Reports to review", shown.filter(i => i.kind === "report")) +
      section("Inbox to file", shown.filter(i => i.kind === "inbox")) + section("Vault decisions", shown.filter(i => i.kind === "backlog"));
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

