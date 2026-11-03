  // ---- Projects: every project (scope of work, project note, user story) as a card; one opens in a drawer, where its
  // status is set
  const FILTERS = [["active", "In progress"], ["planned", "Planned"], ["waiting", "Waiting"], ["closed", "Done"], ["other", "Needs classification"], ["all", "All"]];
  function spark(days) {
    const set = new Set(days || []), t = Date.parse(day()), cells = [];
    if (!set.size) return "";
    for (let i = 29; i >= 0; i--) cells.push(set.has(VGRules.localDay(new Date(t - i * 864e5))));
    return `<span class="vg-hq-spark" title="${plural(set.size, "day")} named in the dailies (last 30 days)">${cells.map(on => `<i${on ? ' class="is-on"' : ""}></i>`).join("")}</span>`;
  }
  const pill = p => `<span class="vg-hq-pill is-${esc(p.group)}">${esc(statusWord(p))}</span>`;
  // where a search found a project: the heading and the passage, in the words of the note
  const searchHitHtml = p => p.searchHit ? `<small class="vg-hq-search-hit">${esc(p.searchHit.heading || "")}${p.searchHit.snippet ? `<span>${esc(VGRules.plainSnippet(p.searchHit.snippet))}</span>` : ""}</small>` : "";
  function projectsScreen() {
    const every = VGRules.hqProjects(DATA), kinds = [...new Set(every.map(p => p.kind))];
    const systems = [...new Set(every.flatMap(p => p.systems || []))].sort((a, b) => a.localeCompare(b));
    const all = every.filter(p => (kindFilter === "all" || p.kind === kindFilter) && (systemFilter === "all" || (p.systems || []).includes(systemFilter)));
    const list = VGRules.hqProjectSearch(DATA, all.filter(p => filter === "all" || p.group === filter), "", { today: day() });
    // a scope's code name (JK_Branch) is the card's tooltip: its title says the same thing in words
    const code = p => (/^Scope of Work\b/i.test(p.name) ? p.name.replace(/^.*[—–-]\s*/, "") : "");
    const card = p => `<button class="vg-hq-proj" data-proj="${esc(p.path)}"${code(p) ? ` title="${esc(code(p))}"` : ""}><span class="vg-hq-projbody"><span class="vg-hq-projhead"><small>${esc(p.kind)}</small>${pill(p)}</span>
      <b>${esc(p.title)}</b>${p.summary ? `<span class="vg-hq-sum">${esc(p.summary)}</span>` : ""}${searchHitHtml(p)}${(p.systems || []).length ? `<small class="vg-hq-project-systems">${esc(p.systems.map(VGRules.systemLabel).join(" · "))}</small>` : ""}<span class="vg-hq-projfoot">${spark(p.days)}<small>${esc([p.updated ? `Updated ${shortDate(p.updated)}` : "", p.estimate ? `est. ${p.estimate}` : ""].filter(Boolean).join(" · "))}</small></span></span></button>`;
    const dropdown = (key, label, selected, choices) => {
      if (!choices.some(([value]) => value === selected)) choices.push([selected, `${selected} (0)`]);
      return `<label class="vg-hq-selectlabel">${esc(label)}<select class="vg-hq-select" data-project-filter="${key}" aria-label="${esc(label)}">${choices.map(([value, text]) =>
        `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
    };
    const filters = dropdown("kind", "Kind", kindFilter, [["all", `All kinds (${every.length})`], ...kinds.map(k => [k, `${k} (${every.filter(p => p.kind === k).length})`])]) +
      dropdown("system", "System", systemFilter, [["all", "All systems"], ...systems.map(s => [s, VGRules.systemLabel(s)])]) +
      (projectBoard ? "" : dropdown("status", "Project status", filter, FILTERS.map(([k, label]) => [k, `${label} (${k === "all" ? all.length : all.filter(p => p.group === k).length})`])));   // on the board the columns are the statuses
    const body = projectBoard ? boardHtml(all) : list.length ? `<div class="vg-hq-grid${compactProjects ? " is-compact" : ""}">${list.map(card).join("")}</div>`     : every.length
    ? empty("No projects match the current filters.", [["Reset filters", 'data-clearsearch'], ["All systems", 'data-system="all"']])
    : empty(`No projects yet (notes with type: ${Object.keys(VGRules.PROJECT_TYPES).join(", ") || "scope-of-work"}).`, nextSteps().filter(s => s[1] !== 'data-go="projects"'));
    return `<h1 class="vg-hq-h1">Projects</h1><p class="vg-hq-lede">Every project, newest first. Ticks on a card are the days your dailies named it, over the last 30.</p>${focusChart(every)}
    <div class="vg-hq-project-filters">${filters}<span class="vg-hq-seg vg-hq-compacttoggle" role="group" aria-label="View"><button class="vg-hq-filter${projectBoard ? " is-on" : ""}" data-board aria-pressed="${projectBoard}">Board</button>${projectBoard ? "" : `<button class="vg-hq-filter" data-compact aria-pressed="${compactProjects}">${compactProjects ? "Card view" : "Compact list"}</button>`}</span></div>${body}${drawerHtml(every)}`;
  }
  // focus time per project: one measure, so bars from a shared zero, the biggest first. Each row is its project's name, its time
  // and a way into it, so the words carry what the bar shows. Hidden until there's time to show.
  let focusChartAll = false; const FOCUS_ROWS = 5;
  function focusChart(projects) {
    const rows = VGRules.focusByProject(STATE.review, projects); if (!rows.length) return "";
    const shown = focusChartAll ? rows : rows.slice(0, FOCUS_ROWS), total = rows.reduce((sum, r) => sum + r.minutes, 0);
    const line = r => { const inner = `<span class="vg-hq-focusname">${esc(r.title)}</span><span class="vg-hq-focusbar" aria-hidden="true"><i style="width:${Math.max(2, Math.round(r.share * 100))}%"></i></span><b>${esc(VGRules.minutesWords(r.minutes))}</b>`;
      return r.known ? `<button class="vg-hq-focusrow" data-proj="${esc(r.path)}" title="${esc(r.title)}: ${plural(r.minutes, "minute")}">${inner}</button>` : `<div class="vg-hq-focusrow" title="${esc(r.title)}: ${plural(r.minutes, "minute")}">${inner}</div>`; };
    return `<section class="vg-hq-sec vg-hq-focuschart" aria-label="Focus time by project"><h3>Focus time by project<span>${esc(VGRules.minutesWords(total))}</span></h3>${shown.map(line).join("")}${rows.length > FOCUS_ROWS ? `<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-focusall>${focusChartAll ? "Show fewer" : `All ${rows.length} projects`}</button></div>` : ""}</section>`;
  }
  // ---- the board: a column per status group. Drag a card across, or use its arrows (keyboard and touch); either way it's
  // setStatus, so the question about open tasks and the Undo are the same as the drawer's.
  let projectBoard = false; const boardOpen = new Set(), BOARD_PAGE = 20, GROUP_WORDS = { planned: "Planned", active: "In progress", waiting: "Waiting", closed: "Done", other: "Needs a status" };
  function boardHtml(projects) {
    const groups = [...VGRules.BOARD_GROUPS, ...(projects.some(p => !VGRules.BOARD_GROUPS.includes(p.group)) ? ["other"] : [])], can = !!api.setProjectStatus;
    const moves = VGRules.BOARD_GROUPS.filter(g => VGRules.statusForGroup(g));
    const cardOf = p => { const at = moves.indexOf(p.group), back = moves[at - 1], on = at < 0 ? moves[0] : moves[at + 1], word = g => GROUP_WORDS[g];
      const quiet = p.group !== "closed" && p.updated && (Date.parse(day()) - Date.parse(p.updated)) / 864e5 >= VGRules.RULES.stale_days;
      return `<div class="vg-hq-bcard${quiet ? " is-quiet" : ""}" data-card="${esc(p.path)}"${can ? ' draggable="true"' : ""}><button class="vg-hq-btitle" data-proj="${esc(p.path)}"><b>${esc(p.title)}</b><small>${quiet ? `<span class="vg-hq-quiet">Quiet since ${esc(shortDate(p.updated))}</span> · ` : ""}${esc(statusWord(p))}${(p.systems || []).length ? ` · ${esc(VGRules.systemLabel(p.systems[0]))}` : ""}${(p.tasks || []).length ? ` · ${plural(p.tasks.length, "open task")}` : ""}${VGRules.projectMinutes(STATE.review, p.path) ? ` · ${VGRules.minutesWords(VGRules.projectMinutes(STATE.review, p.path))}` : ""}</small></button>
        ${can ? `<span class="vg-hq-bmoves">${back ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-pmove="${esc(back)}" data-path="${esc(p.path)}" aria-label="Move ${esc(p.title)} to ${esc(word(back))}" title="To ${esc(word(back))}">${icon("left", 12)}</button>` : ""}${on ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-pmove="${esc(on)}" data-path="${esc(p.path)}" aria-label="Move ${esc(p.title)} to ${esc(word(on))}" title="To ${esc(word(on))}">${icon("right", 12)}</button>` : ""}</span>` : ""}</div>`; };
    return `<div class="vg-hq-board">${groups.map(g => { const list = projects.filter(p => (g === "other" ? !VGRules.BOARD_GROUPS.includes(p.group) : p.group === g)), shown = boardOpen.has(g) ? list : list.slice(0, BOARD_PAGE);
      return `<section class="vg-hq-col-b" data-column="${g}" aria-label="${esc(GROUP_WORDS[g])}"><h3>${esc(GROUP_WORDS[g])}<span>${list.length}</span></h3>${shown.map(cardOf).join("") || '<p class="vg-hq-lede">None.</p>'}${shown.length < list.length ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-boardmore="${g}">Show ${list.length - shown.length} more</button>` : ""}</section>`; }).join("")}</div>`;
  }
  function boardMove(path, group, btn) { const status = VGRules.statusForGroup(group), p = ((hq() || {}).projects || []).find(x => x.path === path); if (!status || !p || VGRules.statusGroup(p.status) === group) return; return setStatus(path, status, btn || { disabled: false, isConnected: false }); }
  function drawerHtml(all) {
    const p = drawer && all.find(x => x.path === drawer); if (!p) return "";
    const minutes = VGRules.projectMinutes(STATE.review, p.path);
    const facts = [["Status", statusWord(p)], ...(p.estimate ? [["Estimate", p.estimate]] : []), ...(p.updated ? [["Updated", shortDate(p.updated)]] : []), ["Named in the dailies", `${plural((p.days || []).length, "day")} in 30`],
      ...(minutes ? [["Focused", VGRules.minutesWords(minutes)]] : []),
      ...(p.systems && p.systems.length ? [["Systems", p.systems.map(VGRules.systemLabel).join(", ")]] : []), ...(p.tags && p.tags.length ? [["Tags", p.tags.join(", ")]] : [])];
    // its open tasks, in the sweep's rows: Done / Cancel each, or all at once (the shared batch action)
    const tasks = p.tasks || [], canTick = !!api.setTasksStatus;
    const duplicates = new Map();
    tasks.forEach(t => { const key = VGRules.plainTask(t.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); if (key) duplicates.set(key, (duplicates.get(key) || 0) + 1); });
    const taskList = `<h3>${tasks.length ? `Open tasks · ${tasks.length}` : "No open tasks"}</h3>` + (!tasks.length ? ""
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
      <small>${esc(p.name)}</small><h2 id="vg-hq-drawer-title">${esc(p.title)}</h2>${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
      <dl class="vg-hq-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>${spark(p.days)}
      ${relationships.length && api.openNote ? `<h3>Relationships</h3>${relationships.map(([target, label]) => `<button class="vg-hq-link" data-open="${esc(target)}">${label}: ${esc(target)}</button>`).join("")}` : ""}
      ${api.setProjectStatus && VGRules.STATUS_CHOICES.length ? `<h3>Status</h3><div class="vg-hq-filters" role="group" aria-label="Set status">${VGRules.STATUS_CHOICES.map(s =>
        `<button class="vg-hq-filter${p.status === s ? " is-on" : ""}" data-setstatus="${esc(s)}" aria-pressed="${p.status === s}">${esc(VGRules.statusWords(s))}</button>`).join("")}</div>` : ""}
      ${taskList}
      ${p.decisions.length ? `<h3>Decisions</h3>${p.decisions.map(d => `<button class="vg-hq-link" data-open="${esc(d.path)}">${esc(d.title)}<small>${esc(d.date)}</small></button>`).join("")}` : ""}
      <div class="vg-hq-row">${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-primary" data-open="${esc(p.path)}">Open the note</button>` : ""}</div></aside>`;
  }

