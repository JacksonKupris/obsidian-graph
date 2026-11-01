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
    const list = VGRules.hqProjectSearch(DATA, all.filter(p => filter === "all" || p.group === filter), "", { today: day() });
    const pill = p => `<span class="vg-hq-pill is-${esc(p.group)}">${esc(p.status || "no status")}</span>`;
    // a scope's code name (JK_Branch) beside its kind; other notes are named by their title
    const sub = p => [p.kind, /^Scope of Work\b/i.test(p.name) ? p.name.replace(/^.*[—–-]\s*/, "") : ""].filter(Boolean).join(" · ");
    const card = p => `<button class="vg-hq-proj" data-proj="${esc(p.path)}">${hills(p.name, 70)}<span class="vg-hq-projbody"><span class="vg-hq-projhead"><small>${esc(sub(p))}</small>${pill(p)}</span>
      <b>${esc(p.title)}</b><span class="vg-hq-sum">${esc(p.summary || "No summary yet.")}</span>${p.searchHit ? `<small class="vg-hq-search-hit">${esc([p.searchHit.heading, p.searchHit.why.join(" · ")].filter(Boolean).join(" · "))}${p.searchHit.snippet ? `<span>${esc(p.searchHit.snippet)}</span>` : ""}</small>` : ""}${(p.systems || []).length ? `<small class="vg-hq-project-systems">${esc(p.systems.join(" · "))}</small>` : ""}<span class="vg-hq-projfoot">${spark(p.days)}<small>${esc(p.estimate || (p.updated ? `Updated ${shortDate(p.updated)}` : ""))}</small></span></span></button>`;
    const dropdown = (key, label, selected, choices) => {
      if (!choices.some(([value]) => value === selected)) choices.push([selected, `${selected} (0)`]);
      return `<label class="vg-hq-selectlabel">${esc(label)}<select class="vg-hq-select" data-project-filter="${key}" aria-label="${esc(label)}">${choices.map(([value, text]) =>
        `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
    };
    const filters = dropdown("kind", "Kind", kindFilter, [["all", `All kinds (${every.length})`], ...kinds.map(k => [k, `${k} (${every.filter(p => p.kind === k).length})`])]) +
      dropdown("system", "System", systemFilter, [["all", "All systems"], ...systems.map(s => [s, s])]) +
      dropdown("status", "Project status", filter, FILTERS.map(([k, label]) => [k, `${label} (${k === "all" ? all.length : all.filter(p => p.group === k).length})`]));
    const body = list.length ? `<div class="vg-hq-grid${compactProjects ? " is-compact" : ""}">${list.map(card).join("")}</div>`     : every.length
    ? empty("No projects match the current filters.", [["Reset filters", 'data-clearsearch'], ["All systems", 'data-system="all"']])
    : empty(`No projects yet (notes with type: ${Object.keys(VGRules.PROJECT_TYPES).join(", ") || "scope-of-work"}).`, nextSteps().filter(s => s[1] !== 'data-go="projects"'));
    return `<h1 class="vg-hq-h1">Projects</h1><p class="vg-hq-lede">Every project, newest first.</p>
    <div class="vg-hq-project-tools"><button class="vg-hq-filter" data-compact aria-pressed="${compactProjects}">${compactProjects ? "Card view" : "Compact list"}</button></div>
    <div class="vg-hq-project-filters">${filters}</div>${body}${drawerHtml(every)}`;
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

