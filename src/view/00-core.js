// The renderer for Vault Graph (the plugin and the standalone page), one closure written in parts that build.js joins
// in name order: 00-core (data, DOM, state, physics, camera), 10-draw (the graph and neural renderers), 20/21 maps
// (the picture views and the scene registry), 30-interact (frame loop, pointer, keyboard, tour, toasts), 40-panels
// (sidebar tabs, Today, saved views, inspector, writing notes), 50-cosmos (the cosmos and the game layer), 60-lenses,
// 70-shell (search, paths, presets, the picker, views, saved state, start). A part may use any name another defines.
// Self-contained: own force layout (3D-capable), canvas renderer and UI, no libraries.
//
// mountVaultGraph(root, DATA, opts) -> { destroy, focusNote, setLocal }
//   DATA     output of vault_graph.graph_data()
//   opts.openNote(path, newPane)        open a note (plugin: workspace; page: obsidian:// URI)
//   opts.onHoverNote(path, event)       optional, e.g. Obsidian page preview
//   opts.linkNotes(from, to, why)       optional (plugin): write a Related line
//   opts.dismissPair(a, b, kind)        optional (plugin): never suggest a pair again
//   opts.writeNote(path, md, {mode})    optional (plugin): create a note, or regenerate below a marker
//   opts.appendSection(path, heading, lines)  optional (plugin): append lines under a dated heading (MOC drift)
//   opts.saveBinary(path, arrayBuffer)  optional (plugin): save an exported image into the vault
//   opts.addToMap(mocId, ids)           optional (plugin): list notes in a map (the shared action; else appendSection)
//   opts.setTaskStatus / setNoteTasks   optional (plugin): complete or cancel one task, or every task in a note
//   opts.linkText(id, from)             optional (plugin): Obsidian's link text for a note
//   opts.store {load, save}             optional: remembered view + layout
//   opts.compact                        optional: minimal chrome (local-graph side pane, in-note embeds)
//   opts.embed                          optional: inside a note -- the wheel and one-finger
//                                       drags scroll the page; Ctrl+wheel or two fingers zoom
//   opts.onViewChange(view)             optional: called when the 2D/3D/Neural/Cosmos mode changes
//   opts.mobile                         optional: lighter rendering for phones
//
// Views: "2d", "3d" (force layout; 3D follows Advanced Graph View's yaw/pitch perspective camera, MIT,
// n23eos/advanced_graph_view) and "neural": clusters as lobes on a brain-shaped shell, bridge notes in an
// inner core, curved glowing connections with signal pulses and a HUD (inspired by gods-eye-view).
// Icons are simple hand-drawn strokes in the Lucide style.
/* eslint-disable no-unused-vars */
function mountVaultGraph(root, DATA, opts) {
  opts = opts || {};
  // Flexoki, its two strengths of each hue: readable on both of its backgrounds, and at home in the vault's theme
  const PALETTE = ["#4385BE", "#879A39", "#DA702C", "#8B7EC8", "#3AA99F", "#D14D41", "#D0A215", "#CE5D97",
                   "#205EA6", "#66800B", "#BC5215", "#5E409D", "#24837B", "#AF3029", "#AD8301", "#A02F6F"];
  const NEON = ["#38bdf8", "#4ade80", "#fb923c", "#c084fc", "#22d3ee", "#f87171", "#facc15", "#f472b6",
                "#818cf8", "#34d399", "#fbbf24", "#a78bfa", "#2dd4bf", "#fb7185", "#a3e635", "#e879f9"];
  // One settings object for what the renderer's views, scenes and panels share: colours that carry a meaning, timings
  // and sizes. A part reads these instead of its own literal, so a change (the selection colour, how long a toast
  // stays) is made once. Topic colours are PALETTE / NEON above.
  const UI = Object.freeze({
    colour: { selected: "#fde047", tasks: "#f87171", skin: "#fde7c8" },
    light: { left: 0.35, right: 0.5, slope: 0.12 },                   // the one light (upper left): how much a 3D face turned this way darkens
    time: { toast: 2800, toastUndo: 8000, wave: 380, skipDays: 14 },   // ms; wave = the click ripple crossing one link
    size: { labelTop: 14, hubLeaves: 8, focal: 900, near: 40 },        // labels drawn, leaves that make a hub, 3D camera
    focusAlpha: [1, 0.95, 0.7, 0.5, 0.35],                            // fade by links away from the focused note
  });
  const MOBILE = !!opts.mobile || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const screenDpr = () => Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);   // every canvas size and transform uses this
  const RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reducedNow = !!(RM && RM.matches);
  const onReduced = e => { reducedNow = e.matches; };
  if (RM && RM.addEventListener) RM.addEventListener("change", onReduced);   // removed in destroy()
  const reducedMotion = () => reducedNow;
  const esc = VGShared.escapeHtml;
  const colorOf = c => (c < 0 || c >= PALETTE.length) ? "#a8a29e" : PALETTE[c];
  const neonOf = c => (c < 0 || c >= NEON.length) ? "#94a3b8" : NEON[c];
  const clusterById = Object.fromEntries(DATA.clusters.map(c => [c.id, c]));
  const clusterName = c => clusterById[c] ? (clusterById[c].label || clusterById[c].name) : "Unclustered";
  const clusterTag = c => clusterById[c] ? clusterName(c) : "no topic";
  const plural = VGShared.plural;
  // local date, not UTC: in Central time the UTC date rolls over at 7 PM, which dated notes and quests a day early
  const { today, localDay, safeName } = VGRules;   // the shared date and file-name rules
  const ICON = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    open: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    sparkles: '<path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3Z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15Z"/>',
    lasso: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
    hub: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m7 7 3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/>',
    bridge: '<path d="M3 17h18M5 17V9M19 17V9M5 9c3 4 11 4 14 0"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)"/><circle cx="20" cy="8" r="1.3" fill="currentColor"/>',
    play: '<path d="M7 4v16l13-8Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    subway: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="14" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/>',
    mountain: '<path d="m2 20 7-12 4 6 3-4 6 10Z"/><path d="m7.5 10.5 1.5 1.5 1.5-1"/>',
    cloud: '<path d="M7 18a4 4 0 1 1 .6-7.96A6 6 0 0 1 19 11a3.5 3.5 0 0 1-.5 7Z"/><path d="m11 20-1 2M15 20l-1 2"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7Z"/>',
    castle: '<path d="M4 21V9h3V6h2v3h2V4h2v5h2V6h2v3h3v12Z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 4-11.5 7.5"/>',
    ripple: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    truss: '<path d="M3 19h18M3 19l9-13 9 13M7.5 12.5h9M12 6v13"/>',
    mould: '<path d="M12 21v-7M12 14c-3 0-5-2-5-5M12 14c3 0 5-2 5-5M7 9c0-2 1-4 3-5M17 9c0-2-1-4-3-5M12 14V6"/><circle cx="12" cy="5" r="1.6"/><circle cx="7" cy="9" r="1.4"/><circle cx="17" cy="9" r="1.4"/><circle cx="12" cy="21" r="1.6"/>',
    waves: '<path d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0 1.5 3 2 3"/><path d="M2 18h20" opacity=".5"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 10c0-3 2.5-5 6-5 0 3.5-2.5 5-6 5Z"/><path d="M7 21h10"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    reviewed: '<path d="M20 6 9 17l-5-5"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
    pulse: '<path d="M2 12h4l3-7 4 14 3-7h6"/>',
    curve: '<path d="M3 4v16h18"/><path d="M6 6c4 0 5 4 7 8s4 4 7 4"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
    swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    gap: '<path d="M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8"/>',
    timeline: '<path d="M3 12h18"/><circle cx="6" cy="12" r="2"/><circle cx="13" cy="12" r="2"/><path d="M13 10V5M6 14v5"/>',
    ring: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14c3 0 5 2 5 5"/>',
    folder: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  };
  const icon = (name, size) => `<svg class="vg-ic" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // ---------------------------------------------------------------- data
  // wanted notes (linked to, never written) become ghost nodes; people arrive as nodes from the data
  const ghosts = (DATA.wanted || []).map(w => ({ id: w.id, name: w.name, ghost: true, from: w.refs, creatable: w.creatable, cluster: -1, bc: 0,
    folder: "not written yet", mentions: 0, recent: 0, inlinks: w.refs.length, outlinks: 0, broken: 0,
    tasks: 0, words: 0, age: 0, refs: true, isolated: false }));
  const nodes = DATA.nodes.concat(ghosts), byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const special = n => n.person || n.ghost || n.moc;
  const byImportance = (a, b) => importance(b) - importance(a), byInfluence = (a, b) => (b.bc || 0) - (a.bc || 0);   // most relied-on / most central first
  // maps of content: which MOC maps each cluster, and what it misses
  const mocs = (DATA.mocs || []).filter(m => !m.nav), mocOf = {};
  mocs.forEach(m => m.clusters.forEach(c => { if (!(c in mocOf)) mocOf[c] = VGRules.mapForCluster(mocs, c); }));   // first map wins (shared rule)
  // On a map = the map links the note or a same-name copy of it, so the
  // graph never keeps suggesting a note the map already has
  const onMap = VGRules.onMap;
  const inMoc = id => { const n = byId[id], m = n && mocOf[n.cluster]; return m ? onMap(m, id) : null; };
  const nameCount = {}; nodes.forEach(n => nameCount[n.name] = (nameCount[n.name] || 0) + 1);
  const label = id => esc(byId[id].name) + (nameCount[byId[id].name] > 1 ? ` <span class="vg-muted">(${esc(byId[id].folder || "/")})</span>` : "");
  // plugin: Obsidian's own link text (a same-name note outside the graph, like a root dashboard, can't take the link)
  const mdLink = (id, from) => { if (opts.linkText) return opts.linkText(id, typeof from === "string" ? from : ""); const n = byId[id]; return nameCount[n.name] > 1 ? `[[${id.replace(/\.md$/, "")}|${n.name}]]` : `[[${n.name}]]`; };
  const links = DATA.links.map(l => ({ ...l, s: byId[l.source], t: byId[l.target] })).filter(l => l.s && l.t);
  let linkGen = 0;   // goes up each time the links are refilled: links is one array, changed in place, so it can't tell you itself
  const nb = {}; nodes.forEach(n => nb[n.id] = new Set());
  links.filter(l => l.kind === "link").forEach(l => { nb[l.s.id].add(l.t.id); nb[l.t.id].add(l.s.id); });
  // The view's live state in the shape the shared rules read (VGRules.graph's contract). Phase 3 of the
  // restructure replaces this adapter with VGRules.graph over one shared state.
  const liveGraph = {
    node: id => byId[id],
    linked: (a, b) => !!nb[a] && nb[a].has(b),
    suggested: (a, b) => stillSuggested(a, b),
    mapById: id => mocs.find(x => x.id === id),
    mapForCluster: c => mocOf[c],
    hasCluster: c => DATA.clusters.some(k => k.id === c),
    wanted: id => !!byId[id] && !!byId[id].ghost && !byId[id].created,
    reviewed: key => !!(review.done && review.done[key]),
  };
  const peopleOf = {}; links.filter(l => l.kind === "person").forEach(l => (peopleOf[l.t.id] = peopleOf[l.t.id] || []).push(l.s.id));
  // leaves: notes whose only link is a hub with UI.size.hubLeaves or more links (they cluster round it); recounted on a live merge
  const leafOf = {}, leafCount = {};
  function countLeaves() {
    [leafOf, leafCount].forEach(o => Object.keys(o).forEach(k => delete o[k]));
    nodes.forEach(n => { if (!special(n) && nb[n.id].size === 1) { const p = [...nb[n.id]][0]; if (nb[p].size >= UI.size.hubLeaves) leafOf[n.id] = p; } });
    Object.values(leafOf).forEach(p => leafCount[p] = (leafCount[p] || 0) + 1);
  }
  countLeaves();
  const ranked = nodes.filter(n => !n.isolated && !special(n)).sort(byInfluence).map(n => n.id);
  const rankOf = Object.fromEntries(ranked.map((id, i) => [id, i + 1]));
  const Q = DATA.quality || { stub_words: 80, stale_days: 180 };
  // Records are never "stale": shared rule, same as the plugin's sidebar and the weekly note
  const { isRecord } = VGRules, staleFor = VGRules.isStale, FOLDERS = VGRules.folders;   // this vault's folder names
  const OVERLAYS = {
    orphans: { label: "Orphans", hint: "Nothing links to these notes", test: n => !special(n) && n.inlinks === 0 },
    deadends: { label: "Dead ends", hint: "These notes link nowhere", test: n => !special(n) && n.outlinks === 0 },
    broken: { label: "Broken links", hint: "Links to notes that don't exist", test: n => n.broken > 0 },
    stubs: { label: "Stubs", hint: `Fewer than ${Q.stub_words} words`, test: n => !special(n) && n.words < Q.stub_words },
    stale: { label: "Stale", hint: `Not edited in ${Q.stale_days}+ days`, test: n => !special(n) && staleFor(n, Q.stale_days) },
    tasks: { label: "Open tasks", hint: "Notes with unchecked tasks", test: n => n.tasks > 0 },
  };
  // series: dated notes that belong in a chain (release notes, transaction updates)
  const series = (DATA.series || []).map((s, i) => ({ ...s, i, notes: s.notes.filter(id => byId[id]) }));
  const seriesOf = {}; series.forEach(s => s.notes.forEach((id, k) => seriesOf[id] = { s, k }));
  // insights: things worth acting on, derived from the data
  const coolingHubs = ranked.slice(0, 60).map(id => byId[id])
    .filter(n => n.recent === 0).slice(0, 8);
  const saidUnlinked = (DATA.said_unlinked || []).filter(([id]) => byId[id]);
  // seeded positions so a reload looks the same
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  // a fixed, even spread for a key: [x, y] in 0..1 from different bits of one hash (two hashes of near-same strings correlate)
  const scatter = key => { const h = hash(key), h2 = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return [((h >>> 4) % 1000) / 1000, ((h2 >>> 7) % 1000) / 1000]; };
  // Layout seeds, per view: "Randomize layout" gives the current view one, "Reset layout" removes it. Every layout reads
  // topic order and geography through topicOrder() / geography(), so one seed rearranges any view the same way.
  let layoutSeeds = {}, layoutBackup = {};   // backup: 2D/3D positions from before the first randomize, for Reset
  const layoutSeed = () => layoutSeeds[st.view] || 0;
  const seededHash = s => (layoutSeed() ? hash(s + "|" + layoutSeed()) : hash(s));
  const topicOrder = () => { const cs = [...DATA.clusters].sort((x, y) => y.size - x.size);
    return layoutSeed() ? cs.sort((a, b) => seededHash("topic" + a.id) - seededHash("topic" + b.id)) : cs; };
  // Shared by the scenes, so each asks the same question the same way:
  //   topicNotes(c)     a topic's notes (no maps, people or unwritten notes); linkedOnly: leave out unlinked ones
  //   topicBusy(c)      how active the topic is: its notes' activity added up
  //   topicPair(a, b)   { links, gap }: links between two topics, and whether the analysis calls them a gap
  //   topicsWithNotes() the topics in order that have notes to show
  //   daylight()        { hr, night, dusk } from your clock: the one rule for scenes with a sky
  const topicNotes = (c, linkedOnly) => nodes.filter(n => n.cluster === c && !special(n) && !n.ghost && (!linkedOnly || !n.isolated));
  const topicBusy = c => topicNotes(c).reduce((s, n) => s + activity(n), 0);
  let pairMemo = null;
  const topicPair = (a, b) => {
    if (!pairMemo || pairMemo.d !== DATA.pairs || pairMemo.g !== DATA.gaps) {
      const links = {}; (DATA.pairs || []).forEach(([x, y, l]) => { links[x + "|" + y] = links[y + "|" + x] = l; });
      pairMemo = { d: DATA.pairs, g: DATA.gaps, links, gaps: new Set((DATA.gaps || []).flatMap(g => [g.a + "|" + g.b, g.b + "|" + g.a])) };
    }
    return { links: pairMemo.links[a + "|" + b] || 0, gap: pairMemo.gaps.has(a + "|" + b) };
  };
  const topicsWithNotes = linkedOnly => topicOrder().filter(c => topicNotes(c.id, linkedOnly).length);
  const daylight = () => { const d = new Date(), hr = d.getHours() + d.getMinutes() / 60, night = hr < 5.5 || hr >= 20.5;
    return { hr, night, dusk: !night && (hr < 8 || hr >= 18) }; };
  nodes.forEach(n => {
    const h = hash(n.id), a = (h % 6283) / 1000, b = ((h >>> 12) % 3141) / 1000 - 1.57, r = 40 + (h >>> 22) % 260;
    n.x = r * Math.cos(a) * Math.cos(b); n.y = r * Math.sin(a) * Math.cos(b); n.z0 = r * Math.sin(b);
    n.z = 0; n.vx = n.vy = n.vz = 0;
  });

  // ---------------------------------------------------------------- DOM
  const ageDays = Math.round((Date.now() - VGShared.noon(DATA.date).getTime()) / VGShared.DAY_MS);
  const ageText = ageDays <= 0 ? "Analysed today" : ageDays === 1 ? "Analysed yesterday" : `Analysed ${ageDays} days ago`;
  const switchRow = (cls, title, hint, on) => `<label class="vg-switch"><input type="checkbox" class="${cls}" ${on ? "checked" : ""}><span class="vg-track" aria-hidden="true"></span>
    <span><b>${title}</b><span class="vg-muted">${hint}</span></span></label>`;
  root.classList.add("vg-root");
  if (opts.compact) root.classList.add("is-compact");
  if (MOBILE) root.classList.add("is-mobile");
  root.tabIndex = -1;
  const vgId = root.dataset.vgId = root.dataset.vgId || Math.random().toString(36).slice(2, 8);   // ids this graph owns: a note can hold several
  root.innerHTML = `
  <div class="vg-app">
    <aside class="vg-side" aria-label="Graph panels">
      <header class="vg-head">
        <div class="vg-title">Vault Graph</div>
        <div class="vg-sub-head">
          <span class="vg-badge ${ageDays > 8 ? "is-warn" : ""}" title="${esc(DATA.date)}">${esc(ageText)}</span>
          ${DATA.live ? `<span class="vg-badge is-live" title="Since the ${esc(DATA.date)} analysis: +${DATA.live.gained} / −${DATA.live.lost} links, ${plural(DATA.live.added, "new note")}, ${DATA.live.removed} removed.">${plural(DATA.live.gained + DATA.live.lost + DATA.live.added, "change")} since</span>` : ""}
        </div>
      </header>
      <div class="vg-tabs" role="tablist" aria-label="Panels">
        <button role="tab" class="vg-tab" id="vg-tab-insights-${vgId}" aria-controls="vg-panel-insights-${vgId}" data-tab="insights" aria-selected="true">Insights</button>
        <button role="tab" class="vg-tab" id="vg-tab-clusters-${vgId}" aria-controls="vg-panel-clusters-${vgId}" data-tab="clusters" aria-selected="false" tabindex="-1">Topics</button>
      </div>
      <div class="vg-panels">
        <section role="tabpanel" class="vg-panel" id="vg-panel-insights-${vgId}" aria-labelledby="vg-tab-insights-${vgId}" data-panel="insights"></section>
        <section role="tabpanel" class="vg-panel" id="vg-panel-clusters-${vgId}" aria-labelledby="vg-tab-clusters-${vgId}" data-panel="clusters" hidden>
          <input type="search" class="vg-input vg-cfilter" placeholder="Filter topics…" aria-label="Filter topics">
          <div class="vg-clusters vg-list"></div>
        </section>
      </div>
    </aside>
    <main class="vg-canvas">
      <span class="vg-sr" id="vg-cv-label-${vgId}">Graph of ${VGRules.noteCounts(nodes).notes} notes in ${plural(DATA.clusters.length, "topic")}.</span>
      <canvas class="vg-cv" role="img" aria-labelledby="vg-cv-label-${vgId}"></canvas>
      <div class="vg-hud" aria-hidden="true"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
        <div class="vg-hud-title"></div><div class="vg-hud-tele"></div><div class="vg-scan"></div></div>
      <button class="vg-viewhelp" hidden aria-expanded="false">How to read this</button>
      <div class="vg-viewcard" hidden role="note"></div>
      <div class="vg-lasso" hidden></div>
      <div class="vg-today" hidden><span class="vg-today-text"></span><button class="vg-btn vg-btn-sm vg-today-act"></button><button class="vg-ibtn vg-today-x" aria-label="Hide" title="Hide for this view">${icon("close", 12)}</button></div>
      <div class="vg-triage" hidden><span class="vg-triage-text"></span><button class="vg-btn vg-btn-sm vg-triage-prev" aria-label="Previous">‹</button><button class="vg-btn vg-btn-sm vg-triage-next">Next ›</button><button class="vg-btn vg-btn-sm vg-btn-ghost vg-triage-stop">Done</button></div>
      <div class="vg-dock" role="toolbar" aria-label="Celestial bodies">
        <button class="vg-dockbtn" data-body="star" aria-pressed="false" title="Star: a note or map; linked notes orbit it"><span>☀</span>Star</button>
        <button class="vg-dockbtn" data-body="planet" aria-pressed="false" title="Planet: a search; matching notes become moons"><span>◍</span>Planet</button>
        <button class="vg-dockbtn" data-body="binary" aria-pressed="false" title="Binary stars: two maps; shared notes sit between"><span>⚭</span>Binary</button>
        <button class="vg-dockbtn" data-body="blackhole" aria-pressed="false" title="Black hole: a filter; matching notes fall into a review queue"><span>●</span>Black hole</button>
        <button class="vg-dockbtn" data-body="repulsor" aria-pressed="false" title="Repulsor: push a topic away"><span>◎</span>Repulsor</button>
        <span class="vg-docksep"></span>
        <button class="vg-autobtn" data-auto="links" aria-pressed="true" title="Lines between linked notes">Links</button>
        <button class="vg-autobtn" data-auto="comets" aria-pressed="true" title="Notes from recent dailies trail tails">Comets</button>
        <button class="vg-autobtn" data-auto="wormholes" aria-pressed="true" title="Link suggestions as portals">Wormholes</button>
        <button class="vg-autobtn" data-auto="belt" aria-pressed="true" title="Notes to write as an asteroid belt">Belt</button>
        <button class="vg-autobtn" data-auto="nebula" aria-pressed="true" title="Unlinked notes as a nebula">Nebula</button>
        <button class="vg-autobtn" data-auto="grid" aria-pressed="true" title="Warped space grid">Grid</button>
        <button class="vg-autobtn" data-auto="motion" aria-pressed="true" title="Bodies orbit the galactic core and tug on each other">Orbits</button>
        <button class="vg-autobtn" data-auto="trails" aria-pressed="true" title="Faint trails behind bodies and the selected system's notes">Trails</button>
        <button class="vg-dockbtn vg-seedbtn" title="Propose bodies from the vault's maps, Context notes and project tags"><span>✦</span>Populate</button>
        <button class="vg-dockbtn vg-arrangebtn" title="Arrange the bodies on resonant orbits"><span>✺</span>Arrange</button>
        <span class="vg-docksep"></span>
        <button class="vg-dockbtn vg-shipbtn" aria-pressed="false" title="Ship mode: fly between systems"><span>➤</span>Ship</button>
        <button class="vg-dockbtn vg-pausebtn" aria-pressed="false" title="Pause the simulation (Space)"><span>❚❚</span>Pause</button>
        <button class="vg-dockbtn vg-warpbtn" title="Time warp: how fast orbits run"><span class="vg-warpval">1×</span>Warp</button>
      </div>
      <button class="vg-pausepill" hidden>❚❚ PAUSED · RESUME</button>
      <div class="vg-timebar" hidden><button class="vg-time-play" aria-label="Play">▶</button><input type="range" min="0" value="0" step="1" aria-label="Date"><b class="vg-time-label">Now</b><button class="vg-ibtn vg-time-close" aria-label="Close time-lapse" title="Back to now">✕</button></div>
      <div class="vg-missions" role="region" aria-label="Upkeep"></div>
      <div class="vg-toolbar" role="toolbar" aria-label="Graph controls">
        <button class="vg-ibtn vg-toggle" aria-label="Toggle panels" title="Toggle panels">${icon("menu")}</button>
        <button class="vg-searchbtn" aria-label="Search notes" title="Search (/ or Ctrl K)">${icon("search", 14)}<span>Search notes</span><kbd>/</kbd></button>
        <div class="vg-menuwrap">
          <button class="vg-ibtn vg-pickbtn" aria-haspopup="dialog" aria-expanded="false" title="Views and display (M)"><span class="vg-pickicon">${icon("hub", 16)}</span><span class="vg-pickname">Views</span><span class="vg-caret" aria-hidden="true">▾</span></button>
        </div>
        <div class="vg-seg vg-dimseg" role="group" aria-label="2D or 3D"><button class="vg-segbtn" data-dim="2d" aria-pressed="true" title="2D (3)">2D</button><button class="vg-segbtn" data-dim="3d" aria-pressed="false" title="3D (3)">3D</button></div>
        <button class="vg-nextbtn" hidden title="Go to it in Vault HQ"><i class="vg-nextdot" aria-hidden="true"></i><small>Next</small><b></b></button>
        <div class="vg-menuwrap"><button class="vg-ibtn vg-toolsbtn" aria-haspopup="menu" aria-expanded="false" aria-pressed="false" title="Select, save, time-lapse">${icon("layers")}<span class="vg-tlabel">Tools</span><span class="vg-caret" aria-hidden="true">▾</span></button>
          <div class="vg-menu vg-toolsmenu" role="menu" hidden></div></div>
        <span class="vg-toolsrc" hidden>   <!-- the tools themselves: the Tools menu and the phone's picker sheet press these -->
          <button class="vg-ibtn vg-lassobtn" aria-pressed="false" title="Lasso: drag a box to select notes (or Alt-drag)">${icon("lasso")}<span class="vg-tlabel">Select</span></button>
          <button class="vg-ibtn vg-savebtn" title="Save this view (it appears under Saved, and as a constellation in Cosmos)">${icon("star")}<span class="vg-tlabel">Save view</span></button>
          <button class="vg-ibtn vg-timebtn vg-maptime" aria-pressed="false" title="Time-lapse: the vault as it was, note by note (T)">${icon("clock")}<span class="vg-tlabel">Time-lapse</span></button>
        </span>
        <button class="vg-ibtn vg-gamebtn" aria-pressed="false" title="Upkeep (G)" aria-label="Upkeep">${icon("flag")}<span class="vg-tlabel">Upkeep</span><span class="vg-gamecount" hidden>0</span></button>
        <span class="vg-spacer"></span>
        <div class="vg-seg vg-depthseg vg-compact-only" role="group" aria-label="Local depth">
          <button class="vg-segbtn" data-depth="1" aria-pressed="true">1</button><button class="vg-segbtn" data-depth="2" aria-pressed="false">2</button>
        </div>
        <div class="vg-seg" role="group" aria-label="Zoom">
          <button class="vg-ibtn vg-zoomout" aria-label="Zoom out" title="Zoom out (−)">${icon("minus")}</button>
          <button class="vg-ibtn vg-zoomin" aria-label="Zoom in" title="Zoom in (+)">${icon("plus")}</button>
          <button class="vg-ibtn vg-fit" aria-label="Fit graph" title="Fit (0)">${icon("fit")}</button>
        </div>
      </div>
      <div class="vg-focusbar" hidden></div>
      <div class="vg-focusbar vg-pathbar" hidden></div>
      <div class="vg-vision" role="group" aria-label="Vision mode">
        <button class="vg-visbtn" data-vision="std" aria-pressed="true">STD</button><button class="vg-visbtn" data-vision="nv" aria-pressed="false">NV</button><button class="vg-visbtn" data-vision="thermal" aria-pressed="false" title="Thermal: where your dailies are active">THERMAL</button><button class="vg-visbtn" data-vision="crt" aria-pressed="false">CRT</button>
      </div>
      <section class="vg-lens" hidden aria-label="View"><header class="vg-lens-h"><b class="vg-lens-title"></b><span class="vg-muted vg-lens-sub"></span>
        <button class="vg-ibtn vg-lens-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></header><div class="vg-lens-body"></div></section>
      <div class="vg-picker-scrim" hidden></div>
      <section class="vg-picker" role="dialog" aria-label="Views" hidden>
        <div class="vg-sheet-grip" aria-hidden="true"></div>
        <header class="vg-picker-h"><input class="vg-picker-q" type="search" placeholder="Find a view…" aria-label="Find a view" autocomplete="off"><button class="vg-ibtn vg-picker-x" aria-label="Close">${icon("close")}</button></header>
        <div class="vg-picker-tabs" role="tablist" aria-label="Kinds of view"></div>
        <div class="vg-picker-body"><div class="vg-picker-tiles"></div>
        <section class="vg-ppanel" data-ppanel="health" hidden>
            <p class="vg-muted vg-lead">Turn one on to light up the notes it matches.</p>
            <div class="vg-overlays"></div><div class="vg-ovlist vg-list"></div>
            <div class="vg-series"></div>
          </section>
          <section class="vg-ppanel" data-ppanel="style" hidden>
            <div class="vg-field"><label class="vg-flabel" for="vg-size">Node size</label>
              <select id="vg-size" class="vg-select vg-size">
                <option value="bc">Influence (betweenness)</option><option value="recent">Daily mentions (${DATA.recent_days} days)</option></select></div>
            <div class="vg-field"><label class="vg-flabel" for="vg-color">Node colour</label>
              <select id="vg-color" class="vg-select vg-color">
                <option value="cluster">Topic</option>
                <option value="recent">Daily mentions (${DATA.recent_days} days)</option></select></div>
            <div class="vg-flabel">Layers</div>
            ${switchRow("vg-l-mocs", "Maps", `${plural(mocs.length, "map")}, drawn as hexagons on the topics they cover`, true)}
            ${switchRow("vg-l-wanted", "Notes to write", `${ghosts.length} notes you link to that don't exist yet (hollow)`)}
            ${switchRow("vg-l-people", "People", "Who is connected to which topics (diamonds)")}
            ${switchRow("vg-l-tasks", "Open tasks", "Badge with the number of unchecked tasks")}
            ${switchRow("vg-l-attention", "Needs attention", "A ring on notes with a problem to fix, in every view (a missing reference or a short note alone does not count)", true)}
            <div class="vg-flabel">Display</div>
            ${switchRow("vg-gaps", "Gap suggestions", "Dashed edges between related, unlinked notes", true)}
            ${switchRow("vg-leaves", "Collapse leaf notes", "Fold short notes into the note they hang from, as a +N badge")}
            ${switchRow("vg-cohesion", "Topic gravity", "Pull each topic's notes toward its centre", true)}
            ${switchRow("vg-isolated", "Show unlinked notes", "Notes with no links to other knowledge notes")}
            <div class="vg-field"><label class="vg-flabel" for="vg-hide">Hide the <b class="vg-hideN">0</b> most influential notes</label>
              <input id="vg-hide" type="range" class="vg-range vg-hide" min="0" max="25" value="0">
              <div class="vg-muted vg-hidestat">Removing the biggest hubs shows which topics only connect through them.</div></div>
            <div class="vg-flabel">Saved views</div>
            <div class="vg-saved"></div>
            <form class="vg-savedform"><input class="vg-input vg-savedname" placeholder="Name this view…" aria-label="Saved view name" maxlength="60">
              <button class="vg-btn" type="submit">${icon("plus", 14)} Save</button></form>
            <div class="vg-row-btns">
              <button class="vg-btn vg-tourbtn">${icon("sparkles", 14)} Take the tour</button>
              <button class="vg-btn vg-keysbtn">Keyboard shortcuts <kbd>?</kbd></button>
              <button class="vg-btn vg-randlayout">${icon("sparkles", 14)} Randomize layout</button>
              <button class="vg-btn vg-resetlayout" hidden>${icon("refresh", 14)} Reset layout</button>
              <button class="vg-btn vg-png">${icon("image", 14)} Save image</button>
            </div>
            <p class="vg-muted vg-help"><b>Mouse:</b> drag a note to move it · drag empty space to pan (3D: orbit, Shift to pan) · double-click to focus · Alt-drag to lasso</p>
            <p class="vg-muted vg-help"><b>Touch:</b> pinch to zoom · two fingers to pan · double-tap to focus · long-press to select</p>
            <p class="vg-muted vg-help"><b>Keys:</b> <kbd>/</kbd> or <kbd>Ctrl K</kbd> search · <kbd>Esc</kbd> back ·
              <kbd>Enter</kbd> open selected · <kbd>F</kbd> focus · <kbd>3</kbd> 3D · <kbd>N</kbd> neural · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>0</kbd> fit ·
              <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> walk to a neighbour (or pan) · <kbd>Tab</kbd> next neighbour</p>
          </section>
        </div>
        <div class="vg-picker-tools"></div>
      </section>
      <div class="vg-tip" role="tooltip"></div>
      <div class="vg-legend" aria-label="Legend"></div>
      <div class="vg-status" aria-live="polite"></div>
      <div class="vg-toasts" aria-live="polite"></div>
    </main>
    <aside class="vg-inspector" aria-label="Selected note" hidden></aside>
  </div>
  <div class="vg-palette" hidden>
    <div class="vg-palette-box" role="dialog" aria-modal="true" aria-label="Search notes">
      <div class="vg-palette-input">${icon("search")}<input type="text" class="vg-pq" placeholder="Search notes and topics…" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="vg-palette-list" role="listbox"></div>
      <div class="vg-palette-foot vg-muted"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> go to</span><span><kbd>Shift Enter</kbd> highlight all</span></div>
    </div>
  </div>`;
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const cssCache = new Map();
  const css = v => { let s = cssCache.get(v); if (s === undefined) { s = getComputedStyle(root).getPropertyValue(v).trim(); cssCache.set(v, s); } return s; };
  const wrap = $(".vg-canvas"), cv = $(".vg-cv"), tip = $(".vg-tip");
  let ctx = cv.getContext("2d");   // let: the radar renders its still layer to an off-screen canvas with the same helpers

  // ---------------------------------------------------------------- state
  const st = {
    gaps: true, leaves: false, isolated: false, three: false, angles: {}, view: "2d", vision: "std", sizeBy: "bc", colorBy: "cluster",
    hidden: new Set(), hiddenClusters: new Set(), overlays: new Set(), focus: null, focusDepth: 1, focusDist: null,
    selected: null, hover: null, highlight: null, highlightLabel: null, preset: "explore", tab: "insights", path: null,
    cohesion: true, layers: { wanted: false, people: false, tasks: false, mocs: true, attention: true }, multi: null, lasso: false, quietFocus: false,
  };
  const cam = { k: 1, tx: 0, ty: 0, yaw: 0.6, pitch: -0.35, cx: 0, cy: 0, cz: 0, d: 0, spin: null };   // d: how far the camera has flown in, in world units
  let W = 0, H = 0, alpha = 1, dirty = true, tween = null, raf = 0, destroyed = false, fitted = false;
  let persistTimer = 0;   // declared before anything that can save during mount
  let morph = null, lastInteract = 0;
  const neural = () => st.view === "neural";
  const isCosmos = () => st.view === "cosmos";

  const baseVisible = n => !st.hidden.has(n.id) && !st.hiddenClusters.has(n.cluster) && (st.isolated || !n.isolated || isCosmos())
    && !(st.leaves && leafOf[n.id]) && (!n.person || st.layers.people) && (!n.ghost || st.layers.wanted || isCosmos()) && (!n.moc || st.layers.mocs) && (!replay || replay.shown.has(n.id));
  const visible = n => baseVisible(n) && (!st.focusDist || st.focusDist.has(n.id));
  const kindVisible = k => k === "link" || ((k === "gap" || k === "similar") && st.gaps) || (k === "person" && st.layers.people) || (k === "wanted" && st.layers.wanted) || (k === "moc" && st.layers.mocs);
  let active = [], visLinks = [], visSet = new Set();
  const metric = n => n[st.sizeBy] || 0;
  let maxMetric = 1, labelled = [], maxColor = 1, maxRecent = 1;
  // How "live" a note is, 0-1: edited recently (fades over about a week) or named in recent dailies.
  // The neural view's pulses, lobe glow and lobe health all read this.
  const activity = n => special(n) ? 0 : Math.min(1, Math.exp(-(n.age || 0) / 7) + 0.6 * (n.recent || 0) / maxRecent);
  let pulseLinks = [], pulseCum = [], pulseTotal = 0, lobeStats = {};
  function rebuildActivity() {
    pulseLinks = []; pulseCum = []; pulseTotal = 0;
    for (const l of visLinks) {
      if (l.kind !== "link") continue;
      const w = Math.max(activity(l.s), activity(l.t));
      if (w < 0.05) continue;
      pulseTotal += w * w; pulseLinks.push(l); pulseCum.push(pulseTotal);   // squared: the hottest links fire most
    }
    lobeStats = {};
    for (const n of active) {
      if (special(n) || n.cluster < 0) continue;
      const g = lobeStats[n.cluster] = lobeStats[n.cluster] || { notes: 0, stale: 0, fresh: 0, tasks: 0, act: 0 };
      g.notes++; g.tasks += n.tasks || 0; g.act += activity(n);
      if (staleFor(n, Q.stale_days)) g.stale++;
      if (n.age <= 7) g.fresh++;
    }
    Object.values(lobeStats).forEach(g => { g.act /= g.notes; });
  }
  function rebuild(reheat) {
    attnCache = null;
    active = nodes.filter(visible);
    const ids = new Set(active.map(n => n.id));
    visLinks = links.filter(l => ids.has(l.s.id) && ids.has(l.t.id) && kindVisible(l.kind));
    visSet = new Set(visLinks);
    maxMetric = Math.max(1e-9, ...active.filter(n => !special(n)).map(metric));
    maxColor = Math.max(1, ...active.map(n => n[st.colorBy] || 0));
    maxRecent = Math.max(1, ...active.map(n => n.recent || 0));
    rebuildActivity();
    labelled = active.filter(n => !special(n) && metric(n) > 0).sort((a, b) => metric(b) - metric(a)).slice(0, UI.size.labelTop).map(n => n.id);
    if (st.selected && !ids.has(st.selected)) select(null);
    if (reheat && !neural() && !mapView()) alpha = Math.max(alpha, 0.5);
    if (neural() && !(replay && replay.playing)) brainLayout(false);
    if (mapView() && !(replay && replay.playing)) { if (morph) layoutDue = true; else applyMapLayout(false); }   // mid-transition: when it lands
    if (isCosmos()) cosmosCapture();
    renderLegend(); renderStatus(); renderHud();
    dirty = true; kick();
  }
  // Replay: notes appear in the order they were first written, like Obsidian's own graph animation.
  // Each one pops in (overshoots a little, then settles) as it arrives.
  let replay = null, layoutDue = false;
  const popAt = new Map();
  const popScale = n => {
    const t = popAt.get(n.id); if (t == null) return 1;
    const u = (performance.now() - t) / 450; if (u >= 1) { popAt.delete(n.id); return 1; }
    const c = 1.70158, v = u - 1; return Math.max(0.05, 1 + (c + 1) * v * v * v + c * v * v);
  };
  const worldRadius = n => popScale(n) * baseRadius(n);
  const baseRadius = n => n.moc ? 9 : n.ghost ? 3 + 2.2 * Math.sqrt(n.from.length) : n.person ? 4 + Math.sqrt(n.outlinks)
    : 3 + 12 * Math.sqrt(metric(n) / maxMetric) + (st.leaves && leafCount[n.id] ? 2 : 0);
  const HEAT = [[245, 158, 11], [249, 115, 22], [239, 68, 68]];
  const heat = v => {   // grey -> amber -> red on a log scale
    if (v <= 0) return css("--vg-cold");
    const t = Math.log1p(v) / Math.log1p(maxColor);
    const mix = (a, b, u) => a.map((x, i) => Math.round(x + (b[i] - x) * u));
    const c = t < 0.5 ? mix(HEAT[0], HEAT[1], t * 2) : mix(HEAT[1], HEAT[2], (t - 0.5) * 2);
    return `rgb(${c.join(",")})`;
  };
  const THERMAL = [[30, 27, 75], [88, 28, 135], [190, 24, 93], [239, 68, 68], [251, 191, 36], [254, 249, 195]];
  const thermal = v => {   // FLIR-style: cold indigo -> hot white, by recent daily mentions
    const t = Math.min(1, Math.log1p(v) / Math.log1p(maxRecent)) * (THERMAL.length - 1), i = Math.min(THERMAL.length - 2, Math.floor(t)), u = t - i;
    return `rgb(${THERMAL[i].map((x, j) => Math.round(x + (THERMAL[i + 1][j] - x) * u)).join(",")})`;
  };
  function fillOf(n) {
    if (n.person) return css("--vg-person");
    if (n.ghost) return css("--vg-muted");
    if (n.moc && !neural()) return colorOf(n.cluster);
    if (neural()) {
      if (st.vision === "thermal") return thermal(n.recent || 0);
      if (st.vision === "nv") { const g = Math.round(110 + 145 * Math.sqrt(metric(n) / maxMetric)); return `rgb(${Math.round(g * 0.35)},${g},${Math.round(g * 0.45)})`; }
      return st.colorBy === "cluster" ? neonOf(n.cluster) : heat(n[st.colorBy] || 0);
    }
    return st.colorBy === "cluster" ? colorOf(n.cluster) : heat(n[st.colorBy] || 0);
  }
  const overlayHit = n => st.overlays.size > 0 && [...st.overlays].some(k => OVERLAYS[k].test(n));
  const lit = () => {
    if (st.path) return st.path.set;
    if (st.hover) return new Set([st.hover, ...nb[st.hover], ...(peopleOf[st.hover] || [])]);
    if (st.multi) return st.multi;
    if (st.selected && byId[st.selected].moc && st.highlight) return st.highlight;   // a map with its missing notes lit
    if (st.selected && SCENES[st.view] && SCENES[st.view].lit && mapCache[st.view] && !special(byId[st.selected])) { const s = SCENES[st.view].lit(st.selected); if (s) return s; }
    if (st.selected && st.view === "foodweb" && mapCache.foodweb && !special(byId[st.selected])) return new Set([st.selected, ...dependents(st.selected)]);   // everything that relies on it
    if (st.selected) return new Set([st.selected, ...nb[st.selected], ...(peopleOf[st.selected] || []),
      ...links.filter(l => (l.kind === "person" || l.kind === "wanted") && (l.s.id === st.selected || l.t.id === st.selected)).map(l => l.s.id === st.selected ? l.t.id : l.s.id)]);
    if (st.highlight) return st.highlight;
    if (st.overlays.size) return new Set(active.filter(overlayHit).map(n => n.id));
    return null;
  };

  // ---------------------------------------------------------------- physics (d3-force semantics, O(n²) repulsion)
  const LINK_SHAPE = { link: [30, null], gap: [70, 0.02], similar: [70, 0.02], person: [55, 0.06], wanted: [35, 0.25], moc: [70, 0.015] };
  function tick() {
    // one non-finite position would spread through the repulsion pass to every note: reset it first
    for (const a of active) if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(a.z)) { const h = hash(a.id); a.x = (h % 400) - 200; a.y = ((h >>> 9) % 400) - 200; a.z = 0; a.vx = a.vy = a.vz = 0; }
    const n = active.length, three = st.three;
    const rad = active.map(worldRadius);
    if (isCosmos()) repelNear(rad); else
    for (let i = 0; i < n; i++) {
      const a = active[i];
      for (let j = i + 1; j < n; j++) {
        const b = active[j];
        let dx = a.x - b.x, dy = a.y - b.y, dz = three ? a.z - b.z : 0, l2 = dx * dx + dy * dy + dz * dz;
        if (l2 < 1) { dx = ((i * 31 + j) % 7) - 3 || 1; l2 = dx * dx; }
        let w = 40 * alpha / l2;
        // collision: overlapping nodes push apart firmly (same pass, so no extra O(n²) cost)
        const minD = rad[i] + rad[j] + 2;
        if (l2 < minD * minD) w += (minD - Math.sqrt(l2)) / Math.sqrt(l2) * 0.35;
        a.vx += dx * w; a.vy += dy * w; b.vx -= dx * w; b.vy -= dy * w;
        if (three) { a.vz += dz * w; b.vz -= dz * w; }
      }
    }
    if (st.cohesion) {   // cluster gravity: a gentle pull toward each topic's centre keeps clusters legible
      const cen = {};
      for (const a of active) {
        if (a.cluster < 0) continue;
        const c = cen[a.cluster] || (cen[a.cluster] = { x: 0, y: 0, z: 0, n: 0 });
        c.x += a.x; c.y += a.y; c.z += a.z; c.n++;
      }
      for (const a of active) {
        const c = cen[a.cluster]; if (!c || c.n < 3) continue;
        const k = 0.012 * alpha;
        a.vx += (c.x / c.n - a.x) * k; a.vy += (c.y / c.n - a.y) * k; if (three) a.vz += (c.z / c.n - a.z) * k;
      }
    }
    for (const l of visLinks) {
      const s = l.s, t = l.t, shape = LINK_SHAPE[l.kind] || LINK_SHAPE.gap;
      if (s.orb || t.orb) continue;   // cosmos: orbits are pure gravity
      const ds = nb[s.id].size || 1, dt = nb[t.id].size || 1;
      const dist = shape[0], strength = shape[1] == null ? 1 / Math.min(ds, dt) : shape[1], bias = ds / (ds + dt);
      let dx = t.x + t.vx - s.x - s.vx, dy = t.y + t.vy - s.y - s.vy, dz = three ? t.z + t.vz - s.z - s.vz : 0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = (d - dist) / d * alpha * strength;
      dx *= f; dy *= f; dz *= f;
      t.vx -= dx * bias; t.vy -= dy * bias; s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
      if (three) { t.vz -= dz * bias; s.vz += dz * (1 - bias); }
    }
    if (isCosmos()) cosmosForces();
    for (const a of active) {
      if (a.pin) { a.x = a.pin[0]; a.y = a.pin[1]; a.z = three ? a.pin[2] : 0; a.vx = a.vy = a.vz = 0; continue; }   // being dragged
      if (a.orb) continue;   // moved by stepOrbits
      if (!(isCosmos() && (a.isolated || a.ghost || capture.has(a.id)))) { a.vx -= a.x * 0.04 * alpha; a.vy -= a.y * 0.04 * alpha; }   // gravity keeps small components close
      a.vx *= 0.6; a.vy *= 0.6; a.x += a.vx; a.y += a.vy;
      if (three) { a.vz -= a.z * 0.04 * alpha; a.vz *= 0.6; a.z += a.vz; } else { a.z = 0; a.vz = 0; }
    }
    alpha *= drag && drag.node ? 1 : 0.977;   // keep the layout live while a node is held
  }

  // Cosmos never settles (orbits keep moving), so the all-pairs pass would run forever. Bodies shape the
  // layout there; local repulsion + collision within a 3x3 block of 110-unit cells is all it needs.
  function repelNear(rad) {
    const CELL = 110, grid = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    active.forEach((a, i) => { if (a.orb) return; const k = key(Math.floor(a.x / CELL), Math.floor(a.y / CELL)); let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i); });
    for (let i = 0; i < active.length; i++) {
      const a = active[i]; if (a.orb) continue;
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(key(cx + ox, cy + oy)); if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i || active[j].orb || a.orb) continue;
          const b = active[j]; let dx = a.x - b.x, dy = a.y - b.y, l2 = dx * dx + dy * dy;
          if (l2 < 1) { dx = ((i * 31 + j) % 7) - 3 || 1; l2 = dx * dx; }
          let w = 40 * alpha / l2;
          const minD = rad[i] + rad[j] + 2;
          if (l2 < minD * minD) w += (minD - Math.sqrt(l2)) / Math.sqrt(l2) * 0.35;
          a.vx += dx * w; a.vy += dy * w; b.vx -= dx * w; b.vy -= dy * w;
        }
      }
    }
  }

  // ---------------------------------------------------------------- neural layout
  // Clusters become lobes on an ellipsoid "cortex" (left/right hemispheres alternate); the most
  // influential bridge notes sit in an inner core, so connections between lobes arc through it.
  const BRAIN_R = 260;
  const BRAIN_SIZE = 320;   // the long half-axis: a brain's front-to-back, in world units
  let neuralLobes = {};     // topic -> which lobe, by number (the shell's tint reads it)
  const LOBE_NUM = { frontal: 0, parietal: 1, temporal: 2, occipital: 3 };
  // a direction, out to the folded surface of the cerebrum
  const onCortex = (d, scale = 1) => { const L = Math.hypot(d[0], d[1], d[2]) || 1, c = VGScience.cortexAt(d[0], d[1], d[2]), r = c.r * BRAIN_SIZE * scale; return [d[0] / L * r, d[1] / L * r, d[2] / L * r]; };
  let lobeDir = {};   // cluster id -> unit direction of its lobe on the shell
  function brainLayout(animate) {
    const R = BRAIN_R, bridgeNotes = nodes.filter(n => n.bridge && !special(n)).map(n => n.id);
    const core = new Set([...bridgeNotes, ...ranked].slice(0, Math.max(18, bridgeNotes.length)));
    const cl = topicOrder(), centre = {};
    // topics go to lobes in the lobes' real shares of cortex, spread apart within each, on both hemispheres
    const noteCount = {}; active.forEach(n => { if (!special(n) && n.cluster >= 0) noteCount[n.cluster] = (noteCount[n.cluster] || 0) + 1; });
    const inLobe = VGScience.assignLobes(cl.map(c => ({ id: c.id, size: noteCount[c.id] || 1 }))), perLobe = {}; neuralLobes = {};
    cl.forEach(c => { const lobe = inLobe[c.id]; (perLobe[lobe] = perLobe[lobe] || []).push(c.id); neuralLobes[c.id] = LOBE_NUM[lobe]; });
    Object.entries(perLobe).forEach(([lobe, ids]) => { const spots = VGScience.lobeSpots(lobe, ids.length); ids.forEach((id, i) => { centre[id] = spots[i]; }); });
    // lobes go by size, so a new order alone changes nothing: randomized, the topics swap the places themselves
    if (layoutSeed()) { const ids = Object.keys(centre), slots = ids.map(id => [centre[id], neuralLobes[id]]).sort((x, y) => seededHash(String(x[0])) - seededHash(String(y[0]))); ids.forEach((id, i) => { centre[id] = slots[i][0]; neuralLobes[id] = slots[i][1]; }); }
    lobeDir = centre;
    const shell = onCortex;
    const members = {};
    active.forEach(n => { if (!core.has(n.id) && !special(n) && n.cluster >= 0 && centre[n.cluster]) (members[n.cluster] = members[n.cluster] || []).push(n); });
    Object.entries(members).forEach(([c, ms]) => {
      ms.sort(byInfluence);
      const cdir = centre[c], up = Math.abs(cdir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = [cdir[1] * up[2] - cdir[2] * up[1], cdir[2] * up[0] - cdir[0] * up[2], cdir[0] * up[1] - cdir[1] * up[0]];
      const ul = Math.hypot(...u); u.forEach((v, i) => u[i] = v / ul);
      const v = [cdir[1] * u[2] - cdir[2] * u[1], cdir[2] * u[0] - cdir[0] * u[2], cdir[0] * u[1] - cdir[1] * u[0]];
      const spread = 0.04 + 0.26 * Math.sqrt(ms.length / 110);
      ms.forEach((n, j) => {   // golden-angle spiral on the tangent plane around the lobe centre
        const rad = spread * Math.sqrt((j + 0.5) / ms.length), ang = j * 2.399963;
        const d = [0, 1, 2].map(k => cdir[k] + u[k] * Math.cos(ang) * rad + v[k] * Math.sin(ang) * rad);
        // a cell in the cortical sheet, on the near side of the fissure: the two hemispheres don't share grey matter
        if (Math.sign(d[0]) !== Math.sign(cdir[0]) || Math.abs(d[0]) < 0.1) d[0] = Math.sign(cdir[0] || 1) * Math.max(0.1, Math.abs(d[0]));
        const depth = 0.965 + 0.05 * ((hash(n.id) % 100) / 100);
        [n.bx, n.by, n.bz] = shell(d, depth);
      });
    });
    let ci = 0;
    active.forEach(n => {
      if (core.has(n.id)) {   // inner core: a small sphere of bridge notes
        // the notes everything passes through: the thalamus, the brain's relay, a pair of ovals either side of the midline
        const k = ci++, y = 1 - (k + 0.5) / core.size * 2, rr = Math.sqrt(1 - y * y), th = k * 2.399963, side = k % 2 ? 1 : -1;
        n.bx = side * BRAIN_SIZE * 0.1 + Math.cos(th) * rr * BRAIN_SIZE * 0.085; n.by = BRAIN_SIZE * 0.04 + y * BRAIN_SIZE * 0.08; n.bz = -BRAIN_SIZE * 0.06 + Math.sin(th) * rr * BRAIN_SIZE * 0.14;
      } else if (n.moc && centre[n.cluster]) {   // a map hovers just outside the lobe it maps
        [n.bx, n.by, n.bz] = shell(centre[n.cluster], 1.24);
      } else if (!special(n) && (n.cluster < 0 || !centre[n.cluster])) {   // notes with no topic: the cerebellum, under and behind
        const h = hash(n.id), C = VGScience.CEREBELLUM, a = (h % 6283) / 1000, b = ((h >>> 12) % 3141) / 1000 - 1.57;
        n.bx = (C.cx + Math.cos(a) * Math.cos(b) * C.rx) * BRAIN_SIZE; n.by = (C.cy + Math.sin(b) * C.ry) * BRAIN_SIZE; n.bz = (C.cz + Math.sin(a) * Math.cos(b) * C.rz) * BRAIN_SIZE;
      } else if (n.bx == null || special(n)) {   // people and notes to write: a halo outside the skull, since neither is a cell of this brain
        const h = hash(n.id), a = (h % 6283) / 1000, b = ((h >>> 12) % 3141) / 1000 - 1.57;
        const s = n.person ? 1.42 : n.ghost ? 1.3 : 1.22;
        [n.bx, n.by, n.bz] = shell([Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)], s);
      }
    });
    const depth = st.angles && st.angles.neural === "flat" ? 0 : 1;   // the 2D switch: the same lobes, with no depth
    if (animate) morphTo(n => n.bx == null ? null : [n.bx, n.by, n.bz * depth], 1400);   // hidden notes stay where they are
    else active.forEach(n => { if (!morph) { n.x = n.bx; n.y = n.by; n.z = n.bz * depth; } });
  }
  function morphTo(target, ms) {   // smooth position transition between layouts
    const from = new Map(nodes.map(n => [n.id, [n.x, n.y, n.z]]));
    const to = new Map(nodes.map(n => [n.id, target(n) || [n.x, n.y, n.z]]));
    morph = { from, to, t0: performance.now(), ms: reducedMotion() ? 1 : ms };
    alpha = 0; kick();
  }

  // ---------------------------------------------------------------- camera
  const P = new Map();   // id -> {x, y, s, depth, r, a}
  let attnCache = null;   // id -> how many problems (VGActions.attention); worked out when first drawn, dropped when the notes or data change
  const rot = () => [Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch)];
  function proj(x, y, z, R) {   // world -> screen (or null when behind the camera)
    x -= cam.cx; y -= cam.cy; let s = 1, depth = 0;
    if (st.three) {
      z -= cam.cz;
      const [cy, sy, cp, sp] = R, x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp - cam.d;
      if (UI.size.focal + z2 < UI.size.near) return null;
      s = UI.size.focal / (UI.size.focal + z2); x = x1 * s; y = y2 * s; depth = z2;
    } else if (cam.turn) { const t = x; x = -y; y = t; }   // 2D in a tall pane: the picture turned a quarter, to fill it
    return { x: W / 2 + cam.tx + x * cam.k, y: H / 2 + cam.ty + y * cam.k, s: s * cam.k, depth };
  }
  function project() {
    P.clear();
    const R = rot();
    for (const n of active) { const p = proj(n.x, n.y, n.z, R); if (p) P.set(n.id, p); }
  }
  let lastFit = null, refitOnSettle = null;   // refitOnSettle: frame these again once the layout stops moving
  function fit(pred, ms) {
    lastFit = pred || null; cam.userMoved = false;
    const pick = active.filter(n => !pred || pred(n));
    if (!pick.length || !W) return;
    // 2D in a tall pane (a phone): a layout clearly wider than tall is drawn turned a quarter, so it fills the screen.
    // Display only: the layout (shared with the other devices) stays as it is.
    // A small pane frames the core (the middle 94% of notes each way): a few outliers would otherwise shrink the whole graph.
    const core = W < 520 && pick.length > 40, span = vs => { if (!core) return [Math.min(...vs), Math.max(...vs)]; const o = vs.slice().sort((p, q) => p - q); return [o[Math.floor(o.length * 0.03)], o[Math.ceil(o.length * 0.97) - 1]]; };
    { const [a, b] = span(pick.map(n => n.x)), [c, d] = span(pick.map(n => n.y));
      cam.turn = st.view === "2d" && !st.three && H > W * 1.2 && (b - a) > (d - c) * 1.2 ? 1 : 0; }
    const saved = { k: cam.k, tx: cam.tx, ty: cam.ty, cx: cam.cx, cy: cam.cy, cz: cam.cz, d: cam.d }; cam.d = 0;   // framed from the home position, and the camera flies back to it
    // In 3D / neural, rotation turns the world around the pivot (cx, cy, cz). Put the pivot at the centre of the
    // notes being framed, so rotating spins them in place instead of swinging them round a far-off point.
    let pivot = null;
    if (st.three) {
      let sx = 0, sy = 0, sz = 0;
      pick.forEach(n => { sx += n.x || 0; sy += n.y || 0; sz += n.z || 0; });
      pivot = { cx: sx / pick.length, cy: sy / pick.length, cz: sz / pick.length };
      Object.assign(cam, pivot);
    }
    // real perspective needs room: stand back until the nearest note is still well in front of the camera, or it fills the screen
    let homeD = 0; if (pivot && glOn()) { let rad = 0; for (const n of pick) rad = Math.max(rad, Math.hypot((n.x || 0) - pivot.cx, (n.y || 0) - pivot.cy, (n.z || 0) - pivot.cz)); homeD = -Math.max(0, rad * 1.1 - UI.size.focal * 0.62); }
    cam.d = homeD; glHome = homeD;
    cam.k = 1; cam.tx = 0; cam.ty = 0;
    project();
    const onScreen = pick.map(n => P.get(n.id)).filter(Boolean);
    let [x0, x1] = onScreen.length ? span(onScreen.map(p => p.x)) : [Infinity, -Infinity], [y0, y1] = onScreen.length ? span(onScreen.map(p => p.y)) : [Infinity, -Infinity];
    if (mapView() && pick.length) ((mapCache[st.view] || {}).bounds || []).forEach(([x, y, z]) => { const p = proj(x, y, z || 0, rot()); if (!p) return;   // the scene's own outline (roof, slab, a strand in space...)
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    Object.assign(cam, saved);
    if (x0 === Infinity) return;
    // framed below the overlay line under the toolbar, and below the today strip too when this view has one, so nothing
    // sits behind them: the CSS's own numbers (--vg-under-bar, --vg-today-h), read live since they change with the pane's size
    const line = v => parseFloat(getComputedStyle(wrap).getPropertyValue(v)) || 0;
    const padTop = opts.compact ? 48 : line("--vg-under-bar") + 12 + (!replay && !todayHidden.has(st.view) && todayFor(st.view) ? line("--vg-today-h") : 0), pad = opts.compact || W < 500 ? 12 : 40;
    // a scene drawn through the iso kit: frame the turned, tilted picture, and move the camera in flat units
    const Mi = isoScene(), isoOn = !!Mi;
    if (isoOn) { let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      cam.k = 1; cam.tx = 0; cam.ty = 0; project();
      // the notes, plus the scene's own outline (mapCache[view].bounds: flat [x, y] corners of floors, walls...)
      const pts = pick.map(n => P.get(n.id)).filter(Boolean), Rr = rot();
      ((mapCache[st.view] || {}).bounds || []).forEach(([x, y]) => { const q = proj(x, y, 0, Rr); if (q) pts.push(q); });
      Object.assign(cam, saved);
      pts.forEach(q => { const u = q.x - W / 2, v = q.y - H / 2, X = Mi[0] * u + Mi[1] * v, Y = Mi[2] * u + Mi[3] * v;
        a0 = Math.min(a0, X); a1 = Math.max(a1, X); b0 = Math.min(b0, Y - 40); b1 = Math.max(b1, Y + 20); });
      if (a0 === Infinity) return;
      const k = Math.min(opts.compact ? 1.8 : 4, Math.max(0.05, Math.min((W - 2 * pad) / Math.max(a1 - a0, 1), (H - padTop - pad) / Math.max(b1 - b0, 1))));
      const cx = (a0 + a1) / 2 * k, cy = (b0 + b1) / 2 * k - (padTop - pad) / 2, det = Mi[0] * Mi[3] - Mi[1] * Mi[2];   // flat offset whose angled image is -(cx, cy)
      animateTo({ k, tx: -(Mi[3] * cx - Mi[1] * cy) / det, ty: -(-Mi[2] * cx + Mi[0] * cy) / det }, ms == null ? 500 : ms);
      return;
    }
    // what sits over the canvas is off limits too: the Cosmos dock along the bottom, the Today panel down the side
    const padB = isCosmos() && !opts.compact ? 96 : pad, padR = root.classList.contains("show-missions") && W >= 760 ? 330 : pad;
    const k = Math.min(opts.compact ? 1.8 : 4, Math.max(0.05, Math.min((W - pad - padR) / Math.max(x1 - x0, 1), (H - padTop - padB) / Math.max(y1 - y0, 1))));
    animateTo({ k, tx: -((x0 + x1) / 2 - W / 2) * k - (padR - pad) / 2, ty: -((y0 + y1) / 2 - H / 2) * k + (padTop - padB) / 2, ...(pivot || {}), d: homeD }, ms == null ? 500 : ms);
  }
  // the part of the canvas no panel covers, as its centre: the inspector (a bottom sheet in a narrow pane, a side panel
  // in a wide one) and a lens sitting beside the view
  function visibleCentre() {
    const c = cv.getBoundingClientRect(), sheet = $(".vg-inspector"), lens = $(".vg-lens");
    let x0 = 0, x1 = W, y1 = H;
    if (!sheet.hidden) { if (narrow()) y1 = H - Math.min(sheet.offsetHeight || H * 0.55, H * 0.55);
      else { const r = sheet.getBoundingClientRect(); if (r.left > c.left + W / 2) x1 = Math.min(W, r.left - c.left); } }
    if (!lens.hidden && lensBeside()) x0 = Math.max(0, Math.min(W / 2, lens.getBoundingClientRect().right - c.left));
    return { x: (x0 + x1) / 2, y: y1 / 2 };
  }
  function centreOn(id, zoom) {
    const n = byId[id], v = visibleCentre();
    if (neural() && n) {   // fly to it: pivot the orbit onto the note and swing it round to face you
      const yaw = Math.atan2(-(n.x), -(n.z)) + Math.PI;
      animateTo({ k: Math.max(cam.k, zoom || 1.5), tx: v.x - W / 2, ty: v.y - H / 2, cx: n.x, cy: n.y, cz: n.z, yaw: nearAngle(cam.yaw, yaw), pitch: -0.2 }, 1100);
      return;
    }
    project();
    const p = P.get(id); if (!p) return;
    const k = Math.max(cam.k, zoom || 2.5), r = k / cam.k;
    animateTo({ k, tx: (cam.tx - (p.x - W / 2)) * r - (W / 2 - v.x), ty: (cam.ty - (p.y - H / 2)) * r - (H / 2 - v.y) }, 500);
  }
  const nearAngle = (from, to) => from + ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  function zoomBy(f) {
    if (glOn()) { cam.userMoved = true; animateTo({ d: Math.max(glHome - 1800, Math.min(UI.size.focal + 1400, cam.d + Math.log(f) * 0.9 * Math.max(90, Math.abs(UI.size.focal - cam.d)))) }, 240); return; }
    const k = Math.min(12, Math.max(0.03, cam.k * f)), r = k / cam.k;
    cam.userMoved = true; animateTo({ k, tx: cam.tx * r, ty: cam.ty * r }, 200);
  }
  const TWEEN_KEYS = ["k", "tx", "ty", "cx", "cy", "cz", "yaw", "pitch", "d"];
  function animateTo(target, ms) {
    if (reducedMotion()) ms = 1;
    const from = {}; TWEEN_KEYS.forEach(k => from[k] = cam[k]);
    tween = { from, to: { ...from, ...target }, t0: performance.now(), ms: Math.max(ms, 1) };
    kick();
  }

