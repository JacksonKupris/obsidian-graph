  // ---- Home: what the vault says (the feed), then Do next, Needs you and Projects, and vault upkeep
  function feedCards() {
    const h = hq() || {}, nodes = (DATA.nodes || []).filter(n => !n.person && !n.ghost && !n.moc), cards = [];
    const stale = nodes.filter(n => VGRules.isStale(n, (DATA.quality || {}).stale_days));
    // on this day: what you were writing this date in earlier years, or within a few days of it
    const md = day().slice(5), thisYear = day().slice(0, 4), near = n => { if (!n.born || n.born.slice(0, 4) >= thisYear) return false; const d = Math.abs(Date.parse(`2000-${n.born.slice(5)}T12:00:00`) - Date.parse(`2000-${md}T12:00:00`)) / VGShared.DAY_MS; return d <= 3; };
    const back = nodes.filter(near).sort((a, b) => (b.bc || 0) - (a.bc || 0));
    if (back.length) cards.push({ id: "onthisday", eyebrow: "On this day", title: back[0].name, sub: `${back[0].born.slice(0, 4)}${back.length > 1 ? ` · and ${plural(back.length - 1, "more note")}: ${back.slice(1, 3).map(n => n.name).join(" · ")}` : ""}`, open: back[0].id });
    const busy = (DATA.clusters || []).map(c => ({ c, n: nodes.filter(x => x.cluster === c.id).reduce((s, x) => s + (x.recent || 0), 0) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
    if (busy) cards.push({ id: "weather", eyebrow: "Weather", title: `${busy.c.label || busy.c.name} is busiest`, sub: `${plural(busy.n, "mention")} in the dailies over the last ${DATA.recent_days || 30} days`,
      go: opts.openGraph ? ["Open the graph", "data-graph"] : null });
    const keystones = nodes.filter(n => !n.isolated).sort((a, b) => (b.bc || 0) - (a.bc || 0)).slice(0, 30).filter(n => VGRules.isStale(n, (DATA.quality || {}).stale_days));
    if (keystones.length && !vitals) cards.push({ id: "keystones", eyebrow: "Keystones", title: `${plural(keystones.length, "relied-on note")} going stale`, sub: keystones.slice(0, 3).map(n => n.name).join(" · "), open: keystones[0].id });
    const oldest = ofKind("carried").sort((a, b) => b.age - a.age)[0];
    if (oldest) cards.push({ id: "oldest", eyebrow: "Waiting longest", title: oldest.title, sub: oldest.why, open: oldest.path, item: oldest });
    const gap = (DATA.links || []).find(l => l.kind === "gap" && (DATA.nodes || []).some(n => n.id === l.source));
    if (gap) cards.push({ id: "gap", eyebrow: "A gap between notes", title: `${nameOf(gap.source)} ↔ ${nameOf(gap.target)}`, sub: gap.why || "Named together, never linked", item: LIST.find(it => it.kind === "link" && it.a === gap.source && it.b === gap.target) });
    const week = (h.decisions || []).filter(d => d.date && (Date.parse(day()) - Date.parse(d.date)) / VGShared.DAY_MS <= 7);
    if (week.length) cards.push({ id: "decided", eyebrow: "Decided this week", title: week[0].title, sub: week.length > 1 ? `and ${plural(week.length - 1, "more decision")}: ${week.slice(1, 3).map(d => d.title).join(" · ")}` : week[0].by ? `Decided by ${week[0].by}` : "", open: week[0].path });
    const ups = (h.standups || []).filter(s => (Date.parse(day()) - Date.parse(s.date)) / VGShared.DAY_MS < 7);
    if (ups.length) { const per = {}; ups.forEach(s => s.projects.forEach(p => (per[p] = (per[p] || 0) + 1)));
      const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 3), dev = ups.reduce((s, u) => s + (u.deviation || 0), 0);
      cards.push({ id: "week", eyebrow: "This week's standups", title: top.length ? top.map(([p, n]) => `${p} ${n}d`).join(" · ") : plural(ups.length, "standup"),
        sub: `${plural(ups.length, "standup")} · ${dev} hour${dev === 1 ? "" : "s"} off plan`, open: ups[0].path }); }
    if ((h.runlog || []).length) { const last = h.runlog[h.runlog.length - 1], parts = last.split(" · ");
      cards.push({ id: "runlog", eyebrow: "Latest agent run", title: parts[3] || last, sub: parts.slice(0, 3).join(" · ") }); }
    return cards;
  }
  // ---- Vitals: what the numbers say, each with what to do about it and whether it's moving
  let vitals = null, vitalsBusy = false;
  function loadVitals() {
    if (!api.vitals || vitalsBusy) return; vitalsBusy = true;
    api.vitals().then(v => { vitalsBusy = false; const same = JSON.stringify(v) === JSON.stringify(vitals); vitals = v; if (!same && (cur === "home" || cur === "review") && !destroyedHq()) render(); }).catch(e => { vitalsBusy = false; console.error("Vault Graph: vitals not worked out", e); });
  }
  const destroyedHq = () => !el.isConnected;
  const sparkLine = (a, label) => { if (!a || a.length < 2) return ""; const lo = Math.min(...a), hi = Math.max(...a), W = 120, H = 28, x = i => (i / (a.length - 1) * W).toFixed(1), y = v => (hi === lo ? H / 2 : H - 2 - (v - lo) / (hi - lo) * (H - 4)).toFixed(1); return `<svg class="vg-hq-vitalspark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><polyline points="${a.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/></svg>`; };
  const bytesWords = b => (b >= 1e9 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
  // Sync's limit, in words: what's used, how fast, and when it fills at that rate
  function syncWords() {
    const y = vitals && vitals.sync; if (!y) return null; const h = (STATE.review || {}).vitals || {}, d = VGScience.vitalsDelta(h, day(), "sync", y.used), left = VGScience.daysToLimit(h, day(), "sync", y.used, y.limit), share = y.used / y.limit;
    return { share, soon: left != null && left < 30, title: `${bytesWords(y.used)} of ${bytesWords(y.limit)} in Sync`, sub: `Sync's limit counts version history${d != null ? ` · ${d >= 0 ? "up" : "down"} ${bytesWords(Math.abs(d))} in a week` : ""}${left != null ? ` · full in about ${Math.round(left)} days at this rate` : ""}` };
  }
  function vitalsHtml() {
    if (!vitals) return "";
    const { pile, debt, web } = vitals, h = (STATE.review || {}).vitals || {}, week = (key, now, fmt = v => v) => { const d = VGScience.vitalsDelta(h, day(), key, now); return d == null ? "" : d === 0 ? " · no change in a week" : ` · ${d > 0 ? "up" : "down"} ${fmt(Math.abs(d))} in a week`; };
    const lensBtn = (k, words) => opts.openGraph ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-graphlens="${k}">${esc(words)}</button>` : "";
    const row = (title, sub, acts, spark) => `<div class="vg-hq-vital"><div class="vg-hq-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></div>${spark || ""}<div class="vg-hq-acts">${acts}</div></div>`;
    const pileWords = pile.net > 0 ? `The pile grew by ${pile.net} in 90 days` : pile.net < 0 ? `The pile shrank by ${-pile.net} in 90 days` : "The pile held level over 90 days";
    return `<section class="vg-hq-sec vg-hq-vitals"><h3>Vitals</h3><div class="vg-hq-vitalrows">` +
      (!pile.came && !pile.open ? "" : row(pileWords, `${pile.came} came in, ${pile.left} finished · ${pile.open} open from earlier days, ${pile.old} older than 30 days${week("open", pile.open)}`, `${ofKind("carried").length ? '<button class="vg-hq-btn vg-hq-btn-sm" data-go="sweep">Sweep</button>' : ""}${lensBtn("flowlens", "Flow")}`, sparkLine(pile.wip, `Tasks open over 90 days, from ${pile.wip[0]} to ${pile.wip[pile.wip.length - 1]}`))) +
      (pile.piling ? row(`${pile.piling.area} is piling up`, `${pile.piling.open} open, ${pile.piling.done} finished in 90 days: open work is at least twice its share of what gets finished`, lensBtn("flowlens", "Where the pile is")) : "") +
      (debt.top ? row(`Review ${debt.top.name} first`, `${debt.top.direct} linked directly, ${debt.top.reach} through others · ${debt.top.years.toFixed(1)} years since an edit · ${plural(debt.count, "note")} in debt${week("debt", Math.round(debt.total))}`, `${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(debt.top.id)}">Open</button>` : ""}${api.stampReviewed ? `<button class="vg-hq-btn vg-hq-btn-sm" data-vital-current="${esc(debt.top.id)}" data-vital-name="${esc(debt.top.name)}">Still current</button>` : ""}${lensBtn("triage", "Stale notes")}`) : row("No stale note has anything resting on it", `Counting ${plural(web.links, "written link")}`, "")) +
      (web.incoherence != null ? row(web.incoherence < 0.3 ? "Your links mostly run one way" : web.incoherence < 0.6 ? "Your links run partly one way" : "Your links run in many directions", `Incoherence ${web.incoherence.toFixed(2)}: 0 is a strict hierarchy, 1 is no direction · ${plural(web.links, "written link")}${web.twoWay ? `, ${web.twoWay} two-way pairs` : ""}${web.noWayUp ? ` · ${web.noWayUp} notes with no way up` : ""}${week("incoherence", +web.incoherence.toFixed(2), v => v.toFixed(2))}`, opts.openGraph ? `${web.twoWay || web.noWayUp ? lensBtn("twoway", "Hierarchy") : ""}<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-graphview="foodweb">Food web</button>` : "") : "") + (vitals.drift ? row(`${plural(vitals.drift, "note")} name a version you don't run`, "Some are history. The rest send someone to the wrong instructions", lensBtn("drift", "Version drift")) : "") + (() => { const y = syncWords(); return y && (y.share >= 0.7 || y.soon) ? row(y.title, `${y.sub} · purge it in Settings, Sync, Vault size`, "") : ""; })() + `</div></section>`;
  }
  // What's new since you last said Got it. A first install has nothing to catch up on, so the tour covers it instead.
  let newsSeenNow = null;
  function newsHtml() {
    if (!api.version || !api.hqNewsSeen) return ""; const seen = newsSeenNow || (STATE.review || {}).hqNewsSeen, tourDone = !!(STATE.review || {}).hqTour; if (!tourDone) return "";
    const list = VGRules.newsSince(seen).slice(0, 8); if (!list.length) return "";
    return `<section class="vg-hq-sec vg-hq-news"><h3>New <span>${list.length}</span></h3>${list.map((n, i) => `<button class="vg-hq-newsrow" data-news="${VGRules.NEWS.indexOf(n)}"><span>${esc(n.text)}</span></button>`).join("")}<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-sm" data-newsok>Got it</button></div></section>`;
  }
  function home() {
    const cards = feedCards(); feedAt = Math.min(feedAt, Math.max(0, cards.length - 1));
    const card = (c, i) => `<article class="vg-hq-feedcard" data-i="${i}" aria-roledescription="slide" aria-label="${i + 1} of ${cards.length}">${hills(c.id)}
      <div class="vg-hq-feedtxt"><div class="vg-hq-eyebrow">${esc(c.eyebrow)} <span>${VGShared.pad2(i + 1)} / ${VGShared.pad2(cards.length)}</span></div>
      <h2>${esc(c.title)}</h2><p>${esc(c.sub)}</p><div class="vg-hq-row">${c.open ? `<button class="vg-hq-btn" data-open="${esc(c.open)}">Open</button>` : ""}${c.go ? `<button class="vg-hq-btn" ${c.go[1]}>${esc(c.go[0])}</button>` : ""}${c.item ? buttons(c.item) : ""}</div></div></article>`;
    const feed = cards.length ? `<section class="vg-hq-feed"><div class="vg-hq-feedtrack">${cards.map(card).join("")}</div>
      ${cards.length > 1 ? `<button class="vg-hq-feednav is-prev" data-feed="-1" aria-label="Previous">${icon("left")}</button><button class="vg-hq-feednav is-next" data-feed="1" aria-label="Next">${icon("right")}</button>
      <div class="vg-hq-dots">${cards.map((_, i) => `<button class="${i === feedAt ? "is-on" : ""}" data-feedto="${i}" aria-label="Card ${i + 1}"></button>`).join("")}</div>` : ""}</section>` : "";
    const next = doNext(), needs = ofGroup("needs"), projects = VGRules.hqProjects(DATA), count = g => projects.filter(p => p.group === g).length;
    const needsBy = [["approval", "approval"], ["review", "draft to review", "drafts to review"], ["job", "job"], ["inbox", "note to file", "notes to file"], ["report", "report"], ["backlog", "vault decision"]]
      .map(([k, w, ws]) => [needs.filter(i => i.kind === k).length, w, ws]).filter(([n]) => n).map(([n, w, ws]) => plural(n, w, ws)).join(" · ");
    const tiles = `<div class="vg-hq-tiles">
      <div class="vg-hq-tile"><div class="vg-hq-eyebrow">Do next</div>${next ? `<b>${esc(next.title)}</b><small>${esc(next.why)}</small><div class="vg-hq-row">${buttons(next)}</div>` : `<b>No daily work queued.</b><div class="vg-hq-row">${api.openDaily ? '<button class="vg-hq-btn" data-daily>Open today\'s journal</button>' : ""}</div>`}</div>
      ${VGParts.cards([{ value: needs.length, label: "Needs you", sub: needsBy || "Nothing waiting on you", data: { go: "needs" } }, { value: count("active"), label: "Projects", sub: `in progress · ${count("planned")} planned · ${count("waiting")} waiting`, data: { go: "projects" } }])}</div>`;
    const upkeep = ofGroup("upkeep").slice(0, 3);
    const status = `<p class="vg-hq-status">${plural(nodes0(), "note")} · ${plural((DATA.clusters || []).length, "topic")}${DATA.date ? ` · analysed ${esc(shortDate(DATA.date))}` : ""}${api.recentChanges ? ' · <button class="vg-hq-linkbtn" data-go="changes">Recent changes</button>' : ""}${opts.openGraph ? ' · <button class="vg-hq-linkbtn" data-graph>Open the graph</button>' : ""}</p>`;
    const off = new Set((STATE.review || {}).hqHome || []), on = k => !off.has(k);
    if (isNewVault()) return `<h1 class="vg-hq-h1">Welcome</h1>${welcomeHtml()}`;
    return `<h1 class="vg-hq-h1">${greeting()}</h1>${on("brief") ? briefHtml() : ""}${captureBox()}${on("loop") ? flow() : ""}${journalWarning()}${hiddenKindsLine()}${newsHtml()}${on("cards") ? tiles : ""}${on("vitals") ? vitalsHtml() : ""}${on("momentum") ? momentumHtml() : ""}${on("threads") ? threadsHtml(6) : ""}${on("feed") ? feed : ""}` +
      (on("upkeep") && upkeep.length ? section("Vault upkeep", upkeep) : "") + status + customizeHtml(off);
  }
  // Home's parts, each one yours to turn off
  const HOME_PARTS = [["brief", "Morning brief"], ["loop", "Plan, Do, Wrap up"], ["cards", "Do next, Needs you, Projects"], ["vitals", "Vitals"], ["momentum", "Momentum"], ["threads", "Threads"], ["feed", "On this day and more"], ["upkeep", "Vault upkeep"]];
  let customizing = false;
  const customizeHtml = off => !api.hqHome ? "" : customizing ? `<section class="vg-hq-sec vg-hq-customize"><h3>Show on Home</h3><div class="vg-hq-filters" role="group" aria-label="Show on Home">${HOME_PARTS.map(([k, label]) => `<button class="vg-hq-filter${off.has(k) ? "" : " is-on"}" data-homepart="${k}" aria-pressed="${!off.has(k)}">${esc(label)}</button>`).join("")}</div><div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-ghost" data-customize>Done</button></div></section>` : `<div class="vg-hq-row"><button class="vg-hq-linkbtn vg-hq-customizebtn" data-customize>Customize Home</button></div>`;
  function toggleHomePart(k) { const off = new Set((STATE.review || {}).hqHome || []); if (off.has(k)) off.delete(k); else off.add(k); const list = [...off]; STATE = { ...STATE, review: { ...(STATE.review || {}), hqHome: list } }; render(); api.hqHome(list); }
  // Momentum: what got done, day by day, for the last two weeks
  function momentumHtml() {
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now()); d.setDate(d.getDate() - 13 + i); return VGRules.localDay(d); });
    const per = days.map(d => VGRules.doneToday(DATA, STATE.review, d).length), total = per.reduce((a, b) => a + b, 0); if (!total) return "";
    const peak = Math.max(1, ...per); let streak = 0; for (let i = per.length - 1; i >= 0; i--) { if (per[i]) streak++; else if (i < per.length - 1) break; }
    return `<section class="vg-hq-momentum" aria-label="Done in the last two weeks"><div><span class="vg-hq-big">${total}</span><small>done in 2 weeks${streak > 1 ? ` · ${streak} days running` : ""}</small></div><div class="vg-hq-sparkbars">${per.map((n, i) => `<i title="${esc(days[i])}: ${n}" style="height:${Math.max(6, Math.round(n / peak * 100))}%"${n ? "" : ' class="is-none"'}></i>`).join("")}</div></section>`;
  }
  // a vault with nothing to show yet: what to do first, not a page of zeroes
  const isNewVault = () => { const h = hq() || {}; return !(h.journals || []).length && !(h.projects || []).length && !LIST.length; };
  const welcomeHtml = () => `<p class="vg-hq-brief">This is your home screen. Everything you capture and everything your notes know comes together here.</p>${captureBox()}<section class="vg-hq-welcome">
    <div><i>1</i><b>Capture something</b><p>Type a task above and press Enter. It goes in today's journal.</p></div>
    <div><i>2</i><b>Star what matters</b><p>Pick up to three things for the day from Today.</p></div>
    <div><i>3</i><b>Press Ctrl K</b><p>Find anything, or do anything, from one box.</p></div></section><div class="vg-hq-row">${api.openDaily ? '<button class="vg-hq-btn vg-hq-btn-primary" data-daily>Open today\'s journal</button>' : ""}${opts.openGraph ? '<button class="vg-hq-btn" data-graph>See the graph</button>' : ""}</div>`;
  const nodes0 = () => VGRules.noteCounts(DATA.nodes).notes;
  // the capture box: Enter makes a task in today's journal, Shift+Enter a note
  let captureText = "";
  const captureBox = () => api.capture ? `<div class="vg-hq-capture"><input class="vg-hq-captureinput" type="text" value="${esc(captureText)}" placeholder="Capture a task, a note, an idea…" aria-label="Capture"><button class="vg-hq-btn vg-hq-btn-primary" data-capture="task" title="Add to today's journal (Enter)">Add task</button>${projectsToAdd().length ? '<button class="vg-hq-btn" data-captureto title="Choose where the task goes (Ctrl+Enter)">Add to…</button>' : ""}<button class="vg-hq-btn" data-capture="note" title="Save as a note (Shift+Enter)">Save note</button></div>` : "";
  // to: a project, for a task that belongs in its note. given: words from elsewhere (the palette), leaving the box as it is.
  async function capture(kind, to, given) {
    const box = el.querySelector(".vg-hq-captureinput"), text = (given || (box ? box.value : captureText)).trim(); if (!text) { if (box) box.focus(); return; }
    try { const path = await (to ? api.capture(text, kind, to.path) : api.capture(text, kind)); if (!given) { captureText = ""; const now = el.querySelector(".vg-hq-captureinput"); if (now) { now.value = ""; now.focus(); } } toast(to ? `Added to ${to.title}` : kind === "note" ? "Note saved" : "Added to today", api.lastUndo && api.undo ? () => { const u = api.lastUndo(); if (u) api.undo(u.id != null ? u.id : u); } : null); if (kind === "note" && path && api.openNote && opts.openCaptured) api.openNote(path); }
    catch (error) { toast(error.message || "Couldn't save that", null, true); }
  }
  // the projects a task can go in: in progress first, then what's planned or waiting; not what's closed
  const ADD_ORDER = ["active", "planned", "waiting"];
  const projectsToAdd = () => VGRules.hqProjects(DATA).filter(p => p.group !== "closed").sort((a, b) => (ADD_ORDER.indexOf(a.group) + 1 || 9) - (ADD_ORDER.indexOf(b.group) + 1 || 9));
  async function captureTo(given) {
    const box = el.querySelector(".vg-hq-captureinput"), text = (given || (box ? box.value : captureText)).trim(); if (!text) { if (box) box.focus(); return; }
    const projects = projectsToAdd(), TODAY = "\u0000today";
    const to = await chooseFrom(`Where does “${text.length > 60 ? text.slice(0, 59) + "…" : text}” go?`, "Filter projects", "No project matches.", [{ value: TODAY, label: "Today's journal" }, ...projects.map(p => ({ value: p.path, label: p.title, sub: statusWord(p) }))]);
    if (to === null) return;
    return capture("task", to === TODAY ? null : projects.find(p => p.path === to), given);
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

