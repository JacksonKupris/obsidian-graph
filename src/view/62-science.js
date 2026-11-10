  // ---------------------------------------------------------------- lenses from other sciences
  // Each is a real method (src/science.js, held to known answers in tests/test_science.js); this part only draws what it returns,
  // and says what the method can't tell you. Blast radius: epidemiology. Task survival: clinical trials. Single points of failure:
  // reliability engineering and network science.
  const sciNotes = () => nodes.filter(n => !special(n) && !n.ghost);
  let sciGraph = null, sciGraphFor = null;
  // the notes as a network: cached until the links change. Links are stored without a direction, so anything spreading goes both ways.
  function noteGraph() {
    if (sciGraph && sciGraphFor === linkGen) return sciGraph;
    const ids = sciNotes().map(n => n.id); sciGraphFor = linkGen;
    // a refresh hands over new link objects: keep the same graph unless a link really changed, so results worked out from it stay
    const g = VGScience.graphOf(ids, links.filter(l => l.kind === "link").map(l => [l.s.id, l.t.id]));
    return sciGraph = sciGraph && VGScience.graphKey(sciGraph) === VGScience.graphKey(g) ? sciGraph : g;
  }
  // which way each link points, from the host (Obsidian's index, less the links in generated sections: VGRules.writtenLinks). The graph
  // data stores links without a direction, so with no host (the test page) this is null and whatever needs direction says it doesn't have it.
  function linkOut() { const raw = opts.writtenLinks && opts.writtenLinks(); return raw && Object.keys(raw).length ? raw : null; }
  let sciDir = null, sciDirFor = null;
  // notes as a one-way network, only links the graph itself draws: [from, to] where from links to to
  function directedNotes() {
    if (sciDirFor === linkGen) return sciDir;
    const raw = linkOut(); sciDirFor = linkGen; if (!raw) return sciDir = null;
    const ids = sciNotes().map(n => n.id), pairs = []; for (const l of links) { if (l.kind !== "link") continue; const a = l.s.id, b = l.t.id, ab = raw[a] && raw[a][b], ba = raw[b] && raw[b][a]; if (ab) pairs.push([a, b]); if (ba) pairs.push([b, a]); }
    const d = VGScience.directedGraph(ids, pairs); return sciDir = sciDir && VGScience.graphKey(sciDir) === VGScience.graphKey(d) ? sciDir : d;
  }
  // a mistake travels the other way from a link: to the notes that link to the wrong one, which lean on it
  function spreadGraph() { const d = directedNotes(); if (!d) return noteGraph(); if (d.spread) return d.spread; return d.spread = VGScience.directedGraph(d.ids, d.edges.map(([a, b]) => [d.ids[b], d.ids[a]])); }
  const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
  const sciFacts = list => VGParts.cards(list.map(([value, label, hint, open]) => ({ value, label, hint, open })));
  // what a result means, under the thing it explains, in plain words: a tooltip isn't there on a phone
  const sciRead = VGParts.howTo;
  const lensAbout = (text, label = "About this data") => VGParts.more({ label, body: `<p>${text}</p>` });
  // a lens's list: a heading with its count, one short line, the first few rows and the rest behind a show more
  const lensSec = (title, rows, { count = rows.length, hint, lead = "", about, first = 5, word = "more", empty = "None.", cls } = {}) => VGParts.section({ title, count, hint, body: `${about ? lensAbout(about, "About this list") : ""}${lead}${rows.length ? VGParts.list(rows, { first, word, cls }) : `<p class="vg-muted vg-lens-note">${empty}</p>`}${count != null && count > rows.length ? `<p class="vg-muted vg-lens-note">The first ${rows.length} of ${count}.</p>` : ""}` });
  const noteLine = (id, sub, acts = "") => `<div class="vg-sugg">${noteRow(id, sub)}${acts ? `<span class="vg-sugg-acts">${acts}</span>` : ""}</div>`;
  const topicLine = (c, sub, acts = "") => `<div class="vg-sugg"><button class="vg-item" data-cl="${c}"><span class="vg-dot" style="background:${colorOf(c)}"></span><span class="vg-item-main"><span>${esc(clusterName(c))}</span>${sub ? `<span class="vg-item-sub">${sub}</span>` : ""}</span></button>${acts ? `<span class="vg-sugg-acts">${acts}</span>` : ""}</div>`;
  // what's behind a card: rows the lens already knows how to draw, wired like the lens's own (VGParts.wire's onOpen)
  const rowsDetail = (title, rows, word = "more") => () => ({ title, body: rows().length ? VGParts.list(rows(), { first: 8, word }) : `<p>None.</p>` });
  const notesDetail = (title, ids, sub) => rowsDetail(title, () => ids().filter(id => byId[id]).map(id => noteLine(id, sub ? sub(id) : "")), "notes");
  const taskRow = r => VGParts.row({ title: VGRules.plainTask(r.text), sub: `${r.event ? "done after" : "open"} ${dayWords(r.t)} · since ${r.born}`, open: r.path && opts.openNote ? r.path : null });
  const taskList = (list, word = "tasks") => list.length ? VGParts.list(list.map(taskRow), { first: 8, word }) : `<p>None.</p>`;
  // one chart for all three: x and y in data units, series as lines (a stair for survival) with an optional band and tick marks
  function sciChart(o) {
    const VW = 720, VH = 240, L = 44, R = 14, T = 12, B = 34, x0 = o.xmin || 0, x = v => L + (VW - L - R) * Math.min(1, (v - x0) / (o.xmax - x0)), y = v => VH - B - (VH - T - B) * Math.min(1, v / (o.ymax || 1));
    const path = (pts, step) => pts.map((p, i) => { const X = x(p[0]).toFixed(1), Y = y(p[1]).toFixed(1); if (!i) return `M${X} ${Y}`; return step ? `H${X}V${Y}` : `L${X} ${Y}`; }).join("");
    const band = s => { if (!s.band) return ""; const up = s.band.map((b, i) => `${i ? `H${x(b[0]).toFixed(1)}` : `M${x(b[0]).toFixed(1)}`}V${y(b[2]).toFixed(1)}`).join(""), dn = s.band.slice().reverse().map(b => `V${y(b[1]).toFixed(1)}H${x(b[0]).toFixed(1)}`).join(""); return `<path class="vg-sci-band ${s.cls || ""}" d="${up}H${x(s.band[s.band.length - 1][0]).toFixed(1)}${dn}Z"/>`; };
    const grid = (o.yticks || [0, 0.25, 0.5, 0.75, 1]).map(v => `<line class="vg-sci-grid" x1="${L}" x2="${VW - R}" y1="${y(v)}" y2="${y(v)}"/><text class="vg-rv-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(o.yfmt ? o.yfmt(v) : pct(v))}</text>`).join("");
    const xt = (o.xticks || []).map(v => `<text class="vg-rv-tick" x="${x(v)}" y="${VH - B + 16}" text-anchor="middle">${esc(o.xfmt ? o.xfmt(v) : v)}</text>`).join("");
    const marks = (o.marks || []).map((m, i) => `<line class="vg-sci-mark ${m.cls || ""}" x1="${x(m.x)}" x2="${x(m.x)}" y1="${T}" y2="${VH - B}"/><text class="vg-rv-tick vg-sci-marktext" x="${Math.min(VW - R - 2, x(m.x) + 4)}" y="${T + 10 + i * 12}"${x(m.x) > VW * 0.75 ? ` text-anchor="end"` : ""}>${esc(m.label)}</text>`).join("");
    const lines = o.series.map(s => `${band(s)}<path class="vg-sci-line ${s.cls || ""}" d="${path(s.pts, s.step)}"/>${(s.ticks || []).map(t => `<line class="vg-sci-censor ${s.cls || ""}" x1="${x(t[0])}" x2="${x(t[0])}" y1="${y(t[1]) - 3}" y2="${y(t[1]) + 3}"/>`).join("")}`).join("");
    return `<svg class="vg-sci-chart" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${esc(o.label)}">${grid}${xt}<text class="vg-rv-tick" x="${(L + VW - R) / 2}" y="${VH - 4}" text-anchor="middle">${esc(o.xlabel || "")}</text>${marks}${lines}</svg>`;
  }

  // ---- Blast radius: if this note is wrong, how far does the mistake travel? SIR on the link network
  let blastT = null, blastSeed = null, blastSweep = null, blastSweepFor = null;
  const BLAST_MAX = 0.6, BLAST_SEEDS = 60, BLAST_RUNS = 150;
  function lensBlast() {
    const g = spreadGraph(), oneWay = !!g.directed; if (g.n < 3 || !g.edges.length) return emptyNext("Blast radius needs notes that link to each other.", "search");
    const E = VGScience.epidemic(g); if (blastT == null) blastT = Math.min(BLAST_MAX, +(Math.max(E.Tc, 0.05) * 1.2).toFixed(2));
    if (blastSweepFor !== g) { blastSweepFor = g; blastSweep = VGScience.sweep(g, Array.from({ length: 25 }, (_, i) => BLAST_MAX * i / 24), 80); }
    const T = blastT, R0 = E.R0(T), byDeg = g.adj.map((a, i) => [i, a.length]).sort((a, b) => b[1] - a[1] || (g.ids[a[0]] > g.ids[b[0]] ? 1 : -1));
    const picks = byDeg.slice(0, BLAST_SEEDS).map(x => x[0]), seedAt = blastSeed != null && g.at.has(blastSeed) ? g.at.get(blastSeed) : null; if (seedAt != null && !picks.includes(seedAt)) picks.push(seedAt);
    const res = picks.map(i => ({ i, ...VGScience.outbreakStats(g, i, T, BLAST_RUNS), deg: g.adj[i].length })).sort((a, b) => b.mean - a.mean), top = res[0];
    // a note that reaches more than its links suggest: the risk a link count won't show you
    const byReach = new Map(res.map((r, k) => [r.i, k])), byLinks = new Map(res.slice().sort((a, b) => b.deg - a.deg).map((r, k) => [r.i, k])), hidden = r => byLinks.get(r.i) - byReach.get(r.i) >= 8;
    const verdict = R0 < 1 ? `Below the threshold: at this T each note passes a mistake to ${R0.toFixed(2)} others on average, so it dies out.` : `Above the threshold: each note passes a mistake to ${R0.toFixed(2)} others on average, so one can run through a large part of the vault.`;
    const sel = res.find(r => r.i === seedAt) || top, recheck = sel.hit.map((p, i) => [i, p, sel.gen[i]]).filter(x => x[0] !== sel.i && x[1] >= 0.05).sort((a, b) => b[1] - a[1]);
    return `${sciFacts([[R0.toFixed(2), "R₀ at this T", "How many notes one wrong note passes its mistake to. Over 1, it can keep spreading on its own."], [E.Tc.toFixed(2), "threshold T꜀", "The tipping point: above this T, one mistake can reach much of the vault."], [E.TcSpectral.toFixed(2), "1 / λ₁", "A second estimate of the tipping point, from how the hubs connect. Lower means mistakes spread more easily."], [E.excess.toFixed(1), "links onward", "Reach a note and this is how many more links you typically find. Hubs push it up."]])}
      <p class="vg-sci-verdict"><b>${esc(verdict)}</b></p>
      <label class="vg-sci-slider"><span>T: the chance a mistake is carried across one link <b>${T.toFixed(2)}</b></span><input type="range" min="0.02" max="${BLAST_MAX}" step="0.01" value="${T}" data-blast-t aria-label="Transmissibility"></label>
      ${sciChart({ label: "Share of the vault an outbreak reaches, against T", xmax: BLAST_MAX, xticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], xfmt: v => v.toFixed(1), xlabel: "transmissibility T", series: [{ pts: blastSweep.map(s => [s.T, s.mean]), cls: "is-a" }, { pts: blastSweep.map(s => [s.T, s.pBig]), cls: "is-b" }], marks: [{ x: E.Tc, label: "T꜀", cls: "is-warn" }, { x: T, label: "you are here" }] })}
      <p class="vg-sci-key"><i class="is-a"></i>share of notes reached <i class="is-b"></i>chance of a large outbreak (10%+ of notes)</p>
      ${sciRead("The solid line is how much of the vault one mistake reaches as T rises. It stays low, then climbs at the threshold, where each wrong note starts passing the mistake to more than one other. The dashed line is how likely a large outbreak is. Move T to match how much your notes copy from each other.")}
      ${lensAbout(`Method: SIR as bond percolation, ${BLAST_RUNS} runs per note, seeded so the answer repeats. T is your judgement of how far a mistake gets copied, not something the vault can measure. ${oneWay ? "A mistake travels from a note to the notes that link to it, since those are the ones leaning on it. Links in Related sections and similar-meaning lines don't count: only links written into a note do." : "This page has no link direction, so a mistake travels both ways here."} R₀ assumes a network with no tight groups.`)}
      ${lensSec(`Largest blast radius, of the ${BLAST_SEEDS} most linked`, res.map(r => `<div class="vg-sugg${r === sel ? " is-on" : ""}">${noteRow(g.ids[r.i], `reaches ${r.mean.toFixed(1)} notes on average · 1 in 10 runs ${r.p90}+ · ${plural(r.deg, "link")}${hidden(r) ? " · more than its links suggest" : ""}`)}<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-blast-seed="${esc(g.ids[r.i])}">Trace</button></span></div>`), { word: "notes" })}
      ${lensSec(`If ${byId[g.ids[sel.i]].name} is wrong, check these first`, recheck.slice(0, 40).map(x => noteLine(g.ids[x[0]], `${pct(x[1])} chance · ${x[2] < 1.5 ? "direct link" : `about ${Math.round(x[2])} links away`}`)), { count: recheck.length, word: "notes", empty: "At this T the mistake stays in the note. Raise T to see where it would go.", lead: `<div class="vg-row"><button class="vg-btn vg-btn-sm" data-blast-show="${esc(g.ids[sel.i])}">Show them on the graph</button></div>` })}`;
  }
  function blastShow(id) { const g = spreadGraph(), s = VGScience.outbreakStats(g, g.at.get(id), blastT, BLAST_RUNS), set = new Set([id]); s.hit.forEach((p, i) => { if (p >= 0.05) set.add(g.ids[i]); }); setHighlight(set, `${byId[id].name}: ${plural(set.size - 1, "note")} at risk`); if (!lensBeside()) closeLens(); fit(n => set.has(n.id), 500); }

  // ---- Task survival: how long a task stays open, the way a trial follows patients. A task still open is censored, not ignored.
  let survivalSplit = "person", survivalLives = null, lensCards = {};   // lensCards: what's behind the open lens's cards (VGParts.wire)
  const taskSplits = {
    person: ["names someone", r => VGRules.hqPeople(DATA, [{ kind: "task", text: r.text, title: r.text }]).some(p => p.items.length)],
    link: ["links a note", r => /\[\[/.test(r.text)],
    short: ["is 8 words or fewer", r => r.text.trim().split(/\s+/).length <= 8],
    recent: ["written in the last 90 days", r => VGShared.utcNoon(DATA.date || today()) - VGShared.utcNoon(r.born) <= 90 * VGShared.DAY_MS],
    monday: ["written Monday", r => VGShared.noon(r.born).getDay() === 1],
  };
  const dayWords = d => d == null ? "not reached" : `${d} day${d === 1 ? "" : "s"}`;
  const stair = km => km.steps.map(x => [x.t, x.s]);
  const censorTicks = (km, every) => km.steps.filter(x => x.censored).filter((_, i) => i % every === 0).map(x => [x.t, x.s]);
  async function loadSurvival() {
    const journals = opts.taskHistory ? await opts.taskHistory() : ((DATA.hq || {}).journals || []);
    survivalLives = VGScience.taskLives(journals, DATA.date || today()); return renderSurvival();
  }
  function renderSurvival() {
    const { rows, skipped } = survivalLives || { rows: [], skipped: {} };
    if (rows.length < 5) return emptyNext("Task survival needs journals with at least a few tasks.", "daily", "search");
    const S = VGScience, km = S.kaplanMeier(rows), events = km.events, median = S.medianOf(km), last = km.steps[km.steps.length - 1].t, horizon = Math.max(14, Math.min(last, 365));
    const [word, test] = taskSplits[survivalSplit], a = rows.filter(test), b = rows.filter(r => !test(r)), kmA = a.length ? S.kaplanMeier(a) : null, kmB = b.length ? S.kaplanMeier(b) : null;
    // every split is tested, so the bar for calling one real is corrected for how many were tried (Bonferroni)
    const tests = Object.entries(taskSplits).map(([k, [w, f]]) => { const x = rows.filter(f), y = rows.filter(r => !f(r)); return { k, w, n: x.length, ...(x.length >= 5 && y.length >= 5 ? S.logRank(x, y) : { p: 1, chi2: 0 }) }; }), bar = 0.05 / tests.length, lr = tests.find(t => t.k === survivalSplit);
    const curve = (k, cls) => ({ pts: stair(k), cls, step: true, ticks: censorTicks(k, k.steps.length > 80 ? 4 : 1) });
    const series = [{ ...curve(km, "is-all"), band: km.steps.map(x => [x.t, x.lo, x.hi]) }, ...(kmA && kmB ? [curve(kmA, "is-a"), curve(kmB, "is-b")] : [])];
    const open = rows.filter(r => !r.event).sort((x, y) => y.t - x.t), ages = [1, 7, 14, 30, 60, 90, 180].filter(d => d < last);
    const tooFew = km.steps.filter(x => x.atRisk < 10)[0];
    const near = median == null ? [] : rows.filter(r => r.event && Math.abs(r.t - median) <= Math.max(1, median * 0.25)).sort((x, y) => x.t - y.t), within = d => rows.filter(r => r.event && r.t <= d).sort((x, y) => y.t - x.t);
    lensCards = { stillOpen: () => ({ title: "Still open, longest first", body: taskList(open) }), median: () => ({ title: `Finished around ${dayWords(median)}`, body: taskList(near) }), week: () => ({ title: "Finished within a week", body: taskList(within(7)) }), month: () => ({ title: "Finished within 30 days", body: taskList(within(30)) }) };
    ages.forEach(d => { lensCards[`age${d}`] = () => ({ title: `Open ${dayWords(d)} or longer`, body: taskList(open.filter(r => r.t >= d).reverse()) }); });
    return `${sciFacts([[dayWords(median), "median time open", "Half of all tasks are done by this day, counting the ones still open.", "median"], [pct(1 - S.survivalAt(km, 7)), "done within a week", "The share finished by day 7, allowing for tasks too new to have had 7 days.", "week"], [pct(1 - S.survivalAt(km, 30)), "done within 30 days", "The same, by day 30.", "month"], [`${S.restrictedMean(km, horizon).toFixed(0)}d`, `mean open, first ${horizon}d`, `The average days a task stays open, counted over its first ${horizon} days. The tasks still open are listed.`, "stillOpen"]])}
      ${sciChart({ label: "Share of tasks still open, by days since written", xmax: horizon, xticks: [0, 7, 30, 60, 90, 180, 365].filter(d => d <= horizon), xlabel: "days since the task was first written", series, marks: tooFew && tooFew.t < horizon ? [{ x: tooFew.t, label: "under 10 tasks left: noisy from here" }] : [] })}
      <p class="vg-sci-key"><i class="is-all"></i>all tasks, with its 95% band <i class="is-a"></i>${esc(word)} (${a.length}) <i class="is-b"></i>doesn't (${b.length}) <span>A tick is a task still open.</span></p>
      ${sciRead("These are Kaplan-Meier curves. Every line starts at 100%, all tasks open, and steps down each time one is finished. A flat stretch means little is finishing. The shaded band is where the true curve probably lies (95%), wider where few tasks are left. A tick is a task still open: it counts as open up to today, not as finished or forgotten.")}
      ${VGParts.section({ title: "Compare tasks by", body: `<div class="vg-filter-row vg-sci-split" role="group" aria-label="Compare tasks by">${tests.map(t => `<button class="vg-btn vg-btn-sm${t.k === survivalSplit ? " is-on" : ""}" data-survival-split="${t.k}" aria-pressed="${t.k === survivalSplit}">${esc(t.w)}${t.p < bar ? " •" : ""}</button>`).join("")}</div>
        <p class="vg-muted vg-lens-note">Comparing by "${esc(word)}": ${lr.p < bar ? "a real difference." : "no clear difference."} A difference doesn't show the cause.</p>
        ${VGParts.more({ label: "The statistics", body: `<p>Log-rank χ² ${lr.chi2.toFixed(1)}, p ${lr.p < 0.001 ? "under 0.001" : lr.p.toFixed(3)}, which is the chance of a gap this big if the two groups really behaved the same. ${lr.p < bar ? "A real difference, after correcting for the " + tests.length + " comparisons (marked •)." : "Not a clear difference once corrected for the " + tests.length + " comparisons."}</p>` })}` })}
      ${VGParts.section({ title: "Chance a task gets done in the next 30 days, by how long it's been open", body: VGParts.cards(ages.map(d => ({ value: pct(S.conditional(km, d, 30)), label: `open ${d}d`, open: `age${d}` })), { small: true }) + sciRead("Each tile takes the tasks still open at that age and gives the share finished within 30 more days. Falling numbers mean the longer a task sits, the less likely it is to get done.") })}
      ${VGParts.section({ title: "Open longest", count: open.length, body: VGParts.list(open.slice(0, 60).map(r => VGParts.row({ title: VGRules.plainTask(r.text), sub: `${r.t} days open · ${pct(S.conditional(km, r.t, 30))} chance of finishing in the next 30 · since ${r.born}`, open: r.path && opts.openNote ? r.path : null })), { first: 5, word: "tasks" }) })}
      ${VGParts.more({ label: "About this data", body: `<p>Kaplan-Meier on ${plural(km.n, "task")}: ${events} finished, ${km.n - events} still open. Left out, with no known end: ${skipped.undated || 0} done with no date, ${skipped.cancelled || 0} cancelled${skipped.undated ? ", and leaving out finished tasks makes tasks look slower than they are" : ""}. The same words in a later journal count as one task from its first day. The clock starts when it was written down, not when the work began.</p>` })}`;
  }

  // ---- Single points of failure: which notes hold the vault together, and how it breaks
  let spofCache = null, spofFor = null;
  function lensSpof() {
    const g = noteGraph(), S = VGScience; if (g.n < 3 || !g.edges.length) return emptyNext("This needs notes that link to each other.", "search");
    if (spofFor !== g) { const cuts = S.cutPoints(g), damage = S.cutDamage(g, cuts.cut.slice().sort((a, b) => g.adj[b].length - g.adj[a].length).slice(0, 120)); spofCache = { cuts, damage, rob: S.robustness(g), size: S.components(g) }; spofFor = g; }
    const { cuts, damage, rob, size } = spofCache, n = g.n, q = rob.attack.findIndex(v => v < 0.5 * rob.attack[0]), xs = a => a.map((v, i) => [i / n, v]);
    const everyN = Math.max(1, Math.floor(n / 200)), thin = a => a.filter((_, i) => i % everyN === 0 || i === a.length - 1);
    // each topic on its own: how few notes hold it up, and how evenly its links are shared
    const topics = DATA.clusters.map(c => { const ids = sciNotes().filter(x => x.cluster === c.id).map(x => x.id), set = new Set(ids), sub = S.graphOf(ids, links.filter(l => l.kind === "link" && set.has(l.s.id) && set.has(l.t.id)).map(l => [l.s.id, l.t.id])); if (ids.length < 5 || !sub.edges.length) return null; const eff = S.concentration(sub.adj.map(a => a.length)); return { c, n: ids.length, bus: S.busFactor(sub), eff: eff.effective, top: eff.top, hub: ids[sub.adj.map((a, i) => [a.length, i]).sort((x, y) => y[0] - x[0])[0][1]] }; }).filter(Boolean).sort((a, b) => a.bus / a.n - b.bus / b.n);
    const people = nodes.filter(x => x.person), who = S.concentration(people.map(p => p.mentions || 0)), lead = people.slice().sort((a, b) => (b.mentions || 0) - (a.mentions || 0))[0];
    const busiest = g.ids.map((id, i) => [id, g.adj[i].length]).sort((a, b) => b[1] - a[1]), linksOf = id => plural(g.adj[g.at.get(id)].length, "link");
    lensCards = { cut: notesDetail("Cut notes", () => cuts.cut.slice().sort((a, b) => g.adj[b].length - g.adj[a].length).map(i => g.ids[i]), linksOf),
      bridges: rowsDetail("Bridge links", () => cuts.bridges.map(([a, b]) => noteLine(g.ids[a], `the only link to ${esc(byId[g.ids[b]].name)}`)), "links"),
      halve: notesDetail("The busiest notes", () => busiest.slice(0, q > 0 ? q : n).map(x => x[0]), linksOf) };
    return `${sciFacts([[String(cuts.cut.length), "cut notes", "Lose one of these and the vault splits into separate parts.", "cut"], [String(cuts.bridges.length), "bridge links", "Links that are the only connection between two parts.", "bridges"], [`${q > 0 ? q : n}`, "busiest notes to halve it", "How many of the most-linked notes it takes to cut the largest connected part in half.", "halve"], [rob.Rattack.toFixed(3), "robustness R", `How well it holds as the busiest notes go, 0 to 0.5, higher is better. If notes go at random: ${rob.Rrandom.toFixed(3)}.`]])}
      ${sciChart({ label: "Largest connected part as notes are lost", xmax: 1, xticks: [0, 0.2, 0.4, 0.6, 0.8, 1], xfmt: v => pct(v), xlabel: "share of notes removed", series: [{ pts: thin(xs(rob.random)), cls: "is-b" }, { pts: thin(xs(rob.attack)), cls: "is-a" }], marks: rob.holds ? [{ x: rob.fc, label: "random-loss limit", cls: "is-warn" }] : [] })}
      <p class="vg-sci-key"><i class="is-a"></i>busiest notes lost first <i class="is-b"></i>notes lost at random</p>
      ${sciRead("Both lines start with the vault whole and show the largest connected part as notes are removed. The further the solid line falls below the dashed one, the more the vault depends on its busiest notes.")}
      ${lensAbout(`The gap between the lines is how much the vault depends on its hubs. Molloy-Reed: κ = ⟨k²⟩/⟨k⟩ = ${rob.kappa.toFixed(1)}${rob.holds ? `, so in theory a network like this holds together until about ${pct(rob.fc)} of notes are lost at random` : ", under the 2 a network needs to hold together"}. Its largest part already has ${pct((size[0] || 0) / n)} of the notes, in ${plural(size.length, "connected part")}. Losing a note here means it's wrong, gone or out of date.`)}
      ${coreHtml()}
      ${(() => { const hit = damage.filter(d => d.stranded > 0); return lensSec("Cut notes, by what they'd strand", hit.map(d => noteLine(g.ids[d.i], `the only route to ${plural(d.stranded, "note")} · splits into ${d.parts} parts`)), { count: hit.length, word: "notes", empty: "No single note holds the main part together." }); })()}
      ${lensSec("Topics that rest on the fewest notes", topics.map(t => noteLine(t.hub, `${clusterName(t.c.id)}: falls apart without ${plural(t.bus, "note")} of ${t.n} · this one holds ${pct(t.top)} of its links · shared like ${t.eff.toFixed(1)} equal notes`)), { word: "topics", about: "\"Falls apart\" means no piece keeps half the topic. \"Shared like 3 equal notes\" means its links are as concentrated as if only 3 notes held them all evenly." })}
      ${lead && who.top ? VGParts.section({ title: "People", hint: `${esc(lead.name)} has ${pct(who.top)} of the mentions in your dailies.`, body: lensAbout(`Across ${people.length} people that's like ${who.effective.toFixed(1)} people sharing them equally (Herfindahl). A count of mentions, not of who knows what.`) }) : ""}`;
  }
  // the k-core: what's left when you keep removing the least connected notes. Written links where the direction is known, each counted once.
  function coreHtml() {
    const d = directedNotes(), g = d || noteGraph(), und = g.ids.map(() => new Set()); g.edges.forEach(([a, b]) => { und[a].add(b); und[b].add(a); });
    const core = VGScience.kCore(und.map(s => [...s])), top = Math.max(0, ...core); if (top < 2) return "";
    const inner = g.ids.filter((_, i) => core[i] === top), bare = core.filter(c => c === 0).length;
    return lensSec("The core", inner.map(id => noteLine(id, `core ${top}`)), { word: "notes", about: `A k-core is what's left after repeatedly taking away notes with fewer than k links. The innermost here has ${top} links each within the group: these notes hold each other up, so they're where your written knowledge is densest. ${bare ? `${plural(bare, "note")} have no written link, so they aren't part of it at all.` : ""} A core shows where links are thick, not that those notes matter most.` });
  }
  // ---- As a neural net: your links as the wiring of a recurrent network, tested the way real connectomes are. The answer is worked
  // out from the runs, so it can come out either way, and changes with the vault.
  const { NET_RHOS, NET_SEEDS } = VGScience;
  const netMean = a => a.reduce((x, y) => x + y, 0) / a.length, netSd = a => { const m = netMean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  // Welch's t, with the seeds as the sample: a difference this size is unlikely to be the luck of the random strengths at about 3 and up
  const netDiffers = (a, b) => { const v = (netSd(a) ** 2 + netSd(b) ** 2) / a.length; return v ? Math.abs(netMean(a) - netMean(b)) / Math.sqrt(v) : 0; };
  async function loadNetLens() { const g = noteGraph(); if (g.n < 20 || g.edges.length < 20) return emptyNext("This needs at least 20 linked notes to test as a network.", "search"); return renderNet(await VGScience.netStudy(g)); }
  function renderNet({ runs, sw, sizes, n, m }) {
    const best = (name, key, pick) => runs[name].reduce((b, r) => (pick(netMean(r[key]), netMean(b[key])) ? r : b)), hi = (a, b) => a > b, lo = (a, b) => a < b, yMc = best("yours", "mc", hi), rMc = best("random", "mc", hi), yNa = best("yours", "na", lo), rNa = best("random", "na", lo);
    const line = (name, key) => runs[name].map(r => [r.rho, netMean(r[key])]), top = Math.ceil(Math.max(...Object.values(runs).flat().map(r => netMean(r.mc))) / 2) * 2 || 2;
    const peakT = netDiffers(yMc.mc, rMc.mc), peakWord = peakT < 3 ? "about the same as" : netMean(yMc.mc) > netMean(rMc.mc) ? "more than" : "less than";
    const edge = runs.yours[runs.yours.length - 1], edgeR = runs.random[runs.random.length - 1], edgeT = netDiffers(edge.na, edgeR.na), edgeWord = edgeT < 3 ? "shows no clear difference from" : netMean(edge.na) < netMean(edgeR.na) ? "holds up better than" : "breaks down sooner than";
    const degT = netDiffers(yMc.mc, best("rewired", "mc", hi).mc), place = degT >= 3 ? "Which notes link to which matters: rewiring the links while every note keeps its count changes the result." : "Rewiring the links while every note keeps its count gives about the same result, so here it's how many links each note has that counts, not which notes they join.";
    const chart = (key, name, label, o) => sciChart({ label, xmin: 0.45, xmax: 1.35, xticks: NET_RHOS, xfmt: v => v.toFixed(2), xlabel: "spectral radius ρ: below 1 the network settles, above 1 it tips towards chaos", series: [{ pts: line("yours", key), cls: "is-a" }, { pts: line("rewired", key), cls: "is-all" }, { pts: line("random", key), cls: "is-b" }], ...o });
    return `${sciFacts([[sw.sigma.toFixed(1), "small-world σ", "Over 1 means tight groups with short routes between them, like many real networks."], [`${sw.gamma.toFixed(1)}×`, "clustering vs rewired", `How much more often a note's neighbours link to each other than in a shuffled vault: ${sw.C.toFixed(2)} against ${sw.Cr.toFixed(3)}.`], [`${sw.lambda.toFixed(1)}×`, "path length vs rewired", `How much longer the route between notes is than in a shuffled vault: ${sw.L.toFixed(1)} hops against ${sw.Lr.toFixed(1)}.`], [netMean(yMc.mc).toFixed(1), "steps of memory", `How many past inputs the network can still recall, at its best (ρ = ${yMc.rho}).`], [netMean(yNa.na).toFixed(2), "NARMA-10 error", `A standard test needing memory and non-linearity. 0 is perfect, 1 is no better than guessing the average. Best at ρ = ${yNa.rho}.`]])}
      <p class="vg-sci-verdict"><b>As wiring, your notes hold ${peakWord} a random network of the same size.</b></p>
      ${lensAbout(`${netMean(yMc.mc).toFixed(1)} steps of memory against ${netMean(rMc.mc).toFixed(1)}. Pushed past the edge of chaos, yours ${edgeWord} it (NARMA-10 error ${netMean(edge.na).toFixed(2)} against ${netMean(edgeR.na).toFixed(2)}). ${esc(place)}`, "What the runs found")}
      ${VGParts.section({ title: "Memory: how many past inputs a trained readout can recall", body: `${chart("mc", "mc", "Memory capacity against spectral radius", { ymax: top, yticks: [0, top / 2, top], yfmt: v => v.toFixed(0) })}${sciRead("Higher is better. ρ, along the bottom, sets how strongly signals echo: too low and they fade fast, past about 1 they start to run away. Most networks recall the most just below 1.")}` })}
      ${VGParts.section({ title: "NARMA-10: a task needing memory and non-linearity. Lower is better.", body: `${chart("na", "na", "NARMA-10 error against spectral radius", { ymax: 1, yticks: [0, 0.5, 1], yfmt: v => v.toFixed(1) })}${sciRead("Each line is the same network test on different wiring. If yours sits with the others, your link pattern gives no edge at that setting. Rewired keeps how many links each note has and changes which notes they join, so a gap between those two lines is what your particular links add.")}` })}
      <p class="vg-sci-key"><i class="is-a"></i>your links <i class="is-all"></i>rewired, same link counts <i class="is-b"></i>random, same number of links</p>
      ${lensAbout(`Reservoir computing: ${n} notes as neurons, ${m} links as synapses, with random strengths since links carry none, and symmetric since they carry no direction. Only the readout is trained, and it's scored on data it didn't see. Mean of ${NET_SEEDS} seeds, called different at Welch's t ≥ 3. ${plural(sizes.length, "connected part")}, the largest ${sizes[0]} notes, and notes in small parts add little. These are tests of the wiring: what your notes say plays no part, and this isn't a network that has learned anything about your vault.`)}`;
  }
  // ---- Flow: the task history as a queue. Little's law ties together what's open, how fast it arrives and how long it stays.
  let flowDays = 90;
  async function loadFlow() { if (!survivalLives) { const journals = opts.taskHistory ? await opts.taskHistory() : ((DATA.hq || {}).journals || []); survivalLives = VGScience.taskLives(journals, DATA.date || today()); } return renderFlow(); }
  function renderFlow() {
    const rows = (survivalLives || { rows: [] }).rows.map(r => ({ born: r.born, done: r.event ? r.done : null })); if (rows.length < 5) return emptyNext("Flow needs journals with at least a few tasks.", "daily", "search");
    const F = VGScience.flow(rows, DATA.date || today(), flowDays), top = Math.max(1, F.cumIn[F.days], F.cumOut[F.days]), span = Math.ceil(top / 10) * 10 || 10, line = a => a.map((v, i) => [i, v]);
    const growing = F.net > 0, weeks = F.throughput > 0 ? F.openNow / F.throughput / 7 : null, lives = (survivalLives || { rows: [] }).rows, end = VGShared.utcNoon(DATA.date || today()), inWindow = d => d && end - VGShared.utcNoon(d) <= F.days * VGShared.DAY_MS;
    lensCards = { open: () => ({ title: "Open now", body: taskList(lives.filter(r => !r.event).sort((a, b) => b.t - a.t)) }), came: () => ({ title: `Written down in the last ${F.days} days`, body: taskList(lives.filter(r => inWindow(r.born)).sort((a, b) => b.born.localeCompare(a.born))) }), done: () => ({ title: `Finished in the last ${F.days} days`, body: taskList(lives.filter(r => r.event && inWindow(r.done)).sort((a, b) => b.done.localeCompare(a.done))) }) };
    return `${sciFacts([[String(F.openNow), "open now", "Tasks written down and not finished.", "open"], [`${(F.arrivals * 7).toFixed(1)}`, "new a week", `Tasks written down per week, over the last ${F.days} days.`, "came"], [`${(F.throughput * 7).toFixed(1)}`, "finished a week", "Tasks finished per week over the same days.", "done"], [weeks == null ? "never" : `${weeks.toFixed(0)} weeks`, "to clear what's open", "What's open today divided by how fast you finish, if nothing new came in. The open tasks are listed.", "open"]])}
      <p class="vg-sci-verdict"><b>${growing ? `The pile grew by ${F.net}` : F.net < 0 ? `The pile shrank by ${-F.net}` : "The pile held level"}</b> over the last ${F.days} days: ${F.cumIn[F.days]} tasks came in and ${F.cumOut[F.days]} finished.</p>
      ${sciChart({ label: "Tasks in and out over time", xmax: F.days, xticks: [0, Math.round(F.days / 3), Math.round(2 * F.days / 3), F.days], xfmt: v => (v === F.days ? "today" : `${F.days - v}d ago`), xlabel: "", ymax: span, yticks: [0, span / 2, span], yfmt: v => v.toFixed(0), series: [{ pts: line(F.cumIn), cls: "is-a" }, { pts: line(F.cumOut), cls: "is-b" }] })}
      <p class="vg-sci-key"><i class="is-a"></i>tasks written down, added up <i class="is-b"></i>tasks finished, added up</p>
      ${sciRead("A cumulative flow chart. The height of each line is a running total, and a steeper line means a faster rate. The gap between them is the new work still open from this period: a widening gap means work is arriving faster than it finishes.")}
      ${lensAbout(`On average ${F.L.toFixed(0)} tasks were open, each for about ${F.W.toFixed(0)} of these days. ${growing ? "While more arrives than leaves, tasks wait longer and longer. " : ""}Little's law: average open = arrival rate × average time open. ${F.L.toFixed(1)} = ${F.lambda.toFixed(2)} a day × ${F.W.toFixed(1)} days. It holds for any queue, so to shorten how long tasks wait you have to take on fewer or finish more. Tasks done with no date and cancelled tasks aren't counted, so the real finish rate is higher than this. A task counts once however many journals repeat it, and subtasks aren't counted, so Sweep in Vault HQ lists more.`)}
      ${agingHtml()}
      ${flowByArea()}`;
  }
  // ---- Two-way links: what blurs the Food web most. The softer side of each pair is the one to drop; if they're alike, the specific
  // note keeps its link up to the note more others link to. Obsidian's backlinks still show a dropped link's return.
  const twDropped = new Set(), upDone = new Set(); let twRows = [], upRows = [];
  async function loadTwoWay() {
    const g = directedNotes(), S = VGScience; if (!g) return emptyNext("Hierarchy needs Obsidian's link directions, which this page doesn't have.", "search");
    // notes with no written link at all: a dated record and the inbox don't need one
    const written = linkOut() || {}, names = new Set(nodes.filter(n => !n.ghost).map(n => n.name)), noUp = sciNotes().filter(n => !VGRules.isRecord(n) && !n.id.startsWith(`${FOLDERS.inbox}/`) && !Object.keys(written[n.id] || {}).length && !upDone.has(n.id)), hasNote = nm => names.has(nm) || (opts.noteExists ? opts.noteExists(nm) : false);
    upRows = noUp.map(n => ({ n, up: VGRules.wayUp(n, hasNote) })).filter(r => r.up);
    const upHtml = !noUp.length ? "" : lensSec("No way up", upRows.slice(0, 40).map((r, i) => noteLine(r.n.id, `up to ${r.up.hub} · ${r.up.why}`, opts.setParents ? `<button class="vg-btn vg-btn-sm" data-upone="${i}">Add</button>` : "")), { count: noUp.length, word: "notes", empty: "No suggestion from their tag or folder.", about: `These notes link to nothing, so only generated Related lines connect them. A parent line gives each one a place. ${upRows.length} have a suggestion from their tag or folder.`, lead: upRows.length && opts.setParents ? `<div class="vg-row"><button class="vg-btn vg-btn-sm" data-upall>Add ${plural(upRows.length, "parent")}</button></div>` : "" });
    const pairs = S.twoWayPairs(g).filter(([a, b]) => !twDropped.has(`${g.ids[a]}|${g.ids[b]}`) && !twDropped.has(`${g.ids[b]}|${g.ids[a]}`)); if (!pairs.length) return upHtml || emptyNext("No two notes link to each other, and every note has a way up.", "search");
    const how = opts.linkHow ? await opts.linkHow(pairs.flatMap(([a, b]) => [[g.ids[a], g.ids[b]], [g.ids[b], g.ids[a]]])) : [], at = new Map(how.map(h => [`${h.from}|${h.to}`, h])), inDeg = new Int32Array(g.n), rank = k => VGRules.LINK_KINDS.indexOf(k); g.edges.forEach(([, b]) => inDeg[b]++);
    const of = (a, b) => at.get(`${g.ids[a]}|${g.ids[b]}`) || { kind: "sentence" };
    const side = i => Object.keys(written[g.ids[i]] || {}).length;
    twRows = pairs.flatMap(([a, b]) => { const ha = of(a, b), hb = of(b, a), pick = VGRules.twoWayDrop({ kind: ha.kind, inDeg: inDeg[a], links: side(a) }, { kind: hb.kind, inDeg: inDeg[b], links: side(b) }); if (!pick) return []; const dropA = pick === "a", from = dropA ? a : b, to = dropA ? b : a, h = dropA ? ha : hb, keep = dropA ? hb : ha; return [{ from, to, id: g.ids[from], toId: g.ids[to], kind: h.kind, keepKind: keep.kind, line: h.line, text: h.text }]; }).sort((x, y) => (y.line != null) - (x.line != null) || rank(y.kind) - rank(x.kind));
    const can = twRows.filter(r => r.line != null), now = S.trophic(g.adj).incoherence, all = S.incoherenceWithout(g, twRows.map(r => [r.from, r.to])), some = S.incoherenceWithout(g, can.map(r => [r.from, r.to]));
    const word = { sentence: "in a sentence", table: "in a table row", "links line": "in a line of links", list: "a list line", frontmatter: "in frontmatter", "see also": "in See Also" };
    lensCards = { pairs: rowsDetail("Two-way pairs", () => pairs.map(([a, b]) => noteLine(g.ids[a], `and ${esc(byId[g.ids[b]].name)}`)), "pairs") };
    return `${sciFacts([[String(pairs.length), "two-way pairs", `Pairs of notes that each link to the other, ${pct(pairs.length * 2 / g.edges.length)} of your written links.`, "pairs"], [now.toFixed(2), "incoherence now", "How consistently links run one way. 0 is a strict hierarchy, 1 is no direction."], [all.toFixed(2), "with one side of each gone", "The same measure if every pair below lost its suggested side."], [some.toFixed(2), `with the ${can.length} list lines gone`, "The same, dropping only the links that are one list line."]])}
      <div class="vg-row"><button class="vg-btn vg-btn-sm" data-toview="foodweb">See it as the Food web</button></div>
      ${upHtml}
      ${sciRead("A hierarchy reads one way: a note leans on what it links to. Two notes linking to each other say both lean on both, which is what blurs the Food web most. One side is usually enough, since Obsidian's backlinks still show the other. A vault doesn't need 0: drop what adds nothing and keep what you use.")}
      ${lensSec("Suggested side to drop", twRows.slice(0, 60).map((r, i) => noteLine(r.id, `links to ${esc(byId[r.toId].name)} ${word[r.kind]} · the other way is ${word[r.keepKind]}`, `${r.line != null && opts.dropLinkLines ? `<button class="vg-btn vg-btn-sm" data-twdrop="${i}">Drop</button>` : ""}${opts.openNote ? `<button class="vg-btn vg-btn-sm" data-twopen="${esc(r.id)}">Open</button>` : ""}`)), { count: twRows.length, word: "links", lead: can.length && opts.dropLinkLines ? `<div class="vg-row"><button class="vg-btn vg-btn-sm" data-twall>Drop all ${plural(can.length, "list line")}</button></div>` : "" })}`;
  }
  function upAdd(rows, e) {
    const done = VGActions.run({ label: () => "Add parent", title: () => rows.length === 1 ? rows[0].n.name : plural(rows.length, "note"), run: async () => { const n = await opts.setParents(rows.map(r => ({ path: r.n.id, hub: r.up.hub }))); rows.forEach(r => upDone.add(r.n.id)); return `Added ${plural(n, "parent")}`; }, undo: async () => { rows.forEach(r => upDone.delete(r.n.id)); } }, null, actionCtx(), e);
    return Promise.resolve(done).then(ok => { if (ok) refreshLens(); return ok; });
  }
  function twDrop(rows, e) {
    const done = VGActions.run({ label: () => "Drop", title: () => rows.length === 1 ? `${byId[rows[0].id].name} → ${byId[rows[0].toId].name}` : plural(rows.length, "list line"), run: async () => { const n = await opts.dropLinkLines(rows.map(r => ({ path: r.id, line: r.line, text: r.text }))); rows.forEach(r => twDropped.add(`${r.id}|${r.toId}`)); return `Dropped ${plural(n, "link")}`; }, undo: async () => { rows.forEach(r => twDropped.delete(`${r.id}|${r.toId}`)); } }, null, actionCtx(), e);
    return Promise.resolve(done).then(ok => { if (ok) refreshLens(); return ok; });
  }
  // Aging work in progress: which open tasks are already older than most tasks ever take
  function agingHtml() {
    const rows = (survivalLives || { rows: [] }).rows, L = VGScience.serviceLevel(rows, 0.85); if (rows.length < 20 || L.days == null) return "";
    return lensSec("Already unusually old", L.late.slice(0, 40).map(taskRow), { count: L.late.length, word: "tasks", empty: "No open task is past that.", hint: `85% of your tasks finish within ${dayWords(L.days)}.`, about: `${L.late.length ? `These ${plural(L.late.length, "open task")} are past that, so they've outlasted most of what you do: finish them, cancel them or give them a date. ` : ""}Aging work in progress (Vacanti 2015), on the Kaplan-Meier curve so tasks still open count. It says what's unusual for you, not what's unimportant.` });
  }
  // Where the pile is: each area's share of what's open against its share of what got finished. Areas come from the rules file (thread_areas).
  function flowByArea() {
    const B = VGScience.areaBalance((survivalLives || { rows: [] }).rows, DATA.date || today(), flowDays, t => VGRules.areaOfText(VGRules.plainTask(t))), rows = B.rows, O = B.open, D = B.done; if (rows.length < 2 || !O || !D) return "";
    const top = rows[0];
    return lensSec("Where the pile is", rows.map(r => `<div class="vg-sugg"><span class="vg-item-main"><span>${esc(r.area)}</span><span class="vg-item-sub">${r.open} open · ${r.done} finished${r.lq != null ? ` · ${r.lq.toFixed(2)}` : " · none finished"}</span></span></div>`), { word: "areas", about: `A location quotient, from regional economics: an area's share of open tasks against its share of what got finished in ${flowDays} days. 1 means in step. Above 1, it's piling up faster than you finish it${top.done ? `: ${top.area} holds ${pct(top.open / O)} of what's open and ${pct(top.done / D)} of what got finished` : `: ${top.area} has open tasks and nothing finished`}. Small counts move this a lot, so read the counts with it.` });
  }
  // ---- Debt: what a stale note costs goes up with what rests on it and with how long it's been left. For Stale notes.
  function debtOf() {
    const g = spreadGraph(), notes = g.ids.map(id => byId[id]), rows = VGScience.debtRanks(g, notes.map(n => ({ age: n.age, stale: staleFor(n, Q.stale_days) }))).map(r => ({ ...r, n: notes[r.i] })), known = !!g.directed;
    if (!rows.length) return { rows, known, facts: "", read: "", about: "" };
    const total = rows.reduce((s, r) => s + r.cost, 0), c = VGScience.concentration(rows.map(r => r.cost)), five = rows.slice(0, 5).reduce((s, r) => s + r.cost, 0) / total;
    const costLine = r => noteLine(r.n.id, `${Math.round(r.cost)} note-years · ${(r.age / 365).toFixed(1)} years since an edit`);
    lensCards = { debt: rowsDetail("Notes in debt", () => rows.map(costLine), "notes"), top5: rowsDetail("The five worst", () => rows.slice(0, 5).map(costLine), "notes") };
    return { rows, known, facts: `${sciFacts([[String(rows.length), "notes in debt", `Stale notes (${Q.stale_days}+ days without an edit) that other notes rest on.`, "debt"], [Math.round(total).toLocaleString(), "note-years owed", "For each one, how much rests on it times the years it's been left, added up. The notes are listed, worst first.", "debt"], [pct(five), "held by the top 5", "How much of the debt the five worst notes hold. High means a few reviews would clear most of it.", "top5"], [c.effective.toFixed(0), "effective notes", "As concentrated as if this many notes held the debt equally. The notes are listed, worst first.", "debt"]])}`, read: "Debt here is a way of ranking, not a measure of money or of error: a note isn't wrong for being old. It says which old notes would cost most if they had gone out of date. Reviewing one clears all of its debt, so start at the top.", about: `Cost = how much rests on it × years since it was edited. A note linking to it directly counts 1, two links away a half, three a quarter, since through enough links nearly everything reaches everything. ${known ? "Resting on means linking to it. Links in Related sections and similar-meaning lines don't count: only links written into a note do." : "This page has no link direction, so links count both ways."}` };
  }
  // ---- Control chart: Shewhart's question. What's the normal range of your work, and has anything moved outside it?
  let controlKind = "finished";
  async function loadControl() { if (!survivalLives) { const journals = opts.taskHistory ? await opts.taskHistory() : ((DATA.hq || {}).journals || []); survivalLives = VGScience.taskLives(journals, DATA.date || today()); } return renderControl(); }
  function renderControl() {
    const rows = (survivalLives || { rows: [] }).rows, end = VGShared.utcNoon(DATA.date || today()), WEEKS = 16, bucket = d => { const w = Math.floor((end - VGShared.utcNoon(d)) / (7 * VGShared.DAY_MS)); return w >= 0 && w < WEEKS ? WEEKS - 1 - w : -1; }, v = new Array(WEEKS).fill(0);
    rows.forEach(r => { const d = controlKind === "finished" ? (r.event ? r.done : null) : r.born; if (!d) return; const b = bucket(d); if (b >= 0) v[b]++; });
    const first = v.findIndex(x => x > 0), vals = first < 0 ? [] : v.slice(first); if (vals.length < 6) return emptyNext("A control chart needs at least six weeks of tasks with dates.", "daily", "search");
    const X = VGScience.xmr(vals), n = vals.length, last = vals[n - 1], ymax = Math.ceil(Math.max(X.ucl, ...vals) / 10) * 10 || 10, line = y => vals.map((_, i) => [i, y]), label = i => (i === n - 1 ? "this week" : `${n - 1 - i}w ago`);
    const word = controlKind === "finished" ? "finished" : "came in", out = X.signals.filter(s => s.rule === "above" || s.rule === "below"), runs = X.signals.filter(s => s.rule.startsWith("run")), sig = X.signals.find(s => s.i === n - 1);
    const verdict = X.signals.length ? `${plural(X.signals.length, "real signal")}: ${[...out.map(s => `${label(s.i)} was ${s.rule} the limits`), ...runs.map(s => `eight weeks in a row ${s.rule === "run-high" ? "above" : "below"} average, ending ${label(s.i)}`)].join("; ")}.` : `Every week is inside the limits, so none of this says your work changed: the ups and downs are its normal variation.`;
    const signalWeeks = new Set(X.signals.map(s => first + s.i)), inKind = r => (controlKind === "finished" ? (r.event ? r.done : null) : r.born);
    lensCards = { signal: () => ({ title: "Tasks in the weeks the chart flags", body: taskList(rows.filter(r => { const d = inKind(r); return d && signalWeeks.has(bucket(d)); })) }), week: () => ({ title: controlKind === "finished" ? "Finished this week" : "Came in this week", body: taskList(rows.filter(r => { const d = controlKind === "finished" ? (r.event ? r.done : null) : r.born; return d && bucket(d) === WEEKS - 1; })) }) };
    return `${sciFacts([[X.mean.toFixed(1), `${word} a week`, `The average over these ${n} weeks.`], [`${X.lcl.toFixed(0)} to ${X.ucl.toFixed(0)}`, "normal range", "What this process produces with nothing changed. A week outside it, or eight in a row on one side of the average, means something did."], [String(last), "this week", sig ? "Outside the normal range: worth asking what changed." : "Inside the normal range.", "week"], [String(X.signals.length), "signals", "Weeks the chart says are more than noise. The tasks in those weeks are listed.", "signal"]])}
      <div class="vg-filter-row vg-sci-split" role="group" aria-label="What to chart">${[["finished", "Tasks finished"], ["came", "Tasks that came in"]].map(([k, w]) => `<button class="vg-btn vg-btn-sm${k === controlKind ? " is-on" : ""}" data-control="${k}" aria-pressed="${k === controlKind}">${w}</button>`).join("")}</div>
      <p class="vg-sci-verdict"><b>${esc(verdict)}</b></p>
      ${sciChart({ label: `Tasks ${word} per week, with the normal range`, xmax: n - 1, xticks: vals.map((_, i) => i).filter(i => i % 3 === (n - 1) % 3), xfmt: i => (i === n - 1 ? "this week" : `${n - 1 - i}w`), xlabel: "", ymax, yticks: [0, ymax / 2, ymax], yfmt: y => y.toFixed(0), series: [{ pts: line(X.ucl), cls: "is-b" }, { pts: line(X.mean), cls: "is-all" }, ...(X.lcl > 0 ? [{ pts: line(X.lcl), cls: "is-b" }] : []), { pts: vals.map((y, i) => [i, y]), cls: "is-a" }] })}
      <p class="vg-sci-key"><i class="is-a"></i>each week <i class="is-all"></i>average <i class="is-b"></i>normal range</p>
      ${sciRead("Shewhart's chart, from factories. Every process wobbles, and reacting to each wobble makes things worse, so the limits are worked out from how much your weeks normally move from one to the next. Inside them, a good or bad week has no special cause to find. Use it after you change how you work: real improvement shows as a week above the limit or eight in a row above the average.")}
      ${lensAbout(`Individuals chart (XmR): limits at the average ± 2.66 × the average move between weeks, ${X.mr.toFixed(1)} here. A count of tasks, each counted the same, whatever its size. Only tasks with a completion date count as finished. Weeks run back from today, so this week is a full 7 days. Limits this wide also mean small real changes won't show yet.`)}`;
  }
  // ---- Attention: Hill numbers on where your dailies went, week by week
  function lensAttention() {
    const T = DATA.timeline; if (!T || T.weeks.length < 4) return needsAnalysis("Attention") || emptyNext("Attention needs four weeks of daily notes that link or name your notes.", "daily", "lens:river");
    const cs = Object.entries(T.clusters).filter(([c]) => clusterById[c]), todayD = VGShared.utcNoon(DATA.date || today()), full = T.weeks.map((w, i) => i).filter(i => todayD - VGShared.utcNoon(T.weeks[i]) >= 6 * VGShared.DAY_MS), idx = full.slice(-26);
    const H = idx.map(i => ({ i, ...VGScience.hill(cs.map(([, v]) => v[i] || 0)), total: cs.reduce((s, [, v]) => s + (v[i] || 0), 0) })).filter(w => w.total >= 3); if (H.length < 4) return emptyNext("Attention needs four weeks of daily notes that link or name your notes.", "daily", "lens:river");
    const now = H[H.length - 1], recent = H.slice(-4), past = H.slice(0, -4), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / (a.length || 1), top = cs.map(([c, v]) => [c, recent.reduce((s, w) => s + (v[w.i] || 0), 0)]).sort((a, b) => b[1] - a[1]), rT = top.reduce((s, x) => s + x[1], 0), ymax = Math.ceil(Math.max(...H.map(w => w.q1))) + 1;
    const shift = past.length ? avg(recent, "q1") - avg(past, "q1") : 0;
    lensCards = { topics: rowsDetail("Topics last week", () => cs.map(([c, v]) => [+c, v[now.i] || 0]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(([c, k]) => topicLine(c, plural(k, "daily note"))), "topics"), top: rowsDetail("The last 4 weeks, by topic", () => top.filter(x => x[1]).map(([c, k]) => topicLine(+c, plural(k, "daily note"))), "topics") };
    return `${sciFacts([[now.q1.toFixed(1), "topics last week", `As many as if your attention were split evenly between this many topics. ${now.q0} topics came up at all.`, "topics"], [avg(recent, "q1").toFixed(1), "over 4 weeks", past.length ? `The ${past.length} weeks before that averaged ${avg(past, "q1").toFixed(1)}.` : "Not enough earlier weeks to compare."], [now.q2.toFixed(1), "main topics", "The same measure counting only the big ones (inverse Simpson). Far below the number above means one or two topics took most of it.", "top"], [top[0] && rT ? pct(top[0][1] / rT) : "0%", top[0] ? clusterName(+top[0][0]) : "top topic", "Its share of the last 4 weeks.", "top"]])}
      <p class="vg-sci-verdict"><b>${Math.abs(shift) < 0.5 ? "Your attention is about as spread as it has been." : shift > 0 ? `You've been more spread lately: about ${shift.toFixed(1)} more topics a week.` : `You've been more focused lately: about ${(-shift).toFixed(1)} fewer topics a week.`}</b></p>
      ${sciChart({ label: "Effective number of topics per week", xmax: H.length - 1, xticks: H.map((_, i) => i).filter(i => i % 4 === (H.length - 1) % 4), xfmt: i => `${H.length - 1 - i}w`, xlabel: "weeks ago", ymax, yticks: [0, ymax / 2, ymax], yfmt: y => y.toFixed(0), series: [{ pts: H.map((w, i) => [i, w.q2]), cls: "is-b" }, { pts: H.map((w, i) => [i, w.q1]), cls: "is-a" }] })}
      <p class="vg-sci-key"><i class="is-a"></i>effective topics <i class="is-b"></i>main topics</p>
      ${sciRead("Ecologists measure diversity this way: not how many species a forest has, but how evenly they're shared. Five topics at 20% each count as 5. Five where one takes 96% count as barely over 1. Neither is better: a focused week and a spread week suit different work, so this tells you which you've had.")}
      ${lensAbout("Hill numbers (Hill 1973), order 1 and 2, on how often your dailies link or name each topic. It reads what you wrote down, not the hours you spent, and a topic is one the analysis found, so a new topic counts from when it was named.")}`;
  }
  // ---- Version drift: what your notes say against what you run (the rules file's drift list)
  async function loadDrift() {
    if (!opts.driftScan) return emptyNext("Version drift reads your notes, which this page can't.", "search"); const rows = await opts.driftScan();
    if (!rows.length) return `<div class="vg-empty">Every version your notes name matches what you run.</div>`;
    const by = new Map(); rows.forEach(r => { if (!by.has(r.name)) by.set(r.name, []); by.get(r.name).push(r); });
    return `${sciRead("Notes that name a version other than the one you run. Some are right: history, or an upgrade's starting point. The rest quietly send someone to the wrong instructions. Dated records aren't checked, since they're meant to stay as written.")}
      ${[...by].map(([name, list]) => lensSec(`${name}: you run ${list[0].current}`, list.slice(0, 40).map(r => `<div class="vg-sugg">${hostRow(r.path, `says ${esc(r.found)}: ${esc(r.text.slice(0, 110))}`)}<span class="vg-sugg-acts">${hostOpen(r.path)}</span></div>`), { count: list.length, word: "notes" })).join("")}`;
  }
  // a row for a note the host named: the graph's own row when the graph holds it, its name when it doesn't. sub is HTML.
  const hostRow = (path, sub) => (byId[path] ? noteRow(path, sub) : `<span class="vg-item-main"><span>${esc(VGActions.nameOf(path))}</span><span class="vg-item-sub">${sub}</span></span>`);
  const hostOpen = path => (opts.openNote ? `<button class="vg-btn vg-btn-sm" data-twopen="${esc(path)}">Open</button>` : "");
  // ---- Guide scan (CRISPR): one piece of text, everywhere it occurs, and its repair. The host reads the notes
  // (opts.guideScan, opts.guidePreview) and writes the ticked cuts (opts.guideApply); VGScience does the matching and the
  // cutting. The guide, its last result and a preview are kept while the page is open, so going into a note and back shows
  // the same list. Presets are the rules file's guides; past repairs are the shared file's guideLog.
  const guideNow = { seq: "", after: "", to: "", folder: "", tag: "", mismatches: 0, word: true, where: [...VGScience.GUIDE_DEFAULT], result: null, busy: false, error: "", preview: null, ticked: new Set(), applied: null, log: null };
  const GUIDE_PLACES = { frontmatter: "Properties", task: "Tasks", body: "Text", code: "Code" };
  const guidePresets = () => (VGRules.RULES.guides || []).filter(p => p && p.seq);
  const guideScopeOf = G => ({ folder: G.folder.trim().replace(/^\/+|\/+$/g, ""), tag: G.tag.trim().replace(/^#/, "") });
  const guideScoped = s => (opts.guideScoped ? opts.guideScoped(s) : !!(s.folder || s.tag));
  const guideScopeText = s => (s.folder ? `in ${s.folder}` : s.tag ? `tagged #${s.tag}` : "in every note");
  const guideRepairText = to => (to ? `replace with “${esc(to)}”` : "take it out");
  let guideFolderList = null;
  const guideFolders = () => guideFolderList || (guideFolderList = [...new Set(DATA.nodes.filter(n => !n.ghost && n.id.includes("/")).flatMap(n => { const p = n.id.split("/").slice(0, -1); return p.map((_, i) => p.slice(0, i + 1).join("/")); }))].sort().slice(0, 400));
  // a changed line, cut around where it first differs, so a long line shows the change
  function guideDiff(c) {
    const a = c.before, b = c.after == null ? "" : c.after; let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    const from = Math.max(0, p - 40), cut = s => (from ? "…" : "") + s.slice(from, from + 150) + (s.length > from + 150 ? "…" : "");
    return `<div class="vg-guide-cut"><span class="vg-muted">${c.where === "body" ? "" : GUIDE_PLACES[c.where] + " · "}line ${c.line}</span><del>${esc(cut(a))}</del>${c.after == null ? `<span class="vg-muted">line removed</span>` : `<ins>${esc(cut(b))}</ins>`}</div>`;
  }
  function guidePreviewHtml() {
    const G = guideNow, P = G.preview; if (!P) return "";
    const head = `“${esc(P.guide.seq)}”, ${guideRepairText(P.repair.to)}, ${esc(guideScopeText(P.scope))}`;
    if (!P.notes.length) return `<div class="vg-empty">Nothing to cut: ${head}. ${plural(P.scanned, "note")} read.</div>`;
    const picked = P.notes.filter(n => G.ticked.has(n.path)), lines = picked.reduce((s, n) => s + n.cuts.length, 0);
    const rows = P.notes.map(n => `<div class="vg-guide-note"><div class="vg-sugg"><input type="checkbox" data-guide-tick="${esc(n.path)}" aria-label="Write this note" ${G.ticked.has(n.path) ? "checked" : ""}>${hostRow(n.path, plural(n.cuts.length, "line"))}<span class="vg-sugg-acts">${hostOpen(n.path)}</span></div>${n.cuts.slice(0, 6).map(guideDiff).join("")}${n.cuts.length > 6 ? `<div class="vg-guide-cut"><span class="vg-muted">and ${plural(n.cuts.length - 6, "more line")}</span></div>` : ""}</div>`);
    const lead = `<p class="vg-muted vg-lens-note">${head}. Tick the notes to write.</p><div class="vg-ins-actions"><button class="vg-btn vg-btn-sm" data-guide-all="1">Tick all</button><button class="vg-btn vg-btn-sm" data-guide-all="0">Untick all</button>${opts.guideApply ? `<button class="vg-btn vg-btn-sm" data-guide-apply ${picked.length ? "" : "disabled"}>${picked.length ? `Write ${plural(lines, "line")} in ${plural(picked.length, "note")}` : "Nothing ticked"}</button>` : ""}<button class="vg-btn vg-btn-sm" data-guide-drop>Close the preview</button></div>`;
    return lensSec("Cuts", rows.slice(0, 300), { count: P.notes.length, word: "notes", first: 10, lead });
  }
  function guideLogHtml() {
    const L = guideNow.log || []; if (!L.length) return "";
    return lensSec("Past repairs", L.slice(0, 50).map((r, i) => `<div class="vg-sugg"><span class="vg-item-main"><span>“${esc(r.guide.seq)}”: ${r.to ? `replaced with “${esc(r.to)}”` : "taken out"}</span><span class="vg-item-sub">${esc(r.date)} · ${esc(guideScopeText(r.scope || {}))} · ${plural(r.cuts, "line")} in ${plural(r.notes, "note")}</span></span><span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-guide-again="${i}">Scan again</button>${r.report ? hostOpen(r.report) : ""}</span></div>`), { count: L.length, word: "runs", first: 4 });
  }
  function lensGuide() {
    if (!opts.guideScan) return emptyNext("Guide scan reads your notes, which this page can't.", "search");
    const G = guideNow, R = G.result, presets = guidePresets();
    const form = `<form class="vg-guide">
      <label class="vg-field"><span class="vg-flabel">Guide</span><input class="vg-input" data-guide="seq" value="${esc(G.seq)}" placeholder="A tag, word, link or line to find" autocomplete="off" spellcheck="false"></label>
      ${presets.length ? `<div class="vg-ins-actions">${presets.map((p, i) => `<button type="button" class="vg-btn vg-btn-sm" data-guide-preset="${i}" title="${esc(p.why || p.seq)}">${esc(p.name || p.seq)}</button>`).join("")}</div>` : ""}
      <label class="vg-field"><span class="vg-flabel">Only when followed by</span><input class="vg-input" data-guide="after" value="${esc(G.after)}" placeholder="Optional: the text right after it" autocomplete="off" spellcheck="false"></label>
      <div class="vg-guide-row">${VGScience.GUIDE_WHERE.map(w => `<label><input type="checkbox" data-guide-where="${w}" ${G.where.includes(w) ? "checked" : ""}> ${GUIDE_PLACES[w]}</label>`).join("")}<label><input type="checkbox" data-guide="word" ${G.word ? "checked" : ""}> Whole words</label></div>
      <label class="vg-field"><span class="vg-flabel">Look-alikes</span><select class="vg-select" data-guide="mismatches">${[0, 1, 2, 3, 4].map(k => `<option value="${k}" ${k === G.mismatches ? "selected" : ""}>${k ? `Up to ${plural(k, "letter")} different` : "None"}</option>`).join("")}</select></label>
      <label class="vg-field"><span class="vg-flabel">In folder</span><input class="vg-input" data-guide="folder" value="${esc(G.folder)}" list="vg-guide-folders" placeholder="Optional for a scan, needed for a repair" autocomplete="off" spellcheck="false"><datalist id="vg-guide-folders">${guideFolders().map(f => `<option value="${esc(f)}">`).join("")}</datalist></label>
      <label class="vg-field"><span class="vg-flabel">Or with tag</span><input class="vg-input" data-guide="tag" value="${esc(G.tag)}" placeholder="project/kiosk" autocomplete="off" spellcheck="false"></label>
      <label class="vg-field"><span class="vg-flabel">Replace with</span><input class="vg-input" data-guide="to" value="${esc(G.to)}" placeholder="Empty takes the match out" autocomplete="off" spellcheck="false"></label>
      <div class="vg-ins-actions"><button class="vg-btn" type="submit" ${G.busy ? "disabled" : ""}>${icon("search", 12)} ${G.busy ? "Scanning…" : "Scan"}</button></div></form>`;
    if (G.busy) return form;
    const A = G.applied, applied = A ? `<div class="vg-sugg">${A.report ? hostRow(A.report, `${plural(A.cuts, "line")} written in ${plural(A.notes, "note")}${A.left ? ` · ${plural(A.left, "line")} left: changed since the preview` : ""}`) : `<span class="vg-item-main"><span>Nothing written</span><span class="vg-item-sub">${plural(A.left, "line")} had changed since the preview</span></span>`}<span class="vg-sugg-acts">${A.report ? hostOpen(A.report) : ""}</span></div>` : "";
    if (G.error) return `${form}<div class="vg-empty">${esc(G.error)}</div>${guideLogHtml()}`;
    if (!R) return `${form}<p class="vg-muted vg-lens-note">A scan writes nothing. A repair is previewed, ticked note by note, then written.</p>${guideLogHtml()}`;
    const left = [R.skipped.where ? `${R.skipped.where} in places this guide doesn't look` : "", R.skipped.context ? `${R.skipped.context} without “${esc(R.guide.after)}” after` : ""].filter(Boolean).join(", ");
    const inScope = R.scope.folder || R.scope.tag ? ` ${esc(guideScopeText(R.scope))}` : "";
    if (!R.hits && !R.near) return `${form}${applied}${emptyNext(`No “${esc(R.guide.seq)}” in ${plural(R.scanned, "note")}${inScope}.${left ? ` Left out: ${left}.` : ""}`, "search:" + R.guide.seq)}${guideLogHtml()}`;
    const site = h => `${h.where === "body" ? "" : GUIDE_PLACES[h.where] + " · "}line ${h.line}: ${esc(h.pre)}<b>${esc(h.found)}</b>${esc(h.post)}`;
    const rows = kind => R.notes.filter(n => n[kind].length).map(n => `<div class="vg-sugg">${hostRow(n.path, `${n[kind + "Count"] > 1 ? `${n[kind + "Count"]} places · ` : ""}${kind === "near" ? `${plural(n.near[0].mismatches, "letter")} different · ` : ""}${site(n[kind][0])}`)}<span class="vg-sugg-acts">${hostOpen(n.path)}</span></div>`);
    const hits = rows("hits"), near = rows("near"), show = (kind, label) => `<button class="vg-btn vg-btn-sm" data-guide-show="${kind}">${icon("target", 12)} ${label}</button>`;
    const cap = R.guide.mismatches > R.allowed ? ` A guide of ${plural(R.guide.seq.length, "letter")} allows ${R.allowed ? `${R.allowed} different` : "no look-alikes"}.` : "";
    const repair = !opts.guidePreview || !R.hits || G.preview ? "" : guideScoped(R.scope) ? `<button class="vg-btn vg-btn-sm" data-guide-preview>Preview the repair: ${guideRepairText(G.to)}</button>` : `<span class="vg-muted">A repair is written inside one folder or tag: fill in one and scan again.</span>`;
    return `${form}${applied}<p class="vg-muted vg-lens-note">“${esc(R.guide.seq)}”${inScope}: ${R.hits} exact in ${plural(hits.length, "note")} of ${R.scanned}${R.near ? `, ${plural(R.near, "look-alike")}` : ""}.${left ? ` Left out: ${left}.` : ""}${cap}</p>
      ${sciRead("An exact match is the guide letter for letter, in the places ticked, with the text you asked for right after it. A look-alike differs by a letter or more: it is listed apart, is never counted as a match and is never cut, the way gene editing scores off-target sites. Code is skipped unless ticked.")}
      ${guidePreviewHtml()}
      ${lensSec("Exact matches", hits.slice(0, 200), { count: hits.length, word: "notes", first: 12, empty: "None.", lead: hits.length ? `<div class="vg-ins-actions">${show("hits", "Show on the graph")}<button class="vg-btn vg-btn-sm" data-toview="cas9">${icon("cas9", 12)} Show on the Cas9 model</button>${repair}</div>` : "" })}
      ${R.near ? lensSec("Look-alikes", near.slice(0, 200), { count: near.length, word: "notes", first: 8, lead: `<div class="vg-ins-actions">${show("near", "Show on the graph")}</div>` }) : ""}
      ${guideLogHtml()}`;
  }
  async function guideRun(redraw) {
    const G = guideNow; G.seq = G.seq.trim(); G.result = null; G.preview = null; G.ticked.clear(); G.error = !G.seq ? "Type a guide first." : !G.where.length ? "Tick at least one place to look." : "";
    if (G.error || G.busy) { redraw(); return; }
    G.busy = true; redraw();
    const guide = { seq: G.seq, after: G.after, mismatches: G.mismatches, word: G.word, where: [...G.where] }, scope = guideScopeOf(G);
    try { G.result = { ...await opts.guideScan(guide, scope), guide, scope }; dirty = true; kick(); /* the Cas9 scene draws this result */ } catch (e) { console.error("Vault Graph: the guide scan failed", e); G.error = `The scan stopped: ${e.message}`; }
    G.busy = false; if (lensKey === "guide") redraw();
  }
  function wireGuide(body, redraw) {
    const G = guideNow; if (!body.querySelector(".vg-guide")) return;
    const read = () => { const form = body.querySelector(".vg-guide"); if (!form) return; const v = k => form.querySelector(`[data-guide="${k}"]`);
      G.seq = v("seq").value; G.after = v("after").value; G.to = v("to").value; G.folder = v("folder").value; G.tag = v("tag").value; G.mismatches = +v("mismatches").value; G.word = v("word").checked;
      G.where = [...form.querySelectorAll("[data-guide-where]")].filter(c => c.checked).map(c => c.dataset.guideWhere); };
    const failed = (what, e) => { console.error(`Vault Graph: ${what} failed`, e); toast(`${what} stopped: ${e.message}`, "warn"); };
    if (G.log == null && opts.guideLog) { G.log = []; Promise.resolve(opts.guideLog()).then(l => { G.log = l || []; if (G.log.length && lensKey === "guide" && !G.busy) { read(); redraw(); } }).catch(e => failed("Reading past repairs", e)); }
    body.querySelector(".vg-guide").onsubmit = e => { e.preventDefault(); read(); G.applied = null; guideRun(redraw); };
    body.querySelectorAll("[data-guide-preset]").forEach(d => d.onclick = () => { const p = guidePresets()[+d.dataset.guidePreset]; if (!p) return; read();
      Object.assign(G, { seq: p.seq, after: p.after || "", to: p.to || "", mismatches: p.mismatches || 0, word: p.word !== false, where: p.where && p.where.length ? [...p.where] : [...VGScience.GUIDE_DEFAULT], applied: null }); guideRun(redraw); });
    body.querySelectorAll("[data-guide-show]").forEach(d => d.onclick = e => { e.stopPropagation(); if (!G.result) return;
      const ids = new Set(G.result.notes.filter(n => n[d.dataset.guideShow].length && byId[n.path]).map(n => n.path));
      if (!ids.size) { toast("None of these notes are in the graph", "warn"); return; }
      if (!lensBeside()) closeLens(); setHighlight(ids, `guide · ${G.result.guide.seq}`); select(null); fit(n => ids.has(n.id), 400); });
    // the repair: preview what would be written, tick notes, write them
    body.querySelectorAll("[data-guide-preview]").forEach(d => d.onclick = async e => { e.stopPropagation(); read(); const R = G.result; if (!R) return; d.disabled = true;
      const repair = { to: G.to }, guide = { ...R.guide, mismatches: 0 };
      try { G.preview = { ...await opts.guidePreview(guide, repair, R.scope), guide, repair, scope: R.scope }; G.ticked.clear(); G.applied = null; } catch (err) { failed("The preview", err); }
      if (lensKey === "guide") redraw(); });
    body.querySelectorAll("[data-guide-tick]").forEach(d => d.onchange = () => { read(); G.ticked[d.checked ? "add" : "delete"](d.dataset.guideTick); redraw(); });
    body.querySelectorAll("[data-guide-all]").forEach(d => d.onclick = e => { e.stopPropagation(); if (!G.preview) return; read(); G.ticked.clear(); if (d.dataset.guideAll === "1") G.preview.notes.forEach(n => G.ticked.add(n.path)); redraw(); });
    body.querySelectorAll("[data-guide-drop]").forEach(d => d.onclick = e => { e.stopPropagation(); read(); G.preview = null; G.ticked.clear(); redraw(); });
    body.querySelectorAll("[data-guide-apply]").forEach(d => d.onclick = e => { e.stopPropagation(); const P = G.preview; if (!P || !opts.guideApply) return; read();
      const notes = P.notes.filter(n => G.ticked.has(n.path)); if (!notes.length) return; d.disabled = true;
      const done = VGActions.run({ label: () => "The repair", title: () => plural(notes.length, "note"),
        run: async () => { const r = await opts.guideApply({ guide: P.guide, repair: P.repair, scope: P.scope, notes }); G.applied = r; return r.cuts ? `Wrote ${plural(r.cuts, "line")} in ${plural(r.notes, "note")}` : "Wrote nothing: every line had changed"; },
        undo: async () => { G.applied = null; if (lensKey === "guide") guideRun(redraw); } }, null, actionCtx(), e);
      Promise.resolve(done).then(ok => { if (ok) { G.log = null; guideRun(redraw); } else if (d.isConnected) d.disabled = false; }); });
    body.querySelectorAll("[data-guide-again]").forEach(d => d.onclick = e => { e.stopPropagation(); const r = (G.log || [])[+d.dataset.guideAgain]; if (!r) return;
      Object.assign(G, { seq: r.guide.seq, after: r.guide.after || "", to: r.to || "", folder: (r.scope || {}).folder || "", tag: (r.scope || {}).tag || "", mismatches: 0, word: r.guide.word !== false, where: r.guide.where && r.guide.where.length ? [...r.guide.where] : [...VGScience.GUIDE_DEFAULT], applied: null }); guideRun(redraw); });
  }
  function wireScience(body) {
    const again = () => { const y = body.scrollTop, was = VGParts.opened(body); body.innerHTML = lensKey === "survival" ? renderSurvival() : lensKey === "flowlens" ? renderFlow() : lensKey === "control" ? renderControl() : LENSES[lensKey].render(); wireLens(body); VGParts.reopen(body, was); body.scrollTop = y; };
    wireGuide(body, again);
    body.querySelectorAll("[data-blast-t]").forEach(d => { d.oninput = () => { const o = d.parentElement.querySelector("b"); if (o) o.textContent = (+d.value).toFixed(2); }; d.onchange = () => { blastT = +d.value; again(); }; });
    body.querySelectorAll("[data-blast-seed]").forEach(d => d.onclick = e => { e.stopPropagation(); blastSeed = d.dataset.blastSeed; again(); });
    body.querySelectorAll("[data-blast-show]").forEach(d => d.onclick = e => { e.stopPropagation(); blastShow(d.dataset.blastShow); });
    body.querySelectorAll("[data-toview]").forEach(d => d.onclick = e => { e.stopPropagation(); if (!lensBeside()) closeLens(); setView(d.dataset.toview); });
    body.querySelectorAll("[data-control]").forEach(d => d.onclick = e => { e.stopPropagation(); controlKind = d.dataset.control; again(); });
    body.querySelectorAll("[data-upone]").forEach(d => d.onclick = e => { e.stopPropagation(); d.disabled = true; upAdd([upRows[+d.dataset.upone]], e).then(ok => { if (!ok) d.disabled = false; }); });
    body.querySelectorAll("[data-upall]").forEach(d => d.onclick = e => { e.stopPropagation(); d.disabled = true; upAdd(upRows, e).then(ok => { if (!ok) d.disabled = false; }); });
    body.querySelectorAll("[data-twdrop]").forEach(d => d.onclick = e => { e.stopPropagation(); d.disabled = true; twDrop([twRows[+d.dataset.twdrop]], e).then(ok => { if (!ok) d.disabled = false; }); });
    body.querySelectorAll("[data-twall]").forEach(d => d.onclick = e => { e.stopPropagation(); d.disabled = true; twDrop(twRows.filter(r => r.line != null), e).then(ok => { if (!ok) d.disabled = false; }); });
    body.querySelectorAll("[data-twopen]").forEach(d => d.onclick = e => { e.stopPropagation(); opts.openNote(d.dataset.twopen, e.ctrlKey || e.metaKey); });
    body.querySelectorAll("[data-survival-split]").forEach(d => d.onclick = e => { e.stopPropagation(); survivalSplit = d.dataset.survivalSplit; again(); });
  }
