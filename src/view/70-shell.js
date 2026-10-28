  // ---------------------------------------------------------------- today strip: what this view says right now, and one thing to do about it
  const todayHidden = new Set();
  const topBy = (xs, f) => xs.reduce((best, x) => best == null || f(x) > f(best) ? x : best, null);
  function todayFor(v) {
    if (SCENES[v]) return SCENES[v].today ? SCENES[v].today() : null;
    const notes = nodes.filter(n => !special(n) && !n.ghost), gap = (DATA.gaps || [])[0];
    const why = g => `${g.comentions ? `${g.comentions} co-mentions in your dailies` : "related by shared tags"}, only ${plural(g.links, "link")}`;
    const bridgeAct = g => async () => { if (opts.writeNote && await confirmBox("Draft a bridge note", `Create a draft in ${FOLDERS.inbox} connecting <b>${esc(clusterName(g.a))}</b> and <b>${esc(clusterName(g.b))}</b>?`, "Create")) writeBridge(g.a, g.b); else focusClusters([g.a, g.b]); };
    if (v === "radar") { const hold = notes.filter(n => n.tasks > 0 && (n.taskAge ?? 0) > 90), o = topBy(hold, n => n.taskAge);
      return o ? { text: `${hold.length} notes have tasks waiting 90+ days · oldest: ${o.name} (${o.taskAge} days)`, label: "Triage", run: startTriage } : null; }
    if (v === "lineage") { const L = mapCache.lineage; if (!L) return null;
      const best = notes.reduce((b, n) => (L.desc.get(n.id) || 0) > (b ? L.desc.get(b.id) || 0 : 0) ? n : b, null);
      const alone = notes.filter(n => n.born && !L.parent.has(n.id) && !(L.kids.get(n.id) || []).length).length;
      return best ? { text: `Most prolific ancestor: ${best.name} · ${plural(L.desc.get(best.id), "note")} grew from it · ${alone} notes stand alone`, label: "Show its line", run: () => reveal(best.id) } : null; }
    if (v === "ripples") { const Rp = mapCache.ripples; if (!Rp) return null;
      const centre = id => () => { st.rippleRoot = id; applyMapLayout(true); renderToday(); };
      if (st.selected && byId[st.selected] && !byId[st.selected].person && !byId[st.selected].ghost && st.selected !== Rp.rootId) { const n = byId[st.selected], d = Rp.depth.get(n.id);
        return { text: `${n.name}: ${d == null ? "no link path reaches it" : plural(d, "click") + " from " + (Rp.rootId ? byId[Rp.rootId].name : "your maps")}`, label: "Centre here", run: centre(n.id) }; }
      if (Rp.rootId) return { text: `Centred on ${byId[Rp.rootId].name} · ${Rp.lost.length} notes out of reach from it`, label: "Back to your maps", run: centre(null) };
      const deep = notes.filter(n => (Rp.depth.get(n.id) || 0) >= 4).length, x = Rp.lost.slice().sort(byImportance)[0], mm = x && mocOf[x.cluster];
      if (!x) return { text: `Every note is reachable from your maps · ${deep} are 4+ clicks deep`, label: "", run: null };
      return { text: `${Rp.lost.length} notes no link reaches · ${deep} are 4+ clicks deep · most relied-on lost note: ${x.name}`, label: mm && canAddToMap() ? `Add to ${mm.title}` : "Show it",
        run: async () => { if (!(mm && canAddToMap())) return reveal(x.id);
          if (!await confirmBox("Add to its map", `Add <b>${esc(x.name)}</b> to <b>${esc(mm.title)}</b> under “Also in this topic”? It becomes 2 clicks from your maps.`, "Add")) return;
          await addToMap(mm.id, [x.id]); } }; }
    if (v === "alchemy") { const open = mapCache.alchemy ? mapCache.alchemy.rx.filter(x => !x.done) : []; if (!open.length) return null;
      const x = open.find(r => st.selected && (r.a.id === st.selected || r.b.id === st.selected)) || open[al.idx % open.length];
      return { text: `⚗ ${REACTIONS[x.type][0]}: ${x.a.name} + ${x.b.name} · ${x.why} · ${open.length} waiting · ${plural(alScore.get(), "reaction")} run`, label: "React", run: () => alRun(x) }; }
    if (v === "foodweb") { const ks = keystones(), x = ks[0];
      return x ? { text: `Keystone at risk: ${x.n.name} · ${x.deps} notes depend on it, unchanged for ${x.n.age} days (${ks.length} like it)`, label: "Review", run: () => { reveal(x.n.id); } } : null; }
    if (v === "weather") { const t = mapCache.weather && topBy(mapCache.weather.tops, x => x.a);
      return t && t.a > 0.35 ? { text: `${clusterName(t.c)} is ${t.ratio.toFixed(1)}× busier than usual in your dailies${t.storm ? " (storm this week)" : ""}`, label: mocOf[t.c] && opts.openNote ? "Open its map" : "Show topic",
        run: () => mocOf[t.c] && opts.openNote ? opts.openNote(mocOf[t.c].id, false) : focusClusters([t.c]) } : null; }
    if (v === "clock") { const C0 = mapCache.clock; if (!C0) return null; const wd = (new Date().getDay() + 6) % 7, xs = C0.cs.filter(x => x.wd.indexOf(Math.max(...x.wd)) === wd);
      const day = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][wd];
      return xs.length ? { text: `It's ${day}: usually ${xs.slice(-3).reverse().map(x => clusterName(x.c)).join(", ")}`, label: "Show them", run: () => focusClusters(xs.map(x => x.c)) } : { text: `It's ${day}: no topic peaks today`, label: "", run: null }; }
    if (v === "garden") { const w = notes.filter(n => staleFor(n, Q.stale_days) && !n.isolated).sort(byImportance);
      return w.length ? { text: `${w.length} plants wilting (unchanged ${Q.stale_days}+ days) · most relied-on: ${w[0].name}`, label: "Tend it", run: () => reveal(w[0].id) } : null; }
    if ((v === "palace" || v === "ships") && gap) return { text: `${v === "ships" ? "Uncharted crossing" : "Bricked-up doorway"}: ${clusterName(gap.a)} ↔ ${clusterName(gap.b)} · ${why(gap)}`, label: opts.writeNote ? "Draft a bridge" : "Show both", run: bridgeAct(gap) };
    if (v === "rings" && mapCache.rings) { const t = topBy(mapCache.rings.trunks, x => x.scars.size);
      return t && t.scars.size ? { text: `${clusterName(t.c)} carries the most scars: ${t.scars.size} months with incident or failure write-ups`, label: "Show it", run: () => focusClusters([t.c]) } : null; }
    if (v === "sky") { const r = topBy(notes.filter(n => n.recent > 0), n => n.recent);
      return r ? { text: `Rising star: ${r.name} · ${r.recent} daily-note mentions in the last 30 days`, label: "Show", run: () => reveal(r.id) } : null; }
    if (v === "realm") { const iso = notes.filter(n => n.isolated).sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
      return iso.length ? { text: `${iso.length} notes adrift with the dragons (linked to nothing) · most mentioned: ${iso[0].name}`, label: "Adopt it", run: () => reveal(iso[0].id) } : null; }
    if (v === "city" && mapCache.city) { const tall = topBy(notes.filter(n => mapCache.city.b.has(n.id)), n => importance(n));
      return { text: `${mapCache.city.cranes.size} new buildings this week · tallest: ${tall ? tall.name : "—"}`, label: tall ? "Show tallest" : "", run: tall ? () => reveal(tall.id) : null }; }
    if (v === "subway" && mapCache.subway) { const L = topBy(mapCache.subway.lines, l => l.stops.reduce((a, id) => a + (byId[id].recent || 0), 0));
      return L ? { text: `Busiest line: ${clusterName(L.c)} · ${L.stops.reduce((a, id) => a + (byId[id].recent || 0), 0)} recent mentions along it`, label: "Show it", run: () => focusClusters([L.c]) } : null; }
    if (v === "topo" && mapCache.topo) { const pk = topBy(mapCache.topo.peaks, x => x.h), quiet = notes.filter(n => !n.isolated && activity(n) < 0.02).length;
      return pk ? { text: `Highest summit: ${clusterName(pk.c)} · ${quiet} notes under fog (no recent edits or mentions)`, label: "Show it", run: () => focusClusters([pk.c]) } : null; }
    if (gap && ["2d", "3d", "neural"].includes(v)) return { text: `Biggest gap: ${clusterName(gap.a)} ↔ ${clusterName(gap.b)} · ${why(gap)}`, label: "Show both", run: () => focusClusters([gap.a, gap.b]) };
    return null;
  }
  function renderToday() {
    const bar = $(".vg-today"); if (!bar) return;
    const t = opts.compact || replay || todayHidden.has(st.view) ? null : todayFor(st.view);
    if (!t) { bar.hidden = true; return; }
    bar.hidden = false; const tx = $(".vg-today-text"); tx.textContent = t.text; tx.title = t.text;   // the whole text on hover
    tx.onclick = () => bar.classList.toggle("is-open");   // and on a tap: a cut-off line opens to its full text
    const b = $(".vg-today-act"); b.hidden = !t.run; b.textContent = t.label; b.onclick = () => t.run && t.run();
  }
  $(".vg-today-x").onclick = () => { todayHidden.add(st.view); renderToday(); };

  // ---------------------------------------------------------------- save the current view in one click; cycle favourites in home cards
  $(".vg-savebtn").onclick = () => {
    const name = `${MAPS[st.view] || { "2d": "2D", "3d": "3D", neural: "Neural", cosmos: "Cosmos" }[st.view] || st.view}${st.focus && byId[st.focus] ? " · " + byId[st.focus].name : ""} · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    savedViews = savedViews.filter(v => v.name !== name).concat([snapshotView(name)]); renderSaved(); persistSoon(); toast(`Saved “${name}”`, "ok");
  };
  function syncCycle() { const nm = $(".vg-cycle-name"); if (nm) nm.textContent = MAPS[st.view] || { "2d": "2D", "3d": "3D", neural: "Neural", cosmos: "Cosmos" }[st.view] || st.view; }
  if (opts.favourites) {
    const step = d => { const f = opts.favourites, i = f.indexOf(st.view); setView(f[((i < 0 ? 0 : i + d) + f.length) % f.length]); };
    $(".vg-cycle-prev").onclick = () => step(-1); $(".vg-cycle-next").onclick = () => step(1);
  }

  // ---------------------------------------------------------------- search palette
  const fuzzy = VGRules.fuzzyScore;
  // a word list (a cluster's keywords): each query word has to begin, or sit inside, one of its words; half of them at least
  const wordHits = (q, s) => {
    const qw = q.split(/\s+/).filter(w => w.length > 1), sw = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const m = qw.filter(w => sw.some(x => x.startsWith(w) || (w.length > 3 && x.includes(w)))).length;
    return qw.length && m * 2 >= qw.length ? m * 4 - (qw.length - m) : -1;
  };
  const lift = (score, by) => score < 0 ? -1 : score + by;   // ranks a kind higher, but never turns a miss into a match
  let palItems = [], palIdx = 0, palMode = null;
  function openPalette(mode) {
    if (palMode && palMode.pick) palMode.pick(null);   // a pick still waiting: it was abandoned
    palMode = mode && (mode.pathFrom || mode.pickFor || mode.linkFrom || mode.pick) ? mode : null;
    const p = $(".vg-palette"); p.hidden = false;
    const input = $(".vg-pq"); input.value = (mode && mode.query) || "";
    input.placeholder = palMode && palMode.pick ? palMode.placeholder || "Choose a note…" : palMode && palMode.linkFrom ? `Link “${byId[palMode.linkFrom].name}” from which note?` : palMode && palMode.pickFor ? "Which note or MOC is this star?" : palMode ? `Path from “${byId[palMode.pathFrom].name}” to…` : "Search notes and clusters…";
    renderPalette(input.value); input.focus();
  }
  function closePalette() {
    if (palMode && palMode.pick) { const r = palMode.pick; palMode = null; r(null); }   // closed without choosing
    $(".vg-palette").hidden = true; root.focus({ preventScroll: true });
  }
  // what the palette lists: everything, or in a mode only notes (a pick narrows them with its own filter)
  const palNote = n => !palMode || (palMode.pick ? !n.ghost && !n.person && (!palMode.filter || palMode.filter(n.id)) : !special(n) || (palMode.pickFor && n.moc));
  function renderPalette(q) {
    q = q.trim().toLowerCase();
    if (!q) {
      // a pick with its own filter (a map, a hub) lists the most relied-on notes that pass it: maps aren't in the ranking
      const draft = n => n.id.startsWith(FOLDERS.inbox + "/") ? 1 : 0;   // filed notes before inbox drafts
      const pool = palMode && palMode.filter ? nodes.filter(palNote).sort((a, b) => draft(a) - draft(b) || byImportance(a, b)).map(n => n.id) : ranked.filter(id => palNote(byId[id]));
      palItems = pool.slice(0, 8).map(id => ({ kind: "note", id, score: 0 }));
    } else {
      const ns = nodes.filter(palNote).map(n => ({ kind: "note", id: n.id, score: Math.max(fuzzy(q, n.name), fuzzy(q, n.folder + "/" + n.name) - 2) })).filter(x => x.score >= 0);
      const cs = palMode ? [] : DATA.clusters.map(c => ({ kind: "cluster", c: c.id, score: lift(Math.max(fuzzy(q, c.name), fuzzy(q, c.label || ""), wordHits(q, c.keywords || "") - 1), 1) })).filter(x => x.score >= 0);
      const svs = palMode ? [] : savedViews.map((v, i) => ({ kind: "saved", i, score: lift(fuzzy(q, v.name), 2) })).filter(x => x.score >= 0);
      palItems = [...svs, ...cs, ...ns].sort((a, b) => b.score - a.score).slice(0, 40);
      if (opts.writeNote && !palMode && !nodes.some(n => n.name.toLowerCase() === q)) palItems.push({ kind: "create", score: -1 });
    }
    palIdx = 0;
    const list = $(".vg-palette-list");
    list.innerHTML = (q ? "" : `<div class="vg-list-h">Most influential</div>`) + palItems.map((it, i) => it.kind === "create"
      ? `<div class="vg-pitem" role="option" data-create data-i="${i}">${icon("plus", 14)}<span class="vg-item-main"><b>Create “${esc($(".vg-pq").value.trim())}”</b><span class="vg-item-sub">New note in ${esc(FOLDERS.inbox)}</span></span></div>`
      : it.kind === "saved"
      ? `<div class="vg-pitem" role="option" data-i="${i}">${icon("layers", 14)}<span class="vg-item-main"><b>${esc(savedViews[it.i].name)}</b><span class="vg-item-sub">Saved view</span></span></div>`
      : it.kind === "cluster"
      ? `<div class="vg-pitem" role="option" data-i="${i}"><span class="vg-dot" style="background:${colorOf(it.c)}"></span><span class="vg-item-main"><b>${esc(clusterName(it.c))}</b><span class="vg-item-sub">Cluster · ${plural(clusterById[it.c].size, "note")}</span></span></div>`
      : `<div class="vg-pitem" role="option" data-i="${i}"><span class="vg-dot ${byId[it.id].ghost ? "is-ghost" : ""}" style="background:${dotOf(it.id)}"></span><span class="vg-item-main">${label(it.id)}<span class="vg-item-sub">${esc(byId[it.id].folder || "/")}</span></span></div>`).join("")
      || `<div class="vg-empty">No note or cluster names match.</div>`;
    list.querySelectorAll(".vg-pitem").forEach(el => {
      el.onmousemove = () => movePal(+el.dataset.i);
      el.onclick = () => choosePal(+el.dataset.i, false);
    });
    movePal(0);
    // Recall (opts.recall: the plugin's search inside notes): a moment after typing stops, the places you dealt with
    // it before, under the name matches. A newer query drops an older answer.
    const tok = ++recallTok;
    if (q.length >= 3 && opts.recall && !palMode) setTimeout(async () => {
      if (tok !== recallTok) return;
      let hits = []; try { hits = await opts.recall(q); } catch (e) { return; }
      if (tok !== recallTok || $(".vg-palette").hidden || !hits.length) return;
      const at = palItems.length, none = list.querySelector(".vg-empty"); if (none) none.remove();
      hits.forEach(h => palItems.push({ kind: "recall", h }));
      // the hits, then the notes related to them (similar meaning, or linked to the top hit) under their own heading
      const row = (h, k) => `<div class="vg-pitem vg-recall" role="option" data-i="${at + k}">${icon(h.kind === "code" ? "code" : h.kind === "related" ? "link" : "file", 14)}<span class="vg-item-main"><b>${esc(h.path.split("/").pop().replace(/\.md$/, ""))}${h.heading ? ` <span class="vg-muted">§ ${esc(h.heading)}</span>` : ""}</b>`
        + `<span class="vg-item-sub">${esc(h.why.join(" · "))}${h.lang ? " · " + esc(h.lang) : ""}${h.date ? " · " + esc(h.date) : ""}${h.kind === "related" ? "" : " · line " + h.line}</span>${h.snippet ? `<pre class="vg-recall-snip">${esc(h.snippet)}</pre>` : ""}</span></div>`;
      const firstRel = hits.findIndex(h => h.kind === "related");
      list.insertAdjacentHTML("beforeend", `<div class="vg-list-h">In your notes</div>` + hits.map((h, k) => (k === firstRel ? `<div class="vg-list-h">Related</div>` : "") + row(h, k)).join(""));
      list.querySelectorAll(".vg-recall").forEach(el => { el.onmousemove = () => movePal(+el.dataset.i); el.onclick = () => choosePal(+el.dataset.i, false); });
      const cr = list.querySelector("[data-create]"); if (cr) list.appendChild(cr);   // creating stays the last resort
      if (!palItems.slice(0, at).some(x => x.kind !== "create")) movePal(at);   // nothing matched by name: the best place you wrote about it
    }, 220);
  }
  let recallTok = 0;
  function movePal(i) {
    palIdx = Math.max(0, Math.min(palItems.length - 1, i));
    $$(".vg-pitem").forEach(el => { const on = +el.dataset.i === palIdx; el.classList.toggle("is-on", on); el.setAttribute("aria-selected", on); if (on) el.scrollIntoView({ block: "nearest" }); });
  }
  async function choosePal(i, all) {
    const q = $(".vg-pq").value.trim();
    const pick = palMode && palMode.pick; if (pick) palMode.pick = null;   // answered below, not by closePalette
    closePalette();
    if (pick) { const it = palItems[i]; palMode = null; pick(it && it.kind === "note" ? it.id : null); return; }
    if (all && q) {
      const ids = new Set(palItems.filter(x => x.kind === "note").map(x => x.id));
      setHighlight(ids, `“${q}” · ${ids.size} matches`); select(null);
      if ([...ids].some(id => visible(byId[id]))) fit(n => ids.has(n.id));
      return;
    }
    const it = palItems[i]; if (!it) return;
    if (it.kind === "recall") { if (opts.openNote) opts.openNote(it.h.path, false); return; }
    if (it.kind === "create") { createNote(NEW_KINDS.note, q); return; }   // the note where you dealt with it
    if (palMode && palMode.linkFrom && it.kind === "note") { const from = it.id, to = palMode.linkFrom; palMode = null;
      if (await confirmBox("Link it", `Add a link to <b>${esc(byId[to].name)}</b> in <b>${esc(byId[from].name)}</b>'s Related section?`, "Link")) { await actOnSuggestion("link", from, to, document.createElement("button")); select(to); } return; }
    if (palMode && palMode.pickFor && it.kind === "note") { const b = cos.bodies.find(x => x.id === palMode.pickFor); palMode = null; if (b) { b.target = it.id; cosmosCapture(); persistSoon(); alpha = Math.max(alpha, 0.5); selectBody(b.id); } return; }
    if (palMode && it.kind === "note") { findPath(palMode.pathFrom, it.id); palMode = null; return; }
    if (it.kind === "saved") applySaved(savedViews[it.i]);
    else if (it.kind === "cluster") focusClusters([it.c]); else reveal(it.id);
  }

  // ---------------------------------------------------------------- path finder
  // Shortest chain of links between two notes (breadth-first over the link graph). Answers
  // "how is X connected to Y" -- and shows where a bridge belongs when the answer is "barely".
  function shortestPath(from, to) {
    const prev = new Map([[from, null]]), queue = [from];
    while (queue.length) {
      const v = queue.shift();
      if (v === to) break;
      for (const m of nb[v]) if (!prev.has(m)) { prev.set(m, v); queue.push(m); }
    }
    if (!prev.has(to)) return null;
    const ids = []; for (let v = to; v; v = prev.get(v)) ids.unshift(v);
    return ids;
  }
  function findPath(from, to) {
    const ids = shortestPath(from, to);
    if (!ids) { toast("No chain of links connects these notes — they sit in separate parts of the vault", "warn"); return; }
    if (st.focus) { st.focus = null; st.focusDist = null; $(".vg-focusbar:not(.vg-pathbar)").hidden = true; if (!neural()) cam.cx = cam.cy = cam.cz = 0; }
    ids.forEach(id => { const n = byId[id]; st.hidden.delete(id); st.hiddenClusters.delete(n.cluster);
      if (n.isolated) { st.isolated = true; $(".vg-isolated").checked = true; }
      if (leafOf[id]) { st.leaves = false; $(".vg-leaves").checked = false; } });
    st.path = { ids, set: new Set(ids) };
    select(null); rebuild(false);
    const bar = $(".vg-pathbar"); bar.hidden = false;
    bar.innerHTML = `${icon("link", 14)}<span class="vg-path-steps">${ids.map((id, i) =>
      `<button class="vg-path-step" data-id="${esc(id)}" style="--c:${colorOf(byId[id].cluster)}">${esc(byId[id].name)}</button>${i < ids.length - 1 ? '<span class="vg-muted">→</span>' : ""}`).join("")}</span>
      <span class="vg-muted">${plural(ids.length - 1, "step")}</span><button class="vg-btn vg-btn-sm vg-pexit">Clear <kbd>Esc</kbd></button>`;
    bar.querySelectorAll(".vg-path-step").forEach(b => b.onclick = () => { const id = b.dataset.id; clearPath(); reveal(id); });
    bar.querySelector(".vg-pexit").onclick = clearPath;
    setTimeout(() => fit(n => st.path && st.path.set.has(n.id), 500), 300);
    renderStatus();
  }
  function clearPath() { st.path = null; $(".vg-pathbar").hidden = true; renderStatus(); dirty = true; kick(); }
  $(".vg-pq").oninput = e => renderPalette(e.target.value);
  $(".vg-pq").onkeydown = e => {
    if (e.key === "ArrowDown") { movePal(palIdx + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { movePal(palIdx - 1); e.preventDefault(); }
    else if (e.key === "Enter") { choosePal(palIdx, e.shiftKey); e.preventDefault(); }
  };
  $(".vg-palette").onclick = e => { if (e.target.classList.contains("vg-palette")) closePalette(); };
  $(".vg-searchbtn").onclick = () => openPalette();
  $(".vg-reviewbtn").onclick = () => {
    setTab("insights"); if (narrow()) root.classList.add("vg-side-open"); else root.classList.remove("vg-side-hidden");
    const r = $(".vg-review"); if (r) { $(".vg-panels").scrollTop = 0; r.classList.add("is-flash"); setTimeout(() => r.classList.remove("is-flash"), 900); }
  };

  // ---------------------------------------------------------------- presets
  const PRESETS = {
    explore: { name: "Explore", hint: "Clusters, influence and gaps", apply: () => ({ sizeBy: "bc", colorBy: "cluster", gaps: true, overlays: [] }) },
    attention: { name: "Attention map", hint: DATA.has_usage ? "Big + grey = important but not opened lately" : "Big + grey = important but not mentioned lately",
      apply: () => ({ sizeBy: "bc", colorBy: DATA.has_usage ? "opens90" : "recent", gaps: false, overlays: [] }) },
    recent: { name: "Recent work", hint: `What your dailies talked about in the last ${DATA.recent_days} days`, apply: () => ({ sizeBy: "recent", colorBy: "recent", gaps: false, overlays: [] }) },
    gaps: { name: "Gaps", hint: "Only notes with suggested links stay lit", apply: () => ({ sizeBy: "bc", colorBy: "cluster", gaps: true, overlays: [], highlight: "gaps" }) },
    health: { name: "Link health", hint: "Orphans, dead ends and broken links", apply: () => ({ sizeBy: "bc", colorBy: "cluster", gaps: false, overlays: ["orphans", "deadends", "broken"] }) },
    writing: { name: "Writing list", hint: "Notes to write, stubs and open tasks", apply: () => ({ sizeBy: "bc", colorBy: "cluster", gaps: false, overlays: ["stubs"], layers: { wanted: true, tasks: true } }) },
  };
  function applyPreset(key) {
    const p = PRESETS[key], v = p.apply();
    st.preset = key; st.sizeBy = v.sizeBy; st.colorBy = v.colorBy; st.gaps = v.gaps; st.overlays = new Set(v.overlays);
    $(".vg-size").value = st.sizeBy; $(".vg-color").value = st.colorBy; $(".vg-gaps").checked = st.gaps;
    if (v.layers) Object.entries(v.layers).forEach(([k, on]) => setLayer(k, on, true));
    renderOverlays(); overlayList(); clearMulti(); select(null);
    if (v.highlight === "gaps") {
      const ids = new Set(); links.forEach(l => { if (VGRules.isSuggestion(l)) { ids.add(l.s.id); ids.add(l.t.id); } });
      setHighlight(ids, `${ids.size} notes with suggestions`);
    } else clearHighlight();
    rebuild(true); persistSoon(); toast(`${p.name} — ${p.hint}`);
  }
  // Map views share one toolbar button (nine view buttons crowded it): the menu lists them, the button shows the current one
  const MAP_INFO = { subway: ["subway", "Topics as lines; black-ringed stations connect topics"], topo: ["mountain", "Hills are notes you rely on; valleys are gaps"],
    city: ["city", "Notes as buildings: tall = relied on, lit = recent, grey = stale; town halls are maps"], garden: ["sprout", "Notes grow from seed to evergreen; wilting = stale"],
    palace: ["palace", "Topics as rooms, links as doors, gaps bricked up"],
    weather: ["cloud", "Which topics are heating up (L, storms) or going quiet (H)"], ships: ["anchor", "Topics as islands, links as shipping lanes, gaps fogged in"],
    rings: ["rings", "How each topic grew: a ring per month, scars for incidents"], sky: ["star", "Constellations of your most relied-on notes; rising stars twinkle"],
    realm: ["castle", "A hand-drawn map: kingdoms, castles (maps), here be dragons"], foodweb: ["leaf", "Which notes feed which; stale ones others rely on are endangered"],
    lineage: ["branch", "Where each note came from: time left to right, a lane per topic"],
    ripples: ["ripple", "How many clicks each note is from your maps; the belt only search reaches"],
    alchemy: ["flask", "Topics as flasks, notes from lead to gold; run the reactions waiting between them"],
    clock: ["clock", "When you work on what: weekday and month dials"], radar: ["radar", "Open tasks as blips by how long they've waited; red = 90+ days"],
    ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, [d.icon, d.blurb]])) };
  // ---------------------------------------------------------------- the Views picker: graphs, maps, lenses and styles in one place
  // One button, one panel (a popover under the button on wide panes, a bottom sheet on phones): tabs, big tiles, a filter
  const GRAPH_INFO = { "2d": ["hub", "2D", "Force layout: topics, influence and gaps"], "3d": ["layers", "3D", "The same graph in depth; drag to turn it"],
    neural: ["brain", "Neural", "Topics as brain lobes, links firing between them"], cosmos: ["orbit", "Cosmos", "Maps become stars; place planets and fly between them"] };
  // Map = the graph itself (2D, 3D), the main way in; Scenes = the gallery of picture views (neural, cosmos, the maps,
  // the analysis pictures, the playful ones, your own scene blocks); Display = style presets + node size/colour,
  // layers, saved views; Health = the overlays
  const PICK_TABS = [["views", "Map"], ["scenes", "Scenes"], ["lenses", "Lenses"], ["style", "Display"], ["health", "Health"]];
  const CORE_VIEWS = new Set(["2d", "3d"]);
  const PANEL_TABS = new Set(["style", "health"]);
  const PICK_TOOLS = [["vg-lassobtn", "lasso", "Lasso"], ["vg-replaybtn", "play", "Replay"], ["vg-savebtn", "star", "Save view"], ["vg-timebtn", "clock", "Time-lapse"],
    ["randomize", "sparkles", "Randomize layout"], ["resetlayout", "refresh", "Reset layout"]];
  // the tools, wherever they're offered (the Tools menu, the phone's picker sheet): which apply now, and one way to run one
  const tools = () => PICK_TOOLS.filter(([c]) => (c !== "randomize" || !isCosmos()) && (c !== "resetlayout" || canReset()));
  const runTool = c => ({ randomize: randomizeLayout, resetlayout: resetLayout }[c] || (() => $("." + c).click()))();
  const toolOn = c => { const b = c.startsWith("vg-") && $("." + c); return !!b && b.getAttribute("aria-pressed") === "true"; };
  function syncToolsBtn() { const b = $(".vg-toolsbtn"); if (b) b.setAttribute("aria-pressed", PICK_TOOLS.some(([c]) => toolOn(c))); }
  function closeTools() { const m = $(".vg-toolsmenu"); if (!m || m.hidden) return false; m.hidden = true; $(".vg-toolsbtn").setAttribute("aria-expanded", "false"); return true; }
  function openTools() {
    const m = $(".vg-toolsmenu"); closeMenu();
    m.innerHTML = tools().map(([c, ic, name]) => { const src = c.startsWith("vg-") ? $("." + c) : null;
      return `<button class="vg-mitem" role="menuitem" data-tool="${c}"${src && src.hasAttribute("aria-pressed") ? ` aria-checked="${toolOn(c)}"` : ""}><b>${icon(ic, 14)} ${esc(name)}</b>${src && src.title ? `<span class="vg-muted">${esc(src.title.replace(/^[^:(]*:\s*/, "").replace(/^./, ch => ch.toUpperCase()))}</span>` : ""}</button>`; }).join("");
    m.querySelectorAll("[data-tool]").forEach(x => x.onclick = () => { closeTools(); runTool(x.dataset.tool); });
    m.hidden = false; $(".vg-toolsbtn").setAttribute("aria-expanded", "true"); m.querySelector("[data-tool]").focus({ preventScroll: true });
  }
  $(".vg-toolsbtn").onclick = e => { e.stopPropagation(); if (!closeTools()) openTools(); };
  const sheetMode = () => MOBILE || root.clientWidth < 760;
  let pickTab = null;
  function pickItems() {
    const out = [];
    Object.entries(GRAPH_INFO).forEach(([k, [ic, name, hint]]) => { if (!(opts.compact && k === "cosmos")) out.push({ tab: CORE_VIEWS.has(k) ? "views" : "scenes", k, ic, name, hint, on: st.view === k, run: () => setView(k) }); });
    Object.entries(MAPS).forEach(([k, name]) => out.push({ tab: "scenes", k, ic: MAP_INFO[k][0], name, hint: MAP_INFO[k][1], on: st.view === k, run: () => setView(k) }));
    if (!opts.compact) Object.entries(LENSES).forEach(([k, l]) => out.push({ tab: "lenses", k, ic: "grid", name: l.name, hint: l.hint, on: lensKey === k, run: () => openLens(k) }));
    Object.entries(PRESETS).forEach(([k, p]) => out.push({ tab: "style", k, ic: "sparkles", name: p.name, hint: p.hint, on: st.preset === k, run: () => applyPreset(k) }));
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));   // A–Z within every tab
    if (opts.writeNote && !opts.compact) out.push({ tab: "scenes", k: "newscene", ic: "plus", name: "New scene", hint: "Your own view, written in a note", on: false, run: () => newScene() });
    return out;
  }
  // The Scenes gallery in groups (a scene not named here lands in "More"); Recent first when there's history
  const VIEW_GROUPS = [
    ["Space", ["neural", "cosmos"]],
    ["Maps", ["subway", "topo", "city", "garden", "palace", "weather", "ships", "rings", "sky", "realm"]],
    ["Analysis", ["foodweb", "alchemy", "lineage", "ripples", "clock", "radar", "elements"]],
    ["Playful", ["zombie", "sand"]],
  ];
  function viewGroups(xs) {
    const by = new Map(xs.map(i => [i.k, i])), used = new Set(), out = [];
    const take = (name, keys) => { const g = keys.map(k => by.get(k)).filter(Boolean); g.forEach(i => used.add(i.k)); if (g.length) out.push([name, g]); };
    const recent = (st.recent || []).filter(k => k !== st.view && by.has(k)).slice(0, 3);
    if (recent.length) out.push(["Recent", recent.map(k => by.get(k))]);
    VIEW_GROUPS.forEach(([name, keys]) => take(name, keys));
    take("Your scenes", [...xs.filter(i => i.k.startsWith("note-")).map(i => i.k), "newscene"]);
    take("More", xs.filter(i => !used.has(i.k)).map(i => i.k));
    return out;
  }
  function renderPicker() {
    const items = pickItems(), q = $(".vg-picker-q").value.trim().toLowerCase();
    const tabs = PICK_TABS.filter(([t]) => PANEL_TABS.has(t) || items.some(i => i.tab === t));
    if (!tabs.some(([t]) => t === pickTab)) pickTab = tabs[0][0];
    $(".vg-picker-tabs").innerHTML = tabs.map(([t, name]) => { const n = items.filter(i => i.tab === t).length;
      return `<button role="tab" class="vg-picker-tab" data-tab="${t}" aria-selected="${!q && t === pickTab}">${name}${n && !PANEL_TABS.has(t) ? `<span class="vg-count">${n}</span>` : ""}</button>`; }).join("");
    const tile = i => `<button class="vg-tile" data-tab="${i.tab}" data-k="${esc(i.k)}" aria-pressed="${i.on}"><span class="vg-tile-ic">${icon(i.ic, 18)}</span><span class="vg-tile-txt"><b>${esc(i.name)}</b><span>${esc(i.hint)}</span></span></button>`;
    const hit = i => (i.name + " " + i.hint).toLowerCase().includes(q);
    $$(".vg-ppanel").forEach(x => x.hidden = !!q || x.dataset.ppanel !== pickTab);
    $(".vg-picker-tiles").innerHTML = q
      ? tabs.map(([t, name]) => { const xs = items.filter(i => i.tab === t && hit(i)); return xs.length ? `<div class="vg-list-h">${name}</div><div class="vg-tiles">${xs.map(tile).join("")}</div>` : ""; }).join("") || emptyNext(`No view matches “${esc(q)}”.`, "search:" + q)
      : pickTab === "scenes" ? viewGroups(items.filter(i => i.tab === "scenes")).map(([name, xs]) => `<div class="vg-list-h">${name}</div><div class="vg-tiles">${xs.map(tile).join("")}</div>`).join("")
      : items.some(i => i.tab === pickTab) ? `${pickTab === "style" ? `<div class="vg-list-h">Styles</div>` : ""}<div class="vg-tiles">${items.filter(i => i.tab === pickTab).map(tile).join("")}</div>` : "";
    $$(".vg-picker-tab").forEach(b => b.onclick = () => { pickTab = b.dataset.tab; $(".vg-picker-q").value = ""; renderPicker(); });
    wireNext($(".vg-picker-tiles"));
    $$(".vg-picker-body .vg-tile").forEach(b => b.onclick = () => { const it = items.find(i => i.tab === b.dataset.tab && i.k === b.dataset.k); pickTab = it.tab; closeMenu(); it.run(); });
  }
  function openPicker(tab) {
    const p = $(".vg-picker"), b = $(".vg-pickbtn");
    pickTab = tab || (lensKey ? "lenses" : CORE_VIEWS.has(st.view) ? "views" : "scenes");
    $(".vg-picker-q").value = ""; renderPicker();
    $(".vg-picker-tools").innerHTML = tools().map(([c, ic, name]) => `<button class="vg-btn" data-tool="${c}">${icon(ic, 14)} ${name}</button>`).join("");
    $$(".vg-picker-tools [data-tool]").forEach(x => x.onclick = () => { closeMenu(); runTool(x.dataset.tool); });
    root.classList.toggle("vg-pick-sheet", sheetMode());
    p.hidden = false; $(".vg-picker-scrim").hidden = false; b.setAttribute("aria-expanded", "true");
    if (sheetMode()) { p.style.left = ""; p.style.top = ""; }
    else { const r = b.getBoundingClientRect(), op = (p.offsetParent || root).getBoundingClientRect();   // under the button, kept inside the pane
      p.style.left = Math.max(8, Math.min(r.left - op.left, op.width - p.offsetWidth - 8)) + "px"; p.style.top = (r.bottom - op.top + 6) + "px"; }
    const f = p.querySelector('.vg-tile[aria-pressed="true"]') || p.querySelector(".vg-picker-tab[aria-selected=\"true\"]") || p.querySelector(".vg-tile"); if (f) f.focus({ preventScroll: true });
  }
  function syncMapsBtn(view) {   // the Views button shows where you are
    syncAngleBtn();
    const g = GRAPH_INFO[view]; if (!$(".vg-pickbtn")) return;
    $(".vg-pickname").textContent = MAPS[view] || (g ? g[1] : view);
    $(".vg-pickicon").innerHTML = icon(MAPS[view] ? MAP_INFO[view][0] : g ? g[0] : "layers", 16);
  }
  function closeMenu() {
    const p = $(".vg-picker"); if (!p || p.hidden) return;
    p.hidden = true; $(".vg-picker-scrim").hidden = true; $(".vg-pickbtn").setAttribute("aria-expanded", "false");
  }
  $(".vg-pickbtn").onclick = e => { e.stopPropagation(); const open = $(".vg-picker").hidden; closeMenu(); if (open) openPicker(); };
  $(".vg-picker-x").onclick = () => closeMenu();
  $(".vg-picker-scrim").onclick = () => closeMenu();
  $(".vg-picker-q").oninput = () => renderPicker();
  $(".vg-picker").onkeydown = e => {   // arrows walk the tiles; Enter in the filter takes the first match
    const tiles = [...$$(".vg-picker-body .vg-tile")], i = tiles.indexOf(document.activeElement);
    if (e.key === "Enter" && e.target.classList.contains("vg-picker-q") && tiles[0]) { e.preventDefault(); tiles[0].click(); return; }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step && i >= 0) { tiles[(i + step + tiles.length) % tiles.length].focus(); e.preventDefault(); e.stopPropagation(); }
  };
  $(".vg-picker").addEventListener("click", e => e.stopPropagation());   // tabs re-render under the click: it must not read as "outside"
  root.addEventListener("click", e => { if (!e.target.closest(".vg-menuwrap")) { closeMenu(); closeTools(); } });

  // ---------------------------------------------------------------- views + controls
  function setView(view) {
    if (view === st.view) return;
    const was = st.view;
    st.recent = [view, ...(st.recent || []).filter(v => v !== view)].slice(0, 4);   // the picker's Recent row
    cam.turn = 0;   // only 2D turns (fit decides); every other view draws upright
    if (was !== "neural" && was !== "cosmos") keepLayout();   // remember the force layout we're leaving
    if (was === "2d") geoCache = new Map(nodes.map(n => [n.id, [n.x, n.y]]));   // the map views keep this geography
    st.view = view;
    syncMapsBtn(view); syncLayoutBtns();
    root.classList.toggle("is-neural", view === "neural");
    root.classList.toggle("is-cosmos", view === "cosmos");
    setMissionsShown(missionsPref != null ? missionsPref : view === "cosmos");   // the cosmos opens with them; elsewhere on request
    if (view !== "cosmos" && st.paused) setPaused(false);
    if (view !== "cosmos") { st.placing = null; root.classList.remove("is-placing"); if (st.body) { st.body = null; $(".vg-inspector").hidden = true; root.classList.remove("has-inspector"); } }
    root.dataset.vision = view === "neural" ? st.vision : "";
    root.classList.toggle("is-map", !!MAPS[view]); root.dataset.map = MAPS[view] ? view : "";
    if (MAPS[view]) {
      st.three = false; cv.style.cursor = "default"; cam.spin = null;
      applyMapLayout(true);
      animateTo({ cx: 0, cy: 0, cz: 0, yaw: 0, pitch: 0 }, 600);
      fitted = false; setTimeout(() => { fitted = true; fit(mapFitPred(), 700); }, 1000);
      toast(SCENES[view] ? SCENES[view].toast : { subway: "Subway — each topic is a line; black-ringed stations connect topics", topo: "Terrain — height is how much you rely on notes; valleys are gaps, fog is quiet ground",
        city: "City — height is how relied-on a note is, lit windows are recent activity, grey towers are stale, cranes are new, red beacons have open tasks; each district's town hall is its map",
        garden: "Garden — notes grow seed → seedling → budding → evergreen; wilting is stale, flowers are recent, drops are open tasks, weeds are orphans",
        palace: "Memory palace — topics are rooms, doors are links (wider = more), red bricked doorways are gaps, the gold plaque is the room's map",
        weather: "Weather — L is a topic busier than usual in your dailies, H a quiet one; storms are this week's bursts, fronts join topics that come up together",
        ships: "Shipping lanes — topics are islands, links are lanes (more ships = more links), fog is a gap nobody has charted",
        rings: "Tree rings — one trunk per topic, a ring per month since its first note; wide rings were busy months, dark scars incidents",
        sky: "Sky chart — each topic a constellation through its most relied-on notes; rising stars twinkle, fading ones glow red",
        realm: "Realm — kingdoms are topics, castles their maps, mountains the notes you rely on, forests stale ground; dragons guard unlinked notes",
        foodweb: "Food web — producers (relied on, rarely link out) at the bottom, logs and plans at the top; red rings are relied-on notes gone stale",
        lineage: "Lineage — time runs left to right, a lane per topic; each curve joins a note to the one it grew from. Orange curves crossed topics",
        ripples: "Click depth — rings count clicks from your maps; the red belt is notes no link reaches. Select a note to centre on it",
        alchemy: "Alchemy — each topic is a flask, its notes in rings from raw lead (outside) to gold (centre). Sparks run between notes that could react; the bar above runs one reaction at a time",
        clock: "Heat clock — when each topic comes up in your dailies, by weekday and by month",
        radar: "Radar — notes with open tasks, nearer the centre the longer their oldest task has waited. Click a blip to tick tasks off" }[view]);
    } else if (view === "neural") {
      st.three = true; cv.style.cursor = "grab";
      if (was === "2d") nodes.forEach(n => { n.z = n.z0 * 0.6; });
      brainLayout(true);
      animateTo({ k: Math.min(cam.k, 1), tx: 0, ty: 0, cx: 0, cy: 0, cz: 0, pitch: -0.25 }, 1400);
      fitted = false; setTimeout(() => { fitted = true; fit(n => !special(n), 900); }, 1500);
      toast("Neural view — lobes are topics, the core holds your bridge notes");
    } else {
      st.three = view === "3d"; cv.style.cursor = st.three ? "grab" : "default";
      const L = layouts[mode()], known = Object.keys(L).length > nodes.length * 0.3;
      if (was === "neural" || MAPS[was] || (was === "cosmos" && view !== "cosmos")) {   // morph back to the remembered map
        const spot = n => L[n.id] || [...nb[n.id]].map(id => L[id]).find(Boolean) || (n.ghost && n.from.map(id => L[id]).find(Boolean)) || (n.person && links.filter(l => l.kind === "person" && l.s === n).map(l => L[l.t.id]).find(Boolean));
        morphTo(n => { const q = spot(n), j = L[n.id] ? 0 : (hash(n.id) % 41) - 20; return q ? [q[0] + j, q[1] + j * 0.7, st.three ? (q[2] ?? n.z0 * 0.6) : 0] : [n.x * 0.5, n.y * 0.5, st.three ? n.z : 0]; }, 1200);
        animateTo({ cx: 0, cy: 0, cz: 0 }, 900);
        fitted = false; setTimeout(() => { fitted = true; fit(null, 700); alpha = known ? (active.some(n => !L[n.id]) ? 0.3 : 0.04) : 0.6; }, 1250);
      } else {
        const ok = applyLayout();
        if (!ok) nodes.forEach(n => { n.z = st.three ? n.z0 * 0.6 : 0; n.vz = 0; });
        alpha = Math.max(alpha, ok ? 0.05 : 0.6); fitted = false;
      }
      if (view === "3d" && was === "2d") toast("3D — drag to orbit, Shift-drag to pan");
      if (view === "cosmos") {
        if (!cos.bodies.length) seedCosmos();
        cosmosCapture(); updateGame(false); alpha = 0.7; cam.cx = cam.cy = cam.cz = 0;
        fitted = false; setTimeout(() => { fitted = true; fit(n => !n.ghost && !n.isolated, 900); }, 1600);
        toast("Cosmos — your maps are stars; drop bodies from the dock to reorganise the graph");
      }
    }
    rebuild(false); renderLegend(); renderHud(); persistSoon(); renderToday(); syncCycle();
    if (triage && view !== "radar") stopTriage();
    if (opts.onViewChange) opts.onViewChange(view);
  }
  $$(".vg-visbtn").forEach(b => b.onclick = () => {
    st.vision = b.dataset.vision; root.dataset.vision = st.vision;
    $$(".vg-visbtn").forEach(x => x.setAttribute("aria-pressed", x === b));
    renderLegend(); renderHud(); dirty = true; kick(); persistSoon();
  });
  function setLayer(k, on, silent) {
    st.layers[k] = on; const cb = $(`.vg-l-${k}`); if (cb) cb.checked = on;
    if (!silent) { rebuild(true); persistSoon(); }
  }
  ["wanted", "people", "tasks", "mocs"].forEach(k => { $(`.vg-l-${k}`).onchange = e => setLayer(k, e.target.checked); });
  $(".vg-zoomin").onclick = () => zoomBy(1.3);
  $(".vg-zoomout").onclick = () => zoomBy(1 / 1.3);
  $(".vg-fit").onclick = () => fit(neural() ? n => !special(n) : null);
  $(".vg-gaps").onchange = e => { st.gaps = e.target.checked; rebuild(false); };
  $(".vg-isolated").onchange = e => { st.isolated = e.target.checked; rebuild(true); };
  $(".vg-cohesion").onchange = e => { st.cohesion = e.target.checked; rebuild(true); };
  $(".vg-leaves").onchange = e => { st.leaves = e.target.checked; rebuild(true); };
  $(".vg-size").onchange = e => { st.sizeBy = e.target.value; rebuild(false); };
  $(".vg-color").onchange = e => { st.colorBy = e.target.value; rebuild(false); };
  $(".vg-hide").oninput = e => {
    const k = +e.target.value; $(".vg-hideN").textContent = k;
    st.hidden = new Set(ranked.slice(0, k));
    if (!k && layoutClean() && !neural() && applyLayout()) { rebuild(false); alpha = 0.05; } else rebuild(true);   // back to the familiar map
    hideStats();
  };
  // Randomize / Reset layout (sidebar and the Views menu's tools): one pair of actions for every view but Cosmos,
  // whose bodies you place yourself
  const canReset = () => !!layoutSeeds[st.view] || ((st.view === "2d" || st.view === "3d") && !!layoutBackup[mode()]);
  function syncLayoutBtns() {
    $$(".vg-randlayout").forEach(b => b.hidden = isCosmos());
    $$(".vg-resetlayout").forEach(b => b.hidden = !canReset());
  }
  function randomizeLayout() {
    if (isCosmos()) return;
    const v = st.view;
    if (v === "2d" || v === "3d") {
      if (!layoutBackup[mode()]) layoutBackup[mode()] = Object.fromEntries(nodes.map(n => [n.id, st.three ? [r1(n.x), r1(n.y), r1(n.z)] : [r1(n.x), r1(n.y)]]));
      layoutSeeds[v] = 1 + Math.floor(Math.random() * 1e9);
      layouts[mode()] = {};
      nodes.forEach(n => { const h = seededHash(n.id); n.x = (h % 400) - 200; n.y = ((h >>> 9) % 400) - 200; n.z = st.three ? n.z0 * 0.6 : 0; n.vx = n.vy = n.vz = 0; });
      alpha = 1; fitted = false; rebuild(false);
    } else {
      // map views place notes by topic order: a seed that gives the same order would change nothing, so roll again
      const order = () => topicOrder().map(c => c.id).join(","), was = order();
      for (let i = 0; i < 24; i++) { layoutSeeds[v] = 1 + Math.floor(Math.random() * 1e9); if (DATA.clusters.length < 2 || order() !== was) break; }
      if (neural()) brainLayout(true); else applyMapLayout(true);
    }
    syncLayoutBtns(); persistSoon(); toast("Layout randomized");
  }
  function resetLayout() {
    if (!canReset()) return;
    const v = st.view;
    delete layoutSeeds[v];
    if (v === "2d" || v === "3d") {
      const back = layoutBackup[mode()]; delete layoutBackup[mode()];
      layouts[mode()] = back || {};
      if (back && applyLayout()) { rebuild(false); alpha = 0.05; } else { alpha = 1; rebuild(false); }
      fitted = false;
    } else if (neural()) brainLayout(true);
    else applyMapLayout(true);
    syncLayoutBtns(); persistSoon(); toast("Layout reset");
  }
  $$(".vg-randlayout").forEach(b => b.onclick = randomizeLayout);
  $$(".vg-resetlayout").forEach(b => b.onclick = resetLayout);
  $(".vg-toggle").onclick = () => {
    if (narrow()) root.classList.toggle("vg-side-open");
    else { root.classList.toggle("vg-side-hidden"); persistSoon(); }
  };
  $(".vg-side").addEventListener("change", persistSoon);
  $$(".vg-depthseg .vg-segbtn").forEach(b => b.onclick = () => {
    $$(".vg-depthseg .vg-segbtn").forEach(x => x.setAttribute("aria-pressed", x === b));
    if (st.focus) enterFocus(st.focus, +b.dataset.depth, true);
  });

  // ---------------------------------------------------------------- remembered view + layout
  // opts.store = { load() -> saved | null, save(saved) }. Positions are kept per mode (2D/3D) and only
  // from the unfiltered graph, so focus mode or hidden hubs never overwrite the familiar map.
  const layouts = { "2d": {}, "3d": {} };
  const mode = () => (st.three ? "3d" : "2d");
  const layoutClean = () => !isCosmos() && !mapView() && !st.focusDist && !st.hidden.size && !st.leaves && !st.isolated && !st.hiddenClusters.size
    && !st.layers.people && !st.layers.wanted && !neural() && !morph;
  const r1 = v => Math.round(v * 10) / 10;
  function keepLayout() {
    if (!layoutClean()) return;
    const L = layouts[mode()];
    active.forEach(n => L[n.id] = st.three ? [r1(n.x), r1(n.y), r1(n.z)] : [r1(n.x), r1(n.y)]);
  }
  function applyLayout() {
    const L = layouts[mode()]; let known = 0;
    for (const n of nodes) {
      let p = L[n.id];
      if (!p) {   // new note: start next to a neighbour that has a place
        const m = [...nb[n.id]].find(id => L[id]) || (n.ghost && n.from.find(id => L[id]));
        if (m) p = L[m].map((v, i) => i < 2 ? v + (hash(n.id) % 21) - 10 : v);
      } else known++;
      if (p) { n.x = p[0]; n.y = p[1]; n.z = st.three ? (p[2] ?? n.z0 * 0.6) : 0; n.vx = n.vy = n.vz = 0; }
    }
    return known >= nodes.filter(visible).length * 0.5;
  }
  function persistNow() {
    if (destroyed) return;   // a closed graph never writes: its successor owns the state now
    if (!opts.store || opts.compact) return;
    keepLayout();
    try {
      opts.store.save({
        v: 1, layouts, layoutSeeds, layoutBackup,
        view: { view: st.view, three: st.three, angles: st.angles, vision: st.vision, sizeBy: st.sizeBy, colorBy: st.colorBy, gaps: st.gaps, preset: st.preset, tab: st.tab,
                cohesion: st.cohesion, layers: st.layers, recent: st.recent, sideHidden: root.classList.contains("vg-side-hidden"), hiddenClusters: [...st.hiddenClusters] },
        saved: savedViews, review, cosmos: cos, toured: tourSeen,
      });
      if (opts.sharedStore) opts.sharedStore.save({ v: 1, saved: savedViews, review, cosmos: cos, pending: [] });   // synced across devices with the vault
    } catch (e) { /* storage full or unavailable: the view just won't be remembered */ }
  }
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 800); }
  function restoreSaved() {
    let saved = null;
    try { saved = opts.store && opts.store.load(); } catch (e) { saved = null; }
    if (!saved || saved.v !== 1) return false;
    Object.assign(layouts["2d"], (saved.layouts || {})["2d"]); Object.assign(layouts["3d"], (saved.layouts || {})["3d"]);
    layoutSeeds = saved.layoutSeeds || {}; layoutBackup = saved.layoutBackup || {};
    const v = saved.view || {};
    const view = v.view || (v.three ? "3d" : "2d");
    if (view !== "2d" && !MAPS[view]) { st.three = true; cv.style.cursor = "grab"; }
    if (v.angles && typeof v.angles === "object") st.angles = { ...v.angles };
    if (v.vision) { st.vision = v.vision; $$(".vg-visbtn").forEach(x => x.setAttribute("aria-pressed", x.dataset.vision === v.vision)); }
    if (v.sizeBy && $(`.vg-size option[value="${v.sizeBy}"]:not([disabled])`)) { st.sizeBy = v.sizeBy; $(".vg-size").value = v.sizeBy; }
    if (v.colorBy && $(`.vg-color option[value="${v.colorBy}"]:not([disabled])`)) { st.colorBy = v.colorBy; $(".vg-color").value = v.colorBy; }
    if (v.gaps === false) { st.gaps = false; $(".vg-gaps").checked = false; }
    if (v.cohesion === false) { st.cohesion = false; $(".vg-cohesion").checked = false; }
    if (Array.isArray(v.recent)) st.recent = v.recent;
    if (v.layers) Object.entries(v.layers).forEach(([k, on]) => k in st.layers && setLayer(k, !!on, true));
    if (v.preset && PRESETS[v.preset]) { st.preset = v.preset; }
    if (v.sideHidden) root.classList.add("vg-side-hidden");
    (v.hiddenClusters || []).forEach(c => clusterById[c] && st.hiddenClusters.add(c));
    if (v.tab === "insights" || v.tab === "clusters") setTab(v.tab);
    if (Array.isArray(saved.saved)) savedViews = saved.saved;
    tourSeen = !!saved.toured;
    if (saved.review && saved.review.skipped) review = saved.review;
    if (saved.cosmos && Array.isArray(saved.cosmos.bodies)) { cos = { ...cos, ...saved.cosmos, auto: { ...cos.auto, ...(saved.cosmos.auto || {}) } };
      $$(".vg-autobtn").forEach(b => b.setAttribute("aria-pressed", cos.auto[b.dataset.auto] !== false)); }
    const ok = applyLayout();
    st.view = view;
    syncMapsBtn(view); syncLayoutBtns();
    if (view === "neural") { root.classList.add("is-neural"); root.dataset.vision = st.vision; }
    if (view === "cosmos") { st.three = false; root.classList.add("is-cosmos"); }
    // the same markers setView sets: map-only controls (time bar, floors, legend) key off them
    root.classList.toggle("is-map", !!MAPS[view]); root.dataset.map = MAPS[view] ? view : "";
    setMissionsShown(view === "cosmos");
    return ok;
  }

  // ---------------------------------------------------------------- start
  renderInsights(); renderOverlays();
  // Small panes (local graph, home card, embeds) don't keep a layout of their own: they borrow the main
  // graph's saved one, so opening them skips the ~0.2 s physics pre-settle that made them stutter.
  const seeded = () => { try { const s = opts.layoutSeed && opts.layoutSeed(); if (!s) return false; Object.assign(layouts["2d"], s["2d"] || {}); Object.assign(layouts["3d"], s["3d"] || {}); return applyLayout(); } catch (e) { return false; } };
  // Panes that don't save their own state can still open straight into a view (no 2D layout first, then a switch)
  const iv = !opts.store && opts.initialView;
  if (iv === "neural") { st.view = "neural"; st.three = true; root.classList.add("is-neural"); root.dataset.vision = st.vision; }
  else if (iv && MAPS[iv]) { st.view = iv; st.three = false; root.classList.add("is-map"); root.dataset.map = iv; }
  else if (iv === "3d") { st.view = "3d"; st.three = true; cv.style.cursor = "grab"; }
  if (iv) syncMapsBtn(st.view);
  const restored = opts.compact ? (neural() ? false : seeded()) : restoreSaved();
  renderClusters(""); renderSaved(); renderTodayList(); renderToday();
  rebuild(true);
  if (mapView()) alpha = 0;   // rebuild() above laid it out
  else if (neural()) { brainLayout(false); active.forEach(n => { n.x = n.bx; n.y = n.by; n.z = n.bz; }); alpha = 0; }
  else if (isCosmos()) { if (!cos.bodies.length) seedCosmos(); cosmosCapture(); alpha = 0.6; }
  else if (restored) alpha = 0.05;   // known layout: settle gently instead of re-exploding
  else for (let i = 0; i < 120 && alpha > 0.005; i++) tick();   // pre-settle so the first frame isn't a hairball
  // Today's picks and achievements take ~85 ms to work out: do it once the graph is on screen, not during the opening zoom
  let gameTimer = 0;
  function updateGameSoon() {
    if (opts.compact || gameTimer) return;
    const run = () => { gameTimer = 0; if (!destroyed) updateGame(false); };
    gameTimer = window.requestIdleCallback ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 900);
  }
  updateGameSoon();
  setTimeout(() => { if (!destroyed) { renderToday(); syncCycle(); } }, 400);
  if (!opts.compact && opts.store && !tourSeen) setTimeout(() => { if (!destroyed && W) startTour(); }, 1800);   // once, on first open
  if (opts.sharedStore && !opts.compact) opts.sharedStore.load().then(sh => {   // the vault copy wins: it's what other devices wrote
    if (!sh || sh.v !== 1 || destroyed) return;
    if (Array.isArray(sh.saved)) savedViews = sh.saved;
    if (sh.review && sh.review.skipped) review = sh.review;
    if (sh.cosmos && Array.isArray(sh.cosmos.bodies)) cos = { ...cos, ...sh.cosmos, auto: { ...cos.auto, ...(sh.cosmos.auto || {}) } };
    (sh.pending || []).forEach(text => logDiscovery(text));   // actions from the sidebar: award them now
    if ((sh.pending || []).length) persistNow();
    renderSaved(); renderTodayList(); if (isCosmos()) cosmosCapture(); updateGameSoon(); dirty = true; kick();
  });

  return {
    focusNote(path) { if (byId[path]) reveal(path); },
    // camera + selection, so the plugin can redraw with fresh vault data without losing your place
    viewport() { return { cam: { k: cam.k, tx: cam.tx, ty: cam.ty, yaw: cam.yaw, pitch: cam.pitch, cx: cam.cx, cy: cam.cy, cz: cam.cz }, moved: !!cam.userMoved, selected: st.selected }; },
    restoreViewport(v) {
      if (!v) return;
      Object.assign(cam, v.cam || {});
      cam.userMoved = v.moved; fitted = true;   // don't auto-fit over the restored camera
      if (v.selected && byId[v.selected]) select(v.selected);
      dirty = true; kick();
    },
    record(text) { logDiscovery(text); },
    hideGameItem,   // the sidebar's "Not for me" on a Today item   // actions taken elsewhere (sidebar) count toward XP and quests
    // in-note embeds: show only some clusters (a MOC's topics), or switch view
    showClusters(ids) {
      st.hiddenClusters = new Set([-1, ...DATA.clusters.map(c => c.id).filter(c => !ids.includes(c))]);
      st.isolated = false; fitted = true; rebuild(true);
      setTimeout(() => fit(n => ids.includes(n.cluster), 300), 400);
      setTimeout(() => { if (!cam.userMoved) fit(n => ids.includes(n.cluster), 600); }, 2200);   // reframe once the layout settles
    },
    setView(v) { if (["2d", "3d", "neural", "cosmos"].includes(v) || MAPS[v]) setView(v); },
    // local-graph pane: show one note's neighbourhood, following the active file
    setLocal(path, depth) {
      if (!byId[path]) { st.focus = null; st.focusDist = null; st.selected = null; rebuild(false); return false; }
      enterFocus(path, depth || +($('.vg-depthseg [aria-pressed="true"]') || { dataset: { depth: 1 } }).dataset.depth, true);
      return true;
    },
    applyLive,
    hasView: v => !!(GRAPH_INFO[v] || MAPS[v]),   // a scene from a note exists once its block is in the state
    async snapshot() { const blob = await new Promise(res => cv.toBlob(res, "image/png")); return blob.arrayBuffer(); },   // the canvas as PNG (State of the vault)
    _debug: { drawNow() { if (!W) return null; const t0 = performance.now(); draw(performance.now()); dirty = false; return performance.now() - t0; },   // tests: a frame now, its ms
      views: () => [...Object.keys(GRAPH_INFO), ...Object.keys(MAPS)], lenses: () => Object.keys(LENSES), openLens, st, cam, active: () => active, P, alpha: () => alpha, layouts, setView, drawMs: () => drawMs, maps: () => mapCache, cos: () => cos, nodes, nb, replay: () => replay, visible, rules: VGRules },
    destroy() { persistNow(); destroyed = true; clearTimeout(persistTimer); clearInterval(timePlay); timePlay = 0;
      if (RM && RM.removeEventListener) RM.removeEventListener("change", onReduced);
      cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect(); root.innerHTML = ""; root.classList.remove("vg-root", "has-inspector", "vg-side-hidden", "vg-side-open", "is-neural", "is-compact", "is-mobile"); },
  };
}
