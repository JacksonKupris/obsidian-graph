  // ---- the cockpit: the rail beside the list, the morning brief, threads and the weekly review. The rail is the second brain
  // made visible: pick anything and it shows what the vault knows about it, without leaving the list you're working through.
  let selKey = null;
  const NO_RAIL = new Set(["projects", "automations", "sweep", "rows", "review", "wrap"]);
  const HAS_HERO = new Set(["home", "today"]);   // these screens already show Do next in full
  const railOn = () => el.clientWidth >= RAIL_WIDTH && !NO_RAIL.has(cur) && !globalQuery.trim();
  const RAIL_WIDTH = 1100;
  // what the rail shows: the item you picked, or else the first thing on this screen. Nothing unrelated to the screen.
  const selected = () => BY_KEY.get(selKey) || (cur === "needs" ? ofGroup("needs")[0] : null) || (HAS_HERO.has(cur) ? doNext() : null);
  let threadsCache = null;   // worked out once per list: compute() clears it
  const threads = () => threadsCache || (threadsCache = VGRules.hqThreads(LIST.filter(it => it.group === "today"), VGRules.hqProjects(DATA)));
  function railHtml() {
    const it = selected();
    if (!it) return `<div class="vg-hq-railempty"><p>Nothing selected.</p><small>Pick an item to see what your notes know about it.</small></div>`;
    const th = threads().find(t => t.items.includes(it)), who = VGRules.hqPeople(DATA, [it]).filter(p => p.items.length), src = it.path || (it.ids || [])[0];
    const project = th && th.project, decisions = project ? (project.decisions || []).slice(0, 3) : [];
    const echoesHero = !BY_KEY.get(selKey) && HAS_HERO.has(cur) && it === doNext();   // the title and buttons are right beside it
    return `${echoesHero ? `<div class="vg-hq-eyebrow">About Do next</div>` : `<div class="vg-hq-eyebrow">${esc(VGRules.kindWords(it.kind))}</div><h2 class="vg-hq-railtitle">${esc(it.title)}</h2>${it.why ? `<p class="vg-hq-railwhy">${esc(it.why)}</p>` : ""}
      <div class="vg-hq-row">${starButton(it)}${buttons(it)}</div>`}
      ${project ? `<div class="vg-hq-railblock"><div class="vg-hq-eyebrow">Thread</div><button class="vg-hq-link" data-proj="${esc(project.path)}">${esc(project.title)}<small>${esc(project.status || "no status")} · ${plural(th.items.length, "open item")}</small></button></div>` : ""}
      ${who.length ? `<div class="vg-hq-railblock"><div class="vg-hq-eyebrow">People</div><div class="vg-hq-row">${who.map(p => `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div></div>` : ""}
      ${decisions.length ? `<div class="vg-hq-railblock"><div class="vg-hq-eyebrow">Decided</div>${decisions.map(d => `<button class="vg-hq-link" data-open="${esc(d.path)}">${esc(d.title)}<small>${esc(d.date || "")}</small></button>`).join("")}</div>` : ""}
      ${contextPanel(it, true)}${src && api.openNote ? `<div class="vg-hq-row vg-hq-railfoot"><button class="vg-hq-linkbtn" data-open="${esc(src)}">${esc(nameOf(src))}</button></div>` : ""}`;
  }
  const railAside = () => railOn() ? `<aside class="vg-hq-rail" aria-label="About the selected item" aria-live="polite">${railHtml()}</aside>` : "";
  // just the rail: moving through a list doesn't rebuild the list
  function updateRail() { const r = el.querySelector(".vg-hq-rail"); if (r) r.innerHTML = railHtml(); el.querySelectorAll(".vg-hq-item.is-sel").forEach(x => x.classList.remove("is-sel")); const it = selected(); if (it) { const row = [...el.querySelectorAll(".vg-hq-item[data-key]")].find(x => x.dataset.key === it.key); if (row) row.classList.add("is-sel"); } }
  function selectItem(key) { selKey = key; cursorKey = key; updateRail(); }

  // ---- the morning brief: the day in a few sentences, from what the vault already says
  function briefHtml() {
    const b = VGRules.hqBrief(DATA, LIST, STATE.review, day(), threads());
    return b.length ? `<p class="vg-hq-brief">${b.map(esc).join(" ")}</p>` : "";
  }
  // Threads: the same open work, grouped by the project it belongs to, which is how it's thought about
  function threadsHtml(limit) {
    const list = threads().filter(t => t.project || t.area), shown = limit ? list.slice(0, limit) : list;
    if (!shown.length) return "";
    return `<section class="vg-hq-sec"><h3>Threads<span>${list.length}</span></h3><div class="vg-hq-threads">${shown.map(t => `<button class="vg-hq-thread" ${t.project ? `data-proj="${esc(t.project.path)}"` : 'data-go="threads"'}><b>${esc(t.title)}</b><small>${plural(t.items.length, "open item")}${t.project && t.project.status ? ` · ${esc(t.project.status)}` : ""}</small><span class="vg-hq-threadbar"><i style="width:${Math.min(100, t.items.length * 12)}%"></i></span></button>`).join("")}</div>${limit && list.length > limit ? `<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-ghost" data-go="threads">All ${list.length} threads</button></div>` : ""}</section>`;
  }
  function threadsScreen() {
    const all = threads();
    return `<h1 class="vg-hq-h1">Threads</h1><p class="vg-hq-lede">Your open work by what it belongs to.</p>` + (all.length ? all.map(t => section(t.title, t.items)).join("") : empty("No open work yet.", [["Today", 'data-go="today"']]));
  }
  // ---- the weekly review: five minutes, in order, each step going to where it's done
  function reviewScreen() {
    const h = hq() || {}, days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now()); d.setDate(d.getDate() - i); return VGRules.localDay(d); }).reverse();
    const perDay = days.map(d => ({ d, n: VGRules.doneToday(DATA, STATE.review, d).length })), total = perDay.reduce((s, x) => s + x.n, 0), peak = Math.max(1, ...perDay.map(x => x.n));
    const inbox = ofKind("inbox"), carried = ofKind("carried"), stuck = VGRules.hqProjects(DATA).filter(p => p.group === "active" && Array.isArray(p.days) && !p.days.slice(-14).some(Boolean));
    const stale = (DATA.nodes || []).filter(n => !n.person && !n.ghost && !n.moc && !n.isolated && VGRules.isStale(n, (DATA.quality || {}).stale_days)).sort((a, b) => (b.bc || 0) - (a.bc || 0)).slice(0, 5);
    const ups = (h.standups || []).filter(s => days.includes(s.date)), step = (n, title, fact, action) => `<section class="vg-hq-reviewstep"><i>${n}</i><div><b>${esc(title)}</b><p>${fact}</p>${action || ""}</div></section>`;
    return `<h1 class="vg-hq-h1">Weekly review</h1><p class="vg-hq-lede">${plural(total, "thing")} done in 7 days · ${plural(ups.length, "standup")}.</p>
      <div class="vg-hq-weekbars" role="img" aria-label="Done per day">${perDay.map(x => `<span title="${esc(x.d)}: ${x.n}"><i style="height:${Math.round(x.n / peak * 100)}%"></i><small>${esc(DAYS[new Date(x.d + "T12:00:00").getDay()])}</small></span>`).join("")}</div>` +
      step(1, "Empty the inbox", inbox.length ? plural(inbox.length, "note") + " to file." : "Nothing to file.", inbox.length ? '<button class="vg-hq-btn" data-go="needs" data-needs-to="inbox">File them</button>' : "") +
      step(2, "Sweep what's carried over", carried.length ? plural(carried.length, "task") + " rolling forward." : "Nothing carried over.", carried.length ? '<button class="vg-hq-btn" data-go="sweep">Sweep</button>' : "") +
      step(3, "Check projects that stopped moving", stuck.length ? `${plural(stuck.length, "active project")} with no activity in 14 days: ${stuck.slice(0, 3).map(p => esc(p.title)).join(" · ")}` : "Every active project moved in the last 14 days.", stuck.length ? '<button class="vg-hq-btn" data-go="projects">Projects</button>' : "") +
      step(4, "Refresh what you rely on", stale.length ? `Relied on and gone stale: ${stale.slice(0, 3).map(n => esc(n.name)).join(" · ")}` : "Nothing you rely on has gone stale.", stale.length && api.openNote ? `<button class="vg-hq-btn" data-open="${esc(stale[0].id)}">Open the first</button>` : "") +
      step(5, "Decide what's next", `Star up to ${VGRules.FOCUS_MAX} to do next.`, '<button class="vg-hq-btn vg-hq-btn-primary" data-go="today">Plan</button>');
  }
