  // ---- Home: what the vault says (the feed), then Do next, Needs you and Projects, and vault upkeep
  function feedCards() {
    const h = hq() || {}, nodes = (DATA.nodes || []).filter(n => !n.person && !n.ghost && !n.moc), cards = [];
    const stale = nodes.filter(n => VGRules.isStale(n, (DATA.quality || {}).stale_days));
    // on this day: what you were writing this date in earlier years, or within a few days of it
    const md = day().slice(5), thisYear = day().slice(0, 4), near = n => { if (!n.born || n.born.slice(0, 4) >= thisYear) return false; const d = Math.abs(Date.parse(`2000-${n.born.slice(5)}T12:00:00`) - Date.parse(`2000-${md}T12:00:00`)) / 864e5; return d <= 3; };
    const back = nodes.filter(near).sort((a, b) => (b.bc || 0) - (a.bc || 0));
    if (back.length) cards.push({ id: "onthisday", eyebrow: "On this day", title: back[0].name, sub: `${back[0].born.slice(0, 4)}${back.length > 1 ? ` · and ${plural(back.length - 1, "more note")}: ${back.slice(1, 3).map(n => n.name).join(" · ")}` : ""}`, open: back[0].id });
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
    const needsBy = [["approval", "approval"], ["review", "draft to review", "drafts to review"], ["job", "job"], ["inbox", "note to file", "notes to file"], ["report", "report"], ["backlog", "vault decision"]]
      .map(([k, w, ws]) => [needs.filter(i => i.kind === k).length, w, ws]).filter(([n]) => n).map(([n, w, ws]) => plural(n, w, ws)).join(" · ");
    const tiles = `<div class="vg-hq-tiles">
      <div class="vg-hq-tile"><div class="vg-hq-eyebrow">Do next</div>${next ? `<b>${esc(next.title)}</b><small>${esc(next.why)}</small><div class="vg-hq-row">${buttons(next)}</div>` : `<b>No daily work queued.</b><div class="vg-hq-row">${api.openDaily ? '<button class="vg-hq-btn" data-daily>Open today\'s journal</button>' : ""}</div>`}</div>
      <button class="vg-hq-tile" data-go="needs"><span class="vg-hq-eyebrow">Needs you</span><span class="vg-hq-big">${needs.length}</span><small>${esc(needsBy || "Nothing waiting on you")}</small></button>
      <button class="vg-hq-tile" data-go="projects"><span class="vg-hq-eyebrow">Projects</span><span class="vg-hq-big">${count("active")}</span><small>in progress · ${count("planned")} planned · ${count("waiting")} waiting</small></button></div>`;
    const upkeep = ofGroup("upkeep").slice(0, 3);
    const status = `<p class="vg-hq-status">${plural(nodes0(), "note")} · ${plural((DATA.clusters || []).length, "topic")}${DATA.date ? ` · analysed ${esc(shortDate(DATA.date))}` : ""}${opts.openGraph ? ' · <button class="vg-hq-linkbtn" data-graph>Open the graph</button>' : ""}</p>`;
    return `<h1 class="vg-hq-h1">${greeting()}</h1>${briefHtml()}${captureBox()}${flow()}${journalWarning()}${hiddenKindsLine()}${tiles}${threadsHtml(6)}${feed}` +
      (upkeep.length ? section("Vault upkeep", upkeep) : "") + status;
  }
  const nodes0 = () => (DATA.nodes || []).filter(n => !n.person && !n.ghost && !n.moc).length;
  // the capture box: Enter makes a task in today's journal, Shift+Enter a note
  let captureText = "";
  const captureBox = () => api.capture ? `<div class="vg-hq-capture"><input class="vg-hq-captureinput" type="text" value="${esc(captureText)}" placeholder="Capture a task, a note, an idea…" aria-label="Capture"><button class="vg-hq-btn vg-hq-btn-primary" data-capture="task" title="Add to today's journal (Enter)">Add task</button><button class="vg-hq-btn" data-capture="note" title="Save as a note (Shift+Enter)">Save note</button></div>` : "";
  async function capture(kind) {
    const box = el.querySelector(".vg-hq-captureinput"), text = (box ? box.value : captureText).trim(); if (!text) { if (box) box.focus(); return; }
    try { const path = await api.capture(text, kind); captureText = ""; if (box) { box.value = ""; box.focus(); } const c = ctx(); toast(kind === "note" ? "Note saved" : "Added to today", api.lastUndo && api.undo ? () => { const u = api.lastUndo(); if (u) api.undo(u.id != null ? u.id : u); } : null); if (kind === "note" && path && api.openNote && opts.openCaptured) api.openNote(path); }
    catch (error) { toast(error.message || "Couldn't save that", null, true); }
  }
  // ---- People: who your open work is about, for the moment before you talk to them
  function peopleScreen() {
    const people = VGRules.hqPeople(DATA, LIST), withWork = people.filter(p => p.items.length), others = people.filter(p => !p.items.length);
    const card = p => `<section class="vg-hq-sec vg-hq-person"><h3>${api.openNote ? `<button class="vg-hq-linkbtn" data-open="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name)}<span>${p.items.length}</span></h3>${taskRows(p.items)}${p.decisions.length ? `<div class="vg-hq-row">${p.decisions.map(d => `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-open="${esc(d.path)}">Decided: ${esc(d.title)}</button>`).join("")}</div>` : ""}</section>`;
    return `<h1 class="vg-hq-h1">People</h1><p class="vg-hq-lede">${withWork.length ? `${plural(withWork.length, "person", "people")} in your open work.` : "No open work names anyone yet."}</p>` +
      (withWork.length ? withWork.map(card).join("") : empty("Link a person in a task and they show up here.", [["Today", 'data-go="today"']])) +
      (others.length ? `<p class="vg-hq-status">Nothing open with ${others.slice(0, 12).map(p => api.openNote ? `<button class="vg-hq-linkbtn" data-open="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name)).join(", ")}</p>` : "");
  }
  const greeting = () => { const h = now().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

