  // Views from the graphs library (vault-graph-views, built into this file by build.js): a scene here is the host side of
  // one library view. The library draws on its own canvas laid over this one; this file gives it the data, the selection and
  // the theme, and takes back what it asks for: a note opened, the stat line, the Today strip, and the actions it names.
  // A library view sits under its own key (hidden: true, so no picker lists it) beside the plugin's own copy of that view,
  // until the library's has been looked at in Obsidian and on a phone; then the key moves to the menu and the old copy goes.
  function libDrop() { if (LIBV.handle) LIBV.handle.dispose(); LIBV.handle = null; LIBV.key = null; }
  const libTheme = () => ({ bg: css("--vg-bg") || undefined, fg: css("--vg-fg") || undefined, muted: css("--vg-muted") || undefined, accent: css("--vg-accent") || undefined, palette: PALETTE });
  // a note the library names: the shared detail when it is in the graph, the note itself otherwise (a journal day)
  const libOpen = id => { if (byId[id]) select(id); else if (opts.openNote) opts.openNote(id, false); };
  const LIB_ACTIONS = { graph: () => setView("2d"), "guide-scan": () => openLens("guide") };
  // Mount the library's view for `key` (once, and again when the data it was built from changed), show it, keep it level
  // with the pane and with the selection, and put its stat line in the status. inputs() is what the view takes beyond the data.
  function libDraw(key, libView, inputs) {
    if (!LIBV.host) { LIBV.host = document.createElement("div"); LIBV.host.className = "vg-lib"; wrap.insertBefore(LIBV.host, wrap.firstChild); }
    if (LIBV.key !== key) {
      if (LIBV.handle && LIBV.handle.view !== libView) libDrop();
      if (!LIBV.handle) {
        LIBV.host.innerHTML = "";
        LIBV.handle = VaultGraphViews.mountViews(LIBV.host, { view: libView, data: DATA, inputs: inputs(), onOpen: libOpen, onAction: a => (LIB_ACTIONS[a] || (() => {}))(), theme: libTheme() });
        LIBV.selected = undefined; LIBV.size = "";
      }
      LIBV.key = key; LIBV.host.hidden = false;
    }
    cv.style.visibility = "hidden";   // the plugin's canvas has nothing to show under the library's
    const size = W + "x" + H; if (size !== LIBV.size) { LIBV.size = size; LIBV.handle.resize(); }
    if (st.selected !== LIBV.selected) { LIBV.selected = st.selected; LIBV.handle.update({ selected: st.selected || null }); }
    setSceneStat(LIBV.handle.stat());
  }
  const libToday = () => (LIBV.handle && LIBV.key === st.view ? LIBV.handle.today() : null);
  const libApi = () => ({ handle: () => LIBV.handle, host: () => LIBV.host, hidden: () => !LIBV.host || LIBV.host.hidden, drop: libDrop });

  // A Guide scan's result as the library's scan input: the guide, where it looked, each note it read with its hit count, and
  // which notes were in scope (the plugin's own scope rule), or null before a scan.
  function scanForViews(R) {
    if (!R) return null;
    const inScope = n => !special(n) && !n.ghost && VGShared.scopeHas(R.scope, n.id, n.tags);
    return { guide: R.guide.seq, where: guideScoped(R.scope) ? guideScopeText(R.scope) : "", notes: R.notes.map(n => ({ path: n.path, hits: n.hits.length })), ids: nodes.filter(inScope).map(n => n.id) };
  }

  scene("cas9-lib", {
    name: "Cas9 (library)", icon: "cas9", hidden: true, lib: true, hint: SCENES.cas9.hint,
    layout: () => ({ pos: new Map(), bounds: [] }),
    draw: () => {
      libDraw("cas9-lib", "cas9", () => { LIBV.scanned = guideNow.result; return { scan: scanForViews(guideNow.result) }; });
      if (guideNow.result !== LIBV.scanned) { LIBV.scanned = guideNow.result; LIBV.handle.update({ scan: scanForViews(guideNow.result) }); }
    },
    today: libToday, api: { ...libApi(), scanForViews },
  });

  scene("genome-lib", {
    name: "Genome fold (library)", icon: "genome", hidden: true, lib: true, hint: SCENES.genome.hint,
    layout: () => ({ pos: new Map(), bounds: [], fold: VGScience.foldForViews(VGScience.genomeFold((DATA.strand || { rows: [] }).rows)) }),   // the fold is worked out here, once
    draw: () => libDraw("genome-lib", "genome", () => ({ fold: mapCache["genome-lib"].fold })),
    today: libToday, api: libApi(),
  });
