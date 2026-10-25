  // ---------------------------------------------------------------- tabs + panels
  function setTab(name) {
    st.tab = name;
    $$(".vg-tab").forEach(t => { const on = t.dataset.tab === name; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; });
    $$(".vg-panel").forEach(p => p.hidden = p.dataset.panel !== name);
    persistSoon();
  }
  $$(".vg-tab").forEach((t, i, all) => {
    t.onclick = () => setTab(t.dataset.tab);
    t.onkeydown = e => {   // arrow keys move between tabs (WAI-ARIA tabs pattern)
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const next = all[(i + d + all.length) % all.length]; next.focus(); setTab(next.dataset.tab); e.preventDefault();
    };
  });
  const dotOf = id => byId[id].person ? css("--vg-person") : byId[id].ghost ? "transparent" : colorOf(byId[id].cluster);
  const noteRow = (id, extra, cls) => `<button class="vg-item ${cls || ""}" data-id="${esc(id)}"><span class="vg-dot ${byId[id].ghost ? "is-ghost" : ""}" style="background:${dotOf(id)}"></span>` +
    `<span class="vg-item-main">${label(id)}${extra ? `<span class="vg-item-sub">${extra}</span>` : ""}</span></button>`;
  const card = (title, hint, body) => `<div class="vg-card"><div class="vg-card-h"><span>${title}</span>${hint ? `<span class="vg-muted vg-card-hint">${hint}</span>` : ""}</div>${body}</div>`;
  const gapRow = g => `<div class="vg-gaprow"><button class="vg-item vg-gap" data-a="${g.a}" data-b="${g.b}">
      <span class="vg-dots"><span class="vg-dot" style="background:${colorOf(g.a)}"></span><span class="vg-dot" style="background:${colorOf(g.b)}"></span></span>
      <span class="vg-item-main"><span>${esc(clusterName(g.a))} <span class="vg-muted">↔</span> ${esc(clusterName(g.b))}</span>
      <span class="vg-item-sub">${g.comentions} co-mentions · only ${plural(g.links, "link")}</span></span></button>
      ${opts.writeNote ? `<button class="vg-ibtn vg-bridgebtn" data-a="${g.a}" data-b="${g.b}" title="Draft a bridge note for this gap" aria-label="Draft bridge note">${icon("bridge", 15)}</button>` : ""}</div>`;
  function renderChanges() {
    const c = DATA.changes || {};
    if (!c.since) return card("Since last run", "", `<div class="vg-empty">First snapshot saved today.</div>`);
    const line = (n, text) => n ? `<li><b>${n}</b> ${text}</li>` : "";
    const pairName = p => p.split("|").map(id => byId[id] ? byId[id].name : id.split("/").pop().replace(/\.md$/, "")).join(" ↔ ");
    const body = `<ul class="vg-changes">
      ${c.linked_delta ? `<li><b>${c.linked_delta > 0 ? "+" : ""}${c.linked_delta}</b> linked notes</li>` : ""}
      ${line((c.acted || []).length, "suggestions acted on")}${line((c.gaps_closed || []).length, "gaps closed")}${line((c.gaps_new || []).length, "new gaps")}
      ${line((c.new_clusters || []).length, `new topics: ${esc((c.new_clusters || []).join(", "))}`)}${line((c.new_notes || []).length, "new notes")}
      ${line((c.active || []).length, "notes became active")}${line((c.quiet || []).length, "notes went quiet")}</ul>` +
      ((c.acted || []).length ? `<div class="vg-list-h">Acted on</div>` + c.acted.slice(0, 4).map(p => `<div class="vg-item-sub vg-pad">${esc(pairName(p))}</div>`).join("") : "") +
      ((c.quiet || []).length ? `<div class="vg-list-h">Went quiet</div>` + c.quiet.filter(id => byId[id]).slice(0, 4).map(id => noteRow(id)).join("") : "");
    return card(`Since ${esc(c.since)}`, "what changed since the last analysis", body);
  }
  // ---- Today: the one list of next steps (VGRules.todayList; it replaced the review queue, the daily quests and the
  // missions). Today's three are its first three, kept for the day (the XP layer ticks them off); "Next up" is the
  // rest. The Insights card and the game panel draw the same rows; every button is VGActions.runToday.
  let review = { skipped: {} };
  const todayData = () => ({ ...DATA, links, mocs, wanted: ghosts.filter(g => !g.created).map(g => ({ id: g.id, name: g.name, refs: g.from, creatable: g.creatable })) });
  const todayItems = () => VGRules.todayList(todayData(), { review, hidden: cos.hidden, today: today(), skipDays: UI.time.skipDays });
  function pinReview(id) { review.pinned = [...new Set([...(review.pinned || []), id])]; persistSoon(); renderTodayList(); toast(`${byId[id].name} added to Today`, "ok"); }
  function todayRow(it, pick) {
    const done = !!(pick && pick.done), can = !done && VGActions.todayWhen(it, actionCtx());
    return `<div class="vg-td ${done ? "is-done" : ""}" data-tkey="${esc(it.key)}"><div class="vg-td-main"><b class="vg-rv-title">${pick ? (done ? "✓ " : "○ ") : ""}${esc(it.title)}</b>${it.why && !done ? `<span class="vg-item-sub">${esc(it.why)}</span>` : ""}</div>` +
      (done ? "" : `<div class="vg-ins-actions vg-wrap">${can ? `<button class="vg-btn vg-btn-sm vg-btn-primary" data-tdo>${esc(VGActions.todayLabel(it))}</button>` : ""}<button class="vg-btn vg-btn-sm" data-tshow>Show</button>` +
        `${it.kind === "link" && opts.dismissPair ? `<button class="vg-btn vg-btn-sm vg-btn-ghost" data-tno>Not related</button>` : ""}<button class="vg-btn vg-btn-sm vg-btn-ghost" data-tskip title="Hide for ${UI.time.skipDays} days">Skip</button></div>`) + `</div>`;
  }
  // today's three, then up to `more` next items
  function todayHtml(more) {
    ensureDaily();
    const picks = cos.daily.quests, keys = new Set(picks.map(q => q.key)), rest = todayItems().filter(it => !keys.has(it.key));
    const out = (picks.length ? `<div class="vg-list-h">Today's three <span class="vg-count">${picks.filter(q => q.done).length}/${picks.length}</span></div>` + picks.map(q => todayRow(q, q)).join("") : "")
      + (rest.length && more ? `<div class="vg-list-h">Next up <span class="vg-count">${rest.length}</span></div>` + rest.slice(0, more).map(it => todayRow(it)).join("") : "");
    return out || emptyNext("Nothing to do today.", "lens:write", "lens:blind");
  }
  // after an item's write: what this graph shows changes at once (the plugin's re-merge confirms it)
  function afterToday(it) {
    if (it.kind === "link") noteLinked(it.from, it.to);
    else if (it.kind === "map") listedOnMap(it.m, [it.id]);
    else if (it.kind === "write" && byId[it.id]) byId[it.id].created = true;
    else if (it.kind === "hub") { review.done = { ...(review.done || {}), [it.key]: today() }; review.pinned = (review.pinned || []).filter(x => x !== it.id); if (byId[it.id]) byId[it.id].age = 0; }
    updateGame(true);
  }
  function showToday(it) {
    const ids = (it.ids || []).filter(id => byId[id]); if (!ids.length) return;
    if (ids.length > 1) { setHighlight(new Set(ids), it.title); ids.forEach(id => { if (!baseVisible(byId[id])) reveal(id); }); select(ids[0]); fit(n => ids.includes(n.id)); } else reveal(ids[0]);
  }
  function skipToday(it) {
    review.skipped[it.key] = today();
    if (it.key.startsWith("pin|")) review.pinned = (review.pinned || []).filter(x => x !== it.id);
    if (cos.daily.quests.some(q => q.key === it.key)) { cos.daily.quests = cos.daily.quests.filter(q => q.key !== it.key); const next = nextPick(); if (next) cos.daily.quests.push(next); }
    persistSoon(); renderTodayList();
  }
  function wireToday(box) {
    const find = k => cos.daily.quests.find(q => q.key === k) || todayItems().find(it => it.key === k);
    box.querySelectorAll("[data-tkey]").forEach(row => { const it = find(row.dataset.tkey); if (!it) return; const q = sel => row.querySelector(sel);
      if (q("[data-tdo]")) q("[data-tdo]").onclick = async e => { e.stopPropagation(); const btn = e.currentTarget; btn.disabled = true;
        if (await VGActions.runToday(it, actionCtx(), e)) afterToday(it); else if (btn.isConnected) btn.disabled = false; };
      if (q("[data-tshow]")) q("[data-tshow]").onclick = e => { e.stopPropagation(); showToday(it); };
      if (q("[data-tno]")) q("[data-tno]").onclick = async e => { e.stopPropagation(); await actOnSuggestion("dismiss", it.a, it.b, e.currentTarget); updateGame(false); };
      if (q("[data-tskip]")) q("[data-tskip]").onclick = e => { e.stopPropagation(); skipToday(it); };
    });
    wireNext(box);
  }
  // the Insights card, and the game panel when it's open
  function renderTodayList() {
    const box = $(".vg-review");
    if (box) { box.innerHTML = card("Today", "one small improvement at a time", todayHtml(5)); wireToday(box); }
    const badge = $(".vg-reviewcount"); if (badge) { const n = (cos.daily ? cos.daily.quests.filter(q => !q.done).length : 0); badge.textContent = n; badge.parentElement.hidden = !n || opts.compact; }
    if (root.classList.contains("show-missions")) renderMissions();
  }

  // ---------------------------------------------------------------- saved views
  let savedViews = [];
  function snapshotView(name) {
    return { name, view: st.view, vision: st.vision, sizeBy: st.sizeBy, colorBy: st.colorBy, gaps: st.gaps, preset: st.preset,
      layers: { ...st.layers }, hiddenClusters: [...st.hiddenClusters], overlays: [...st.overlays], isolated: st.isolated,
      focus: st.focus, focusDepth: st.focusDepth, cam: Object.fromEntries(TWEEN_KEYS.map(k => [k, Math.round(cam[k] * 1000) / 1000])) };
  }
  function applySaved(v) {
    if (st.focus) exitFocus();
    if (st.view !== v.view) setView(v.view);
    st.sizeBy = v.sizeBy; st.colorBy = v.colorBy; st.gaps = v.gaps; st.isolated = !!v.isolated;
    $(".vg-size").value = st.sizeBy; $(".vg-color").value = st.colorBy; $(".vg-gaps").checked = st.gaps; $(".vg-isolated").checked = st.isolated;
    Object.entries(v.layers || {}).forEach(([k, on]) => k in st.layers && setLayer(k, on, true));
    st.hiddenClusters = new Set(v.hiddenClusters || []); st.overlays = new Set(v.overlays || []);
    if (v.vision) { st.vision = v.vision; root.dataset.vision = neural() ? v.vision : ""; $$(".vg-visbtn").forEach(x => x.setAttribute("aria-pressed", x.dataset.vision === v.vision)); }
    renderOverlays(); overlayList(); renderClusters($(".vg-cfilter").value); rebuild(true);
    if (v.focus && byId[v.focus]) enterFocus(v.focus, v.focusDepth);
    else setTimeout(() => animateTo(v.cam, 900), neural() ? 1500 : 300);
    toast(`View: ${v.name}`);
  }
  function renderSaved() {
    const box = $(".vg-saved");
    box.innerHTML = savedViews.length ? savedViews.map((v, i) => `<div class="vg-savedrow"><button class="vg-item" data-sv="${i}"><span class="vg-item-main"><b>${esc(v.name)}</b>
      <span class="vg-item-sub">${esc(v.view.toUpperCase())}${v.view === "neural" ? " · " + esc(v.vision) : ""}${v.focus && byId[v.focus] ? " · focus " + esc(byId[v.focus].name) : ""}${v.hiddenClusters.length ? ` · ${v.hiddenClusters.length} hidden` : ""}</span></span></button>
      <button class="vg-ibtn" data-svdel="${i}" aria-label="Delete ${esc(v.name)}" title="Delete">${icon("close", 14)}</button></div>`).join("")
      : `<div class="vg-muted vg-lead">Bookmark the camera, view and filters you're looking at — e.g. “AWS lobe, thermal”.</div>`;
    box.querySelectorAll("[data-sv]").forEach(b => b.onclick = () => applySaved(savedViews[+b.dataset.sv]));
    box.querySelectorAll("[data-svdel]").forEach(b => b.onclick = () => { savedViews.splice(+b.dataset.svdel, 1); renderSaved(); persistSoon(); });
  }
  $(".vg-savedform").onsubmit = e => {
    e.preventDefault();
    const input = $(".vg-savedname"), name = input.value.trim() || `View ${savedViews.length + 1}`;
    savedViews = savedViews.filter(v => v.name !== name).concat([snapshotView(name)]);
    input.value = ""; renderSaved(); persistSoon(); toast(`Saved “${name}”`, "ok");
  };

  // Maps: how well each MOC covers the topics it maps; topics with no map
  function renderMaps() {
    if (!mocs.length) return "";
    const rows = mocs.map(m => {
      const size = m.clusters.reduce((s, c) => s + (clusterById[c] ? clusterById[c].size : 0), 0);
      const miss = m.clusters.reduce((s, c) => s + (m.missing[c] || []).length, 0), pct = size ? Math.round(100 * (size - miss) / size) : 0;
      return { m, size, miss, pct };
    }).sort((a, b) => b.miss - a.miss);
    const unmapped = DATA.clusters.filter(c => !mocOf[c.id] && c.size >= 6);
    return card("Maps", "how much of each topic its MOC lists · click to light up what it misses",
      rows.map(({ m, size, miss, pct }) => `<button class="vg-item vg-maprow" data-moc="${esc(m.id)}"><span class="vg-hex" style="--c:${colorOf(m.clusters[0])}"></span>
        <span class="vg-item-main"><span><b>${esc(m.title)}</b></span>
        <span class="vg-bar"><i style="width:${Math.max(3, pct)}%;background:${colorOf(m.clusters[0])}"></i></span>
        <span class="vg-item-sub">${pct}% of ${size} · ${miss ? `${miss} missing` : "complete"}${m.clusters.length > 1 ? ` · ${m.clusters.length} topics` : ""}</span></span></button>`).join("") +
      (unmapped.length ? `<div class="vg-list-h">No map yet</div>` + unmapped.map(c => `<button class="vg-item vg-unmapped" data-c="${c.id}"><span class="vg-dot" style="background:${colorOf(c.id)}"></span>
        <span class="vg-item-main"><span>${esc(c.name)}</span><span class="vg-item-sub">${plural(c.size, "note")}${opts.writeNote ? " · click the hub button in Clusters to create one" : ""}</span></span></button>`).join("") : ""));
  }
  function showMocMissing(id) {
    const m = mocs.find(x => x.id === id); if (!m) return;
    const miss = new Set(m.clusters.flatMap(c => m.missing[c] || []));
    if (byId[id] && !baseVisible(byId[id])) setLayer("mocs", true);
    focusClusters(m.clusters);
    setHighlight(new Set([...miss, id]), `${m.title} · ${miss.size} not in the map`);
    select(id);
  }
  function renderInsights() {
    const linked = ranked.length, iso = nodes.filter(n => n.isolated && !special(n)).length;
    // each count is a button that shows what it counts: the whole graph, the topics, the gaps, the unlinked notes
    const stat = (v, l, cls, go, title) => `<button class="vg-stat ${cls || ""}" data-stat="${go}" title="${title}"><b>${v}</b><span>${l}</span></button>`;
    const html =
      `<div class="vg-stats">${stat(linked, "linked notes", "", "all", "Fit the whole graph")}${stat(DATA.clusters.length, "topic clusters", "", "topics", "List the topics")}` +
      `${stat(DATA.gaps.length, "cluster gaps", DATA.gaps.length ? "is-accent" : "", "gaps", "Topic pairs that barely link")}${stat(iso, "unlinked notes", iso > linked * 0.25 ? "is-warn" : "", "unlinked", "Show the notes with no links")}</div>` +
      `<div class="vg-review"></div>` + renderChanges() + renderMaps() +
      card("Biggest gaps", opts.writeNote ? "related topics that barely link · draft a bridge note" : "related topics that barely link",
        DATA.gaps.slice(0, 5).map(gapRow).join("") || `<div class="vg-empty">No gaps found.</div>`) +
      card("Bridge notes", "hold topics together — keep them current",
        ranked.slice(0, 6).map(id => noteRow(id, `#${rankOf[id]} influence · ${esc(clusterName(byId[id].cluster))}`)).join("")) +
      (saidUnlinked.length ? card("Talked about, never linked", "named in dailies without a link",
        saidUnlinked.slice(0, 6).map(([id, n]) => noteRow(id, `${n} daily notes`)).join("")) : "") +
      (ghosts.length ? card("Notes to write", "linked from your notes but never created",
        ghosts.slice(0, 6).map(g => noteRow(g.id, `linked from ${plural(g.from.length, "note")}`)).join("")) : "") +
      (coolingHubs.length ? card("Cooling hubs", DATA.has_usage ? "influential, not opened or mentioned lately" : "influential, not mentioned lately",
        coolingHubs.slice(0, 6).map(n => noteRow(n.id, `#${rankOf[n.id]} influence · quiet ${DATA.recent_days}+ days`)).join("")) : "") +
      `<p class="vg-muted vg-foot">Data from ${esc(DATA.date)} · ${DATA.dailies_used || "?"} daily notes since ${esc(DATA.since || "the start")}</p>`;
    const panel = $('[data-panel="insights"]');
    panel.innerHTML = html;
    wire(panel);
    panel.querySelectorAll(".vg-gap").forEach(e => e.onclick = () => focusClusters([+e.dataset.a, +e.dataset.b]));
    const STAT_GO = {
      all: () => fit(),
      topics: () => setTab("clusters"),
      gaps: () => openLens("matrix"),
      unlinked: () => { const ids = new Set(nodes.filter(n => n.isolated && !special(n)).map(n => n.id)); if (!ids.size) return;
        st.isolated = true; $(".vg-isolated").checked = true; rebuild(true); setHighlight(ids, plural(ids.size, "unlinked note")); fit(n => ids.has(n.id), 400); },
    };
    panel.querySelectorAll("[data-stat]").forEach(b => b.onclick = () => { STAT_GO[b.dataset.stat](); closeDrawer(); });
    panel.querySelectorAll(".vg-maprow").forEach(e => e.onclick = () => showMocMissing(e.dataset.moc));
    renderTodayList();
    panel.querySelectorAll(".vg-unmapped").forEach(e => e.onclick = () => focusClusters([+e.dataset.c]));
    panel.querySelectorAll(".vg-bridgebtn").forEach(e => e.onclick = ev => { ev.stopPropagation(); writeBridge(+e.dataset.a, +e.dataset.b); });
  }
  function renderClusters(filter) {
    const q = (filter || "").toLowerCase(), max = Math.max(...DATA.clusters.map(c => c.size));
    $(".vg-clusters").innerHTML = DATA.clusters.filter(c => !q || [c.name, c.label || "", c.keywords || "", ...c.core].some(x => x.toLowerCase().includes(q)))
      .map(c => {
        const off = st.hiddenClusters.has(c.id), ms = nodes.filter(n => n.cluster === c.id);
        const healthy = ms.length ? Math.round(100 * ms.filter(n => n.words >= Q.stub_words && !staleFor(n, Q.stale_days) && n.broken === 0).length / ms.length) : 0;
        return `<div class="vg-cluster ${off ? "is-off" : ""}" data-c="${c.id}">
          <button class="vg-item vg-cl-main" data-c="${c.id}" title="Show this cluster">
            <span class="vg-dot" style="background:${colorOf(c.id)}"></span>
            <span class="vg-item-main"><span><b>${esc(clusterName(c.id))}</b> <span class="vg-muted">C${c.id}</span></span>
            <span class="vg-bar"><i style="width:${Math.max(4, 100 * c.size / max)}%;background:${colorOf(c.id)}"></i></span>
            <span class="vg-item-sub">${plural(c.size, "note")} · ${healthy}% healthy${c.keywords ? ` · <i>${esc(c.keywords)}</i>` : ""} · ${c.core.map(esc).join(", ")}</span></span></button>
          <div class="vg-cl-acts">
            ${opts.writeNote ? `<button class="vg-ibtn vg-cl-hub" data-c="${c.id}" title="Create or refresh a hub note for this cluster" aria-label="Hub note for ${esc(c.name)}">${icon("hub", 15)}</button>` : ""}
            <button class="vg-ibtn vg-cl-eye" data-c="${c.id}" aria-pressed="${!off}" aria-label="${off ? "Show" : "Hide"} ${esc(c.name)}" title="${off ? "Show" : "Hide"} cluster">${icon(off ? "eyeOff" : "eye", 15)}</button>
          </div>
        </div>`;
      }).join("") || `<div class="vg-empty">No clusters match.</div>`;
    $$(".vg-cl-main").forEach(e => e.onclick = () => focusClusters([+e.dataset.c]));
    $$(".vg-cl-hub").forEach(e => e.onclick = () => writeHub(+e.dataset.c));
    $$(".vg-cl-eye").forEach(e => e.onclick = () => {
      const c = +e.dataset.c;
      if (st.hiddenClusters.has(c)) st.hiddenClusters.delete(c); else st.hiddenClusters.add(c);
      renderClusters($(".vg-cfilter").value); rebuild(true); persistSoon();
    });
  }
  $(".vg-cfilter").oninput = e => renderClusters(e.target.value);
  function renderOverlays() {
    $(".vg-overlays").innerHTML = Object.entries(OVERLAYS).map(([k, o]) =>
      `<label class="vg-switch"><input type="checkbox" data-ov="${k}" ${st.overlays.has(k) ? "checked" : ""}><span class="vg-track" aria-hidden="true"></span>
       <span><span class="vg-sw-t"><b>${o.label}</b><span class="vg-count">${nodes.filter(o.test).length}</span></span><span class="vg-muted">${o.hint}</span></span></label>`).join("");
    $$("[data-ov]").forEach(cb => cb.onchange = () => {
      if (cb.checked) st.overlays.add(cb.dataset.ov); else st.overlays.delete(cb.dataset.ov);
      st.highlight = null; st.highlightLabel = null; select(null); overlayList(); renderStatus(); dirty = true; kick();
    });
    $(".vg-series").innerHTML = series.length ? card("Series", "dated notes that belong in a chain",
      series.map(s => {
        const gapsIn = s.notes.slice(1).filter((id, k) => !nb[id].has(s.notes[k])).length;
        return `<button class="vg-item vg-seriesrow" data-s="${s.i}"><span class="vg-item-main"><b>${esc(s.name)}</b>
          <span class="vg-item-sub">${plural(s.notes.length, "note")} · ${gapsIn ? `${gapsIn} not linked to the previous one` : "fully chained"}</span></span></button>`;
      }).join("")) : "";
    $$(".vg-seriesrow").forEach(b => b.onclick = () => {
      const s = series[+b.dataset.s];
      s.notes.forEach(id => { st.hidden.delete(id); });
      if (s.notes.some(id => byId[id].isolated)) { st.isolated = true; $(".vg-isolated").checked = true; }
      rebuild(true); setHighlight(new Set(s.notes), `series · ${s.name}`); select(null); setTimeout(() => fit(n => st.highlight && st.highlight.has(n.id)), 300);
    });
  }
  function overlayList() {
    const out = $(".vg-ovlist");
    if (!st.overlays.size) { out.innerHTML = ""; return; }
    const hits = nodes.filter(overlayHit).sort((a, b) => b.broken - a.broken || b.tasks - a.tasks || b.bc - a.bc);
    out.innerHTML = `<div class="vg-list-h">${plural(hits.length, "note")}</div>` +
      hits.slice(0, 40).map(n => noteRow(n.id, [n.broken && st.overlays.has("broken") ? `${n.broken} broken` : "", n.tasks && st.overlays.has("tasks") ? `${n.tasks} open` : "",
        st.overlays.has("stale") && staleFor(n, Q.stale_days) ? `${n.age} days` : "", n.folder].filter(Boolean).map(esc).join(" · "))).join("") +
      (hits.length > 40 ? `<div class="vg-empty">…and ${hits.length - 40} more</div>` : "");
    wire(out);
  }
  function hideStats() {
    const box = $(".vg-hidestat");
    if (!st.hidden.size) { box.textContent = "Removing the biggest hubs shows which topics only connect through them."; return; }
    const vis = active.filter(n => !n.isolated && !special(n)), ids = new Set(vis.map(n => n.id));
    const loose = vis.filter(n => ![...nb[n.id]].some(m => ids.has(m))).length;
    const seen = new Set(); let parts = 0;
    vis.forEach(n => {
      if (seen.has(n.id)) return; parts++;
      const stack = [n.id];
      while (stack.length) { const v = stack.pop(); if (seen.has(v)) continue; seen.add(v); nb[v].forEach(m => ids.has(m) && !seen.has(m) && stack.push(m)); }
    });
    box.innerHTML = `Without these, <b>${loose}</b> notes lose every link and the rest falls into <b>${parts - loose}</b> separate groups.`;
  }

  // ---------------------------------------------------------------- inspector
  function select(id) {
    if (id && id !== st.selected) startWave(id);
    st.selected = id; dirty = true; kick();
    if (!id && !st.highlight && st.autoPaused) setPaused(false);
    if (id) st.body = null;
    if (id) st.multi = null;
    const box = $(".vg-inspector");
    renderHud();
    if (st.view === "alchemy" || st.view === "ripples" || st.view === "lineage") renderToday();   // their bar is about the selected note
    if (!id || opts.compact) { if (!st.multi) { box.hidden = true; box.dataset.id = ""; root.classList.remove("has-inspector"); } return; }
    const n = byId[id];
    box.hidden = false; root.classList.add("has-inspector");
    if (n.ghost || n.person || n.moc) box.dataset.id = "";
    if (n.ghost) return inspectGhost(n, box);
    if (n.person) return inspectPerson(n, box);
    if (n.moc) return inspectMoc(n, box);
    const groups = {};
    nb[id].forEach(m => (groups[byId[m].cluster] = groups[byId[m].cluster] || []).push(m));
    const touched = Object.keys(groups).map(Number).filter(c => c !== n.cluster && c >= 0);
    const gaps = links.filter(l => (l.kind === "gap" || l.kind === "similar") && (l.s.id === id || l.t.id === id));
    const stat = (v, l) => `<div class="vg-kv"><b>${v}</b><span>${l}</span></div>`;
    const ser = seriesOf[id], people = peopleOf[id] || [];
    // redrawing the same note (an action published new state): keep the scroll, open groups and open task list
    const same = box.dataset.id === id, keepY = same ? box.scrollTop : 0, keepOpen = same ? [...box.querySelectorAll("details")].map(d => d.open) : null;
    box.dataset.id = id;
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head">
        <span class="vg-chip" style="--c:${colorOf(n.cluster)}">${esc(clusterTag(n.cluster))}</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button>
      </div>
      <h2 class="vg-ins-title">${esc(n.name)}</h2>
      <div class="vg-muted vg-ins-path">${esc(n.folder || "/")}</div>
      <div class="vg-ins-actions vg-wrap vg-noteacts"></div>
      <div class="vg-kvs">
        ${stat(nb[id].size, "links")}${stat(rankOf[id] ? "#" + rankOf[id] : "—", "influence")}
        ${stat(n.mentions, "daily mentions")}${stat(n.recent, `last ${DATA.recent_days} days`)}
        ${stat(n.tasks, "open tasks")}${DATA.has_usage ? stat(n.opens90, "opens · 90d") : stat(n.age + "d", n.edited ? `unchanged · since ${n.edited.slice(2)}` : "since edit")}
      </div>
      ${mapLine(id)}
      <div class="vg-ins-sec vg-needs" hidden><div class="vg-ins-h">Needs attention <span class="vg-count"></span></div><div class="vg-needs-rows"></div></div>
      ${n.tasks && opts.readTasks ? `<div class="vg-ins-sec"><div class="vg-ins-h">Open tasks <span class="vg-count">${n.tasks}</span><button class="vg-btn vg-btn-sm vg-taskload">Show</button></div><div class="vg-tasksbox"></div></div>` : ""}
      ${ser ? renderSeriesSection(id, ser) : ""}
      ${touched.length ? `<div class="vg-ins-sec"><div class="vg-ins-h">Bridges into</div>${touched.map(c => `<button class="vg-chip is-btn" data-c="${c}" style="--c:${colorOf(c)}">${esc(clusterName(c))}</button>`).join(" ")}</div>` : ""}
      ${gaps.length ? `<div class="vg-ins-sec"><div class="vg-ins-h">Suggested links <span class="vg-count">${gaps.length}</span></div>` + gaps.map(l => suggestionRow(id, l)).join("") + `</div>` : ""}
      ${people.length ? `<div class="vg-ins-sec"><div class="vg-ins-h">People <span class="vg-count">${people.length}</span></div>${people.map(p => noteRow(p)).join("")}</div>` : ""}
      <div class="vg-ins-sec"><div class="vg-ins-h">Linked notes <span class="vg-count">${nb[id].size}</span></div>
      ${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, ms]) =>
        `<details class="vg-group" ${ms.length <= 8 ? "open" : ""}><summary><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-count">${ms.length}</span></summary>` +
        ms.map(m => noteRow(m)).join("") + `</details>`).join("") || `<div class="vg-empty">No links to other knowledge notes.</div>`}</div>`;
    box.querySelector(".vg-ins-close").onclick = () => select(null);
    wireAddToMap(box);
    const tl = box.querySelector(".vg-taskload");
    if (tl) { tl.onclick = () => toggleTasks(id, box.querySelector(".vg-tasksbox"));
      if (st.view === "radar" || openTasks.has(id)) renderTasks(id, box.querySelector(".vg-tasksbox")).then(() => { if (same) box.scrollTop = keepY; }); }
    if (keepOpen) box.querySelectorAll("details").forEach((d, i) => { if (i < keepOpen.length) d.open = keepOpen[i]; });
    if (same) box.scrollTop = keepY;
    // Open and Focus as buttons, the rest behind "⋯" (the menu lens rows use); fixes sit beside their problems
    const INS_MAIN = ["open", "focus"], acts = box.querySelector(".vg-noteacts");
    noteActions(n, acts, INS_MAIN);
    if (VGActions.forNote(n, actionCtx(), null, { skip: ["fix"] }).some(a => !INS_MAIN.includes(a.key))) {
      const more = document.createElement("button"); more.className = "vg-btn vg-more"; more.textContent = "⋯ More"; more.title = "All actions for this note";
      more.onclick = e => { e.stopPropagation(); actionMenu(more, id, { skip: ["fix"], except: INS_MAIN, extra: true }); };
      acts.appendChild(more); }
    needsAttention(n, box.querySelector(".vg-needs"));
    box.querySelectorAll(".vg-chip.is-btn").forEach(b => b.onclick = () => focusClusters([n.cluster, +b.dataset.c].filter(c => c >= 0)));
    wire(box); wireSheet(box);
    box.querySelectorAll("[data-link]").forEach(b => b.onclick = e => { e.stopPropagation(); actOnSuggestion("link", id, b.dataset.link, b, b.dataset.why); });
    box.querySelectorAll("[data-dismiss]").forEach(b => b.onclick = e => { e.stopPropagation(); actOnSuggestion("dismiss", id, b.dataset.dismiss, b); });
  }
  // The note's actions, shared with every other surface (vault_graph_actions.js); this surface adds Focus, Path and Map
  function actionCtx() {
    return {
      api: opts, data: { mocs, quality: DATA.quality, said_unlinked: saidUnlinked },
      ask: (title, text, ok) => confirmBox(title, esc(text), ok),
      pick: (placeholder, filter) => new Promise(resolve => openPalette({ pick: resolve, placeholder, filter })),
      done: (msg, undo) => { logDiscovery(msg); toast(msg, "ok", undo); },
      fail: msg => toast(msg, "warn"),
      focus: id => enterFocus(id), path: id => openPalette({ pathFrom: id }),
      copy: id => copy(mdLink(id), `Copied ${mdLink(id)}`),
      icon: (el, name) => el.insertAdjacentHTML("afterbegin", icon(name, 14) + " "),
      extra: opts.writeNote ? [{ key: "nbmap", group: "main", icon: "file", label: () => "Map", title: () => "Write this neighbourhood as a Markdown map note",
        when: n => !n.ghost && !n.person, run: n => { writeNeighbourhoodMap(n.id); return null; } }] : [],
    };
  }
  function noteActions(n, box, only, o) {
    if (!box) return;
    box.innerHTML = "";
    const c = actionCtx();
    VGActions.render(box, VGActions.forNote(n, c, only, o), n, c, { btn: "vg-btn", primary: "vg-btn-primary", ghost: "vg-btn-ghost" });
  }
  // what the note needs, each problem beside the action that fixes it (VGActions.problems); hidden when nothing is wrong
  function needsAttention(n, host) {
    if (!host) return;
    const c = actionCtx(), list = VGActions.problems(n, c), rows = host.querySelector(".vg-needs-rows");
    host.hidden = !list.length; rows.innerHTML = "";
    host.querySelector(".vg-count").textContent = list.length;
    list.forEach(p => { const r = document.createElement("div"); r.className = "vg-need"; r.dataset.problem = p.key;
      const t = document.createElement("span"); t.textContent = p.text; r.appendChild(t);
      if (p.fix) VGActions.render(r, [p.fix], n, c, { btn: "vg-btn vg-btn-sm" });
      rows.appendChild(r); });
  }
  // "⋯" on a note's row in a lens or the Today panel: the same actions as the inspector, in a menu
  const moreBtn = id => byId[id] && !byId[id].ghost && VGActions.forNote(byId[id], actionCtx()).length
    ? `<button class="vg-btn vg-btn-sm vg-more" data-more="${esc(id)}" title="All actions for this note" aria-label="All actions for ${esc(byId[id].name)}">⋯</button>` : "";
  // fixSlot(id, problem): where a lens row offers the fix for the problem the lens is about (VGActions.problems);
  // wireFixes fills each with that fix's button, or Open where the fix can't run here (the standalone page)
  const fixSlot = (id, problem) => `<span class="vg-sugg-acts"><span class="vg-fix" data-fix="${problem}" data-fid="${esc(id)}"></span></span>`;
  function wireFixes(scope) {
    const c = actionCtx();
    scope.querySelectorAll(".vg-fix").forEach(slot => { const n = byId[slot.dataset.fid]; slot.innerHTML = ""; if (!n) return;
      const p = VGActions.problems(n, c).find(x => x.key === slot.dataset.fix);
      const a = p && p.fix ? p.fix : VGActions.forNote(n, c, ["open"])[0];
      if (a) VGActions.render(slot, [a], n, c, { btn: "vg-btn vg-btn-sm" }); });
  }
  function wireMore(scope) { scope.querySelectorAll("[data-more]").forEach(b => b.onclick = e => { e.stopPropagation(); actionMenu(b, b.dataset.more); }); }
  // o.skip: action groups left out; o.except: keys already shown as buttons; o.extra: include the inspector's own (Map)
  function actionMenu(anchor, id, o = {}) {
    root.querySelectorAll(".vg-actmenu").forEach(m => m.remove());
    const n = byId[id]; if (!n) return;
    const menu = document.createElement("div"); menu.className = "vg-actmenu"; menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="vg-actmenu-h">${esc(n.name)}</div>`;
    const c0 = actionCtx(), c = { ...c0, extra: o.extra ? c0.extra : [] };   // a lens row's menu acts on the vault; Map stays in the inspector
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", away, true); };
    const away = e => { if (!menu.contains(e.target)) close(); };
    VGActions.render(menu, VGActions.forNote(n, c, null, { skip: o.skip }).filter(a => !(o.except || []).includes(a.key)), n, { ...c, done: (msg, undo) => { close(); c.done(msg, undo); } }, { btn: "vg-actmenu-item", primary: "is-primary", fullLabels: true });
    menu.addEventListener("click", e => { if (e.target.closest("[data-act]")) setTimeout(() => { if (!menu.querySelector("button:disabled")) close(); }, 0); });
    menu.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    root.appendChild(menu);
    const r = anchor.getBoundingClientRect(), R0 = root.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(R0.width - mw - 8, r.right - R0.left - mw)) + "px";
    menu.style.top = (r.bottom - R0.top + mh + 8 > R0.height ? Math.max(8, r.top - R0.top - mh - 4) : r.bottom - R0.top + 4) + "px";
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    const first = menu.querySelector("button"); if (first) first.focus();
  }
  // the map that lists the note (not being listed is a problem: needsAttention shows it with its fix)
  function mapLine(id) {
    const m = mocOf[byId[id].cluster]; if (!m || !onMap(m, id)) return "";
    const listed = true, mid = byId[m.id] ? m.id : null;
    return `<div class="vg-mapline ${listed ? "" : "is-missing"}"><span class="vg-hex" style="--c:${colorOf(byId[id].cluster)}"></span>
      <span>${listed ? "Listed in" : "Not listed in its map"} ${mid ? `<button class="vg-linkbtn" data-id="${esc(m.id)}">${esc(m.title)}</button>` : esc(m.title)}</span>
      ${!listed && canAddToMap() ? `<button class="vg-btn vg-btn-sm" data-addmap="${esc(m.id)}" data-note="${esc(id)}">${icon("plus", 12)} Add</button>` : ""}</div>`;
  }
  // the plugin's shared "add to map" action when there is one (sidebar and graph write the same lines)
  const canAddToMap = () => !!(opts.addToMap || opts.appendSection);   // every Add-to-map button asks this
  const addToMapAction = (mocId, ids) => opts.addToMap ? opts.addToMap(mocId, ids)
    : opts.appendSection(mocId, `## Also in this topic (added ${today()})`, ids.map(i => `- ${mdLink(i, mocId)}`));
  async function addToMap(mocId, ids, button) {
    if (button) button.disabled = true;
    let wrote;
    try { wrote = await addToMapAction(mocId, ids); }
    catch (e) { if (button) button.disabled = false; toast("Couldn't update the map", "warn"); return false; }
    const m = mocs.find(x => x.id === mocId);
    const already = wrote === false;   // the plugin skipped it: the map already links to every one of them
    listedOnMap(mocId, ids, true);
    if (already) toast(`Already in ${m.title}`, "ok");
    else { toast(`Added ${plural(ids.length, "note")} to ${m.title}`, "ok"); logDiscovery(`Added ${ids.map(i => byId[i].name).join(", ")} to ${m.title}`); }
    renderInsights(); rebuild(false); return true;
  }
  // notes just listed in a map: members, missing and the map's links as the next analysis will have them
  function listedOnMap(mocId, ids, quiet) {
    const m = mocs.find(x => x.id === mocId); if (!m) return;
    ids.forEach(i => { if (!byId[i]) return; if (!onMap(m, i)) m.members.push(i); Object.keys(m.missing).forEach(c => m.missing[c] = m.missing[c].filter(x => x !== i));
      if (byId[mocId] && !links.some(l => l.kind === "moc" && l.s.id === mocId && l.t.id === i)) links.push({ source: mocId, target: i, w: 1, kind: "moc", s: byId[mocId], t: byId[i] }); });
    if (!quiet) { renderInsights(); rebuild(false); }
  }
  function wireAddToMap(box) {
    box.querySelectorAll("[data-addmap]").forEach(b => b.onclick = async e => { e.stopPropagation(); if (await addToMap(b.dataset.addmap, [b.dataset.note], b)) select(st.selected); });
  }
  function inspectMoc(n, box) {
    const m = mocs.find(x => x.id === n.id) || { clusters: [n.cluster], missing: {}, members: [] };
    const miss = m.clusters.flatMap(c => m.missing[c] || []).filter(i => byId[i]);
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:${colorOf(n.cluster)}">Map of content</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${esc(n.name)}</h2>
      <div class="vg-muted vg-ins-path">${esc(n.id)}</div>
      <div class="vg-ins-actions vg-wrap"><span class="vg-noteacts"></span>
        <button class="vg-btn" data-act="missing">${icon("target", 14)} Light up missing</button>
        ${canAddToMap() && miss.length ? `<button class="vg-btn" data-act="addall">${icon("plus", 14)} Add top ${Math.min(10, miss.length)}</button>` : ""}</div>
      <div class="vg-ins-sec"><div class="vg-ins-h">Maps</div>${m.clusters.map(c => `<button class="vg-chip is-btn" data-c="${c}" style="--c:${colorOf(c)}">${esc((clusterById[c] || { name: "?" }).name)} · ${(clusterById[c] || { size: 0 }).size - (m.missing[c] || []).length}/${(clusterById[c] || { size: 0 }).size}</button>`).join(" ")}</div>
      <div class="vg-ins-sec"><div class="vg-ins-h">In the topic, not in the map <span class="vg-count">${miss.length}</span></div>
      ${miss.slice(0, 40).map(i => `<div class="vg-sugg">${noteRow(i, `#${rankOf[i] || "—"} influence`)}${canAddToMap() ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-addmap="${esc(n.id)}" data-note="${esc(i)}">${icon("plus", 12)} Add</button></span>` : ""}</div>`).join("") || `<div class="vg-empty">Everything in this topic is listed.</div>`}</div>`;
    box.querySelector(".vg-ins-close").onclick = () => select(null);
    noteActions(n, box.querySelector(".vg-noteacts"), ["open", "copy", "current", "archive"]);
    box.querySelector('[data-act="missing"]').onclick = () => showMocMissing(n.id);
    const all = box.querySelector('[data-act="addall"]'); if (all) all.onclick = async () => { if (await addToMap(n.id, miss.slice(0, 10), all)) select(n.id); };
    box.querySelectorAll(".vg-chip.is-btn").forEach(b => b.onclick = () => focusClusters([+b.dataset.c]));
    wire(box); wireAddToMap(box); wireSheet(box);
  }
  function suggestionRow(id, l) {
    const o = l.s.id === id ? l.t.id : l.s.id;
    const acts = opts.linkNotes ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-link="${esc(o)}" title="Add to this note's Related section">${icon("link", 13)} Link</button>` +
      `<button class="vg-btn vg-btn-sm vg-btn-ghost" data-dismiss="${esc(o)}" title="Never suggest this pair again">Dismiss</button></span>` : "";
    const ev = (l.ev || []).map(([day, path, line]) => `<button class="vg-ev" data-open="${esc(path)}" title="Open ${esc(path)}">` +
      `<span class="vg-ev-day">${esc(day)}</span><span class="vg-ev-line">${line ? "“" + esc(line) + "”" : esc(path.split("/").pop().replace(/\.md$/, ""))}</span></button>`).join("");
    const mine = l.s.id === id ? l.pa : l.pb, theirs = l.s.id === id ? l.pb : l.pa;
    const pas = mine && theirs ? `<div class="vg-pass"><div><span class="vg-ev-day">${esc(byId[id].name)}${mine[0] ? " § " + esc(mine[0]) : ""}</span><span class="vg-ev-line">${esc(mine[1])}</span></div>` +
      `<div><span class="vg-ev-day">${esc(byId[o].name)}${theirs[0] ? " § " + esc(theirs[0]) : ""}</span><span class="vg-ev-line">${esc(theirs[1])}</span></div></div>` : "";
    return `<div class="vg-sugg-wrap"><div class="vg-sugg"><button class="vg-item" data-id="${esc(o)}"><span class="vg-dot" style="background:${colorOf(byId[o].cluster)}"></span>
      <span class="vg-item-main">${label(o)}<span class="vg-item-sub">${esc(l.why)}</span></span></button>${acts}</div>` +
      (ev ? `<details class="vg-evs"><summary>Evidence from your dailies</summary>${ev}</details>` : "") +
      (pas ? `<details class="vg-evs"><summary>Where they meet (shared words)</summary>${pas}</details>` : "") + `</div>`;
  }
  function renderSeriesSection(id, { s, k }) {
    const prev = s.notes[k - 1], next = s.notes[k + 1];
    const row = (other, rel) => other ? `<div class="vg-sugg"><button class="vg-item" data-id="${esc(other)}"><span class="vg-dot" style="background:${colorOf(byId[other].cluster)}"></span>
      <span class="vg-item-main">${label(other)}<span class="vg-item-sub">${rel}${nb[id].has(other) ? " · linked" : ""}</span></span></button>
      ${opts.linkNotes && !nb[id].has(other) ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-link="${esc(other)}" data-why="${rel} in the ${esc(s.name)} series">${icon("link", 13)} Link</button></span>` : ""}</div>` : "";
    return `<div class="vg-ins-sec"><div class="vg-ins-h">Series · ${esc(s.name)} <span class="vg-count">${k + 1} of ${s.notes.length}</span></div>${row(prev, "previous")}${row(next, "next")}</div>`;
  }
  function inspectGhost(n, box) {
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:${css("--vg-muted")}">Not written yet</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${esc(n.name)}</h2>
      <div class="vg-muted vg-ins-path">Linked from ${plural(n.from.length, "note")} — the links point at a note that doesn't exist.</div>
      <div class="vg-ins-actions">${opts.writeNote && n.creatable && !n.created ? `<button class="vg-btn vg-btn-primary" data-act="create">${icon("file", 14)} Create note</button>` : ""}
        ${n.created ? `<span class="vg-muted">Created in ${FOLDERS.inbox}</span>` : ""}${!n.creatable ? `<span class="vg-muted">The name has characters a file can't use — rename the links first.</span>` : ""}</div>
      <div class="vg-ins-sec"><div class="vg-ins-h">Linked from</div>${n.from.filter(id => byId[id]).map(id => noteRow(id)).join("")}</div>`;
    box.querySelector(".vg-ins-close").onclick = () => select(null);
    const c = box.querySelector('[data-act="create"]');
    if (c) c.onclick = async () => {
      const md = `---\ncreated: ${today()}\n---\n# ${n.name}\n\n` +
        `> Created from Vault Graph: linked from ${n.from.filter(id => byId[id]).map(id => mdLink(id, `${FOLDERS.inbox}/${safeName(n.name)}.md`)).join(", ")}.\n\n`;
      try { await opts.writeNote(`${FOLDERS.inbox}/${safeName(n.name)}.md`, md, { mode: "create", open: true }); n.created = true; toast(`Created ${n.name} in ${FOLDERS.inbox}`, "ok"); select(n.id); dirty = true; }
      catch (e) { toast("Couldn't create the note", "warn"); }
    };
    wire(box); wireSheet(box);
  }
  function inspectPerson(n, box) {
    const notes = links.filter(l => l.kind === "person" && l.s.id === n.id).map(l => l.t.id), groups = {};
    notes.forEach(m => (groups[byId[m].cluster] = groups[byId[m].cluster] || []).push(m));
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:${css("--vg-person")}">Person</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${esc(n.name)}</h2>
      <div class="vg-muted vg-ins-path">${plural(notes.length, "linked note")} · named alongside topics in ${plural(n.mentions, "daily mention")}</div>
      <div class="vg-ins-actions vg-noteacts"></div>
      <div class="vg-ins-sec"><div class="vg-ins-h">Topics</div>${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, ms]) =>
        `<details class="vg-group" open><summary><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-count">${ms.length}</span></summary>${ms.map(m => noteRow(m)).join("")}</details>`).join("")}</div>`;
    box.querySelector(".vg-ins-close").onclick = () => select(null);
    noteActions(n, box.querySelector(".vg-noteacts"), ["open", "copy"]);
    wire(box); wireSheet(box);
  }
  // bottom-sheet handle (narrow panes): drag to resize, snap to peek / half / full, flick down to close
  function wireSheet(box) {
    const h = box.querySelector(".vg-sheet-handle"); if (!h) return;
    let start = null;
    h.onpointerdown = e => { if (!narrow()) return; h.setPointerCapture(e.pointerId); start = { y: e.clientY, h: box.offsetHeight }; box.classList.add("is-resizing"); };
    h.onpointermove = e => { if (!start) return; box.style.maxHeight = "none"; box.style.height = Math.max(60, Math.min(root.clientHeight * 0.95, start.h - (e.clientY - start.y))) + "px"; };
    h.onpointerup = e => {
      if (!start) return; box.classList.remove("is-resizing");
      const frac = box.offsetHeight / root.clientHeight; start = null;
      if (frac < 0.18) { box.style.height = ""; box.style.maxHeight = ""; st.multi ? clearMulti() : select(null); return; }
      const snap = [0.32, 0.55, 0.92].reduce((a, b) => Math.abs(b - frac) < Math.abs(a - frac) ? b : a);
      box.style.height = Math.round(root.clientHeight * snap) + "px";
    };
  }
  // Link writes "- [[other]] — <evidence>" into the selected note (plugin only); Dismiss records the
  // pair so the analysis never suggests it again. Either way the dashed edge goes away right here.
  // a link just written: the suggestion goes, the link is drawn (quiet: the caller says what happened)
  function noteLinked(id, other, quiet) {
    if (!byId[id] || !byId[other]) return;
    for (let i = links.length - 1; i >= 0; i--) { const l = links[i]; if ((l.kind === "gap" || l.kind === "similar") && ((l.s.id === id && l.t.id === other) || (l.s.id === other && l.t.id === id))) links.splice(i, 1); }
    if (!nb[id].has(other)) { links.push({ source: id, target: other, w: 1, kind: "link", s: byId[id], t: byId[other] }); nb[id].add(other); nb[other].add(id); }
    byId[id].age = 0;
    if (!quiet) rebuild(false);
  }
  async function actOnSuggestion(action, id, other, button, whyOverride) {
    const gap = links.find(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.id === id && l.t.id === other) || (l.s.id === other && l.t.id === id)));
    button.disabled = true;
    try {
      if (action === "link") {
        // Write the Related line into the staler note: linking it is a touch, so it stops being stale
        const [from, to] = byId[other] && byId[id] && byId[other].age > byId[id].age ? [other, id] : [id, other];
        await opts.linkNotes(from, to, whyOverride || (gap ? gap.why : "suggested by Vault Graph"));
        if (byId[from]) byId[from].age = 0;
      }
      else await opts.dismissPair(id, other, gap ? gap.kind : "gap");
    } catch (err) { button.disabled = false; toast("That didn't work — see the notice", "warn"); return; }
    if (action === "link") noteLinked(id, other, true);
    else for (let i = links.length - 1; i >= 0; i--) if (links[i] === gap) links.splice(i, 1);
    toast(action === "link" ? `Linked ${byId[id].name} → ${byId[other].name}` : "Suggestion dismissed", "ok");
    logDiscovery(action === "link" ? `Linked ${byId[id].name} ↔ ${byId[other].name}` : `Dismissed ${byId[id].name} ↔ ${byId[other].name}`);
    rebuild(false); select(id);
  }
  // Live sync (plugin): fresh vault data with the same notes patches this graph in place -- links, link counts,
  // unlinked/stale flags and map members -- so layout, orbits and selection stay put. Notes added or removed
  // return false and the host remounts instead.
  const LAYOUT_KEYS = new Set(["x", "y", "z", "vx", "vy", "vz", "fx", "fy", "bx", "by", "bz", "z0"]);
  function applyLive(D) {
    if (destroyed || !D || !D.nodes) return false;
    const fresh = new Map(D.nodes.map(n => [n.id, n]));
    if (fresh.size !== DATA.nodes.length || DATA.nodes.some(n => !fresh.has(n.id))) return false;
    // what a patch can't express -- a wanted note written (its placeholder goes), a new map -- remounts from the new state
    const ids = xs => (xs || []).map(x => x.id).sort().join("|");
    if (ids(D.wanted) !== ids(DATA.wanted) || ids((D.mocs || []).filter(m => !m.nav)) !== ids(mocs)) return false;
    if (JSON.stringify(D.scenes || []) !== JSON.stringify(DATA.scenes || [])) return false;   // a scene block edited: its scene is rebuilt
    // topics are the frame everything else hangs on (names, colours, maps, gaps): a re-analysis that changed them, or moved
    // a note to another topic, remounts instead of patching notes onto the old topic list
    const topics = d => JSON.stringify([(d.clusters || []).map(c => [c.id, c.name, c.size]), d.gaps || [], d.pairs || []]);
    if (topics(D) !== topics(DATA) || DATA.nodes.some(n => (fresh.get(n.id).cluster ?? -1) !== (n.cluster ?? -1))) return false;
    DATA.nodes.forEach(n => { const f = fresh.get(n.id); if (n.age > 0 && f.age === 0) liveEdits.push({ id: n.id, t: performance.now() }); });   // edited just now
    if (liveEdits.length > 30) liveEdits.splice(0, liveEdits.length - 30);
    // every field the state carries (links, tasks, tags, age, references...); positions are the view's own
    DATA.nodes.forEach(n => { const f = fresh.get(n.id); for (const k in f) if (!LAYOUT_KEYS.has(k)) n[k] = f[k]; });
    saidUnlinked.length = 0; (D.said_unlinked || []).filter(([id]) => byId[id]).forEach(x => saidUnlinked.push(x));
    DATA.said_unlinked = D.said_unlinked; DATA.near_dupes = D.near_dupes;
    links.length = 0;
    D.links.forEach(l => { const s = byId[l.source], t = byId[l.target]; if (s && t) links.push({ ...l, s, t }); });
    nodes.forEach(n => nb[n.id].clear());
    links.forEach(l => { if (l.kind === "link") { nb[l.s.id].add(l.t.id); nb[l.t.id].add(l.s.id); } });
    Object.keys(peopleOf).forEach(k => delete peopleOf[k]);
    links.filter(l => l.kind === "person").forEach(l => (peopleOf[l.t.id] = peopleOf[l.t.id] || []).push(l.s.id));
    Object.keys(mocMembers).forEach(k => delete mocMembers[k]);
    links.filter(l => l.kind === "moc").forEach(l => (mocMembers[l.s.id] = mocMembers[l.s.id] || new Set()).add(l.t.id));
    (D.mocs || []).forEach(m => { const mine = mocs.find(x => x.id === m.id); if (mine) { mine.members = m.members; mine.missing = m.missing; } });
    countLeaves();
    DATA.live = D.live; healthCache.clear();
    rebuild(false);
    if (st.selected && byId[st.selected]) select(st.selected);   // its link list and suggestions are current again
    else if (st.body && isCosmos()) selectBody(st.body);
    if (!opts.compact) updateGameSoon();
    renderToday(); refreshLens();   // an open lens shows the new state too
    return true;
  }
  function reveal(id) {
    if (isCosmos() && !st.paused) setPaused(true, true);   // hold still while you look
    const n = byId[id]; if (!n) return;
    if (!baseVisible(n)) {
      st.hidden.delete(id); st.hiddenClusters.delete(n.cluster);
      if (n.isolated) { st.isolated = true; $(".vg-isolated").checked = true; }
      if (leafOf[id]) { st.leaves = false; $(".vg-leaves").checked = false; }
      if (n.ghost) setLayer("wanted", true);
      if (n.person) setLayer("people", true);
    }
    if (st.focusDist && !st.focusDist.has(id)) { st.focus = null; st.focusDist = null; $(".vg-focusbar:not(.vg-pathbar)").hidden = true; if (!neural()) cam.cx = cam.cy = cam.cz = 0; }
    closeDrawer();
    rebuild(false); select(id); setTimeout(() => centreOn(id, neural() ? 1.8 : 2.5), 30);
  }
  function wire(el) {
    el.querySelectorAll("[data-id]").forEach(d => d.onclick = () => reveal(d.dataset.id));
    el.querySelectorAll("[data-open]").forEach(d => d.onclick = e => { e.stopPropagation(); if (opts.openNote) opts.openNote(d.dataset.open, e.ctrlKey || e.metaKey); });
  }
  function setHighlight(set, labelText) { st.highlight = set; st.highlightLabel = labelText; if (isCosmos() && set && !st.paused) setPaused(true, true); renderStatus(); dirty = true; kick(); }
  function clearHighlight() { if (st.autoPaused && !st.selected) setPaused(false); st.highlight = null; st.highlightLabel = null; markLists(); renderStatus(); dirty = true; kick(); }
  function focusClusters(ids) {
    ids.forEach(c => st.hiddenClusters.delete(c));
    closeDrawer();
    rebuild(false);
    setHighlight(new Set(nodes.filter(n => ids.includes(n.cluster)).map(n => n.id)), ids.map(clusterName).join(" ↔ "));
    const lit = st.highlight;   // the framing outlives the highlight (a resize re-fits after it's cleared)
    select(null); fit(n => lit.has(n.id)); markLists(ids);
  }
  function markLists(ids) {
    ids = ids || [];
    $$(".vg-cluster").forEach(e => e.classList.toggle("is-on", ids.length === 1 && ids[0] == e.dataset.c));
    $$(".vg-gap").forEach(e => e.classList.toggle("is-on", ids.length === 2 && e.dataset.a == ids[0] && e.dataset.b == ids[1]));
  }

  // ---------------------------------------------------------------- writing notes (plugin only)
  const MARK = "%% vault-graph:generated — edit above this line; everything below is regenerated %%";
  const membersOf = c => topicNotes(c).sort(byInfluence);
  async function write(path, md, mode, what) {
    try { const p = await opts.writeNote(path, md, { mode, open: true }); toast(`${what}: ${(p || path).split("/").pop()}`, "ok"); logDiscovery(`${what}: ${(p || path).split("/").pop().replace(/\.md$/, "")}`); }
    catch (e) { toast(`Couldn't write the ${what.toLowerCase()}`, "warn"); }
  }
  function writeHub(c) {
    const ms = membersOf(c), name = clusterName(c);
    const bridges = ms.filter(n => [...nb[n.id]].some(m => byId[m].cluster !== c && byId[m].cluster >= 0)).slice(0, 12);
    const md = `---\ntags:\n  - meta/hub\nupdated: ${today()}\n---\n# ${name} Hub\n\n` +
      `Topic cluster C${c} as of ${DATA.date} (${plural(ms.length, "note")}).\n\n${MARK}\n\n` +
      `## Core\n${ms.slice(0, 6).map(n => `- ${mdLink(n.id)}`).join("\n")}\n\n` +
      (bridges.length ? `## Bridges to other topics\n${bridges.map(n => `- ${mdLink(n.id)} — also links ${[...new Set([...nb[n.id]].map(m => byId[m].cluster).filter(x => x !== c && x >= 0))].map(clusterName).join(", ")}`).join("\n")}\n\n` : "") +
      `## All notes\n${ms.map(n => `- ${mdLink(n.id)}`).join("\n")}\n`;
    write(`${FOLDERS.inbox}/${safeName(name)} Hub.md`, md, "regen", "Hub note");
  }
  function writeBridge(a, b) {
    const A = clusterName(a), B = clusterName(b), ma = membersOf(a).slice(0, 5), mb = membersOf(b).slice(0, 5);
    const pairs = links.filter(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.cluster === a && l.t.cluster === b) || (l.s.cluster === b && l.t.cluster === a)));
    const g = DATA.gaps.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    const md = `---\ncreated: ${today()}\n---\n# Bridge — ${A} ↔ ${B}\n\n` +
      `> Drafted by Vault Graph on ${today()}. These topics come up together in your dailies${g ? ` (${g.comentions} co-mentions)` : ""} but barely link` +
      `${g ? ` (${plural(g.links, "link")})` : ""}. Fill this in, then link it from both sides.\n\n` +
      `## ${A}\n${ma.map(n => `- ${mdLink(n.id)}`).join("\n")}\n\n## ${B}\n${mb.map(n => `- ${mdLink(n.id)}`).join("\n")}\n\n` +
      (pairs.length ? `## Where they already meet\n${pairs.slice(0, 6).map(l => `- ${mdLink(l.s.id)} ↔ ${mdLink(l.t.id)} — ${l.why}` +
        ((l.ev || []).find(e => e[2]) ? `\n  - e.g. ${(l.ev.find(e => e[2]))[0]}: “${(l.ev.find(e => e[2]))[2]}”` : "")).join("\n")}\n\n` : "") +
      `## Questions\n- How does ${A} depend on ${B}, or the other way round?\n- Which decisions in one changed the other?\n` +
      `- What would break in ${B} if ${A} changed?\n- Is there a process or person that already connects them?\n\n## Notes\n\n`;
    write(`${FOLDERS.inbox}/Bridge — ${safeName(A)} ↔ ${safeName(B)}.md`, md, "create", "Bridge note");
  }
  function writeNeighbourhoodMap(id) {
    const depth = Math.max(2, st.focusDepth), dist = new Map([[id, 0]]), via = new Map(), queue = [id];
    while (queue.length) { const v = queue.shift(), d = dist.get(v); if (d >= depth) continue; nb[v].forEach(m => { if (!dist.has(m)) { dist.set(m, d + 1); via.set(m, v); queue.push(m); } }); }
    const rings = {}; dist.forEach((d, m) => { if (d) (rings[d] = rings[d] || []).push(m); });
    const md = `---\ncreated: ${today()}\n---\n# Map — ${byId[id].name}\n\n> Neighbourhood of ${mdLink(id)} within ${depth} links, from Vault Graph (${DATA.date}).\n\n` +
      Object.entries(rings).map(([d, ms]) => `## ${d} link${d > 1 ? "s" : ""} away (${ms.length})\n` +
        ms.sort((x, y) => byId[y].bc - byId[x].bc).map(m => `- ${mdLink(m)}${d > 1 ? ` — via ${mdLink(via.get(m))}` : ""}`).join("\n")).join("\n\n") + "\n";
    write(`${FOLDERS.inbox}/Map — ${safeName(byId[id].name)}.md`, md, "regen", "Map note");
  }
  function writeMap(ids, title) {
    const groups = {}; ids.forEach(id => (groups[byId[id].cluster] = groups[byId[id].cluster] || []).push(id));
    const md = `---\ncreated: ${today()}\n---\n# Map — ${title} ${today()}\n\n` + Object.entries(groups).map(([c, ms]) => `## ${clusterName(+c)}\n${ms.map(m => `- ${mdLink(m)}`).join("\n")}`).join("\n\n") + "\n";
    write(`${FOLDERS.inbox}/Map — ${title} ${today()}.md`, md, "create", "Map note");
  }
  function writeSelectionHub(ids) {
    const md = `---\ntags:\n  - meta/hub\nupdated: ${today()}\n---\n# Selection Hub ${today()}\n\n${MARK}\n\n` +
      ids.sort((a, b) => byId[b].bc - byId[a].bc).map(id => `- ${mdLink(id)}`).join("\n") + "\n";
    write(`${FOLDERS.inbox}/Selection Hub ${today()}.md`, md, "regen", "Hub note");
  }
  async function saveImage() {
    draw(performance.now());
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    if (!blob) { toast("Couldn't capture the image", "warn"); return; }
    const name = `Vault Graph ${today()} ${new Date().toTimeString().slice(0, 5).replace(":", "")}.png`;
    if (opts.saveBinary) {
      try { const p = await opts.saveBinary(`attachments/${name}`, await blob.arrayBuffer()); toast(`Saved ${(p || name).split("/").pop()}`, "ok"); } catch (e) { toast("Couldn't save the image", "warn"); }
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  }
  $(".vg-png").onclick = saveImage;
  $(".vg-tourbtn").onclick = () => { closeDrawer(); startTour(); };
  $(".vg-keysbtn").onclick = () => showKeys();
  $(".vg-anglebtn").onclick = () => cycleAngle();


