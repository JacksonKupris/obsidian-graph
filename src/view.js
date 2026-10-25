// vault_graph_view.js - shared renderer for the Vault Graph (standalone HTML page and Obsidian plugin).
// Assembled by _scripts/vault_graph.py; edit here, then re-run it (with --build-plugin for the plugin).
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
//   opts.embed                          optional: inside a note or a home-screen card -- the wheel and one-finger
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
  const PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#dc2626", "#ca8a04", "#db2777",
                   "#4f46e5", "#059669", "#b45309", "#7c3aed", "#0d9488", "#be123c", "#65a30d", "#c026d3"];
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
  const RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reducedNow = !!(RM && RM.matches);
  const onReduced = e => { reducedNow = e.matches; };
  if (RM && RM.addEventListener) RM.addEventListener("change", onReduced);   // removed in destroy()
  const reducedMotion = () => reducedNow;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const colorOf = c => (c < 0 || c >= PALETTE.length) ? "#a8a29e" : PALETTE[c];
  const neonOf = c => (c < 0 || c >= NEON.length) ? "#94a3b8" : NEON[c];
  const clusterById = Object.fromEntries(DATA.clusters.map(c => [c.id, c]));
  const clusterName = c => clusterById[c] ? (clusterById[c].label || clusterById[c].name) : "Unclustered";
  const clusterTag = c => clusterById[c] ? `C${c} · ${clusterName(c)}` : "unclustered";
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
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
    city: '<path d="M3 21V10h5v11M8 21V4h7v17M15 21v-8h6v8M2 21h20M10.5 8h2M10.5 12h2M10.5 16h2"/>',
    cloud: '<path d="M7 18a4 4 0 1 1 .6-7.96A6 6 0 0 1 19 11a3.5 3.5 0 0 1-.5 7Z"/><path d="m11 20-1 2M15 20l-1 2"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8"/>',
    rings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7Z"/>',
    castle: '<path d="M4 21V9h3V6h2v3h2V4h2v5h2V6h2v3h3v12Z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 4-11.5 7.5"/>',
    ripple: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 10c0-3 2.5-5 6-5 0 3.5-2.5 5-6 5Z"/><path d="M7 21h10"/>',
    palace: '<path d="M3 21h18M4 10h16M12 3 3 8h18Z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    reviewed: '<path d="M20 6 9 17l-5-5"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
    folder: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  };
  const icon = (name, size) => `<svg class="vg-ic" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // ---------------------------------------------------------------- data
  // wanted notes (linked to, never written) become ghost nodes; people arrive as nodes from the data
  const ghosts = (DATA.wanted || []).map(w => ({ id: w.id, name: w.name, ghost: true, from: w.refs, creatable: w.creatable, cluster: -1, bc: 0,
    folder: "not written yet", mentions: 0, recent: 0, opens: 0, opens90: 0, inlinks: w.refs.length, outlinks: 0, broken: 0,
    tasks: 0, words: 0, age: 0, refs: true, isolated: false }));
  const nodes = DATA.nodes.concat(ghosts), byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const special = n => n.person || n.ghost || n.moc;
  const byImportance = (a, b) => importance(b) - importance(a), byInfluence = (a, b) => (b.bc || 0) - (a.bc || 0);   // most relied-on / most central first
  // maps of content: which MOC maps each cluster, and what it misses
  const mocs = (DATA.mocs || []).filter(m => !m.nav), mocOf = {};
  mocs.forEach(m => m.clusters.forEach(c => { if (!(c in mocOf)) mocOf[c] = VGRules.mapForCluster(mocs, c); }));   // first map wins (shared rule)
  // On a map = the map links the note or a same-name copy of it (shared rule, vault_graph_rules.js), so the
  // graph never keeps suggesting a note the map already has
  const onMap = VGRules.onMap;
  const inMoc = id => { const n = byId[id], m = n && mocOf[n.cluster]; return m ? onMap(m, id) : null; };
  const nameCount = {}; nodes.forEach(n => nameCount[n.name] = (nameCount[n.name] || 0) + 1);
  const label = id => esc(byId[id].name) + (nameCount[byId[id].name] > 1 ? ` <span class="vg-muted">(${esc(byId[id].folder || "/")})</span>` : "");
  // plugin: Obsidian's own link text (a same-name note outside the graph, like a root dashboard, can't take the link)
  const mdLink = (id, from) => { if (opts.linkText) return opts.linkText(id, typeof from === "string" ? from : ""); const n = byId[id]; return nameCount[n.name] > 1 ? `[[${id.replace(/\.md$/, "")}|${n.name}]]` : `[[${n.name}]]`; };
  const links = DATA.links.map(l => ({ ...l, s: byId[l.source], t: byId[l.target] })).filter(l => l.s && l.t);
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
  // Records are never "stale": shared rule (vault_graph_rules.js), same as the plugin's sidebar and the weekly note
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
    .filter(n => n.recent === 0 && (!DATA.has_usage || n.opens90 === 0)).slice(0, 8);
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
  const topicRank = c => { const i = topicOrder().findIndex(x => x.id === c); return i < 0 ? 999 : i; };   // unclustered last
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
  const ageDays = Math.round((Date.now() - new Date(DATA.date + "T12:00:00").getTime()) / 864e5);
  const ageText = ageDays <= 0 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays} days ago`;
  const opensNote = DATA.has_usage ? "" : " — needs Advanced Graph View";
  const switchRow = (cls, title, hint, on) => `<label class="vg-switch"><input type="checkbox" class="${cls}" ${on ? "checked" : ""}><span class="vg-track" aria-hidden="true"></span>
    <span><b>${title}</b><span class="vg-muted">${hint}</span></span></label>`;
  root.classList.add("vg-root");
  if (opts.compact) root.classList.add("is-compact");
  if (MOBILE) root.classList.add("is-mobile");
  root.tabIndex = -1;
  root.innerHTML = `
  <div class="vg-app">
    <aside class="vg-side" aria-label="Graph panels">
      <header class="vg-head">
        <div class="vg-title">Vault Graph</div>
        <div class="vg-sub-head">
          <span class="vg-badge ${ageDays > 8 ? "is-warn" : ""}" title="Analysis date">${ageDays > 8 ? "Stale · " : ""}${esc(ageText)}</span>
          <span class="vg-muted">${plural(ranked.length, "linked note")} · ${plural(DATA.clusters.length, "cluster")}</span>
          ${DATA.live ? `<span class="vg-badge is-live" title="Links are read live from Obsidian; clusters and gaps are from the ${esc(DATA.date)} analysis. Since then: +${DATA.live.gained} / −${DATA.live.lost} links, ${plural(DATA.live.added, "new note")}, ${DATA.live.removed} removed.">Links live${DATA.live.gained + DATA.live.lost + DATA.live.added ? ` · ${DATA.live.gained + DATA.live.lost + DATA.live.added} changes` : ""}</span>` : ""}
        </div>
      </header>
      <div class="vg-tabs" role="tablist" aria-label="Panels">
        <button role="tab" class="vg-tab" data-tab="insights" aria-selected="true">Insights</button>
        <button role="tab" class="vg-tab" data-tab="clusters" aria-selected="false">Clusters</button>
      </div>
      <div class="vg-panels">
        <section role="tabpanel" class="vg-panel" data-panel="insights"></section>
        <section role="tabpanel" class="vg-panel" data-panel="clusters" hidden>
          <input type="search" class="vg-input vg-cfilter" placeholder="Filter clusters…" aria-label="Filter clusters">
          <div class="vg-clusters vg-list"></div>
        </section>
      </div>
    </aside>
    <main class="vg-canvas">
      <canvas class="vg-cv" role="img" aria-label="Graph of ${nodes.length} notes in ${DATA.clusters.length} topic clusters. Use the panels or search to explore it."></canvas>
      <div class="vg-hud" aria-hidden="true"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
        <div class="vg-hud-title"></div><div class="vg-hud-tele"></div><div class="vg-scan"></div></div>
      <div class="vg-lasso" hidden></div>
      <div class="vg-today" hidden><span class="vg-today-text"></span><button class="vg-btn vg-btn-sm vg-today-act"></button><button class="vg-ibtn vg-today-x" aria-label="Hide" title="Hide for this view">${icon("close", 12)}</button></div>
      <div class="vg-triage" hidden><span class="vg-triage-text"></span><button class="vg-btn vg-btn-sm vg-triage-prev" aria-label="Previous">‹</button><button class="vg-btn vg-btn-sm vg-triage-next">Next ›</button><button class="vg-btn vg-btn-sm vg-btn-ghost vg-triage-stop">Done</button></div>
      ${opts.favourites ? `<div class="vg-cycle"><button class="vg-ibtn vg-cycle-prev" aria-label="Previous view">‹</button><span class="vg-cycle-name"></span><button class="vg-ibtn vg-cycle-next" aria-label="Next view">›</button></div>` : ""}
      <div class="vg-dock" role="toolbar" aria-label="Celestial bodies">
        <button class="vg-dockbtn" data-body="star" aria-pressed="false" title="Star: a note or MOC; linked notes orbit it"><span>☀</span>Star</button>
        <button class="vg-dockbtn" data-body="planet" aria-pressed="false" title="Planet: a search; matching notes become moons"><span>◍</span>Planet</button>
        <button class="vg-dockbtn" data-body="binary" aria-pressed="false" title="Binary stars: two MOCs; shared notes sit between"><span>⚭</span>Binary</button>
        <button class="vg-dockbtn" data-body="blackhole" aria-pressed="false" title="Black hole: a filter; matching notes fall into a review queue"><span>●</span>Black hole</button>
        <button class="vg-dockbtn" data-body="repulsor" aria-pressed="false" title="Repulsor: push a topic away"><span>◎</span>Repulsor</button>
        <span class="vg-docksep"></span>
        <button class="vg-autobtn" data-auto="comets" aria-pressed="true" title="Notes from recent dailies trail tails">Comets</button>
        <button class="vg-autobtn" data-auto="wormholes" aria-pressed="true" title="Link suggestions as portals">Wormholes</button>
        <button class="vg-autobtn" data-auto="belt" aria-pressed="true" title="Notes to write as an asteroid belt">Belt</button>
        <button class="vg-autobtn" data-auto="nebula" aria-pressed="true" title="Unlinked notes as a nebula">Nebula</button>
        <button class="vg-autobtn" data-auto="grid" aria-pressed="true" title="Warped space grid">Grid</button>
        <button class="vg-autobtn" data-auto="motion" aria-pressed="true" title="Bodies orbit the galactic core and tug on each other">Orbits</button>
        <button class="vg-autobtn" data-auto="trails" aria-pressed="true" title="Faint trails behind bodies and the selected system's notes">Trails</button>
        <button class="vg-dockbtn vg-arrangebtn" title="Arrange the bodies on resonant orbits"><span>✺</span>Arrange</button>
        <span class="vg-docksep"></span>
        <button class="vg-dockbtn vg-shipbtn" aria-pressed="false" title="Ship mode: fly between systems"><span>➤</span>Ship</button>
        <button class="vg-dockbtn vg-pausebtn" aria-pressed="false" title="Pause the simulation (Space)"><span>❚❚</span>Pause</button>
        <button class="vg-dockbtn vg-warpbtn" title="Time warp: how fast orbits run"><span class="vg-warpval">1×</span>Warp</button>
      </div>
      <button class="vg-pausepill" hidden>❚❚ PAUSED · RESUME</button>
      <div class="vg-replay" hidden><b class="vg-replay-date"></b><span class="vg-replay-count"></span><span class="vg-replay-bar"><i></i></span><button class="vg-replay-stop">${icon("stop", 12)} Stop</button></div>
      <div class="vg-timebar" hidden><button class="vg-time-play" aria-label="Play">▶</button><input type="range" min="0" value="0" step="1" aria-label="Date"><b class="vg-time-label">Now</b></div>
      <div class="vg-missions"></div>
      <div class="vg-toolbar" role="toolbar" aria-label="Graph controls">
        <button class="vg-ibtn vg-toggle" aria-label="Toggle panels" title="Toggle panels">${icon("menu")}</button>
        <button class="vg-ibtn vg-reviewbtn" title="Today's review" aria-label="Today's review" hidden>${icon("sparkles")}<span class="vg-tlabel">Review</span><span class="vg-reviewcount">0</span></button>
        <button class="vg-searchbtn" aria-label="Search notes" title="Search (/ or Ctrl K)">${icon("search", 14)}<span>Search notes</span><kbd>/</kbd></button>
        <div class="vg-menuwrap">
          <button class="vg-ibtn vg-pickbtn" aria-haspopup="dialog" aria-expanded="false" title="Views, lenses and styles (M)"><span class="vg-pickicon">${icon("hub", 16)}</span><span class="vg-pickname">2D</span><span class="vg-caret" aria-hidden="true">▾</span></button>
        </div>
        <button class="vg-ibtn vg-anglebtn" hidden title="Camera angle: flat, tilt or iso (3)">${icon("layers")}<span class="vg-tlabel">Iso</span></button>
        <div class="vg-menuwrap"><button class="vg-ibtn vg-toolsbtn" aria-haspopup="menu" aria-expanded="false" aria-pressed="false" title="Select, replay, save, time-lapse">${icon("layers")}<span class="vg-tlabel">Tools</span><span class="vg-caret" aria-hidden="true">▾</span></button>
          <div class="vg-menu vg-toolsmenu" role="menu" hidden></div></div>
        <span class="vg-toolsrc" hidden>   <!-- the tools themselves: the Tools menu and the phone's picker sheet press these -->
          <button class="vg-ibtn vg-lassobtn" aria-pressed="false" title="Lasso: drag a box to select notes (or Alt-drag)">${icon("lasso")}<span class="vg-tlabel">Select</span></button>
          <button class="vg-ibtn vg-replaybtn" aria-pressed="false" title="Replay: watch the vault grow, note by note (R)">${icon("play")}<span class="vg-tlabel">Replay</span></button>
          <button class="vg-ibtn vg-savebtn" title="Save this view (it appears under Saved, and as a constellation in Cosmos)">${icon("star")}<span class="vg-tlabel">Save view</span></button>
          <button class="vg-ibtn vg-timebtn vg-maptime" aria-pressed="false" title="Time-lapse: the vault as it was, month by month (T)">${icon("clock")}<span class="vg-tlabel">Time-lapse</span></button>
        </span>
        <button class="vg-ibtn vg-gamebtn" aria-pressed="false" title="Missions and quests (G)" aria-label="Missions and quests">${icon("flag")}<span class="vg-tlabel">Missions</span></button>
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
                <option value="bc">Influence (betweenness)</option><option value="recent">Daily mentions (${DATA.recent_days} days)</option>
                <option value="opens90" ${DATA.has_usage ? "" : "disabled"}>Note opens (90 days)${opensNote}</option>
                <option value="opens" ${DATA.has_usage ? "" : "disabled"}>Note opens (all time)${opensNote}</option></select></div>
            <div class="vg-field"><label class="vg-flabel" for="vg-color">Node colour</label>
              <select id="vg-color" class="vg-select vg-color">
                <option value="cluster">Topic cluster</option>
                <option value="opens90" ${DATA.has_usage ? "" : "disabled"}>Note opens (90 days)${opensNote}</option>
                <option value="recent">Daily mentions (${DATA.recent_days} days)</option></select></div>
            <div class="vg-flabel">Layers</div>
            ${switchRow("vg-l-mocs", "Maps (MOCs)", `${mocs.length} maps of content, anchored to the topics they map (hexagons)`, true)}
            ${switchRow("vg-l-wanted", "Notes to write", `${ghosts.length} notes you link to that don't exist yet (hollow)`)}
            ${switchRow("vg-l-people", "People", "Who is connected to which topics (diamonds)")}
            ${switchRow("vg-l-tasks", "Open tasks", "Badge with the number of unchecked tasks")}
            <div class="vg-flabel">Display</div>
            ${switchRow("vg-gaps", "Gap suggestions", "Dashed edges between related, unlinked notes", true)}
            ${switchRow("vg-leaves", "Collapse leaf notes", "Fold stubs into their hub as a +N badge")}
            ${switchRow("vg-cohesion", "Cluster gravity", "Pull each topic's notes toward its centre", true)}
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
      <div class="vg-palette-input">${icon("search")}<input type="text" class="vg-pq" placeholder="Search notes and clusters…" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
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
    cohesion: true, layers: { wanted: false, people: false, tasks: false, mocs: true }, multi: null, lasso: false, quietFocus: false,
  };
  const cam = { k: 1, tx: 0, ty: 0, yaw: 0.6, pitch: -0.35, cx: 0, cy: 0, cz: 0, spin: null };
  let W = 0, H = 0, alpha = 1, dirty = true, tween = null, raf = 0, destroyed = false, fitted = false;
  let persistTimer = 0;   // declared before anything that can save during mount
  let morph = null, lastInteract = 0;
  const neural = () => st.view === "neural";
  const isCosmos = () => st.view === "cosmos";

  const baseVisible = n => !st.hidden.has(n.id) && !st.hiddenClusters.has(n.cluster) && (st.isolated || !n.isolated || isCosmos())
    && !(st.leaves && leafOf[n.id]) && (!n.person || st.layers.people) && (!n.ghost || st.layers.wanted || isCosmos()) && (!n.moc || st.layers.mocs) && (!st.timeAt || !n.born || n.born <= st.timeAt) && (!replay || replay.shown.has(n.id));
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
    if (neural() && !replay) brainLayout(false);
    if (mapView() && !morph && !replay) applyMapLayout(false);
    if (isCosmos()) cosmosCapture();
    renderLegend(); renderStatus(); renderHud();
    dirty = true; kick();
  }
  // Replay: notes appear in the order they were first written, like Obsidian's own graph animation.
  // Each one pops in (overshoots a little, then settles) as it arrives.
  let replay = null;
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
    if (st.selected && st.view === "lineage" && mapCache.lineage && !special(byId[st.selected])) return new Set([st.selected, ...lineageOf(st.selected)]);   // ancestors and descendants
    if (st.selected && st.view === "ripples" && mapCache.ripples) return ripplePath(st.selected);   // the clicks that reach it
    if (st.selected && st.view === "alchemy" && mapCache.alchemy && !special(byId[st.selected])) return new Set([st.selected, ...nb[st.selected], ...alPartners(st.selected)]);   // and what it could react with
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
  let lobeDir = {};   // cluster id -> unit direction of its lobe on the shell
  function brainLayout(animate) {
    const R = BRAIN_R, bridgeNotes = nodes.filter(n => n.bridge && !special(n)).map(n => n.id);
    const core = new Set([...bridgeNotes, ...ranked].slice(0, Math.max(18, bridgeNotes.length)));
    const cl = topicOrder(), N = cl.length, centre = {};
    cl.forEach((c, i) => {   // fibonacci points over the shell, pushed off the midline into a hemisphere
      const y = 1 - (i + 0.5) / N * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963;
      let x = Math.cos(th) * rr; const z = Math.sin(th) * rr, side = i % 2 ? 1 : -1;
      x = side * (0.18 + Math.abs(x) * 0.82);
      centre[c.id] = [x, y * 0.82, z];
    });
    lobeDir = centre;
    const shell = (d, scale) => { const L = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / L * R * 1.18 * scale, d[1] / L * R * 0.86 * scale, d[2] / L * R * 0.98 * scale]; };
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
        const depth = 0.94 + 0.08 * ((hash(n.id) % 100) / 100);
        [n.bx, n.by, n.bz] = shell(d, depth);
      });
    });
    let ci = 0;
    active.forEach(n => {
      if (core.has(n.id)) {   // inner core: a small sphere of bridge notes
        const k = ci++, y = 1 - (k + 0.5) / core.size * 2, rr = Math.sqrt(1 - y * y), th = k * 2.399963;
        n.bx = Math.cos(th) * rr * R * 0.3; n.by = y * R * 0.26; n.bz = Math.sin(th) * rr * R * 0.3;
      } else if (n.moc && centre[n.cluster]) {   // a map hovers just outside the lobe it maps
        [n.bx, n.by, n.bz] = shell(centre[n.cluster], 1.24);
      } else if (n.bx == null || n.cluster < 0 || !centre[n.cluster] || special(n)) {   // unclustered, people, ghosts: an outer halo
        const h = hash(n.id), a = (h % 6283) / 1000, b = ((h >>> 12) % 3141) / 1000 - 1.57;
        const s = n.person ? 1.42 : n.ghost ? 1.3 : 1.22;
        [n.bx, n.by, n.bz] = shell([Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)], s);
      }
    });
    if (animate) morphTo(n => n.bx == null ? null : [n.bx, n.by, n.bz], 1400);   // hidden notes stay where they are
    else active.forEach(n => { if (!morph) { n.x = n.bx; n.y = n.by; n.z = n.bz; } });
  }
  function morphTo(target, ms) {   // smooth position transition between layouts
    const from = new Map(nodes.map(n => [n.id, [n.x, n.y, n.z]]));
    const to = new Map(nodes.map(n => [n.id, target(n) || [n.x, n.y, n.z]]));
    morph = { from, to, t0: performance.now(), ms: reducedMotion() ? 1 : ms };
    alpha = 0; kick();
  }

  // ---------------------------------------------------------------- camera
  const P = new Map();   // id -> {x, y, s, depth, r, a}
  const rot = () => [Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch)];
  function proj(x, y, z, R) {   // world -> screen (or null when behind the camera)
    x -= cam.cx; y -= cam.cy; let s = 1, depth = 0;
    if (st.three) {
      z -= cam.cz;
      const [cy, sy, cp, sp] = R, x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
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
    const saved = { k: cam.k, tx: cam.tx, ty: cam.ty, cx: cam.cx, cy: cam.cy, cz: cam.cz };
    // In 3D / neural, rotation turns the world around the pivot (cx, cy, cz). Put the pivot at the centre of the
    // notes being framed, so rotating spins them in place instead of swinging them round a far-off point.
    let pivot = null;
    if (st.three) {
      let sx = 0, sy = 0, sz = 0;
      pick.forEach(n => { sx += n.x || 0; sy += n.y || 0; sz += n.z || 0; });
      pivot = { cx: sx / pick.length, cy: sy / pick.length, cz: sz / pick.length };
      Object.assign(cam, pivot);
    }
    cam.k = 1; cam.tx = 0; cam.ty = 0;
    project();
    const onScreen = pick.map(n => P.get(n.id)).filter(Boolean);
    let [x0, x1] = onScreen.length ? span(onScreen.map(p => p.x)) : [Infinity, -Infinity], [y0, y1] = onScreen.length ? span(onScreen.map(p => p.y)) : [Infinity, -Infinity];
    if (mapView() && pick.length) ((mapCache[st.view] || {}).bounds || []).forEach(([x, y]) => { const p = proj(x, y, 0, rot()); if (!p) return;   // the scene's own outline (roof, slab...)
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
    const k = Math.min(opts.compact ? 1.8 : 4, Math.max(0.05, Math.min((W - 2 * pad) / Math.max(x1 - x0, 1), (H - padTop - pad) / Math.max(y1 - y0, 1))));
    animateTo({ k, tx: -((x0 + x1) / 2 - W / 2) * k, ty: -((y0 + y1) / 2 - H / 2) * k + (padTop - pad) / 2, ...(pivot || {}) }, ms == null ? 500 : ms);
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
    const k = Math.min(12, Math.max(0.03, cam.k * f)), r = k / cam.k;
    cam.userMoved = true; animateTo({ k, tx: cam.tx * r, ty: cam.ty * r }, 200);
  }
  const TWEEN_KEYS = ["k", "tx", "ty", "cx", "cy", "cz", "yaw", "pitch"];
  function animateTo(target, ms) {
    if (reducedMotion()) ms = 1;
    const from = {}; TWEEN_KEYS.forEach(k => from[k] = cam[k]);
    tween = { from, to: { ...from, ...target }, t0: performance.now(), ms: Math.max(ms, 1) };
    kick();
  }

  // ---------------------------------------------------------------- draw
  const shadeCache = new Map();
  function shade(col, f) {   // f > 0 lightens toward white, f < 0 darkens toward black
    const key = col + f; if (shadeCache.has(key)) return shadeCache.get(key);
    const rgb = col.startsWith("#") ? [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)) : (col.match(/[\d.]+/g) || [128, 128, 128]).slice(0, 3).map(Number);
    const target = f > 0 ? 255 : 0, u = Math.abs(f);
    const out = `rgb(${rgb.map(v => Math.round(v + (target - v) * u)).join(",")})`;
    shadeCache.set(key, out); return out;
  }
  const rgbaCache = new Map();
  const rgba = (col, a) => { const key = col + "|" + a; let s = rgbaCache.get(key); if (!s) { s = shade(col, 0.0001).replace("rgb(", "rgba(").replace(")", `,${a})`); rgbaCache.set(key, s); } return s; };
  // pre-rendered glows and orbs: drawing an image is far cheaper than building a gradient per note per frame
  const spriteCache = new Map();
  function sprite(kind, col) {
    const key = kind + col; let c = spriteCache.get(key); if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = kind === "orb" ? g.createRadialGradient(22, 22, 0, 32, 32, 32) : g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === "orb") { gr.addColorStop(0, "#fff"); gr.addColorStop(0.5, shade(col, 0.2)); gr.addColorStop(1, shade(col, -0.35)); }
    else if (kind === "core") { gr.addColorStop(0, "#fff"); gr.addColorStop(0.45, shade(col, 0.35)); gr.addColorStop(1, col); }
    else { gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(1, rgba(col, 0)); }
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 32, 0, 2 * Math.PI); g.fill();
    spriteCache.set(key, c); return c;
  }
  const blit = (kind, col, x, y, r) => ctx.drawImage(sprite(kind, col), x - r, y - r, 2 * r, 2 * r);
  let labelRects = [];
  // the screen boxes of the solids and figures drawn this frame (iso.hit adds them), so note names keep off them
  let bodies = [];
  const body = box => { bodies.push(box); return box; };   // record a shape drawn this frame: [x, y, w, h] on screen
  // where a label w wide starting at x is drawn: shifted inside the pane, the way haloText shifts it
  const paneX = (x, w) => W > 40 ? Math.max(4, Math.min(W - 4 - Math.min(w, W - 8), x)) : x;
  // Reserve a label's box, as it will be drawn
  const freeSpot = (x, y, w, h) => {
    if (opts.compact && labelRects.length > (W < 520 ? 8 : 16)) return false;
    x = paneX(x, w);
    if (labelRects.some(r => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1])) return false;
    labelRects.push([x, y, w, h]); return true;
  };
  function draw(now) {
    const r = drawView(now);
    if (mapView() && W) polishLayer(now);
    return r;
  }
  function drawView(now) {
    if (neural()) return drawNeural(now);
    if (isCosmos()) return drawCosmos(now);
    if (st.view === "subway") return drawSubway(now);
    if (st.view === "topo") return drawTopo(now);
    if (st.view === "city") return drawCity(now);
    if (st.view === "garden") return drawGarden(now);
    if (st.view === "palace") return drawPalace(now);
    const more = { weather: drawWeather, ships: drawShips, rings: drawRings, sky: drawSky, realm: drawRealm, foodweb: drawFoodweb, alchemy: drawAlchemy, lineage: drawLineage, ripples: drawRipples, clock: drawClock, radar: drawRadar }[st.view];
    if (more) return more(now);
    if (SCENES[st.view]) return SCENES[st.view].draw(now);
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = css("--vg-bg"); ctx.fillRect(0, 0, W, H);   // clear first: the theme background can be see-through
    project();
    const litSet = lit(), fd = st.focusDist;
    const fg = css("--vg-fg"), muted = css("--vg-muted"), bg = css("--vg-bg"), accent = css("--vg-accent");
    const font = css("--vg-font") || "system-ui, sans-serif";
    // edges, batched by style
    const groups = new Map();
    for (const l of visLinks) {
      const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
      const dimmed = litSet && !(litSet.has(l.s.id) && litSet.has(l.t.id));
      // in 3D, ordinary links fade with distance (three bands keep the batching cheap)
      const band = st.three && !dimmed && l.kind === "link" ? Math.min(2, Math.max(0, Math.floor(((a.depth + b.depth) / 2 + 300) / 300))) : "";
      const key = dimmed ? "dim" : l.kind + band;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a, b);
    }
    const stroke = { dim: css("--vg-edge-dim"), link: css("--vg-edge"), gap: css("--vg-gap"), similar: css("--vg-sim"), person: css("--vg-person"), wanted: css("--vg-muted"), moc: css("--vg-muted") };
    const bandAlpha = [1, 0.55, 0.25];
    for (const [key, pts] of groups) {
      ctx.beginPath();
      const kind = key.replace(/\d$/, ""), band = key.match(/\d$/);
      ctx.globalAlpha = band ? bandAlpha[+band[0]] : (kind === "gap" || kind === "similar") && !litSet ? 0.45 : kind === "person" ? 0.22 : kind === "moc" ? 0.12 : kind === "wanted" ? 0.4 : 1;
      ctx.strokeStyle = stroke[kind]; ctx.lineWidth = kind === "link" ? (band && band[0] === "0" ? 1.1 : 0.8) : kind === "dim" || kind === "person" ? 0.6 : 1.2;
      ctx.setLineDash(kind === "gap" || kind === "similar" ? [4, 4] : kind === "wanted" || kind === "moc" ? [2, 3] : []);
      for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (st.path) drawPath(accent);
    // nodes, far to near
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth);
    const spheres = st.three && !(MOBILE && active.length > 350), badges = [];   // drawn after the labels, which steer round them
    for (const n of order) {
      // zoom grows nodes sub-linearly (like 2D); in 3D, perspective (s/k) scales near/far on top
      const p = P.get(n.id), rel = st.three ? Math.pow(p.s / cam.k, 1.3) * 1.2 : 1;
      const r = Math.max(1.6, worldRadius(n) * Math.pow(cam.k, 0.8) * rel);
      let a = litSet && !litSet.has(n.id) ? 0.08 : 1;
      if (fd) a *= UI.focusAlpha[Math.min(fd.get(n.id) || 0, 4)];
      if (st.three) a *= Math.min(1, Math.max(0.5, p.s / cam.k));
      ctx.globalAlpha = a;
      const col = fillOf(n);
      if (n.ghost) {   // not written yet: hollow, dashed
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.setLineDash([2, 2]); ctx.lineWidth = 1.5; ctx.strokeStyle = n.created ? accent : muted; ctx.stroke(); ctx.setLineDash([]);
      } else if (n.moc) {   // maps of content: hexagons
        hexagon(p.x, p.y, r); ctx.fillStyle = rgba(col, 0.18); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = col; ctx.stroke();
      } else if (n.person) {   // people: diamonds
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r * 1.2); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r * 1.2); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        if (spheres && r > 2.5 && a > 0.3) {   // faded nodes stay flat: big blurry spheres read as noise
          const g = ctx.createRadialGradient(p.x - r * 0.38, p.y - r * 0.42, r * 0.08, p.x, p.y, r * 1.02);
          g.addColorStop(0, shade(col, 0.6)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.5));
          ctx.fillStyle = g; ctx.fill();
          if (r > 4) {
            ctx.globalAlpha = a * 0.55; ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.ellipse(p.x - r * 0.36, p.y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, 2 * Math.PI); ctx.fill();
            ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
          }
        } else { ctx.fillStyle = col; ctx.fill(); }
      }
      if (st.selected === n.id || (st.multi && st.multi.has(n.id))) {   // selection halo
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.stroke();
        ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.lineWidth = 4; ctx.stroke();
      } else if (overlayHit(n) && a > 0.5) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = fg; ctx.stroke(); }
      if (st.layers.tasks && n.tasks > 0 && a > 0.3 && (!MOBILE || cam.k > 1.6 || n.tasks >= 10 || st.selected === n.id)) badges.push([p.x + r * 0.8, p.y - r * 0.8, n.tasks]);
      p.r = r; p.a = a;
    }
    ctx.globalAlpha = 1;
    labelRects = badges.map(([x, y, c]) => { const w = badgeW(c, font); return [x - w / 2, y - 6, w, 12]; });
    // cluster names at their centroid
    if (cam.k < 2.4 && !fd) {
      const sum = clusterCentroids(litSet);
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 14px ${font}`;
      for (const [c, g] of Object.entries(sum).sort((a, b) => b[1].c - a[1].c)) {
        if (g.c < 5) continue;
        const name = clusterById[c].name, w = ctx.measureText(name).width;
        const x = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, g.x / g.c)); let y = Math.min(H - 12, Math.max(56, g.y / g.c));
        const dy = [0, -18, 18].find(d => freeSpot(x - w / 2, y + d - 9, w, 18)); if (dy == null) continue;   // reserves the spot (or one a line up or down); node labels steer around it
        y += dy;
        ctx.globalAlpha = litSet && !g.lit ? 0.15 : 0.9;
        ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.strokeText(name, x, y);
        ctx.fillStyle = colorOf(+c); ctx.fillText(name, x, y);
      }
      ctx.globalAlpha = 1;
    }
    drawLabels(order, litSet, fd, font, fg, bg, false);
    badges.forEach(([x, y, c]) => drawBadge(x, y, c, font));
    if (st.leaves) {
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `bold 10px ${font}`; ctx.fillStyle = muted;
      for (const n of order) if (leafCount[n.id] >= 3) { const p = P.get(n.id); if (p.a > 0.3) ctx.fillText(`+${leafCount[n.id]}`, p.x + p.r + 3, p.y); }
    }
  }
  function hexagon(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    ctx.closePath();
  }
  function clusterCentroids(litSet) {
    const sum = {};
    for (const n of active) {
      if (n.cluster < 0) continue; const p = P.get(n.id); if (!p) continue;
      const g = sum[n.cluster] || (sum[n.cluster] = { x: 0, y: 0, c: 0, lit: false });
      g.x += p.x; g.y += p.y; g.c++; if (litSet && litSet.has(n.id)) g.lit = true;
    }
    return sum;
  }
  function drawPath(accent) {
    ctx.beginPath(); ctx.strokeStyle = accent; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    for (let i = 1; i < st.path.ids.length; i++) {
      const a = P.get(st.path.ids[i - 1]), b = P.get(st.path.ids[i]);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    ctx.stroke(); ctx.lineCap = "butt";
  }
  const badgeText = count => count > 99 ? "99+" : String(count);
  const badgeW = (count, font) => { ctx.font = `bold 9px ${font}`; return Math.max(12, ctx.measureText(badgeText(count)).width + 6); };
  function drawBadge(x, y, count, font) {
    const t = badgeText(count), w = badgeW(count, font);
    ctx.globalAlpha = 1; ctx.fillStyle = css("--vg-task"); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 6, w, 12, 6) : ctx.rect(x - w / 2, y - 6, w, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y + 0.5);
  }
  function drawLabels(order, litSet, fd, font, fg, bg, hud) {
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const base = hud ? `500 10px ${css("--vg-mono")}` : `11px ${font}`;
    ctx.font = base;
    const want = [];
    if (st.selected) want.push(st.selected);
    if (st.hover) want.push(st.hover);
    if (litSet && litSet.size <= 60) want.push(...litSet);
    labelled.slice(0, hud && !fd ? (cam.k < 1.4 ? 5 : 10) : cam.k < 1 && !fd ? 6 : UI.size.labelTop).forEach(id => want.push(id));
    if (st.layers.mocs) active.filter(n => n.moc).forEach(n => want.push(n.id));
    if (st.layers.wanted && !hud) active.filter(n => n.ghost && n.from.length >= 3).forEach(n => want.push(n.id));
    if (cam.k > 2.4 || fd) for (let i = order.length - 1; i >= 0; i--) want.push(order[i].id);
    const done = new Set(isCosmos() ? cos.bodies.flatMap(b => b.type === "star" ? [b.target] : b.type === "binary" ? (b.target || []) : []) : []);   // bodies carry their own labels
    let tried = 0, drawn = 0;
    for (const id of want) {
      if (done.has(id)) continue; done.add(id);
      const p = P.get(id); if (!p || p.a < (fd ? 0.15 : 0.3)) continue;
      if (p.x < -60 || p.x > W + 60 || p.y < -20 || p.y > H + 10) continue;   // off screen: don't even measure
      if (++tried > 450 || drawn > (MOBILE ? 45 : 110)) break;              // enough labels; the rest would collide anyway
      let text = byId[id].name.length > 42 ? byId[id].name.slice(0, 40) + "…" : byId[id].name;
      if (hud) text = text.toUpperCase();
      const wk = base + "|" + text; let w = textW.get(wk); if (w === undefined) { w = ctx.measureText(text).width; textW.set(wk, w); }
      const y = p.y + (p.r || 3) + 3, x = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, p.x));
      if (!freeSpot(x - w / 2, y, w, 13) && id !== st.selected && id !== st.hover) continue;
      ctx.font = id === st.selected ? (hud ? `700 11px ${css("--vg-mono")}` : `600 12px ${font}`) : base;
      if (!hud) { ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(text, x, y); }
      else { ctx.globalAlpha = 0.55; ctx.fillStyle = "#01040b"; ctx.fillRect(x - w / 2 - 3, y - 1, w + 6, 13); ctx.globalAlpha = 1; }
      ctx.fillStyle = hud ? (id === st.selected ? "#e0f2fe" : "rgba(186,230,253,.82)") : fg;
      ctx.fillText(text, x, y);
      ctx.font = base; drawn++;
    }
  }
  const textW = new Map();

  // ---------------------------------------------------------------- neural renderer
  const pulses = [];
  let wave = null, lobeSpots = [], lastPulse = 0;
  function startWave(id) {   // rings 1-3 out from the note, over drawn notes only
    if (!(neural() || mapView()) || reducedMotion() || !byId[id]) return;
    const dist = new Map([[id, 0]]); let frontier = [id];
    for (let d = 1; d <= 3 && frontier.length; d++) {
      const next = [];
      for (const x of frontier) for (const y of nb[x] || []) if (!dist.has(y) && P.has(y)) { dist.set(y, d); next.push(y); }
      frontier = next;
    }
    wave = { id, dist, t0: performance.now() };
  }
  // ---- the polish every view shares (first made for Neural): signal pulses along the links of recently active notes,
  // the wave that runs out from a selected note, and the rotating selection reticle. They draw over whatever a view
  // drew, from where it put each note (P), so a map view or scene gets them with no code of its own (polishLayer).
  // A scene can turn one off: scene(key, { polish: { pulses: false, wave: false, reticle: false } }).
  const along = (a, b, c, u) => {   // a point u (0-1) along a link, straight or bent through c
    const cx = c ? c.x : (a.x + b.x) / 2, cy = c ? c.y : (a.y + b.y) / 2;
    return [(1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x, (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y];
  };
  const pickActive = () => {   // a link, the hottest most often (rebuildActivity weighs them)
    const r = Math.random() * pulseTotal; let lo = 0, hi = pulseCum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pulseCum[m] < r) lo = m + 1; else hi = m; }
    return pulseLinks[lo];
  };
  // pulses fire along links of notes you've edited or mentioned lately, travelling out from the more active end;
  // over a note or selection they run through its neighbourhood. inLinks/inSet: the links drawn; ctlOf(l): a bend point or null
  function drawPulses(now, inLinks, inSet, litSet, ctlOf, colOf) {
    const pool = litSet ? inLinks.filter(l => litSet.has(l.s.id) && litSet.has(l.t.id)) : null;
    const maxPulses = MOBILE ? 24 : 70, cap = pool || pulseTotal ? maxPulses : 8;   // a quiet vault barely flickers
    if (reducedMotion() || !(pool ? pool.length : inLinks.length)) return;
    for (let tries = 0; pulses.length < cap && Math.random() < 0.6 && tries < 40; tries++) {
      const l = pool ? pool[(Math.random() * pool.length) | 0] : pulseTotal ? pickActive() : inLinks[(Math.random() * inLinks.length) | 0];
      if (!inSet.has(l)) continue;   // a hot link this view doesn't draw
      const w = pool ? 1 : Math.max(activity(l.s), activity(l.t));
      pulses.push({ l, t: 0, sp: 0.004 + Math.random() * 0.01, w: Math.max(0.25, w), rev: activity(l.t) > activity(l.s) });
    }
    const tNow = now || performance.now(), pstep = Math.min(4, Math.max(0.5, (tNow - (lastPulse || tNow)) / 16.7)) || 1;   // same speed at any frame rate
    lastPulse = tNow;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const q = pulses[i]; q.t += q.sp * pstep;
      let a = P.get(q.l.s.id), b = P.get(q.l.t.id); const c = ctlOf(q.l);
      if (q.t >= 1 || !a || !b || !inSet.has(q.l)) { pulses.splice(i, 1); continue; }
      if (q.rev) [a, b] = [b, a];
      const [x, y] = along(a, b, c, q.t), rr = 3 + 3 * q.w;
      const col = colOf(q.l.s.cluster >= 0 ? q.l.s : q.l.t), g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.4, rgba(col, 0.7)); g.addColorStop(1, rgba(col, 0));
      ctx.globalAlpha = Math.sin(Math.PI * q.t) * (0.35 + 0.65 * q.w); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // spreading activation: selecting a note sends a wave out through its links, one ring at a time (startWave)
  function drawWaveLinks(now, inLinks, ctlOf, colOf) {
    const waveT = wave ? (now || performance.now()) - wave.t0 : 0;
    if (wave && (waveT > UI.time.wave * 4 + 700 || !P.has(wave.id))) wave = null;
    if (!wave) return;
    for (const l of inLinks) {
      if (l.kind !== "link") continue;
      const ds = wave.dist.get(l.s.id), dt = wave.dist.get(l.t.id);
      if (ds == null || dt == null || ds === dt) continue;
      const [from, to, d0] = ds < dt ? [l.s, l.t, ds] : [l.t, l.s, dt];
      const u = (waveT - d0 * UI.time.wave) / UI.time.wave; if (u < 0 || u > 1.5) continue;
      const a = P.get(from.id), b = P.get(to.id); if (!a || !b) continue;
      const [x, y] = along(a, b, ctlOf(l), Math.min(1, u)), fade = u > 1 ? 1 - (u - 1) / 0.5 : 1;
      ctx.globalAlpha = fade * (1 - d0 * 0.25); blit("glow", colOf(to), x, y, 9);
    }
    ctx.globalAlpha = 1;
  }
  // the wave reaching a note: a flash that fades with distance (r = the note's drawn radius)
  function waveFlash(n, p, r, colOf, now) {
    const wd = wave && wave.dist.get(n.id); if (wd == null) return;
    const k = ((now || performance.now()) - wave.t0 - wd * UI.time.wave) / 260;
    if (k > -0.3 && k < 2.5) { ctx.globalAlpha = Math.exp(-k * k * 1.5) * (1 - wd * 0.2); blit("glow", wd ? colOf(n) : "#ffffff", p.x, p.y, r * (wd ? 5 : 7)); ctx.globalAlpha = 1; }
  }
  // the selected note: rotating brackets, a slower dashed ring and two sight lines
  function drawReticle(now, col) {
    const sel = st.selected && P.get(st.selected); if (!sel) return;
    const t = (now || performance.now()) / 1000, rr = Math.min(48, Math.max(14, (sel.r || 6) * 2.6));
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    for (let i = 0; i < 4; i++) { const a0 = (reducedMotion() ? 0 : t * 0.9) + i * Math.PI / 2; ctx.beginPath(); ctx.arc(sel.x, sel.y, rr, a0, a0 + 0.7); ctx.stroke(); }
    ctx.globalAlpha = 0.35; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(sel.x, sel.y, rr + 7, -t * 0.5, -t * 0.5 + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(sel.x - rr - 16, sel.y); ctx.lineTo(sel.x - rr - 4, sel.y); ctx.moveTo(sel.x + rr + 4, sel.y); ctx.lineTo(sel.x + rr + 16, sel.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // all three over a map view or scene, along straight links between the notes it drew, in topic colours
  function polishLayer(now) {
    const off = (SCENES[st.view] && SCENES[st.view].polish) || {}, colOf = n => colorOf(n.cluster), straight = () => null;
    const inLinks = visLinks.filter(l => l.kind === "link" && P.has(l.s.id) && P.has(l.t.id)), inSet = new Set(inLinks);
    ctx.save(); ctx.globalCompositeOperation = "source-over";
    if (off.pulses !== false) drawPulses(now, inLinks, inSet, lit(), straight, colOf);
    if (off.wave !== false) { drawWaveLinks(now, inLinks, straight, colOf);
      if (wave) for (const id of wave.dist.keys()) { const p = P.get(id); if (p && byId[id]) waveFlash(byId[id], p, Math.min(10, p.r || 6), colOf, now); } }
    if (off.reticle !== false) drawReticle(now, UI.colour.selected);
    ctx.restore();
  }
  function drawNeural(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // deep-space backdrop with a vignette
    const bgG = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    if (st.vision === "nv") { bgG.addColorStop(0, "#03140a"); bgG.addColorStop(1, "#000502"); }
    else if (st.vision === "thermal") { bgG.addColorStop(0, "#0b0820"); bgG.addColorStop(1, "#020108"); }
    else { bgG.addColorStop(0, "#081a33"); bgG.addColorStop(1, "#01040b"); }
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
    project();
    const R = rot(), litSet = lit(), fd = st.focusDist, font = css("--vg-font"), hudCol = st.vision === "nv" ? "#4ade80" : "#38bdf8";
    // wireframe "globe": faint meridians and parallels of the cortex shell
    ctx.globalAlpha = 0.07; ctx.strokeStyle = hudCol; ctx.lineWidth = 1;
    const shellPt = (lat, lon) => proj(Math.cos(lat) * Math.cos(lon) * BRAIN_R * 1.18, Math.sin(lat) * BRAIN_R * 0.86, Math.cos(lat) * Math.sin(lon) * BRAIN_R * 0.98, R);
    for (let m = 0; m < 12; m++) {
      ctx.beginPath(); let first = true;
      for (let k = 0; k <= 24; k++) { const p = shellPt(-Math.PI / 2 + Math.PI * k / 24, m * Math.PI / 6); if (!p) { first = true; continue; } first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); first = false; }
      ctx.stroke();
    }
    for (let l = 1; l < 6; l++) {
      ctx.beginPath(); let first = true;
      for (let k = 0; k <= 36; k++) { const p = shellPt(-Math.PI / 2 + Math.PI * l / 6, 2 * Math.PI * k / 36); if (!p) { first = true; continue; } first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); first = false; }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "lighter";
    // lobe glow: a lobe you've been working in glows; one that's gone quiet stays dark
    if (!fd) for (const c in lobeStats) {
      const d = lobeDir[c], g = lobeStats[c]; if (!d || g.notes < 3) continue;
      const L = Math.hypot(d[0], d[1], d[2]) || 1, p = proj(d[0] / L * BRAIN_R * 1.18, d[1] / L * BRAIN_R * 0.86, d[2] / L * BRAIN_R * 0.98, R);
      if (!p) continue;
      const rad = BRAIN_R * (0.18 + 0.22 * Math.sqrt(g.notes / 110)) * p.s, back = Math.max(0.25, Math.min(1, 0.7 - p.depth / 500));
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad), col = st.vision === "std" ? neonOf(+c) : hudCol;
      halo.addColorStop(0, rgba(col, 0.05 + 0.3 * g.act)); halo.addColorStop(1, rgba(col, 0));
      ctx.globalAlpha = back * (litSet ? 0.4 : 1); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI); ctx.fill();
    }
    // connections: arcs bent toward the core, batched by colour
    const groups = new Map();
    const ctl = l => proj((l.s.x + l.t.x) * 0.28, (l.s.y + l.t.y) * 0.28, (l.s.z + l.t.z) * 0.28, R);
    for (const l of visLinks) {
      const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
      const on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      const col = l.kind === "link" ? fillOf(l.s.cluster >= 0 ? l.s : l.t) : l.kind === "gap" ? "#fb7185" : l.kind === "similar" ? "#c084fc" : "#94a3b8";
      const key = col + (on ? "|1" : "|0") + (l.kind === "link" ? "" : "|d");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([a, b, ctl(l)]);
    }
    for (const [key, segs] of groups) {
      const [col, on, dash] = key.split("|");
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = on === "1" ? 1 : 0.6;
      ctx.globalAlpha = litSet ? (on === "1" ? 0.55 : 0.025) : 0.13;
      ctx.setLineDash(dash ? [3, 5] : []);
      for (const [a, b, c] of segs) { ctx.moveTo(a.x, a.y); c ? ctx.quadraticCurveTo(c.x, c.y, b.x, b.y) : ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    drawPulses(now, visLinks, visSet, litSet, ctl, fillOf);
    drawWaveLinks(now, visLinks, ctl, fillOf);
    // nodes: glowing cores with halos
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth);
    for (const n of order) {
      const p = P.get(n.id), rel = Math.pow(p.s / cam.k, 1.3);
      const r = Math.max(1.4, worldRadius(n) * 0.7 * Math.pow(cam.k, 0.8) * rel);
      let a = litSet && !litSet.has(n.id) ? 0.1 : 1;
      if (fd) a *= UI.focusAlpha[Math.min(fd.get(n.id) || 0, 4)];
      a *= Math.min(1, Math.max(0.35, p.s / cam.k));
      const col = fillOf(n);
      if (a > 0.2 && !n.ghost) {
        ctx.globalAlpha = a * 0.8 * 0.55; blit("glow", col, p.x, p.y, r * 3.2);
      }
      ctx.globalAlpha = a;
      if (n.ghost) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.setLineDash([2, 2]); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      else if (!n.person && !n.moc) blit("core", col, p.x, p.y, r);   // the common case: a pre-rendered orb
      else {
        const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        core.addColorStop(0, "#ffffff"); core.addColorStop(0.45, shade(col, 0.35)); core.addColorStop(1, col);
        ctx.fillStyle = core; ctx.beginPath();
        if (n.person) { ctx.moveTo(p.x, p.y - r * 1.2); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r * 1.2); ctx.lineTo(p.x - r, p.y); ctx.closePath(); }
        else if (n.moc) { hexagon(p.x, p.y, r * 1.3); ctx.fillStyle = rgba(col, 0.15); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.35, 0, 2 * Math.PI); ctx.fillStyle = core; }
        else ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      waveFlash(n, p, r, fillOf, now);
      p.r = r; p.a = a;
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    drawReticle(now, hudCol);
    if (st.path) drawPath(hudCol);
    labelRects = []; lobeSpots = [];
    // lobe labels in HUD type
    if (!fd) {
      // each lobe is labelled just outside the shell, at its own centre (not the members' centroid,
      // which the core's bridge notes would drag inward); lobes on the far side fade out
      const sum = clusterCentroids(litSet);
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 10.5px ${css("--vg-mono")}`;
      const lobes = Object.entries(sum).filter(([c, g]) => g.c >= 5 && lobeDir[c]).map(([c, g]) => {
        const d = lobeDir[c], L = Math.hypot(d[0], d[1], d[2]) || 1;
        return [c, g, proj(d[0] / L * BRAIN_R * 1.18 * 1.14, d[1] / L * BRAIN_R * 0.86 * 1.14, d[2] / L * BRAIN_R * 0.98 * 1.14, R)];
      }).filter(x => x[2]).sort((a, b) => a[2].depth - b[2].depth);
      // under each name, the lobe's health: notes, how many were touched this week, how many have gone stale.
      // A quiet lobe's label dims. Hover a label for the full picture, click it to focus the topic.
      const small = `500 9px ${css("--vg-mono")}`, big = ctx.font;
      for (const [c, g, p] of lobes) {
        const hs = lobeStats[c], name = `⟨ ${clusterById[c].name.toUpperCase()} ⟩`;
        const sub = topicReadout(c).toUpperCase();
        ctx.font = small; const ws = sub ? ctx.measureText(sub).width : 0; ctx.font = big;
        const w = Math.max(ctx.measureText(name).width, ws), h = sub ? 30 : 18;
        const x = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, p.x)), y = Math.min(H - h + 6, Math.max(56, p.y));
        if (!freeSpot(x - w / 2 - 4, y - 9, w + 8, h)) continue;
        const back = Math.max(0.2, Math.min(1, 0.6 - p.depth / 400)), quiet = hs ? 0.45 + 0.55 * Math.min(1, hs.act * 2.5) : 1;
        const col = st.vision === "std" ? neonOf(+c) : hudCol;
        ctx.globalAlpha = (litSet && !g.lit ? 0.18 : 0.9) * back * quiet; ctx.fillStyle = col; ctx.fillText(name, x, y);
        if (sub) { ctx.font = small; ctx.globalAlpha *= 0.75; ctx.fillText(sub, x, y + 13); ctx.font = big; }
        if (back > 0.3) lobeSpots.push([x - w / 2 - 4, y - 9, w + 8, h, +c]);
      }
      ctx.globalAlpha = 1;
    }
    drawLabels(order, litSet, fd, font, "#e0f2fe", "#000", true);
  }

  // ---------------------------------------------------------------- map views: subway, terrain, city
  // Each lays the notes out once on a flat plane (no physics) and draws its own picture. Drawn notes go into P
  // with a screen spot and radius, so hover, click, search, the inspector, lenses and replay keep working.
  // ---------------------------------------------------------------- scene registry
  // A scene registers everything about itself in one call, in its own file (_scripts/vault_graph_scenes/*.js, put here by
  // the build): scene(key, { name, icon, blurb, toast, layout(geo) -> { pos: Map(id -> [x, y]), ... }, draw(now), fps,
  // iso ("iso" | "tilt": drawn with isoKit, framed to match), press(phase, x, y) -> true (takes a drag off the notes, e.g. painting),
  // fit(n) -> bool (what "fit" frames), lit(id) -> Set|null (what selecting a note lights), legend(item) -> html,
  // today() -> { text, label, run } | null }. The tables below (names, picker tiles, layouts, drawing, animation,
  // legend, today strip, toast) read it, so a new scene touches no other code.
  const SCENES = {};
  function scene(key, def) { SCENES[key] = def; }
  /*@scenes*/
  // scenes written in notes (the plugin collects every ```vault-graph-scene block into DATA.scenes); a block with
  // errors still draws from the words it got right, and its note shows the errors
  (DATA.scenes || []).forEach(b => { const { spec } = VGRules.sceneSpec(b.raw), key = VGRules.sceneKey(b.path, b.i);
    if (!SCENES[key]) scene(key, specScene(key, spec, b.path)); });
  const MAPS = { subway: "Subway", topo: "Terrain", city: "City", garden: "Garden", palace: "Palace", weather: "Weather", ships: "Shipping lanes", rings: "Tree rings",
    sky: "Sky chart", realm: "Realm", foodweb: "Food web", alchemy: "Alchemy", lineage: "Lineage", ripples: "Click depth", clock: "Heat clock", radar: "Radar",
    ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, d.name])) };
  const mapView = () => !!MAPS[st.view];
  let geoCache = null, mapCache = {}, impMax = null;
  // how much the vault leans on a note, 0-1 (links in, daily mentions, influence)
  // One measure everywhere (City, Subway, Terrain, the Important-but-stale lens): links in, daily mentions,
  // influence, and opens when usage data exists (recent mentions otherwise)
  const importance = n => {
    if (!impMax) { const ns = nodes.filter(m => !special(m) && !m.ghost), mx = f => Math.max(1e-9, ...ns.map(f));
      impMax = { i: mx(m => Math.log1p(m.inlinks || 0)), m: mx(m => Math.log1p(m.mentions || 0)), b: mx(m => m.bc || 0),
        o: mx(m => Math.log1p(m.opens90 || 0)), r: mx(m => Math.log1p(m.recent || 0)) }; }
    return 0.4 * Math.log1p(n.inlinks || 0) / impMax.i + 0.3 * Math.log1p(n.mentions || 0) / impMax.m + 0.2 * (n.bc || 0) / impMax.b
      + 0.1 * (DATA.has_usage ? Math.log1p(n.opens90 || 0) / impMax.o : Math.log1p(n.recent || 0) / impMax.r);
  };
  // Where notes sit on the familiar 2D map (saved layout, or the 2D view just left); topics round a circle otherwise
  function geography() {
    const L = layouts["2d"], pos = new Map();
    if (!layoutSeed()) nodes.forEach(n => { const p = L[n.id] || (geoCache && geoCache.get(n.id)); if (p) pos.set(n.id, [p[0], p[1]]); });
    if (pos.size < nodes.length * 0.5) {
      pos.clear();
      const cs = topicOrder(), ang = {};
      cs.forEach((c, i) => { ang[c.id] = i / cs.length * 2 * Math.PI; });
      nodes.forEach(n => { const h = seededHash(n.id), a = ang[n.cluster] ?? (h % 628) / 100, r = n.cluster >= 0 ? 420 : 760;
        pos.set(n.id, [Math.cos(a) * r + (h % 160) - 80, Math.sin(a) * r + ((h >>> 9) % 160) - 80]); });
    }
    nodes.forEach(n => { if (!pos.has(n.id)) { const m = [...nb[n.id]].find(id => pos.has(id)); pos.set(n.id, m ? pos.get(m).map(v => v + (hash(n.id) % 31) - 15) : [0, 0]); } });
    // spread to a common size (outliers ignored), centred on 0
    const core = nodes.filter(n => !special(n) && !n.ghost).map(n => pos.get(n.id));
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))];
    const xs = core.map(p => p[0]).sort((a, b) => a - b), ys = core.map(p => p[1]).sort((a, b) => a - b);
    const cx = q(xs, 0.5), cy = q(ys, 0.5), s = Math.min(1300 / Math.max(1, q(xs, 0.95) - q(xs, 0.05)), 850 / Math.max(1, q(ys, 0.95) - q(ys, 0.05)));
    const out = new Map(); pos.forEach((p, id) => out.set(id, [(p[0] - cx) * s, (p[1] - cy) * s]));
    return out;
  }

  // Subway: each topic is a line through its most relied-on notes; notes from other topics that its notes
  // link to most become transfer stations. Positions keep the 2D geography, snapped to a grid; track runs
  // at 0/45/90 degrees like a transit map.
  function subwayLayout(geo0) {
    const GRID = 46, SPREAD = 1.7, stations = new Map(), taken = new Map(), lines = [];
    const geo = new Map(); geo0.forEach((p, id) => geo.set(id, [p[0] * SPREAD, p[1] * SPREAD]));   // room for straight lines
    const placeNear = (id, x, y) => {
      if (stations.has(id)) return stations.get(id);
      const gx0 = Math.round(x / GRID), gy0 = Math.round(y / GRID);
      let gx = gx0, gy = gy0;
      outer: for (let r = 0; r < 16; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || taken.has(`${gx0 + dx},${gy0 + dy}`)) continue;
        gx = gx0 + dx; gy = gy0 + dy; break outer;
      }
      const s = { id, x: gx * GRID, y: gy * GRID, lines: [] }; taken.set(`${gx},${gy}`, id); stations.set(id, s); return s;
    };
    DATA.clusters.filter(c => c.size >= 4).sort((a, b) => b.size - a.size).slice(0, 18).forEach(c => {
      const own = topicNotes(c.id).sort(byImportance).slice(0, 9).map(n => n.id);
      const into = {};
      links.forEach(l => { if (l.kind !== "link") return;
        [[l.s, l.t], [l.t, l.s]].forEach(([a, b]) => { if (a.cluster === c.id && b.cluster !== c.id && b.cluster >= 0 && !special(b)) into[b.id] = (into[b.id] || 0) + 1; }); });
      const transfers = Object.entries(into).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, k]) => k >= 2).map(([id]) => id);
      if (own.length + transfers.length < 2) return;
      // the line runs straight through its topic's centre, along its main direction snapped to 45 degrees
      const pts = own.map(id => geo.get(id)), mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      let sxx = 0, syy = 0, sxy = 0; pts.forEach(p => { sxx += (p[0] - mx) ** 2; syy += (p[1] - my) ** 2; sxy += (p[0] - mx) * (p[1] - my); });
      const th = Math.round(0.5 * Math.atan2(2 * sxy, sxx - syy) / (Math.PI / 4)) * (Math.PI / 4), ux = Math.cos(th), uy = Math.sin(th);
      const along = id => (geo.get(id)[0] - mx) * ux + (geo.get(id)[1] - my) * uy;
      own.sort((a, b) => along(a) - along(b));
      const step = GRID * (Math.abs(ux) > 0.1 && Math.abs(uy) > 0.1 ? 1 : 1.4);   // diagonal steps are already longer
      own.forEach((id, i) => { const t = (i - (own.length - 1) / 2) * step; placeNear(id, mx + ux * t, my + uy * t); });
      transfers.forEach(id => { const g = geo.get(id); placeNear(id, g[0], g[1]); });   // another line may already own it
      const stops = [...own, ...transfers].sort((a, b) => { const sa = stations.get(a), sb = stations.get(b); return (sa.x - mx) * ux + (sa.y - my) * uy - ((sb.x - mx) * ux + (sb.y - my) * uy); });
      const li = lines.length; lines.push({ c: c.id, color: colorOf(c.id), stops });
      stops.forEach(id => { const st0 = stations.get(id); if (!st0.lines.includes(li)) st0.lines.push(li); });
    });
    const pos = new Map(geo); stations.forEach(s => pos.set(s.id, [s.x, s.y]));
    return { lines, stations, pos };
  }
  const legs = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.min(Math.abs(dx), Math.abs(dy));
    return [[a[0] + Math.sign(dx) * d, a[1] + Math.sign(dy) * d], b]; };   // diagonal first, then straight

  // Terrain: an elevation field where each note raises the ground by how much the vault relies on it. Topics
  // become hills, gaps between them valleys and sea. Quiet ground (no recent edits or mentions) sits under fog.
  function topoLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost);
    const [x0, y0, x1, y1] = bounds(ns.map(n => geo.get(n.id)), 160);
    const CELL = Math.max(8, Math.sqrt((x1 - x0) * (y1 - y0) / 36000)), gw = Math.ceil((x1 - x0) / CELL) + 1, gh = Math.ceil((y1 - y0) / CELL) + 1;
    const E = new Float32Array(gw * gh), A = new Float32Array(gw * gh), SIG = 58, rad = Math.ceil(3 * SIG / CELL);
    ns.forEach(n => {
      const [x, y] = geo.get(n.id), cx = (x - x0) / CELL, cy = (y - y0) / CELL, w = 0.2 + importance(n), act = activity(n);
      for (let j = Math.max(0, Math.floor(cy - rad)); j <= Math.min(gh - 1, Math.ceil(cy + rad)); j++)
        for (let i = Math.max(0, Math.floor(cx - rad)); i <= Math.min(gw - 1, Math.ceil(cx + rad)); i++) {
          const d2 = ((i - cx) ** 2 + (j - cy) ** 2) * CELL * CELL, g = Math.exp(-d2 / (2 * SIG * SIG));
          E[j * gw + i] += w * g; A[j * gw + i] += act * g;
        }
    });
    let mx = 1e-9; for (let i = 0; i < E.length; i++) mx = Math.max(mx, E[i]);
    for (let i = 0; i < E.length; i++) { E[i] = Math.pow(E[i] / mx, 0.7); A[i] = Math.min(1, A[i] / (0.35 + E[i] * mx * 0.25)); }
    const SEA = 0.07, off = document.createElement("canvas"); off.width = gw; off.height = gh;
    const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    const STOPS = [[0, [40, 92, 72]], [0.25, [96, 140, 82]], [0.45, [176, 168, 104]], [0.65, [158, 116, 78]], [0.82, [128, 100, 86]], [1, [240, 238, 232]]];
    const tint = e => { for (let k = 1; k < STOPS.length; k++) if (e <= STOPS[k][0]) { const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k], u = (e - a) / (b - a); return ca.map((v, i) => v + (cb[i] - v) * u); } return STOPS[STOPS.length - 1][1]; };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i, e = E[k];
      let c;
      if (e < SEA) { const d = e / SEA; c = [22 + 40 * d, 48 + 60 * d, 84 + 70 * d]; }   // sea: deeper further from land
      else {
        c = tint((e - SEA) / (1 - SEA));
        const nw = E[Math.max(0, j - 1) * gw + Math.max(0, i - 1)], se = E[Math.min(gh - 1, j + 1) * gw + Math.min(gw - 1, i + 1)];
        const shadeF = Math.max(0.55, Math.min(1.35, 1 + (nw - se) * 9));   // light from the north-west
        const fog = (1 - A[k]) * 0.42;                                       // quiet ground: fog
        c = c.map(v => (v * shadeF) * (1 - fog) + 214 * fog);
      }
      img.data.set([c[0], c[1], c[2], 255], k * 4);
    }
    oc.putImageData(img, 0, 0);
    // contour lines (marching squares), in world coordinates
    const contours = [];
    for (let lv = SEA, li = 0; lv < 1; lv += 0.055, li++) {
      const seg = [];
      for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
        const a = E[j * gw + i], b = E[j * gw + i + 1], c = E[(j + 1) * gw + i + 1], d = E[(j + 1) * gw + i];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const T = [i + (lv - a) / (b - a), j], Rr = [i + 1, j + (lv - b) / (c - b)], B = [i + (lv - d) / (c - d), j + 1], Lf = [i, j + (lv - a) / (d - a)];
        const pairs = { 1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [Lf, T, B, Rr], 6: [T, B], 7: [Lf, T], 8: [Lf, T], 9: [T, B], 10: [T, Rr, Lf, B], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B] }[idx];
        for (const p of pairs) seg.push(x0 + p[0] * CELL, y0 + p[1] * CELL);
      }
      contours.push({ major: li % 4 === 0, seg });
    }
    // each topic's summit: its highest note
    const peaks = [];
    DATA.clusters.forEach(c => {
      let best = null, bh = -1;
      ns.filter(n => n.cluster === c.id).forEach(n => { const [x, y] = geo.get(n.id), h = E[Math.round((y - y0) / CELL) * gw + Math.round((x - x0) / CELL)] || 0; if (h > bh) { bh = h; best = [x, y]; } });
      if (best && c.size >= 4) peaks.push({ c: c.id, x: best[0], y: best[1], h: bh });
    });
    return { pos: geo, img: off, x0, y0, w: gw * CELL, h: gh * CELL, contours, peaks, E, gw, CELL, SEA };
  }

  // City: each topic is a district and each note a building. Height = how much the vault relies on it,
  // footprint = how long it is, lit windows = recent edits and mentions, grey and dark = stale, a crane = new.
  // Notes you link to but haven't written are empty lots in the Planned district.
  const U = 22;   // one lot, in world units
  const iso = (gx, gy) => [(gx - gy) * U * 0.866, (gx + gy) * U * 0.5];
  function cityLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.moc) return; const c = n.ghost ? -2 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    const placed = [], b = new Map(), districts = [];
    Object.entries(groups).sort((a, b) => b[1].length - a[1].length).forEach(([c, ms]) => {
      c = +c; ms.sort(byImportance);
      const { cols, rows } = gridDims(ms.length), w = cols + 1, h = rows + 2;   // the front row is the plaza
      const cen = ms.reduce((s, n) => { const p = geo.get(n.id); return [s[0] + p[0], s[1] + p[1]]; }, [0, 0]).map(v => v / ms.length);
      const tx = Math.round(cen[0] / 40 - w / 2), ty = Math.round(cen[1] / 40 - h / 2);
      const hits = (x, y) => placed.some(r => x < r[0] + r[2] + 1 && x + w + 1 > r[0] && y < r[1] + r[3] + 1 && y + h + 1 > r[1]);
      let bx = tx, by = ty;
      outer: for (let r = 0; r < 60; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || hits(tx + dx, ty + dy)) continue;
        bx = tx + dx; by = ty + dy; break outer;
      }
      placed.push([bx, by, w, h]); districts.push({ c, bx, by, w, h, act: ms.reduce((t, n) => t + activity(n), 0) / ms.length,
        dark: ms.filter(n => !n.ghost && staleFor(n, Q.stale_days)).length, hall: c >= 0 && mocOf[c] && byId[mocOf[c].id] ? mocOf[c].id : null });
      // tallest at the back so they don't hide the rest: fill lots from the back corner forward
      const lots = []; for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) lots.push([q, r]);
      lots.sort((p1, p2) => (p1[0] + p1[1]) - (p2[0] + p2[1]) || p1[0] - p2[0]);
      ms.forEach((n, i) => { const [q, r] = lots[i];
        b.set(n.id, { gx: bx + q + 0.75, gy: by + r + 0.75, h: n.ghost ? 0 : 4 + 165 * Math.pow(importance(n), 1.6), f: 0.34 + 0.26 * Math.sqrt(Math.min(1, (n.words || 0) / 2000)) }); });
    });
    const week = Date.now() - 7 * 864e5;
    const cranes = new Set(nodes.filter(n => n.born && !n.ghost && b.has(n.id) && new Date(n.born + "T12:00") >= week).sort((x, y) => y.born.localeCompare(x.born)).slice(0, 15).map(n => n.id));
    const pos = new Map(geo); b.forEach((v, id) => pos.set(id, iso(v.gx, v.gy)));
    // the outline the camera frames: each building's top with room for its crane and name, and the streets round each district
    const bounds = [...[...b.values()].map(v => { const [x, y] = iso(v.gx, v.gy); return [x, y - v.h - 30]; }),
      ...districts.flatMap(d => [[-0.55, -0.55], [d.w + 0.55, -0.55], [d.w + 0.55, d.h + 0.55], [-0.55, d.h + 0.55]].map(([x, y]) => iso(d.bx + x, d.by + y)))];
    return { b, districts, pos, cranes, bounds };
  }

  function applyMapLayout(animate) {
    impMax = null;
    const geo = geography(), v = st.view;
    const M = mapCache[v] = SCENES[v] ? SCENES[v].layout(geo) : v === "subway" ? subwayLayout(geo) : v === "topo" ? topoLayout(geo) : v === "garden" ? gardenLayout(geo) : v === "palace" ? palaceLayout(geo)
      : ({ weather: weatherLayout, ships: shipsLayout, rings: ringsLayout, sky: skyLayout, realm: realmLayout, foodweb: foodwebLayout, alchemy: alchemyLayout, lineage: lineageLayout, ripples: ripplesLayout, clock: clockLayout, radar: radarLayout }[v] || cityLayout)(geo);
    if (animate) morphTo(n => { const p = M.pos.get(n.id); return p ? [p[0], p[1], 0] : null; }, 950);
    else nodes.forEach(n => { const p = M.pos.get(n.id); if (p) { n.x = p[0]; n.y = p[1]; n.z = 0; } });
  }
  const mapFitPred = () => SCENES[st.view] ? (SCENES[st.view].fit || (n => !special(n) && !n.ghost)) : st.view === "palace" ? (n => !special(n) && !n.ghost && (!mapCache.palace || !mapCache.palace.onFloor || mapCache.palace.onFloor.has(n.id))) : st.view === "subway" ? (n => mapCache.subway && mapCache.subway.stations.has(n.id))
    : st.view === "city" ? (n => mapCache.city && mapCache.city.b.has(n.id) && !n.ghost) : st.view === "palace" ? (n => !special(n)) : st.view === "radar" ? (n => !special(n) && n.tasks > 0)
    : st.view === "realm" ? (n => !special(n) && !n.ghost) : (n => !special(n) && !n.ghost);

  function mapFrame() {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);   // the theme background can be see-through (Hearth cards): without this, frames smear
    P.clear(); labelRects = []; bodies = []; spots = [];
    return { dpr, R: rot(), litSet: lit(), font: css("--vg-font") || "system-ui, sans-serif", k: cam.k };
  }
  // Clickable areas a scene draws that aren't notes (a floor, a lever, a palette chip): spot(x, y, w, h, fn) each
  // frame; a click on empty canvas inside one runs fn
  let spots = [];
  const spot = (x, y, w, h, fn, title) => spots.push([x, y, w, h, fn, title]);
  let pressing = false;   // a scene's press() has the pointer
  // ---- isometric kit: 3D for any scene. A scene keeps its flat world layout (x, y as its layout placed the notes)
  // and draws through this instead of scr(): the plane is turned 45° and tilted around the pane's centre, z is height
  // in world units. Hit spots come from iso.hit, so clicks, hover and the inspector work the same as in flat scenes.
  //   const iso = isoKit(R, k, "iso" | "tilt");  iso.p(x, y, z) -> screen point   iso.rect(x, y, w, h) -> 4 corners (back, right, front, left)
  //   iso.poly(pts, fill, stroke, lw)  iso.wall(a, b, h, fill, stroke)  iso.slab(x, y, w, h, thick, top, sideL, sideR, edge)
  //   iso.block(p, size, height, colour, edge) -> faces   iso.prism(front, d, colour, o) (any solid; see prism)
  //   iso.hit(p, halfWidth, height)   iso.depthSort(items, item -> point)
  // The angles 3D scenes share: "iso" turns the plane 45° and tilts it (floors, towns); "tilt" only leans it back, so
  // rows and columns stay square to you (tables, boards). Each is a 2x2 matrix from flat screen offsets to the angled ones.
  const ISO_VIEWS = { iso: [0.62, -0.62, 0.36, 0.36], tilt: [0.92, 0, 0, 0.58], flat: [1, 0, 0, 1] };   // flat: top-down, blocks show as squares
  // the angle the current view draws at, by name, or null for a view that doesn't draw through the kit: a scene sets
  // iso: "iso" | "tilt" (true = "iso"), the palace's floors are "iso"; the person's choice for the view (st.angles,
  // the angle button or 3) wins over both
  const isoAngle = () => { const d = SCENES[st.view], own = d && d.iso ? (d.iso === true ? "iso" : d.iso)
      : st.view === "palace" && mapCache.palace && !mapCache.palace.facade ? "iso" : null;
    return own && (st.angles[st.view] || own); };
  const isoScene = () => { const a = isoAngle(); return a && ISO_VIEWS[a]; };
  const ANGLES = [["flat", "Flat"], ["tilt", "Tilt"], ["iso", "Iso"]];
  function cycleAngle() {
    const a = isoAngle(); if (!a) return;
    const i = ANGLES.findIndex(([k]) => k === a), [next, name] = ANGLES[(i + 1) % ANGLES.length];
    st.angles[st.view] = next; syncAngleBtn(); persistSoon(); fit(null); dirty = true; kick(); toast(`${name} view`, "ok");
  }
  function syncAngleBtn() {
    const b = $(".vg-anglebtn"); if (!b) return; const a = isoAngle();
    b.hidden = !a; if (a) b.querySelector(".vg-tlabel").textContent = ANGLES.find(([k]) => k === a)[1];
  }
  // shadeOf(colour, t): colour darkened by t (0..1); a colour that isn't #rrggbb shades a neutral blue-grey
  const shadeOf = (c, t) => hexMix(/^#[0-9a-f]{6}$/i.test(c) ? c : "#a5b4cf", "#000000", t);
  // prism(front, d, colour, o): a flat shape (screen points in order round it) pushed back along d (a screen offset)
  // into a solid. Draws the side faces that look toward you, shaded by the one light (UI.light: up = colour, turned
  // left / right / a top leaning right = darker), then the front face, and returns the back outline. Every solid is
  // one of these (a note's block, a floor slab, the palace's body and roof), so faces always meet and are lit alike.
  // Opaque faces get a hairline in their own colour, so no anti-aliasing seam shows between them.
  //   o.faces { up, left, right, slope }: colours instead of the shaded ones   o.front: the front face's colour
  //   o.edge, o.lw: the front face's outline   o.sides: outline the side faces too
  function prism(front, d, colour, o = {}) {
    const n = front.length, back = front.map(q => ({ x: q.x + d.x, y: q.y + d.y }));
    let area = 0; front.forEach((q, i) => { const r = front[(i + 1) % n]; area += q.x * r.y - r.x * q.y; });
    const turn = area > 0 ? 1 : -1;   // which way round the outline goes, so each edge's outer side is known
    const face = (pts, fill, edge, lw) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      const line = edge || (/^#[0-9a-f]{6}$/i.test(fill || "") ? fill : null);
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = edge ? lw || 1 : 0.75; ctx.lineJoin = "round"; ctx.stroke(); } };
    front.forEach((a, i) => { const b = front[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey); if (len < 0.01) return;
      const nx = turn * ey / len, ny = -turn * ex / len;   // the edge's outward normal
      if (nx * d.x + ny * d.y <= 0.001) return;           // a face turned away, behind the front
      const kind = ny < -0.5 ? (nx > 0.15 ? "slope" : "up") : nx < 0.15 ? "left" : "right", f = o.faces || {};   // a face square to you counts as left
      face([a, b, back[(i + 1) % n], back[i]], f[kind] || (kind === "up" ? colour : shadeOf(colour, UI.light[kind])), o.sides ? o.edge : null, o.lw); });
    face(front, o.front || colour, o.edge, o.lw);
    return back;
  }
  function isoKit(R, k, view) {
    const m = ISO_VIEWS[(isoAngle() && st.angles[st.view]) || view || "iso"], ax = (Math.abs(m[0]) + Math.abs(m[1])) / 2, ay = (Math.abs(m[2]) + Math.abs(m[3])) / 2 || m[3];
    const p = (x, y, z = 0) => { const a = scr(x, y, R), u = a.x - W / 2, v = a.y - H / 2; return { x: W / 2 + m[0] * u + m[1] * v, y: H / 2 + m[2] * u + m[3] * v - z * k, s: a.s }; };
    const lift = (q, h) => ({ x: q.x, y: q.y - h });
    const poly = (pts, fill, stroke, lw) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } };
    const rect = (x, y, w, h) => [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)];
    const wall = (a, b, h, fill, stroke) => poly([a, b, lift(b, h), lift(a, h)], fill, stroke);
    const shade = shadeOf;
    // a slab: its top, and the front sides showing its thickness (px)
    const slab = (x, y, w, h, thick, top, sideL, sideR, edge) => { const c = rect(x, y, w, h);
      prism(c, { x: 0, y: thick }, top, { faces: { left: sideL, right: sideR }, edge }); return c; };
    // a box standing on screen point q: size = its footprint's side (px, before the angle), height (px). Draws the
    // sides that face you, then the top; returns the top's corners (T/Rp/B/Lp = highest/right/lowest/left), its centre c
    // and half extents hw/hh
    const block = (q, size, height, colour, edge) => {
      const h = size / 2, foot = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => ({ x: q.x + m[0] * u + m[1] * v, y: q.y + m[2] * u + m[3] * v }));
      const top = foot.map(f => lift(f, height));
      prism(top, { x: 0, y: height }, colour, { edge, lw: 0.7 });
      const ys = top.map(t => t.y), xs = top.map(t => t.x), by = (f, v) => top[f.indexOf(v)];
      const T = by(ys, Math.min(...ys)), B = by(ys, Math.max(...ys)), Lp = by(xs, Math.min(...xs)), Rp = by(xs, Math.max(...xs));
      return { top, T, Rp, B, Lp, c: { x: q.x, y: q.y - height }, hw: (Math.max(...xs) - Math.min(...xs)) / 2, hh: (Math.max(...ys) - Math.min(...ys)) / 2 };
    };
    // a solid or figure standing on q, hw wide each side and height tall: its hit spot, and its screen box (box: x, y,
    // w, h, footprint included), which also goes in bodies so note names are placed off it
    const hit = (q, hw, height) => { const foot = hw * ay / ax, box = body([q.x - hw, q.y - height - foot, 2 * hw, height + 2 * foot]);
      return { x: q.x, y: q.y - height / 2, r: Math.max(6, hw + 2, height / 2 + 2), box }; };
    const depthSort = (items, at) => items.sort((a, b) => at(a).y - at(b).y);   // farther (higher on screen) first
    return { p, lift, poly, rect, wall, slab, block, prism, hit, depthSort, shade, ax, ay };
  }

  // ---- parts every scene shares: one figure and one set of motions. A scene picks them by name, so a zombie, the
  // palace's visitor and any figure still to come are one drawing with different poses.
  // walker(q, size, colour, { pose, head, sway, phase, lantern }) draws a stick figure standing on screen point q and
  // returns { head, h }. pose: walk | reach (arms out) | guard (fists up) | raise (arms up). phase moves the legs.
  const POSES = { walk: [[0.5, 0.35], [-0.5, 0.35]], reach: [[1.4, -0.03], [1.3, 0.03]], guard: [[0.7, -0.22], [0.45, -0.12]], raise: [[0.5, -0.45], [-0.5, -0.45]] };
  function walker(q, s, col, o = {}) {
    const h = s * 3.2, step = reducedMotion() ? 0 : Math.sin(o.phase || 0) * s * 0.35, sway = o.sway || 0;
    const hip = { x: q.x + sway * 0.3, y: q.y - h * 0.45 }, neck = { x: q.x + sway, y: q.y - h * 0.85 }, sh = { x: q.x + sway, y: q.y - h * 0.75 }, head = { x: q.x + sway, y: q.y - h };
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, s * 0.55); ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(q.x - s * 0.5 + step, q.y); ctx.lineTo(hip.x, hip.y); ctx.lineTo(q.x + s * 0.5 - step, q.y);
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(neck.x, neck.y);
    (POSES[o.pose] || POSES.walk).forEach(([ax, ay]) => { ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x + ax * s, sh.y + ay * h); });
    ctx.stroke();
    if (o.lantern) { const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, h * 2.2); g.addColorStop(0, "rgba(253,224,71,.4)"); g.addColorStop(1, "rgba(253,224,71,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(head.x, head.y, h * 2.2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = o.head || UI.colour.skin; ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(1.4, s * 0.55), 0, 2 * Math.PI); ctx.fill();
    return { head, h };
  }
  // MOTION.<name>(id, now, ...) -> [dx, dy] in layout units, different per note (seeded by its id), [0, 0] with reduced motion
  const still = [0, 0];
  const MOTION = {
    roam: (id, now, r = 30) => { if (reducedMotion()) return still; const t = now / 4000 + (hash(id) % 100); return [Math.cos(t) * r, Math.sin(t * 0.8) * r]; },
    patrol: (id, now, r = 6) => { if (reducedMotion()) return still; const t = now / 2200 + (hash(id) % 100); return [Math.sin(t) * r, Math.cos(t * 0.7) * r * 0.66]; },
    // toward a point and back, as if pushing at it
    lurch: (id, now, at, to, reach = 0.12) => { if (reducedMotion()) return still; const t = now / 1600 + (hash(id) % 100) / 16, pull = 0.5 + 0.5 * Math.sin(t);
      return [(to[0] - at[0]) * reach * pull + Math.sin(t * 3) * 3, (to[1] - at[1]) * reach * pull]; },
    // pushed away from a point for ms after `since`, easing back
    knock: (since, now, at, from, dist = 28, ms = 700) => { const d0 = now - since; if (since == null || d0 < 0 || d0 >= ms || reducedMotion()) return still;
      const f = dist * (1 - d0 / ms), d = Math.hypot(at[0] - from[0], at[1] - from[1]) || 1; return [(at[0] - from[0]) / d * f, (at[1] - from[1]) / d * f]; },
    // a run at a target and back, once every `period` ms for `share` of it
    sortie: (id, now, at, to, period = 9000, share = 0.25) => { if (reducedMotion() || !to) return still; const run = (now / period + (hash(id) % 97) / 97) % 1;
      if (run >= share) return still; const f = Math.sin(run / share * Math.PI) * 0.48; return [(to[0] - at[0]) * f, (to[1] - at[1]) * f]; },
    // a slow small sway, as if floating
    drift: (id, now, r = 10) => { if (reducedMotion()) return still; const t = now / 6000 + (hash(id) % 100); return [Math.sin(t) * r, Math.sin(t * 1.3) * r * 0.5]; },
    // round a centre point at the distance it stands
    orbit: (id, now, at, around, period = 40000) => { if (reducedMotion()) return still; const a = (now / period) * 2 * Math.PI * (hash(id) % 2 ? 1 : -1), c = Math.cos(a), s = Math.sin(a),
      u = at[0] - around[0], v = at[1] - around[1]; return [around[0] + u * c - v * s - at[0], around[1] + u * s + v * c - at[1]]; },
    // up (or down) a short way, over and over, each note at its own point in the loop
    rise: (id, now, r = 40) => { if (reducedMotion()) return still; return [0, -((now / 3000 + (hash(id) % 100) / 100) % 1) * r]; },
    fall: (id, now, r = 40) => { if (reducedMotion()) return still; return [0, ((now / 3000 + (hash(id) % 100) / 100) % 1) * r]; },
  };
  // A grid for n things, as square as it gets: stretch > 1 makes it wider than tall. { cols, rows }, never 0 columns
  const gridDims = (n, stretch = 1) => { const cols = Math.max(1, Math.ceil(Math.sqrt(n * stretch))); return { cols, rows: Math.ceil(n / cols) }; };
  // A timed event: true about perSecond times a second, for a frame dt ms long (a shot, a falling leaf)
  const chance = (perSecond, dt) => Math.random() < perSecond * dt / 1000;
  // windowSprite(x0, y0, w, h, o) draws a window, top-left at x0/y0. o.state: "lit" (warm light; o.busy > 0.5 sends a
  // figure across now and then), "boarded" (nobody's been in a while) or "plain". o.seed varies the flicker per
  // window, o.night darkens the glass, o.frame is the outline colour, o.tasks adds a red sill, o.selected a highlight.
  function windowSprite(x0, y0, ww, wh, o) {
    if (o.state === "lit") {
      const fl = reducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(o.now / 170 + o.seed % 13);
      ctx.fillStyle = `rgba(253,${200 + Math.round(30 * fl)},110,${0.75 + 0.25 * fl})`; ctx.fillRect(x0, y0, ww, wh);
      if (ww > 6 && o.busy > 0.5 && !reducedMotion()) { const t = ((o.now / 2600 + (o.seed % 100) / 100) % 1.6) - 0.3; if (t >= 0 && t <= 1) {
        const fx = x0 + t * ww, fh = wh * 0.6; ctx.fillStyle = "rgba(40,30,25,.75)"; ctx.beginPath(); ctx.arc(fx, y0 + wh - fh, Math.max(1, fh * 0.16), 0, 2 * Math.PI); ctx.fill(); ctx.fillRect(fx - fh * 0.12, y0 + wh - fh * 0.82, fh * 0.24, fh * 0.82); } }
    } else if (o.state === "boarded") {
      ctx.fillStyle = o.night ? "#121418" : "#3b3d44"; ctx.fillRect(x0, y0, ww, wh);
      if (ww > 5) { ctx.strokeStyle = "#8b6b43"; ctx.lineWidth = Math.max(1, ww * 0.12); ctx.beginPath(); ctx.moveTo(x0, y0 + wh * 0.25); ctx.lineTo(x0 + ww, y0 + wh * 0.55); ctx.moveTo(x0, y0 + wh * 0.7); ctx.lineTo(x0 + ww, y0 + wh * 0.4); ctx.stroke(); }
    } else { ctx.fillStyle = o.night ? "#2c3e5c" : "#9cc3dc"; ctx.fillRect(x0, y0, ww, wh); }
    ctx.strokeStyle = o.frame; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, ww, wh);
    if (o.tasks) { ctx.fillStyle = UI.colour.tasks; ctx.fillRect(x0 - 1, y0 + wh, ww + 2, Math.max(1.5, 2.5 * Math.sqrt(o.k || 1))); }
    if (o.selected) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.strokeRect(x0 - 3, y0 - 3, ww + 6, wh + 6); }
  }
  // ---- group layouts: where each group (a topic's settlement, column, district) stands, and its notes inside it.
  // placeGroups(n, place, cell) -> { at: [[cx, cy]...], span } in layout units; cell = room per group. place: grid
  // (square-ish), ring (round a centre), rows (a wide band), free (scattered, seeded so it's the same each time)
  function placeGroups(n, place, cell) {
    let at;
    if (place === "ring" && n > 1) { const r = Math.max(cell, n * cell / (2 * Math.PI)); at = [...Array(n)].map((_, i) => [Math.cos(i / n * 2 * Math.PI - Math.PI / 2) * r, Math.sin(i / n * 2 * Math.PI - Math.PI / 2) * r]); }
    else if (place === "free") { const s = Math.sqrt(n) * cell; at = [...Array(n)].map((_, i) => { const [u, v] = scatter("group:" + i); return [(u - 0.5) * s, (v - 0.5) * s]; }); }
    else { const { cols, rows } = gridDims(n, place === "rows" ? 4 : 1);
      at = [...Array(n)].map((_, i) => [(i % cols - (cols - 1) / 2) * cell, (Math.floor(i / cols) - (rows - 1) / 2) * cell]); }
    return { at, span: Math.max(cell / 2, ...at.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) + cell / 2)) };
  }
  // notes in rows and columns inside a square yard (centre cx/cy, half its side), with a margin
  const packIn = (ms, cx, cy, half, pos, margin = 20) => { const g = gridDims(ms.length).cols, step = (2 * half - 2 * margin) / g;
    ms.forEach((n, j) => pos.set(n.id, [cx - half + margin + (j % g + 0.5) * step, cy - half + margin + (Math.floor(j / g) + 0.5) * step])); };
  // notes round the outside of a yard, r0 out plus up to `band`, each at its own angle (seeded by its id)
  const ringAround = (ms, cx, cy, r0, pos, band = 70) => ms.forEach(n => { const a = (hash(n.id) % 628) / 100, r = r0 + (hash(n.id + "r") % band); pos.set(n.id, [cx + Math.cos(a) * r, cy + Math.sin(a) * r]); });
  // ---- sprites: what a note can be drawn as, by name. drawSprite(kind, iso, q, s, colour, o) draws one standing on screen
  // point q at size s (px) and returns { h, hw }: its height and half width, for the click area. o: pose, phase, sway
  // (walker), now/seed/state/busy/tasks (window), level (flask), height (block).
  const SPRITES = {
    walker: (iso, q, s, col, o) => { walker(q, s, col, o); return { h: s * 3.2, hw: s * 1.2 }; },
    block: (iso, q, s, col, o) => { const h = s * (o.height || 3), t = iso.block(q, s * 2.2, h, col, "rgba(0,0,0,.35)"); return { h, hw: t.hw }; },
    tower: (iso, q, s, col) => { const t = iso.block(q, s * 1.6, s * 6, "#8b7355", "rgba(0,0,0,.4)"); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(t.c.x, t.c.y, Math.max(2, s * 0.4), 0, 2 * Math.PI); ctx.fill(); return { h: s * 6, hw: t.hw }; },
    window: (iso, q, s, col, o) => { windowSprite(q.x - s, q.y - s * 2.6, s * 2, s * 2.6, { ...o, frame: col }); return { h: s * 2.6, hw: s }; },
    gem: (iso, q, s, col) => { const t = { x: q.x, y: q.y - s * 3 }, r = { x: q.x + s * 1.2, y: q.y - s * 1.9 }, l = { x: q.x - s * 1.2, y: q.y - s * 1.9 };
      iso.poly([t, r, q, l], col, "rgba(0,0,0,.4)"); iso.poly([t, r, { x: q.x, y: q.y - s * 1.9 }], "rgba(255,255,255,.35)"); return { h: s * 3, hw: s * 1.2 }; },
    flask: (iso, q, s, col, o) => { const by = q.y - s * 1.2, lvl = o.level == null ? 0.6 : o.level;
      ctx.fillStyle = "rgba(226,232,240,.25)"; ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.fill(); ctx.fillRect(q.x - s * 0.35, by - s * 2.2, s * 0.7, s * 1.3);
      ctx.save(); ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.clip(); ctx.fillStyle = col; ctx.fillRect(q.x - s * 1.2, by + s * 1.2 - lvl * s * 2.4, s * 2.4, s * 2.4); ctx.restore();
      ctx.strokeStyle = "rgba(226,232,240,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.stroke(); ctx.strokeRect(q.x - s * 0.35, by - s * 2.2, s * 0.7, s * 1.05);
      return { h: s * 3.4, hw: s * 1.2 }; },
    star: (iso, q, s, col) => { const cy = q.y - s * 1.8; ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.6 : s * 1.5, a = i / 10 * 2 * Math.PI - Math.PI / 2; i ? ctx.lineTo(q.x + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(q.x + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); return { h: s * 3.3, hw: s * 1.5 }; },
    tree: (iso, q, s, col) => { ctx.fillStyle = "#6b4f2c"; ctx.fillRect(q.x - s * 0.25, q.y - s * 1.6, s * 0.5, s * 1.6);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y - s * 2.6, s * 1.3, 0, 2 * Math.PI); ctx.fill(); return { h: s * 3.9, hw: s * 1.3 }; },
  };
  const drawSprite = (kind, iso, q, s, col, o = {}) => (SPRITES[kind] || SPRITES.walker)(iso, q, s, col, o);

  // ---- a scene written in a note: specScene(spec) turns a checked ```vault-graph-scene block (VGRules.sceneSpec) into
  // a scene() definition from the parts above. Groups are topics; each note is drawn by the first entity rule it
  // matches; walls, events and the camera angle come from the block. Unlinked notes stand out between the groups.
  function specScene(key, spec, path) {
    const W_ = VGRules.SCENE_WHEN, CELL = 520, S = { bolts: [], runs: new Map(), hit: new Map(), last: 0 };
    const ruleOf = n => spec.entity.find(r => W_[r.when](n)) || null;
    const outside = r => r && (r.motion === "lurch-in" || r.motion === "orbit");   // these stand round the yard, not in it
    const ruleName = r => r.label || (r.when === "else" ? "other" : r.when);
    const wallOf = (g, M) => spec.wall === "map-coverage" ? g.cover : spec.wall === "activity" ? Math.min(1, topicBusy(g.c) / Math.max(1, g.ids.length * 0.4))
      : spec.wall === "size" ? g.ids.length / M.biggest : 0;
    const count = (g, when) => g.ids.filter(id => byId[id] && W_[when](byId[id])).length;
    const nearest = (from, ids, when) => { let b = null, bd = Infinity; for (const id of ids) { const n = byId[id]; if (!n || id === from.id || !W_[when](n) || !P.has(id)) continue;
      const d = Math.hypot(n.x - from.x, n.y - from.y); if (d < bd) { bd = d; b = n; } } return b; };
    return {
      name: spec.name, icon: "sparkles", iso: spec.angle, fps: 30,
      blurb: spec.blurb || `A scene from ${String(path || "a note").split("/").pop().replace(/\.md$/, "")}`,
      toast: `${spec.name} — ${spec.entity.map(r => `${r.as} = ${ruleName(r)}`).join(", ")}`,
      layout(geo) {
        const pos = new Map(geo), cs = topicsWithNotes(true), { at, span } = placeGroups(cs.length, spec.place, CELL), groups = [];
        cs.forEach((c, i) => { const ms = topicNotes(c.id, true).sort(byImportance), [cx, cy] = at[i], m = mocOf[c.id];
          const half = Math.min(200, 50 + 22 * Math.sqrt(ms.length)), out = ms.filter(n => outside(ruleOf(n)));
          packIn(ms.filter(n => !outside(ruleOf(n))), cx, cy, half, pos); ringAround(out, cx, cy, half + 30, pos);
          if (m && byId[m.id]) pos.set(m.id, [cx - half + 14, cy - half + 14]);
          groups.push({ c: c.id, cx, cy, half, ids: ms.map(n => n.id), cover: m && ms.length ? ms.filter(n => VGRules.onMap(m, n.id)).length / ms.length : 0 }); });
        nodes.filter(n => n.isolated && !special(n) && !n.ghost).forEach(n => { const [u, v] = scatter("out:" + n.id); pos.set(n.id, [(u - 0.5) * 2 * span, (v - 0.5) * 2 * span]); });
        const e = span + 80;
        return { pos, groups, byC: Object.fromEntries(groups.map(g => [g.c, g])), biggest: Math.max(1, ...groups.map(g => g.ids.length)), bounds: [[-e, -e], [e, e], [-e, e], [e, -e]] };
      },
      fit: n => !special(n) && !n.ghost,
      draw(now) {
        const { R, litSet, k } = mapFrame(), M = mapCache[key], iso = isoKit(R, k, spec.angle), dt = tickOf(S, now), { night } = daylight();
        backdrop(...(spec.sky || (night ? ["#0b1020", "#1c2433"] : ["#93c5fd", "#e0f2fe"])));
        if (!M) return;
        const [b0, b1] = M.bounds, ground = spec.ground || (night ? "#232a22" : "#5b6b4a");
        iso.slab(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1], Math.max(4, 14 * k), ground, null, null, "rgba(0,0,0,.25)");
        const on = c => !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === c), wallH = g => Math.max(3, (6 + 46 * wallOf(g, M)) * k);
        M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half); ctx.globalAlpha = on(g.c) ? 1 : 0.35;
          iso.poly(c, hexMix(colorOf(g.c), ground, 0.65), "rgba(0,0,0,.3)");
          if (spec.wall !== "none") { iso.wall(c[0], c[1], wallH(g), iso.shade(colorOf(g.c), 0.45), "rgba(0,0,0,.4)"); iso.wall(c[3], c[0], wallH(g), iso.shade(colorOf(g.c), 0.55), "rgba(0,0,0,.4)"); } });
        ctx.globalAlpha = 1;
        // everyone, back to front
        const items = [];
        for (const n of nodes) { if (special(n) || n.ghost || !mapShown(n)) continue; const r = ruleOf(n); if (!r) continue;
          const g = M.byC[n.cluster], ctr = g ? [g.cx, g.cy] : [0, 0]; let x = n.x, y = n.y; const add = ([dx, dy]) => { x += dx; y += dy; };
          add(r.motion === "none" ? still : r.motion === "lurch-in" ? MOTION.lurch(n.id, now, [x, y], ctr) : r.motion === "orbit" ? MOTION.orbit(n.id, now, [x, y], ctr) : MOTION[r.motion](n.id, now));
          const run = S.runs.get(n.id); let pose = r.as === "walker" && n.tasks > 0 ? "guard" : "walk";
          if (run) { const f = (now - run.t0) / run.ms; if (f >= 1 || !byId[run.to]) S.runs.delete(n.id); else { const to = byId[run.to], reach = Math.sin(f * Math.PI) * run.reach;
            add([(to.x - x) * reach, (to.y - y) * reach]); pose = run.pose; } }
          const hit = S.hit.get(n.id); if (hit) add(MOTION.knock(hit.t, now, [x, y], hit.from));
          items.push([n, r, iso.p(x, y), pose]); }
        iso.depthSort(items, it => it[2]);
        for (const [n, r, q, pose] of items) {
          const lit0 = !litSet || litSet.has(n.id), s = Math.max(2, (2.5 + 3 * importance(n)) * Math.sqrt(k)), col = r.colour || colorOf(n.cluster);
          ctx.globalAlpha = lit0 ? 1 : 0.25;
          const d = drawSprite(r.as, iso, q, s, col, { pose, phase: now / 180 + hash(n.id), now, seed: hash(n.id), state: staleFor(n, Q.stale_days) ? "boarded" : activity(n) > 0.3 ? "lit" : "plain",
            busy: activity(n), tasks: n.tasks > 0, night, k, level: 0.2 + 0.8 * activity(n), height: 2 + 6 * importance(n) });
          if (n.tasks > 0 && r.as !== "window") { ctx.fillStyle = UI.colour.tasks; ctx.beginPath(); ctx.arc(q.x + d.hw, q.y - d.h, Math.max(1.5, s * 0.35), 0, 2 * Math.PI); ctx.fill(); }
          if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q.x, q.y, d.hw * 1.6, d.hw * 0.8, 0, 0, 2 * Math.PI); ctx.stroke(); }
          P.set(n.id, { ...iso.hit(q, d.hw, d.h), s: q.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
        }
        ctx.globalAlpha = 1;
        // each group's map stands at its corner
        M.groups.forEach(g => { const m = mocOf[g.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return; const q = iso.p(byId[m.id].x, byId[m.id].y), s = Math.max(4, 8 * Math.sqrt(k));
          const d = drawSprite("tower", iso, q, s, "#fbbf24"); P.set(m.id, { ...iso.hit(q, d.hw, d.h), s: q.s, depth: -2, a: 1 }); });
        if (spec.wall !== "none") M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half), h = wallH(g) * 0.55; ctx.globalAlpha = on(g.c) ? 0.8 : 0.3;
          iso.wall(c[1], c[2], h, iso.shade(colorOf(g.c), 0.4), "rgba(0,0,0,.4)"); iso.wall(c[2], c[3], h, iso.shade(colorOf(g.c), 0.5), "rgba(0,0,0,.4)"); });
        ctx.globalAlpha = 1;
        // events: each fires about as often as its group is busy (or has tasks, or stale notes)
        if (!reducedMotion()) M.groups.forEach(g => spec.events.forEach(ev => {
          const rate = ev.every === "activity" ? topicBusy(g.c) / 9 : ev.every === "tasks" ? count(g, "tasks") / 12 : count(g, "stale") / 20;
          if (!rate || !chance(rate, dt)) return;
          const from = g.ids.map(id => byId[id]).filter(n => n && P.has(n.id) && W_[ev.from](n) && !S.runs.has(n.id)); if (!from.length) return;
          const a = from[Math.floor(Math.random() * from.length)];
          if (ev.verb === "spar") { const b = from.filter(n => n !== a)[Math.floor(Math.random() * (from.length - 1))]; if (!b) return;
            S.runs.set(a.id, { to: b.id, t0: now, ms: 1400, reach: 0.4, pose: "guard" }); S.runs.set(b.id, { to: a.id, t0: now, ms: 1400, reach: 0.4, pose: "guard" });
            const [win, lose] = byImportance(a, b) <= 0 ? [a, b] : [b, a]; S.hit.set(lose.id, { t: now + 700, from: [win.x, win.y] }); return; }   // knocked back as the blows land
          const b = nearest(a, g.ids, ev.target); if (!b) return;
          if (ev.verb === "dispatch") { S.runs.set(a.id, { to: b.id, t0: now, ms: 2600, reach: 0.9, pose: "walk" }); return; }
          S.bolts.push({ a: a.id, b: b.id, t: 0, colour: ev.colour || (ev.verb === "spark" ? "#a5f3fc" : "#fde047") }); S.hit.set(b.id, { t: now, from: [a.x, a.y] }); }));
        S.bolts = S.bolts.filter(bo => (bo.t += dt) < 240);
        S.bolts.forEach(bo => { const a = P.get(bo.a), b = P.get(bo.b); if (!a || !b) return; ctx.strokeStyle = bo.colour; ctx.globalAlpha = 1 - bo.t / 240; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }); ctx.globalAlpha = 1;
        M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half);
          topicLabel(g.c, clip(shortName(g.c), 28).toUpperCase(), (c[0].x + c[1].x) / 2, (c[0].y + c[1].y) / 2 - wallH(g) - 22, Math.max(60, Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) + 40), "#f8fafc", "#0f172a", 10.5, { readout: true }); });
        noteLabels(items.map(it => it[0]).sort(byImportance).map(n => n.id), "#f8fafc", "#0f172a", k > 1.4 ? 60 : 14);
        const tally = new Map(); items.forEach(([, r]) => tally.set(r, (tally.get(r) || 0) + 1));
        setSceneStat(spec.entity.filter(r => tally.get(r)).map(r => `${tally.get(r)} ${ruleName(r)}`).join(" · "));
      },
      legend: item => spec.entity.map(r => item(`<b style='color:${esc(r.colour || "#e2e8f0")}'>●</b>`, `${esc(r.as)} = ${esc(ruleName(r))}`)).join("")
        + (spec.wall !== "none" ? item("▮", `wall = ${esc(spec.wall)}`) : ""),
      today() {
        const M = mapCache[key], r = spec.entity.find(x => x.when !== "else"); if (!M || !r) return null;
        const g = M.groups.slice().sort((a, b) => count(b, r.when) - count(a, r.when))[0]; if (!g || !count(g, r.when)) return null;
        const ids = g.ids.filter(id => W_[r.when](byId[id]));
        return { text: `Most ${ruleName(r)}: ${clusterName(g.c)} · ${plural(ids.length, "note")}`, label: "Show them", run: () => setHighlight(new Set(ids), `${clusterName(g.c)} · ${ruleName(r)}`) };
      },
    };
  }
  const scr = (x, y, R) => proj(x, y, 0, R);
  // Every map label goes through here: it stays inside the pane (shifted in from the edge, or cut with "…" when
  // wider than the pane), so small panes and sidebars don't show names running off the side.
  function haloText(text, x, y, fill, halo, font, align, hw) {
    ctx.font = font; ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
    if (W > 40) {
      let w = ctx.measureText(text).width;
      if (w > W - 8) { text = fitW(text, font, W - 8); w = ctx.measureText(text).width; }
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x, shift = Math.max(4 - left, Math.min(0, W - 4 - (left + w)));
      x += shift;
    }
    ctx.lineWidth = hw || 3; ctx.strokeStyle = halo; ctx.lineJoin = "round"; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  // The pane's backdrop: a top-to-bottom gradient through the colours given, evenly spaced, or [stop, colour] pairs
  // ... and a soft vignette (Neural's depth): the edges darken toward the corners. A last { vignette: false } skips it.
  function backdrop(...cols) {
    const o = cols.length && cols[cols.length - 1] && typeof cols[cols.length - 1] === "object" && !Array.isArray(cols[cols.length - 1]) ? cols.pop() : {};
    const g = ctx.createLinearGradient(0, 0, 0, H);
    cols.forEach((c, i) => Array.isArray(c) ? g.addColorStop(c[0], c[1]) : g.addColorStop(cols.length > 1 ? i / (cols.length - 1) : 0, c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (o.vignette === false) return;
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.38)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  // A topic's name over its group (a well, column, settlement or bay): fitted to maxW, left out where a label already is
  // A topic's health in a few words (Neural's lobes and the scenes' topic labels): notes, active this week, share stale
  const topicReadout = c => { const g = lobeStats[c]; return g && g.notes ? `${plural(g.notes, "note")} · ${g.fresh} active · ${Math.round(100 * g.stale / g.notes)}% stale` : ""; };
  // o.readout: a second, quieter line with topicReadout under the name (big group labels: settlements, yards)
  function topicLabel(c, text, x, y, maxW, fill, halo, size, o = {}) {
    const px = size || Math.max(8, Math.min(11, 10 * Math.sqrt(cam.k))), font = css("--vg-font") || "system-ui, sans-serif", f = `700 ${px}px ${font}`;
    const t = fitW(text != null ? text : clip(shortName(c), 28), f, Math.max(20, maxW)); if (!t) return;
    ctx.font = f; const w = ctx.measureText(t).width;
    const sf = `500 ${Math.max(7.5, px * 0.8)}px ${font}`, sub = o.readout ? fitW(topicReadout(c), sf, Math.max(20, maxW)) : "";
    ctx.font = sf; const ws = sub ? ctx.measureText(sub).width : 0, bw = Math.max(w, ws), h = sub ? px * 2.3 : 14;
    if (!freeSpot(x - bw / 2, y - 7, bw, h)) return;
    haloText(t, x, y, fill, halo, f, "center");
    if (sub) { ctx.globalAlpha *= 0.8; haloText(sub, x, y + px * 1.25, fill, halo, sf, "center"); ctx.globalAlpha /= 0.8; }
  }
  // The longest start of `text` that fits maxW pixels in `font`, with "…" when cut ("" when not even that fits).
  // Labels in small panes and narrow rooms end cleanly instead of running into their neighbours.
  function fitW(text, font, maxW) {
    ctx.font = font;
    const key = font + "|" + maxW + "|" + text; let out = fitCache.get(key); if (out !== undefined) return out;
    if (ctx.measureText(text).width <= maxW) out = text;
    else { let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= maxW) lo = mid; else hi = mid - 1; }
      out = lo >= 3 ? text.slice(0, lo).trimEnd() + "…" : ""; }
    if (fitCache.size > 4000) fitCache.clear();
    fitCache.set(key, out); return out;
  }
  const fitCache = new Map();

  function drawSubway(now) {
    const { R, litSet: lit0, font, k } = mapFrame(), S = mapCache.subway;
    // only dim when something lit is actually on the map (a note that isn't a station would grey out everything)
    const litSet = lit0 && S && [...S.stations.keys()].some(id => lit0.has(id)) ? lit0 : null;
    const bg = css("--vg-bg"), fg = css("--vg-fg");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!S) return;
    const at = id => { const n = byId[id]; return [n.x, n.y]; }, lw = Math.max(2.5, 7 * Math.sqrt(k));
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    S.lines.forEach(L => {
      const on = !litSet || L.stops.some(id => litSet.has(id)), stops = L.stops.filter(id => visible(byId[id]));
      if (stops.length < 2) return;
      ctx.globalAlpha = on ? 1 : 0.14; ctx.strokeStyle = L.color; ctx.lineWidth = lw; ctx.beginPath();
      stops.forEach((id, i) => { const p = at(id);
        if (!i) { const s0 = scr(p[0], p[1], R); ctx.moveTo(s0.x, s0.y); return; }
        legs(at(stops[i - 1]), p).forEach(([x, y]) => { const s1 = scr(x, y, R); ctx.lineTo(s1.x, s1.y); }); });
      ctx.stroke();
    });
    // trains run each line, back and forth, more of them on busier topics; riders wait at stations named in recent dailies
    // and board when a train stops by
    const stn = id => { const s0 = S.stations.get(id); return [s0.x, s0.y]; };   // final spots, not mid-morph positions
    if (!S.paths) S.paths = S.lines.map(L => { const pts = []; L.stops.forEach((id, i) => { const p = stn(id); if (!i) pts.push(p); else pts.push(...legs(stn(L.stops[i - 1]), p)); });
      const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, len }; });
    const boarded = S.boarded || (S.boarded = new Map()), trainAt = [];
    S.lines.forEach((L, li) => {
      const { pts, len } = S.paths[li], total = len[len.length - 1]; if (!total || (litSet && !L.stops.some(id => litSet.has(id)))) return;
      const busy = L.stops.reduce((a, id) => a + activity(byId[id]), 0), trains = 1 + Math.min(3, Math.round(busy * 1.5));
      for (let j = 0; j < trains; j++) {
        let dist = ((reducedMotion() ? 0.3 : now * 0.045) + j * 2 * total / trains + hash(String(L.c)) % 500) % (2 * total); if (dist > total) dist = 2 * total - dist;   // back and forth
        let i = 1; while (i < len.length - 1 && len[i] < dist) i++;
        const a = pts[i - 1], b = pts[i], f = (dist - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const sp = scr(x, y, R), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), w = Math.max(16, 24 * Math.sqrt(k)), h = Math.max(7, 9 * Math.sqrt(k));
        ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(ang); ctx.fillStyle = L.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, h / 2) : ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.85)"; for (let q = -1; q <= 1; q++) ctx.fillRect(q * w / 4 - 1, -h / 4, 2, h / 2); ctx.restore();
        trainAt.push([x, y]);
      }
    });
    S.stations.forEach(st0 => { if (trainAt.some(([x, y]) => Math.hypot(x - st0.x, y - st0.y) < 10)) boarded.set(st0.id, now); });
    // stations: white with the line colour, interchanges (several lines, or a bridge note) ringed in black
    const order = [...S.stations.values()].filter(s => visible(byId[s.id])).sort((a, b) => importance(byId[b.id]) - importance(byId[a.id]));
    order.forEach(s => {
      const n = byId[s.id], p = scr(n.x, n.y, R), inter = s.lines.length > 1 || n.bridge, r = Math.max(3.5, (inter ? 7 : 4.6) * Math.sqrt(k));
      const on = !litSet || litSet.has(s.id);
      ctx.globalAlpha = on ? 1 : 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = Math.max(1.6, (inter ? 2.6 : 2.1) * Math.sqrt(k)); ctx.strokeStyle = inter ? "#111" : (S.lines[s.lines[0]] || {}).color || "#888"; ctx.stroke();
      if (st.selected === s.id) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI); ctx.strokeStyle = css("--vg-accent"); ctx.lineWidth = 2; ctx.stroke(); }
      P.set(s.id, { x: p.x, y: p.y, s: p.s, depth: 0, r: r + 3, a: on ? 1 : 0.3 });
      if (n.recent > 0 && on) {   // riders: one per recent mention (up to 6), back gradually after a train takes them
        const since = now - (boarded.get(s.id) || -1e9), want = Math.min(6, n.recent), shown = Math.min(want, Math.floor(since / 700));
        ctx.fillStyle = "#facc15"; for (let q = 0; q < shown; q++) { const a = q / 6 * 2 * Math.PI + 0.3; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (r + 5), p.y + Math.sin(a) * (r + 5), 1.6, 0, 2 * Math.PI); ctx.fill(); }
      }
    });
    ctx.globalAlpha = 1;
    // line names at each end, as coloured pills
    S.lines.forEach(L => {
      const stops = L.stops.filter(id => visible(byId[id])); if (stops.length < 2) return;
      const name = clip(shortName(L.c), 22);
      [stops[0]].forEach((id, e) => {
        const n = byId[id], p = scr(n.x, n.y, R); ctx.font = `700 11px ${font}`;
        const w = ctx.measureText(name).width + 14, x = Math.max(4, Math.min(W - w - 4, p.x + (e ? 12 : -12 - w))), y = p.y - 24;
        if (!freeSpot(x, y - 9, w, 18)) return;
        ctx.globalAlpha = !litSet || L.stops.some(i => litSet.has(i)) ? 1 : 0.25;
        ctx.fillStyle = L.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 9, w, 18, 9) : ctx.rect(x, y - 9, w, 18); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(name, x + 7, y + 0.5);
      });
    });
    // station names where there's room, most relied-on first
    order.forEach(s => {
      const n = byId[s.id], p = P.get(s.id); if (!p) return;
      const on = !litSet || litSet.has(s.id), text = clip(n.name, MOBILE ? 22 : 30), f = `${s.lines.length > 1 ? 600 : 500} 11px ${font}`;
      ctx.font = f; const w = ctx.measureText(text).width;
      let x = p.x + p.r + 3, al = "left";
      if (!freeSpot(x, p.y - 7, w, 14)) { x = p.x - p.r - 3; al = "right"; if (!freeSpot(x - w, p.y - 7, w, 14)) return; }
      ctx.globalAlpha = on ? 1 : 0.3; haloText(text, x, p.y, fg, bg, f, al);
    });
    ctx.globalAlpha = 1;
  }

  function drawTopo(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), T = mapCache.topo;
    ctx.fillStyle = "#16304f"; ctx.fillRect(0, 0, W, H);
    if (!T) return;
    const o = scr(0, 0, R);   // world origin on screen: world (x, y) -> (o.x + x*k, o.y + y*k)
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * o.x, dpr * o.y);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(T.img, T.x0, T.y0, T.w, T.h);
    ctx.strokeStyle = "rgba(52,36,22,0.32)";
    T.contours.forEach(c => { ctx.lineWidth = (c.major ? 1.1 : 0.5) / k; ctx.beginPath();
      for (let i = 0; i < c.seg.length; i += 4) { ctx.moveTo(c.seg[i], c.seg[i + 1]); ctx.lineTo(c.seg[i + 2], c.seg[i + 3]); } ctx.stroke(); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // rivers: from each summit, steepest descent over the elevation field down to the sea, flowing
    if (!T.rivers) { const gh = T.E.length / T.gw; T.rivers = T.peaks.filter(pk => pk.h > 0.12).map(pk => {
      let i = Math.round((pk.x - T.x0) / T.CELL), j = Math.round((pk.y - T.y0) / T.CELL); const pts = [];
      for (let step = 0; step < 500; step++) { pts.push([T.x0 + i * T.CELL, T.y0 + j * T.CELL]); const e = T.E[j * T.gw + i]; if (e < T.SEA) break;
        let bi = i, bj = j, be = e; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= T.gw || jj >= gh) continue; const v = T.E[jj * T.gw + ii]; if (v < be) { be = v; bi = ii; bj = jj; } }
        if (bi === i && bj === j) break; i = bi; j = bj; }
      return pts; }).filter(p => p.length > 4); }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    T.rivers.forEach(pts => { ctx.beginPath(); pts.forEach(([x, y], q) => { const s0 = scr(x, y, R); q ? ctx.lineTo(s0.x, s0.y) : ctx.moveTo(s0.x, s0.y); });
      ctx.strokeStyle = "rgba(37,99,235,.55)"; ctx.lineWidth = Math.max(1.4, 2.6 * Math.sqrt(k)); ctx.setLineDash([]); ctx.stroke();
      ctx.strokeStyle = "rgba(191,219,254,.75)"; ctx.lineWidth = Math.max(0.8, 1.2 * Math.sqrt(k)); ctx.setLineDash([3, 9]); ctx.lineDashOffset = reducedMotion() ? 0 : -now / 45; ctx.stroke(); });
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // links across topics are bridges over the valleys; suggested links are dotted ferry routes
    ctx.lineWidth = 1;
    for (const l of visLinks) {
      if (special(l.s) || special(l.t)) continue;
      const cross = l.kind === "link" && l.s.cluster !== l.t.cluster, sug = l.kind === "gap" || l.kind === "similar";
      if (!cross && !sug) continue;
      const a = scr(l.s.x, l.s.y, R), b = scr(l.t.x, l.t.y, R), on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      ctx.globalAlpha = on ? (litSet ? 0.9 : 0.45) : 0.06; ctx.strokeStyle = sug ? "#bfe3ff" : "#3a2a1a"; ctx.setLineDash(sug ? [2, 4] : [5, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // notes: small markers; summits labelled with the topic and a made-up height
    const marks = active.filter(n => !special(n) && !n.ghost).sort((a, b) => importance(a) - importance(b));
    marks.forEach(n => {
      const p = scr(n.x, n.y, R), on = !litSet || litSet.has(n.id), r = Math.max(1.8, (1.6 + 3 * importance(n)) * Math.sqrt(k));
      ctx.globalAlpha = on ? 0.95 : 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = litSet && on ? "#fff" : "#2a1e14"; ctx.fill();
      if (st.selected === n.id) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(r, 4), a: on ? 1 : 0.3 });
    });
    ctx.globalAlpha = 1;
    if (!T.fogs) T.fogs = nodes.filter(n => !special(n) && !n.ghost && activity(n) < 0.02 && T.pos.get(n.id)).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 9).map(n => T.pos.get(n.id));
    T.fogs.forEach(([x, y], i) => { const dx = reducedMotion() ? 0 : Math.sin(now / 9000 + i) * 60, q = scr(x + dx, y + Math.cos(now / 11000 + i * 2) * 25, R), rr = 110 * k;   // fog banks drift over quiet ground
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr); g.addColorStop(0, "rgba(241,245,249,.32)"); g.addColorStop(1, "rgba(241,245,249,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.55, 0, 0, 2 * Math.PI); ctx.fill(); });
    T.peaks.slice().sort((a, b) => b.h - a.h).forEach(pk => {
      const p = scr(pk.x, pk.y, R), name = `▲ ${clip(clusterName(pk.c), 30)}`, f = `italic 600 ${pk.h > 0.6 ? 13.5 : 11.5}px Georgia, serif`;
      ctx.font = f; const w = ctx.measureText(name).width;
      if (!freeSpot(p.x - w / 2, p.y - 26, w, 28)) return;
      haloText(name, p.x, p.y - 18, "#1d140c", "rgba(255,250,240,.55)", f, "center", 2);
      haloText(`${Math.round(pk.h * 2400).toLocaleString()} m`, p.x, p.y - 5, "#4b3a2a", "rgba(255,250,240,.5)", `500 9.5px ${font}`, "center", 2);
    });
    if (k > 1.4) marks.slice().reverse().forEach(n => {   // zoomed in: note names where there's room
      const p = P.get(n.id), text = clip(n.name, 26), f = `500 10.5px ${font}`; ctx.font = f; const w = ctx.measureText(text).width;
      if (freeSpot(p.x + p.r + 2, p.y - 6, w, 12)) haloText(text, p.x + p.r + 2, p.y, "#1d140c", "rgba(255,250,240,.8)", f);
    });
  }

  const hexMix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  function drawCity(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), C = mapCache.city;
    // the sky follows your clock: night, dawn and dusk glow, a muted day (dark enough that lit windows still read)
    const { night, dusk } = daylight();
    const SKY = night ? ["#070b1d", "#1b1638", "#33204a"] : dusk ? ["#1e1b4b", "#7c2d5e", "#f59e0b"] : ["#1e3a5f", "#3b6a9a", "#7fa7cf"];
    backdrop(SKY[0], [0.65, SKY[1]], [1, SKY[2]]);
    if (night || dusk) for (let i = 0; i < (MOBILE ? 60 : 140); i++) { const h = hash("star" + i); ctx.globalAlpha = 0.25 + (h % 60) / 100; ctx.fillStyle = "#fff"; ctx.fillRect((h % 997) / 997 * W, ((h >>> 10) % 991) / 991 * H * 0.6, 1.3, 1.3); }
    ctx.globalAlpha = 1;
    if (!C) return;
    const pt = (gx, gy, z) => { const [x, y] = iso(gx, gy), p = scr(x, y, R); return [p.x, p.y - z * k]; };
    // streets: an asphalt ring round every district with a dashed centre line
    const poly = ps => { ctx.beginPath(); ps.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
    const ring = (d, o) => [[d.bx - o, d.by - o], [d.bx + d.w + o, d.by - o], [d.bx + d.w + o, d.by + d.h + o], [d.bx - o, d.by + d.h + o]].map(([x, y]) => pt(x, y, 0));
    C.districts.forEach(d => { poly(ring(d, 0.55)); ctx.fillStyle = night ? "#141826" : "#262b38"; ctx.fill(); });
    ctx.setLineDash([4 * k, 5 * k]); ctx.strokeStyle = "rgba(250,204,21,.28)"; ctx.lineWidth = Math.max(0.6, 0.8 * k);
    C.districts.forEach(d => { poly(ring(d, 0.27)); ctx.stroke(); }); ctx.setLineDash([]);
    // district ground plates and their names
    C.districts.forEach(d => {
      const cs = [[d.bx, d.by], [d.bx + d.w, d.by], [d.bx + d.w, d.by + d.h], [d.bx, d.by + d.h]].map(([x, y]) => pt(x, y, 0));
      const col = d.c === -2 ? "#5b5f6b" : d.c < 0 ? "#4b5160" : colorOf(d.c);
      ctx.beginPath(); cs.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = hexMix(col, "#0d1022", 0.72); ctx.fill(); ctx.strokeStyle = hexMix(col, "#0d1022", 0.4); ctx.lineWidth = 1; ctx.stroke();
    });
    // traffic: cars circle each district's streets, more where the topic is busy; headlights ahead, tail lights behind
    C.districts.forEach(d => {
      const o = 0.27, W0 = d.w + 2 * o, H0 = d.h + 2 * o, per = 2 * (W0 + H0), cars = Math.min(MOBILE ? 3 : 7, 1 + Math.round(6 * d.act));
      const at = s => { s = ((s % per) + per) % per; const x0 = d.bx - o, y0 = d.by - o;
        return s < W0 ? [x0 + s, y0] : s < W0 + H0 ? [x0 + W0, y0 + s - W0] : s < 2 * W0 + H0 ? [x0 + W0 - (s - W0 - H0), y0 + H0] : [x0, y0 + H0 - (s - 2 * W0 - H0)]; };
      for (let j = 0; j < cars; j++) { const s = (reducedMotion() ? 0 : now / 900) + j * per / cars + (hash(String(d.c)) % 50) / 10, hd = pt(...at(s + 0.12), 0), tl = pt(...at(s - 0.12), 0);
        ctx.fillStyle = "rgba(254,240,138,.95)"; ctx.beginPath(); ctx.arc(hd[0], hd[1], Math.max(1, 1.3 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "rgba(248,113,113,.9)"; ctx.beginPath(); ctx.arc(tl[0], tl[1], Math.max(0.9, 1.1 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
    });
    // buildings, back to front (planned lots always show)
    const lot = [...C.b.entries()].filter(([id]) => byId[id].ghost ? !replay : mapShown(byId[id])).sort((a, b) => (a[1].gx + a[1].gy) - (b[1].gx + b[1].gy));
    // shadows first, so buildings stand on the ground rather than on a neighbour's shadow
    ctx.fillStyle = night ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.28)";
    lot.forEach(([id, B]) => { const n = byId[id]; if (n.ghost) return; const base = scr(n.x, n.y, R), hf = B.f / 2, sx = B.h * k * 0.42, sy = B.h * k * 0.14;
      const c = (dx, dy) => [base.x + (dx - dy) * U * 0.866 * k, base.y + (dx + dy) * U * 0.5 * k], bk = c(-hf, -hf), rt = c(hf, -hf), fr = c(hf, hf), lf = c(-hf, hf);
      poly([bk, rt, [rt[0] + sx, rt[1] + sy], [fr[0] + sx, fr[1] + sy], [lf[0] + sx, lf[1] + sy], lf]); ctx.fill(); });
    const sel = st.selected && C.b.get(st.selected);
    lot.forEach(([id, B]) => {
      const n = byId[id], on = !litSet || litSet.has(id), half = B.f / 2;
      // the note's position (it morphs in) is the lot's centre; corners are offsets from it
      const base = scr(n.x, n.y, R), off = (dx, dy, z) => [base.x + (dx - dy) * U * 0.866 * k, base.y + (dx + dy) * U * 0.5 * k - z * k];
      const bk = off(-half, -half, 0), rt = off(half, -half, 0), fr = off(half, half, 0), lf = off(-half, half, 0);
      ctx.globalAlpha = on ? 1 : 0.22;
      if (n.ghost) {   // planned: an empty lot
        ctx.setLineDash([3, 3]); ctx.strokeStyle = "#9aa3b5"; ctx.lineWidth = 1; ctx.beginPath(); [bk, rt, fr, lf].forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        P.set(id, { x: fr[0], y: (bk[1] + fr[1]) / 2, s: base.s, depth: -(B.gx + B.gy), r: Math.max(5, (fr[1] - bk[1]) / 2), a: on ? 1 : 0.3 });
        return;
      }
      const stale = staleFor(n, Q.stale_days), base0 = n.cluster >= 0 ? colorOf(n.cluster) : "#8b93a6";
      const col = stale ? hexMix(base0, "#5e626d", 0.72) : base0, h = B.h;
      const up = ([x, y]) => [x, y - h * k], xy = ([x, y]) => ({ x, y });
      // the tower: its roof pushed down to the street, through the shared prism (lit from the upper left like every solid)
      prism([up(bk), up(rt), up(fr), up(lf)].map(xy), { x: 0, y: h * k }, hexMix(col, "#ffffff", stale ? 0.05 : 0.18));
      // windows: lit by recent activity (a stable pattern per note), dark otherwise
      const act = activity(n), floors = Math.max(1, Math.floor(h / 9)), px = 1.6 * Math.sqrt(k);
      if (px >= 1) for (let fl = 0; fl < floors; fl++) for (let side = 0; side < 2; side++) for (let w = 0; w < 2; w++) {
        const t = (w + 0.5) / 2, z = (fl + 0.55) * (h / floors), [a1, a2] = side ? [fr, rt] : [lf, fr];
        const x = a1[0] + (a2[0] - a1[0]) * t, y = a1[1] + (a2[1] - a1[1]) * t - z * k;
        const flick = !reducedMotion() && hash(id + fl + side + w + Math.floor(now / 2600)) % 29 === 0;   // now and then a light goes on or off
        const litW = ((hash(id + fl + "|" + side + w) % 100) < act * 100) !== flick;
        ctx.fillStyle = litW ? "#ffd977" : "rgba(10,12,24,.55)"; ctx.fillRect(x - px / 2, y - px, px, px * 1.3);
      }
      // a crane on the newest notes (last week, at most 15)
      if (C.cranes && C.cranes.has(id)) {
        const [tx, ty] = up(fr), m = Math.max(10, 18 * Math.sqrt(k));
        ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - m); ctx.lineTo(tx + m * 0.9, ty - m); ctx.moveTo(tx + m * 0.6, ty - m); ctx.lineTo(tx + m * 0.6, ty - m * 0.55); ctx.stroke();
      }
      if (n.tasks > 0) { const cx = (up(bk)[0] + up(fr)[0]) / 2, cy = (up(bk)[1] + up(fr)[1]) / 2, blink = reducedMotion() || Math.sin(now / 380 + hash(id) % 7) > 0.2;   // open tasks: a beacon
        ctx.fillStyle = blink ? "#ef4444" : "rgba(239,68,68,.25)"; ctx.beginPath(); ctx.arc(cx, cy - 2, Math.max(1.2, 1.8 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
      if (id === st.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); [up(bk), up(rt), up(fr), up(lf)].forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); }
      P.set(id, { x: (lf[0] + rt[0]) / 2, y: fr[1] - (h * k) / 2 - (fr[1] - bk[1]) / 4, s: base.s, depth: -(B.gx + B.gy), r: Math.max(6, Math.max(rt[0] - lf[0], h * k) / 2), a: on ? 1 : 0.3,
        box: body([lf[0], up(bk)[1], rt[0] - lf[0], fr[1] - up(bk)[1]]) });   // the tower's screen box, so names keep off it
    });
    ctx.globalAlpha = 1;
    // town halls: each district's map stands in its plaza (click it like any note); no map = an empty plaza with a sign
    C.districts.forEach(d => { if (d.c < 0) return; const [x, y] = pt(d.bx + d.w / 2, d.by + d.h - 0.55, 0), s = Math.max(4, 9 * k);
      if (!d.hall) return;   // its "no map yet" sign goes with the names below
      ctx.globalAlpha = !litSet || litSet.has(d.hall) ? 1 : 0.3;
      ctx.fillStyle = "#e5e7eb"; ctx.fillRect(x - s, y - s * 1.1, s * 2, s * 1.1);
      ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.arc(x, y - s * 1.1, s * 0.75, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "rgba(30,41,59,.75)"; for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * s * 0.6 - s * 0.12, y - s * 0.8, s * 0.24, s * 0.8);
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - s * 1.85); ctx.lineTo(x, y - s * 2.8); ctx.stroke();
      ctx.fillStyle = colorOf(d.c); ctx.beginPath(); ctx.moveTo(x, y - s * 2.8); ctx.lineTo(x + s * 0.9, y - s * 2.5); ctx.lineTo(x, y - s * 2.2); ctx.fill();
      ctx.globalAlpha = 1; P.set(d.hall, { x, y: y - s, s: 1, depth: -(d.bx + d.by + d.w + d.h), r: s * 1.4, a: 1 });
      if (d.hall === st.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x - s - 2, y - s * 2.9, s * 2 + 4, s * 2.9 + 2); } });
    // selected building: light trails to its linked buildings
    if (sel) {
      const top = id => { const n = byId[id], B = C.b.get(id), p = scr(n.x, n.y, R); return [p.x, p.y - (B ? B.h : 0) * k]; };
      const [sx, sy] = top(st.selected);
      ctx.strokeStyle = "rgba(255,217,119,.75)"; ctx.lineWidth = 1.4;
      [...nb[st.selected]].filter(id => C.b.has(id) && visible(byId[id])).forEach(id => { const [x, y] = top(id); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + x) / 2, Math.min(sy, y) - 40, x, y); ctx.stroke(); });
    }
    // district names on the ground (and a plaza with no town hall says so), then the tallest buildings' names
    C.districts.forEach(d => {
      const [x, y] = pt(d.bx + d.w / 2, d.by + d.h + 0.4, 0), name = d.c === -2 ? "PLANNED (NOT WRITTEN YET)" : d.c < 0 ? "OUTSKIRTS" : clip(shortName(d.c), k > 0.8 ? 26 : 18).toUpperCase() + (d.dark && k > 0.8 ? ` · ${d.dark} DARK` : "");   // zoomed out: short names only
      const f = `700 10.5px ${font}`; ctx.font = f; const w = ctx.measureText(name).width;
      if (freeSpot(x - w / 2, y - 7, w, 14)) haloText(name, x, y, "#c7cbe0", "#0b0e20", f, "center");
      if (d.c < 0 || d.hall || k <= 0.45) return;
      const [sx, sy] = pt(d.bx + d.w / 2, d.by + d.h - 0.55, 0), sf = `700 ${Math.round(Math.max(8, Math.min(11, 9 * k)))}px ${font}`; ctx.font = sf; const sw = ctx.measureText("no map yet").width;
      if (freeSpot(sx - sw / 2, sy - 7, sw, 14)) haloText("no map yet", sx, sy, "#fbbf24", "#0b0e20", sf, "center");
    });
    noteLabels(lot.filter(([id]) => !byId[id].ghost).sort((a, b) => b[1].h - a[1].h).map(([id]) => id), "#f2f3fa", "#0b0e20", MOBILE ? 12 : 28);
  }

  // Garden: a digital garden, where notes grow from seed to evergreen. Each topic is a bed; a note's stage comes from
  // how developed it is (length, notes relying on it, references, age). Stale notes wilt, notes with open tasks need
  // water, recently active ones flower, orphans (nothing links to them) have weeds. Unlinked notes wait in the
  // nursery; notes you link to but haven't written are seed packets.
  const GC = 30;   // one plant's plot, in world units
  // unlinked notes have a place of their own here (the nursery, the storeroom), so they show without "Show unlinked"
  const mapShown = n => visible(n) || (n.isolated && !replay && !st.focusDist && !st.hidden.has(n.id) && !st.hiddenClusters.has(n.cluster));
  const maturity = n => n.ghost ? 0 : 0.35 * Math.min(1, (n.words || 0) / 1500) + 0.35 * Math.min(1, Math.log1p(n.inlinks || 0) / Math.log(12))
    + 0.15 * (n.refs ? 1 : 0) + 0.15 * Math.min(1, n.born ? (Date.now() - new Date(n.born + "T12:00")) / 864e5 / 180 : 0);
  const STAGES = ["seed packet", "seed", "seedling", "budding", "evergreen"];
  const stageOf = n => { if (n.ghost) return 0; const m = maturity(n); return m < 0.2 ? 1 : m < 0.42 ? 2 : m < 0.65 ? 3 : 4; };
  // beds keep the familiar 2D arrangement: rows by where each topic sits top to bottom, left to right within a row
  function packBeds(groups, geo, size) {
    const cen = ms => ms.reduce((s, n) => { const p = geo.get(n.id) || [0, 0]; return [s[0] + p[0] / ms.length, s[1] + p[1] / ms.length]; }, [0, 0]);
    const items = Object.entries(groups).map(([c, ms]) => ({ c: +c, ms, cen: cen(ms), ...size(ms) }));
    const total = items.reduce((s, it) => s + it.w * it.h, 0), ROW_W = Math.max(900, Math.sqrt(total) * 1.5);
    const main = items.filter(it => it.c > -2).sort((a, b) => a.cen[1] - b.cen[1]), extra = items.filter(it => it.c <= -2);
    const rows = []; let row = [], rw = 0;
    main.forEach(it => { if (row.length && rw + it.w > ROW_W) { rows.push(row); row = []; rw = 0; } row.push(it); rw += it.w + 40; });
    if (row.length) rows.push(row);
    if (extra.length) rows.push(extra);
    let y = 0;
    rows.forEach(r => { r.sort((a, b) => (a.c <= -2) - (b.c <= -2) || a.cen[0] - b.cen[0]); const wsum = r.reduce((s, it) => s + it.w, 0) + 40 * (r.length - 1);
      let x = -wsum / 2; const h = Math.max(...r.map(it => it.h)); r.forEach(it => { it.x = x; it.y = y; x += it.w + 40; }); y += h + 56; });
    items.forEach(it => { it.y -= y / 2; });
    return items;
  }
  function gardenLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.moc) return; const c = n.ghost ? -2 : n.isolated ? -3 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    const beds = packBeds(groups, geo, ms => { const { cols } = gridDims(ms.length, 1.7); return { cols, w: cols * GC + 24, h: Math.ceil(ms.length / cols) * GC + 44 }; });
    const pos = new Map(geo), plant = new Map();
    beds.forEach(b => {
      b.ms.sort((x, y) => maturity(y) - maturity(x));   // evergreens at the back of the bed
      b.ms.forEach((n, i) => { const x = b.x + 12 + (i % b.cols + 0.5) * GC, y = b.y + 34 + (Math.floor(i / b.cols) + 0.5) * GC;
        pos.set(n.id, [x, y]); plant.set(n.id, stageOf(n)); });
      b.stats = { ever: b.ms.filter(n => plant.get(n.id) === 4).length, wilt: b.ms.filter(n => !n.ghost && staleFor(n, Q.stale_days)).length };
    });
    // the beds' corners, so the camera frames whole beds (names and edges), not just the plants in them
    return { beds, pos, plant, bounds: beds.flatMap(b => [[b.x, b.y - 8], [b.x + b.w, b.y + b.h]]) };
  }
  function drawGarden(now) {
    const { R, litSet, font, k } = mapFrame(), G = mapCache.garden;
    backdrop("#16261a", "#22351f");
    if (!G) return;
    const u = Math.max(0.35, k);   // plant scale on screen
    G.beds.forEach(b => {
      const p = scr(b.x, b.y, R), w = (b.cols * GC + 24) * k, h = (Math.ceil(b.ms.length / b.cols) * GC + 44) * k;
      ctx.fillStyle = b.c === -3 ? "#5a4636" : b.c === -2 ? "#3a3f36" : "#4a3325"; ctx.strokeStyle = b.c >= 0 ? hexMix(colorOf(b.c), "#4a3325", 0.45) : "#6d5644"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x, p.y, w, h, 8 * k) : ctx.rect(p.x, p.y, w, h); ctx.fill(); ctx.stroke();
      const name = b.c === -3 ? "NURSERY · NOT LINKED YET" : b.c === -2 ? "SEED PACKETS · NOT WRITTEN YET" : b.c < 0 ? "UNSORTED · NO TOPIC YET" : clip(shortName(b.c), 28).toUpperCase();
      const f = `700 ${Math.max(9, Math.min(12, 11 * Math.sqrt(k)))}px ${font}`; ctx.font = f;
      if (w > 60 && freeSpot(p.x + 8, p.y + 4, Math.min(w - 16, ctx.measureText(name).width), 14)) {
        haloText(name, p.x + 8, p.y + 12 * Math.min(1.2, Math.max(0.8, k)), b.c >= 0 ? hexMix(colorOf(b.c), "#ffffff", 0.45) : "#d6c7b4", "#2b1d14", f);
        if (b.c >= 0 && k > 0.55) haloText(`${b.stats.ever} evergreen · ${b.stats.wilt} wilting`, p.x + 8, p.y + 25 * Math.min(1.2, Math.max(0.8, k)), "#c9b8a0", "#2b1d14", `500 9.5px ${font}`);
      }
    });
    const leaf = (x, y, rx, ry, a, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, 2 * Math.PI); ctx.fill(); };
    for (const b of G.beds) for (const n of b.ms) {
      if (!(n.ghost ? !replay : mapShown(n))) continue;   // seed packets always show, like City's planned lots
      const p = scr(n.x, n.y, R), on = !litSet || litSet.has(n.id), stg = G.plant.get(n.id), wilt = !n.ghost && staleFor(n, Q.stale_days);
      const green = wilt ? "#9a8a45" : "#4caf50", dark = wilt ? "#7a6a32" : "#2e7d32", sway = reducedMotion() ? 0 : Math.sin(now / 1300 + hash(n.id) % 7) * 0.08;
      const bx = p.x, by = p.y + 9 * u;   // ground level
      ctx.globalAlpha = on ? 1 : 0.22;
      if (stg === 0) { ctx.fillStyle = "#cbbf9f"; ctx.fillRect(bx - 5 * u, by - 13 * u, 10 * u, 13 * u); ctx.fillStyle = colorOf(-1); ctx.fillRect(bx - 3 * u, by - 10 * u, 6 * u, 4 * u); }
      else if (stg === 1) { leaf(bx, by - 2 * u, 3.2 * u, 2.2 * u, 0, "#8d6e4f"); leaf(bx, by - 5 * u, 1 * u, 2 * u, sway, green); }
      else {
        const hgt = (stg === 2 ? 9 : stg === 3 ? 15 : 12) * u, tip = [bx + (wilt ? 4 * u : sway * 10 * u), by - hgt];
        ctx.strokeStyle = stg === 4 ? "#6d4c2f" : dark; ctx.lineWidth = (stg === 4 ? 3 : 1.4) * u;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx, by - hgt * 0.6, tip[0], tip[1]); ctx.stroke();
        if (stg === 2) { leaf(tip[0] - 3 * u, tip[1] + 1 * u, 3.4 * u, 1.6 * u, -0.5 + (wilt ? 0.9 : 0), green); leaf(tip[0] + 3 * u, tip[1] + 1 * u, 3.4 * u, 1.6 * u, 0.5 + (wilt ? 0.9 : 0), green); }
        else if (stg === 3) { [0.35, 0.65].forEach(t => { const y = by - hgt * t; leaf(bx - 3.5 * u, y, 4 * u, 1.8 * u, -0.4, green); leaf(bx + 3.5 * u, y, 4 * u, 1.8 * u, 0.4, green); });
          ctx.fillStyle = wilt ? "#8a7a55" : colorOf(n.cluster); ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.6 * u, 0, 2 * Math.PI); ctx.fill(); }
        else { const r = (9 + 4 * importance(n)) * u, cy = tip[1] - r * 0.55;
          leaf(tip[0], cy, r, r * 0.85, 0, dark); leaf(tip[0] - r * 0.25, cy - r * 0.25, r * 0.55, r * 0.45, 0, wilt ? "#a8984f" : "#43a047"); }
        if (!wilt && activity(n) > 0.3) {   // in flower: recently edited or talked about
          const fx = tip[0], fy = stg === 4 ? tip[1] - (9 + 4 * importance(n)) * u * 0.9 : tip[1] - 2 * u;
          ctx.fillStyle = hexMix(colorOf(n.cluster), "#ffffff", 0.35);
          for (let i = 0; i < 5; i++) { const a = i * 1.2566 + now / 4000; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 2.6 * u, fy + Math.sin(a) * 2.6 * u, 1.5 * u, 0, 2 * Math.PI); ctx.fill(); }
          ctx.fillStyle = "#fde047"; ctx.beginPath(); ctx.arc(fx, fy, 1.2 * u, 0, 2 * Math.PI); ctx.fill();
        }
      }
      if (n.tasks > 0 && !n.ghost && u > 0.5) { ctx.fillStyle = "#60a5fa"; ctx.beginPath(); ctx.moveTo(bx + 8 * u, by - 12 * u); ctx.quadraticCurveTo(bx + 11 * u, by - 7 * u, bx + 8 * u, by - 6 * u); ctx.quadraticCurveTo(bx + 5 * u, by - 7 * u, bx + 8 * u, by - 12 * u); ctx.fill(); }
      if (!n.ghost && !n.isolated && n.inlinks === 0 && u > 0.45) { ctx.strokeStyle = "#7c9a2a"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = -1; i <= 1; i++) { ctx.moveTo(bx - 7 * u + i * 2 * u, by); ctx.lineTo(bx - 8 * u + i * 3 * u, by - 5 * u); } ctx.stroke(); }
      if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by - 8 * u, 14 * u, 0, 2 * Math.PI); ctx.stroke(); }
      P.set(n.id, { x: bx, y: by - 8 * u, s: p.s, depth: -maturity(n), r: Math.max(7, 12 * u), a: on ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    // bees fly between flowering notes along their links (pollination); wilting plants drop leaves
    const gz = G.life || (G.life = { bees: [], leaves: [] }), gdt = tickOf(gz, now);
    const flowers = G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && !n.ghost && !staleFor(n, Q.stale_days) && activity(n) > 0.3);
    const pool = flowers.length ? flowers : G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && G.plant.get(n.id) >= 3);
    while (pool.length && gz.bees.length < Math.min(12, Math.max(3, pool.length))) { const a = pool[Math.floor(Math.random() * pool.length)]; gz.bees.push({ from: a.id, to: a.id, t: 1, dur: 1 }); }
    gz.bees.forEach(bee => { bee.t += gdt / bee.dur;
      if (bee.t >= 1) { bee.from = bee.to; const near = [...(nb[bee.from] || [])].filter(id => P.has(id)), fl = near.filter(id => flowers.some(f => f.id === id));
        bee.to = (fl.length ? fl : near.length ? near : pool.map(n => n.id))[Math.floor(Math.random() * (fl.length || near.length || pool.length))] || bee.from;
        bee.t = 0; bee.dur = 900 + Math.random() * 1600; }
      const A = P.get(bee.from), B = P.get(bee.to); if (!A || !B) { bee.t = 1; return; }
      const e = bee.t < 0.15 ? 0 : (bee.t - 0.15) / 0.85, x = A.x + (B.x - A.x) * e + Math.sin(now / 90 + bee.dur) * 2, y = A.y + (B.y - A.y) * e - Math.sin(e * Math.PI) * 24 - 8 * u;   // hovers, then hops over
      ctx.fillStyle = "rgba(255,255,255,.75)"; const wing = 2.2 + Math.abs(Math.sin(now / 25)) * 1.5; ctx.beginPath(); ctx.ellipse(x - 1, y - 2, wing, 1.2, -0.5, 0, 2 * Math.PI); ctx.ellipse(x + 1, y - 2, wing, 1.2, 0.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.8, 0, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = "#1c1917"; ctx.fillRect(x - 0.6, y - 1.7, 1.2, 3.4); });
    G.beds.flatMap(b => b.ms).forEach(n => { if (n.ghost || !staleFor(n, Q.stale_days) || !P.has(n.id) || gz.leaves.length > 60 || !chance(0.6, gdt)) return;
      const q = P.get(n.id); gz.leaves.push({ x: q.x, y: q.y - 6 * u, t: 0, sway: Math.random() * 6 }); });
    gz.leaves = gz.leaves.filter(l => (l.t += gdt) < 3200);
    gz.leaves.forEach(l => { const f = l.t / 3200, x = l.x + Math.sin(l.t / 400 + l.sway) * 6, y = l.y + f * 34 * u;
      ctx.globalAlpha = 1 - f; ctx.fillStyle = "#b08442"; ctx.beginPath(); ctx.ellipse(x, y, 2.4 * u, 1.2 * u, Math.sin(l.t / 300) , 0, 2 * Math.PI); ctx.fill(); });
    ctx.globalAlpha = 1;
    // names: evergreens first, then anything with room once zoomed in
    const named = G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && (G.plant.get(n.id) === 4 || k > 1.3)).sort((a, b) => maturity(b) - maturity(a)).slice(0, k > 1.3 ? 120 : MOBILE ? 14 : 30);
    named.forEach(n => { const p = P.get(n.id), text = clip(n.name, 24), f = `600 10px ${font}`; ctx.font = f; const w = ctx.measureText(text).width;
      if (freeSpot(p.x - w / 2, p.y + p.r * 0.4, w, 13)) haloText(text, p.x, p.y + p.r * 0.4 + 7, "#f1f5e9", "#1b2a18", f, "center"); });
  }

  // Palace: the method of loci. Each topic is a room in one building, sized by its notes. Topics that link are laid
  // side by side where they can be, with a door in the shared wall (wider = more links); linked rooms that don't
  // touch are joined by a passage, and topics that should connect but don't have a bricked-up doorway. Each note is
  // an object in its room -- bigger is more relied on, a lit lamp is recent activity, dust is stale -- and the
  // topic's map (MOC) is the plaque inside the door.
  function palaceLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.ghost || n.moc) return; const c = n.isolated ? -3 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    // order rooms as a chain of strongest links, so split neighbours tend to share a wall
    const left = Object.keys(groups).map(Number).sort((a, b) => layoutSeed() ? topicRank(a) - topicRank(b) : groups[b].length - groups[a].length), order = left.length ? [left.shift()] : [];   // a vault with no topic notes has no rooms
    while (left.length) { const last = order[order.length - 1]; let bi = 0, bw = -1; left.forEach((c, i) => { const w = topicPair(last, c).links; if (w > bw) { bw = w; bi = i; } }); order.push(left.splice(bi, 1)[0]); }
    // Floors: the rooms in that order, a few topics per floor; the storeroom (unlinked notes) is the basement.
    // No floor chosen: the palace from the front. A floor: its plan, rooms and doors as before.
    const upper = order.filter(c => c !== -3), nf = Math.max(1, Math.round(Math.sqrt(upper.length / 1.5))), per = Math.ceil(upper.length / nf);
    const levels = groups[-3] ? [[-3]] : [];
    for (let i = 0; i < upper.length; i += per) levels.push(upper.slice(i, i + per));
    const hasBase = !!groups[-3];
    if (st.palaceFloor == null || st.palaceFloor >= levels.length) { st.palaceFloor = null; return palaceFacade(geo, groups, levels, hasBase); }
    const floorRooms = levels[st.palaceFloor];
    order.splice(0, order.length, ...floorRooms);
    // the storeroom packs tighter: it's for finding, not browsing
    const area = c => groups[c].length * (c === -3 ? 900 : 2400) + 9000, total = order.reduce((s, c) => s + area(c), 0);
    const BW = Math.sqrt(total * 1.6), BH = total / BW, rooms = [];
    (function split(list, x, y, w, h) {   // ordered binary split: keeps neighbours in the list next to each other
      if (list.length === 1) { rooms.push({ c: list[0], x, y, w, h }); return; }
      const sum = list.reduce((s, c) => s + area(c), 0); let acc = 0, i = 0;
      while (i < list.length - 1 && acc + area(list[i]) / 2 < sum / 2) acc += area(list[i++]);
      i = Math.max(1, i); const a = list.slice(0, i), f = a.reduce((s, c) => s + area(c), 0) / sum;
      if (w >= h) { split(a, x, y, w * f, h); split(list.slice(i), x + w * f, y, w * (1 - f), h); }
      else { split(a, x, y, w, h * f); split(list.slice(i), x, y + h * f, w, h * (1 - f)); }
    })(order, -BW / 2, -BH / 2, BW, BH);
    const pos = new Map(geo), obj = new Map(), byC = {};
    rooms.forEach(r => {
      byC[r.c] = r;
      const ms = groups[r.c].slice().sort(byImportance), pad = 22, top = 30;
      const iw = Math.max(10, r.w - 2 * pad), ih = Math.max(10, r.h - pad - top), cols = Math.max(1, Math.round(Math.sqrt(ms.length * iw / ih))), rows = Math.ceil(ms.length / cols);
      const cells = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([r.x + pad + (i + 0.5) * iw / cols, r.y + top + (j + 0.5) * ih / rows]);
      const cx = r.x + r.w / 2, cy = r.y + top + ih / 2;
      cells.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));   // the most relied-on in the middle
      ms.forEach((n, i) => { pos.set(n.id, cells[i]); obj.set(n.id, Math.min(iw / cols, ih / rows)); });
      const m = mocOf[r.c]; if (m && byId[m.id]) pos.set(m.id, [r.x + 16, r.y + 16]);
    });
    // doors on shared walls; passages between linked rooms that don't touch; bricked-up doorways for gaps
    const doors = [], passages = [], EPS = 1;
    const wallBetween = (A, B) => {
      const ov = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
      if (Math.abs(A.x + A.w - B.x) < EPS || Math.abs(B.x + B.w - A.x) < EPS) { const [s, e] = ov(A.y, A.y + A.h, B.y, B.y + B.h); if (e - s > 30) return { v: true, at: Math.abs(A.x + A.w - B.x) < EPS ? B.x : A.x, s, e }; }
      if (Math.abs(A.y + A.h - B.y) < EPS || Math.abs(B.y + B.h - A.y) < EPS) { const [s, e] = ov(A.x, A.x + A.w, B.x, B.x + B.w); if (e - s > 30) return { v: false, at: Math.abs(A.y + A.h - B.y) < EPS ? B.y : A.y, s, e }; }
      return null;
    };
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j], { links: l, gap: g0 } = topicPair(A.c, B.c), gap = !l && g0;
      if (!l && !gap) continue;
      const wall = wallBetween(A, B);
      if (wall) { const mid = (wall.s + wall.e) / 2, half = Math.min((wall.e - wall.s) * 0.35, gap ? 14 : 8 + 4 * Math.sqrt(l)) ;
        doors.push({ ...wall, mid, half, gap, a: A.c, b: B.c, l }); }
      else if (l >= 2 || gap) passages.push({ a: A, b: B, l, gap });
    }
    passages.sort((p, q) => q.l - p.l);
    const onFloor = new Set(floorRooms.flatMap(c => groups[c].map(n => n.id)));
    floorRooms.forEach(c => { const m = mocOf[c]; if (m && byId[m.id]) onFloor.add(m.id); });
    const bounds = rooms.flatMap(r => [[r.x - 30, r.y - 30], [r.x + r.w + 30, r.y + r.h + 30], [r.x - 30, r.y + r.h + 30], [r.x + r.w + 30, r.y - 30]]);
    return { rooms, byC, pos, obj, doors, passages: passages.slice(0, 14), BW, BH, onFloor, floor: st.palaceFloor, levels, hasBase, bounds };
  }
  // The palace from the front: a floor per band of topics, a bay per topic, a window per note (lit = active, dark and
  // boarded = stale, a red sill = open tasks), the map's plaque over each bay, the storeroom below ground. Click a floor
  // (or zoom into one) to walk its rooms.
  function palaceFacade(geo, groups, levels, hasBase) {
    const pos = new Map(geo), bays = [], win = new Map(), FW = 1500, FH = 240, BASE_H = 150;
    levels.forEach((cs, li) => {
      const base = hasBase && li === 0, fi = hasBase ? li - 1 : li, y0 = base ? 24 : -(fi + 1) * FH, h = base ? BASE_H : FH;
      const weight = c => Math.sqrt(groups[c].length) + 1.5, total = cs.reduce((s, c) => s + weight(c), 0);
      let x = -FW / 2;
      cs.forEach(c => {
        const w = FW * weight(c) / total, bay = { c, x, y: y0, w, h, floor: li, base }; bays.push(bay);
        const ms = groups[c].slice().sort(byImportance), top = 40, pad = 16, iw = Math.max(10, w - 2 * pad), ih = Math.max(10, h - top - 26);
        const cols = Math.max(1, Math.round(Math.sqrt(ms.length * iw / ih * 1.3))), rows = Math.max(1, Math.ceil(ms.length / cols)), cw = iw / cols, ch = ih / rows;
        ms.forEach((n, i) => { pos.set(n.id, [x + pad + (i % cols + 0.5) * cw, y0 + top + (Math.floor(i / cols) + 0.5) * ch]); win.set(n.id, [Math.min(cw * 0.62, ch * 0.5), Math.min(ch * 0.72, cw * 0.95)]); });
        const m = mocOf[c]; if (m && byId[m.id]) pos.set(m.id, [x + w / 2, y0 + 15]);
        x += w;
      });
    });
    const cracks = [];
    bays.forEach((a, i) => { const b = bays[i + 1]; if (b && b.floor === a.floor) { const pr = topicPair(a.c, b.c); if (pr.gap && !pr.links) cracks.push(b); } });
    const top = -(levels.length - (hasBase ? 1 : 0)) * FH;
    return { facade: true, bays, pos, win, cracks, FW, FH, levels, hasBase, top, bounds: [[-FW / 2 - 40, top - 390], [FW / 2 + 190, (hasBase ? BASE_H + 40 : 40)]] };
  }
  function drawPalace(now) {
    const { R, litSet, font, k } = mapFrame(), M = mapCache.palace;
    floorBar(M);
    if (M && M.facade) return drawPalaceFacade(now, M, R, litSet, font, k);
    if (M && cam.userMoved && k < 0.3) { enterFloor(null); return; }   // zoomed right out of a floor: back outside
    // A floor in 3D: the plan seen from above at an angle, walls raised, each note a block on the floor (taller =
    // more relied on, glowing = active, grey and dusty = stale, a red cap = open tasks), the map's plaque on a stand.
    const bg = "#0b1830", ink = "rgba(226,236,255,.92)";
    backdrop("#0a1426", "#13284a");
    if (!M) return;
    const iso = isoKit(R, k), poly = iso.poly, corners = r => iso.rect(r.x, r.y, r.w, r.h);
    const WH = Math.max(6, 30 * k), up = q => iso.lift(q, WH);
    const roomOn = r => !litSet || (M.rooms && [...litSet].some(id => byId[id] && (byId[id].isolated ? -3 : byId[id].cluster) === r.c));
    // the slab the floor sits on, with its edge showing
    const minX = Math.min(...M.rooms.map(r => r.x)), minY = Math.min(...M.rooms.map(r => r.y)), maxX = Math.max(...M.rooms.map(r => r.x + r.w)), maxY = Math.max(...M.rooms.map(r => r.y + r.h));
    iso.slab(minX - 30, minY - 30, maxX - minX + 60, maxY - minY + 60, Math.max(4, 18 * k), "#17233a", "#1e2a3f", "#26344d", "rgba(148,180,230,.25)");
    // passages: linked topics that don't share a wall, as glowing runners on the slab
    ctx.lineCap = "round";
    M.passages.forEach(p => { const a = iso.p(p.a.x + p.a.w / 2, p.a.y + p.a.h / 2), b = iso.p(p.b.x + p.b.w / 2, p.b.y + p.b.h / 2);
      ctx.strokeStyle = p.gap ? "rgba(248,113,113,.5)" : "rgba(186,210,255,.25)"; ctx.lineWidth = p.gap ? 1.2 : Math.min(6, 1 + Math.sqrt(p.l)); ctx.setLineDash(p.gap ? [4, 5] : [1, 6]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 40 * k, b.x, b.y); ctx.stroke(); });
    ctx.setLineDash([]);
    // floors (tiles in the topic colour), then the back walls (the far two sides of each room)
    M.rooms.forEach(r => { const c = corners(r), on = roomOn(r);
      ctx.globalAlpha = on ? 1 : 0.35;
      poly(c, r.c >= 0 ? hexMix(colorOf(r.c), bg, 0.8) : "rgba(255,255,255,.04)", "rgba(226,236,255,.18)");
      if (k > 0.9) { ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.beginPath();   // floor tiles
        for (let x = r.x + 40; x < r.x + r.w; x += 40) { const a = iso.p(x, r.y), b = iso.p(x, r.y + r.h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        for (let y = r.y + 40; y < r.y + r.h; y += 40) { const a = iso.p(r.x, y), b = iso.p(r.x + r.w, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); }
      iso.wall(c[0], c[1], WH, "rgba(200,214,240,.22)", "rgba(226,236,255,.35)");   // back walls: the far two sides
      iso.wall(c[3], c[0], WH, "rgba(170,186,220,.18)", "rgba(226,236,255,.35)");
    });
    ctx.globalAlpha = 1;
    // doorways: a dark opening in the wall; a gap is bricked up in red
    const doorPts = d => d.v ? [iso.p(d.at, d.mid - d.half), iso.p(d.at, d.mid + d.half)] : [iso.p(d.mid - d.half, d.at), iso.p(d.mid + d.half, d.at)];
    M.doors.forEach(d => { const [p0, p1] = doorPts(d);
      if (d.gap) { poly([p0, p1, up(p1), up(p0)], "rgba(127,29,29,.55)", "rgba(248,113,113,.9)"); ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(248,113,113,.8)"; ctx.beginPath();
        for (let i = 1; i < 4; i++) { const y = WH * i / 4; ctx.moveTo(p0.x, p0.y - y); ctx.lineTo(p1.x, p1.y - y); } ctx.stroke(); ctx.setLineDash([]); return; }
      poly([p0, p1, { x: p1.x, y: p1.y - WH * 0.8 }, { x: p0.x, y: p0.y - WH * 0.8 }], "rgba(10,16,30,.85)", "rgba(253,224,71,.35)"); });
    // blocks: drawn back to front so nearer ones overlap farther ones
    const blocks = [];
    for (const r of M.rooms) for (const n of nodes) {
      if ((n.isolated ? -3 : n.cluster) !== r.c || n.person || n.ghost || n.moc || !mapShown(n) || !M.obj.has(n.id)) continue;
      blocks.push([n, r, iso.p(n.x, n.y)]);
    }
    iso.depthSort(blocks, b => b[2]);
    for (const [n, r, p] of blocks) {
      const on = roomOn(r), lit0 = !litSet || litSet.has(n.id), cell = M.obj.get(n.id) * k, s = Math.max(3, cell * (0.22 + 0.3 * importance(n)));
      const stale = staleFor(n, Q.stale_days), act = activity(n), hgt = Math.max(3, s * (0.5 + 2.2 * importance(n)));
      ctx.globalAlpha = lit0 && on ? 1 : 0.2;
      const base = stale ? "#7d8799" : r.c >= 0 ? colorOf(r.c) : "#a5b4cf";
      if (act > 0.3 && s > 3) { const fl = reducedMotion() ? 1 : 0.7 + 0.3 * Math.sin(now / 110 + hash(n.id) % 17) * Math.sin(now / 47 + hash(n.id) % 5);
        const g = ctx.createRadialGradient(p.x, p.y - hgt, 0, p.x, p.y - hgt, s * 2.6); g.addColorStop(0, `rgba(253,224,71,${(0.45 * fl).toFixed(3)})`); g.addColorStop(1, "rgba(253,224,71,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - hgt, s * 2.6, 0, 2 * Math.PI); ctx.fill(); }
      const { T, Rp, B, Lp, hw, hh } = iso.block(p, s, hgt, base, "rgba(226,236,255,.5)");
      if (stale && s > 5) { ctx.fillStyle = "rgba(15,23,42,.5)"; for (let i = 0; i < 4; i++) { const h = hash(n.id + i); ctx.fillRect(p.x - hw * 0.5 + (h % 100) / 100 * hw, p.y - hgt - hh * 0.4 + ((h >>> 8) % 100) / 100 * hh * 0.8, 1.2, 1.2); } }
      if (n.tasks > 0 && s > 4) { ctx.fillStyle = UI.colour.tasks; ctx.beginPath(); ctx.arc(T.x, T.y + hh * 0.5, Math.max(1.6, s * 0.18), 0, 2 * Math.PI); ctx.fill(); }
      if (st.selected === n.id) poly([{ x: T.x, y: T.y - 4 }, { x: Rp.x + 4, y: Rp.y }, { x: B.x, y: B.y + hgt + 4 }, { x: Lp.x - 4, y: Lp.y }], null, UI.colour.selected, 2);
      P.set(n.id, { ...iso.hit(p, hw, hgt), s: p.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
    }
    // plaques: the room's map on a stand
    M.rooms.forEach(r => { const m = mocOf[r.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return;
      const n = byId[m.id], p = iso.p(n.x, n.y), s = Math.max(6, 11 * Math.sqrt(k)), on = roomOn(r);
      ctx.globalAlpha = on ? 1 : 0.35; ctx.strokeStyle = "#78350f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - s * 1.6); ctx.stroke();
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(p.x - s / 2, p.y - s * 2.3, s, s * 0.8); ctx.strokeRect(p.x - s / 2, p.y - s * 2.3, s, s * 0.8);
      P.set(n.id, { x: p.x, y: p.y - s * 1.9, s: p.s, depth: -2, r: s, a: on ? 1 : 0.3 }); });
    ctx.globalAlpha = 1;
    // front walls, low and see-through, so the room stays readable
    M.rooms.forEach(r => { const c = corners(r), low = p => ({ x: p.x, y: p.y - WH * 0.35 });
      poly([c[1], c[2], low(c[2]), low(c[1])], "rgba(226,236,255,.10)", "rgba(226,236,255,.45)");
      poly([c[2], c[3], low(c[3]), low(c[2])], "rgba(226,236,255,.08)", "rgba(226,236,255,.45)"); });
    // a visitor tours the floor: room to room through the doors, preferring rooms not seen for a while
    const hasDoor = r => M.doors.some(d => !d.gap && (d.a === r.c || d.b === r.c));   // the storeroom (unlinked notes) has none
    const vz = M.visitor || (M.visitor = { room: M.rooms.filter(hasDoor).sort((a, b) => b.w * b.h - a.w * a.h)[0], seen: new Map(), path: [], t: 0, steps: [] }), vdt = tickOf(vz, now);
    const ctr = r => [r.x + r.w / 2, r.y + r.h / 2];
    if (!vz.path.length && vz.room) {
      if (!hasDoor(vz.room)) { const rs0 = M.rooms.filter(hasDoor); vz.room = rs0[Math.floor(Math.random() * rs0.length)]; }
      const exits = vz.room ? M.doors.filter(d => !d.gap && (d.a === vz.room.c || d.b === vz.room.c)) : [];
      if (exits.length) { const d0 = exits.sort((x, y) => (vz.seen.get(x.a === vz.room.c ? x.b : x.a) || 0) - (vz.seen.get(y.a === vz.room.c ? y.b : y.a) || 0) || Math.random() - 0.5)[0];
        const next = M.byC[d0.a === vz.room.c ? d0.b : d0.a], dp = d0.v ? [d0.at, d0.mid] : [d0.mid, d0.at];
        vz.path = [ctr(vz.room), dp, ctr(next)]; vz.door = d0; vz.next = next; vz.t = 0; vz.seen.set(next.c, now); }
    }
    if (vz.path.length) {
      const legLen = [Math.hypot(vz.path[1][0] - vz.path[0][0], vz.path[1][1] - vz.path[0][1]), Math.hypot(vz.path[2][0] - vz.path[1][0], vz.path[2][1] - vz.path[1][1])], total = legLen[0] + legLen[1] || 1;
      vz.t += vdt * 0.05 / total;
      const dist = Math.min(1, vz.t) * total, leg = dist < legLen[0] ? 0 : 1, f = leg ? (dist - legLen[0]) / (legLen[1] || 1) : dist / (legLen[0] || 1);
      const wx0 = vz.path[leg][0] + (vz.path[leg + 1][0] - vz.path[leg][0]) * f, wy0 = vz.path[leg][1] + (vz.path[leg + 1][1] - vz.path[leg][1]) * f, vp = iso.p(wx0, wy0);
      if (vdt && (!vz.steps.length || Math.hypot(vz.steps[vz.steps.length - 1][0] - wx0, vz.steps[vz.steps.length - 1][1] - wy0) > 14)) { vz.steps.push([wx0, wy0]); if (vz.steps.length > 16) vz.steps.shift(); }
      vz.steps.forEach(([x, y], i) => { const q = iso.p(x, y); ctx.fillStyle = `rgba(226,236,255,${0.08 + 0.3 * i / vz.steps.length})`; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.8, 1, 0, 0, 2 * Math.PI); ctx.fill(); });
      walker(vp, Math.max(2.5, 5 * Math.sqrt(k)), "#fef3c7", { lantern: true, phase: now / 160, head: "#fef3c7" });   // a visitor with a lantern
      if (vz.t >= 1) { vz.room = vz.next; vz.path = []; }
    }
    // the selected note's links: threads through the floor
    if (st.selected && P.has(st.selected)) { const a = P.get(st.selected); ctx.strokeStyle = "rgba(253,224,71,.7)"; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      nb[st.selected].forEach(id => { const b = P.get(id); if (b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }); ctx.setLineDash([]); }
    // room names on their back wall, then the most relied-on blocks' names
    M.rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h).forEach(r => { const c = corners(r), w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
      const name = r.c === -3 ? "STOREROOM · UNLINKED" : r.c < 0 ? "HALL · NO TOPIC YET" : clip(shortName(r.c), 30).toUpperCase(), f = `700 10.5px ${font}`;
      const text = w > 50 ? fitW(name, f, w - 20) : ""; if (!text) return;
      const x = (c[0].x + c[1].x) / 2, y = (c[0].y + c[1].y) / 2 - WH - 8, tw = ctx.measureText(text).width;
      if (freeSpot(x - tw / 2, y - 7, tw, 14)) haloText(text, x, y, ink, bg, f, "center"); });
    noteLabels([...P.keys()].filter(id => !byId[id].moc).sort((a, b) => importance(byId[b]) - importance(byId[a])), "#dbe7ff", bg, k > 1.4 ? 140 : MOBILE ? 12 : 26);
  }
  // ---- the palace from the front
  function drawPalaceFacade(now, M, R, litSet, font, k) {
    const { night, dusk } = daylight();
    backdrop(...(night ? ["#070b1d", "#1b2440"] : dusk ? ["#2b2d5c", "#f4a76a"] : ["#6aa7e0", "#d9ecfb"]));
    if (night) for (let i = 0; i < 90; i++) { const h = hash("star" + i); ctx.fillStyle = `rgba(255,255,255,${0.25 + (h % 50) / 100})`; ctx.fillRect(h % Math.max(1, W), (h >>> 10) % Math.max(1, Math.round(H * 0.6)), 1.2, 1.2); }
    const g0 = scr(0, 0, R), L = scr(-M.FW / 2 - 40, M.top - 10, R), Rr = scr(M.FW / 2 + 40, 0, R);
    // ground and street
    ctx.fillStyle = night ? "#15161c" : "#5b6b4a"; ctx.fillRect(0, g0.y, W, H - g0.y);
    ctx.fillStyle = night ? "#22242c" : "#8a8f86"; ctx.fillRect(0, g0.y, W, Math.max(2, 8 * k));
    const stone = night ? "#4a443c" : dusk ? "#c9a983" : "#e4d8c0", stoneDark = night ? "#3a352f" : dusk ? "#a98a68" : "#cbbd9f", line = night ? "rgba(0,0,0,.45)" : "rgba(80,60,40,.45)";
    // depth: the building and its roof are solids pushed back up and to the right (oblique), through the shared prism
    const d = { x: Math.max(8, 150 * k * 0.55), y: -Math.max(5, 150 * k * 0.32) }, roof = night ? "#3b352e" : dusk ? "#866850" : "#b9ab90";   // a step darker than the pediment at every hour
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse((L.x + Rr.x) / 2 + d.x * 0.6, g0.y + 6, (Rr.x - L.x) * 0.62, Math.max(6, 22 * k), 0, 0, 2 * Math.PI); ctx.fill();   // shadow
    // the body: its front is the facade (the bays go on it below), its right side the side wall
    prism([{ x: L.x, y: L.y }, { x: Rr.x, y: L.y }, { x: Rr.x, y: g0.y }, { x: L.x, y: g0.y }], d, stone, { faces: { right: stoneDark, up: roof }, edge: line, sides: true });
    for (let f = 0; f <= M.levels.length - (M.hasBase ? 1 : 0); f++) { const y = scr(0, -f * M.FH, R).y; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Rr.x, y); ctx.lineTo(Rr.x + d.x, y + d.y); ctx.stroke();   // ledges round the corner
      for (let w = 1; w <= 3 && f < M.levels.length - (M.hasBase ? 1 : 0); w++) { const t = w / 4, wy = y - M.FH * k * 0.62, wh = M.FH * k * 0.34;   // side windows
        ctx.fillStyle = night ? "#2c3e5c" : "#8fb0c6"; ctx.beginPath(); ctx.moveTo(Rr.x + d.x * t - 4 * k, wy + d.y * t); ctx.lineTo(Rr.x + d.x * t + 6 * k, wy + d.y * (t + 0.05)); ctx.lineTo(Rr.x + d.x * t + 6 * k, wy + wh + d.y * (t + 0.05)); ctx.lineTo(Rr.x + d.x * t - 4 * k, wy + wh + d.y * t); ctx.fill(); } }
    // the roof: a pediment pushed back the depth of the building, sitting on the walls, its eaves just over them
    const midX = scr(0, 0, R).x, roofY = L.y, span = (Rr.x - L.x) / 2, eave = 10 * k, fascia = Math.max(2, 7 * k);
    const xl = L.x - eave, xr = Rr.x + eave, apex = { x: midX, y: roofY - fascia - Math.min(140, span * 0.22) };
    ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.moveTo(Rr.x, roofY); ctx.lineTo(Rr.x + d.x, roofY + d.y); ctx.lineTo(Rr.x + d.x, roofY + d.y + fascia * 1.6); ctx.lineTo(Rr.x, roofY + fascia * 1.6); ctx.fill();   // the eave's shadow on the side wall
    prism([{ x: xl, y: roofY }, { x: xl, y: roofY - fascia }, apex, { x: xr, y: roofY - fascia }, { x: xr, y: roofY }], d, roof, { front: stoneDark, edge: line, sides: true, lw: 1.2 });
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(L.x, roofY, Rr.x - L.x, Math.max(2, 4 * k));   // and under the cornice
    // the dome: a drum standing on the middle of the ridge, the dome on the drum, lit from the left like the rest
    const domeR = Math.min(120, span * 0.16), ridge = { x: apex.x + d.x / 2, y: apex.y + d.y / 2 + domeR * 0.12 }, drumH = domeR * 0.35, base = domeR * 0.22;
    const drum = ctx.createLinearGradient(ridge.x - domeR, 0, ridge.x + domeR, 0); drum.addColorStop(0, stone); drum.addColorStop(1, stoneDark);
    ctx.fillStyle = drum; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ridge.x - domeR, ridge.y - drumH); ctx.lineTo(ridge.x - domeR, ridge.y);
    ctx.ellipse(ridge.x, ridge.y, domeR, base, 0, Math.PI, 0, true); ctx.lineTo(ridge.x + domeR, ridge.y - drumH); ctx.closePath(); ctx.fill(); ctx.stroke();
    const domeY = ridge.y - drumH, dg = ctx.createRadialGradient(ridge.x - domeR * 0.35, domeY - domeR * 0.55, domeR * 0.1, ridge.x, domeY, domeR * 1.1);
    dg.addColorStop(0, night ? "#9fb0cf" : dusk ? "#f6dccb" : "#e3f1f9"); dg.addColorStop(1, night ? "#3b4763" : dusk ? "#7c6a8c" : "#6f97b0"); ctx.fillStyle = dg;   // the dome reflects the sky
    ctx.beginPath(); ctx.arc(ridge.x, domeY, domeR, Math.PI, 0); ctx.ellipse(ridge.x, domeY, domeR, base, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
    // flags: the topics busiest this month fly from the roof: one on the dome, the others standing on the pediment
    const busy = M.bays.filter(b => !b.base).map(b => [b, topicBusy(b.c)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const onPediment = x => apex.y + Math.min(1, Math.abs(x - midX) / (xr - midX)) * (roofY - fascia - apex.y);
    busy.forEach(([b], i) => { const fx = i === 1 ? ridge.x : midX + (i - 1) * span * 0.55, fy = i === 1 ? domeY - domeR : onPediment(fx), wave = reducedMotion() ? 0 : Math.sin(now / 300 + i) * 4;
      ctx.strokeStyle = "#3f3a33"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 46); ctx.stroke();
      ctx.fillStyle = colorOf(b.c); ctx.beginPath(); ctx.moveTo(fx, fy - 46); ctx.quadraticCurveTo(fx + 16, fy - 44 + wave, fx + 30, fy - 40); ctx.lineTo(fx, fy - 32); ctx.fill(); });
    // floors: a cornice, bays between pilasters, the topic's name on its cornice; a click on the wall goes inside
    const floorNames = M.levels.map((cs, li) => M.hasBase && li === 0 ? "Basement" : `Floor ${M.hasBase ? li : li + 1}`);
    M.bays.forEach(b => {
      const a = scr(b.x, b.y, R), w = b.w * k, h = b.h * k, on = !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === b.c && !special(byId[id]));
      ctx.globalAlpha = on ? 1 : 0.45;
      ctx.fillStyle = b.base ? (night ? "#2b2822" : "#b8ab92") : hexMix(colorOf(b.c), stone, 0.86); ctx.fillRect(a.x, a.y, w, h);
      ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, 1.6 * Math.sqrt(k)); ctx.strokeRect(a.x, a.y, w, h);
      ctx.fillStyle = stoneDark; ctx.fillRect(a.x, a.y, w, Math.max(3, 9 * k));   // cornice
      const name = b.c === -3 ? "STOREROOM · UNLINKED" : b.c < 0 ? "HALL · NO TOPIC YET" : clip(shortName(b.c), 40).toUpperCase();
      if (w > 40) topicLabel(b.c, name, a.x + w / 2, a.y + 10 * k + 9, w - 16, night ? "#f5ead6" : "#2a2016", night ? "#2a2016" : "rgba(255,248,235,.7)", Math.max(8, Math.min(12, 10 * Math.sqrt(k))));
      spot(a.x, a.y, w, h, () => enterFloor(b.floor), `${floorNames[b.floor]}: walk in`);
      ctx.globalAlpha = 1;
    });
    // pillars between bays and a ledge under each floor, lit from the left
    M.bays.forEach(b => { const a = scr(b.x, b.y, R), w = Math.max(3, 9 * k), h = b.h * k;
      const g = ctx.createLinearGradient(a.x - w / 2, 0, a.x + w / 2, 0); g.addColorStop(0, night ? "#6b6255" : "#f3ead8"); g.addColorStop(1, stoneDark);
      ctx.fillStyle = g; ctx.fillRect(a.x - w / 2, a.y, w, h);
      ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(a.x, a.y + h - Math.max(2, 5 * k), b.w * k, Math.max(2, 5 * k)); });
    // cracks in the wall between topics that should connect and don't
    M.cracks.forEach(b => { const a = scr(b.x, b.y, R); ctx.strokeStyle = "rgba(185,28,28,.85)"; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const yy = a.y + (i / 8) * b.h * k, xx = a.x + (i % 2 ? 4 : -4) * Math.sqrt(k); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); });
    // windows
    for (const b of M.bays) for (const n of nodes) {
      if ((n.isolated ? -3 : n.cluster) !== b.c || special(n) || n.ghost || !mapShown(n) || !M.win.has(n.id)) continue;
      const p = scr(n.x, n.y, R), [ww, wh] = M.win.get(n.id).map(v => Math.max(2.5, v * k)), lit0 = !litSet || litSet.has(n.id);
      const act = activity(n), x0 = p.x - ww / 2, y0 = p.y - wh / 2;
      ctx.globalAlpha = lit0 ? 1 : 0.25;
      // someone's home (active): lit; nobody's been in a while (stale): boarded; a red sill: open tasks
      windowSprite(x0, y0, ww, wh, { state: act > 0.3 ? "lit" : staleFor(n, Q.stale_days) ? "boarded" : "plain", busy: act, seed: hash(n.id), now, night,
        frame: line, tasks: n.tasks > 0, selected: st.selected === n.id, k });
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(5, Math.max(ww, wh) / 2 + 1), a: lit0 ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    // plaques (the bay's map) and the front door
    M.bays.forEach(b => { const m = mocOf[b.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return; const n = byId[m.id], p = scr(n.x, n.y, R), s = Math.max(6, 11 * Math.sqrt(k));
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(p.x - s, p.y - s * 0.4, 2 * s, s * 0.8); ctx.strokeStyle = "#78350f"; ctx.lineWidth = 1; ctx.strokeRect(p.x - s, p.y - s * 0.4, 2 * s, s * 0.8);
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -2, r: s, a: 1 }); });
    const dw = Math.max(10, 46 * k), dh = Math.max(14, 70 * k);
    for (let i = 3; i >= 1; i--) { ctx.fillStyle = i % 2 ? stoneDark : stone; ctx.fillRect(midX - dw / 2 - i * 8 * k, g0.y + (3 - i) * 3 * k, dw + i * 16 * k, 3 * k); }   // steps
    ctx.fillStyle = night ? "#2a1d12" : "#5b3a1e";
    ctx.beginPath(); ctx.moveTo(midX - dw / 2, g0.y); ctx.lineTo(midX - dw / 2, g0.y - dh + dw / 2); ctx.arc(midX, g0.y - dh + dw / 2, dw / 2, Math.PI, 0); ctx.lineTo(midX + dw / 2, g0.y); ctx.fill();
    // names of the most relied-on windows when close enough to read
    if (k > 1.1) noteLabels(nodes.filter(n => !special(n) && P.has(n.id) && M.win.has(n.id)).sort(byImportance).map(n => n.id), night ? "#f5ead6" : "#1f1a14", night ? "#1f1a14" : "rgba(255,248,235,.8)", k > 2 ? 80 : 24);
    // zoom into a floor to walk in: the floor in the middle of the pane
    if (cam.userMoved && k > 2.6) { const mid = M.bays.find(b => { const a = scr(b.x, b.y, R); return W / 2 >= a.x && W / 2 <= a.x + b.w * k && H / 2 >= a.y && H / 2 <= a.y + b.h * k; }); if (mid) enterFloor(mid.floor); }
  }
  // Facade, or one floor's rooms: st.palaceFloor (null = outside). Each change lays the palace out again.
  function enterFloor(f) {
    if (st.palaceFloor === f || st.view !== "palace") return;
    st.palaceFloor = f; cam.userMoved = false;
    applyMapLayout(true); renderLegend(); renderToday();
    fitted = false; setTimeout(() => { fitted = true; fit(mapFitPred(), 600); }, 1000);   // after the morph lands
  }
  // Facade / Basement / Floor 1.. as buttons over the palace
  let floorBarFor = null;
  function floorBar(M) {
    let bar = root.querySelector(".vg-floorbar");
    if (!bar) { bar = document.createElement("div"); bar.className = "vg-floorbar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Palace floors"); wrap.appendChild(bar); }
    if (!M || floorBarFor === M) return;
    floorBarFor = M;
    const lv = M.levels || [], names = lv.map((cs, li) => M.hasBase && li === 0 ? "B" : String(M.hasBase ? li : li + 1));
    const cur = M.facade ? null : M.floor;
    bar.innerHTML = `<button class="vg-segbtn" data-floor="" aria-pressed="${cur == null}">Front</button>` +
      lv.map((cs, li) => li).reverse().map(li => `<button class="vg-segbtn" data-floor="${li}" aria-pressed="${cur === li}" title="${esc(lv[li].map(c => c === -3 ? "Storeroom" : shortName(c)).join(", "))}">${names[li]}</button>`).join("");
    bar.querySelectorAll("[data-floor]").forEach(b => b.onclick = () => { enterFloor(b.dataset.floor === "" ? null : +b.dataset.floor); syncAngleBtn(); });
  }

  // ---------------------------------------------------------------- more maps: weather, ships, rings, sky, realm, food web, clock, radar
  // Shared bits: each topic's centre on the familiar 2D map, marching-squares contours, and a raster helper.
  function topicCentres(geo, minSize) {
    const acc = {};
    nodes.forEach(n => { if (special(n) || n.ghost || n.cluster < 0) return; const p = geo.get(n.id); if (!p) return;
      const a = acc[n.cluster] = acc[n.cluster] || { x: 0, y: 0, n: 0 }; a.x += p[0]; a.y += p[1]; a.n++; });
    const out = {}; Object.entries(acc).forEach(([c, a]) => { if (a.n >= (minSize || 1)) out[c] = [a.x / a.n, a.y / a.n, a.n]; });
    return out;
  }
  function contourSegs(E, gw, gh, lv, x0, y0, cell) {   // marching squares: [x1, y1, x2, y2, ...] in world units
    const seg = [];
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = E[j * gw + i], b = E[j * gw + i + 1], c = E[(j + 1) * gw + i + 1], d = E[(j + 1) * gw + i];
      const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = [i + (lv - a) / (b - a), j], Rr = [i + 1, j + (lv - b) / (c - b)], B = [i + (lv - d) / (c - d), j + 1], Lf = [i, j + (lv - a) / (d - a)];
      const pairs = { 1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [Lf, T, B, Rr], 6: [T, B], 7: [Lf, T], 8: [Lf, T], 9: [T, B], 10: [T, Rr, Lf, B], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B] }[idx];
      for (const p of pairs) seg.push(x0 + p[0] * cell, y0 + p[1] * cell);
    }
    return seg;
  }
  function strokeSegs(seg) { ctx.beginPath(); for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); } ctx.stroke(); }
  const worldTransform = (dpr, R) => { const o = scr(0, 0, R); ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * o.x, dpr * o.y); };
  // the box round some points, padded; no points (an empty vault) gives a small box round the origin, never Infinity
  const bounds = (pts, pad) => { if (!pts.length) return [-pad, -pad, pad, pad]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]; };
  const timelineData = () => DATA.timeline || { weeks: [], clusters: {}, notes: {} };
  const dots = (pred, col, r, R) => { for (const n of nodes) { if (!pred(n) || !mapShown(n)) continue; const p = scr(n.x, n.y, R); ctx.fillStyle = col(n); ctx.beginPath(); ctx.arc(p.x, p.y, r(n), 0, 2 * Math.PI); ctx.fill();
    P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(5, r(n) + 2), a: 1 }); } };
  const selRing = (R, col) => { if (!st.selected || !P.has(st.selected)) return; const p = P.get(st.selected); ctx.strokeStyle = col || UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, 2 * Math.PI); ctx.stroke(); };
  // Note names in map views: below the note's shape, else beside it (right, then left), else above, else the same shortened; never
  // over another shape drawn this frame (bodies, from iso.hit: blocks, towers, figures) or another label (freeSpot).
  // A name with no free spot is left out. p.box (from iso.hit) is the shape's own box, the one the name goes around.
  const overBody = (x, y, w, h) => bodies.some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
  const noteLabels = (ids, fill, halo, max) => { const f = `500 10px ${css("--vg-font") || "system-ui"}`;
    ids.slice(0, max).forEach(id => { const p = P.get(id); if (!p) return;
      const own = p.box, top = own ? own[1] : p.y - p.r, bot = own ? own[1] + own[3] : p.y + p.r, left = own ? own[0] : p.x - p.r, right = own ? own[0] + own[2] : p.x + p.r;
      for (const t of [clip(byId[id].name, 24), clip(byId[id].name, 12)]) { ctx.font = f; const w = ctx.measureText(t).width;
        const at = [[p.x - w / 2, bot + 1, "center", p.x, bot + 7], [right + 4, p.y - 6, "left", right + 4, p.y], [left - 4 - w, p.y - 6, "right", left - 4, p.y], [p.x - w / 2, top - 13, "center", p.x, top - 7]]
          .find(([x, y]) => !overBody(paneX(x, w), y, w, 12) && freeSpot(x, y, w, 12));
        if (at) { haloText(t, at[3], at[4], fill, halo, f, at[2]); return; }
      } }); };

  // Weather: which topics are heating up or going quiet. Pressure comes from your dailies: a topic mentioned more
  // than usual over the last three weeks is a low (busy, L), quieter than usual a high (calm, H). A storm is a
  // sudden burst (last week well above usual). Isobars join equal pressure; fronts mark topics that come up together.
  function weatherLayout(geo) {
    const T0 = timelineData(), cut = st.timeAt ? Math.max(4, T0.weeks.filter(w => w <= st.timeAt).length) : T0.weeks.length;   // time-lapse: weather as of that week
    const T = { weeks: T0.weeks.slice(0, cut), clusters: Object.fromEntries(Object.entries(T0.clusters).map(([c, v]) => [c, v.slice(0, cut)])) }, cen = topicCentres(geo, 3), W0 = T.weeks.length;
    const tops = Object.entries(cen).map(([c, [x, y, n]]) => {
      const s = T.clusters[c] || [], last3 = s.slice(-3), base = s.slice(0, Math.max(1, W0 - 3));
      const r = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length), b = base.reduce((a, v) => a + v, 0) / Math.max(1, base.length);
      const a = Math.max(-2, Math.min(2, Math.log2((r + 0.5) / (b + 0.5)))), lastW = s[s.length - 1] || 0;
      return { c: +c, x, y, n, a, ratio: (r + 0.5) / (b + 0.5), recent: r, base: b, storm: lastW >= 4 && lastW >= 2.5 * (b + 0.5), sig: 90 + 14 * Math.sqrt(n) };
    });
    const [x0, y0, x1, y1] = bounds([...geo.values()], 220), CELL = Math.max(10, Math.sqrt((x1 - x0) * (y1 - y0) / 26000));
    const gw = Math.ceil((x1 - x0) / CELL) + 1, gh = Math.ceil((y1 - y0) / CELL) + 1, E = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = x0 + i * CELL, y = y0 + j * CELL; let v = 0;
      for (const t of tops) { const d2 = (x - t.x) ** 2 + (y - t.y) ** 2; v -= t.a * Math.exp(-d2 / (2 * t.sig * t.sig)); } E[j * gw + i] = v; }
    let lo = Infinity, hi = -Infinity; for (const v of E) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const iso = []; for (let lv = Math.ceil(lo / 0.12) * 0.12; lv < hi; lv += 0.12) if (Math.abs(lv) > 1e-6) iso.push({ lv, seg: contourSegs(E, gw, gh, lv, x0, y0, CELL) });
    const off = document.createElement("canvas"); off.width = gw; off.height = gh;
    const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    for (let k = 0; k < E.length; k++) { const v = Math.max(-1, Math.min(1, E[k] / Math.max(0.3, Math.max(-lo, hi))));
      const c = v < 0 ? [231, 76, 60].map((x, i) => [234, 236, 240][i] + (x - [234, 236, 240][i]) * -v * 0.7) : [59, 130, 246].map((x, i) => [234, 236, 240][i] + (x - [234, 236, 240][i]) * v * 0.6);
      img.data.set([c[0], c[1], c[2], 255], k * 4); }
    oc.putImageData(img, 0, 0);
    const byC = Object.fromEntries(tops.map(t => [t.c, t]));
    const fronts = (DATA.pairs || []).filter(([a, b, l, m]) => m >= 2 && byC[a] && byC[b]).sort((p, q) => q[3] - p[3]).slice(0, 7).map(([a, b, l, m]) => ({ a: byC[a], b: byC[b], m }));
    return { pos: geo, tops, iso, img: off, x0, y0, w: gw * CELL, h: gh * CELL, fronts, E, gw, gh, CELL };
  }
  function drawWeather(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), Wd = mapCache.weather;
    ctx.fillStyle = "#e9ecf1"; ctx.fillRect(0, 0, W, H); if (!Wd) return;
    worldTransform(dpr, R); ctx.imageSmoothingEnabled = true; ctx.drawImage(Wd.img, Wd.x0, Wd.y0, Wd.w, Wd.h);
    Wd.iso.forEach(c => { ctx.strokeStyle = c.lv < 0 ? "rgba(153,27,27,.45)" : "rgba(30,64,175,.4)"; ctx.lineWidth = (Math.abs(c.lv) % 0.48 < 0.01 ? 1.6 : 0.8) / k; strokeSegs(c.seg); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // wind: particles carried from high pressure to low, turned a little (as the Coriolis force does)
    const wind = (x, y) => { const i = Math.round((x - Wd.x0) / Wd.CELL), j = Math.round((y - Wd.y0) / Wd.CELL);
      if (i < 1 || j < 1 || i >= Wd.gw - 1 || j >= Wd.gh - 1) return null;
      const gx = Wd.E[j * Wd.gw + i + 1] - Wd.E[j * Wd.gw + i - 1], gy = Wd.E[(j + 1) * Wd.gw + i] - Wd.E[(j - 1) * Wd.gw + i];
      return [(-gx * 0.85 - gy * 0.5) * 9, (-gy * 0.85 + gx * 0.5) * 9]; };
    const wx = Wd.wx || (Wd.wx = { parts: [] }), wdt = tickOf(wx, now);
    while (wx.parts.length < (MOBILE ? 140 : 280)) wx.parts.push({ x: Wd.x0 + Math.random() * Wd.w, y: Wd.y0 + Math.random() * Wd.h, life: Math.random() * 4000 });
    ctx.strokeStyle = "rgba(51,65,85,.4)"; ctx.lineWidth = 1.2; ctx.beginPath();
    wx.parts.forEach(q => { const v = wind(q.x, q.y); q.life -= wdt;
      if (!v || q.life <= 0 || Math.hypot(v[0], v[1]) < 0.01) { q.x = Wd.x0 + Math.random() * Wd.w; q.y = Wd.y0 + Math.random() * Wd.h; q.life = 2500 + Math.random() * 3500; return; }
      const m = Math.hypot(v[0], v[1]), sp = 0.4 + 1.2 * Math.min(1, m * 4), ux = v[0] / m, uy = v[1] / m; q.x += ux * sp * wdt * 0.06; q.y += uy * sp * wdt * 0.06;
      const L = 6 + 14 * Math.min(1, m * 4), a = scr(q.x, q.y, R), b = scr(q.x - ux * L, q.y - uy * L, R); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); });   // a streak, longer in stronger wind
    ctx.stroke();
    // fronts: two topics that keep coming up together. Warm (red, half-moons) when both are heating up,
    // cold (blue, triangles) when one is heating and one cooling, stationary (alternating) otherwise
    Wd.fronts.forEach(f => {
      const a = scr(f.a.x, f.a.y, R), b = scr(f.b.x, f.b.y, R), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, half = Math.min(90, L * 0.35) * 1, kind = f.a.a > 0.2 && f.b.a > 0.2 ? "warm" : (f.a.a > 0.2) !== (f.b.a > 0.2) ? "cold" : "still";
      const p0 = [mx - nx * half, my - ny * half], p1 = [mx + nx * half, my + ny * half], col = kind === "warm" ? "#dc2626" : kind === "cold" ? "#2563eb" : "#7c3aed";
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke();
      for (let t = 0.1; t < 0.95; t += 0.2) { const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, sgn = dx * 0 + 1, kd = kind === "still" ? (Math.round(t * 5) % 2 ? "warm" : "cold") : kind;
        ctx.fillStyle = kd === "warm" ? "#dc2626" : "#2563eb"; ctx.beginPath();
        if (kd === "warm") ctx.arc(x, y, 5, Math.atan2(ny, nx) + Math.PI / 2, Math.atan2(ny, nx) + Math.PI * 1.5);
        else { ctx.moveTo(x - nx * 5, y - ny * 5); ctx.lineTo(x + nx * 5, y + ny * 5); ctx.lineTo(x + dx / L * 7 * sgn, y + dy / L * 7 * sgn); }
        ctx.closePath(); ctx.fill(); }
    });
    dots(n => !special(n) && !n.ghost, () => "rgba(30,41,59,.45)", () => Math.max(1.4, 1.8 * Math.sqrt(k)), R);
    // clouds drift round busy topics; a storm's clouds are darker and spin faster
    Wd.tops.forEach(t => { if (t.a < 0.35 && !t.storm) return;
      const p = scr(t.x, t.y, R), puffs = t.storm ? 6 : 3, spin = (reducedMotion() ? 0 : now) / (t.storm ? 2600 : 9000);
      for (let i = 0; i < puffs; i++) { const a = spin + i / puffs * 2 * Math.PI, rr = (t.storm ? 46 : 60) * Math.sqrt(k), x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.6, cr = (t.storm ? 30 : 26) * Math.sqrt(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, cr); g.addColorStop(0, t.storm ? "rgba(71,85,105,.5)" : "rgba(255,255,255,.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, cr, cr * 0.65, 0, 0, 2 * Math.PI); ctx.fill(); } });
    // pressure centres: L for busy, H for quiet; storms get rain and lightning
    Wd.tops.slice().sort((a, b) => Math.abs(b.a) - Math.abs(a.a)).forEach(t => {
      const p = scr(t.x, t.y, R), lit = !litSet || nodes.some(n => n.cluster === t.c && litSet.has(n.id));
      ctx.globalAlpha = lit ? 1 : 0.3;
      if (t.storm && !reducedMotion()) { ctx.strokeStyle = "rgba(37,99,235,.6)"; ctx.lineWidth = 1;
        for (let i = 0; i < 26; i++) { const h = hash(t.c + "r" + i), x = p.x + ((h % 160) - 80) * Math.sqrt(k), y0 = p.y - 60 + (((h >>> 8) % 120) + now / 6) % 120 * Math.sqrt(k);
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x - 3, y0 + 9); ctx.stroke(); }
        if ((now / 1200 + t.c) % 4 < 0.12) { ctx.fillStyle = "rgba(250,204,21,.9)"; ctx.font = `700 26px ${font}`; ctx.textAlign = "center"; ctx.fillText("⚡", p.x + 24, p.y - 24); } }
      if (Math.abs(t.a) >= 0.35) { const L = t.a > 0; ctx.font = `800 ${Math.round(18 + 8 * Math.abs(t.a))}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = L ? "#b91c1c" : "#1d4ed8"; ctx.fillText(L ? "L" : "H", p.x, p.y); }
      const name = clip(clusterName(t.c), 26), sub = t.storm ? `⛈ storm · ${t.ratio.toFixed(1)}× usual` : t.a >= 0.35 ? `heating up · ${t.ratio.toFixed(1)}× usual` : t.a <= -0.35 ? "quiet" : "steady";
      const f = `700 11px ${font}`; ctx.font = `500 9.5px ${font}`; const ws = ctx.measureText(sub).width; ctx.font = f; const w = Math.max(ctx.measureText(name).width, ws);   // the box covers both lines
      if (freeSpot(p.x - w / 2, p.y + 14, w, 26)) { haloText(name, p.x, p.y + 20, "#0f172a", "rgba(255,255,255,.85)", f, "center"); haloText(sub, p.x, p.y + 33, "#475569", "rgba(255,255,255,.85)", `500 9.5px ${font}`, "center"); }
      ctx.globalAlpha = 1;
    });
    selRing(R, "#0f172a");
  }

  // Shipping lanes: how knowledge moves between topics. Topics are islands (bigger = more notes) with a port; links
  // between topics are shipping lanes, busier with more links; gaps (topics that come up together but don't link)
  // are fogged-in, uncharted crossings.
  function shipsLayout(geo) {
    const cen = topicCentres(geo, 3), ports = {}, pos = new Map(geo);
    Object.entries(cen).forEach(([c, [x, y, n]]) => { ports[c] = { c: +c, x: x * 1.7, y: y * 1.7, n, r: 26 + 7 * Math.sqrt(n) }; });
    // nudge islands apart so they don't overlap
    const ps = Object.values(ports);
    for (let it = 0; it < 60; it++) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, need = a.r + b.r + 95;   // room for a port name between
      if (d < need) { const m = (need - d) / 2 / d; a.x -= dx * m; a.y -= dy * m; b.x += dx * m; b.y += dy * m; } }
    const byC = {}; nodes.forEach(n => { if (!special(n) && !n.ghost && ports[n.cluster]) (byC[n.cluster] = byC[n.cluster] || []).push(n); });
    Object.entries(byC).forEach(([c, ms]) => { const pt = ports[c]; ms.sort(byImportance);
      ms.forEach((n, i) => { const rr = (pt.r - 8) * Math.sqrt((i + 0.5) / ms.length), a = i * 2.39996; pos.set(n.id, [pt.x + Math.cos(a) * rr, pt.y + Math.sin(a) * rr]); }); });
    const lanes = (DATA.pairs || []).filter(([a, b, l]) => l > 0 && ports[a] && ports[b]).map(([a, b, l]) => ({ a: ports[a], b: ports[b], l }));
    const fog = (DATA.gaps || []).filter(g => ports[g.a] && ports[g.b]).map(g => ({ a: ports[g.a], b: ports[g.b], m: g.comentions }));
    return { pos, ports, lanes, fog };
  }
  function drawShips(now) {
    const { R, litSet, font, k } = mapFrame(), S = mapCache.ships;
    backdrop("#0b3a5b", "#06243b");
    if (!S) return;
    ctx.strokeStyle = "rgba(147,197,253,.07)"; ctx.lineWidth = 1;   // swell
    for (let y = 20; y < H; y += 26) { ctx.beginPath(); for (let x = 0; x <= W; x += 16) { const yy = y + Math.sin(x / 40 + y + now / 1600) * 3; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    const curve = (a, b, bend) => { const A = scr(a.x, a.y, R), B = scr(b.x, b.y, R), cx = (A.x + B.x) / 2 + (B.y - A.y) * bend, cy = (A.y + B.y) / 2 - (B.x - A.x) * bend; return [A, B, cx, cy]; };
    const at = ([A, B, cx, cy], t) => { const u = 1 - t; return [u * u * A.x + 2 * u * t * cx + t * t * B.x, u * u * A.y + 2 * u * t * cy + t * t * B.y, 2 * u * (cx - A.x) + 2 * t * (B.x - cx), 2 * u * (cy - A.y) + 2 * t * (B.y - cy)]; };
    const on = l => !litSet || nodes.some(n => (n.cluster === l.a.c || n.cluster === l.b.c) && litSet.has(n.id));
    S.fog.forEach(f => { const cv = curve(f.a, f.b, 0.12); ctx.setLineDash([2, 6]); ctx.strokeStyle = "rgba(226,232,240,.35)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y); ctx.quadraticCurveTo(cv[2], cv[3], cv[1].x, cv[1].y); ctx.stroke(); ctx.setLineDash([]);
      const [mx, my] = at(cv, 0.5); for (let i = 0; i < 4; i++) { const h = hash(f.a.c + "f" + f.b.c + i), r = (30 + h % 30) * Math.sqrt(k), x = mx + ((h >>> 6) % 50 - 25) * Math.sqrt(k), y = my + ((h >>> 12) % 30 - 15) * Math.sqrt(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(226,232,240,.22)"); g.addColorStop(1, "rgba(226,232,240,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
      if (k > 0.5) haloText(`uncharted · ${f.m} co-mentions`, mx, my, "rgba(241,245,249,.8)", "rgba(6,36,59,.7)", `italic 500 9.5px ${font}`, "center"); });
    S.lanes.forEach(l => { const cv = curve(l.a, l.b, 0.12); ctx.globalAlpha = on(l) ? 1 : 0.15;
      ctx.strokeStyle = "rgba(186,230,253,.28)"; ctx.lineWidth = Math.min(7, 1 + Math.sqrt(l.l) * 1.3); ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y); ctx.quadraticCurveTo(cv[2], cv[3], cv[1].x, cv[1].y); ctx.stroke(); ctx.setLineDash([]);
      const ships = Math.min(6, Math.ceil(l.l / 2)), speed = 14000 + hash(l.a.c + "|" + l.b.c) % 6000;
      for (let i = 0; i < ships; i++) { const back = i % 2, t0 = ((reducedMotion() ? 0.3 : now / speed) + i / ships) % 1, t = back ? 1 - t0 : t0, [x, y, tx, ty] = at(cv, t), a = Math.atan2(back ? -ty : ty, back ? -tx : tx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-12, -0.6, 8, 1.2);
        ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.2); ctx.lineTo(-4, 3.2); ctx.closePath(); ctx.fill(); ctx.restore(); } });
    ctx.globalAlpha = 1;
    Object.values(S.ports).forEach(pt => { const p = scr(pt.x, pt.y, R), r = pt.r * k, lit = !litSet || nodes.some(n => n.cluster === pt.c && litSet.has(n.id));
      ctx.globalAlpha = lit ? 1 : 0.35;
      ctx.fillStyle = "rgba(125,211,252,.18)"; ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 * Math.sqrt(k), 0, 2 * Math.PI); ctx.fill();   // shallows
      ctx.fillStyle = "#e7d3a4"; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = hexMix(colorOf(pt.c), "#3f6b3a", 0.55); ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.84, 0, 2 * Math.PI); ctx.fill(); });
    ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost && S.ports[n.cluster], n => hexMix(colorOf(n.cluster), "#ffffff", 0.35), n => Math.max(1.6, (1.4 + 2.5 * importance(n)) * Math.sqrt(k)), R);
    Object.values(S.ports).sort((a, b) => b.n - a.n).forEach(pt => { const p = scr(pt.x, pt.y, R), name = `⚓ ${clip(clusterName(pt.c), 24)}`, f = `700 11px ${font}`; ctx.font = f; const w = ctx.measureText(name).width;
      if (freeSpot(p.x - w / 2, p.y - pt.r * k - 20, w, 14)) haloText(name, p.x, p.y - pt.r * k - 12, "#f8fafc", "rgba(6,36,59,.85)", f, "center"); });
    selRing(R);
  }

  // Tree rings: how each topic grew. One trunk per topic, one ring per month since its first note; a wide ring is
  // a month that added a lot, a dark scar a month with an incident or failure write-up. Each note sits in the ring
  // of the month it was born.
  const SCAR_RE = /incident|root cause|\brca\b|compromise|outage|failure|breach|exposure|crash/i;
  function ringsLayout(geo) {
    const groups = {}; nodes.forEach(n => { if (!special(n) && !n.ghost && n.cluster >= 0 && n.born && (!st.timeAt || n.born <= st.timeAt)) (groups[n.cluster] = groups[n.cluster] || []).push(n); });
    const mi = d => { const [y, m] = d.split("-").map(Number); return y * 12 + m - 1; }, nowM = mi(st.timeAt || today());   // time-lapse: the trees as they were
    const trunks = Object.entries(groups).filter(([, ms]) => ms.length >= 4).map(([c, ms]) => {
      const m0 = Math.min(...ms.map(n => mi(n.born))), months = nowM - m0 + 1, per = new Array(months).fill(0), scars = new Set();
      ms.forEach(n => { const i = mi(n.born) - m0; per[i]++; if (SCAR_RE.test(n.name)) scars.add(i); });
      const rad = []; let acc = 0; per.forEach((v, i) => { acc += 0.6 + v; rad.push(acc); });
      const R0 = 30 + 9 * Math.sqrt(ms.length); return { c: +c, ms, m0, per, scars, rad: rad.map(v => v / acc * R0), R0 };
    }).sort((a, b) => b.ms.length - a.ms.length);
    const pos = new Map(geo), cols = gridDims(trunks.length, 1.5).cols; let x = 0, y = 0, rowH = 0, col = 0;
    const placed = trunks.map(t => { const d = t.R0 * 2 + 60; if (col >= cols) { col = 0; x = 0; y += rowH; rowH = 0; } const out = { ...t, x: x + d / 2, y: y + d / 2 }; x += d; rowH = Math.max(rowH, d + 24); col++; return out; });
    const wmax = Math.max(...placed.map(t => t.x + t.R0)), hmax = y + rowH; placed.forEach(t => { t.x -= wmax / 2; t.y -= hmax / 2; });
    placed.forEach(t => t.ms.forEach(n => { const i = mi(n.born) - t.m0, r = (t.rad[i] + (i ? t.rad[i - 1] : 0)) / 2, a = (seededHash(n.id) % 6283) / 1000; pos.set(n.id, [t.x + Math.cos(a) * r, t.y + Math.sin(a) * r]); }));
    return { pos, trunks: placed, m0all: Math.min(...placed.map(t => t.m0)) };
  }
  function drawRings(now) {
    const { R, litSet, font, k } = mapFrame(), T = mapCache.rings;
    ctx.fillStyle = "#1c1410"; ctx.fillRect(0, 0, W, H); if (!T) return;
    T.trunks.forEach(t => {
      const p = scr(t.x, t.y, R), lit = !litSet || t.ms.some(n => litSet.has(n.id)), wob = a => 1 + 0.035 * Math.sin(a * 3 + t.c) + 0.02 * Math.sin(a * 7 + t.c * 2);
      ctx.globalAlpha = lit ? 1 : 0.3;
      ctx.fillStyle = "#4a2f1e"; ctx.beginPath(); for (let s = 0; s <= 48; s++) { const a = s / 48 * 2 * Math.PI, r = (t.R0 + 7) * k * wob(a); s ? ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r) : ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); } ctx.fill();   // bark
      for (let i = t.rad.length - 1; i >= 0; i--) {
        const r = t.rad[i] * k, busy = t.per[i] / Math.max(1, ...t.per);
        ctx.fillStyle = hexMix(i % 2 ? "#e2bf8a" : "#d4a86f", colorOf(t.c), 0.08 + 0.25 * busy);
        ctx.beginPath(); for (let s = 0; s <= 48; s++) { const a = s / 48 * 2 * Math.PI, rr = r * wob(a); s ? ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr) : ctx.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); } ctx.fill();
        ctx.strokeStyle = "rgba(92,58,30,.45)"; ctx.lineWidth = (t.m0 + i) % 12 === 0 ? 1.6 : 0.6; ctx.stroke();   // a darker line at each new year
        if (t.scars.has(i)) { const a = (hash(t.c + "s" + i) % 628) / 100; ctx.strokeStyle = "#3b1f10"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, r * wob(a) - 2), a - 0.25, a + 0.25); ctx.stroke(); }   // never negative, even mid-zoom
      }
      ctx.globalAlpha = 1;
      const m0 = t.m0, label = `${clip(clusterName(t.c), 24)}`, sub = `since ${new Date(Math.floor(m0 / 12), m0 % 12, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" })} · ${t.ms.length} notes${t.scars.size ? ` · ${t.scars.size} scar${t.scars.size > 1 ? "s" : ""}` : ""}`;
      haloText(label, p.x, p.y + (t.R0 + 18) * k, "#f5e6c8", "#1c1410", `700 ${Math.max(9, Math.min(12, 12 * Math.sqrt(k)))}px ${font}`, "center");
      if (k > 0.45) haloText(sub, p.x, p.y + (t.R0 + 18) * k + 13, "#bfa98a", "#1c1410", `500 9.5px ${font}`, "center");
    });
    const pulse = reducedMotion() ? 0.5 : 0.35 + 0.35 * Math.sin(now / 900);
    T.trunks.forEach(t => { const p = scr(t.x, t.y, R), r = t.rad[t.rad.length - 1] * k; ctx.strokeStyle = `rgba(190,242,100,${pulse * (t.per[t.per.length - 1] ? 1 : 0.4)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.stroke(); });   // growing now
    dots(n => !special(n) && !n.ghost && n.born && T.trunks.some(t => t.c === n.cluster), n => staleFor(n, Q.stale_days) ? "#6b5a48" : "#3b2416", () => Math.max(1.4, 2 * Math.sqrt(k)), R);
    const month = Date.now() - 30 * 864e5;
    nodes.forEach(n => { if (!n.born || !P.has(n.id) || new Date(n.born + "T12:00") < month) return; const q = P.get(n.id), tw = reducedMotion() ? 1 : Math.max(0, Math.sin(now / 260 + hash(n.id) % 11));
      ctx.strokeStyle = `rgba(254,249,195,${tw})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x - 4, q.y); ctx.lineTo(q.x + 4, q.y); ctx.moveTo(q.x, q.y - 4); ctx.lineTo(q.x, q.y + 4); ctx.stroke(); });   // born this month
    selRing(R, "#fde68a");
  }

  // Sky chart: what to read to get up to speed. Each topic is a constellation traced through its brightest notes
  // (the most relied on); brightness is influence. Rising stars (talked about lately) twinkle, fading ones
  // (stale) glow red. Faint dust is everything else.
  function skyLayout(geo) {
    const cen = topicCentres(geo, 4), pos = new Map(), cons = [];
    const cs = Object.entries(cen).sort((a, b) => b[1][2] - a[1][2]);
    cs.forEach(([c, [cx, cy, n]], i) => {   // constellations along an ecliptic band, ordered by size, alternating above and below
      const a = i / cs.length * 2 * Math.PI, X = Math.cos(a) * 820, Y = Math.sin(a) * 440 + (i % 2 ? 70 : -70);
      const ms = nodes.filter(m => m.cluster === +c && !special(m) && !m.ghost);
      const ds = ms.map(m => { const p = geo.get(m.id); return Math.hypot(p[0] - cx, p[1] - cy); }).sort((x, y) => x - y), q = ds[Math.floor(ds.length * 0.85)] || 1;
      const s = Math.min(0.6, (70 + 6 * Math.sqrt(ms.length)) / q);   // each constellation about the same size; outliers pulled in
      ms.forEach(m => { const p = geo.get(m.id); let dx = (p[0] - cx) * s, dy = (p[1] - cy) * s; const d = Math.hypot(dx, dy), cap = 130;
        if (d > cap) { dx *= cap / d; dy *= cap / d; } pos.set(m.id, [X + dx, Y + dy]); });
      const bright = ms.slice().sort(byImportance).slice(0, 7), ids = bright.map(m => m.id), seg = [];
      const inT = new Set([ids[0]]);   // a minimum spanning tree through the bright stars: the constellation's lines
      while (inT.size < ids.length) { let best = null; for (const u of inT) for (const v of ids) { if (inT.has(v)) continue; const d = Math.hypot(pos.get(u)[0] - pos.get(v)[0], pos.get(u)[1] - pos.get(v)[1]); if (!best || d < best[2]) best = [u, v, d]; } inT.add(best[1]); seg.push([best[0], best[1]]); }
      cons.push({ c: +c, ids, seg, X, Y });
    });
    nodes.forEach(n => { if (!pos.has(n.id)) { const h = hash(n.id); pos.set(n.id, [(h % 1600) - 800, ((h >>> 11) % 900) - 450]); } });
    return { pos, cons };
  }
  function drawSky(now) {
    const { R, litSet, font, k } = mapFrame(), S = mapCache.sky;
    // the sky turns slowly (a gentle sway rather than a full turn, so the constellations stay in frame)
    const th = reducedMotion() ? 0 : 0.12 * Math.sin(now / 45000), c0 = Math.cos(th), s0 = Math.sin(th);
    const scr = (x, y, R0) => proj(x * c0 - y * s0, x * s0 + y * c0, 0, R0);
    const g = ctx.createRadialGradient(W / 2, H * 1.2, 0, W / 2, H * 1.2, Math.max(W, H) * 1.3); g.addColorStop(0, "#1e2a5a"); g.addColorStop(0.5, "#0b1230"); g.addColorStop(1, "#02040d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); if (!S) return;
    const o = scr(0, 0, R);   // alt-az style grid and a milky way band
    ctx.strokeStyle = "rgba(148,163,184,.08)"; ctx.lineWidth = 1; for (let r = 200; r <= 1000; r += 200) { ctx.beginPath(); ctx.ellipse(o.x, o.y, r * k, r * 0.6 * k, 0, 0, 2 * Math.PI); ctx.stroke(); }
    const mw = ctx.createLinearGradient(o.x - 600 * k, o.y - 400 * k, o.x + 600 * k, o.y + 400 * k); mw.addColorStop(0.35, "rgba(200,210,255,0)"); mw.addColorStop(0.5, "rgba(200,210,255,.06)"); mw.addColorStop(0.65, "rgba(200,210,255,0)");
    ctx.fillStyle = mw; ctx.fillRect(0, 0, W, H);
    const bright = new Set(S.cons.flatMap(c => c.ids));
    S.cons.forEach(c => { const lit = !litSet || c.ids.some(id => litSet.has(id)); ctx.globalAlpha = lit ? 1 : 0.25; ctx.strokeStyle = "rgba(165,180,252,.45)"; ctx.lineWidth = 1;
      c.seg.forEach(([a, b]) => { const p = scr(...S.pos.get(a), R), q = scr(...S.pos.get(b), R); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }); });
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      if (special(n) || n.ghost || !mapShown(n)) continue;
      const p = scr(n.x, n.y, R), b = bright.has(n.id), imp = importance(n), lit = !litSet || litSet.has(n.id);
      const tw = !reducedMotion() && n.recent > 0 ? 0.65 + 0.35 * Math.sin(now / 260 + hash(n.id) % 9) : 1, fading = staleFor(n, Q.stale_days);
      const r = b ? (1.8 + 4.5 * imp) * Math.max(0.7, Math.sqrt(k)) * tw : Math.max(0.8, 1.1 * Math.sqrt(k));
      const col = fading ? "#fca5a5" : n.recent > 0 ? "#fef3c7" : b ? "#e0e7ff" : "rgba(203,213,225,.55)";
      ctx.globalAlpha = lit ? 1 : 0.25;
      if (b) { const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5); gl.addColorStop(0, col); gl.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gl; ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = lit ? 1 : 0.25; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      if (b && n.recent > 0 && k > 0.5) { ctx.fillStyle = "#fde68a"; ctx.font = `700 9px ${font}`; ctx.textAlign = "center"; ctx.fillText("▲", p.x + r + 5, p.y - r - 2); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -imp, r: Math.max(5, r + 2), a: lit ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    const sz = S.life || (S.life = { shots: [], next: 0, seen: 0 }), sdt = tickOf(sz, now);
    if (sdt) {
      const fresh = liveEdits.filter(e => e.t > sz.seen && P.has(e.id)); fresh.forEach(e => sz.shots.push({ id: e.id, t: 0, a: 0.5 + Math.random() * 0.6 })); if (liveEdits.length) sz.seen = Math.max(sz.seen, ...liveEdits.map(e => e.t));
      sz.next -= sdt;
      if (sz.next <= 0) { const rec = nodes.filter(n => n.recent > 0 && P.has(n.id)); if (rec.length) sz.shots.push({ id: rec[Math.floor(Math.random() * rec.length)].id, t: 0, a: 0.3 + Math.random() * 0.9 }); sz.next = 2500 + Math.random() * 4500; }
    }
    sz.shots = sz.shots.filter(q => (q.t += sdt) < 1100);
    sz.shots.forEach(q => { const p0 = P.get(q.id); if (!p0) return; const f = q.t / 1100, L = 140, hx = p0.x + Math.cos(q.a) * L * f, hy = p0.y + Math.sin(q.a) * L * f;
      const gr = ctx.createLinearGradient(hx, hy, hx - Math.cos(q.a) * 50, hy - Math.sin(q.a) * 50); gr.addColorStop(0, `rgba(255,255,255,${1 - f})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = gr; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(q.a) * 50, hy - Math.sin(q.a) * 50); ctx.stroke(); });
    S.cons.forEach(c => { const p = scr(c.X, c.Y, R), name = clip(clusterName(c.c), 26).toUpperCase(), f = `600 10px ${font}`, ly = p.y - 140 * k; ctx.font = f;
      const w = ctx.measureText(name).width + name.length * 1.5; if (freeSpot(p.x - w / 2, ly - 8, w, 14)) { ctx.fillStyle = "rgba(199,210,254,.75)"; ctx.textAlign = "center"; ctx.letterSpacing = "1.5px"; ctx.fillText(name, p.x, ly); ctx.letterSpacing = "0px"; } });
    noteLabels(S.cons.map(c => c.ids[0]), "#e0e7ff", "#02040d", 40);
    selRing(R, "#fde68a");
  }

  // Realm: the vault as a hand-drawn map. Each topic is a kingdom whose land is where its notes lie; maps (MOCs) are
  // castles, bridge notes are bridges, your most relied-on notes are mountains, stale ground is forest, and unlinked
  // notes drift in the far sea where the dragons are.
  function realmLayout(geo) {
    const pos = new Map(); geo.forEach((p, id) => pos.set(id, [p[0] * 1.2, p[1] * 1.2]));
    const land = nodes.filter(n => !special(n) && !n.ghost && !n.isolated);
    const [x0, y0, x1, y1] = bounds(land.map(n => pos.get(n.id)), 140), CELL = 12, gw = Math.ceil((x1 - x0) / CELL), gh = Math.ceil((y1 - y0) / CELL);
    const G = 60, grid = new Map(); land.forEach(n => { const [x, y] = pos.get(n.id), key = Math.floor(x / G) + "," + Math.floor(y / G); (grid.get(key) || grid.set(key, []).get(key)).push(n); });
    const own = new Int16Array(gw * gh).fill(-9);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL, gx = Math.floor(x / G), gy = Math.floor(y / G); let best = null, bd = 64 * 64;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of grid.get((gx + a) + "," + (gy + b)) || []) { const [nx, ny] = pos.get(n.id), d = (nx - x) ** 2 + (ny - y) ** 2 + (hash(n.id + i) % 300); if (d < bd) { bd = d; best = n; } }
      own[j * gw + i] = best ? best.cluster : -9; }
    const off = document.createElement("canvas"); off.width = gw; off.height = gh; const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    const PARCH = [239, 224, 189], SEA = [176, 196, 186], hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (let k2 = 0; k2 < own.length; k2++) { const c = own[k2], i = k2 % gw, j = Math.floor(k2 / gw), noise = ((hash("p" + k2) % 13) - 6);
      let col = c === -9 ? SEA.map(v => v + noise * 0.6) : hex(colorOf(c)).map((v, q) => PARCH[q] + (v - PARCH[q]) * 0.22 + noise);
      if (c !== -9) { const nb4 = [own[k2 - 1], own[k2 + 1], own[k2 - gw], own[k2 + gw]]; if (nb4.some(v => v === -9)) col = [120, 92, 60]; else if (nb4.some(v => v !== undefined && v !== c)) col = col.map(v => v * 0.72); }
      else if ((i + j) % 6 === 0) col = col.map(v => v - 14);   // sea hatching
      img.data.set([col[0], col[1], col[2], 255], k2 * 4); }
    oc.putImageData(img, 0, 0);
    const iso = nodes.filter(n => n.isolated && !special(n)), dragon = [x1 + 160, y0 + 120];
    iso.forEach(n => { const h = hash(n.id), a = (h % 628) / 100, r = 30 + (h >>> 9) % 140; pos.set(n.id, [dragon[0] + Math.cos(a) * r, dragon[1] + Math.sin(a) * r * 0.7]); });
    const kingdoms = topicCentres(new Map([...pos].filter(([id]) => byId[id] && !byId[id].isolated)), 3);
    return { pos, img: off, x0, y0, w: gw * CELL, h: gh * CELL, kingdoms, dragon };
  }
  function drawRealm(now) {
    const { dpr, R, litSet, k } = mapFrame(), M = mapCache.realm;
    ctx.fillStyle = "#b0c4ba"; ctx.fillRect(0, 0, W, H); if (!M) return;
    worldTransform(dpr, R); ctx.imageSmoothingEnabled = false; ctx.drawImage(M.img, M.x0, M.y0, M.w, M.h); ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const serif = "Georgia, 'Times New Roman', serif", ink = "#3b2a17";
    for (const n of nodes) {   // landmarks
      if (n.ghost || n.person || !mapShown(n)) continue;
      const p = scr(n.x, n.y, R), lit = !litSet || litSet.has(n.id), s = Math.max(0.6, Math.sqrt(k)); ctx.globalAlpha = lit ? 1 : 0.3; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.1;
      if (n.moc) { const w = 8 * s; ctx.fillStyle = "#e9dcc0"; ctx.fillRect(p.x - w, p.y - w, w * 2, w * 1.6); ctx.strokeRect(p.x - w, p.y - w, w * 2, w * 1.6);
        for (let i = 0; i < 3; i++) ctx.strokeRect(p.x - w + i * w * 0.8, p.y - w - 4 * s, w * 0.4, 4 * s); ctx.beginPath(); ctx.moveTo(p.x, p.y - w - 4 * s); ctx.lineTo(p.x, p.y - w - 12 * s); ctx.stroke();
        ctx.fillStyle = "#b91c1c"; ctx.fillRect(p.x, p.y - w - 12 * s, 6 * s, 4 * s); P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -3, r: w + 4, a: 1 }); continue; }
      if (n.isolated) { ctx.fillStyle = "rgba(59,42,23,.5)"; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * s, 0, 2 * Math.PI); ctx.fill(); P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: 0, r: 5, a: 1 }); continue; }
      const imp = importance(n);
      if (n.bridge) { ctx.beginPath(); ctx.arc(p.x, p.y + 3 * s, 6 * s, Math.PI, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x - 7 * s, p.y - 3 * s); ctx.lineTo(p.x + 7 * s, p.y - 3 * s); ctx.stroke(); }
      else if (imp > 0.42) { const h = (7 + 10 * imp) * s; ctx.fillStyle = "#cdb48c"; ctx.beginPath(); ctx.moveTo(p.x - h * 0.7, p.y + h * 0.3); ctx.lineTo(p.x, p.y - h * 0.7); ctx.lineTo(p.x + h * 0.7, p.y + h * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y - h * 0.7); ctx.lineTo(p.x + h * 0.15, p.y - h * 0.1); ctx.stroke(); }
      else if (staleFor(n, Q.stale_days)) { ctx.fillStyle = "#4d6b3a"; ctx.beginPath(); ctx.arc(p.x, p.y - 2 * s, 3.2 * s, 0, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + 3 * s); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * s, 0, 2 * Math.PI); ctx.fill(); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -imp, r: Math.max(5, (imp > 0.42 ? 10 : 4) * s), a: lit ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    Object.entries(M.kingdoms).sort((a, b) => b[1][2] - a[1][2]).forEach(([c, [x, y, n]]) => { const p = scr(x, y, R), name = clip(clusterName(+c), 26), size = Math.max(10, Math.min(18, (9 + Math.sqrt(n) * 1.3) * Math.sqrt(k)));
      const f = `italic 700 ${size}px ${serif}`; ctx.font = f; const w = ctx.measureText(name).width; if (freeSpot(p.x - w / 2, p.y - size, w, size * 1.4)) haloText(name, p.x, p.y - size * 0.3, "#4a2d14", "rgba(239,224,189,.75)", f, "center", 3); });
    // roads between kingdoms that link, with caravans: more caravans on busier roads
    if (!M.roads) { const K = M.kingdoms; M.roads = (DATA.pairs || []).filter(([a, b, l]) => l >= 2 && K[a] && K[b]).sort((x, y) => y[2] - x[2]).slice(0, 18).map(([a, b, l]) => ({ a: K[a], b: K[b], l })); }
    M.roads.forEach(rd => { const a = scr(rd.a[0], rd.a[1], R), b = scr(rd.b[0], rd.b[1], R), cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      ctx.strokeStyle = "rgba(59,42,23,.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const n = Math.min(3, Math.ceil(rd.l / 4)), per = 16000 + (rd.l * 997) % 6000;
      for (let j = 0; j < n; j++) { const back = j % 2, t0 = ((reducedMotion() ? 0.4 : now / per) + j / n) % 1, t = back ? 1 - t0 : t0, u2 = 1 - t;
        const x = u2 * u2 * a.x + 2 * u2 * t * cx + t * t * b.x, y = u2 * u2 * a.y + 2 * u2 * t * cy + t * t * b.y, s = Math.max(0.8, Math.sqrt(k));
        ctx.fillStyle = "#7c4a1e"; ctx.fillRect(x - 3 * s, y - 2.5 * s, 6 * s, 3.5 * s); ctx.fillStyle = "#3b2a17"; ctx.beginPath(); ctx.arc(x - 2 * s, y + 1.4 * s, 1.1 * s, 0, 2 * Math.PI); ctx.arc(x + 2 * s, y + 1.4 * s, 1.1 * s, 0, 2 * Math.PI); ctx.fill(); } });
    for (let i = 0; i < 5; i++) {   // cloud shadows drifting east
      const x = (((reducedMotion() ? 0 : now) * 0.012 + i * 397) % (W + 500)) - 250, y = (hash("cloud" + i) % 1000) / 1000 * H;
      ctx.fillStyle = "rgba(40,30,20,.07)"; ctx.beginPath(); ctx.ellipse(x, y, 160, 60, 0.2, 0, 2 * Math.PI); ctx.ellipse(x + 80, y + 20, 110, 45, 0, 0, 2 * Math.PI); ctx.fill(); }
    const d = scr(...M.dragon, R); ctx.font = `italic 600 ${Math.max(10, 14 * Math.sqrt(k))}px ${serif}`; ctx.textAlign = "center"; ctx.fillStyle = "#5b3a1a";
    ctx.fillText("Here be dragons", d.x, d.y - 120 * k * 0.7); ctx.font = `${Math.max(14, 26 * Math.sqrt(k))}px ${serif}`; { const da = (reducedMotion() ? 0 : now) / 3200; ctx.fillText("🐉", d.x + Math.cos(da) * 90 * Math.max(0.5, k), d.y - 40 * k + Math.sin(da) * 45 * Math.max(0.5, k)); }   // circling over the unlinked notes
    if (k > 0.2) haloText("(notes linked to nothing)", d.x, d.y - 120 * k * 0.7 + 14, "#6b4a2a", "rgba(176,196,186,.8)", `italic 500 10px ${serif}`, "center");
    const cx = W - 60, cy = H - 70; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;   // compass rose
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 2 * Math.PI); ctx.stroke(); [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([ux, uy], i) => { ctx.beginPath(); ctx.moveTo(cx + ux * 34, cy + uy * 34); ctx.lineTo(cx - uy * 5, cy + ux * 5); ctx.lineTo(cx + uy * 5, cy - ux * 5); ctx.closePath(); i ? ctx.stroke() : ctx.fill(); });
    ctx.font = `700 11px ${serif}`; ctx.textAlign = "center"; ctx.fillText("N", cx, cy - 40);
    ctx.strokeStyle = "rgba(59,42,23,.6)"; ctx.lineWidth = 3; ctx.strokeRect(6, 6, W - 12, H - 12); ctx.lineWidth = 1; ctx.strokeRect(11, 11, W - 22, H - 22);   // border
    selRing(R, "#7f1d1d");
  }

  // Food web: which notes feed which. Notes others rely on but that link out little are producers (context, reference);
  // notes that mostly link out are consumers (logs, plans, task lists). Energy flows up the links. A relied-on note
  // that has gone stale is endangered: the notes above it feed on something that's out of date.
  function foodwebLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && !n.isolated), pos = new Map(geo), levels = [[], [], [], [], []];
    const lvl = VGRules.trophicLevels(ns);   // shared rule (vault_graph_rules.js): rank of out-share, low-degree notes kept off the ends
    ns.forEach(n => levels[lvl.get(n.id)].push(n));
    const order = topicOrder().map(c => c.id), ci = c => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
    levels.forEach((ms, L) => { ms.sort((a, b) => ci(a.cluster) - ci(b.cluster) || importance(b) - importance(a));
      const rows = Math.max(1, Math.ceil(ms.length * 12 / 1800)), cols = Math.max(1, Math.ceil(ms.length / rows)), width = Math.min(1800, Math.max(600, cols * 14));
      ms.forEach((n, i) => { const row = i % rows, j = Math.floor(i / rows); pos.set(n.id, [-width / 2 + (j + 0.5) * width / cols, 420 - L * 210 + row * 24 - (rows - 1) * 12]); }); });
    const endangered = new Set(ns.filter(n => n.inlinks >= 4 && staleFor(n, Q.stale_days)).map(n => n.id));
    return { pos, levels: levels.map(l => l.length), endangered };
  }
  // Sparks climb the links from the notes relied on to the notes that use them, more often into busy notes. A spark
  // leaving a stale (endangered) note -- or one already tainted -- is grey, and taints what it reaches, so you can
  // watch out-of-date knowledge spread upward. Taint fades over a minute or so.
  const fw = { parts: [], taint: new Map(), edges: [], cum: [], tot: 0, map: null, last: 0 };
  function stepFoodweb(now, k, R) {
    const F = mapCache.foodweb;
    if (fw.map !== F || fw.links !== links.length) {
      fw.map = F; fw.links = links.length; fw.edges = []; fw.cum = []; fw.tot = 0;
      for (const l of links) { if (l.kind !== "link" || special(l.s) || special(l.t) || l.s.isolated || l.t.isolated) continue;
        const ys = F.pos.get(l.s.id)[1], yt = F.pos.get(l.t.id)[1], [lo, hi] = ys > yt ? [l.s, l.t] : [l.t, l.s];   // the layout's levels, not mid-morph spots
        if (Math.abs(ys - yt) < 60) continue;   // same level: nothing climbs
        fw.tot += 0.15 + activity(hi); fw.edges.push([lo, hi]); fw.cum.push(fw.tot); }
    }
    const dt = Math.min(100, now - (fw.last || now)); fw.last = now;
    if (!reducedMotion() && fw.edges.length) for (let i = 0; i < Math.min(6, dt / 16 * 2.2) && fw.parts.length < 260; i++) {
      const r = Math.random() * fw.tot; let a = 0, b = fw.cum.length - 1; while (a < b) { const m = (a + b) >> 1; if (fw.cum[m] < r) a = m + 1; else b = m; }
      const [lo, hi] = fw.edges[a]; if (!visible(lo) || !visible(hi)) continue;
      fw.parts.push({ a: lo, b: hi, t: 0, grey: F.endangered.has(lo.id) || (fw.taint.get(lo.id) || 0) > 0.3, sp: 0.0007 + Math.random() * 0.0006 });
    }
    fw.taint.forEach((v, id) => { const nv = v * Math.pow(0.9996, dt); if (nv < 0.03) fw.taint.delete(id); else fw.taint.set(id, nv); });
    ctx.globalCompositeOperation = "lighter";
    for (let i = fw.parts.length - 1; i >= 0; i--) {
      const q = fw.parts[i]; q.t += q.sp * dt;
      if (q.t >= 1) { if (q.grey) fw.taint.set(q.b.id, Math.min(1, (fw.taint.get(q.b.id) || 0) + 0.35)); fw.parts.splice(i, 1); continue; }
      const A = scr(q.a.x, q.a.y, R), B = scr(q.b.x, q.b.y, R), my = (A.y + B.y) / 2, u = 1 - q.t, t = q.t;   // the same curve the link is drawn with
      const x = u * u * u * A.x + 3 * u * u * t * A.x + 3 * u * t * t * B.x + t * t * t * B.x, y = u * u * u * A.y + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * B.y;
      ctx.fillStyle = q.grey ? "rgba(148,163,184,.8)" : "rgba(253,224,71,.85)"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 1.7 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    fw.taint.forEach((v, id) => { const q = P.get(id); if (!q) return; ctx.strokeStyle = `rgba(148,163,184,${0.2 + 0.55 * v})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 1.5, 0, 2 * Math.PI); ctx.stroke(); });
  }
  function drawFoodweb(now) {
    const { R, litSet, font, k } = mapFrame(), F = mapCache.foodweb;
    backdrop("#14231b", "#22331c"); if (!F) return;
    const NAMES = ["Producers · relied on, link out little", "Primary consumers", "Mixed", "Secondary consumers", "Apex · logs, plans, task lists"];
    NAMES.forEach((nm, L) => { const p = scr(0, 420 - L * 210, R); ctx.fillStyle = "rgba(255,255,255,.03)"; ctx.fillRect(0, p.y - 95 * k, W, 190 * k);
      const t = `${nm} (${F.levels[L]})`, f = `700 10.5px ${font}`, y = p.y - 80 * k;
      ctx.font = f; freeSpot(14, y - 8, ctx.measureText(t).width + 6, 16);   // reserved, so note labels steer around the level's name
      haloText(t, 14, y, "rgba(220,252,231,.75)", "#14231b", f); });
    ctx.lineWidth = 0.7;
    for (const l of visLinks) { if (l.kind !== "link" || special(l.s) || special(l.t) || l.s.isolated || l.t.isolated) continue;
      const [lo, hi] = l.s.y > l.t.y ? [l.s, l.t] : [l.t, l.s], a = scr(lo.x, lo.y, R), b = scr(hi.x, hi.y, R), on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      ctx.strokeStyle = on && litSet ? "rgba(253,224,71,.7)" : "rgba(187,247,208,.07)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y); ctx.stroke(); }
    dots(n => !special(n) && !n.ghost && !n.isolated, n => F.endangered.has(n.id) ? "#f87171" : colorOf(n.cluster), n => Math.max(1.8, (1.8 + 4 * importance(n)) * Math.sqrt(k)), R);
    stepFoodweb(now, k, R);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) {   // what depends on this note
      const q = P.get(st.selected), d = dependents(st.selected).size, t = d ? `${d} note${d > 1 ? "s" : ""} depend on this` : "nothing above depends on this";
      haloText(t, q.x, q.y - q.r - 12, "#fde68a", "#14231b", `700 11px ${font}`, "center");
    }
    F.endangered.forEach(id => { const p = P.get(id); if (!p) return; ctx.strokeStyle = `rgba(248,113,113,${0.5 + 0.4 * Math.sin(now / 400)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 2 * Math.PI); ctx.stroke(); });
    noteLabels([...F.endangered, ...nodes.filter(n => !special(n) && !n.isolated && P.has(n.id)).sort(byImportance).map(n => n.id)], "#ecfdf5", "#14231b", k > 1.3 ? 90 : 24);
    selRing(R);
  }

  // Reactions: pairs of notes that want joining, one set for every view that shows them (Alchemy, Periodic table).
  // Bond: similar meaning or talked about together, never linked. Fusion: near-duplicates, maybe one note. Transmutation:
  // a topic's gold note (goldOf picks it from the topic's notes) and an unconnected note beside it. Strongest first.
  const REACTIONS = { bond: ["Bond", "#22d3ee", "similar meaning, never linked"], fusion: ["Fusion", "#c084fc", "near-duplicates, maybe one note"],
    transmute: ["Transmutation", "#fbbf24", "a gold note can lift an unconnected one"] };
  function reactionsAmong(keep, goldOf = mem => mem.slice().sort(byImportance)[0]) {
    const rx = [], topics = new Map();
    links.forEach(l => { if ((l.kind === "similar" || l.kind === "gap") && keep.has(l.s.id) && keep.has(l.t.id) && !nb[l.s.id].has(l.t.id))
      rx.push({ type: "bond", a: l.s, b: l.t, why: l.why || (l.kind === "similar" ? "similar meaning" : "talked about together") }); });
    (DATA.near_dupes || []).forEach(([a, b, sim]) => { if (keep.has(a) && keep.has(b)) rx.push({ type: "fusion", a: byId[a], b: byId[b], why: `${Math.round(sim * 100)}% alike` }); });
    keep.forEach(id => { const n = byId[id]; if (n && n.cluster >= 0) (topics.get(n.cluster) || topics.set(n.cluster, []).get(n.cluster)).push(n); });
    topics.forEach(mem => { const gold = goldOf(mem); if (!gold) return;
      mem.filter(n => n.isolated && (n.words || 0) >= Q.stub_words && !nb[gold.id].has(n.id)).sort((a, b) => b.words - a.words).slice(0, 3)
        .forEach(n => rx.push({ type: "transmute", a: gold, b: n, why: `${n.name} links to nothing; ${gold.name} is the topic's gold` })); });
    return rx.sort((x, y) => importance(y.a) + importance(y.b) - importance(x.a) - importance(x.b));
  }
  // run one: link the pair (Bond, Transmutation) or open both to merge by hand (Fusion). hooks.skip on Cancel,
  // hooks.done(colour) once it's run, for a view's own score and effects.
  async function runReaction(x, hooks = {}) {
    const [nm, col] = REACTIONS[x.type], fusion = x.type === "fusion";
    const body = fusion ? `<b>${esc(x.a.name)}</b> and <b>${esc(x.b.name)}</b> look like the same note (${esc(x.why)}). This opens both so you can merge them by hand; nothing is merged for you.`
      : `Link <b>${esc(x.a.name)}</b> ↔ <b>${esc(x.b.name)}</b>? ${esc(x.why)}. A Related link goes into the staler note.`;
    if (!await confirmBox(`${nm} reaction`, body + (hooks.skip ? " Cancel to see the next reaction." : ""), fusion ? "Open both" : "Link them")) { if (hooks.skip) hooks.skip(); renderToday(); return; }
    if (fusion) { if (!opts.openNote) return; opts.openNote(x.a.id, false); opts.openNote(x.b.id, true); }
    else { if (!opts.linkNotes) { toast("Linking runs in the plugin", "warn"); return; }
      await actOnSuggestion("link", x.a.id, x.b.id, document.createElement("button"), x.type === "transmute" ? "transmutation: the topic's most relied-on note" : null);
      if (!nb[x.a.id].has(x.b.id)) return; }   // the link failed; actOnSuggestion already said so
    x.done = true; if (hooks.done) hooks.done(col); renderToday();
  }

  // Alchemy: each topic is a flask; its notes sit in rings by stage of the Great Work, raw lead (nigredo) outside and
  // relied-on gold (rubedo) at the centre. Sparks run along the waiting reactions (the shared set above, gold = the
  // flask's rubedo); the Today bar runs them one at a time and keeps score.
  const AL_STAGES = [["Nigredo", "#78716c"], ["Albedo", "#e7e5e4"], ["Citrinitas", "#facc15"], ["Rubedo", "#f97316"]];
  const alStage = n => n.isolated || (n.words || 0) < Q.stub_words ? 0 : (n.inlinks || 0) < 2 ? 1 : importance(n) >= 0.35 && !staleFor(n, Q.stale_days) ? 3 : 2;
  // reactions run: in the shared game state with XP (per vault, every device). Before that it was this browser's
  // own count, carried over once (then removed, so a second vault doesn't take it too).
  const alScore = { get() { if (typeof cos.alchemyRuns !== "number") { let old = 0; try { old = +localStorage.getItem("vg-alchemy-runs") || 0; localStorage.removeItem("vg-alchemy-runs"); } catch (e) { }
      cos.alchemyRuns = old; } return cos.alchemyRuns; },
    add() { cos.alchemyRuns = this.get() + 1; persistSoon(); } };
  const al = { sparks: [], flash: [], idx: 0, spawn: 0, last: 0 };
  const alPartners = id => (mapCache.alchemy ? mapCache.alchemy.rx : []).filter(x => !x.done && (x.a.id === id || x.b.id === id)).map(x => x.a.id === id ? x.b.id : x.a.id);
  function alchemyLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.cluster >= 0), pos = new Map(geo), used = new Set(), keep = new Set(ns.map(n => n.id));
    const symbol = name => { const w = name.replace(/[^A-Za-z]/g, "") || "X", c = [...w.slice(1).toLowerCase()].map(ch => w[0].toUpperCase() + ch);
      const s = c.find(x => !used.has(x)) || w[0].toUpperCase() + used.size; used.add(s); return s; };
    const cs = topicOrder().map(c => ({ c, mem: ns.filter(n => n.cluster === c.id) })).filter(f => f.mem.length);
    cs.forEach(f => f.r = 36 + 11 * Math.sqrt(f.mem.length));
    const ring = Math.max(300, cs.reduce((t, f) => t + 2 * f.r + 40, 0) / (2 * Math.PI));
    let ang = -Math.PI / 2;
    const flasks = cs.map(f => { ang += (f.r + 20) / ring; const x = ring * Math.cos(ang), y = ring * Math.sin(ang); ang += (f.r + 20) / ring;
      [0, 1, 2, 3].forEach(s => { const ms = f.mem.filter(n => alStage(n) === s), rr = f.r * [0.84, 0.6, 0.36, 0.13][s];
        ms.forEach((n, j) => { const a = s + 2 * Math.PI * j / ms.length; pos.set(n.id, [x + rr * Math.cos(a), y + rr * Math.sin(a)]); }); });
      return { c: f.c, x, y, r: f.r, sym: symbol(clusterName(f.c.id)), n: f.mem.length }; });
    const rx = reactionsAmong(keep, mem => mem.filter(n => alStage(n) === 3).sort(byImportance)[0]);
    return { pos, flasks, rx, gold: ns.filter(n => alStage(n) === 3).length, total: ns.length };
  }
  // the alchemy's own bookkeeping around a shared reaction: skip moves to the next, a run scores and flashes
  const alRun = x => runReaction(x, { skip: () => al.idx++,
    done: col => { alScore.add(); [x.a, x.b].forEach(n => al.flash.push({ n, t: 0, col })); toast(`${REACTIONS[x.type][0]} complete · ${plural(alScore.get(), "reaction")} run`, "ok"); } });
  function drawAlchemy(now) {
    const { R, litSet, font, k } = mapFrame(), A = mapCache.alchemy;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, "#1f1a33"); g.addColorStop(1, "#0b0a12");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); if (!A) return;
    A.flasks.forEach(f => { const p = scr(f.x, f.y, R), r = f.r * k, col = colorOf(f.c.id), on = !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === f.c.id);
      ctx.globalAlpha = on ? 0.1 : 0.03; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = on ? 0.6 : 0.15; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      if (on) haloText(`${f.sym} · ${clip(clusterName(f.c.id), 26)} (${f.n})`, p.x, p.y - r - 9, "#ede9fe", "#0b0a12", `700 10.5px ${font}`, "center"); });
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
    A.rx.forEach(x => { if (x.done || !mapShown(x.a) || !mapShown(x.b)) return; const a = scr(x.a.x, x.a.y, R), b = scr(x.b.x, x.b.y, R), on = litSet && litSet.has(x.a.id) && litSet.has(x.b.id);
      ctx.strokeStyle = REACTIONS[x.type][1]; ctx.globalAlpha = on ? 0.9 : litSet ? 0.04 : 0.18; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost && n.cluster >= 0, n => litSet && !litSet.has(n.id) ? "rgba(120,113,108,.25)" : AL_STAGES[alStage(n)][1],
      n => Math.max(1.8, (1.8 + 3.5 * importance(n)) * Math.sqrt(k)), R);
    nodes.forEach(n => { if (special(n) || n.ghost || alStage(n) !== 3) return; const p = P.get(n.id); if (!p) return;   // gold glows
      ctx.strokeStyle = `rgba(251,191,36,${0.35 + 0.3 * Math.sin(now / 500 + n.x)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 2.5, 0, 2 * Math.PI); ctx.stroke(); });
    const dt = tickOf(al, now), open = A.rx.filter(x => !x.done && mapShown(x.a) && mapShown(x.b));
    if (dt && open.length && now - al.spawn > 650 && al.sparks.length < 12) { al.spawn = now; al.sparks.push({ x: open[Math.floor(Math.random() * open.length)], t: 0 }); }
    ctx.globalCompositeOperation = "lighter";
    for (let i = al.sparks.length - 1; i >= 0; i--) { const s = al.sparks[i]; s.t += dt / 1300;
      if (s.t >= 1 || s.x.done) { if (!s.x.done) al.flash.push({ n: s.x.b, t: 0, col: REACTIONS[s.x.type][1] }); al.sparks.splice(i, 1); continue; }
      const a = scr(s.x.a.x, s.x.a.y, R), b = scr(s.x.b.x, s.x.b.y, R);
      ctx.fillStyle = REACTIONS[s.x.type][1]; ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * s.t, a.y + (b.y - a.y) * s.t, Math.max(1.6, 2.2 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
    for (let i = al.flash.length - 1; i >= 0; i--) { const f = al.flash[i]; f.t += (dt || 16) / 700; if (f.t >= 1) { al.flash.splice(i, 1); continue; }
      const p = scr(f.n.x, f.n.y, R); ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - f.t; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 16 * f.t, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    setSceneStat(`⚗ ${plural(alScore.get(), "reaction")} run · ${open.length} waiting · gold ${A.gold}/${A.total}`);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) { const q = P.get(st.selected), m = alPartners(st.selected).length;
      haloText(`${AL_STAGES[alStage(byId[st.selected])][0]} · ${m ? plural(m, "possible reaction") : "nothing to react with"}`, q.x, q.y - q.r - 12, "#fde68a", "#0b0a12", `700 11px ${font}`, "center"); }
    noteLabels(nodes.filter(n => !special(n) && !n.ghost && P.has(n.id) && (alStage(n) === 3 || alPartners(n.id).length)).sort(byImportance).map(n => n.id), "#f5f3ff", "#0b0a12", k > 1.3 ? 80 : 20);
    selRing(R, "#fbbf24");
  }

  // Lineage: where each note came from. Time runs left to right by birth order (so a busy month doesn't crush a quiet
  // one) and each topic is a lane. A note's parent is a note it links with that already existed -- its own topic
  // first, then the most relied-on. Orange curves are ideas that crossed into another topic. Click a note for its
  // ancestry and everything that grew from it.
  function lineageLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost), dated = ns.filter(n => n.born).sort((a, b) => a.born.localeCompare(b.born) || a.id.localeCompare(b.id));
    const rank = new Map(dated.map((n, i) => [n.id, i])), Wd = Math.max(1600, dated.length * 3.2), xOf = i => -Wd / 2 + Wd * i / Math.max(1, dated.length - 1);
    const laneOf = n => (n.cluster >= 0 && clusterById[n.cluster] ? n.cluster : -1);
    const lanes = topicOrder().map(c => c.id).concat([-1]).filter(c => ns.some(n => laneOf(n) === c));
    const laneY = {}; let y = 0;
    lanes.forEach(c => { const h = 60 + 9 * Math.sqrt(ns.filter(n => laneOf(n) === c).length); laneY[c] = [y, h]; y += h + 14; });
    const pos = new Map(geo), parent = new Map(), kids = new Map(), desc = new Map();
    dated.forEach(n => { let best = null, bv = -1;
      (nb[n.id] || []).forEach(id => { const m = byId[id]; if (!m || special(m) || !rank.has(id) || rank.get(id) >= rank.get(n.id)) return;
        const v = importance(m) + (m.cluster === n.cluster ? 1 : 0); if (v > bv) { bv = v; best = m; } });
      if (best) { parent.set(n.id, best.id); if (!kids.has(best.id)) kids.set(best.id, []); kids.get(best.id).push(n.id); } });
    for (let i = dated.length - 1; i >= 0; i--) { const id = dated[i].id; desc.set(id, (kids.get(id) || []).reduce((s, c) => s + 1 + (desc.get(c) || 0), 0)); }   // children are always born later
    lanes.forEach(c => { const ms = dated.filter(n => laneOf(n) === c), [ly, lh] = laneY[c], rows = Math.max(2, Math.round(lh / 13));
      ms.forEach((n, i) => pos.set(n.id, [xOf(rank.get(n.id)), ly + (i % rows + 0.5) * lh / rows])); });
    ns.filter(n => !n.born).forEach((n, i) => { const [ly, lh] = laneY[laneOf(n)] || [y, 40]; pos.set(n.id, [-Wd / 2 - 120, ly + (i % 6 + 0.5) * lh / 6]); });   // undated: a column of their own
    const ticks = []; let last = "";
    dated.forEach((n, i) => { const m = n.born.slice(0, 7); if (m !== last) { last = m; ticks.push([xOf(i), m]); } });
    return { pos, parent, kids, desc, laneY, lanes, ticks };
  }
  const lineageOf = id => { const L = mapCache.lineage, out = new Set(); if (!L) return out;
    for (let p = L.parent.get(id); p && !out.has(p); p = L.parent.get(p)) out.add(p);
    const q = [id]; while (q.length) (L.kids.get(q.pop()) || []).forEach(c => { if (!out.has(c)) { out.add(c); q.push(c); } });
    return out; };
  function drawLineage(now) {
    const { R, litSet, font, k } = mapFrame(), L = mapCache.lineage;
    ctx.fillStyle = "#0f131b"; ctx.fillRect(0, 0, W, H); if (!L) return;
    L.lanes.forEach((c, i) => { const [ly, lh] = L.laneY[c], a = scr(0, ly, R).y, b = scr(0, ly + lh, R).y;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,.022)" : "rgba(255,255,255,.045)"; ctx.fillRect(0, a, W, b - a);
      if (b - a > 12) haloText(c < 0 ? "Unclustered" : clip(clusterName(c), 30), 12, a + 9, c < 0 ? "#94a3b8" : colorOf(c), "#0f131b", `700 10px ${font}`); });
    let lastX = -1e9;
    L.ticks.forEach(([x, m]) => { const p = scr(x, 0, R); if (p.x < -50 || p.x > W + 50) return; const yr = m.endsWith("-01");
      ctx.strokeStyle = yr ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
      if (p.x - lastX > 58) { const first = lastX < -1e8; lastX = p.x;   // the first label and every January carry the year
        haloText(yr ? m.slice(0, 4) : new Date(m + "-15T12:00").toLocaleDateString(undefined, { month: "short" }) + (first ? ` ’${m.slice(2, 4)}` : ""), p.x + 3, H - 14, yr ? "#e2e8f0" : "#94a3b8", "#0f131b", `${yr ? 700 : 500} 10px ${font}`); } });
    ctx.lineWidth = 1;
    L.parent.forEach((pid, id) => { const n = byId[id], p = byId[pid]; if (!mapShown(n) || !mapShown(p)) return;
      const a = scr(p.x, p.y, R), b = scr(n.x, n.y, R), on = litSet && litSet.has(id) && litSet.has(pid), cross = n.cluster !== p.cluster, mx = (a.x + b.x) / 2;
      ctx.globalAlpha = on ? 0.9 : litSet ? 0.05 : cross ? 0.35 : 0.22; ctx.strokeStyle = on ? "#fde047" : cross ? "#fb923c" : colorOf(n.cluster);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y); ctx.stroke(); });
    ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost, n => litSet && !litSet.has(n.id) ? "rgba(100,116,139,.3)" : colorOf(n.cluster), n => Math.max(1.6, (1.6 + 1.3 * Math.log1p(L.desc.get(n.id) || 0)) * Math.sqrt(k)), R);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) { const q = P.get(st.selected), n = byId[st.selected], pid = L.parent.get(n.id);
      haloText(`${n.born ? "born " + n.born : "undated"}${pid ? " · grew from " + clip(byId[pid].name, 28) : " · a root"} · ${plural(L.desc.get(n.id) || 0, "descendant")}`, q.x, q.y - q.r - 12, "#fde68a", "#0f131b", `700 11px ${font}`, "center"); }
    noteLabels(nodes.filter(n => P.has(n.id) && !special(n)).sort((a, b) => (L.desc.get(b.id) || 0) - (L.desc.get(a.id) || 0)).map(n => n.id), "#e2e8f0", "#0f131b", k > 1.3 ? 70 : 18);
    selRing(R);
  }

  // Click depth: how many link-clicks each note is from your maps (or from a note you centre on), following links
  // the way you would in Obsidian. Rings are clicks; each note fans out under the note that first reaches it. The
  // red outer belt is what no link reaches -- only search finds those. Information architects call this click depth.
  function ripplesLayout(geo) {
    const pos = new Map(geo), keep = n => n && !n.person && !n.ghost, out = {};
    links.forEach(l => { if ((l.kind === "link" || l.kind === "moc") && keep(l.s) && keep(l.t)) (out[l.s.id] = out[l.s.id] || []).push(l.t.id); });
    const rootId = st.rippleRoot && byId[st.rippleRoot] ? st.rippleRoot : null;
    const starts = rootId ? [rootId] : nodes.filter(n => n.moc && keep(n)).map(n => n.id);
    const depth = new Map(), parent = new Map(), kids = new Map([["", starts.slice()]]);
    starts.forEach(id => { depth.set(id, rootId ? 0 : 1); parent.set(id, ""); });
    for (const q = starts.slice(); q.length;) { const x = q.shift();
      (out[x] || []).forEach(y => { if (depth.has(y)) return; depth.set(y, depth.get(x) + 1); parent.set(y, x); if (!kids.has(x)) kids.set(x, []); kids.get(x).push(y); q.push(y); }); }
    const RING = 150, leaves = new Map();
    const leafCount = id => { if (!leaves.has(id)) { const ks = kids.get(id) || []; leaves.set(id, ks.length ? ks.reduce((s, c) => s + leafCount(c), 0) : 1); } return leaves.get(id); };
    const place = (id, a0, a1) => { if (id) { const d = depth.get(id), a = (a0 + a1) / 2; pos.set(id, [d * RING * Math.cos(a), d * RING * Math.sin(a)]); }
      let a = a0; (kids.get(id) || []).slice().sort((x, y) => layoutSeed() ? topicRank(byId[x].cluster) - topicRank(byId[y].cluster) : byId[x].cluster - byId[y].cluster).forEach(c => { const span = (a1 - a0) * leafCount(c) / leafCount(id); place(c, a, a + span); a += span; }); };
    place("", -Math.PI / 2, 1.5 * Math.PI);
    const maxD = Math.max(1, ...depth.values()), beltR = (maxD + 1.4) * RING;
    const lost = nodes.filter(n => keep(n) && !n.moc && !depth.has(n.id))
      .sort((a, b) => (layoutSeed() ? topicRank(a.cluster) - topicRank(b.cluster) : a.cluster - b.cluster) || importance(b) - importance(a));   // the belt follows the seed too
    lost.forEach((n, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, lost.length), r = beltR + (i % 3) * 22; pos.set(n.id, [r * Math.cos(a), r * Math.sin(a)]); });
    return { pos, depth, parent, maxD, lost, lostSet: new Set(lost.map(n => n.id)), beltR, RING, rootId };
  }
  const ripplePath = id => { const Rp = mapCache.ripples, s = new Set([id]); if (Rp) for (let p = Rp.parent.get(id); p; p = Rp.parent.get(p)) s.add(p); return s; };
  function drawRipples(now) {
    const { R, litSet, font, k } = mapFrame(), Rp = mapCache.ripples;
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, H); if (!Rp) return;
    const c = scr(0, 0, R), rootN = Rp.rootId && byId[Rp.rootId];
    for (let d = 1; d <= Rp.maxD; d++) { const r = d * Rp.RING * k; ctx.strokeStyle = "rgba(148,197,255,.12)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI); ctx.stroke();
      haloText(plural(d, "click"), c.x + 4, c.y - r - 6, "rgba(186,214,255,.75)", "#0b1220", `600 10px ${font}`); }
    const br = Rp.beltR * k;
    if (Rp.lost.length) { ctx.setLineDash([4, 6]); ctx.strokeStyle = "rgba(248,113,113,.35)"; ctx.beginPath(); ctx.arc(c.x, c.y, br - 14 * k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      haloText(`No link reaches these ${Rp.lost.length} · only search finds them`, c.x, c.y - br - 34 * k, "#fca5a5", "#0b1220", `700 10.5px ${font}`, "center"); }
    if (!reducedMotion()) { const t = (now % 4200) / 4200; ctx.strokeStyle = `rgba(147,197,253,${0.35 * (1 - t)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, t * (Rp.maxD + 0.5) * Rp.RING * k, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.lineWidth = 0.8;
    Rp.parent.forEach((pid, id) => { const n = byId[id]; if (!mapShown(n)) return;
      const a = pid ? scr(byId[pid].x, byId[pid].y, R) : c, b = scr(n.x, n.y, R), on = litSet && litSet.has(id) && (!pid || litSet.has(pid));
      if (!pid && rootN) return;
      ctx.globalAlpha = on ? 0.9 : litSet ? 0.05 : pid ? 0.25 : 0.4; ctx.strokeStyle = on ? "#fde047" : pid ? colorOf(n.cluster) : "#93c5fd";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    ctx.globalAlpha = 1;
    if (!rootN) { ctx.fillStyle = "#93c5fd"; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 2 * Math.PI); ctx.fill(); haloText("Your maps", c.x, c.y + 18, "#dbeafe", "#0b1220", `700 11px ${font}`, "center"); }
    dots(n => !n.person && !n.ghost && (Rp.depth.has(n.id) || Rp.lostSet.has(n.id)),
      n => litSet && !litSet.has(n.id) ? "rgba(100,116,139,.3)" : Rp.lostSet.has(n.id) ? "#f87171" : n.moc ? "#93c5fd" : colorOf(n.cluster),
      n => Math.max(1.8, (n.moc || n.id === Rp.rootId ? 6 : 1.8 + 3 * importance(n)) * Math.sqrt(k)), R);
    if (st.selected && P.has(st.selected)) { const q = P.get(st.selected), d = Rp.depth.get(st.selected), chain = [];
      for (let p = st.selected; p; p = Rp.parent.get(p)) chain.unshift(byId[p].name);
      haloText(d == null ? "No link path reaches this note" : `${plural(d, "click")}: ${clip((rootN ? "" : "Maps › ") + chain.join(" › "), 90)}`, q.x, q.y - q.r - 12, "#fde68a", "#0b1220", `700 11px ${font}`, "center"); }
    noteLabels([...(rootN ? [rootN.id] : []), ...nodes.filter(n => n.moc && P.has(n.id)).map(n => n.id), ...Rp.lost.slice().sort(byImportance).map(n => n.id)], "#e2e8f0", "#0b1220", k > 1.3 ? 60 : 16);
    selRing(R);
  }

  // Heat clock: when you work on what. Two dials: days of the week and months of the year. Each ring is a topic
  // (busiest outside); a cell's heat is that topic's share of its daily-note mentions on that day or in that month.
  function clockLayout(geo) {
    const rh = DATA.rhythm || {}, cs = Object.entries(rh).map(([c, v]) => ({ c: +c, ...v, tot: v.wd.reduce((a, b) => a + b, 0) })).filter(x => x.tot >= 3 && clusterById[x.c]).sort((a, b) => a.tot - b.tot).slice(-12);
    const pos = new Map(geo), DIAL = [[-330, 0, "wd", 7], [330, 0, "mo", 12]];
    const ring = i => 70 + i * 20;
    // a topic's notes sit in its ring at its busiest weekday (half of them) and busiest month (the other half)
    cs.forEach((x, i) => { const ms = nodes.filter(n => n.cluster === x.c && !special(n) && !n.ghost);
      ms.forEach((n, j) => { const [dx, dy, key, N] = DIAL[j % 2], pk = x[key].indexOf(Math.max(...x[key])), a = (pk + 0.15 + 0.7 * ((seededHash(n.id) % 100) / 100)) / N * 2 * Math.PI - Math.PI / 2;
        pos.set(n.id, [dx + Math.cos(a) * (ring(i) + 9), dy + Math.sin(a) * (ring(i) + 9)]); }); });
    // notes of other topics aren't drawn here; parked on the dials' outer edges and the list below, they make "fit" frame the whole clock
    const rOut = ring(cs.length) + 30, edge = [[-330 - rOut, 0], [330 + rOut, 0], [-330, -rOut], [330, -rOut], [0, rOut + 30 + cs.length * 8]], inCs = new Set(cs.map(x => x.c));
    nodes.filter(n => !special(n) && !n.ghost && !inCs.has(n.cluster)).forEach((n, i) => pos.set(n.id, edge[i % edge.length]));
    return { pos, cs, DIAL, ring, rOut };
  }
  let clockSpots = [];
  function drawClock(now) {
    const { R, litSet, font, k } = mapFrame(), C = mapCache.clock; clockSpots = [];
    ctx.fillStyle = "#101418"; ctx.fillRect(0, 0, W, H); if (!C) return;
    const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    C.DIAL.forEach(([dx, dy, key, N]) => {
      const o = scr(dx, dy, R);
      C.cs.forEach((x, i) => { const v = x[key], mx = Math.max(1, ...v), r0 = (C.ring(i)) * k, r1 = (C.ring(i) + 18) * k, lit = !litSet || nodes.some(n => n.cluster === x.c && litSet.has(n.id));
        for (let s = 0; s < N; s++) { const a0 = s / N * 2 * Math.PI - Math.PI / 2, a1 = (s + 1) / N * 2 * Math.PI - Math.PI / 2, t = v[s] / mx;
          ctx.globalAlpha = lit ? 1 : 0.25; ctx.fillStyle = t ? hexMix("#1f2933", colorOf(x.c), 0.15 + 0.85 * t) : "#1a2027";
          ctx.beginPath(); ctx.arc(o.x, o.y, r1, a0 + 0.012, a1 - 0.012); ctx.arc(o.x, o.y, r0, a1 - 0.012, a0 + 0.012, true); ctx.closePath(); ctx.fill(); } });
      ctx.globalAlpha = 1;
      const rOut = (C.ring(C.cs.length) + 14) * k, labels = key === "wd" ? WD : MO;
      labels.forEach((l, s) => { const a = (s + 0.5) / N * 2 * Math.PI - Math.PI / 2; haloText(l, o.x + Math.cos(a) * rOut, o.y + Math.sin(a) * rOut, "#e2e8f0", "#101418", `700 ${Math.max(9, 11 * Math.sqrt(k))}px ${font}`, "center"); });
      const totals = new Array(N).fill(0); C.cs.forEach(x => x[key].forEach((v, s) => totals[s] += v)); const pk = totals.indexOf(Math.max(...totals));
      haloText(key === "wd" ? "WEEK" : "YEAR", o.x, o.y - 10, "#94a3b8", "#101418", `700 10px ${font}`, "center");
      haloText(`busiest: ${labels[pk]}`, o.x, o.y + 8, "#f8fafc", "#101418", `600 ${Math.max(10, 12 * Math.sqrt(k))}px ${font}`, "center");
    });
    // hands at right now; today's slice glows; a note edited while you watch sends a spark into its topic's ring
    const d = new Date(), wd = (d.getDay() + 6) % 7, dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const frac = { wd: (wd + (d.getHours() + d.getMinutes() / 60) / 24) / 7, mo: (d.getMonth() + (d.getDate() - 1 + d.getHours() / 24) / dim) / 12 }, slot = { wd, mo: d.getMonth() };
    const pulse = reducedMotion() ? 0.6 : 0.45 + 0.3 * Math.sin(now / 700);
    C.DIAL.forEach(([dx, dy, key, N]) => {
      const o = scr(dx, dy, R), r0 = (C.ring(0) - 4) * k, r1 = (C.ring(C.cs.length) + 2) * k, a = frac[key] * 2 * Math.PI - Math.PI / 2;
      const s0 = slot[key] / N * 2 * Math.PI - Math.PI / 2, s1 = (slot[key] + 1) / N * 2 * Math.PI - Math.PI / 2;
      ctx.fillStyle = `rgba(253,224,71,${0.07 * pulse})`; ctx.beginPath(); ctx.arc(o.x, o.y, r1, s0, s1); ctx.arc(o.x, o.y, r0, s1, s0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(253,224,71,${pulse})`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = "rgba(253,224,71,.25)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(o.x + Math.cos(a) * r0, o.y + Math.sin(a) * r0); ctx.lineTo(o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1); ctx.stroke();
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fde047"; ctx.beginPath(); ctx.arc(o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1, 3.5, 0, 2 * Math.PI); ctx.fill();
      const tnow = performance.now();
      liveEdits.forEach(e => { const n = byId[e.id], i = n ? C.cs.findIndex(x => x.c === n.cluster) : -1, u = (tnow - e.t) / 1600; if (i < 0 || u > 1.6) return;
        const rr = (C.ring(i) + 9) * k, f = Math.min(1, u), x = o.x + Math.cos(a) * rr * f, y = o.y + Math.sin(a) * rr * f;
        ctx.fillStyle = `rgba(254,240,138,${u > 1 ? 1.6 - u : 1})`; ctx.beginPath(); ctx.arc(x, y, u > 1 ? 3 + (u - 1) * 14 : 3, 0, 2 * Math.PI); ctx.fill(); });
    });
    // the rings, outermost (busiest) first, in two columns under the dials: topic · busiest weekday · busiest month
    const top = scr(0, C.rOut + 10, R), rows = Math.ceil(C.cs.length / 2);
    // small cards: the dials carry it, the list would crowd them
    if (!opts.compact) C.cs.slice().reverse().forEach((x, i) => { const pk = x.wd.indexOf(Math.max(...x.wd)), pm = x.mo.indexOf(Math.max(...x.mo)), col = Math.floor(i / rows), y = top.y + (i % rows) * 15, xx = top.x + (col ? 20 : -300);
      const on0 = st.clockFocus === x.c; ctx.fillStyle = colorOf(x.c); ctx.fillRect(xx, y - 4, 8, 8);
      haloText(`${clip(clusterName(x.c), 26)} · ${WD[pk]} · ${MO[pm]}`, xx + 12, y, on0 ? "#fde047" : "#e2e8f0", "#101418", `${on0 ? 700 : 500} 10px ${font}`); clockSpots.push([xx - 2, y - 7, 300, 14, x.c]); });
    if (st.clockFocus != null) {   // drill-down: the topic's weekly mentions over the timeline, this week against its usual
      const T0 = DATA.timeline || { weeks: [], clusters: {} }, ser = T0.clusters[st.clockFocus] || [], n0 = ser.length;
      if (n0) { const mx = Math.max(1, ...ser), usual = ser.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, n0 - 1), cw = Math.min(520, W - 40), ch = 96, cx0 = (W - cw) / 2, cy0 = H - ch - 44;
        ctx.fillStyle = "rgba(15,23,32,.92)"; ctx.strokeStyle = colorOf(st.clockFocus); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx0, cy0, cw, ch, 10) : ctx.rect(cx0, cy0, cw, ch); ctx.fill(); ctx.stroke();
        haloText(`${clusterName(st.clockFocus)} · daily-note mentions per week`, cx0 + 12, cy0 + 14, "#f8fafc", "#0f1720", `700 11px ${font}`);
        haloText(`this week ${ser[n0 - 1]} · usual ${usual.toFixed(1)} · ${ser[n0 - 1] > usual * 1.5 ? "busier than usual" : ser[n0 - 1] < usual * 0.5 ? "quieter than usual" : "about usual"}`, cx0 + cw - 12, cy0 + 14, "#cbd5e1", "#0f1720", `500 10px ${font}`, "right");
        const bw = (cw - 24) / n0; ser.forEach((v, i) => { const h0 = (ch - 40) * v / mx; ctx.fillStyle = i === n0 - 1 ? "#fde047" : colorOf(st.clockFocus); ctx.fillRect(cx0 + 12 + i * bw + 1, cy0 + ch - 10 - h0, bw - 2, h0); });
        ctx.strokeStyle = "rgba(226,232,240,.5)"; ctx.setLineDash([3, 3]); const uy = cy0 + ch - 10 - (ch - 40) * usual / mx; ctx.beginPath(); ctx.moveTo(cx0 + 12, uy); ctx.lineTo(cx0 + cw - 12, uy); ctx.stroke(); ctx.setLineDash([]);
        haloText(`${(T0.weeks[0] || "").slice(5)} → now · click the topic again to close`, cx0 + 12, cy0 + ch - 2, "#94a3b8", "#0f1720", `500 9px ${font}`); }
    }
    dots(n => C.cs.some(x => x.c === n.cluster) && !special(n) && !n.ghost, n => hexMix(colorOf(n.cluster), "#ffffff", 0.3), () => Math.max(1.2, 1.6 * Math.sqrt(k)), R);
    selRing(R);
  }

  // Air traffic control: open tasks on radar. Each blip is a note with open tasks (bigger = more); sectors are topics.
  // Notes drift toward the runway at the centre as they go untouched -- inside the red ring they've been holding
  // for a long time. Click a blip to see its tasks and tick them off.
  function radarLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0), pos = new Map(geo), groups = {};
    ns.forEach(n => (groups[n.cluster] = groups[n.cluster] || []).push(n));
    const keys = Object.keys(groups).map(Number).sort((a, b) => groups[b].length - groups[a].length), total = ns.length || 1, sectors = []; let a0 = -Math.PI / 2;
    keys.forEach(c => { const span = Math.max(0.25, groups[c].length / total * 2 * Math.PI * 0.92 + 0.08); sectors.push({ c, a0, a1: a0 + span, n: groups[c].length }); a0 += span; });
    const scale = 2 * Math.PI / (a0 + Math.PI / 2); sectors.forEach(s => { s.a0 = -Math.PI / 2 + (s.a0 + Math.PI / 2) * scale; s.a1 = -Math.PI / 2 + (s.a1 + Math.PI / 2) * scale; });
    // distance from the centre = how long its oldest open task has waited (first journal or standup it appeared in)
    const RMAX = 420, rOf = n => 50 + (RMAX - 50) * (1 - Math.min(1, Math.log1p(n.taskAge ?? n.age ?? 0) / Math.log1p(365)));
    sectors.forEach(s => groups[s.c].forEach(n => { const a = s.a0 + (s.a1 - s.a0) * (0.1 + 0.8 * ((hash(n.id) % 100) / 100)), r = rOf(n) + ((hash(n.id) >>> 7) % 41) - 20; pos.set(n.id, [Math.cos(a) * r, Math.sin(a) * r]); }));
    return { pos, sectors, RMAX, hold: rOf({ taskAge: 90 }), count: ns.reduce((s, n) => s + n.tasks, 0), notes: ns.length };
  }
  let radarStatic = null, radarTasks = null, radarFx = [];   // still layer { key, canvas, blips: [[id, x, y, r, holding, lit, angle]] }; open tasks per note; arrivals/landings
  function drawRadar(now) {
    const { dpr, R, litSet, k } = mapFrame(), A = mapCache.radar;
    if (!A) { ctx.fillStyle = "#020a05"; ctx.fillRect(0, 0, W, H); return; }
    const o = scr(0, 0, R), RM = A.RMAX * k, green = "34,197,94", mono = css("--vg-mono") || "monospace";
    const key = [W, H, dpr, k.toFixed(4), cam.tx.toFixed(1), cam.ty.toFixed(1), A.count, litSet ? [...litSet].length + (st.hover || "") + (st.selected || "") : "", nodes.reduce((a, n) => a + (n.tasks || 0), 0)].join("|");
    if (!radarStatic || radarStatic.key !== key || radarStatic.map !== A) {
      const cv2 = radarStatic && radarStatic.canvas.width === Math.round(W * dpr) && radarStatic.canvas.height === Math.round(H * dpr) ? radarStatic.canvas : Object.assign(document.createElement("canvas"), { width: Math.round(W * dpr), height: Math.round(H * dpr) });
      const main = ctx; ctx = cv2.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#020a05"; ctx.fillRect(0, 0, W, H);
      const sg = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, RM); sg.addColorStop(0, "rgba(6,40,20,.9)"); sg.addColorStop(1, "rgba(2,14,7,.95)"); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(o.x, o.y, RM, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = `rgba(${green},.22)`; ctx.lineWidth = 1; for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(o.x, o.y, RM * r / 4, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.strokeStyle = "rgba(239,68,68,.55)"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(o.x, o.y, A.hold * k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      A.sectors.forEach(s0 => { ctx.strokeStyle = `rgba(${green},.25)`; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(s0.a0) * RM, o.y + Math.sin(s0.a0) * RM); ctx.stroke();
        const am = (s0.a0 + s0.a1) / 2, name = `${clip(clusterById[s0.c] ? clusterName(s0.c) : "No topic", 20).toUpperCase()} · ${s0.n}`;
        const lx = o.x + Math.cos(am) * (RM + 16), ly = o.y + Math.sin(am) * (RM + 16), al = Math.cos(am) > 0.2 ? "left" : Math.cos(am) < -0.2 ? "right" : "center", f = `600 10px ${mono}`;
        ctx.font = f; const w = ctx.measureText(name).width, bx = al === "left" ? lx : al === "right" ? lx - w : lx - w / 2;
        if (freeSpot(bx, ly - 7, w, 14)) haloText(name, lx, ly, `rgb(${green})`, "#020a05", f, al); });
      const blips = [];
      ctx.font = `600 9px ${mono}`; ctx.textAlign = "left";
      for (const n of nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0 && mapShown(n)).sort((a, b) => b.tasks - a.tasks)) {   // biggest first: they get the label room
        const p = scr(n.x, n.y, R), holding = Math.hypot(p.x - o.x, p.y - o.y) < A.hold * k, lit = !litSet || litSet.has(n.id), r = Math.max(1.6, (2 + 2.2 * Math.sqrt(n.tasks)) * Math.min(Math.sqrt(k), k * 1.6) * (opts.compact ? 0.45 : 1));   // scales with the scope, so a small card isn't all blip
        blips.push([n.id, p.x, p.y, r, holding, lit, Math.atan2(p.y - o.y, p.x - o.x)]);
        const t = `${clip(n.name, 18)} · ${n.tasks}`, w = ctx.measureText(t).width;
        if ((k > 1.2 || n.tasks >= 4) && freeSpot(p.x + r + 3, p.y - 6, w, 12)) { ctx.fillStyle = holding ? "#fecaca" : "#bbf7d0"; ctx.globalAlpha = lit ? 0.85 : 0.25; ctx.fillText(t, p.x + r + 4, p.y + 3); ctx.globalAlpha = 1; }
        P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -n.tasks, r: Math.max(6, r + 3), a: lit ? 1 : 0.3 });
      }
      setSceneStat(`${plural(A.count, "open task")} · ${plural(A.notes, "note")}`);
      ctx = main; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // tasks added since the last frame fly in from the rim; notes whose tasks went down (ticked off) land at the centre
      const tasksNow = new Map(nodes.filter(n => n.tasks > 0).map(n => [n.id, n.tasks])), tnow = performance.now();
      if (radarTasks) {
        blips.forEach(b => { const was = radarTasks.get(b[0]) || 0; if (tasksNow.get(b[0]) > was) radarFx.push({ kind: "in", id: b[0], t0: tnow, x: b[1], y: b[2], r: b[3], a: b[6] }); });
        radarTasks.forEach((was, id) => { const nowT = tasksNow.get(id) || 0, old = radarStatic && radarStatic.blips.find(b => b[0] === id);
          if (nowT < was && old) radarFx.push({ kind: "land", id, t0: tnow, x: old[1], y: old[2], r: old[3], ticked: was - nowT }); });
      }
      radarTasks = tasksNow;
      radarStatic = { key, canvas: cv2, blips, map: A, P: new Map(P) };
    } else radarStatic.P.forEach((v, id) => P.set(id, v));   // hit-testing still needs every blip
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(radarStatic.canvas, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // moving parts: the sweep with its afterglow, and the blips lighting up as it passes
    const sweep = reducedMotion() ? -Math.PI / 2 : (now / 4000 * 2 * Math.PI) % (2 * Math.PI) - Math.PI / 2;
    if (ctx.createConicGradient) { const wedge = ctx.createConicGradient(sweep - 0.6, o.x, o.y);
      wedge.addColorStop(0, `rgba(${green},0)`); wedge.addColorStop(0.095, `rgba(${green},.28)`); wedge.addColorStop(0.0955, `rgba(${green},0)`); wedge.addColorStop(1, `rgba(${green},0)`);
      ctx.fillStyle = wedge; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.arc(o.x, o.y, RM, sweep - 0.6, sweep); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = `rgba(${green},.9)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(sweep) * RM, o.y + Math.sin(sweep) * RM); ctx.stroke();
    const blink = 0.55 + 0.45 * Math.abs(Math.sin(now / 300)), flying = new Set(radarFx.filter(f => f.kind === "in").map(f => f.id));
    for (const [id, x0, y0, r, holding, lit, ang] of radarStatic.blips) {
      let x = x0, y = y0;
      if (holding && !reducedMotion()) {   // a holding pattern: circle slowly at its distance, with a short trail
        const rad = Math.hypot(x0 - o.x, y0 - o.y), a = ang + now * 0.00007 + (hash(id) % 7) * 0.1;
        x = o.x + Math.cos(a) * rad; y = o.y + Math.sin(a) * rad;
        ctx.globalAlpha = lit ? 0.35 : 0.1; ctx.strokeStyle = "#f87171"; ctx.lineWidth = Math.max(1, r * 0.6); ctx.beginPath(); ctx.arc(o.x, o.y, rad, a - 0.22, a); ctx.stroke();
        const q = P.get(id); if (q) { q.x = x; q.y = y; }
      }
      if (flying.has(id)) continue;
      const since = ((sweep - Math.atan2(y - o.y, x - o.x)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      ctx.globalAlpha = (lit ? 1 : 0.25) * (holding ? blink : Math.max(0.25, 1 - since / (2 * Math.PI) * 1.4));
      ctx.fillStyle = holding ? "#f87171" : `rgb(${green})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    }
    const tfx = performance.now();
    radarFx = radarFx.filter(f => tfx - f.t0 < 2600);
    radarFx.forEach(f => {
      const u = (tfx - f.t0) / 1400, e = 1 - Math.pow(1 - Math.min(1, u), 3);
      if (f.kind === "in") {   // inbound from the rim along its bearing, then a ping
        const x = o.x + Math.cos(f.a) * (RM + (Math.hypot(f.x - o.x, f.y - o.y) - RM) * e), y = o.y + Math.sin(f.a) * (RM + (Math.hypot(f.x - o.x, f.y - o.y) - RM) * e);
        ctx.globalAlpha = 1; ctx.fillStyle = "#bbf7d0"; ctx.beginPath(); ctx.arc(x, y, f.r, 0, 2 * Math.PI); ctx.fill();
        if (u > 1) { ctx.globalAlpha = Math.max(0, 1.85 - u); ctx.strokeStyle = "#bbf7d0"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + (u - 1) * 30, 0, 2 * Math.PI); ctx.stroke(); }
      } else {                 // landing: glides into the centre and touches down
        const x = f.x + (o.x - f.x) * e, y = f.y + (o.y - f.y) * e;
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, u - 1) * 1.2); ctx.fillStyle = "#86efac"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, f.r * (1 - e * 0.6)), 0, 2 * Math.PI); ctx.fill();
        if (u > 1) { ctx.strokeStyle = "#86efac"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.x, o.y, 6 + (u - 1) * 22, 0, 2 * Math.PI); ctx.stroke();
          ctx.font = `700 11px ${mono}`; ctx.textAlign = "center"; ctx.fillStyle = "#bbf7d0"; ctx.fillText(`✓ LANDED · ${f.ticked} DONE`, o.x, o.y - 18); }
      }
    });
    ctx.globalAlpha = 1;
    selRing(R, UI.colour.selected);
  }


  // ---------------------------------------------------------------- frame loop
  let settledShown = false, lastNeural = 0, onScreen = true, lastMapAnim = 0, drawMs = 0;
  const liveEdits = [];   // notes edited while the graph is open (from live sync): {id, t}
  const tickOf = (o, now) => { const dt = Math.min(100, now - (o.last || now)); o.last = now; return reducedMotion() ? 0 : dt; };
  const ANIM_MAPS = { ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, d.fps || 30])), radar: 60, ships: 30, weather: 30, sky: 30, garden: 30, foodweb: 30, alchemy: 30, ripples: 30, subway: 30, city: 30, clock: 30, topo: 30, realm: 30, palace: 30, rings: 20 };   // divisors of 60 Hz: an even cadence, no judder
  // An embed scrolled out of view (or a hidden pane) costs nothing: the loop stops and restarts when it's back
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(es => {
    onScreen = es[es.length - 1].isIntersecting; if (onScreen) { dirty = true; kick(); }
  }) : null;
  function frame(now) {
    cssCache.clear();   // theme can change between frames; within one frame it can't
    raf = 0;
    if (destroyed || !onScreen) return;
    let more = false;
    if (morph) {   // layout transition (2D/3D <-> neural)
      const u = Math.min(1, (now - morph.t0) / morph.ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      for (const n of nodes) {
        const a = morph.from.get(n.id), b = morph.to.get(n.id);
        n.x = a[0] + (b[0] - a[0]) * e; n.y = a[1] + (b[1] - a[1]) * e; n.z = a[2] + (b[2] - a[2]) * e;
      }
      if (u >= 1) { morph = null; if (!neural()) alpha = Math.max(alpha, 0.04); }
      more = true; dirty = true;
    }
    if (replay) { stepReplay(now); more = true; dirty = true; }
    if (isCosmos() && !morph) alpha = Math.max(alpha, 0.1);   // orbits keep moving
    if (alpha > 0.005 && !neural() && !mapView() && !(isCosmos() && st.paused)) {
      tick(); more = true; dirty = true;
      if (alpha <= 0.005) { persistSoon(); renderStatus(); }   // settled: remember layout
      else if (settledShown) renderStatus();
    }
    if (cam.spin && st.three) {   // orbit momentum after a flick
      cam.yaw += cam.spin.y; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + cam.spin.p));
      cam.spin.y *= 0.9; cam.spin.p *= 0.9; dirty = true; more = true;
      if (Math.abs(cam.spin.y) + Math.abs(cam.spin.p) < 0.0005) cam.spin = null;
    }
    if (tween) {
      const u = Math.min(1, (now - tween.t0) / tween.ms), e = 1 - Math.pow(1 - u, 3);
      for (const key of TWEEN_KEYS) cam[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * e;
      if (!(cam.k > 0.03)) cam.k = 0.03;   // a bad target (e.g. fitting an empty set) must never flip the view
      if (u >= 1) tween = null; else more = true;
      dirty = true;
    }
    if (isCosmos()) { dirty = true; more = true; if (st.ship) shipStep(); }
    // Animated maps (radar sweep, ships, wind, twinkling, swaying plants, pulses) redrew only on input, so they
    // jumped. Like neural: a steady budget while visible, full rate while moving, 3 fps when Obsidian isn't focused.
    const animFps = mapView() && !reducedMotion() ? ANIM_MAPS[st.view] || 0 : 0;
    if (animFps) {
      const busy = morph || tween || drag, fps = busy ? 0 : !document.hasFocus() ? 3 : opts.compact ? Math.min(15, animFps) : animFps;
      if (!fps || now - lastMapAnim >= 1000 / fps - 2) { lastMapAnim = now; dirty = true; }
      more = true;
    }
    if (neural()) {   // living view: pulses + slow drift while idle
      // Frame budget: full rate while you're moving it, otherwise 30 fps (15 in small panes and the
      // home-screen card), and 3 fps while Obsidian isn't the focused window.
      const busy = morph || tween || drag || cam.spin;
      const fps = busy ? 0 : !document.hasFocus() ? 3 : opts.compact ? 15 : 30;
      const dt = Math.min(250, now - (lastNeural || now));
      if (!fps || dt >= 1000 / fps) {
        if (!opts.compact && !drag && !tween && !reducedMotion() && now - lastInteract > 3500) cam.yaw += 0.0016 * dt / 16.7;   // not in small panes: it drifts a few notes out of view
        lastNeural = now; dirty = true;
      }
      more = true;
      if (st.selected && dirty && (now | 0) % 6 === 0) renderHud();
    }
    if (dirty && W) { const t0 = performance.now(); draw(now); drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1; dirty = false; }
    if (bursts.length && W) { if (drawBursts(now)) { more = true; dirty = true; } }
    if (refitOnSettle && alpha < 0.05 && W && !morph) { const p = refitOnSettle; refitOnSettle = null; if (!cam.userMoved) { fit(p, 400); more = true; } }
    if (!fitted && (alpha < 0.05 || neural() || mapView()) && W && !morph) { fitted = true; fit(neural() ? n => !special(n) : mapView() ? mapFitPred() : null, 600); more = true; }
    if (more) kick();
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
  const ro = new ResizeObserver(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = W + "px"; cv.style.height = H + "px";
    if (fitted && !cam.userMoved) fit(lastFit, 0);   // keep the framing until the user pans/zooms
    dirty = true; kick();
  });
  ro.observe(wrap);
  if (io && !opts.alwaysOn) io.observe(wrap);   // alwaysOn: the plugin's off-screen self-test still has to draw
  if (opts.embed) cv.style.touchAction = "pan-y pinch-zoom";   // one finger scrolls the page around the embed
  const narrow = () => root.clientWidth < 760;
  // a lens sits beside the view on a wide pane (vault_graph_view.css, same width), so choosing a row shows it there; narrower, the lens covers the view and closes first
  const lensBeside = () => root.clientWidth >= 1100;
  // in a narrow pane the side panel is a drawer over the toolbar: anything that opens a panel or acts on the graph closes it
  const closeDrawer = () => { if (narrow()) root.classList.remove("vg-side-open"); };

  // ---------------------------------------------------------------- pointer (mouse, pen, touch)
  // the notes a pointer can reach: what's drawn (map views also draw unlinked notes, through mapShown)
  const pickable = () => mapView() ? nodes.filter(mapShown) : active;
  const hit = (mx, my) => {
    // closest centre relative to size wins; depth only breaks near-ties (a tiny node in front
    // of a big one must not steal clicks aimed at the big one's centre). Touch gets a bigger target.
    const slop = MOBILE ? 12 : 4;
    let best = null, bestScore = Infinity;
    for (const n of pickable()) {
      const p = P.get(n.id); if (!p || p.r == null || p.a < 0.15) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d > p.r + slop) continue;
      const score = d / (p.r + slop) + p.depth * 1e-5;
      if (score < bestScore) { best = n; bestScore = score; }
    }
    return best;
  };
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Move a node with the pointer; its neighbourhood follows through the springs. In 3D the screen delta
  // is mapped back through the camera rotation, so the node moves in the plane facing you.
  function dragNode(n, dx, dy) {
    const p = P.get(n.id); if (!p) return;
    const X = dx / p.s, Y = dy / p.s;
    let wx = X, wy = Y, wz = 0;
    if (st.three) {   // inverse of project(): un-pitch, then un-yaw (screen-plane delta has Z = 0)
      const [cy, sy, cp, sp] = rot(), z1 = -Y * sp;
      wy = Y * cp; wx = X * cy - z1 * sy; wz = X * sy + z1 * cy;
    } else if (cam.turn) { wx = Y; wy = -X; }   // undo proj()'s quarter turn
    const base = n.pin || [n.x, n.y, n.z];
    n.pin = [base[0] + wx, base[1] + wy, base[2] + wz];
    alpha = Math.max(alpha, 0.25); kick();
  }
  let drag = null, pinch = null, lastTap = null, pressTimer = 0;
  const pointers = new Map();
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture(e.pointerId); root.focus({ preventScroll: true }); closeMenu();
    lastInteract = performance.now();
    closeDrawer();   // tapping the graph closes the drawer
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 2) {   // pinch / two-finger pan
      clearTimeout(pressTimer); drag = null;
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx0: cam.tx, ty0: cam.ty };
      tween = null; return;
    }
    if (isCosmos() && st.placing) { placeBody(st.placing, x, y); return; }
    // a scene that takes drags itself (painting in Falling sand): press(phase, x, y) returns true to keep the pointer
    if (SCENES[st.view] && SCENES[st.view].press && !hit(x, y) && SCENES[st.view].press("down", x, y)) { pressing = true; return; }
    const body = isCosmos() ? bodyHit(x, y) : null;
    const n = body ? null : hit(x, y);
    const lasso = st.lasso || e.altKey;
    drag = { x, y, x0: x, y0: y, moved: false, orbit: st.three && !e.shiftKey, node: lasso ? null : n, body, lasso, vy: 0, vp: 0, touch: e.pointerType === "touch" };
    tween = null; cam.spin = null;
    if (e.pointerType === "touch" && n && !lasso) {   // long-press selects (and buzzes)
      pressTimer = setTimeout(() => { if (drag && !drag.moved) { drag.longPress = true; select(n.id); if (navigator.vibrate) navigator.vibrate(12); } }, 520);
    }
  });
  cv.addEventListener("pointermove", e => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pressing && SCENES[st.view] && SCENES[st.view].press) { SCENES[st.view].press("move", x, y); dirty = true; kick(); return; }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = Math.min(12, Math.max(0.03, pinch.k0 * d / pinch.d0)), r = k / pinch.k0;
      cam.k = k; cam.tx = (pinch.mx - W / 2) - ((pinch.mx - W / 2) - pinch.tx0) * r + (mx - pinch.mx); cam.ty = (pinch.my - H / 2) - ((pinch.my - H / 2) - pinch.ty0) * r + (my - pinch.my);
      cam.userMoved = true; dirty = true; kick(); return;
    }
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (!drag.moved && Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > (drag.touch ? 8 : 3)) { drag.moved = true; clearTimeout(pressTimer); root.classList.add("is-dragging"); }
      if (drag.moved) {
        lastInteract = performance.now();
        if (drag.body) { drag.body.x += dx / cam.k; drag.body.y += dy / cam.k; drag.fvx = dx / cam.k; drag.fvy = dy / cam.k; persistSoon(); }
        else if (drag.lasso) { drawLassoBox(drag.x0, drag.y0, x, y); }
        else if (drag.node && !neural() && !mapView()) dragNode(drag.node, dx, dy);
        else if (drag.orbit) {
          drag.vy = dx * 0.006; drag.vp = dy * 0.006;
          cam.yaw += drag.vy; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + drag.vp));
        } else { cam.tx += dx; cam.ty += dy; st.follow = null; }
        if (!drag.node) cam.userMoved = true;
        drag.x = x; drag.y = y; tip.classList.remove("is-on"); dirty = true; kick();
      }
      return;
    }
    if (e.pointerType === "touch") return;   // no hover on touch
    const n = hit(x, y), id = n ? n.id : null;
    if (id !== st.hover) {
      st.hover = id; dirty = true; kick();
      cv.style.cursor = n ? "pointer" : (st.three ? "grab" : "default");
      if (n && opts.onHoverNote && !special(n)) opts.onHoverNote(n.id, e);
    }
    if (n) {
      const sub = n.moc ? `Map of content · ${n.outlinks} notes in ${esc(clusterName(n.cluster))}` : n.ghost ? `Not written yet · linked from ${plural(n.from.length, "note")}` : n.person ? `Person · ${plural(n.outlinks, "linked note")}`
        : `${plural(nb[n.id].size, "link")} · ${esc(clusterName(n.cluster))}${n.recent ? ` · ${n.recent} recent` : ""}${n.tasks ? ` · ${plural(n.tasks, "open task")}` : ""}`;
      tip.innerHTML = `<div class="vg-tip-title"><span class="vg-dot" style="background:${fillOf(n)}"></span>${esc(n.name)}</div>` +
        `<div class="vg-muted">${esc(n.folder || "/")}</div><div class="vg-tip-meta">${sub}</div>`;
      tip.classList.add("is-on");
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (x + 14 + tw > W ? Math.max(4, x - 14 - tw) : x + 14) + "px";
      tip.style.top = Math.min(H - th - 4, y + 12) + "px";
    } else if (lobeAt(x, y) != null) {
      const c = lobeAt(x, y), g = lobeStats[c] || { notes: 0, fresh: 0, stale: 0, tasks: 0 };
      const map = mocOf[c];
      tip.innerHTML = `<div class="vg-tip-title"><span class="vg-dot" style="background:${neonOf(c)}"></span>${esc(clusterName(c))}</div>` +
        `<div class="vg-tip-meta">${plural(g.notes, "note")} · ${g.fresh} edited this week · ${plural(g.stale, "stale note")} (${Q.stale_days}+ days)` +
        `${g.tasks ? ` · ${plural(g.tasks, "open task")}` : ""}</div><div class="vg-muted">${map ? `Map: ${esc(map.title)}` : "No map for this topic yet"} · click to focus</div>`;
      tip.classList.add("is-on"); cv.style.cursor = "pointer";
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (x + 14 + tw > W ? Math.max(4, x - 14 - tw) : x + 14) + "px";
      tip.style.top = Math.min(H - th - 4, y + 12) + "px";
    } else { tip.classList.remove("is-on"); cv.style.cursor = st.three ? "grab" : "default"; }
  });
  const lobeAt = (x, y) => { if (!neural()) return null; const s = lobeSpots.find(([lx, ly, w, h]) => x >= lx && x <= lx + w && y >= ly && y <= ly + h); return s ? s[4] : null; };
  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return true; }
    return false;
  };
  cv.addEventListener("pointerleave", e => { tip.classList.remove("is-on"); if (st.hover) { st.hover = null; dirty = true; kick(); } });
  cv.addEventListener("pointercancel", e => { endPointer(e); drag = null; clearTimeout(pressTimer); root.classList.remove("is-dragging"); });
  cv.addEventListener("pointerup", e => {
    clearTimeout(pressTimer);
    if (pressing) { pressing = false; if (SCENES[st.view] && SCENES[st.view].press) SCENES[st.view].press("up", ...local(e)); endPointer(e); drag = null; return; }
    if (endPointer(e)) return;
    const d = drag; drag = null; root.classList.remove("is-dragging");
    if (d && d.lasso) { finishLasso(d, ...local(e)); return; }
    if (d && d.body) { if (!d.moved) selectBody(d.body.id); else releaseBody(d.body, d.fvx || 0, d.fvy || 0); return; }
    if (d && d.node && d.node.pin) { d.node.pin = null; alpha = Math.max(alpha, 0.15); kick(); }   // let go: it springs back into place
    if (d && d.moved && d.orbit && !d.node && Math.abs(d.vy) + Math.abs(d.vp) > 0.004) { cam.spin = { y: d.vy, p: d.vp }; kick(); }
    if (!d || d.moved || d.longPress) return;
    const [x, y] = local(e), n = hit(x, y);
    if (d.touch) {   // double-tap focuses (dblclick doesn't fire reliably for touch)
      const now = performance.now();
      if (n && lastTap && lastTap.id === n.id && now - lastTap.t < 320) { lastTap = null; enterFocus(n.id); return; }
      lastTap = n ? { id: n.id, t: now } : null;
    }
    if (!n) { const sp = spots.slice().reverse().find(([sx, sy, w, h]) => x >= sx && x <= sx + w && y >= sy && y <= sy + h); if (sp) { sp[4](x, y); dirty = true; kick(); return; } }
    if (!n && st.view === "clock") { const cs = clockSpots.find(([cx, cy, w, h]) => x >= cx && x <= cx + w && y >= cy && y <= cy + h); if (cs) { st.clockFocus = st.clockFocus === cs[4] ? null : cs[4]; dirty = true; kick(); return; } }
    if (!n && isCosmos()) {
      const moon = moonSpots.find(([mx, my]) => Math.hypot(mx - x, my - y) < 6);
      if (moon) { select(moon[2]); const tb = $(".vg-inspector .vg-tasksbox"); if (tb) renderTasks(moon[2], tb); return; }
      const con = constSpots.find(([cx, cy, w, h]) => x >= cx && x <= cx + w && y >= cy && y <= cy + h);
      if (con) { applySaved(con[4]); return; }
      const w = wormholeHit(x, y); if (w) { select(w.s.id); return; }
      if (st.ship) { warpTo(x, y); return; }
    }
    if (!n && lobeAt(x, y) != null) { focusClusters([lobeAt(x, y)]); return; }
    if (!n) { clearHighlight(); clearMulti(); select(null); if (st.body) { st.body = null; $(".vg-inspector").hidden = true; root.classList.remove("has-inspector"); } return; }
    if ((e.ctrlKey || e.metaKey) && opts.openNote && !special(n)) { opts.openNote(n.id, true); return; }
    if (e.shiftKey && st.selected && st.selected !== n.id) { findPath(st.selected, n.id); return; }
    if (opts.compact && opts.openNote && !special(n)) { opts.openNote(n.id, false); return; }   // side pane: click opens
    select(n.id);
  });
  cv.addEventListener("dblclick", e => {
    const [x, y] = local(e), n = hit(x, y);
    if (n && !special(n) && st.focus !== n.id) enterFocus(n.id);
    else if (!n) fit(st.focusDist ? m => st.focusDist.has(m.id) : lastFit, 400);   // empty space: recenter
  });   // touch already focused on double-tap
  cv.addEventListener("wheel", e => {
    if (opts.embed && !e.ctrlKey && !e.metaKey) return;   // let the note scroll
    e.preventDefault(); tween = null; lastInteract = performance.now();
    const [mx, my] = local(e), k = Math.min(12, Math.max(0.03, cam.k * Math.exp(-e.deltaY * 0.0015))), r = k / cam.k;
    cam.tx = (mx - W / 2) - ((mx - W / 2) - cam.tx) * r; cam.ty = (my - H / 2) - ((my - H / 2) - cam.ty) * r;
    cam.k = k; cam.userMoved = true; dirty = true; kick();
  }, { passive: false });

  // ---------------------------------------------------------------- lasso + multi-select
  const lassoEl = $(".vg-lasso");
  function drawLassoBox(x0, y0, x1, y1) {
    lassoEl.hidden = false;
    Object.assign(lassoEl.style, { left: Math.min(x0, x1) + "px", top: Math.min(y0, y1) + "px", width: Math.abs(x1 - x0) + "px", height: Math.abs(y1 - y0) + "px" });
  }
  function finishLasso(d, x, y) {
    lassoEl.hidden = true;
    const [x0, x1] = [Math.min(d.x0, x), Math.max(d.x0, x)], [y0, y1] = [Math.min(d.y0, y), Math.max(d.y0, y)];
    const ids = pickable().filter(n => { const p = P.get(n.id); return p && p.a > 0.2 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !n.ghost; }).map(n => n.id);
    setLassoMode(false);
    if (!ids.length) return;
    st.multi = new Set(ids); select(null); showMulti(); dirty = true; kick();
  }
  function setLassoMode(on) { st.lasso = on; $(".vg-lassobtn").setAttribute("aria-pressed", on); syncToolsBtn(); root.classList.toggle("is-lasso", on); if (on) toast("Drag a box around the notes to select"); }
  $(".vg-lassobtn").onclick = () => setLassoMode(!st.lasso);
  function clearMulti() { if (!st.multi) return; st.multi = null; const box = $(".vg-inspector"); box.hidden = true; root.classList.remove("has-inspector"); dirty = true; kick(); }
  function showMulti() {
    $(".vg-inspector").dataset.id = "";   // not a single note: the next note shown starts at the top
    const ids = [...st.multi], box = $(".vg-inspector"), groups = {};
    ids.forEach(id => (groups[byId[id].cluster] = groups[byId[id].cluster] || []).push(id));
    box.hidden = false; root.classList.add("has-inspector");
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:${css("--vg-accent")}">Selection</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${plural(ids.length, "note")} selected</h2>
      <div class="vg-ins-actions vg-wrap">
        <button class="vg-btn" data-act="copy">${icon("copy", 14)} Copy links</button>
        ${opts.writeNote ? `<button class="vg-btn" data-act="hub">${icon("hub", 14)} Hub note</button><button class="vg-btn" data-act="map">${icon("file", 14)} Map note</button>` : ""}
      </div>
      <div class="vg-ins-sec">${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, ms]) =>
        `<details class="vg-group" open><summary><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-count">${ms.length}</span></summary>${ms.map(m => noteRow(m)).join("")}</details>`).join("")}</div>`;
    box.querySelector(".vg-ins-close").onclick = clearMulti;
    box.querySelector('[data-act="copy"]').onclick = () => copy(ids.map(id => mdLink(id)).join("\n"), `Copied ${plural(ids.length, "link")}`);
    const hub = box.querySelector('[data-act="hub"]'); if (hub) hub.onclick = () => writeSelectionHub(ids);
    const map = box.querySelector('[data-act="map"]'); if (map) map.onclick = () => writeMap(ids, "Selection");
    wire(box); wireSheet(box);
  }

  // ---------------------------------------------------------------- keyboard
  root.addEventListener("keydown", e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") {
      if (tourIdx >= 0) endTour();
      else if (closeTools()) { $(".vg-toolsbtn").focus(); }
      else if (!$(".vg-palette").hidden) { closePalette(); }
      else if (!$(".vg-picker").hidden) closeMenu();
      else if (!$(".vg-lens").hidden) closeLens();
      else if (typing) { e.target.blur(); return; }
      else if (st.lasso) setLassoMode(false);
      else if (st.placing) { st.placing = null; root.classList.remove("is-placing"); $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", "false")); dirty = true; }
      else if (st.body) { st.body = null; $(".vg-inspector").hidden = true; root.classList.remove("has-inspector"); dirty = true; }
      else if (st.path) clearPath();
      else if (st.focus && !st.quietFocus) exitFocus();
      else if (st.multi) clearMulti();
      else if (st.selected) select(null);
      else if (st.highlight) clearHighlight();
      else if (root.classList.contains("vg-side-open")) root.classList.remove("vg-side-open");
      else return;
      e.stopPropagation(); return;
    }
    if (typing) return;
    lastInteract = performance.now();
    const k = KEYS.find(x => x.run && (x.match ? x.match(e) : !e.ctrlKey && !e.metaKey && !e.altKey && x.keys[0].toLowerCase() === e.key.toLowerCase()) && (!x.when || x.when()));
    if (k) { if (k.prevent) e.preventDefault(); k.run(e); }
  });
  // Every keyboard shortcut, once: the handler above runs them and the shortcuts sheet (?) lists them, so the two can't
  // disagree. keys[0] is the key matched unless match() says otherwise; an entry without run() is only listed.
  const KEYS = [
    { keys: ["W A S D", "Q E"], label: "Fly the ship (Cosmos, ship on)", prevent: true, match: e => st.ship && isCosmos() && /^(w|a|s|d|q|e|arrowup|arrowdown|arrowleft|arrowright)$/.test(e.key.toLowerCase()),
      run: e => { ship.keys.add(e.key.toLowerCase()); kick(); } },
    { keys: ["/", "Ctrl K"], label: "Search notes, clusters and inside notes", prevent: true, run: () => openPalette() },
    { keys: ["Esc"], label: "Close what's open, or step back one level" },
    { keys: ["Enter"], label: "Open the selected note (Ctrl+Enter: in a new tab)", match: e => e.key === "Enter", when: () => st.selected && opts.openNote && !special(byId[st.selected]), run: e => opts.openNote(st.selected, e.ctrlKey || e.metaKey) },
    { keys: ["F"], label: "Focus on the selected note and its neighbours", when: () => st.selected, run: () => enterFocus(st.selected) },
    { keys: ["Arrows"], label: "Move to the linked note in that direction (nothing selected: pan)", prevent: true, match: e => e.key.startsWith("Arrow") && !(st.ship && isCosmos()), run: e => walk(e.key) },
    { keys: ["Tab", "Shift Tab"], label: "Next or previous linked note", prevent: true, match: e => e.key === "Tab", when: () => st.selected, run: e => cycleNeighbour(e.shiftKey ? -1 : 1) },
    { keys: ["+", "−"], label: "Zoom in or out", match: e => "+=-_".includes(e.key) && e.key.length === 1, run: e => zoomBy("+=".includes(e.key) ? 1.25 : 0.8) },
    { keys: ["0"], label: "Fit everything on screen", run: () => fit(neural() ? n => !special(n) : null) },
    { keys: ["M"], label: "Choose a view", run: () => openPicker("views") },
    { keys: ["3"], label: "Switch 2D and 3D (in a 3D scene: flat, tilt, iso)", run: () => isoAngle() ? cycleAngle() : setView(st.view === "3d" ? "2d" : "3d") },
    { keys: ["N"], label: "Neural view", run: () => setView(neural() ? "3d" : "neural") },
    { keys: ["C"], label: "Cosmos view", run: () => setView(isCosmos() ? "2d" : "cosmos") },
    { keys: ["R"], label: "Replay how the vault grew", run: () => toggleReplay() },
    { keys: ["T"], label: "Time slider", run: () => toggleTimebar($(".vg-timebar").hidden) },
    { keys: ["G"], label: "Missions", when: () => !opts.compact, run: () => setMissionsShown(!root.classList.contains("show-missions"), true) },
    { keys: ["Space"], label: "Pause or play (Cosmos)", prevent: true, match: e => e.key === " ", when: () => isCosmos(), run: () => setPaused(!st.paused) },
    { keys: ["?"], label: "This list", match: e => e.key === "?", run: () => showKeys() },
  ];
  function showKeys() {
    const kbd = k => k.split(" ").map(x => `<kbd>${esc(x)}</kbd>`).join(" ");
    const shown = [...KEYS.filter(x => !x.match || !/ship/.test(x.label)), ...KEYS.filter(x => x.match && /ship/.test(x.label))];   // the ship's keys match first, read last
    confirmBox("Keyboard shortcuts", `<table class="vg-keys">${shown.map(x => `<tr><td>${x.keys.map(kbd).join(" or ")}</td><td>${esc(x.label)}</td></tr>`).join("")}</table>`, "Done", null, { only: true });
  }
  // Walk the graph from the keyboard: an arrow moves to the linked note lying most in that direction on
  // screen; with nothing selected, arrows pan.
  const ARROW = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function walk(key) {
    const [dx, dy] = ARROW[key];
    if (!st.selected) { cam.tx -= dx * 80; cam.ty -= dy * 80; cam.userMoved = true; dirty = true; kick(); return; }
    project();
    const a = P.get(st.selected); if (!a) return;
    let best = null, bestScore = Infinity;
    neighboursOf(st.selected).forEach(id => {
      const b = P.get(id); if (!b) return;
      const vx = b.x - a.x, vy = b.y - a.y, d = Math.hypot(vx, vy) || 1, cos = (vx * dx + vy * dy) / d;
      if (cos < 0.35) return;   // within ~70 degrees of the arrow
      const score = d * (2 - cos);
      if (score < bestScore) { best = id; bestScore = score; }
    });
    if (best) goTo(best); else toast("No linked note that way");
  }
  const neighboursOf = id => [...nb[id], ...(peopleOf[id] || [])].filter(m => byId[m] && active.includes(byId[m]))
    .sort((x, y) => byId[y].bc - byId[x].bc);
  let cycleFrom = null, cycleIdx = -1;
  function cycleNeighbour(dir) {
    if (cycleFrom === null || (st.selected !== cycleFrom && !nb[cycleFrom].has(st.selected))) { cycleFrom = st.selected; cycleIdx = -1; }
    const list = neighboursOf(cycleFrom); if (!list.length) return;
    cycleIdx = (cycleIdx + dir + list.length) % list.length;
    goTo(list[cycleIdx], true);
  }
  function goTo(id, keepCycle) {
    if (!keepCycle) cycleFrom = null;
    select(id);
    const p = P.get(id);
    if (!p || p.x < 40 || p.y < 60 || p.x > W - 40 || p.y > H - 40) centreOn(id, cam.k);   // keep it on screen
  }

  // ---------------------------------------------------------------- focus mode
  function enterFocus(id, depth, quiet) {
    if (!st.focus && !neural()) keepLayout();
    st.focus = id; st.focusDepth = depth || st.focusDepth; st.quietFocus = !!quiet;
    const dist = new Map([[id, 0]]), queue = [id];
    while (queue.length) {
      const v = queue.shift(), d = dist.get(v);
      if (d >= st.focusDepth) continue;
      nb[v].forEach(m => { if (!dist.has(m) && baseVisible(byId[m])) { dist.set(m, d + 1); queue.push(m); } });
    }
    st.focusDist = dist;
    const n = byId[id];
    if (!neural()) { cam.cx = n.x; cam.cy = n.y; cam.cz = n.z; }
    fitted = true; rebuild(true); if (!quiet) select(id); else { st.selected = id; dirty = true; }
    setTimeout(() => fit(m => dist.has(m.id), quiet ? 300 : 500), quiet ? 250 : 400);
    // the reheated layout keeps moving after that first fit and could carry the notes out of a small pane
    refitOnSettle = m => st.focusDist && st.focusDist.has(m.id);
    if (quiet) return;
    const bar = $(".vg-focusbar:not(.vg-pathbar)");
    bar.hidden = false;
    bar.innerHTML = `${icon("target", 14)}<span class="vg-fb-text">Focus · <b>${esc(n.name)}</b> <span class="vg-muted">${plural(dist.size - 1, "note")}</span></span>
      <label class="vg-fb-depth"><span class="vg-muted">Depth</span><input type="range" min="1" max="4" value="${st.focusDepth}" class="vg-range vg-fdepth" aria-label="Focus depth"><b>${st.focusDepth}</b></label>
      <button class="vg-btn vg-btn-sm vg-fexit">Exit <kbd>Esc</kbd></button>`;
    bar.querySelector(".vg-fdepth").oninput = e => enterFocus(id, +e.target.value);
    bar.querySelector(".vg-fexit").onclick = exitFocus;
    root.focus({ preventScroll: true });
  }
  function exitFocus() {
    st.focus = null; st.focusDist = null; st.quietFocus = false; $(".vg-focusbar:not(.vg-pathbar)").hidden = true;
    if (!neural()) {
      cam.cx = cam.cy = cam.cz = 0;
      if (layoutClean() && applyLayout()) { rebuild(false); alpha = 0.05; } else rebuild(true);   // back to the familiar map
    } else rebuild(false);
    setTimeout(() => fit(null, 500), 400);
  }



  // ---------------------------------------------------------------- first-run tour
  // one short sentence per step, each about the control it points at
  const TOUR = [
    { sel: ".vg-pickbtn", title: "Views and lenses", text: "Draw the vault another way (2D, 3D, City, Cosmos…) or open a lens: a focused list with buttons that fix what it finds. Press M." },
    { sel: ".vg-searchbtn", title: "Search", text: "Jump to any note, topic or saved view. Press / or Ctrl K." },
    { sel: ".vg-reviewbtn", title: "Today's review", text: "One small improvement at a time: a link to add, a note to put on its map, a note to write." },
    { sel: ".vg-toggle", title: "Insights", text: "What changed since the last analysis, your topics and the gaps between them. Tap a count to see those notes." },
    { sel: ".vg-cv", ring: false, title: "Tap a note", text: "Its panel lists what it needs, each with the button that fixes it." },
  ];
  let tourIdx = -1, tourSeen = false;
  function startTour() { tourIdx = 0; showTour(); }
  function endTour() { tourIdx = -1; const o = root.querySelector(".vg-tour"); if (o) o.remove(); tourSeen = true; persistSoon(); }
  function showTour() {
    let o = root.querySelector(".vg-tour"); if (!o) { o = document.createElement("div"); o.className = "vg-tour"; root.appendChild(o); }
    while (tourIdx < TOUR.length) { const el = $(TOUR[tourIdx].sel); if (el && el.offsetParent !== null) break; tourIdx++; }   // skip steps hidden at this width
    if (tourIdx >= TOUR.length) { endTour(); return; }
    const step = TOUR[tourIdx], el = $(step.sel), r = el.getBoundingClientRect(), R = root.getBoundingClientRect();
    const x = r.left - R.left, y = r.top - R.top, below = y + r.height + 170 < R.height;
    // a step about the whole canvas (ring: false) gets no ring and a card in the middle
    const card = step.ring === false ? `left:${Math.max(10, (R.width - 290) / 2)}px;top:${Math.max(60, R.height / 2 - 80)}px` : `left:${Math.max(10, Math.min(R.width - 300, x))}px;${below ? `top:${y + r.height + 12}px` : `bottom:${R.height - y + 12}px`}`;
    o.innerHTML = `${step.ring === false ? "" : `<div class="vg-tour-ring" style="left:${x - 4}px;top:${y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>`}
      <div class="vg-tour-card" style="${card}">
        <span class="vg-muted">${tourIdx + 1} / ${TOUR.length}</span><b>${esc(step.title)}</b><p>${esc(step.text)}</p>
        <div class="vg-confirm-acts"><button class="vg-btn vg-btn-ghost" data-t="skip">Skip</button><button class="vg-btn vg-btn-primary" data-t="next">${tourIdx === TOUR.length - 1 ? "Done" : "Next"}</button></div></div>`;
    o.querySelector('[data-t="skip"]').onclick = endTour;
    o.querySelector('[data-t="next"]').onclick = () => { tourIdx++; showTour(); };
    o.querySelector('[data-t="next"]').focus();
  }

  // ---------------------------------------------------------------- confirm dialog + discovery log
  // Every action that writes to the vault asks here first (an in-app dialog: works the same on phones).
  function confirmBox(title, body, okLabel, input, o = {}) {   // o.only: one button (a sheet to read, nothing to cancel)
    return new Promise(resolve => {
      const box = document.createElement("div"); box.className = "vg-confirm";
      box.innerHTML = `<div class="vg-confirm-box" role="dialog" aria-modal="true"><b class="vg-confirm-title">${esc(title)}</b>
        <div class="vg-confirm-body">${body}</div>${input ? `<textarea class="vg-input vg-confirm-input" rows="3" placeholder="${esc(input)}"></textarea>` : ""}
        <div class="vg-confirm-acts">${o.only ? "" : `<button class="vg-btn vg-btn-ghost" data-c="no">Cancel</button>`}<button class="vg-btn vg-btn-primary" data-c="ok">${esc(okLabel || "Do it")}</button></div></div>`;
      root.appendChild(box);
      const done = v => { box.remove(); root.focus({ preventScroll: true }); resolve(v); };
      if (!o.only) box.querySelector('[data-c="no"]').onclick = () => done(false);
      box.querySelector('[data-c="ok"]').onclick = () => { const ta = box.querySelector("textarea"); if (ta && !ta.value.trim()) { ta.focus(); return; } done(ta ? ta.value.trim() : true); };
      box.onclick = e => { if (e.target === box) done(false); };
      box.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
      (box.querySelector("textarea") || box.querySelector('[data-c="ok"]')).focus({ preventScroll: true });   // a long body opens at its top
    });
  }
  // formBox(title, rows, okLabel) -> the values by key, or null if cancelled. rows: [[field, ...], ...], each row side by
  // side; a field: { k, label, type: "text" | "select" | "color", options, value, required, hint }. Same dialog as confirmBox.
  function formBox(title, rows, okLabel) {
    return new Promise(resolve => {
      const ctl = f => f.type === "select" ? `<select class="vg-input" data-k="${f.k}">${f.options.map(o => { const [v, t] = [].concat(o); return `<option value="${esc(v)}"${v === f.value ? " selected" : ""}>${esc(t || v)}</option>`; }).join("")}</select>`
        : `<input class="vg-input" data-k="${f.k}" type="${f.type === "color" ? "color" : "text"}" value="${esc(f.value || "")}"${f.hint ? ` placeholder="${esc(f.hint)}"` : ""}${f.required ? " required" : ""}>`;
      const box = document.createElement("div"); box.className = "vg-confirm";
      box.innerHTML = `<div class="vg-confirm-box vg-form" role="dialog" aria-modal="true"><b class="vg-confirm-title">${esc(title)}</b>
        ${rows.map(r => `<div class="vg-form-row">${r.map(f => `<label class="vg-form-f${f.type === "color" ? " is-colour" : ""}"><span>${esc(f.label)}</span>${ctl(f)}</label>`).join("")}</div>`).join("")}
        <div class="vg-form-err" hidden></div>
        <div class="vg-confirm-acts"><button class="vg-btn vg-btn-ghost" data-c="no">Cancel</button><button class="vg-btn vg-btn-primary" data-c="ok">${esc(okLabel || "Save")}</button></div></div>`;
      root.appendChild(box);
      const done = v => { box.remove(); root.focus({ preventScroll: true }); resolve(v); };
      box.querySelector('[data-c="no"]').onclick = () => done(null);
      box.querySelector('[data-c="ok"]').onclick = () => {
        const empty = [...box.querySelectorAll("[required]")].find(x => !x.value.trim()); if (empty) { empty.focus(); return; }
        done(Object.fromEntries([...box.querySelectorAll("[data-k]")].map(x => [x.dataset.k, x.value.trim()]))); };
      box.onclick = e => { if (e.target === box) done(null); };
      box.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } if (e.key === "Enter" && e.target.tagName === "INPUT") box.querySelector('[data-c="ok"]').click(); };
      box.querySelector("input, select").focus();
    });
  }
  // New scene: a form over the scene words (VGRules.SCENE_PARTS / SCENE_WHEN), written as a scene note in the scenes
  // folder; the note opens with its block, which has the Open button
  async function newScene() {
    const P = VGRules.SCENE_PARTS, rules = Object.keys(VGRules.SCENE_WHEN).filter(w => w !== "else");
    const ruleRow = (i, when, as, motion, colour) => [
      { k: `w${i}`, label: i ? "And notes that are" : "Notes that are", type: "select", options: [["", "(none)"], ...rules], value: when },
      { k: `a${i}`, label: "look like", type: "select", options: P.as, value: as },
      { k: `m${i}`, label: "and move", type: "select", options: P.motion, value: motion },
      { k: `c${i}`, label: "colour", type: "color", value: colour }];
    const v = await formBox("New scene", [
      [{ k: "name", label: "Name", required: true, hint: "Night market" }, { k: "blurb", label: "What it shows", hint: "Topics as stalls; busy ones glow" }],
      [{ k: "place", label: "Topics placed in a", type: "select", options: P.place, value: "grid" },
       { k: "angle", label: "Seen", type: "select", options: P.angle, value: "iso" },
       { k: "wall", label: "Walls show", type: "select", options: P.wall, value: "none" }],
      ruleRow(0, "stale", "walker", "drift", "#94a3b8"),
      ruleRow(1, "unlinked", "walker", "roam", "#f87171"),
      [{ k: "else", label: "Everything else looks like", type: "select", options: P.as, value: "block" }],
      [{ k: "verb", label: "Now and then", type: "select", options: [["", "(nothing happens)"], ...P.verb], value: "" },
       { k: "target", label: "aimed at the nearest", type: "select", options: rules, value: "stale" },
       { k: "every", label: "as often as the topic's", type: "select", options: P.every, value: "activity" }],
    ], "Create");
    if (!v) return;
    const o = { name: v.name, blurb: v.blurb, group: "topic", place: v.place, angle: v.angle, wall: v.wall,
      entity: [0, 1].filter(i => v[`w${i}`]).map(i => ({ when: v[`w${i}`], as: v[`a${i}`], motion: v[`m${i}`], colour: v[`c${i}`] })).concat([{ when: "else", as: v.else }]),
      events: v.verb ? [{ verb: v.verb, target: v.verb === "spar" ? null : v.target, every: v.every }] : [] };
    const { errors } = VGRules.sceneSpec({ ...o, entity: o.entity.map(r => r.when === "else" ? { else: r.as } : r), events: o.events.map(e => ({ every: e.every, do: e.verb + (e.target ? " nearest " + e.target : "") })) });
    if (errors.length) { toast(errors[0], "warn"); return; }
    const title = safeName(v.name) + " (scene)";
    const md = `---\ncreated: ${today()}\ntags:\n  - meta/knowledge-graph\n---\n# ${title}\n\n${v.blurb ? v.blurb + "\n\n" : ""}\`\`\`vault-graph-scene\n${VGRules.sceneYaml(o)}\n\`\`\`\n`;
    try { await opts.writeNote(`${FOLDERS.scenes}/${title}.md`, md, { mode: "create", open: true }); toast(`Created ${title}`, "ok"); }
    catch (e) { toast(e.message, "warn"); }
  }
  function logDiscovery(text) {
    if (!cos.log) cos.log = [];
    cos.log.unshift({ date: today(), text }); cos.log = cos.log.slice(0, 200);
    const rule = XP_FOR.find(([re]) => re.test(text)); if (rule) awardXp(rule[1], text);
    if (typeof updateDaily === "function") updateDaily(true);
    persistSoon(); if (typeof renderMissions === "function") renderMissions();
  }

  // ---------------------------------------------------------------- legend + status + HUD + toasts
  function renderLegend() {
    if (mapView()) {
      const item = (sw, t) => `<span class="vg-lg-item">${sw}${t}</span>`;
      $(".vg-legend").innerHTML = SCENES[st.view] ? (SCENES[st.view].legend ? SCENES[st.view].legend(item) : "") : st.view === "subway" ? item(`<i class="vg-lg-line" style="height:4px;background:${colorOf(0)}"></i>`, "line = topic") + item(`<i class="vg-lg-stn"></i>`, "note") + item(`<i class="vg-lg-stn is-x"></i>`, "connects topics")
        : st.view === "topo" ? item(`<span class="vg-lg-grad is-topo"></span>`, "height = relied on") + item(`<i class="vg-lg-line is-gap" style="border-color:#3a2a1a"></i>`, "bridge (link across topics)") + item(`<i class="vg-lg-fog"></i>`, "fog = quiet")
        : st.view === "garden" ? item("🌱", "seed → seedling → budding") + item("🌳", "evergreen = developed, relied on") + item("🍂", "wilting = stale") + item("🌸", "flowering = recent") + item("💧", "open tasks")
        : st.view === "weather" ? item("<b style='color:#b91c1c'>L</b>", "busier than usual") + item("<b style='color:#1d4ed8'>H</b>", "quieter") + item("⛈", "burst this week") + item("<i class='vg-lg-line' style='border-color:#dc2626'></i>", "front = come up together")
        : st.view === "ships" ? item("⚓", "port = topic") + item("⛴", "lane = links (more ships = more)") + item("🌫", "fog = gap, uncharted")
        : st.view === "rings" ? item("◎", "one ring per month") + item("<i class='vg-lg-bld'></i>", "wide = many new notes") + item("╱", "scar = incident or failure")
        : st.view === "sky" ? item("✦", "bright = relied on") + item("▲", "rising (recent)") + item("<b style='color:#fca5a5'>●</b>", "fading (stale)")
        : st.view === "realm" ? item("🏰", "castle = map (MOC)") + item("⛰", "mountain = relied on") + item("🌲", "forest = stale") + item("🐉", "unlinked notes")
        : st.view === "foodweb" ? item("↑", "producers at the bottom, logs at the top") + item("<b style='color:#f87171'>◯</b>", "endangered: relied on, stale")
        : st.view === "lineage" ? item("↝", "grew from: linked, already existed") + item("<b style='color:#fb923c'>↝</b>", "crossed into another topic") + item("●", "bigger = more grew from it")
        : st.view === "ripples" ? item("◎", "ring = clicks from your maps") + item("<b style='color:#f87171'>●</b>", "no link reaches it") + item("⌖", "select a note → Centre here")
        : st.view === "alchemy" ? item("<b style='color:#fbbf24'>●</b>", "gold at the centre, raw lead outside") + Object.values(REACTIONS).map(([n, c, w]) => item(`<b style='color:${c}'>⋯</b>`, `${n}: ${w}`)).join("")
        : st.view === "clock" ? item("◔", "ring = topic") + item("<i class='vg-lg-win'></i>", "brighter = more of its mentions")
        : st.view === "radar" ? item("<b style='color:#22c55e'>●</b>", "note with open tasks") + item("<b style='color:#f87171'>●</b>", "oldest task 90+ days") + item("↻", "click a blip to tick off")
        : st.view === "palace" && (!mapCache.palace || mapCache.palace.facade) ? item("▢", "window = note") + item("<b style='color:#fcd34d'>▢</b>", "lit = active") + item("▨", "boarded = stale") + item("<b style='color:#dc2626'>▁</b>", "red sill = open tasks") + item("<b style='color:#b91c1c'>⚡</b>", "crack = gap") + item("⌂", "click a floor to go in")
        : st.view === "palace" ? item(`<i class="vg-lg-stn"></i>`, "room = topic") + item("🚪", "door = links (wider = more)") + item(`<i class="vg-lg-line is-gap" style="border-color:#f87171"></i>`, "bricked = gap") + item("💡", "lit = recent") + item(`<i class="vg-lg-bld is-stale"></i>`, "dusty = stale")
        : item(`<i class="vg-lg-bld"></i>`, "height = relied on") + item(`<i class="vg-lg-win"></i>`, "lit = recent activity") + item(`<i class="vg-lg-bld is-stale"></i>`, "grey = stale") + item(`<i class="vg-lg-lot"></i>`, "empty lot = not written") + item("<b style='color:#ef4444'>•</b>", "beacon = open tasks") + item("🏛", "town hall = the topic's map");
      return;
    }
    const sizeWord = { bc: "influence", recent: "daily mentions", opens90: "opens · 90 days", opens: "opens" }[st.sizeBy];
    const colour = neural() && st.vision === "thermal" ? `<span class="vg-lg-item"><span class="vg-lg-grad is-thermal"></span>activity · ${DATA.recent_days}d</span>`
      : st.colorBy === "cluster" ? `<span class="vg-lg-item"><span class="vg-lg-dots">${(neural() ? NEON : PALETTE).slice(0, 5).map(c => `<i style="background:${c}"></i>`).join("")}</span>topic</span>`
      : `<span class="vg-lg-item"><span class="vg-lg-grad"></span>${st.colorBy === "opens90" ? "opens · 90d" : "mentions · 30d"}</span>`;
    $(".vg-legend").innerHTML = `<span class="vg-lg-item"><span class="vg-lg-size"><i></i><i></i></span>${sizeWord}</span>${colour}` +
      `<span class="vg-lg-item"><i class="vg-lg-line"></i>link</span>` +
      (neural() ? `<span class="vg-lg-item" title="Pulses fire along links of notes edited or mentioned lately; lobes glow by the same activity">✦ pulse · recent activity</span>` : "") +
      (st.gaps ? `<span class="vg-lg-item"><i class="vg-lg-line is-gap"></i>co-mentioned</span><span class="vg-lg-item"><i class="vg-lg-line is-sim"></i>similar</span>` : "") +
      (st.layers.mocs && mocs.length ? `<span class="vg-lg-item"><i class="vg-lg-hex"></i>map (MOC)</span>` : "") +
      (st.layers.people ? `<span class="vg-lg-item"><i class="vg-lg-diamond"></i>person</span>` : "") +
      (st.layers.wanted ? `<span class="vg-lg-item"><i class="vg-lg-ghost"></i>not written</span>` : "");
  }
  // A scene's own counts (alchemy's reactions, radar's tasks) go in the status pill like every other view's,
  // instead of text painted on the canvas where the banner or legend can cover it
  let sceneStat = { view: null, text: "" };
  function setSceneStat(text) { if (sceneStat.view !== st.view || sceneStat.text !== text) { sceneStat = { view: st.view, text }; renderStatus(); } }
  function renderStatus() {
    const settling = alpha > 0.005 && !neural() && !isCosmos() && !mapView();
    settledShown = settling;
    const parts = [sceneStat.view === st.view && sceneStat.text ? sceneStat.text : `${active.length} shown`];   // what's on screen (maps, people and unwritten notes too); the sidebar counts linked notes
    if (st.highlightLabel) parts.push(st.highlightLabel);
    if (st.path) parts.push(`path · ${plural(st.path.ids.length - 1, "step")}`);
    if (st.multi) parts.push(`${st.multi.size} selected`);
    if (st.hiddenClusters.size) parts.push(`${plural(st.hiddenClusters.size, "cluster")} hidden`);
    if (st.hidden.size) parts.push(`top ${st.hidden.size} hidden`);
    $(".vg-status").innerHTML = `${settling ? '<span class="vg-spin" aria-hidden="true"></span>Laying out · ' : ""}${parts.map(esc).join(" · ")}`;
  }
  function renderHud() {
    if (!neural()) return;
    const n = st.selected && byId[st.selected];
    $(".vg-hud-title").innerHTML = `<b>VAULT // NEURAL MAP</b><span>${esc(DATA.vault || "").toUpperCase()} · ${esc(DATA.date)} · ${st.vision.toUpperCase()}</span>` +
      `<span>NODES ${active.length} · LINKS ${visLinks.filter(l => l.kind === "link").length} · LOBES ${DATA.clusters.length} · MAPS ${mocs.length} · BRIDGES ${nodes.filter(n => n.bridge).length}</span>`;
    const p = n && P.get(n.id);
    $(".vg-hud-tele").innerHTML = n ? `<b>TARGET ▸ ${esc(n.name.toUpperCase())}</b>` +
      `<span>LOBE ${esc(clusterName(n.cluster).toUpperCase())}</span>` +
      `<span>RANK #${rankOf[n.id] || "—"} · LINKS ${nb[n.id].size} · MENTIONS ${n.mentions}</span>` +
      `<span>ACTIVITY ${"█".repeat(Math.min(10, Math.round(10 * (n.recent || 0) / maxRecent)))}${"░".repeat(10 - Math.min(10, Math.round(10 * (n.recent || 0) / maxRecent)))}</span>` +
      (p ? `<span>XYZ ${Math.round(n.x)} ${Math.round(n.y)} ${Math.round(n.z)}</span>` : "")
      : MOBILE ? `<span>NO TARGET · TAP A NODE</span><span>DRAG TO ORBIT · PINCH TO ZOOM</span>` : `<span>NO TARGET · CLICK A NODE</span><span>DRAG TO ORBIT · SCROLL TO ZOOM</span>`;
    $(".vg-hud-tele").classList.toggle("is-idle", !n);
  }
  // undo (optional): an Undo button on the toast, which then stays up longer
  function toast(msg, kind, undo) {
    if (opts.compact && !kind) return;   // explanatory toasts are noise in a card or embed; results and warnings still show
    const el = document.createElement("div");
    el.className = `vg-toast ${kind ? "is-" + kind : ""}`; el.textContent = msg;
    if (undo) {
      const b = document.createElement("button"); b.className = "vg-toast-undo"; b.textContent = "Undo";
      b.onclick = e => { e.stopPropagation(); el.remove(); undo(); };
      el.append(" ", b); el.classList.add("has-undo");
    }
    $(".vg-toasts").appendChild(el);
    // text is the background colour, which a see-through host (Hearth cards) makes invisible: pick black or white instead
    const tbg = getComputedStyle(el).color.match(/[\d.]+/g) || [], tfg = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
    if (tbg.length === 4 && +tbg[3] < 0.5) el.style.color = 0.299 * tfg[0] + 0.587 * tfg[1] + 0.114 * tfg[2] > 140 ? "#111" : "#fff";
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => { el.classList.remove("is-in"); setTimeout(() => el.remove(), 250); }, undo ? UI.time.toastUndo : UI.time.toast);
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => toast("Couldn't copy", "warn"));
  }

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
  // "⋯" on a note's row in a lens or the missions panel: the same actions as the inspector, in a menu
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


  // ---------------------------------------------------------------- cosmos: a sandbox of celestial bodies
  // Place bodies in space and they reorganise the graph around a question: a STAR (a note or MOC) pulls
  // linked notes into orbit by link distance; a PLANET (a search) captures matching notes as moons;
  // BINARY stars (two MOCs) orbit each other with shared notes at the middle; a BLACK HOLE (a filter such
  // as "stale") swallows matching notes into a review queue; a REPULSOR pushes a topic out of the way.
  // Automatic: comets (notes in recent dailies), wormholes (link suggestions), an asteroid belt (notes
  // to write) and a nebula (unlinked notes). Placing bodies only changes the view; anything that writes
  // to a note asks, as everywhere else. Missions and achievements are computed from real vault changes.
  const BODY = {
    star: { label: "Star", glyph: "☀", hint: "A note or MOC — linked notes orbit it by link distance", mass: 1 },
    planet: { label: "Planet", glyph: "◍", hint: "A search — tag:, folder:, cluster:, moc: or words — matching notes become moons", mass: 0.5 },
    binary: { label: "Binary", glyph: "⚭", hint: "Two MOCs orbiting each other — notes linked to both sit in the middle", mass: 1.2 },
    blackhole: { label: "Black hole", glyph: "●", hint: "A filter — stale, orphans, stubs… — matching notes fall into a review queue", mass: 2.2 },
    repulsor: { label: "Repulsor", glyph: "◎", hint: "Pushes a topic away to clear space", mass: -1 },
  };
  const BH_FILTERS = { stale: "Stale (not edited in " + Q.stale_days + "+ days)", orphans: "Orphans (nothing links here)", stubs: "Stubs (under " + Q.stub_words + " words)",
    deadends: "Dead ends (link nowhere)", tasks: "Open tasks", notinmap: "Not in their topic's map" };
  const NEBULA = [-640, 460], BELT_R = 720;
  // The nebula (unlinked notes) is a gas cloud on a slow circular orbit about the core; its notes circle inside it
  const NEB_R = Math.hypot(...NEBULA), NEB_A0 = Math.atan2(NEBULA[1], NEBULA[0]), GM_NEB = 6;
  const nebulaPos = () => { const a = NEB_A0 + physT * Math.sqrt(GM_CORE / Math.pow(NEB_R, 3)); return [Math.cos(a) * NEB_R, Math.sin(a) * NEB_R]; };
  let cos = { bodies: [], auto: { comets: true, wormholes: true, belt: true, nebula: true, grid: true, motion: true, trails: true }, done: [], ach: {}, xp: 0 };
  let capture = new Map(), repelled = new Map(), bodyCaptured = new Map();
  const mocMembers = {}; links.filter(l => l.kind === "moc").forEach(l => (mocMembers[l.s.id] = mocMembers[l.s.id] || new Set()).add(l.t.id));
  const graphNb = id => new Set([...(nb[id] || []), ...(mocMembers[id] || [])]);
  // A star can sit on any note, even one the graph leaves out (a navigation map, a hub list): what it lists orbits it
  const stemOf = id => String(id || "").split("/").pop().replace(/\.md$/i, "");
  const anchorNb = id => byId[id] ? graphNb(id) : new Set([...(((DATA.mocs || []).find(m => m.id === id) || {}).members || []),
    ...(opts.outlinksOf ? opts.outlinksOf(id) : [])].filter(x => byId[x]));
  const bodyName = b => b.name || (b.type === "star" && b.target ? (byId[b.target] ? byId[b.target].name : ((DATA.mocs || []).find(m => m.id === b.target) || {}).title || stemOf(b.target)) : b.type === "binary" && Array.isArray(b.target) ? b.target.map(x => byId[x] ? byId[x].name : "?").join(" & ")
    : b.type === "blackhole" ? (BH_FILTERS[b.target] || b.target || "Black hole").split(" (")[0] : b.target || BODY[b.type].label);
  function matchQuery(q) {
    q = String(q || "").trim(); if (!q) return () => false;
    const m = q.match(/^(\w+):\s*(.+)$/), v = (m ? m[2] : q).toLowerCase();
    if (m && m[1] === "tag") return n => (n.tags || []).some(x => x === v || x.startsWith(v + "/"));
    if (m && m[1] === "folder") return n => (n.folder || "").toLowerCase().startsWith(v);
    if (m && m[1] === "cluster") return n => String(n.cluster) === v || clusterName(n.cluster).toLowerCase().includes(v);
    if (m && m[1] === "moc") { const mm = mocs.find(x => x.title.toLowerCase().includes(v)); return n => onMap(mm, n.id); }
    return n => n.name.toLowerCase().includes(v) || (n.tags || []).some(x => x.includes(v));
  }
  const bhTest = f => f === "notinmap" ? (n => inMoc(n.id) === false) : OVERLAYS[f] ? OVERLAYS[f].test : matchQuery(f);
  function cosmosCapture() {
    capture = new Map(); repelled = new Map(); bodyCaptured = new Map();
    const order = { blackhole: 0, star: 1, binary: 2, planet: 3 };
    const vis = active.filter(n => !special(n) || n.moc);
    [...cos.bodies].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9)).forEach(b => {
      const got = [];
      const take = (n, info) => { if (!capture.has(n.id) && !(b.type === "star" && n.id === b.target)) { capture.set(n.id, { b, ...info }); got.push(n.id); } };
      if (b.type === "star" && b.target) {
        const dist = new Map([[b.target, 0]]), queue = [b.target];
        while (queue.length) { const v = queue.shift(), d = dist.get(v); if (d >= 3) continue; (v === b.target ? anchorNb(v) : graphNb(v)).forEach(m => { if (!dist.has(m)) { dist.set(m, d + 1); queue.push(m); } }); }
        // one link out and the star doesn't link back (it links to the map, the map doesn't list it): retrograde
        const out = byId[b.target] ? new Set([...links.filter(l => l.kind === "link" && l.s.id === b.target).map(l => l.t.id), ...(mocMembers[b.target] || [])]) : anchorNb(b.target);
        vis.forEach(n => { const d = dist.get(n.id); if (d) take(n, { r: 30 + d * 55, spin: 0.55 / Math.sqrt(d), ring: d, retro: d === 1 && !out.has(n.id) }); });
      } else if (b.type === "planet") {
        const ms = vis.filter(matchQuery(b.target)); ms.forEach((n, i) => take(n, { r: 34 + Math.sqrt(ms.length) * 5 + (i % 3) * 8, spin: 0.7 }));
      } else if (b.type === "binary" && Array.isArray(b.target)) {
        const [A, B] = b.target, na = graphNb(A), nB = graphNb(B);
        vis.forEach(n => { if (n.id === A || n.id === B) return; const ia = na.has(n.id), ib = nB.has(n.id);
          if (ia && ib) take(n, { r: 6 + (hash(n.id) % 18), spin: 0.2, lagrange: true }); else if (ia) take(n, { r: 42, spin: 0.6, anchor: 0 }); else if (ib) take(n, { r: 42, spin: 0.6, anchor: 1 }); });
      } else if (b.type === "blackhole") {
        const test = bhTest(b.target), kept = new Set(cos.kept || []); vis.filter(n => !n.moc && !kept.has(n.id) && test(n)).forEach((n, i) => take(n, { r: 12 + (i % 6) * 5, spin: 1.4, hole: true }));
      } else if (b.type === "repulsor") {
        vis.filter(matchQuery(b.target)).forEach(n => repelled.set(n.id, b));
      }
      bodyCaptured.set(b.id, got);
    });
    const anchors = new Set(cos.bodies.flatMap(b => b.type === "star" ? [b.target] : b.type === "binary" ? (b.target || []) : []));
    for (const n of nodes) {
      const c = capture.get(n.id);
      if (!c) {   // field notes: circular orbits about the galactic centre (inner ones faster: differential rotation)
        if (n.isolated && cos.auto.nebula && active.includes(n)) {
          if (!n.orb || n.orb.role !== "nebula") { const h = hash(n.id), r = 18 + h % 130, a = (h >>> 8) % 628 / 100, v = Math.sqrt(GM_NEB / r) * (h % 5 ? 1 : -1);
            n.orb = { b: "nebula", role: "nebula", rx: Math.cos(a) * r, ry: Math.sin(a) * r, vx: -Math.sin(a) * v, vy: Math.cos(a) * v }; }
          continue;
        }
        if (n.isolated || n.ghost || anchors.has(n.id) || !active.includes(n)) { n.orb = null; continue; }
        if (!n.orb || n.orb.role !== "galaxy") { const r = Math.max(80, Math.hypot(n.x, n.y)), a = Math.atan2(n.y, n.x), v = Math.sqrt(GM_GAL / r);
          n.orb = { b: "galaxy", role: "galaxy", rx: Math.cos(a) * r, ry: Math.sin(a) * r, vx: -Math.sin(a) * v, vy: Math.cos(a) * v }; }
        continue;
      }
      const role = c.lagrange ? "trojan" : c.hole ? "hole" : "orbit";
      if (!n.orb || n.orb.b !== c.b.id || n.orb.role !== role || n.orb.anchor !== c.anchor || n.orb.retro !== !!c.retro) initOrbit(n, c);
    }
  }
  // ---- orbital mechanics (real Newtonian gravity, in vault units)
  // Each captured note is a test particle in its captor's gravity field: a = -GM r / |r|^3 (softened),
  // integrated with symplectic Euler, so energy is conserved and orbits are true Kepler ellipses.
  // Captured notes start on circular orbits, v = sqrt(GM/r); notes from recent dailies start at
  // perihelion of an ellipse (e = 0.6), like comets. Binary stars orbit their barycentre at the rate
  // Kepler's third law gives; notes linked to both sit at the stable L4/L5 Lagrange points. Black holes
  // swallow through a viscous accretion disc down to the innermost stable circular orbit (3 r_s).
  // Each body's influence is its own (patched conics): a note feels only the body that captured it.
  const GM_UNIT = 30;   // a 100-unit orbit around a 1x star takes ~19 s at 60 fps
  const BODY_GM = { star: 1, planet: 0.3, binary: 0.8, blackhole: 3, repulsor: 0 };
  const gmOf = b => GM_UNIT * (BODY_GM[b.type] || 0) * (b.mass || 1);
  const SOFT2 = 36;     // gravitational softening (6 units): no singularity at r -> 0
  const GM_GAL = GM_UNIT * 6;   // the galaxy's central mass: field notes take about a minute per lap at r = 400
  const BIN_SEP = 156;  // binary separation a; each star sits a/2 from the barycentre
  const rsOf = b => 4 + 4 * (b.mass || 1);   // Schwarzschild radius, at display scale
  let physT = 0;        // simulation clock (frames), advanced by the time warp
  function binaryAngle(b) {   // Kepler III: omega = sqrt(G(M1+M2)/a^3), both stars of mass GM
    return physT * Math.sqrt(2 * gmOf(b) / Math.pow(BIN_SEP, 3)) + hash(b.id) % 6;
  }
  function anchorPos(b, i) {
    const a = binaryAngle(b) + i * Math.PI;
    return [b.x + Math.cos(a) * BIN_SEP / 2, b.y + Math.sin(a) * BIN_SEP / 2];
  }
  function centreOf(c) { return c.anchor != null ? anchorPos(c.b, c.anchor) : [c.b.x, c.b.y]; }
  // put a note on a fresh orbit around its captor: keep its bearing, set radius and the right speed
  function initOrbit(n, c) {
    const [cx, cy] = centreOf(c), gm = gmOf(c.b);
    let dx = n.x - cx, dy = n.y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    // Shape carries meaning: a comet (named in recent dailies) plunges in on e = 0.6; a stale note drifts onto a
    // long ellipse (e up to 0.55 as it goes untouched), which precesses into a rosette; a current one stays round.
    const comet = n.recent > 0 && !c.hole && !c.lagrange;
    const e = comet ? 0.6 : c.hole || c.lagrange ? 0 : Math.min(0.55, Math.max(0, ((n.age || 0) - 30) / (Q.stale_days * 2)));
    const r = c.r * (1 - e), dir = c.retro ? -1 : 1;   // start at perihelion; c.r is the orbit's semi-major axis
    const v = Math.sqrt(gm * (1 + e) / r) * dir;
    n.orb = { b: c.b.id, role: c.lagrange ? "trojan" : c.hole ? "hole" : "orbit", anchor: c.anchor, rx: dx * r, ry: dy * r, vx: -dy * v, vy: dx * v, isco: 0, retro: !!c.retro };
    if (c.hole) n.orb.isco = 3 * rsOf(c.b) + (hash(n.id) % 6) * 3;
  }
  function stepOrbits(dt) {
    for (const n of active) {
      const o = n.orb; if (!o || n.pin) continue;
      if (o.role === "galaxy") {
        const r2 = o.rx * o.rx + o.ry * o.ry, inv = 1 / Math.pow(r2 + SOFT2, 1.5);
        o.vx -= GM_GAL * o.rx * inv * dt; o.vy -= GM_GAL * o.ry * inv * dt;
        if (wells.length) {   // moving bodies raise wakes in the disc as they pass; its gas drag smooths them out again
          for (const [bx, by, gm] of wells) { const ex = bx - o.rx, ey = by - o.ry, d2 = ex * ex + ey * ey; if (d2 > 250000) continue;
            const f = gm * FIELD_COUPLE / Math.pow(d2 + 1600, 1.5) * dt; o.vx += ex * f; o.vy += ey * f; }
          const r = Math.sqrt(r2) || 1, vc = Math.sqrt(GM_GAL / Math.max(r, 40));
          o.vx += (-o.ry / r * vc - o.vx) * GAS_DRAG * dt; o.vy += (o.rx / r * vc - o.vy) * GAS_DRAG * dt;
        }
        o.rx += o.vx * dt; o.ry += o.vy * dt;
        n.x = o.rx; n.y = o.ry; n.vx = n.vy = 0; continue;
      }
      if (o.role === "nebula") {   // swirling in the cloud (a fifth of it the other way round: turbulence)
        const r2 = o.rx * o.rx + o.ry * o.ry, inv = 1 / Math.pow(r2 + 400, 1.5), [cx, cy] = nebulaPos();
        o.vx -= GM_NEB * o.rx * inv * dt; o.vy -= GM_NEB * o.ry * inv * dt; o.rx += o.vx * dt; o.ry += o.vy * dt;
        n.x = cx + o.rx; n.y = cy + o.ry; n.vx = n.vy = 0; continue;
      }
      const c = capture.get(n.id); if (!c) { n.orb = null; continue; }
      if (o.role === "trojan") {   // L4/L5: equilateral with both stars, 60 deg ahead of / behind star 0, co-rotating
        const lead = hash(n.id) % 2 ? 1 : -1, lib = 0.12 * Math.sin(physT / 240 + hash(n.id) % 9);   // small libration about the point
        const ang = binaryAngle(c.b) + lead * Math.PI / 3 + lib, R = BIN_SEP * 0.866 + (hash(n.id) % 14) - 7;
        n.x = c.b.x + Math.cos(ang) * R; n.y = c.b.y + Math.sin(ang) * R; n.vx = n.vy = 0; continue;
      }
      const gm = gmOf(c.b);
      const r2 = o.rx * o.rx + o.ry * o.ry, L = o.rx * o.vy - o.ry * o.vx;
      // a 1/r^3 term, as in general relativity (exaggerated so you can see it): ellipses precess into rosettes
      const inv = (1 + PREC * L * L / (r2 + SOFT2)) / Math.pow(r2 + SOFT2, 1.5);
      o.vx -= gm * o.rx * inv * dt; o.vy -= gm * o.ry * inv * dt;
      if (o.role === "hole") {   // viscous accretion: lose energy until the innermost stable orbit, then stay on it
        const r = Math.sqrt(r2);
        if (r > o.isco) { const k = 1 - 0.006 * dt; o.vx *= k; o.vy *= k; }
        else { const v = Math.sqrt(gm / o.isco), ux = o.rx / (r || 1), uy = o.ry / (r || 1); o.rx = ux * o.isco; o.ry = uy * o.isco; o.vx = -uy * v; o.vy = ux * v; }
      }
      repelled.forEach(b => {   // radiation pressure (1/r^2, outward) perturbs orbits too
        const [cx, cy] = centreOf(c), dx = cx + o.rx - b.x, dy = cy + o.ry - b.y, d2 = dx * dx + dy * dy + SOFT2;
        if (d2 < 360 * 360) { const f = 900 * (b.mass || 1) / d2 * dt / Math.sqrt(d2); o.vx += dx * f * 0.02; o.vy += dy * f * 0.02; }
      });
      o.rx += o.vx * dt; o.ry += o.vy * dt;
      const [cx, cy] = centreOf(c); n.x = cx + o.rx; n.y = cy + o.ry; n.vx = n.vy = 0;
    }
  }
  // ---- the bodies move too: a galactic core holds them, they tug on each other, planets orbit a star
  // Stars, binaries, black holes and repulsors orbit the core (GM_CORE). A planet orbits the star or binary whose
  // notes it shares most, in that body's frame, as moons do. Bodies pull on each other at BODY_COUPLE of their
  // strength, as Plummer spheres the size of a system (a planet feels it as a tide): enough for resonances, precession and the odd slingshot, not
  // enough to wreck a system. arrangeOrbits() lays out rings of up to three co-orbital bodies 120 degrees apart.
  // Neighbouring rings' periods differ by the golden ratio (radius ratio phi^(2/3), Kepler III): the least resonant
  // spacing (KAM), since a 2:1 chain pumped eccentricities until stars were flung out. Dynamical friction with the
  // disc slowly re-circularises stars and planets after a disturbance; the black hole keeps its diving ellipse and
  // repulsors their wide retrograde one.
  const GM_CORE = 260, BODY_COUPLE = 0.06, BODY_GM_CAP = 45, BODY_SOFT2 = 150 * 150, RING0 = 360, RING_RATIO = Math.pow((1 + Math.sqrt(5)) / 2, 2 / 3), DYN_FRICTION = 0.0003;
  const FIELD_COUPLE = 0.35, GAS_DRAG = 0.0025, PREC = 3 / 27;
  let wells = [];   // [x, y, GM] of each body, refreshed every step; field notes feel them
  const bodyById = id => cos.bodies.find(b => b.id === id);
  const parentOf = b => b.parent ? bodyById(b.parent) || null : null;
  const holdGm = p => p ? Math.max(gmOf(p), 12) : GM_CORE;
  function planetParent(b) {   // the star or binary sharing most of this planet's notes
    const test = matchQuery(b.target), ms = nodes.filter(n => !special(n) && test(n)).map(n => n.id);
    let best = null, bn = 0;
    cos.bodies.filter(x => x.type === "star" || x.type === "binary").forEach(x => {
      const own = new Set([...(bodyCaptured.get(x.id) || []), ...[].concat(x.target || []).flatMap(t => [...anchorNb(t)])]);
      const k = ms.filter(id => own.has(id)).length; if (k > bn) { bn = k; best = x; }
    });
    return best;
  }
  // put a body on an orbit about its parent (or the core): semi-major axis a, eccentricity e, starting at
  // perihelion at angle th, prograde (dir 1) or retrograde (-1)
  function setOrbit(b, parent, a, e, th, dir) {
    const r = a * (1 - e), v = Math.sqrt(holdGm(parent) * (1 + e) / r) * dir;
    b.parent = parent ? parent.id : null; b.rx = Math.cos(th) * r; b.ry = Math.sin(th) * r; b.vx = -Math.sin(th) * v; b.vy = Math.cos(th) * v;
    placeFromOrbit(b);
  }
  function placeFromOrbit(b) { const p = parentOf(b); b.x = (p ? p.x : 0) + b.rx; b.y = (p ? p.y : 0) + b.ry; }
  function circularHere(b, parent) {   // keep where it is, give it the speed of a circular orbit there
    const px = parent ? parent.x : 0, py = parent ? parent.y : 0, dx = b.x - px, dy = b.y - py, r = Math.max(60, Math.hypot(dx, dy));
    setOrbit(b, parent, r, 0, Math.atan2(dy, dx), b.type === "repulsor" ? -1 : 1);
  }
  function arrangeOrbits(announce) {
    const ring = cos.bodies.filter(b => b.type === "star" || b.type === "binary").sort((a, b) => gmOf(b) - gmOf(a) || (a.id < b.id ? -1 : 1));
    ring.forEach((b, i) => { const k = Math.floor(i / 3); setOrbit(b, null, RING0 * Math.pow(RING_RATIO, k), 0.04, (i % 3) * 2 * Math.PI / 3 + k * Math.PI / 3, 1); });
    const outer = RING0 * Math.pow(RING_RATIO, Math.max(0, Math.ceil(ring.length / 3) - 1));
    cos.bodies.filter(b => b.type === "blackhole").forEach((b, i) => setOrbit(b, null, (RING0 + outer) / 2 + 90 + 70 * i, 0.5, 2.3 + i * 2.4, 1));
    cos.bodies.filter(b => b.type === "repulsor").forEach((b, i) => setOrbit(b, null, outer * 1.4 + 60 * i, 0.15, 4 + i * 2, -1));
    const moons = {};
    cos.bodies.filter(b => b.type === "planet").forEach((b, i) => {
      const p = planetParent(b), j = moons[p ? p.id : ""] = (moons[p ? p.id : ""] || 0) + 1;
      if (p) setOrbit(b, p, 205 + 45 * (j - 1), 0.08, i * 2.4, 1); else setOrbit(b, null, outer * 1.18 + 50 * j, 0.1, i * 2.4, 1);
    });
    cos.arranged = 2; trails.clear(); noteTrails.clear();
    cosmosCapture(); persistSoon(); kick();
    if (announce) toast("Bodies arranged: co-orbital rings 120° apart at golden-ratio spacing, the black hole on a diving ellipse");
  }
  function stepBodies(dt) {
    const held = drag && drag.body;
    // core-orbiting bodies first (they carry the planets), then planets in their parent's frame
    const order = [...cos.bodies.filter(b => !b.parent), ...cos.bodies.filter(b => b.parent)];
    const pos = new Map(cos.bodies.map(b => [b.id, [b.x, b.y]]));
    for (const b of order) {
      if (b.rx == null) circularHere(b, parentOf(b));
      const p = parentOf(b);
      if (b === held) { b.rx = b.x - (p ? p.x : 0); b.ry = b.y - (p ? p.y : 0); b.vx = b.vy = 0; continue; }
      const gm = holdGm(p), r2 = b.rx * b.rx + b.ry * b.ry, inv = 1 / Math.pow(r2 + SOFT2, 1.5);
      let ax = -gm * b.rx * inv, ay = -gm * b.ry * inv;
      for (const o of cos.bodies) {
        if (o === b || o === p || o.parent === b.id) continue;
        const g = Math.min(gmOf(o), BODY_GM_CAP) * BODY_COUPLE; if (!g) continue;   // capped: a black hole nudges, it doesn't eject
        const [ox, oy] = pos.get(o.id), ex = ox - b.x, ey = oy - b.y, f = g / Math.pow(ex * ex + ey * ey + BODY_SOFT2, 1.5);
        ax += ex * f; ay += ey * f;
        if (p) { const qx = ox - p.x, qy = oy - p.y, h = g / Math.pow(qx * qx + qy * qy + BODY_SOFT2, 1.5); ax -= qx * h; ay -= qy * h; }   // a tide: the parent feels it too
      }
      if (b.type !== "blackhole" && b.type !== "repulsor") {   // dynamical friction: toward a circular orbit at this radius
        const r0 = Math.hypot(b.rx, b.ry) || 1, h = b.rx * b.vy - b.ry * b.vx >= 0 ? 1 : -1, vc = Math.sqrt(gm / r0) * h;
        ax += (-b.ry / r0 * vc - b.vx) * DYN_FRICTION; ay += (b.rx / r0 * vc - b.vy) * DYN_FRICTION;
      }
      b.vx += ax * dt; b.vy += ay * dt; b.rx += b.vx * dt; b.ry += b.vy * dt;
      const r = Math.hypot(b.rx, b.ry);
      if (p ? r > 520 : r > 2600) setOrbit(b, p, p ? 230 : Math.min(r, 1400), 0, Math.atan2(b.ry, b.rx), 1);   // flung out: it settles back in
      placeFromOrbit(b);
    }
    wells = cos.bodies.filter(b => gmOf(b) > 0).map(b => [b.x, b.y, gmOf(b)]);
  }
  // let go of a dragged body: it keeps the throw, or settles on a circular orbit where it was dropped. A planet
  // dropped near a star or binary is captured by it.
  function releaseBody(b, fvx, fvy) {
    if (!cos.auto.motion) return;
    const dist = x => Math.hypot(x.x - b.x, x.y - b.y);
    const parent = b.type === "planet" ? cos.bodies.filter(x => (x.type === "star" || x.type === "binary") && dist(x) < 360).sort((x, y) => dist(x) - dist(y))[0] || null : null;
    circularHere(b, parent);
    if (Math.hypot(fvx, fvy) > 0.4) { b.vx += fvx * 0.35; b.vy += fvy * 0.35; toast(`${bodyName(b)} thrown onto a new orbit`); }
    trails.delete(b.id); persistSoon();
  }
  function orbitText(b) {   // osculating elements, from the current state
    const p = parentOf(b), gm = holdGm(p), r = Math.hypot(b.rx, b.ry), v2 = b.vx * b.vx + b.vy * b.vy, E = v2 / 2 - gm / r;
    if (!(E < 0)) return `escaping ${p ? bodyName(p) : "the core"}`;
    const a = -gm / (2 * E), h = b.rx * b.vy - b.ry * b.vx, e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (gm * gm)));
    return `orbits ${p ? bodyName(p) : "the galactic core"}${h < 0 ? " (retrograde)" : ""} · a ${Math.round(a)} · e ${e.toFixed(2)} · ${(2 * Math.PI * Math.sqrt(a * a * a / gm) / 60).toFixed(0)} s per lap`;
  }
  // trails: recent positions of the bodies, and of the selected body's notes
  const trails = new Map(), noteTrails = new Map(), TRAIL = 220, NOTE_TRAIL = 90;
  let trailTick = 0;
  function recordTrails() {
    if (!cos.auto.trails || ++trailTick % 3) return;
    const push = (m, id, x, y, max) => { let t = m.get(id); if (!t) m.set(id, t = []); t.push(x, y); if (t.length > max * 2) t.splice(0, 2); };
    cos.bodies.forEach(b => push(trails, b.id, b.x, b.y, TRAIL));
    const ids = st.body ? bodyCaptured.get(st.body) || [] : [];
    if (noteTrails.size && ![...noteTrails.keys()].every(id => ids.includes(id))) noteTrails.clear();
    ids.slice(0, 80).forEach(id => { const n = byId[id]; if (n) push(noteTrails, id, n.x, n.y, NOTE_TRAIL); });
  }
  function drawTrail(t, col, w) {   // older segments fainter
    const k = 6, pts = t.length / 2, seg = Math.ceil(pts / k);
    for (let c = 0; c < k; c++) {
      const i0 = c * seg, i1 = Math.min(pts - 1, (c + 1) * seg); if (i1 <= i0) continue;
      ctx.globalAlpha = 0.05 + 0.32 * (c + 1) / k; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const [x, y] = toScreen(t[2 * i], t[2 * i + 1]); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function cosmosForces() {
    if (st.paused) return;
    const warp = st.warp || 1, sub = warp > 1 ? 4 : 2, dt = warp / sub;
    if (cos.auto.motion && cos.arranged !== 2 && cos.bodies.length) arrangeOrbits(false);   // first run with moving bodies
    const fx = st.follow && bodyById(st.follow), before = fx ? [fx.x, fx.y] : null;
    for (let s = 0; s < sub; s++) { physT += dt; if (cos.auto.motion) stepBodies(dt); else wells = []; stepOrbits(dt); }
    if (fx && !drag) { cam.tx -= (fx.x - before[0]) * cam.k; cam.ty -= (fx.y - before[1]) * cam.k; }   // the camera rides along with the selected body
    recordTrails();
    cos.bodies.forEach(b => {
      if (b.type === "star" && byId[b.target]) { const n = byId[b.target]; n.x = b.x; n.y = b.y; n.vx = n.vy = 0; }
    });
    cos.bodies.forEach(b => {
      if (b.type === "binary" && Array.isArray(b.target)) b.target.forEach((id, i) => { const n = byId[id]; if (n) { [n.x, n.y] = anchorPos(b, i); n.vx = n.vy = 0; } });
    });
    for (const n of active) {
      if (n.pin || n.orb) continue;
      if (n.isolated && cos.auto.nebula) {   // nebula: gas held loosely together, drifting
        const dx = n.x - NEBULA[0], dy = n.y - NEBULA[1], d = Math.hypot(dx, dy) || 1, r = 20 + hash(n.id) % 110, f = (d - r) * 0.02;
        n.vx -= dx / d * f; n.vy -= dy / d * f; n.vx += -dy / d * 0.05 * warp; n.vy += dx / d * 0.05 * warp;
      } else if (n.ghost && cos.auto.belt) {   // asteroid belt: Kepler's v = sqrt(GM/r), inner rocks overtake outer ones
        const r = BELT_R + (hash(n.id) % 60) - 30, w = Math.sqrt(GM_UNIT * 40 / Math.pow(r, 3)) * warp, a = Math.atan2(n.y, n.x) + w;
        const tx = Math.cos(a) * r, ty = Math.sin(a) * r; n.vx += (tx - n.x) * 0.2; n.vy += (ty - n.y) * 0.2;
      }
    }
    repelled.forEach((b, id) => { const n = byId[id]; if (!n || n.pin || n.orb) return; const dx = n.x - b.x, dy = n.y - b.y, d2 = dx * dx + dy * dy + SOFT2;
      if (d2 < 360 * 360) { const f = 2600 * (b.mass || 1) / d2 * warp; const d = Math.sqrt(d2); n.vx += dx / d * f; n.vy += dy / d * f; } });   // radiation pressure
  }
  function periodSec(b, r) { const gm = gmOf(b); return gm ? 2 * Math.PI * Math.sqrt(r * r * r / gm) / 60 : 0; }   // Kepler III
  function setPaused(on, auto) {
    st.paused = on; st.autoPaused = on && !!auto;
    const pill = $(".vg-pausepill"); if (pill) pill.hidden = !on || !isCosmos();
    $$(".vg-pausebtn").forEach(x => x.setAttribute("aria-pressed", on)); dirty = true; kick();
  }
  const toWorld = (sx, sy) => [(sx - W / 2 - cam.tx) / cam.k + cam.cx, (sy - H / 2 - cam.ty) / cam.k + cam.cy];
  const toScreen = (x, y) => [W / 2 + cam.tx + (x - cam.cx) * cam.k, H / 2 + cam.ty + (y - cam.cy) * cam.k];
  const bodySize = b => ({ star: 20, planet: 13, binary: 11, blackhole: 15, repulsor: 15 }[b.type]) * Math.max(0.6, Math.pow(cam.k, 0.5)) * (0.75 + 0.25 * Math.sqrt(b.mass || 1));
  function bodyHit(sx, sy) {
    for (const b of [...cos.bodies].reverse()) { const [x, y] = toScreen(b.x, b.y); if (Math.hypot(x - sx, y - sy) < bodySize(b) + 10) return b; }
    return null;
  }
  function wormholeHit(sx, sy) {
    if (!cos.auto.wormholes || !st.gaps) return null;
    for (const l of visLinks) { if (l.kind !== "gap" && l.kind !== "similar") continue;
      for (const n of [l.s, l.t]) { const p = P.get(n.id); if (p && Math.hypot(p.x - sx, p.y - sy) < 11 && Math.hypot(p.x - sx, p.y - sy) > 3) return l; } }
    return null;
  }
  const healthCache = new Map();
  function health(b) {   // cached for a second: it walks every captured note
    const c = healthCache.get(b.id), now = performance.now();
    if (c && now - c[0] < 1000) return c[1];
    const v = healthNow(b); healthCache.set(b.id, [now, v]); return v;
  }
  function healthNow(b) {   // share of a system's notes that are mapped, linked and current
    const ids = bodyCaptured.get(b.id) || []; if (!ids.length) return null;
    const s = ids.reduce((acc, id) => { const n = byId[id], m = inMoc(id); return acc + ((m === null ? 0.5 : m ? 1 : 0) + (nb[id].size >= 2 ? 1 : 0) + (!staleFor(n, Q.stale_days) ? 1 : 0)) / 3; }, 0);
    return Math.round(100 * s / ids.length);
  }
  const STARFIELD = Array.from({ length: 260 }, (_, i) => { const h = hash("star" + i); return [(h % 10000) / 10000, ((h >>> 14) % 10000) / 10000, 0.3 + ((h >>> 7) % 70) / 100, (h >>> 3) % 3]; });
  function drawCosmos(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#0a1024"); bg.addColorStop(1, "#010208"); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (const [u, v, a, s] of STARFIELD) {   // distant stars drift slowly with the camera (parallax)
      const x = ((u * W + cam.tx * 0.06 * (s + 1)) % W + W) % W, y = ((v * H + cam.ty * 0.06 * (s + 1)) % H + H) % H;
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(now / 900 + u * 40)); ctx.fillStyle = "#e0ecff"; ctx.fillRect(x, y, s ? 1.4 : 1, s ? 1.4 : 1);
    }
    ctx.globalAlpha = 1;
    project();
    const litSet = lit(), font = css("--vg-font");
    // spacetime grid, warped toward mass
    if (cos.auto.grid && cos.bodies.length) {
      // spacing adapts to zoom (about 55 px on screen, never finer than 70 world units); bodies' masses read once
      const step = Math.max(70, Math.ceil(55 / cam.k / 35) * 35), [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
      const ms = cos.bodies.map(b => [b.x, b.y, BODY[b.type].mass * (b.mass || 1) * 5200]);
      const warp = (x, y) => {
        let dx = 0, dy = 0;
        for (const [bx, by, m] of ms) { const ex = bx - x, ey = by - y, d = Math.sqrt(ex * ex + ey * ey) || 1, pull = Math.min(d * 0.7, m / (d + 90)); dx += ex / d * pull; dy += ey / d * pull; }
        return toScreen(x + dx, y + dy);
      };
      ctx.strokeStyle = theme().grid; ctx.globalAlpha = 0.09; ctx.lineWidth = 1;
      const sx = Math.floor(x0 / step) * step, sy = Math.floor(y0 / step) * step;
      for (let gx = sx; gx <= x1 + step; gx += step) { ctx.beginPath(); for (let gy = sy; gy <= y1 + step; gy += step / 3) { const [px, py] = warp(gx, gy); gy === sy ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
      for (let gy = sy; gy <= y1 + step; gy += step) { ctx.beginPath(); for (let gx = sx; gx <= x1 + step; gx += step / 3) { const [px, py] = warp(gx, gy); gx === sx ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // nebula and belt guides
    if (cos.auto.nebula) { const [nx, ny] = toScreen(...nebulaPos()), r = 170 * cam.k, g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      g.addColorStop(0, "rgba(168,85,247,.22)"); g.addColorStop(0.5, "rgba(56,189,248,.08)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, r, 0, 2 * Math.PI); ctx.fill();
      if (cam.k > 0.25) { ctx.fillStyle = "rgba(216,180,254,.55)"; ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.fillText("NEBULA · UNLINKED NOTES", nx, ny - r * 0.75); } }
    if (cos.auto.belt && ghosts.length && st.view) { const [ox, oy] = toScreen(0, 0); ctx.strokeStyle = "rgba(148,163,184,.12)"; ctx.setLineDash([2, 6]); ctx.lineWidth = 18 * cam.k;
      ctx.beginPath(); ctx.arc(ox, oy, BELT_R * cam.k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    // the galactic core the bodies orbit, and their trails
    if (cos.auto.motion && cos.bodies.length) {
      const [ox, oy] = toScreen(0, 0), r = Math.max(18, 46 * cam.k), g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, "rgba(255,244,214,.55)"); g.addColorStop(0.35, "rgba(251,191,36,.16)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r, 0, 2 * Math.PI); ctx.fill();
    }
    if (cos.auto.trails) {
      ctx.globalCompositeOperation = "lighter";
      const TC = { star: "rgba(253,224,71,1)", planet: "rgba(165,180,252,1)", binary: "rgba(191,219,254,1)", blackhole: "rgba(251,146,60,1)", repulsor: "rgba(125,211,252,1)" };
      cos.bodies.forEach(b => { const t = trails.get(b.id); if (t && t.length > 4) drawTrail(t, TC[b.type], 1.6); });
      noteTrails.forEach((t, id) => { if (t.length > 4 && byId[id]) drawTrail(t, neonOf(byId[id].cluster), 0.9); });
      ctx.globalCompositeOperation = "source-over";
    }
    // orbit guides
    cos.bodies.forEach(b => {
      const [x, y] = toScreen(b.x, b.y); ctx.strokeStyle = "rgba(186,230,253,.12)"; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
      if (b.type === "star") for (let d = 1; d <= 3; d++) { ctx.beginPath(); ctx.arc(x, y, (30 + d * 55) * cam.k, 0, 2 * Math.PI); ctx.stroke(); }
      if (b.type === "binary") { ctx.beginPath(); ctx.arc(x, y, 78 * cam.k, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.setLineDash([]);
    });
    // links, faint
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath(); ctx.strokeStyle = "rgba(148,197,255,.07)"; ctx.lineWidth = 0.8;
    for (const l of visLinks) { if (l.kind !== "link" && l.kind !== "moc") continue; const a = P.get(l.s.id), b = P.get(l.t.id); if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } }
    ctx.stroke();
    // wormholes: link suggestions as unstable portals at both ends
    if (cos.auto.wormholes && st.gaps) {
      for (const l of visLinks) { if (l.kind !== "gap" && l.kind !== "similar") continue;
        const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
        const on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
        ctx.globalAlpha = on ? 0.35 : 0.05; ctx.strokeStyle = l.kind === "gap" ? "#f472b6" : "#c084fc"; ctx.setLineDash([2, 7]); ctx.lineDashOffset = -now / 60;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2 + (b.y - a.y) * 0.2, (a.y + b.y) / 2 - (b.x - a.x) * 0.2, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = on ? 0.9 : 0.1;
        if (on || cam.k > 1.2) for (const p of [a, b]) for (let i = 0; i < 2; i++) { const r0 = 5 + i * 2.5, s = now / 400 * (i % 2 ? -1 : 1) + i; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r0, s, s + Math.PI * 1.2); ctx.stroke(); }
      }
      ctx.lineDashOffset = 0;
    }
    ctx.globalAlpha = 1;
    // comets: notes from recent dailies trail a tail pointing away from what they orbit
    const order = active.filter(n => P.has(n.id));
    if (cos.auto.comets) for (const n of order) {
      if (!n.recent) continue; const p = P.get(n.id), c = capture.get(n.id);
      const [cx, cy] = c ? toScreen(c.b.x, c.b.y) : toScreen(0, 0); let dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const L = (14 + Math.sqrt(n.recent) * 14) * Math.max(0.6, Math.pow(cam.k, 0.6)), g = ctx.createLinearGradient(p.x, p.y, p.x + dx * L, p.y + dy * L);
      g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(0.3, rgba(neonOf(n.cluster), 0.45)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dx * L, p.y + dy * L); ctx.stroke(); ctx.lineCap = "butt";
    }
    // notes: small glowing worlds; notes to write are grey rocks; unlinked notes are nebula dust
    for (const n of order) {
      const p = P.get(n.id); let a = litSet && !litSet.has(n.id) ? 0.12 : 1;
      if (st.focusDist) a *= UI.focusAlpha[Math.min(st.focusDist.get(n.id) || 0, 4)];
      const col = n.moc ? neonOf(n.cluster) : n.person ? css("--vg-person") : neonOf(n.cluster);
      const r = Math.max(1.3, worldRadius(n) * 0.55 * Math.pow(cam.k, 0.8));
      ctx.globalAlpha = a;
      if (n.ghost) { ctx.fillStyle = "#64748b"; ctx.beginPath(); for (let i = 0; i < 6; i++) { const ang = i * Math.PI / 3 + hash(n.id) % 3, rr = r * (0.7 + ((hash(n.id) >>> i) % 5) / 10); i ? ctx.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr) : ctx.moveTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr); } ctx.fill(); }
      else if (n.isolated) { ctx.fillStyle = "rgba(216,180,254,.8)"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r * 0.6), 0, 2 * Math.PI); ctx.fill(); }
      else {
        if (a > 0.3) { ctx.globalAlpha = a * 0.45; blit("glow", col, p.x, p.y, r * 2.6); ctx.globalAlpha = a; }
        if (n.moc) { ctx.fillStyle = col; ctx.beginPath(); hexagon(p.x, p.y, r * 1.3); ctx.fill(); }
        else blit("orb", col, p.x, p.y, r);
      }
      if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.stroke(); }
      p.r = r; p.a = a;
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    // bodies
    for (const b of cos.bodies) {
      const [x, y] = toScreen(b.x, b.y), s = bodySize(b), sel = st.body === b.id;
      if (b.type === "star") {
        const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3.2); const sc = theme().star; g.addColorStop(0, `rgba(${sc[0]},1)`); g.addColorStop(0.25, `rgba(${sc[1]},.9)`); g.addColorStop(0.5, `rgba(${sc[2]},.35)`); g.addColorStop(1, `rgba(${sc[2]},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 3.2, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#fffbea"; ctx.beginPath(); ctx.arc(x, y, s * 0.75, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "planet") {
        const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.35, 0, x, y, s); g.addColorStop(0, "#c7d2fe"); g.addColorStop(0.6, "#6366f1"); g.addColorStop(1, "#1e1b4b");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = "rgba(199,210,254,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, s * 1.9, s * 0.55, -0.35, 0, 2 * Math.PI); ctx.stroke();
      } else if (b.type === "binary") {
        [0, 1].forEach(i => { const [ax, ay] = toScreen(...anchorPos(b, i)), g = ctx.createRadialGradient(ax, ay, 0, ax, ay, s * 2.4);
          g.addColorStop(0, i ? "rgba(191,219,254,1)" : "rgba(254,240,138,1)"); g.addColorStop(0.35, i ? "rgba(96,165,250,.6)" : "rgba(250,204,21,.6)"); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax, ay, s * 2.4, 0, 2 * Math.PI); ctx.fill(); });
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "blackhole") {
        const rot = now / 700;
        for (let i = 0; i < 3; i++) { ctx.strokeStyle = `rgba(251,${146 + i * 30},60,${0.55 - i * 0.15})`; ctx.lineWidth = 3 - i * 0.6;
          ctx.beginPath(); ctx.ellipse(x, y, s * (2 + i * 0.35), s * (0.7 + i * 0.12), 0.35, rot + i, rot + i + Math.PI * 1.6); ctx.stroke(); }
        const g = ctx.createRadialGradient(x, y, s * 0.7, x, y, s * 1.5); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.7, "rgba(251,191,36,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "repulsor") {
        for (let i = 0; i < 3; i++) { const ph = ((now / 1600 + i / 3) % 1); ctx.strokeStyle = `rgba(125,211,252,${(1 - ph) * 0.7})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * (0.6 + ph * 3), 0, 2 * Math.PI); ctx.stroke(); }
        ctx.fillStyle = "#e0f2fe"; ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, 2 * Math.PI); ctx.fill();
      }
      const hp = b.type === "blackhole" || b.type === "repulsor" ? null : health(b);
      if (hp != null) {   // system health ring
        ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, s + 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.strokeStyle = hp >= 70 ? "#4ade80" : hp >= 40 ? "#facc15" : "#f87171"; ctx.beginPath(); ctx.arc(x, y, s + 9, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * hp / 100); ctx.stroke();
      }
      if (sel) { ctx.strokeStyle = "#e0f2fe"; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, s + 15, now / 900, now / 900 + 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
      const count = (bodyCaptured.get(b.id) || []).length + (b.type === "repulsor" ? [...repelled.values()].filter(v => v === b).length : 0);
      ctx.font = `600 10.5px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#e0f2fe";
      const txt = `${bodyName(b).toUpperCase()}`.slice(0, 40); ctx.fillText(txt, x, y + s + 16);
      ctx.fillStyle = "rgba(186,230,253,.65)"; ctx.font = `500 9.5px ${css("--vg-mono")}`;
      ctx.fillText(b.type === "blackhole" ? `${count} TO REVIEW` : b.type === "repulsor" ? `${count} PUSHED` : `${count} IN ORBIT${hp != null ? ` · ${hp}% HEALTHY` : ""}`, x, y + s + 29);
    }
    labelRects = [];
    cos.bodies.forEach(b => { const [x, y] = toScreen(b.x, b.y), s = bodySize(b); labelRects.push([x - 70, y + s + 14, 140, 28]); });
    drawLabels(order.slice().sort((a, b) => P.get(b.id).depth - P.get(a.id).depth), litSet, st.focusDist, font, "#e0f2fe", "#000", true);
    if (st.placing) { ctx.fillStyle = "rgba(224,242,254,.9)"; ctx.font = `600 12px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.fillText(`CLICK IN SPACE TO PLACE A ${BODY[st.placing].label.toUpperCase()}`, W / 2, 64); }
    // supernovas: talked about in your dailies, never linked -- they flare until you link them
    const now2 = now || performance.now();
    for (const [id, cnt] of saidUnlinked) {
      const p = P.get(id); if (!p || p.a < 0.3) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now2 / 300 + hash(id) % 7), R = (8 + Math.min(18, cnt * 1.5)) * Math.max(0.6, Math.pow(cam.k, 0.6)) * (0.8 + pulse * 0.4);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.3, "rgba(253,186,116,.55)"); g.addColorStop(1, "rgba(253,186,116,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = `rgba(254,215,170,${0.35 + pulse * 0.4})`; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + now2 / 4000; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * R * 0.5, p.y + Math.sin(a) * R * 0.5); ctx.lineTo(p.x + Math.cos(a) * R * 1.5, p.y + Math.sin(a) * R * 1.5); ctx.stroke(); }
      ctx.globalCompositeOperation = "source-over";
    }
    // task moons: each open task is a small moon around its note
    moonSpots = [];
    if (cam.k > 0.45) for (const n of order) {
      if (!n.tasks || special(n)) continue; const p = P.get(n.id); if (!p || p.a < 0.3) continue;
      const k = Math.min(n.tasks, 6);
      for (let i = 0; i < k; i++) {
        const a = now2 / (1400 + i * 260) + i * 2 * Math.PI / k, rr = p.r + 5 + i * 2.2, x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.55;
        ctx.fillStyle = "rgba(186,230,253,.85)"; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 2 * Math.PI); ctx.fill();
        moonSpots.push([x, y, n.id]);
      }
    }
    // constellations: your saved views, traced in gold across the background
    constSpots = [];
    savedViews.forEach(v => {
      const set = v.focus && byId[v.focus] ? [v.focus, ...nb[v.focus]] : active.filter(n => !special(n) && !(v.hiddenClusters || []).includes(n.cluster)).map(n => n.id);
      const stars = set.filter(id => P.has(id)).sort((a, b) => byId[b].bc - byId[a].bc).slice(0, 7);
      if (stars.length < 2) return;
      ctx.strokeStyle = "rgba(251,191,36,.28)"; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.beginPath();
      stars.forEach((id, i) => { const q = P.get(id); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.setLineDash([]);
      stars.forEach(id => { const q = P.get(id); ctx.fillStyle = "rgba(253,230,138,.9)"; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, 2 * Math.PI); ctx.fill(); });
      const q = P.get(stars[0]), label = `✦ ${v.name.toUpperCase()}`;
      ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillStyle = "rgba(253,230,138,.85)";
      const w = ctx.measureText(label).width; ctx.fillText(label, q.x + 6, q.y - 6); constSpots.push([q.x + 6, q.y - 18, w, 14, v]);
    });
    // ship mode reticle
    if (st.ship) {
      ctx.strokeStyle = "rgba(125,211,252,.8)"; ctx.lineWidth = 1.2; const cx = W / 2, cy = H / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 2 * Math.PI); ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 18, cy); ctx.moveTo(cx + 18, cy); ctx.lineTo(cx + 26, cy);
      ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 18); ctx.moveTo(cx, cy + 18); ctx.lineTo(cx, cy + 26); ctx.stroke();
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > 1) { ctx.strokeStyle = "rgba(224,242,254,.25)"; for (let i = 0; i < 14; i++) { const h = hash("s" + i), x = (h % 1000) / 1000 * W, y = ((h >>> 10) % 1000) / 1000 * H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ship.vx * 3, y + ship.vy * 3); ctx.stroke(); } }
      ctx.fillStyle = "rgba(186,230,253,.8)"; ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(MOBILE ? "SHIP · TAP A BODY OR SPACE TO WARP" : "SHIP · WASD TO FLY · Q/E ZOOM · CLICK TO WARP", cx, 60);
    }
  }
  function placeBody(type, sx, sy) {
    const [x, y] = toWorld(sx, sy), b = { id: "b" + Date.now().toString(36), type, x, y, target: null, name: "" };
    if (type === "blackhole") b.target = "stale";
    if (type === "binary") b.target = mocs.slice(0, 2).map(m => m.id).filter(id => byId[id]);
    cos.bodies.push(b);
    if (cos.auto.motion) { if (type === "planet") releaseBody(b, 0, 0); else circularHere(b, null); }
    st.placing = null; root.classList.remove("is-placing"); $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", "false"));
    cosmosCapture(); selectBody(b.id); persistSoon(); alpha = Math.max(alpha, 0.4); kick();
    if (type === "star" || type === "planet" || type === "repulsor") toast(type === "star" ? "Pick the note or MOC this star is" : "Type a search for this " + BODY[type].label.toLowerCase());
  }
  function selectBody(id) {
    select(null); st.body = id; const b = cos.bodies.find(x => x.id === id); if (!b) { st.body = null; return; }
    st.follow = cos.auto.motion ? id : null;
    const box = $(".vg-inspector"); box.hidden = false; root.classList.add("has-inspector");
    const got = (bodyCaptured.get(b.id) || []).filter(i => byId[i]), hp = health(b);
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
    const noteOpts = cur => mocs.filter(m => byId[m.id]).map(m => opt(m.id, "Map · " + m.title, cur)).join("") + ranked.slice(0, 40).map(i => opt(i, byId[i].name, cur)).join("");
    const cfg = b.type === "star" ? `<div class="vg-field"><span class="vg-flabel">Centre</span><button class="vg-btn" data-b="pick">${icon("search", 14)} ${b.target && byId[b.target] ? esc(byId[b.target].name) : "Choose a note or MOC…"}</button></div>`
      : b.type === "binary" ? `<div class="vg-field"><span class="vg-flabel">Stars</span><select class="vg-select" data-b="ba">${noteOpts((b.target || [])[0])}</select><select class="vg-select" data-b="bb">${noteOpts((b.target || [])[1])}</select></div>`
      : b.type === "blackhole" ? `<div class="vg-field"><span class="vg-flabel">Swallows</span><select class="vg-select" data-b="filter">${Object.entries(BH_FILTERS).map(([k, l]) => opt(k, l, b.target)).join("")}</select></div>`
      : `<div class="vg-field"><span class="vg-flabel">Search</span><input class="vg-input" data-b="query" value="${esc(b.target || "")}" placeholder="tag:technology/aws · folder:02-Projects · cluster:5 · moc:Odoo · words" list="vg-q-suggest">
         <datalist id="vg-q-suggest">${[...new Set(nodes.flatMap(n => n.tags || []))].sort().slice(0, 200).map(x => `<option value="tag:${esc(x)}">`).join("")}${mocs.map(m => `<option value="moc:${esc(m.title)}">`).join("")}</datalist></div>`;
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:#fbbf24">${BODY[b.type].glyph} ${BODY[b.type].label}</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${esc(bodyName(b))}</h2><div class="vg-muted vg-ins-path">${esc(BODY[b.type].hint)}</div>
      <div class="vg-field"><span class="vg-flabel">Name</span><input class="vg-input" data-b="name" value="${esc(b.name || "")}" placeholder="${esc(bodyName(b))}"></div>
      ${cfg}
      ${cos.auto.motion && b.rx != null ? `<div class="vg-physline">${esc(orbitText(b))}</div>` : ""}
      ${gmOf(b) ? `<div class="vg-physline">GM ${Math.round(gmOf(b))} · ${b.type === "blackhole" ? `r<sub>s</sub> ${rsOf(b)} · ISCO ${3 * rsOf(b)}` : b.type === "binary" ? `binary period ${Math.round(2 * Math.PI / Math.sqrt(2 * gmOf(b) / Math.pow(BIN_SEP, 3)) / 60)} s` : `orbit 1 link out: ${periodSec(b, 85).toFixed(1)} s · 3 links: ${periodSec(b, 195).toFixed(1)} s`} <span class="vg-muted">(Kepler: T = 2π√(r³/GM))</span></div>` : ""}
      <div class="vg-field"><label class="vg-flabel">Gravity <b class="vg-mass-val">${(b.mass || 1).toFixed(1)}×</b></label><input type="range" class="vg-range" data-b="mass" min="0.3" max="3" step="0.1" value="${b.mass || 1}" aria-label="Gravity"></div>
      ${hp != null ? `<div class="vg-kvs"><div class="vg-kv"><b>${got.length}</b><span>in orbit</span></div><div class="vg-kv"><b>${hp}%</b><span>healthy</span></div><div class="vg-kv"><b>${got.filter(i => inMoc(i) === false).length}</b><span>not in a map</span></div></div>` : ""}
      <div class="vg-ins-actions vg-wrap"><button class="vg-btn" data-b="light">${icon("target", 14)} Light up</button><button class="vg-btn vg-btn-ghost" data-b="del">Remove body</button></div>
      <div class="vg-ins-sec"><div class="vg-ins-h">${b.type === "blackhole" ? "Review queue" : "Captured"} <span class="vg-count">${got.length}</span></div>
        ${got.sort((x, y) => byId[y].bc - byId[x].bc).slice(0, 40).map(i => b.type === "blackhole"
          ? `<div class="vg-bh-row">${noteRow(i, `${byId[i].age} days since edit · ${esc(clusterName(byId[i].cluster))}`)}<span class="vg-bh-acts">
             ${opts.stampReviewed ? `<button class="vg-btn vg-btn-sm" data-bhr="${esc(i)}" title="Stamp reviewed: today in its frontmatter">Reviewed</button>` : ""}
             ${opts.moveNote ? `<button class="vg-btn vg-btn-sm" data-bha="${esc(i)}" title="Move to ${FOLDERS.archive} (links keep working)">Archive</button>` : ""}
             <button class="vg-btn vg-btn-sm vg-btn-ghost" data-bhk="${esc(i)}" title="Keep it out of this black hole">Keep</button></span></div>`
          : noteRow(i, esc(clusterName(byId[i].cluster)))).join("") || `<div class="vg-empty">Nothing captured yet — configure it above.</div>`}</div>`;
    const q = s => box.querySelector(`[data-b="${s}"]`), changed = () => { cosmosCapture(); persistSoon(); alpha = Math.max(alpha, 0.4); kick(); selectBody(b.id); };
    box.querySelector(".vg-ins-close").onclick = () => { st.body = null; box.hidden = true; root.classList.remove("has-inspector"); };
    q("name").onchange = e => { b.name = e.target.value.trim(); changed(); };
    q("mass").oninput = e => { b.mass = +e.target.value; box.querySelector(".vg-mass-val").textContent = b.mass.toFixed(1) + "×"; alpha = Math.max(alpha, 0.4); kick(); persistSoon(); };
    if (q("pick")) q("pick").onclick = () => openPalette({ pickFor: b.id });
    if (q("ba")) q("ba").onchange = e => { b.target = [e.target.value, (b.target || [])[1]]; changed(); };
    if (q("bb")) q("bb").onchange = e => { b.target = [(b.target || [])[0], e.target.value]; changed(); };
    if (q("filter")) q("filter").onchange = e => { b.target = e.target.value; changed(); };
    if (q("query")) q("query").onchange = e => { b.target = e.target.value.trim(); changed(); };
    q("light").onclick = () => setHighlight(new Set(got), bodyName(b));
    box.querySelectorAll("[data-bhr]").forEach(x => x.onclick = async e => { e.stopPropagation(); const id = x.dataset.bhr;
      if (await VGActions.run("current", byId[id], actionCtx(), e)) changed(); });
    box.querySelectorAll("[data-bha]").forEach(x => x.onclick = async e => { e.stopPropagation(); const id = x.dataset.bha;
      if (await VGActions.run("archive", byId[id], actionCtx(), e)) { cos.kept = [...(cos.kept || []), id]; changed(); } });
    box.querySelectorAll("[data-bhk]").forEach(x => x.onclick = e => { e.stopPropagation(); cos.kept = [...new Set([...(cos.kept || []), x.dataset.bhk])]; logDiscovery(`Kept ${byId[x.dataset.bhk].name}`); changed(); });
    q("del").onclick = () => { cos.bodies = cos.bodies.filter(x => x !== b); st.body = null; box.hidden = true; root.classList.remove("has-inspector"); cosmosCapture(); persistSoon(); kick(); };
    wire(box); wireSheet(box);
  }
  function seedCosmos() {   // first visit: each map of content becomes a star, plus a black hole for stale notes
    const ms = mocs.filter(m => byId[m.id]).slice(0, 6);
    ms.forEach((m, i) => { const a = i / Math.max(1, ms.length) * 2 * Math.PI; cos.bodies.push({ id: "b" + i + Date.now().toString(36), type: "star", x: Math.cos(a) * 340, y: Math.sin(a) * 260, target: m.id, name: "" }); });
    cos.bodies.push({ id: "bh" + Date.now().toString(36), type: "blackhole", x: -40, y: -470, target: "stale", name: "" });
  }

  // ---- game layer: missions and achievements, all measured from the vault itself
  const RANKS = [[0, "Cadet"], [50, "Navigator"], [150, "Cartographer"], [300, "Astronomer"], [600, "Architect"]];
  const rankOfXp = xp => RANKS.filter(r => xp >= r[0]).pop()[1];
  const ACH = [
    { id: "first", name: "First contact", hint: "Do one of the day's three", test: () => (cos.done || []).length >= 1 || !!(cos.daily && cos.daily.quests.some(q => q.done)) },
    { id: "wormholes", name: "Wormhole engineer", hint: "Link 5 suggested pairs", test: () => (cos.log || []).filter(e => /^Linked/.test(e.text)).length >= 5 },
    { id: "cartographer", name: "Cartographer", hint: "Every topic of 6+ notes has a map", test: () => DATA.clusters.filter(c => c.size >= 6).every(c => mocOf[c.id]) },
    { id: "complete", name: "Complete atlas", hint: "A map lists every note in its topic", test: () => mocs.some(m => m.clusters.every(c => !(m.missing[c] || []).length)) },
    { id: "nebula", name: "Nebula tamer", hint: "Fewer than 150 unlinked notes", test: () => nodes.filter(n => n.isolated && !special(n)).length < 150 },
    { id: "gardener", name: "Gardener", hint: "Act on 5 suggestions between two analyses", test: () => ((DATA.changes || {}).acted || []).length >= 5 },
    { id: "constellations", name: "Constellations", hint: "Save 3 views", test: () => savedViews.length >= 3 },
  ];

  // ---- game: XP for real actions, streaks, daily quests, weekly challenge, vault health, themes
  // XP only ever comes from things that changed the vault (or your review queue) -- never from clicking around.
  const XP_FOR = [[/^Linked/, 10], [/^Added/, 5], [/^Checked off/, 3], [/^Cancelled/, 1], [/^Completed/, 5], [/^Reviewed/, 3], [/^Moved/, 3], [/^Archived/, 2], [/^Logged an update/, 4],
    [/^(Hub note|Bridge note|Map note)/, 15], [/^Applied/, 10], [/^Dismissed/, 1], [/^Kept/, 1]];
  const THEMES = {
    classic: { name: "Classic", xp: 0, star: ["255,247,214", "253,224,71", "251,146,60"], grid: "#5b8cff" },
    aurora: { name: "Aurora", xp: 50, star: ["220,255,240", "74,222,128", "168,85,247"], grid: "#34d399" },
    solar: { name: "Solar flare", xp: 150, star: ["255,240,230", "251,113,133", "249,115,22"], grid: "#fb7185" },
    gold: { name: "Gold", xp: 300, star: ["255,251,235", "250,204,21", "202,138,4"], grid: "#facc15" },
    prism: { name: "Prism", xp: 600, star: ["240,249,255", "56,189,248", "232,121,249"], grid: "#a78bfa" },
  };
  const theme = () => THEMES[cos.theme] && cos.xp >= THEMES[cos.theme].xp ? THEMES[cos.theme] : THEMES.classic;
  function awardXp(n, why) {
    if (!n) return;
    const before = rankOfXp(cos.xp); cos.xp += n;
    const after = rankOfXp(cos.xp);
    if (after !== before) { celebrate(`Rank up: ${after}`); toast(`Rank up — you're now ${after}!`, "ok"); const th = Object.values(THEMES).find(x => x.xp === RANKS.find(r => r[1] === after)[0]); if (th) toast(`Unlocked the ${th.name} Cosmos theme`, "ok"); }
    persistSoon();
  }
  function streak() {
    const days = new Set((cos.log || []).filter(e => !/^Warped/.test(e.text)).map(e => e.date));
    let d = new Date(), n = 0;
    if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);   // today not done yet: the streak still stands
    while (days.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function vaultHealth() {
    const notes = nodes.filter(n => !special(n)), iso = notes.filter(n => n.isolated).length;
    const big = DATA.clusters.filter(c => c.size >= 6), size = big.reduce((s, c) => s + c.size, 0);
    const covered = big.reduce((s, c) => { const m = mocOf[c.id]; return s + (m ? c.size - (m.missing[c.id] || []).length : 0); }, 0);
    const fresh = notes.filter(n => !staleFor(n, Q.stale_days)).length / Math.max(1, notes.length);
    return Math.round(100 * (0.4 * (1 - iso / Math.max(1, notes.length)) + 0.35 * (size ? covered / size : 0) + 0.25 * fresh));
  }
  const questDone = q => VGRules.questDone(q, liveGraph);
  function ensureDaily() {
    if (cos.daily && cos.daily.date === today()) return;
    cos.daily = { date: today(), bonus: false, quests: VGRules.todayPick(todayItems()) };
  }
  // the next item not already picked, to fill a pick that was hidden or skipped
  const nextPick = () => { const have = new Set(cos.daily.quests.map(q => q.key)); return VGRules.todayPick(todayItems().filter(it => !have.has(it.key)), 1)[0]; };
  // "Not for me" (from the sidebar or another device): the item goes, and stays gone; a pick is replaced with the next
  // item so the day still has three
  function hideGameItem(key) {
    cos.hidden = [...new Set([...(cos.hidden || []), key])].slice(-500);
    if (cos.daily && cos.daily.quests && cos.daily.quests.some(q => q.key === key)) {
      cos.daily.quests = cos.daily.quests.filter(q => q.key !== key);
      const next = nextPick(); if (next) cos.daily.quests.push(next);
    }
    updateGame(false); persistSoon();
  }
  const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
  const weeklyCount = () => (cos.log || []).filter(e => e.date >= weekStart() && /^Linked/.test(e.text)).length;
  function updateDaily(announce) {
    ensureDaily();
    cos.daily.quests.forEach(q => { if (!q.done && questDone(q)) { q.done = true; awardXp(8, "quest"); if (announce) toast(`Daily quest done: ${q.title} · +8 XP`, "ok"); } });
    if (!cos.daily.bonus && cos.daily.quests.length && cos.daily.quests.every(q => q.done)) { cos.daily.bonus = true; awardXp(25, "daily bonus"); if (announce) { celebrate("All daily quests"); toast("All three daily quests done · +25 XP", "ok"); } }
    const wk = weekStart();
    if (!cos.weekly || cos.weekly.week !== wk) cos.weekly = { week: wk, claimed: false };
    if (!cos.weekly.claimed && weeklyCount() >= 10) { cos.weekly.claimed = true; awardXp(50, "weekly"); if (announce) { celebrate("Weekly challenge"); toast("Weekly challenge: 10 links this week · +50 XP", "ok"); } }
  }
  // celebration bursts (screen space; drawn over any view)
  const bursts = [];
  function celebrate(label) {
    if (reducedMotion() || !W) return;
    const cols = ["#fbbf24", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa"];
    bursts.push({ x: W / 2, y: H / 2, t0: performance.now(), label, parts: Array.from({ length: 70 }, (_, i) => { const a = Math.random() * 2 * Math.PI, v = 2 + Math.random() * 6; return [Math.cos(a) * v, Math.sin(a) * v - 2, cols[i % cols.length]]; }) });
    kick();
  }
  function drawBursts(now) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], t = (now - b.t0) / 1000; if (t > 1.8) { bursts.splice(i, 1); continue; }
      for (const [vx, vy, c] of b.parts) { const x = b.x + vx * t * 60, y = b.y + vy * t * 60 + 90 * t * t; ctx.globalAlpha = Math.max(0, 1 - t / 1.8); ctx.fillStyle = c; ctx.fillRect(x, y, 3, 3); }
      ctx.globalAlpha = Math.max(0, 1 - t / 1.8); ctx.fillStyle = "#fde68a"; ctx.font = `700 18px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(b.label.toUpperCase(), b.x, b.y - 40 - t * 20);
    }
    ctx.globalAlpha = 1;
    return bursts.length > 0;
  }

  // A pick built on a suggestion that no longer exists (relinked elsewhere, dismissed, or the analysis no longer
  // finds the pair related) is dropped, not left as a dead end.
  const stillSuggested = (a, b) => links.some(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.id === a && l.t.id === b) || (l.s.id === b && l.t.id === a)));
  const stillValid = m => VGRules.missionValid(m, liveGraph);
  function updateGame(announce) {
    if (cos.daily && cos.daily.quests) cos.daily.quests = cos.daily.quests.filter(q => q.done || stillValid(q));
    updateDaily(announce);
    ACH.forEach(a => { if (!cos.ach[a.id] && a.test()) { cos.ach[a.id] = today(); if (announce) { toast(`Achievement unlocked: ${a.name}`, "ok"); celebrate(a.name); } } });
    renderTodayList(); persistSoon();
  }
  // The Today panel is the same in every view: the cosmos shows it by default, the toolbar star (G) shows or hides
  // it anywhere, and that choice sticks for this pane
  let missionsPref = null;
  function setMissionsShown(on, byHand) {
    if (byHand) missionsPref = on;
    if (on) closeDrawer();
    root.classList.toggle("show-missions", !!on);
    const b = $(".vg-gamebtn"); if (b) b.setAttribute("aria-pressed", String(!!on));
    if (on) renderMissions();
  }
  $(".vg-gamebtn").onclick = () => setMissionsShown(!root.classList.contains("show-missions"), true);
  let missionsInit = false;
  function renderMissions() {
    const box = $(".vg-missions"); if (!box) return;
    if (!missionsInit) { missionsInit = true; if (narrow()) box.classList.add("is-collapsed"); }
    ensureDaily();
    const next = RANKS.find(r => r[0] > cos.xp), prev = RANKS.filter(r => r[0] <= cos.xp).pop(), pct = next ? Math.round(100 * (cos.xp - prev[0]) / (next[0] - prev[0])) : 100;
    const sk = streak(), wk = weeklyCount();
    box.innerHTML = `<button class="vg-ms-head" aria-expanded="${!box.classList.contains("is-collapsed")}"><b>TODAY</b><span>${sk ? `🔥${sk} · ` : ""}${rankOfXp(cos.xp).toUpperCase()} · ${cos.xp} XP</span></button>
      <div class="vg-ms-rank"><i style="width:${pct}%"></i></div>
      <div class="vg-ms-body">
        <div class="vg-ms-stats"><span><b>${vaultHealth()}</b> vault health</span><span><b>${sk}</b>-day streak</span><span>${next ? `<b>${next[0] - cos.xp}</b> XP to ${next[1]}` : "<b>MAX</b> rank"}</span></div>
        <div class="vg-ms-sec">TODAY ${cos.daily.bonus ? "· ✓ +25 BONUS" : "· +8 EACH OF THE THREE, +25 FOR ALL"}</div>
        <div class="vg-ms-today">${todayHtml(4)}</div>
        <div class="vg-ms-sec">WEEKLY · LINK 10 NOTES ${cos.weekly && cos.weekly.claimed ? "· ✓ +50" : "· +50"}</div>
        <div class="vg-ms-bar"><i style="width:${Math.min(100, wk * 10)}%"></i></div><div class="vg-ms-how">${Math.min(wk, 10)} / 10 this week</div>
        <details class="vg-ms-log"><summary>DISCOVERY LOG · ${(cos.log || []).length}</summary>${(cos.log || []).slice(0, 25).map(e => `<div><span>${esc(e.date.slice(5))}</span> ${esc(e.text)}</div>`).join("") || "<div>Nothing yet — act on a suggestion.</div>"}</details>
        <div class="vg-ms-sec is-theme">COSMOS THEME</div><div class="vg-ms-themes">${Object.entries(THEMES).map(([k, th]) => `<button class="vg-ms-theme ${theme() === th ? "is-on" : ""}" data-theme="${k}" ${cos.xp < th.xp ? "disabled" : ""} title="${cos.xp < th.xp ? `Unlocks at ${RANKS.find(r => r[0] === th.xp)[1]} (${th.xp} XP)` : th.name}" style="--a:rgb(${th.star[1]});--b:rgb(${th.star[2]})"><i></i>${esc(th.name)}${cos.xp < th.xp ? " 🔒" : ""}</button>`).join("")}</div>
        <div class="vg-ms-ach">${ACH.map(a => `<span class="vg-ach ${cos.ach[a.id] ? "is-on" : ""}" title="${esc(a.name)} — ${esc(a.hint)}${cos.ach[a.id] ? " (unlocked " + cos.ach[a.id] + ")" : ""}">${esc(a.name)}</span>`).join("")}</div></div>`;
    box.querySelector(".vg-ms-head").onclick = () => { box.classList.toggle("is-collapsed"); renderMissions(); };
    wireToday(box); wireMore(box);
    box.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { cos.theme = b.dataset.theme; persistSoon(); renderMissions(); dirty = true; kick(); });
  }
  $$(".vg-dockbtn").forEach(b => b.onclick = () => {
    const on = st.placing !== b.dataset.body; st.placing = on ? b.dataset.body : null;
    $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", x === b && on)); root.classList.toggle("is-placing", on);
    if (on) toast(`${BODY[b.dataset.body].hint}. Click in space to place it.`); dirty = true; kick();
  });
  $$(".vg-arrangebtn").forEach(b => b.onclick = () => arrangeOrbits(true));
  $$(".vg-autobtn").forEach(b => b.onclick = () => { const k = b.dataset.auto; cos.auto[k] = !cos.auto[k]; b.setAttribute("aria-pressed", cos.auto[k]); if (isCosmos()) cosmosCapture(); persistSoon(); alpha = Math.max(alpha, 0.2); kick(); });
  // ---- deeper cosmos: moons, supernovas, constellations, time travel, expeditions, ship
  let moonSpots = [], constSpots = [];
  const ship = { vx: 0, vy: 0, keys: new Set() };
  function shipStep() {
    const acc = 0.9 / Math.max(0.3, Math.sqrt(cam.k)), k = ship.keys;
    if (k.has("w") || k.has("arrowup")) ship.vy += acc; if (k.has("s") || k.has("arrowdown")) ship.vy -= acc;
    if (k.has("a") || k.has("arrowleft")) ship.vx += acc; if (k.has("d") || k.has("arrowright")) ship.vx -= acc;
    if (k.has("q")) cam.k = Math.max(0.05, cam.k * 0.985); if (k.has("e")) cam.k = Math.min(8, cam.k * 1.015);
    ship.vx *= 0.92; ship.vy *= 0.92; cam.tx += ship.vx; cam.ty += ship.vy; cam.userMoved = true;
    return Math.abs(ship.vx) + Math.abs(ship.vy) > 0.05 || k.size > 0;
  }
  function warpTo(sx, sy) {
    const b = bodyHit(sx, sy), [wx, wy] = b ? [b.x, b.y] : toWorld(sx, sy);
    animateTo({ tx: -(wx - cam.cx) * cam.k, ty: -(wy - cam.cy) * cam.k, k: b ? Math.max(cam.k, 1.2) : cam.k }, 900);
    if (b) logDiscovery(`Warped to ${bodyName(b)}`);
  }
  function setShip(on) {
    st.ship = on; ship.vx = ship.vy = 0; ship.keys.clear();
    $$(".vg-shipbtn").forEach(x => x.setAttribute("aria-pressed", on)); root.classList.toggle("is-ship", on);
    if (on) toast(MOBILE ? "Ship mode — tap a body or open space to warp there" : "Ship mode — WASD to fly, Q/E to zoom, click to warp"); dirty = true; kick();
  }
  root.addEventListener("keyup", e => ship.keys.delete(e.key.toLowerCase()));
  // time travel: show the vault as it was -- notes appear on the day they were born
  const bornDays = nodes.filter(n => n.born && !special(n)).map(n => n.born).sort();
  const timeMonths = (() => { if (!bornDays.length) return []; const out = []; let d = new Date(bornDays[0].slice(0, 7) + "-01T12:00"); const end = new Date();
    while (d <= end) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } return out; })();
  let timePlay = 0;
  function setTime(idx) {
    if (idx == null || idx >= timeMonths.length - 1) { st.timeAt = null; } else { const m = timeMonths[idx]; const end = new Date(m + "-01T12:00"); end.setMonth(end.getMonth() + 1); end.setDate(0); st.timeAt = end.toISOString().slice(0, 10); }
    rebuild(true); if (isCosmos()) cosmosCapture();
    const lab = $(".vg-time-label"); if (lab) lab.textContent = st.timeAt ? `${st.timeAt.slice(0, 7)} · ${active.filter(n => !special(n)).length} notes` : "Now";
    renderToday();   // the strip describes the map as of that month
  }
  function toggleReplay() { if (replay) stopReplay(); else startReplay(); }
  function startReplay() {
    if (isCosmos()) { toast("Replay works in 2D, 3D and neural", "warn"); return; }
    const pool = nodes.filter(n => baseVisible(n));
    const dated = pool.filter(n => n.born).sort((a, b) => a.born < b.born ? -1 : a.born > b.born ? 1 : b.bc - a.bc);
    if (dated.length < 5) { toast("Not enough creation dates to replay", "warn"); return; }
    const order = [...dated, ...pool.filter(n => !n.born)].map(n => n.id);   // undated notes (maps, people…) arrive last
    if (st.focusDist) exitFocus();
    select(null); clearHighlight(); clearMulti();
    if (neural()) brainLayout(false);   // lay out the whole brain once; notes then light up in place
    else if (!isCosmos()) alpha = 0;     // hold the map still: notes appear where they live
    fit(neural() ? n => !special(n) : null, 400);
    replay = { order, shown: new Set(), k: 0, t0: performance.now() + 450, dur: Math.max(6000, Math.min(20000, order.length * 25)), built: 0 };
    $(".vg-replay").hidden = false; $(".vg-replaybtn").setAttribute("aria-pressed", "true"); syncToolsBtn(); $(".vg-replaybtn").innerHTML = icon("stop");
    rebuild(false); kick();
  }
  function stepReplay(now) {
    const R = replay, p = Math.max(0, Math.min(1, (now - R.t0) / R.dur)), k = Math.ceil(p * R.order.length);
    for (; R.k < k; R.k++) { R.shown.add(R.order[R.k]); popAt.set(R.order[R.k], now); }
    if (now - R.built > 70 || p >= 1) {   // re-filter the drawn set a few times a second, not every frame
      R.built = now; rebuild(false);
      const last = byId[R.order[Math.max(0, R.k - 1)]], day = last && last.born;
      $(".vg-replay-date").textContent = day ? new Date(day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
      $(".vg-replay-count").textContent = `${R.k} / ${R.order.length} notes`;
      $(".vg-replay-bar i").style.width = (p * 100).toFixed(1) + "%";
    }
    if (p >= 1) setTimeout(() => { if (replay === R) stopReplay(); }, 900);
  }
  function stopReplay() {
    if (!replay) return;
    replay = null; popAt.clear();
    $(".vg-replay").hidden = true; $(".vg-replaybtn").setAttribute("aria-pressed", "false"); syncToolsBtn(); $(".vg-replaybtn").innerHTML = icon("play");
    rebuild(false); dirty = true; kick();
  }
  $(".vg-replaybtn").onclick = () => toggleReplay();
  $(".vg-replay-stop").onclick = () => stopReplay();
  function toggleTimebar(on) {
    const bar = $(".vg-timebar"); bar.hidden = !on; $$(".vg-timebtn").forEach(x => x.setAttribute("aria-pressed", on)); syncToolsBtn();
    if (!on) { clearInterval(timePlay); timePlay = 0; setTime(null); return; }
    const r = bar.querySelector("input"); r.max = Math.max(0, timeMonths.length - 1); r.value = r.max; setTime(null);
  }
  $(".vg-timebar input").oninput = e => setTime(+e.target.value);
  $(".vg-time-play").onclick = () => {
    const r = $(".vg-timebar input");
    if (timePlay) { clearInterval(timePlay); timePlay = 0; $(".vg-time-play").textContent = "▶"; return; }
    if (+r.value >= +r.max) r.value = 0;
    $(".vg-time-play").textContent = "❚❚";
    timePlay = setInterval(() => { r.value = +r.value + 1; setTime(+r.value); if (+r.value >= +r.max) { clearInterval(timePlay); timePlay = 0; $(".vg-time-play").textContent = "▶"; } }, 700);
  };
  $$(".vg-timebtn").forEach(b => b.onclick = () => toggleTimebar($(".vg-timebar").hidden));
  $$(".vg-shipbtn").forEach(b => b.onclick = () => setShip(!st.ship));
  $$(".vg-pausebtn").forEach(b => b.onclick = () => setPaused(!st.paused));
  $(".vg-pausepill").onclick = () => setPaused(false);
  const WARPS = [0.25, 0.5, 1, 2, 4];
  $$(".vg-warpbtn").forEach(b => b.onclick = () => { st.warp = WARPS[(WARPS.indexOf(st.warp || 1) + 1) % WARPS.length]; $$(".vg-warpval").forEach(x => x.textContent = st.warp + "×"); });
  // ---------------------------------------------------------------- lenses: other ways to look at the same data
  // An empty state says what's missing and offers the next step, so no panel ends with nothing to do (a test opens every
  // lens on a near-empty vault and fails on one with nothing to click). Steps: "lens:<key>", "draftmap:<cluster>", "daily",
  // "new:person", "new:context", "search". A step whose hook is missing (the page alone can't write) is left out; search
  // is always there.
  function emptyNext(text, ...steps) {
    const btn = s => { const [k, arg] = s.split(":");
      if (k === "lens") return LENSES[arg] ? `<button class="vg-btn vg-btn-sm" data-relens="${arg}">${esc(LENSES[arg].name)}</button>` : "";
      if (k === "draftmap") return opts.writeNote && clusterById[arg] ? `<button class="vg-btn vg-btn-sm" data-draftmap="${arg}">${icon("plus", 12)} Draft a map for ${esc(shortName(+arg))}</button>` : "";
      if (k === "daily") return opts.openDaily ? `<button class="vg-btn vg-btn-sm" data-next="daily">${icon("open", 12)} Today's daily note</button>` : "";
      if (k === "new") return opts.writeNote && NEW_KINDS[arg] ? `<button class="vg-btn vg-btn-sm" data-next="${s}">${icon("plus", 12)} ${NEW_KINDS[arg].label}</button>` : "";
      return `<button class="vg-btn vg-btn-sm" data-next="search">${icon("search", 12)} Search notes</button>`; };
    const bs = steps.map(btn).filter(Boolean);
    if (!bs.length) bs.push(btn("search"));
    return `<div class="vg-empty">${text}</div><div class="vg-ins-actions vg-empty-next">${bs.join("")}</div>`;
  }
  // the buttons emptyNext draws (a lens, a new note, search), working wherever it was drawn
  function wireNext(el) {
    el.querySelectorAll("[data-relens]").forEach(d => d.onclick = e => { e.stopPropagation(); openLens(d.dataset.relens); });
    el.querySelectorAll("[data-next]").forEach(d => d.onclick = e => { e.stopPropagation(); runNext(d.dataset.next); });
  }
  // the notes an empty state can start: where each goes, its tag (from the registry) and its name's suffix
  const NEW_KINDS = {
    note: { label: "New note", ask: "Name", folder: () => FOLDERS.inbox, suffix: "", tag: "", extra: "" },
    person: { label: "New person", ask: "Name", folder: () => FOLDERS.people, suffix: "", tag: "meta/people", extra: "type: person\n" },
    context: { label: "New project context", ask: "Project name", folder: () => FOLDERS.inbox, suffix: " - Context", tag: "meta/context", extra: "" },
  };
  async function runNext(step) {
    if (step === "search") { closeLens(); openPalette(); return; }
    if (step === "daily") { opts.openDaily(); return; }
    const K = NEW_KINDS[step.split(":")[1]]; if (!K) return;
    const name = await confirmBox(K.label, `A note in ${esc(K.folder())}.`, "Create", K.ask);
    if (name) createNote(K, name);
  }
  async function createNote(K, name) {
    const title = safeName(name.split("\n")[0].trim()) + K.suffix, path = `${K.folder()}/${title}.md`;
    const md = `---\ncreated: ${today()}\n${K.tag ? `tags:\n  - ${K.tag}\n` : ""}${K.extra}---\n# ${title}\n\n`;
    try { await opts.writeNote(path, md, { mode: "create", open: true }); toast(`Created ${title}`, "ok"); }
    catch (e) { toast(e.message, "warn"); }
  }
  const LENSES = {
    matrix: { name: "Topic matrix", hint: "Every pair of topics: links vs. co-mentions — red cells are gaps", render: lensMatrix },
    timeline: { name: "Timeline", hint: `What your dailies talked about, week by week (${(DATA.timeline || { weeks: [] }).weeks.length} weeks)`, render: lensTimeline },
    folders: { name: "Folders vs topics", hint: "Where folder structure disagrees with what notes are about", render: lensFolders },
    projects: { name: "Project board", hint: "Context notes as cards: activity, tasks, staleness", render: lensProjects },
    people: { name: "People", hint: "Who you work with on which topics", render: lensPeople },
    river: { name: "Topic river", hint: "Your dailies' topics as a stream over time, and each month's top topics", render: lensRiver },
    maptree: { name: "Map tree", hint: "Each map's topics: what it lists, what it's missing — add in place", render: lensMapTree },
    ring: { name: "Folder ring", hint: "Links between folders — thin chords are knowledge that doesn't connect", render: lensRing },
    stale: { name: "Important but stale", hint: "Notes your work leans on that haven't been edited in a while", render: lensStale },
    write: { name: "Write these next", hint: "Links to notes that don't exist yet, and short notes many others rely on", render: lensWrite },
    follow: { name: "Standup follow-through", hint: "What you planned for tomorrow vs. what the next standups say got done", render: lensFollow },
    dupes: { name: "Duplicates", hint: "Likely duplicate notes side by side, with the links each one has", render: lensDupes },
    ...((DATA.code && (DATA.code.repos || []).length) ? { code: { name: "Code ↔ docs", hint: "Code that changes often with no note, and notes that have fallen behind their code", render: lensCode } } : {}),   // only where work repos exist
    path: { name: "Reading path", hint: "An ordered reading list for getting up to speed on a topic", render: lensPath },
    triage: { name: "Stale triage", hint: "Old notes sorted by what to do: relied on, holding tasks, unconnected, the rest", render: lensTriage },
    blind: { name: "Blind spots", hint: "What you name but never link, topics gone quiet, islands and dead ends", render: lensBlind },
    adjacent: { name: "Adjacent possible", hint: "Notes one step past what you're working on, and strange pairs to combine", render: lensAdjacent },
    ...(opts.mocReport ? { mocalign: { name: "MOC alignment", hint: "Tick the report's rows here; apply when ready", render: () => "", load: lensMocAlign } } : {}),
  };
  let lensKey = null;
  $(".vg-lens-close").onclick = () => closeLens();
  function openLens(k) {
    lensKey = k; closeDrawer(); const box = $(".vg-lens"), l = LENSES[k];
    box.hidden = false; box.dataset.lens = k; root.classList.add("has-lens");
    $(".vg-lens-title").textContent = l.name; $(".vg-lens-sub").textContent = l.hint;
    const body = $(".vg-lens-body"), none = !nodes.some(n => !special(n) && !n.ghost);
    body.innerHTML = none ? emptyNext("No notes in the graph yet.", "new:note") : l.render(); body.scrollTop = 0;
    body.querySelectorAll("[data-id]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); reveal(d.dataset.id); });
    body.querySelectorAll("[data-cl]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); focusClusters(d.dataset.cl.split(",").map(Number)); });
    wireLens(body);
    if (l.load && !none) { body.innerHTML = `<div class="vg-empty">Loading…</div>`; l.load().then(html => { if (lensKey === k) { body.innerHTML = html; wireLens(body); } }); }
  }
  function wireLens(body) {
    // every note row in a lens gets the shared actions behind "⋯", whatever buttons the lens adds itself
    body.querySelectorAll(".vg-sugg, .vg-st-row, .vg-pb-card").forEach(row => {
      const item = row.querySelector("[data-id]"); if (!item || row.querySelector("[data-more]")) return;
      const btn = moreBtn(item.dataset.id); if (!btn) return;
      let acts = row.querySelector(".vg-sugg-acts, .vg-st-acts, .vg-pb-acts");
      if (!acts) { acts = document.createElement("span"); acts.className = "vg-sugg-acts"; row.appendChild(acts); }
      acts.insertAdjacentHTML("beforeend", btn);
    });
    wireFixes(body); wireMore(body);
    wireLensExtras(body);
    wireNext(body);
    body.querySelectorAll("[data-id]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); reveal(d.dataset.id); });
    body.querySelectorAll("[data-cl]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); focusClusters(d.dataset.cl.split(",").map(Number)); });
    body.querySelectorAll("[data-bridge]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [a, b] = d.dataset.bridge.split(",").map(Number);
      if (await confirmBox("Draft a bridge note", `Create a draft in ${FOLDERS.inbox} connecting <b>${esc(clusterName(a))}</b> and <b>${esc(clusterName(b))}</b>?`, "Create")) writeBridge(a, b); });
    body.querySelectorAll("[data-cell]").forEach(d => d.onclick = () => { body.querySelectorAll(".vg-mx-cell.is-on").forEach(x => x.classList.remove("is-on")); d.classList.add("is-on"); showCell(body, ...d.dataset.cell.split(",").map(Number)); });
    body.querySelectorAll("[data-move]").forEach(d => d.onclick = async e => {
      e.stopPropagation(); const id = d.dataset.move, to = d.dataset.to;
      if (!await confirmBox("Move note", `<div class="vg-move-prev"><span>${esc(id)}</span><b>→ ${esc(to)}/${esc(id.split("/").pop())}</b></div>Links to it are updated automatically. Nothing is deleted.`, "Move")) return;
      try { await opts.moveNote(id, to); d.disabled = true; d.textContent = "Moved"; logDiscovery(`Moved ${byId[id].name} to ${to}`); toast("Moved", "ok"); } catch (err) { toast("Couldn't move it", "warn"); }
    });
    body.querySelectorAll("[data-log]").forEach(d => d.onclick = async e => {
      e.stopPropagation(); const id = d.dataset.log;
      const text = await confirmBox(`Log an update · ${byId[id].name}`, `Appended under <b>Recent Changes (as of ${today()})</b>, as your context notes already do.`, "Append", "What changed?");
      if (!text) return;
      try { await opts.appendSection(id, `## Recent Changes (as of ${today()})`, text.split(/\n+/).map(x => `- ${x.replace(/^[-*]\s*/, "")}`)); logDiscovery(`Logged an update on ${byId[id].name}`); toast("Update logged", "ok"); }
      catch (err) { toast("Couldn't append", "warn"); }
    });
    body.querySelectorAll("[data-open]").forEach(d => d.onclick = e => { e.stopPropagation(); if (opts.openNote) opts.openNote(d.dataset.open, e.ctrlKey || e.metaKey); });
    body.querySelectorAll("[data-tasks]").forEach(d => d.onclick = e => { e.stopPropagation(); toggleTasks(d.dataset.tasks, d.closest(".vg-pb-card").querySelector(".vg-pb-tasks")); });
    body.querySelectorAll("[data-tasks]").forEach(d => { if (openTasks.has(d.dataset.tasks)) renderTasks(d.dataset.tasks, d.closest(".vg-pb-card").querySelector(".vg-pb-tasks")); });
    body.querySelectorAll("[data-pin]").forEach(d => d.onclick = e => { e.stopPropagation(); pinReview(d.dataset.pin); d.disabled = true; d.textContent = "In review"; });
    body.querySelectorAll("[data-mocrow]").forEach(cb => cb.onchange = async () => {
      try { await opts.mocReport.tick(+cb.dataset.mocrow, cb.checked); } catch (err) { cb.checked = !cb.checked; toast("Couldn't update the report", "warn"); }
    });
    const ap = body.querySelector("[data-mocapply]");
    if (ap) ap.onclick = async () => {
      if (!await confirmBox("Apply ticked rows", "Runs <code>moc_align.py --apply</code> on the report. Only ticked rows are applied; originals are snapshotted to .trash first.", "Apply")) return;
      ap.disabled = true;
      try { await opts.mocReport.apply(); logDiscovery("Applied the ticked MOC alignment rows"); toast("Applied", "ok"); }
      catch (err) { ap.disabled = false; }
    };
  }
  function showCell(body, a, b) {
    const box = body.querySelector(".vg-mx-detail"); if (!box) return;
    const sugg = links.filter(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.cluster === a && l.t.cluster === b) || (l.s.cluster === b && l.t.cluster === a)));
    const pr = (DATA.pairs || []).find(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)) || [a, b, 0, 0];
    box.innerHTML = `<div class="vg-card"><div class="vg-card-h"><span>${esc(clusterName(a))} ↔ ${esc(clusterName(b))}</span><span class="vg-muted vg-card-hint">${plural(pr[2], "link")} · ${pr[3]} co-mentions in your dailies</span></div>
      <div class="vg-ins-actions vg-wrap"><button class="vg-btn" data-cl="${a},${b}">${icon("target", 14)} Show both topics</button>
      ${opts.writeNote ? `<button class="vg-btn" data-bridge="${a},${b}">${icon("bridge", 14)} Draft bridge</button>` : ""}</div>
      ${sugg.length ? `<div class="vg-list-h">Suggested links</div>` + sugg.map(l => `<div class="vg-sugg"><button class="vg-item" data-id="${esc(l.s.id)}"><span class="vg-item-main"><span>${esc(l.s.name)} ↔ ${esc(l.t.name)}</span><span class="vg-item-sub">${esc(l.why)}</span></span></button>
        ${opts.linkNotes ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-mxlink="${esc(l.s.id)}|${esc(l.t.id)}">${icon("link", 12)} Link</button></span>` : ""}</div>`).join("") : `<div class="vg-empty">No specific note pairs suggested yet — a bridge note is the way in.</div>`}</div>`;
    wireLens(box);
    box.querySelectorAll("[data-mxlink]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [x, y] = d.dataset.mxlink.split("|");
      if (await confirmBox("Link these notes", `Link <b>${esc(byId[x].name)}</b> → <b>${esc(byId[y].name)}</b>?`, "Link")) { await actOnSuggestion("link", x, y, d); showCell(body, a, b); } });
    box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
  // open tasks of a note: complete (tick) or cancel each in place, or close the whole note. Writes go through the
  // plugin's task actions (setTaskStatus / setNoteTasks), which every view and the sidebar share.
  async function renderTasks(id, box) {
    if (!opts.readTasks) return;
    box.innerHTML = `<div class="vg-empty">Loading tasks…</div>`;
    const tasks = await opts.readTasks(id), dated = byId[id].taskItems || [];
    const ageOf = t => { const m = dated.find(d => t.trim().startsWith(d[0].slice(0, 40))); return m && m[1] ? Math.round((Date.now() - Date.parse(m[1] + "T12:00")) / 864e5) : null; };
    const all = tasks.length ? `<div class="vg-task-all"></div>` : "";
    box.innerHTML = all + (tasks.length ? tasks.slice(0, 30).map(tk => `<div class="vg-task"><label><input type="checkbox" data-line="${tk.line}" title="Complete"><span>${esc(tk.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1"))}${ageOf(tk.text) != null ? ` <span class="vg-muted">· ${ageOf(tk.text)}d</span>` : ""}</span></label>` +
      (opts.setTaskStatus ? `<button class="vg-ibtn vg-task-cancel" data-cancel="${tk.line}" title="Cancel this task" aria-label="Cancel task">${icon("close", 12)}</button>` : "") + `</div>`).join("") +
      (tasks.length > 30 ? `<div class="vg-empty">…and ${tasks.length - 30} more in the note</div>` : "") : `<div class="vg-empty">No open tasks.</div>`);
    const settle = (row, how, tk) => { row.classList.add(how === "-" ? "is-cancelled" : "is-done"); row.querySelectorAll("input,button").forEach(x => x.disabled = true);
      byId[id].tasks = Math.max(0, byId[id].tasks - 1); logDiscovery(`${how === "-" ? "Cancelled" : "Checked off"} “${tk.text.slice(0, 60)}” in ${byId[id].name}`); dirty = true; kick(); };
    const set = async (tk, how, row) => { row.querySelectorAll("input,button").forEach(x => x.disabled = true);
      try { await (opts.setTaskStatus ? opts.setTaskStatus(id, tk.line, tk.text, how) : opts.toggleTask(id, tk.line, tk.text)); settle(row, how, tk); }
      catch (err) { const cb = row.querySelector("input"); if (cb) cb.checked = false; row.querySelectorAll("input,button").forEach(x => x.disabled = false); } };
    box.querySelectorAll("input[data-line]").forEach(cb => cb.onchange = () => set(tasks.find(x => x.line === +cb.dataset.line), "x", cb.closest(".vg-task")));
    box.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => set(tasks.find(x => x.line === +b.dataset.cancel), "-", b.closest(".vg-task")));
    // close them all: the shared Complete / Cancel actions, the same as in the inspector and the sidebar
    const allBox = box.querySelector(".vg-task-all");
    if (allBox) { const c = actionCtx(); VGActions.render(allBox, VGActions.forNote({ ...byId[id], tasks: tasks.length }, c, ["complete", "cancel"]), { ...byId[id], tasks: tasks.length }, c, { btn: "vg-btn vg-btn-sm" }); }
  }
  // Task lists stay open across redraws: an action publishes new state, the panel redraws, and the lists that were
  // open come back open. Every panel that shows a note's tasks toggles them through here.
  const openTasks = new Set();
  function toggleTasks(id, box) {
    if (box.childElementCount) { box.innerHTML = ""; openTasks.delete(id); return; }
    openTasks.add(id); return renderTasks(id, box);
  }
  // Re-render the open lens in place (after an action, or fresh vault data) without jumping back to the top
  function refreshLens() { if (!lensKey || !LENSES[lensKey]) return; const b = $(".vg-lens-body"), y = b.scrollTop; openLens(lensKey); b.scrollTop = y; }
  function closeLens() { lensKey = null; $(".vg-lens").hidden = true; root.classList.remove("has-lens"); root.focus({ preventScroll: true }); }
  const shortName = c => clusterById[c] ? clusterById[c].name.split(" · ").slice(0, 2).join(" · ") : "—";
  const cellBg = (col, a) => `background:color-mix(in srgb, ${col} ${Math.round(a * 100)}%, transparent)`;

  function lensMatrix() {
    const cs = DATA.clusters.filter(c => c.size >= 5).sort((a, b) => b.size - a.size), pair = {};
    (DATA.pairs || []).forEach(([a, b, l, m]) => { pair[a + "|" + b] = pair[b + "|" + a] = [l, m]; });
    const maxM = Math.max(1, ...(DATA.pairs || []).map(x => x[3])), maxL = Math.max(1, ...(DATA.pairs || []).map(x => x[2]));
    const head = `<tr><th></th>${cs.map(c => `<th class="vg-mx-col" title="${esc(clusterName(c.id))}"><span style="color:${colorOf(c.id)}">C${c.id}</span></th>`).join("")}</tr>`;
    const rows = cs.map(a => `<tr><th class="vg-mx-row"><button class="vg-mx-name" data-cl="${a.id}"><span class="vg-dot" style="background:${colorOf(a.id)}"></span>${esc(shortName(a.id))}</button></th>` +
      cs.map(b => {
        if (a.id === b.id) return `<td class="vg-mx-self" title="${a.size} notes">${a.size}</td>`;
        const [l, m] = pair[a.id + "|" + b.id] || [0, 0];
        const gap = m / maxM * (1 / (1 + l * 0.6));   // talked about together, barely linked
        const style = gap > 0.08 ? cellBg("var(--vg-gap)", Math.min(0.85, 0.15 + gap * 1.6)) : l ? cellBg("var(--vg-ok)", Math.min(0.6, 0.1 + Math.log1p(l) / Math.log1p(maxL) * 0.5)) : "";
        return `<td><button class="vg-mx-cell" style="${style}" data-cell="${a.id},${b.id}" title="${esc(clusterName(a.id))} ↔ ${esc(clusterName(b.id))}: ${plural(l, "link")}, ${m} co-mentions">${l || m ? `${l}<small>/${m}</small>` : ""}</button></td>`;
      }).join("") + `</tr>`).join("");
    const worst = (DATA.pairs || []).filter(([a, b]) => clusterById[a] && clusterById[b]).map(([a, b, l, m]) => ({ a, b, l, m, s: m / (1 + l * 0.6) }))
      .sort((x, y) => y.s - x.s).slice(0, 6);
    return `<div class="vg-mx-wrap"><table class="vg-mx">${head}${rows}</table></div><div class="vg-mx-detail"></div>
      <p class="vg-muted vg-lens-note">Cell = <b>links</b>/<small>co-mentions</small>. Green: well linked. Red: discussed together in your dailies but barely linked. Click a cell for what to do about it.</p>
      <div class="vg-list-h">Biggest gaps</div>${worst.map(g => `<div class="vg-gaprow"><button class="vg-item" data-cl="${g.a},${g.b}"><span class="vg-dots"><span class="vg-dot" style="background:${colorOf(g.a)}"></span><span class="vg-dot" style="background:${colorOf(g.b)}"></span></span>
        <span class="vg-item-main"><span>${esc(clusterName(g.a))} ↔ ${esc(clusterName(g.b))}</span><span class="vg-item-sub">${g.m} co-mentions · ${plural(g.l, "link")}</span></span></button>
        ${opts.writeNote ? `<button class="vg-ibtn" data-bridge="${g.a},${g.b}" title="Draft a bridge note">${icon("bridge", 15)}</button>` : ""}</div>`).join("")}`;
  }

  function lensTimeline() {
    const T = DATA.timeline; if (!T || !T.weeks.length) return emptyNext("No daily notes link or name your notes yet.", "daily");
    const W = T.weeks.length, trend = v => { const a = v.slice(-4).reduce((s, x) => s + x, 0) / 4, b = v.slice(-12, -4).reduce((s, x) => s + x, 0) / 8; return a - b; };
    const strip = (v, col) => { const mx = Math.max(1, ...v); return `<span class="vg-tl-strip">${v.map((x, i) => `<i style="${x ? cellBg(col, 0.15 + 0.85 * x / mx) : ""}" title="week of ${T.weeks[i]}: ${x}"></i>`).join("")}</span>`; };
    const tag = v => { const d = trend(v), base = v.slice(-12, -4).reduce((s, x) => s + x, 0) / 8; return d > Math.max(0.4, base * 0.6) ? `<span class="vg-tl-tag is-up">↑ heating</span>` : d < -Math.max(0.4, base * 0.6) ? `<span class="vg-tl-tag is-down">↓ cooling</span>` : ""; };
    const months = T.weeks.map((w, i) => i % 4 === 0 ? `<span style="grid-column:${i + 1}">${new Date(w + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>` : "").join("");
    const total = T.weeks.map((_, i) => Object.values(T.clusters).reduce((s, v) => s + v[i], 0));
    const cl = Object.entries(T.clusters).filter(([c]) => clusterById[c]).sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));
    const nt = Object.entries(T.notes).filter(([id]) => byId[id]).sort((a, b) => trend(b[1]) - trend(a[1]));
    return `<div class="vg-tl"><div class="vg-tl-row vg-tl-axis"><span></span><span class="vg-tl-months" style="grid-template-columns:repeat(${W},1fr)">${months}</span></div>
      <div class="vg-tl-row"><span class="vg-tl-label"><b>All topics</b></span>${strip(total, "var(--vg-accent)")}</div>
      <div class="vg-list-h">Topics</div>${cl.map(([c, v]) => `<div class="vg-tl-row"><button class="vg-tl-label" data-cl="${c}"><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(shortName(+c))} ${tag(v)}</button>${strip(v, colorOf(+c))}</div>`).join("")}
      <div class="vg-list-h">Notes, heating up first</div>${nt.map(([id, v]) => `<div class="vg-tl-row"><button class="vg-tl-label" data-id="${esc(id)}"><span class="vg-dot" style="background:${colorOf(byId[id].cluster)}"></span>${esc(byId[id].name)} ${tag(v)}</button>${strip(v, colorOf(byId[id].cluster))}${trend(v) < -0.2 ? `<button class="vg-btn vg-btn-sm vg-tl-pin" data-pin="${esc(id)}" title="Add to today's review">Review now</button>` : ""}</div>`).join("")}</div>
      <p class="vg-muted vg-lens-note">Counts daily notes (journals and standups) that link or name each note. "Heating" compares the last 4 weeks with the 8 before.</p>`;
  }

  function lensFolders() {
    const top = id => id.split("/").slice(0, 2).join("/"), groups = {};
    nodes.filter(n => !special(n) && n.cluster >= 0 && n.id.includes("/")).forEach(n => (groups[top(n.id)] = groups[top(n.id)] || []).push(n));
    const folders = Object.entries(groups).filter(([, ms]) => ms.length >= 4).sort((a, b) => b[1].length - a[1].length);
    const home = {};   // each cluster's home folder: where most of it lives
    nodes.filter(n => !special(n) && n.cluster >= 0).forEach(n => { const f = top(n.id); (home[n.cluster] = home[n.cluster] || {})[f] = (home[n.cluster][f] || 0) + 1; });
    const homeOf = c => Object.entries(home[c] || {}).sort((a, b) => b[1] - a[1])[0];
    const odd = [];
    const bars = folders.map(([f, ms]) => {
      const per = {}; ms.forEach(n => per[n.cluster] = (per[n.cluster] || 0) + 1);
      const segs = Object.entries(per).sort((a, b) => b[1] - a[1]);
      ms.forEach(n => { const h = homeOf(n.cluster); if (h && h[0] !== f && h[1] >= 0.5 * clusterById[n.cluster].size && per[n.cluster] <= 2) odd.push([n, h[0]]); });
      return `<div class="vg-fd-row"><span class="vg-fd-name" title="${esc(f)}">${esc(f)}</span><span class="vg-fd-bar" data-chart>${segs.map(([c, k]) =>
        `<button style="flex:${k};background:${colorOf(+c)}" data-cl="${c}" title="${esc(clusterName(+c))}: ${k}"></button>`).join("")}</span><span class="vg-count">${ms.length}</span></div>`;
    }).join("");
    return `<p class="vg-muted vg-lens-note">Each bar is a folder, split by topic. One colour = the folder matches a topic; many colours = the folder mixes topics.</p>${bars}
      <div class="vg-list-h">Possibly misfiled <span class="vg-count">${odd.length}</span></div>
      ${odd.sort((a, b) => b[0].bc - a[0].bc).slice(0, 40).map(([n, h]) => `<div class="vg-sugg">${noteRow(n.id, `in ${esc(top(n.id))} · its topic lives in <b>${esc(h)}</b>`)}
        ${opts.moveNote && !VGRules.RULES.not_map_tops.includes(h.split("/")[0]) ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-move="${esc(n.id)}" data-to="${esc(h)}">Move to ${esc(h.split("/").pop())}</button></span>` : ""}</div>`).join("") || emptyNext("Nothing looks misfiled.", "lens:triage")}`;
  }

  function lensProjects() {
    const ctx = nodes.filter(n => !special(n) && VGRules.isContextNote(n.name)).sort((a, b) => b.recent - a.recent || b.mentions - a.mentions);
    if (!ctx.length) return emptyNext(`No "… - Context" notes yet.`, "new:context");
    const state = n => n.recent > 0 ? ["Active", "is-ok"] : staleFor(n, Q.stale_days) ? ["Stale", "is-warn"] : ["Quiet", ""];
    return `<div class="vg-pb">${ctx.map(n => { const [s, cls] = state(n), m = inMoc(n.id);
      return `<div class="vg-pb-card" style="--c:${colorOf(n.cluster)}"><button class="vg-pb-main" data-id="${esc(n.id)}"><span class="vg-pb-top"><span class="vg-pb-state ${cls}">${s}</span><span class="vg-muted">${n.age}d since edit</span></span>
        <b class="vg-pb-name">${esc(VGRules.contextTopic(n.name))}</b><span class="vg-item-sub">${esc(clusterName(n.cluster))}</span>
        <span class="vg-pb-stats"><span><b>${n.recent}</b> last ${DATA.recent_days}d</span><span><b>${n.mentions}</b> mentions</span><span><b>${n.tasks}</b> open tasks</span><span><b>${nb[n.id].size}</b> links</span></span>
        ${m === false ? `<span class="vg-pb-flag">not in its map</span>` : ""}</button>
        <span class="vg-pb-acts">${opts.openNote ? `<button class="vg-btn vg-btn-sm" data-open="${esc(n.id)}">${icon("open", 12)} Open</button>` : ""}
          ${opts.appendSection ? `<button class="vg-btn vg-btn-sm" data-log="${esc(n.id)}">${icon("plus", 12)} Log update</button>` : ""}
          ${opts.readTasks && n.tasks ? `<button class="vg-btn vg-btn-sm" data-tasks="${esc(n.id)}">Tasks ${n.tasks}</button>` : ""}</span>
        <div class="vg-pb-tasks"></div></div>`; }).join("")}</div>`;
  }

  async function lensMocAlign() {
    const rep = await opts.mocReport.load();
    if (!rep) return emptyNext("No MOC Alignment report yet.", "lens:triage");
    const groups = {}; rep.rows.forEach(r => (groups[r.section] = groups[r.section] || []).push(r));
    const ticked = rep.rows.filter(r => /[xX]/.test(r.state)).length;
    return `<p class="vg-muted vg-lens-note">${esc(rep.path)} · ${rep.rows.length} rows · <b>${ticked}</b> ticked. Ticking here edits the report; nothing else changes until you apply.</p>
      ${opts.mocReport.apply ? `<div class="vg-ins-actions"><button class="vg-btn vg-btn-primary" data-mocapply>${icon("sparkles", 14)} Apply ticked rows</button></div>` : `<p class="vg-muted vg-lens-note">Applying runs on desktop.</p>`}
      ${Object.entries(groups).map(([sec, rows]) => `<div class="vg-list-h">${esc(sec)}</div>` + rows.map(r => `<label class="vg-task vg-mocrow ${r.state === "-" ? "is-done" : ""}">
        <input type="checkbox" data-mocrow="${r.line}" ${/[xX]/.test(r.state) ? "checked" : ""} ${r.state === "-" ? "disabled" : ""}><span>${esc(r.label.replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1").replace(/[`*]/g, ""))}</span></label>`).join("")).join("")}`;
  }

  function lensPeople() {
    const ppl = nodes.filter(n => n.person); if (!ppl.length) return emptyNext("No people notes linked to topics.", "new:person");
    const per = {}; links.filter(l => l.kind === "person").forEach(l => { const c = l.t.cluster; if (c < 0) return; (per[l.s.id] = per[l.s.id] || {})[c] = (per[l.s.id][c] || 0) + 1; });
    const cs = DATA.clusters.filter(c => ppl.some(p => (per[p.id] || {})[c.id])).sort((a, b) => b.size - a.size).slice(0, 12);
    const mx = Math.max(1, ...Object.values(per).flatMap(o => Object.values(o)));
    return `<div class="vg-mx-wrap"><table class="vg-mx"><tr><th></th>${cs.map(c => `<th class="vg-mx-col" title="${esc(clusterName(c.id))}"><span style="color:${colorOf(c.id)}">C${c.id}</span></th>`).join("")}</tr>
      ${ppl.filter(p => per[p.id]).sort((a, b) => b.outlinks - a.outlinks).map(p => `<tr><th class="vg-mx-row"><button class="vg-mx-name" data-id="${esc(p.id)}"><i class="vg-lg-diamond"></i>${esc(p.name)}</button></th>${cs.map(c => {
        const k = (per[p.id] || {})[c.id] || 0;
        return `<td><button class="vg-mx-cell" style="${k ? cellBg("var(--vg-person)", 0.15 + 0.8 * k / mx) : ""}" data-cl="${c.id}" title="${esc(p.name)} · ${esc(clusterName(c.id))}: ${k}">${k || ""}</button></td>`; }).join("")}</tr>`).join("")}</table></div>
      <p class="vg-muted vg-lens-note">Notes linking each person, by topic (from people notes and the notes that link them). Click a name to see them in the graph; columns: ${cs.map(c => `C${c.id} ${esc(shortName(c.id))}`).join(" · ")}.</p>`;
  }

  // Topic river: what your dailies talked about over time, as a stream (one band per topic, thickness =
  // daily notes naming it that week), plus each month's top topics for quarterly write-ups.
  let riverSkipTop = false;
  function lensRiver() {
    const T = DATA.timeline; if (!T || T.weeks.length < 3) return emptyNext("Fewer than 3 weeks of daily notes link or name your notes.", "daily", "lens:timeline");
    const N = T.weeks.length, sum = v => v.reduce((s, x) => s + x, 0);
    const all = Object.entries(T.clusters).filter(([c]) => clusterById[c]).sort((a, b) => sum(b[1]) - sum(a[1]));
    const biggest = all[0] && +all[0][0], shown = riverSkipTop ? all.slice(1) : all;   // a hub topic can dwarf the rest
    const TOP = 10, bands = shown.slice(0, TOP).map(([c, v]) => ({ c: +c, v }));
    if (shown.length > TOP) bands.push({ c: null, v: T.weeks.map((_, i) => shown.slice(TOP).reduce((s, [, v]) => s + v[i], 0)) });
    const soft = v => v.map((x, i) => (2 * x + (v[i - 1] ?? x) + (v[i + 1] ?? x)) / 4);   // a little smoothing so one busy day doesn't spike
    bands.forEach(b => { b.s = soft(b.v).map(Math.sqrt); });   // square-root thickness: quiet topics stay visible next to busy ones
    const tot = T.weeks.map((_, i) => bands.reduce((s, b) => s + b.s[i], 0)), maxT = Math.max(1e-9, ...tot);
    const VW = 1000, VH = 300, PAD = 24, x = i => PAD + (VW - 2 * PAD) * i / (N - 1), y = v => VH / 2 + (v / maxT) * (VH / 2 - 14);
    const curve = pts => pts.map(([px, py], i) => {   // Catmull-Rom through the points, as cubic Béziers
      if (!i) return `M${px.toFixed(1)},${py.toFixed(1)}`;
      const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [px, py];
      return `C${(p1[0] + (px - p0[0]) / 6).toFixed(1)},${(p1[1] + (py - p0[1]) / 6).toFixed(1)} ${(px - (p3[0] - p1[0]) / 6).toFixed(1)},${(py - (p3[1] - p1[1]) / 6).toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    }).join("");
    const base = tot.map(t => -t / 2);   // centred stream: the river widens when you're busy
    let paths = "", labels = "";
    bands.forEach(b => {
      const lo = base.map((v, i) => [x(i), y(v)]), hi = base.map((v, i) => [x(i), y(v + b.s[i])]);
      base.forEach((v, i) => { base[i] = v + b.s[i]; });
      const col = b.c == null ? "var(--vg-muted)" : colorOf(b.c), name = b.c == null ? "Other topics" : clusterName(b.c);
      paths += `<path class="vg-rv-band" ${b.c == null ? "" : `data-cl="${b.c}"`} d="${curve(hi)}L${lo.slice().reverse().map(p => p.map(n => n.toFixed(1)).join(",")).join("L")}Z" fill="${col}"><title>${esc(name)} · ${sum(b.v)} daily notes over ${N} weeks</title></path>`;
      const pk = b.s.indexOf(Math.max(...b.s)), th = hi[pk][1] - lo[pk][1];
      if (b.c != null && Math.abs(th) > 15) labels += `<text x="${Math.min(VW - 80, Math.max(80, x(pk)))}" y="${((hi[pk][1] + lo[pk][1]) / 2 + 4).toFixed(1)}" text-anchor="middle">${esc(shortName(b.c))}</text>`;
    });
    const ticks = T.weeks.map((w, i) => i % 4 === 0 ? `<text class="vg-rv-tick" x="${x(i).toFixed(1)}" y="${VH - 2}" text-anchor="middle">${esc(new Date(w + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</text>` : "").join("");
    const months = {};   // month -> topic -> daily notes
    T.weeks.forEach((w, i) => { const m = w.slice(0, 7); all.forEach(([c, v]) => { if (v[i]) (months[m] = months[m] || {})[c] = (months[m][c] || 0) + v[i]; }); });
    const rows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, per]) => {
      const top3 = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return `<div class="vg-rv-month"><b>${esc(new Date(m + "-15T12:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</b>${top3.map(([c, k]) =>
        `<button class="vg-rv-chip" data-cl="${c}"><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-muted">${k}</span></button>`).join("")}</div>`;
    }).join("");
    return `${biggest != null && all.length > 2 ? `<label class="vg-rv-opt"><input type="checkbox" data-rvskip ${riverSkipTop ? "checked" : ""}> Leave out the biggest topic (${esc(clusterName(biggest))})</label>` : ""}
      <svg class="vg-rv" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Topic river">${paths}<g class="vg-rv-labels">${labels}</g>${ticks}</svg>
      <p class="vg-muted vg-lens-note">Band thickness = daily notes (journals and standups) linking or naming that topic each week, on a square-root scale so quieter topics stay visible. Hover a band for its total; click it to focus the topic. Top ${TOP} topics; the rest are grey.</p>
      <div class="vg-list-h">Top topics by month</div>${rows}`;
  }

  // Map tree: every map (MOC) with its topics, what it lists and what it's missing, fixable in place
  function lensMapTree() {
    if (!mocs.length) return emptyNext("No maps (MOCs) yet.", "draftmap:" + (DATA.clusters.slice().sort((a, b) => b.size - a.size)[0] || {}).id, "lens:blind");
    const row = (id, extra, add) => byId[id] ? `<div class="vg-sugg">${noteRow(id, extra)}${add && canAddToMap() ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-addmap="${esc(add)}|${esc(id)}">${icon("plus", 12)} Add</button></span>` : ""}</div>` : "";
    const cards = mocs.map(m => {
      const miss = m.clusters.flatMap(c => (m.missing[c] || []).filter(id => byId[id]));
      const inTopics = m.members.filter(id => byId[id] && m.clusters.includes(byId[id].cluster)), other = m.members.filter(id => byId[id] && !m.clusters.includes(byId[id].cluster));
      const cover = inTopics.length + miss.length ? Math.round(100 * inTopics.length / (inTopics.length + miss.length)) : 100;
      const topics = m.clusters.map(c => {
        const listed = inTopics.filter(id => byId[id].cluster === c), ms = (m.missing[c] || []).filter(id => byId[id]);
        return `<details class="vg-mt-topic"><summary><span class="vg-dot" style="background:${colorOf(c)}"></span>${esc(clusterName(c))}
            <span class="vg-muted">${listed.length} listed · ${ms.length ? `<b class="vg-mt-miss">${ms.length} missing</b>` : "complete"}</span></summary>
          ${ms.length ? `<div class="vg-list-h">Missing</div>${ms.sort((a, b) => byId[b].bc - byId[a].bc).map(id => row(id, `${byId[id].recent ? `${byId[id].recent} recent · ` : ""}${byId[id].age}d since edit`, m.id)).join("")}` : ""}
          ${listed.length ? `<div class="vg-list-h">Listed</div>${listed.map(id => row(id, "")).join("")}` : ""}</details>`;
      }).join("");
      return `<div class="vg-mt"><div class="vg-mt-head"><button class="vg-item" data-id="${esc(m.id)}"><i class="vg-lg-hex"></i><span class="vg-item-main"><span>${esc(m.title)}</span>
          <span class="vg-item-sub">${plural(m.clusters.length, "topic")} · ${plural(m.members.length, "link")}${other.length ? ` · ${other.length} outside its topics` : ""}</span></span></button>
          <span class="vg-mt-cover" title="${cover}% of its topics' notes are listed"><i style="width:${cover}%;background:${cover >= 80 ? "var(--vg-ok)" : cover >= 50 ? "var(--vg-warn)" : "var(--vg-gap)"}"></i></span><span class="vg-count">${cover}%</span>
          ${miss.length && canAddToMap() ? `<button class="vg-btn vg-btn-sm" data-addall="${esc(m.id)}">Add all ${miss.length}</button>` : ""}</div>${topics}</div>`;
    });
    const order = mocs.map((m, i) => [i, m.clusters.flatMap(c => m.missing[c] || []).length]).sort((a, b) => b[1] - a[1]).map(([i]) => cards[i]);
    const unmapped = DATA.clusters.filter(c => !mocOf[c.id] && c.size >= 6).sort((a, b) => b.size - a.size);
    return `<p class="vg-muted vg-lens-note">Each map, worst coverage first. Open a topic for the notes it lists and the ones it's missing; Add appends them under "Also in this topic".</p>${order.join("")}
      ${unmapped.length ? `<div class="vg-list-h">Topics with no map <span class="vg-count">${unmapped.length}</span></div>${unmapped.map(c => `<div class="vg-sugg"><button class="vg-item" data-cl="${c.id}"><span class="vg-dot" style="background:${colorOf(c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(c.id))}</span><span class="vg-item-sub">${plural(c.size, "note")}</span></span></button>
        ${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-draftmap="${c.id}">Draft map</button></span>` : ""}</div>`).join("")}` : ""}`;
  }

  // Folder ring: top-level folders around a circle, chords sized by the links between them. Thin or missing
  // chords show folders whose knowledge doesn't reach each other.
  // two levels deep (02-Projects/Inventory System), since the top level is just a handful of big buckets;
  // hidden and system folders (.claude, _System…) are left out
  const folderOf = id => { const p = id.split("/"); return p.length === 1 ? "(vault root)" : p.length === 2 ? p[0] : p[0] + "/" + p[1]; };
  const ringFolder = f => !/^[._]/.test(f);
  function lensRing() {
    const notes = nodes.filter(n => !special(n) && !n.ghost && ringFolder(folderOf(n.id))), count = {};
    notes.forEach(n => { const f = folderOf(n.id); count[f] = (count[f] || 0) + 1; });
    const folders = Object.keys(count).filter(f => count[f] >= 3).sort((a, b) => count[b] - count[a]).slice(0, 14), idx = Object.fromEntries(folders.map((f, i) => [f, i]));
    const F = folders.length; if (F < 2) return emptyNext("Not enough folders to compare.", "lens:folders");
    const M = folders.map(() => folders.map(() => 0)), inside = folders.map(() => 0);
    links.filter(l => l.kind === "link" && !special(l.s) && !special(l.t)).forEach(l => {
      const a = idx[folderOf(l.s.id)], b = idx[folderOf(l.t.id)]; if (a == null || b == null) return;
      if (a === b) inside[a]++; else { M[a][b]++; M[b][a]++; }
    });
    const out = M.map(r => r.reduce((s, x) => s + x, 0)), weight = folders.map((_, i) => Math.max(1, out[i]));
    const leaf = f => f.split("/").pop().replace(/^\d+-/, ""), clash = {};
    folders.forEach(f => { clash[leaf(f)] = (clash[leaf(f)] || 0) + 1; });
    const ringLabel = f => clash[leaf(f)] > 1 && f.includes("/") ? `${leaf(f)} (${f.split("/")[0].replace(/^\d+-/, "")})` : leaf(f);
    const R = 150, R2 = 162, C = 200, GAP = 0.04, total = weight.reduce((s, x) => s + x, 0), span = 2 * Math.PI - GAP * F;
    const pt = (a, r) => [(C + r * Math.cos(a - Math.PI / 2)).toFixed(1), (C + r * Math.sin(a - Math.PI / 2)).toFixed(1)];
    const arcs = [], start = [];
    let a0 = 0;
    folders.forEach((f, i) => { const a1 = a0 + span * weight[i] / total; arcs.push([a0, a1]); start.push(a0); a0 = a1 + GAP; });
    const col = i => PALETTE[i % PALETTE.length];
    let svg = "";
    const slot = folders.map((_, i) => start[i]), seg = {};   // each pair gets a slice of both folders' arcs
    folders.forEach((_, i) => folders.forEach((__, j) => { if (i === j || !M[i][j]) return;
      const w = (arcs[i][1] - arcs[i][0]) * M[i][j] / Math.max(1, out[i]); seg[i + "|" + j] = [slot[i], slot[i] + w]; slot[i] += w; }));
    folders.forEach((_, i) => folders.forEach((__, j) => { if (j <= i || !M[i][j]) return;
      const [s0, s1] = seg[i + "|" + j], [t0, t1] = seg[j + "|" + i], p = (a) => pt(a, R).join(",");
      svg += `<path class="vg-rg-chord" data-fp="${i},${j}" fill="${col(i)}" d="M${p(s0)}A${R},${R} 0 0,1 ${p(s1)}Q${C},${C} ${p(t0)}A${R},${R} 0 0,1 ${p(t1)}Q${C},${C} ${p(s0)}Z"><title>${esc(folders[i])} ↔ ${esc(folders[j])}: ${plural(M[i][j], "link")}</title></path>`;
    }));
    folders.forEach((f, i) => {
      const [b0, b1] = arcs[i], large = b1 - b0 > Math.PI ? 1 : 0, mid = (b0 + b1) / 2, [lx, ly] = pt(mid, R2 + 14);
      svg += `<path class="vg-rg-arc" data-fold="${esc(f)}" fill="${col(i)}" d="M${pt(b0, R).join(",")}A${R},${R} 0 ${large},1 ${pt(b1, R).join(",")}L${pt(b1, R2).join(",")}A${R2},${R2} 0 ${large},0 ${pt(b0, R2).join(",")}Z"><title>${esc(f)}: ${plural(count[f], "note")}, ${out[i]} links out, ${inside[i]} inside</title></path>`;
      if (b1 - b0 > 0.08) svg += `<text x="${lx}" y="${ly}" text-anchor="${Math.sin(mid) > 0.2 ? "start" : Math.sin(mid) < -0.2 ? "end" : "middle"}" dominant-baseline="middle">${esc(ringLabel(f))}</text>`;
    });
    const insular = folders.map((f, i) => ({ f, i, n: count[f], ratio: out[i] / Math.max(1, out[i] + inside[i]) })).filter(x => x.n >= 6).sort((a, b) => a.ratio - b.ratio).slice(0, 6);
    return `<svg class="vg-rg" viewBox="-60 -10 520 420" role="img" aria-label="Folder ring">${svg}</svg><div class="vg-rg-detail"></div>
      <p class="vg-muted vg-lens-note">Arcs are folders (two levels deep, the ${F} biggest), sized by links to other folders; chords are those links. Click a chord for the notes behind it, or an arc to light up that folder in the graph.</p>
      <div class="vg-list-h">Most inward-looking folders</div>${insular.map(x => `<div class="vg-fd-row"><button class="vg-fd-name vg-linkish" data-fold="${esc(x.f)}">${esc(x.f)}</button>
        <span class="vg-fd-bar"><i style="flex:${Math.round(100 * x.ratio)};background:var(--vg-ok)"></i><i style="flex:${100 - Math.round(100 * x.ratio)};background:var(--vg-hover)"></i></span><span class="vg-count">${Math.round(100 * x.ratio)}% out</span></div>`).join("")}`;
  }
  const shortDate = d => d ? new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const actBtn = (attr, id, label) => `<button class="vg-btn vg-btn-sm" ${attr}="${esc(id)}">${label}</button>`;

  // 1. Important but stale: how much the vault leans on a note vs. how long since it was edited.
  // Top-left = notes your work depends on that may have drifted out of date.
  const STALE_AFTER = Q.stale_days;   // the shared rule (vault_graph_rules.json stale_days): one meaning of stale everywhere
  function lensStale() {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.cluster >= 0);
    if (!ns.length) return `<div class="vg-empty">No notes to rate.</div>`;
    impMax = null; const imp = importance;   // the shared measure (fresh maxes: the lens can open after edits)
    const VW = 1000, VH = 320, P = 30, maxAge = Math.max(STALE_AFTER * 2, ...ns.map(n => n.age || 0));
    const x = a => P + (VW - 2 * P) * Math.log1p(a) / Math.log1p(maxAge), y = v => VH - P - (VH - 2 * P) * v;
    const cut = 0.35, hot = ns.filter(n => imp(n) >= cut && staleFor(n, STALE_AFTER)).sort((a, b) => imp(b) * Math.log1p(b.age) - imp(a) * Math.log1p(a.age));
    const dots = ns.map(n => { const v = imp(n), danger = v >= cut && staleFor(n, STALE_AFTER);
      return `<circle class="vg-st-dot ${danger ? "is-hot" : ""}" data-id="${esc(n.id)}" cx="${x(n.age || 0).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${danger ? 5 : 3.2}" fill="${colorOf(n.cluster)}"><title>${esc(n.name)} · ${n.age}d since edit · ${n.inlinks} links in · ${n.mentions} daily mentions</title></circle>`; }).join("");
    const ticks = [1, 7, 30, 90, 180, 365, 730].filter(d => d <= maxAge).map(d => `<text class="vg-rv-tick" x="${x(d).toFixed(1)}" y="${VH - 8}" text-anchor="middle">${d < 30 ? d + "d" : d < 365 ? Math.round(d / 30) + "mo" : Math.round(d / 365) + "y"}</text>`).join("");
    return `<svg class="vg-st" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Importance against staleness">
        <rect class="vg-st-zone" x="${x(STALE_AFTER)}" y="${P}" width="${VW - P - x(STALE_AFTER)}" height="${y(cut) - P}"/>
        <line class="vg-st-axis" x1="${x(STALE_AFTER)}" x2="${x(STALE_AFTER)}" y1="${P}" y2="${VH - P}"/><line class="vg-st-axis" x1="${P}" x2="${VW - P}" y1="${y(cut)}" y2="${y(cut)}"/>
        <text class="vg-rv-tick" x="${VW - P}" y="${P - 8}" text-anchor="end">relied on · stale</text><text class="vg-rv-tick" x="${P}" y="${P - 8}">relied on · fresh</text>
        ${dots}${ticks}</svg>
      <p class="vg-muted vg-lens-note">Up = relied on (links in, daily mentions, influence${DATA.has_usage ? ", opens" : ", recent mentions"}). Right = days since the last edit (log scale). The shaded corner is relied on and not edited in ${STALE_AFTER}+ days. Click a dot to find it.</p>
      <div class="vg-list-h">Relied on, not edited in ${STALE_AFTER}+ days <span class="vg-count">${hot.length}</span></div>
      ${hot.slice(0, 40).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.age}d since edit · ${n.inlinks} links in · ${n.mentions} mentions`)}<span class="vg-sugg-acts">
        ${opts.openNote ? actBtn("data-open", n.id, `${icon("open", 12)} Open`) : ""}${opts.stampReviewed ? actBtn("data-reviewed", n.id, "Still current") : ""}${opts.moveNote ? actBtn("data-archive", n.id, "Archive") : ""}</span></div>`).join("") || emptyNext("Nothing relied-on has gone stale.", "lens:triage")}`;
  }

  // 2. Write these next: links pointing at notes that don't exist, and short notes many others lean on
  function createGhost(n) {
    const md = `---\ncreated: ${today()}\n---\n# ${n.name}\n\n` +
      `> Created from Vault Graph: linked from ${n.from.filter(id => byId[id]).map(id => mdLink(id, `${FOLDERS.inbox}/${safeName(n.name)}.md`)).join(", ")}.\n\n`;
    return opts.writeNote(`${FOLDERS.inbox}/${safeName(n.name)}.md`, md, { mode: "create", open: true }).then(() => { n.created = true; toast(`Created ${n.name} in ${FOLDERS.inbox}`, "ok"); });
  }
  function lensWrite() {
    const wanted = nodes.filter(n => n.ghost && !n.created).sort((a, b) => b.from.length - a.from.length);
    const stubs = nodes.filter(n => !special(n) && !n.ghost && (n.words || 0) < Q.stub_words && (n.inlinks || 0) >= 2)
      .sort((a, b) => b.inlinks - a.inlinks || b.mentions - a.mentions);
    if (!wanted.length && !stubs.length) return emptyNext("Every link points at a real note, and no short note has several links in.", "new:note", "lens:triage");
    return `<p class="vg-muted vg-lens-note">Notes other notes already point at, ranked by how many. Writing these fills the biggest holes first.</p>
      <div class="vg-list-h">Linked but never written <span class="vg-count">${wanted.length}</span></div>
      ${wanted.slice(0, 30).map(n => `<div class="vg-sugg"><button class="vg-item" data-id="${esc(n.id)}"><span class="vg-dot is-ghost"></span><span class="vg-item-main"><span>${esc(n.name)}</span>
        <span class="vg-item-sub">linked from ${plural(n.from.length, "note")}: ${n.from.filter(id => byId[id]).slice(0, 3).map(id => esc(byId[id].name)).join(", ")}${n.from.length > 3 ? "…" : ""}</span></span></button>
        ${opts.writeNote && n.creatable ? `<span class="vg-sugg-acts">${actBtn("data-ghost", n.id, `${icon("file", 12)} Create`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">Every link points at a real note.</div>`}
      <div class="vg-list-h">Short notes that others rely on <span class="vg-count">${stubs.length}</span></div>
      ${stubs.slice(0, 30).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.words || 0} words · ${n.inlinks} links in${n.mentions ? ` · ${n.mentions} mentions` : ""}`)}
        ${opts.openNote ? `<span class="vg-sugg-acts">${actBtn("data-open", n.id, `${icon("open", 12)} Open`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">No thin notes with several links in.</div>`}`;
  }

  // 4. Standup follow-through: "Work Expected Tomorrow" against what the next standups say got done
  const FT = { next: ["Done next day", "var(--vg-ok)"], later: ["Done later", "color-mix(in srgb, var(--vg-ok) 55%, var(--vg-accent))"],
    carried: ["Carried forward", "var(--vg-warn)"], dropped: ["No sign of it", "var(--vg-muted)"], pending: ["Tomorrow's plan", "var(--vg-accent)"] };
  const ftKey = i => i.d + "|" + i.t.split(" · ")[0].slice(0, 120);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const standupPath = d => { const [y, m] = d.split("-"); return `${FOLDERS.daily}/${y}/${m}-${MONTHS[+m - 1]}/Standups/Daily Standup ${d}.md`; };
  function lensFollow() {
    const F = DATA.followthrough; if (!F || !F.items.length) return emptyNext(`No standups with a "Work Expected Tomorrow" section${F && F.days ? ` in the last ${F.days} days` : ""}.`, "daily");
    const items = F.items, judged = items.filter(i => i.s !== "pending");
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), recent = judged.filter(i => i.d >= since);
    const rate = xs => xs.length ? Math.round(100 * xs.filter(i => i.s === "next" || i.s === "later").length / xs.length) : 0;
    const count = (xs, s) => xs.filter(i => i.s === s).length;
    const monday = d => { const t = new Date(d + "T12:00"); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
    const weeks = {}; judged.forEach(i => { (weeks[monday(i.d)] = weeks[monday(i.d)] || []).push(i); });
    const bars = Object.entries(weeks).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 16).map(([w, xs]) => `<div class="vg-fd-row"><span class="vg-fd-name">week of ${shortDate(w)}</span><span class="vg-fd-bar">${
      ["next", "later", "carried", "dropped"].map(s => count(xs, s) ? `<i style="flex:${count(xs, s)};background:${FT[s][1]}" title="${FT[s][0]}: ${count(xs, s)}"></i>` : "").join("")}</span><span class="vg-count">${rate(xs)}%</span></div>`).join("");
    // the same plan written on several days is one thing you kept meaning to do: group by its first key words
    const key = t => t.toLowerCase().replace(/\[\[|\]\]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(" ");
    const groups = {}; items.forEach(i => { (groups[key(i.t)] = groups[key(i.t)] || []).push(i); });
    const ft = review.ft || {}, handled = i => ft[ftKey(i)];
    const stuck = Object.values(groups).filter(g => g.length >= 2 && !g.some(i => i.s === "next" || i.s === "later") && !handled(g[g.length - 1])).sort((a, b) => b.length - a.length || b[b.length - 1].d.localeCompare(a[a.length - 1].d));
    const dropped = Object.values(groups).filter(g => g.length === 1 && g[0].s === "dropped" && !handled(g[0])).map(g => g[0]).sort((a, b) => b.d.localeCompare(a.d));
    const done0 = Object.entries(ft).sort((a, b) => b[1].date.localeCompare(a[1].date));
    const done = judged.filter(i => i.s === "next" || i.s === "later").sort((a, b) => b.d.localeCompare(a.d));
    const pend = items.filter(i => i.s === "pending");
    const acts = i => `<span class="vg-sugg-acts">${opts.openNote ? `<button class="vg-btn vg-btn-sm" data-ftopen="${esc(i.d)}" title="Open the standup it was planned in">${icon("open", 12)}</button>` : ""}
      <button class="vg-btn vg-btn-sm" data-ftdone="${esc(ftKey(i))}" title="It got done (the standups just didn't say so): stop listing it">Done</button>
      <button class="vg-btn vg-btn-sm vg-btn-ghost" data-ftdrop="${esc(ftKey(i))}" title="Not planned any more: stop listing it">Drop</button></span>`;
    const row = (i, extra, act) => `<div class="vg-ft-row"><span class="vg-ft-dot" style="background:${FT[i.s][1]}" title="${FT[i.s][0]}"></span><span class="vg-ft-main"><span>${esc(i.t.split(" · ")[0])}</span>
      <span class="vg-item-sub">${extra}</span></span>${act ? acts(i) : ""}</div>`;
    const stat = (v, l) => `<div class="vg-stat"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="vg-stats">${stat(rate(recent) + "%", "done · last 30 days")}${stat(count(recent, "next"), "done next day")}${stat(count(recent, "carried"), "carried forward")}${stat(count(recent, "dropped"), "no sign of it")}</div>
      ${/* each "Work Expected Tomorrow" item is matched to the next week's "Work Completed" lines by the rarer words they
         share; it's approximate, so each match shows the line it matched */ ""}
      <p class="vg-muted vg-lens-note">${plural(items.length, "plan")} from ${plural(F.standups, "standup")}, each checked against the next week's "Work Completed".</p>
      ${pend.length ? `<div class="vg-list-h">Tomorrow's plan</div>${pend.map(i => row(i, `planned ${shortDate(i.d)}`)).join("")}` : ""}
      <div class="vg-list-h">By week</div>${bars}
      <div class="vg-ft-legend">${["next", "later", "carried", "dropped"].map(s => `<span><i style="background:${FT[s][1]}"></i>${FT[s][0]}</span>`).join("")}</div>
      <div class="vg-list-h">Kept planning, never got done <span class="vg-count">${stuck.length}</span></div>
      ${stuck.slice(0, 25).map(g => row(g[g.length - 1], `planned ${plural(g.length, "time")} · ${shortDate(g[0].d)} → ${shortDate(g[g.length - 1].d)}`, true)).join("") || `<div class="vg-empty">Nothing stuck.</div>`}
      <details class="vg-ft-more"><summary>Planned once, no sign of it after <span class="vg-count">${dropped.length}</span></summary>${dropped.slice(0, 40).map(i => row(i, `planned ${shortDate(i.d)}`, true)).join("")}</details>
      ${done0.length ? `<details class="vg-ft-more"><summary>Handled by you <span class="vg-count">${done0.length}</span></summary>${done0.slice(0, 60).map(([k, v]) => `<div class="vg-ft-row"><span class="vg-ft-main"><span>${esc(v.t)}</span>
        <span class="vg-item-sub">${v.how === "done" ? "marked done" : "dropped"} ${shortDate(v.date)}</span></span><span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm vg-btn-ghost" data-ftundo="${esc(k)}">Undo</button></span></div>`).join("")}</details>` : ""}
      <details class="vg-ft-more"><summary>Done <span class="vg-count">${done.length}</span></summary>${done.slice(0, 60).map(i => row(i, `planned ${shortDate(i.d)} · done ${shortDate(i.w)}: “${esc(i.m.slice(0, 120))}”`)).join("")}</details>`;
  }

  // 12. Duplicates: notes flagged "(duplicate to merge)", same-name copies, and near-identical text, side by side
  function lensDupes() {
    const pairs = [], seen = new Set();
    const add = (a, b, why) => { const k = [a, b].sort().join("|"); if (a !== b && byId[a] && byId[b] && !seen.has(k)) { seen.add(k); pairs.push({ a, b, why }); } };
    const plain = s => s.replace(/\s*\(duplicate to merge\)\s*$/i, "").trim().toLowerCase();
    const real = nodes.filter(n => !special(n) && !n.ghost);
    real.filter(n => /\(duplicate to merge\)/i.test(n.name)).forEach(n => {
      const twin = real.find(m => m !== n && plain(m.name) === plain(n.name)) ||
        real.filter(m => m !== n && links.some(l => l.kind === "similar" && ((l.s === n && l.t === m) || (l.t === n && l.s === m))))[0];
      if (twin) add(n.id, twin.id, "flagged “duplicate to merge”"); else pairs.push({ a: n.id, b: null, why: "flagged “duplicate to merge”, no twin found by name" });
    });
    const byName = {}; real.forEach(n => (byName[n.name.toLowerCase()] = byName[n.name.toLowerCase()] || []).push(n));
    Object.values(byName).filter(g => g.length > 1).forEach(g => add(g[0].id, g[1].id, "same name, different folders"));
    (DATA.near_dupes || []).forEach(([a, b, s]) => add(a, b, `${Math.round(s * 100)}% same wording`));
    if (!pairs.length) return emptyNext("No likely duplicates.", "lens:triage");
    const side = (id, other) => { const n = byId[id], mine = [...nb[id]].filter(x => x !== other), theirs = other ? new Set(nb[other]) : new Set();
      const only = mine.filter(x => !theirs.has(x));
      return `<div class="vg-dp-side"><button class="vg-item" data-id="${esc(id)}"><span class="vg-item-main"><span>${esc(n.name)}</span><span class="vg-item-sub">${esc(n.folder || "/")} · ${n.words || 0} words · ${n.age}d since edit · ${n.inlinks} links in</span></span></button>
        <div class="vg-item-sub">${other ? `${plural(only.length, "link")} the other doesn't have` : plural(mine.length, "link")}${only.length ? ": " + only.slice(0, 6).map(x => esc(byId[x].name)).join(", ") + (only.length > 6 ? "…" : "") : ""}</div></div>`; };
    return `<p class="vg-muted vg-lens-note">Pairs that look like the same note. Each side lists the links only it has, so nothing is lost when you merge. Merging is up to you — this only shows them side by side.</p>
      ${pairs.map(p => `<div class="vg-dp"><div class="vg-dp-why">${esc(p.why)}</div><div class="vg-dp-pair">${side(p.a, p.b)}${p.b ? side(p.b, p.a) : ""}</div>
        <div class="vg-sugg-acts">${opts.openNote && p.b ? `<button class="vg-btn vg-btn-sm" data-openboth="${esc(p.a)}|${esc(p.b)}">${icon("open", 12)} Open both</button>` : ""}
        ${opts.dismissPair && p.b ? `<button class="vg-btn vg-btn-sm" data-notdup="${esc(p.a)}|${esc(p.b)}">Not duplicates</button>` : ""}</div></div>`).join("")}`;
  }

  // 14. Reading path: an ordered list for getting up to speed on one topic (map → central notes → details)
  let pathTopic = null;
  function readingPath(c) {
    const ms = topicNotes(c);
    if (!ms.length) return [];
    const inC = new Set(ms.map(n => n.id)), start = ms.slice().sort((a, b) => b.bc - a.bc || b.inlinks - a.inlinks)[0];
    const order = [start.id], seenP = new Set(order);
    for (let i = 0; i < order.length; i++)   // breadth-first from the hub, most central neighbours first
      [...nb[order[i]]].filter(x => inC.has(x) && !seenP.has(x)).sort((a, b) => byId[b].bc - byId[a].bc || byId[b].inlinks - byId[a].inlinks)
        .forEach(x => { seenP.add(x); order.push(x); });
    ms.filter(n => !seenP.has(n.id)).sort((a, b) => b.inlinks - a.inlinks).forEach(n => order.push(n.id));   // unlinked members last
    const core = Math.max(3, Math.round(order.length * 0.25));
    return [{ h: "Start here", ids: order.slice(0, 3) }, { h: "Core", ids: order.slice(3, core) }, { h: "Details", ids: order.slice(core) }].filter(s => s.ids.length);
  }
  const linkCount = (a, b) => { const p = (DATA.pairs || []).find(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)); return p ? p[2] : 0; };

  // Stale triage: an old note isn't a problem by itself. Records are exempt; the rest split by what to do about them,
  // riskiest first, each group with the button that does its job. A note sits in the first group it fits.
  function lensTriage() {
    const ns = nodes.filter(n => !special(n) && !n.ghost), stale = ns.filter(n => staleFor(n, Q.stale_days)), records = ns.filter(n => isRecord(n) && n.age > Q.stale_days);
    const used = new Set(), take = f => stale.filter(n => !used.has(n.id) && f(n)).map(n => (used.add(n.id), n));
    const relied = take(n => (n.inlinks || 0) >= 4).sort(byImportance);
    const tasks = take(n => n.tasks > 0).sort((a, b) => (b.taskAge || 0) - (a.taskAge || 0) || b.tasks - a.tasks);
    const islands = take(n => n.isolated).sort((a, b) => b.age - a.age);
    const rest = take(() => true).sort(byImportance);
    const row = (n, sub, acts, extra) => `<div class="vg-sugg vg-st-row">${noteRow(n.id, sub)}<span class="vg-sugg-acts">${acts}</span>${extra || ""}</div>`;
    const open = n => opts.openNote ? actBtn("data-open", n.id, `${icon("open", 12)} Open`) : "";
    const ok = n => opts.stampReviewed ? actBtn("data-reviewed", n.id, "Still current") : "";
    const sec = (title, list, hint, render, max) => `<div class="vg-list-h">${title} <span class="vg-count">${list.length}</span></div><p class="vg-muted vg-lens-note">${hint}</p>` +
      (list.slice(0, max).map(render).join("") || `<div class="vg-empty">None.</div>`) + (list.length > max ? `<div class="vg-empty">…and ${list.length - max} more.</div>` : "");
    return `<p class="vg-muted vg-lens-note"><b>${stale.length}</b> notes haven't changed in ${Q.stale_days}+ days. ${records.length} more are records (finished work, release notes, meetings, reports, dated logs): they're meant to stay as written, so they don't count. Work top to bottom; at 5 a day the first group clears in about ${plural(Math.max(1, Math.ceil(relied.length / 35)), "week")}.</p>` +
      sec("1 · Relied on", relied, "Four or more notes link here, so an out-of-date version misleads them. Still right → Still current (records a review date, no edit). Wrong → open and fix.",
        n => row(n, `${n.inlinks} links in · ${n.age}d since edit`, open(n) + ok(n)), 25) +
      sec("2 · Holding open tasks", tasks, "Old tasks rot faster than notes. Tick what's done; cancel the rest with [-] in the note.",
        n => row(n, `${plural(n.tasks, "open task")}${n.taskAge != null ? ` · oldest ${n.taskAge}d` : ""} · ${n.age}d since edit`, (opts.readTasks ? `<button class="vg-btn vg-btn-sm" data-sttasks="${esc(n.id)}">Tasks</button>` : "") + open(n), `<div class="vg-st-tasks"></div>`), 20) +
      sec("3 · Unconnected", islands, "Nothing links in or out. Archive what's finished; link the rest from its map or a related note.",
        n => row(n, `${n.words || 0} words · ${n.age}d since edit`, open(n) + (opts.moveNote ? actBtn("data-archive", n.id, "Archive") : "")), 20) +
      sec("4 · Everything else", rest, "Connected but not heavily relied on. Fine to leave; review when you're in the area.",
        n => row(n, `${n.inlinks} links in · ${n.age}d since edit`, open(n) + ok(n)), 15) +
      `<details class="vg-st-records"><summary class="vg-list-h">Records, exempt <span class="vg-count">${records.length}</span></summary>${records.slice(0, 40).map(n => row(n, `${n.age}d since edit`, open(n))).join("")}</details>`;
  }

  // Blind spots: things the vault knows that you don't see — named but never linked, topics gone quiet, unmapped topics,
  // islands (written but connected to nothing) and dead ends (link out, nothing links in)
  function lensBlind() {
    const ns = nodes.filter(n => !special(n) && !n.ghost);
    const said = (DATA.said_unlinked || []).filter(([id]) => byId[id]).slice(0, 12);
    const quiet = DATA.clusters.map(c => { const mem = ns.filter(n => n.cluster === c.id);
      return { c, size: mem.length, recent: mem.reduce((s, n) => s + (n.recent || 0), 0), age: Math.min(...mem.map(n => n.age || 0)) }; })
      .filter(x => x.size >= 5 && !x.recent).sort((a, b) => b.size - a.size);
    const unmapped = DATA.clusters.filter(c => !mocOf[c.id] && c.size >= 5);
    const islands = ns.filter(n => n.isolated && (n.words || 0) >= Q.stub_words).sort((a, b) => b.words - a.words);
    const deadEnds = ns.filter(n => !n.inlinks && (n.outlinks || 0) >= 3).sort((a, b) => b.outlinks - a.outlinks);
    const sec = (title, n, hint, rows, empty) => `<div class="vg-list-h">${title} <span class="vg-count">${n}</span></div><p class="vg-muted vg-lens-note">${hint}</p>${rows || `<div class="vg-empty">${empty}</div>`}`;
    return sec("Named, never linked", said.length, "Your dailies mention these by name without a link, so the graph can't see the connection.",
        said.map(([id, k]) => `<div class="vg-sugg">${noteRow(id, `named ${plural(k, "time")} without a link`)}${fixSlot(id, "unlinked-mentions")}</div>`).join(""), "Every mention is linked.") +
      sec("Topics gone quiet", quiet.length, `Topics of 5+ notes your dailies haven't touched in ${DATA.recent_days} days. Finished, or forgotten?`,
        quiet.map(x => `<button class="vg-item" data-cl="${x.c.id}"><span class="vg-dot" style="background:${colorOf(x.c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(x.c.id))}</span><span class="vg-item-sub">${x.size} notes · newest edit ${x.age}d ago</span></span></button>`).join(""), "Every topic came up recently.") +
      sec("Topics no map covers", unmapped.length, "Without a map, these are only reachable by search or by luck.",
        unmapped.map(c => `<div class="vg-sugg"><button class="vg-item" data-cl="${c.id}"><span class="vg-dot" style="background:${colorOf(c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(c.id))}</span><span class="vg-item-sub">${c.size} notes</span></span></button>${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-draftmap="${c.id}">${icon("plus", 12)} Draft a map</button></span>` : ""}</div>`).join(""), "Every sizeable topic has a map.") +
      sec("Islands", islands.length, "Real notes (not stubs) with no links in or out: written once, never found again.",
        islands.slice(0, 15).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.words} words · ${n.age}d since edit`)}${fixSlot(n.id, "orphan")}</div>`).join(""), "No unconnected notes.") +
      sec("Dead ends", deadEnds.length, "Notes that point at others but nothing points back at them: you can only arrive here by accident.",
        deadEnds.slice(0, 15).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.outlinks} links out · 0 in`)}${fixSlot(n.id, "orphan")}</div>`).join(""), "Everything that links out is linked to.");
  }

  // Adjacent possible (Stuart Kauffman): new ideas sit one step past what you already have. Notes two links from
  // what you're working on now that you haven't touched, plus random far-apart pairs to combine
  function lensAdjacent() {
    const ns = nodes.filter(n => !special(n) && !n.ghost), adj = {};
    links.forEach(l => { if (l.kind !== "link") return; (adj[l.s.id] = adj[l.s.id] || new Set()).add(l.t.id); (adj[l.t.id] = adj[l.t.id] || new Set()).add(l.s.id); });
    const active = ns.filter(n => (n.recent || 0) > 0 || (n.opens90 || 0) > 2), seen = new Set(active.map(n => n.id));
    active.forEach(n => (adj[n.id] || []).forEach(m => seen.add(m)));
    const reach = {};
    active.forEach(n => (adj[n.id] || []).forEach(m => (adj[m] || []).forEach(x => {
      if (seen.has(x) || !byId[x] || special(byId[x]) || byId[x].ghost) return;
      (reach[x] = reach[x] || { via: new Set(), from: new Set() }).via.add(m); reach[x].from.add(n.id); })));
    const edge = Object.entries(reach).map(([id, r]) => ({ n: byId[id], r })).sort((a, b) => b.r.from.size - a.r.from.size || (b.n.words || 0) - (a.n.words || 0));
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const top = c => ns.filter(n => n.cluster === c.id).sort(byImportance).slice(0, 5);
    const far = []; const cs = DATA.clusters.filter(c => c.size >= 3);
    for (let i = 0; i < 40 && far.length < 5 && cs.length > 1; i++) { const a = pick(cs), b = pick(cs);
      if (a.id !== b.id && !linkCount(a.id, b.id) && !far.some(f => f[0].id === a.id && f[1].id === b.id)) far.push([a, b, pick(top(a)), pick(top(b))]); }
    impMax = null;
    return `<p class="vg-muted vg-lens-note">The biologist Stuart Kauffman called it the <i>adjacent possible</i>: you can't jump to a far-off idea, but every idea you hold opens a ring of next ones. Here that ring is notes two links from the ${plural(active.length, "note")} you've been in lately${DATA.has_usage ? " (daily mentions or opens)" : ""}, which you haven't touched.</p>
      <div class="vg-list-h">One step past where you are <span class="vg-count">${edge.length}</span></div>
      ${edge.slice(0, 20).map(({ n, r }) => `<div class="vg-sugg">${noteRow(n.id, `via ${[...r.via].slice(0, 2).map(v => esc(byId[v].name)).join(", ")} · reached from ${plural(r.from.size, "active note")}`)}${opts.openNote ? `<span class="vg-sugg-acts">${actBtn("data-open", n.id, `${icon("open", 12)} Open`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">Nothing two steps out — link a few more notes from your dailies.</div>`}
      <div class="vg-list-h">Strange pairs</div>
      <p class="vg-muted vg-lens-note">Two central notes from topics that never link. Ask what one would say about the other; if there's an answer, that's a new note.</p>
      ${far.map(([a, b, x, y]) => `<div class="vg-sugg"><button class="vg-item" data-cl="${a.id},${b.id}"><span class="vg-item-main"><span>${esc(x.name)} × ${esc(y.name)}</span>
        <span class="vg-item-sub">${esc(shortName(a.id))} × ${esc(shortName(b.id))}</span></span></button>${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-bridge="${a.id},${b.id}">${icon("bridge", 12)} Draft bridge</button></span>` : ""}</div>`).join("") || `<div class="vg-empty">Every topic already links to every other.</div>`}
      <div class="vg-ins-actions"><button class="vg-btn" data-relens="adjacent">${icon("sparkles", 14)} Shuffle pairs</button></div>`;
  }

  function lensPath() {
    const cs = DATA.clusters.filter(c => c.size >= 4).sort((a, b) => b.size - a.size);
    if (!cs.length) return `<div class="vg-empty">No topics yet.</div>`;
    if (pathTopic == null || !cs.some(c => c.id === pathTopic)) pathTopic = cs[0].id;
    const m = mocOf[pathTopic], secs = readingPath(pathTopic);
    const line = id => { const n = byId[id]; return noteRow(id, `${n.words < Q.stub_words ? "short · " : ""}${n.age}d since edit${staleFor(n, Q.stale_days) ? " · may be out of date" : ""}`); };
    return `<div class="vg-rp-top"><select class="vg-rp-pick" aria-label="Topic">${cs.map(c => `<option value="${c.id}" ${c.id === pathTopic ? "selected" : ""}>${esc(clusterName(c.id))} (${c.size})</option>`).join("")}</select>
        ${opts.writeNote ? `<button class="vg-btn vg-btn-sm" data-savepath>${icon("file", 12)} Save as note</button>` : ""}</div>
      <p class="vg-muted vg-lens-note">Read top to bottom: the topic's map, then its most central notes, following links outward from the hub. Good for getting someone (or future you) up to speed.</p>
      ${m ? `<div class="vg-list-h">Map</div><div class="vg-sugg">${noteRow(m.id, "the topic's map of content")}</div>` : ""}
      ${secs.map(s => `<div class="vg-list-h">${s.h} <span class="vg-count">${s.ids.length}</span></div><ol class="vg-rp-list">${s.ids.map(id => `<li>${line(id)}</li>`).join("")}</ol>`).join("")}`;
  }
  function savePath() {
    const c = pathTopic, m = mocOf[c], secs = readingPath(c), title = `Reading Path — ${clusterName(c)}`;
    let k = 0;
    const md = `---\ncreated: ${today()}\ntags:\n  - type/guide\n---\n# ${title}\n\n> Generated by Vault Graph on ${today()}: the topic's map, then its most central notes, following links outward from the hub.\n\n` +
      (m ? `**Map:** ${mdLink(m.id)}\n\n` : "") + secs.map(s => `## ${s.h}\n\n${s.ids.map(id => `${++k}. ${mdLink(id)}`).join("\n")}`).join("\n\n") + "\n";
    write(`${FOLDERS.inbox}/${safeName(title)}.md`, md, "create", "Reading path");
  }

  // Code ↔ docs: git history (paths and dates only) against the files and components your notes name
  function lensCode() {
    const C = DATA.code; if (!C || !C.repos || !C.repos.length) return `<div class="vg-empty">No git repos found${C && C.roots && C.roots.length ? ` in ${esc(C.roots.join(" or "))}` : ""}.</div>`;
    // paths shown without the folders every area shares (a lone repo's name, its src/)
    const lead = (() => { const ps = (C.areas || []).map(a => a[0].split("/")); let k = 0;
      while (ps.length > 1 && ps.every(p => p.length > k + 1 && p[k] === ps[0][k])) k++; return k ? ps[0].slice(0, k).join("/") + "/" : ""; })();
    const short = p => (lead && p.startsWith(lead) ? p.slice(lead.length) : p);
    const docRow = (rel, sub) => { const n = byId[rel], name = rel.split("/").pop().replace(/\.md$/, "");
      return `<button class="vg-item" ${n ? `data-id="${esc(rel)}"` : opts.openNote ? `data-open="${esc(rel)}"` : ""}><span class="vg-dot" style="background:${n ? dotOf(rel) : "var(--vg-muted)"}"></span><span class="vg-item-main"><span>${esc(name)}</span><span class="vg-item-sub">${sub}</span></span></button>`; };
    const area = a => `<div class="vg-cd-area"><span class="vg-cd-path" title="${esc(a[0])}">${esc(short(a[0]))}</span><span class="vg-muted">${a[1]} commits · 90d · ${a[2]} · year · ${plural(a[4], "file")} · last ${shortDate(a[3])}</span></div>`;
    const isTest = p => /(^|\/)__tests__(\/|$)|\.test\.|\.spec\./.test(p);   // tests don't need a doc of their own
    const undoc = C.areas.filter(a => !a[5].length && !isTest(a[0])), covered = C.areas.filter(a => a[5].length).slice(0, 15);
    const hotFiles = (C.hot || []).filter(f => !f[4].length && !isTest(f[0])).slice(0, 15);
    return `<div class="vg-stats"><div class="vg-stat"><b>${C.docs}</b><span>notes name code</span></div><div class="vg-stat"><b>${undoc.length}</b><span>busy folders, no doc</span></div><div class="vg-stat"><b>${C.behind.length}</b><span>docs behind their code</span></div></div>
      <p class="vg-muted vg-lens-note">Git history for ${C.repos.map(esc).join(", ")} over the last ${C.days} days (file paths and dates only), matched against file names, paths and component names in your notes. A bare "route.js" only counts when it points at exactly one file.</p>
      <div class="vg-list-h">Changes often, no doc <span class="vg-count">${undoc.length}</span></div>
      ${undoc.slice(0, 20).map(area).join("") || `<div class="vg-empty">Every busy folder has at least one note.</div>`}
      ${hotFiles.length ? `<details class="vg-ft-more"><summary>Busiest files no note mentions <span class="vg-count">${hotFiles.length}</span></summary>${hotFiles.map(f => `<div class="vg-cd-area"><span class="vg-cd-path" title="${esc(f[0])}">${esc(short(f[0]))}</span><span class="vg-muted">${f[2]} commits · 90d · ${f[1]} · year · last ${shortDate(f[3])}</span></div>`).join("")}</details>` : ""}
      <div class="vg-list-h">Docs behind their code <span class="vg-count">${C.behind.length}</span></div>
      <p class="vg-muted vg-lens-note">Commits to the files a note names, made after the note was last edited. Release notes, scopes of work and dated notes are left out: they describe the code as it was. Edit dates come from file timestamps: a bulk edit (a tag migration, say) makes older docs look current.</p>
      ${C.behind.slice(0, 30).map(b => `<div class="vg-cd-doc">${docRow(b[0], `last edited ${shortDate(b[1])} · ${plural(b[2], "commit")} since`)}
        <div class="vg-cd-files">${b[3].map(r => `<span title="${esc(r[0])}">${esc(r[0].split("/").slice(-2).join("/"))} <b>+${r[1]}</b></span>`).join("")}</div></div>`).join("") || `<div class="vg-empty">No doc is behind its code.</div>`}
      <details class="vg-ft-more"><summary>Busiest folders and the notes that cover them <span class="vg-count">${covered.length}</span></summary>${covered.map(a => `${area(a)}<div class="vg-cd-covers">${a[5].slice(0, 6).map(r => docRow(r, "")).join("")}${a[5].length > 6 ? `<span class="vg-muted">+${a[5].length - 6} more</span>` : ""}</div>`).join("")}</details>`;
  }

  function wireLensExtras(body) {
    body.querySelectorAll("[data-sttasks]").forEach(d => { const box = d.closest(".vg-st-row").querySelector(".vg-st-tasks");
      d.onclick = e => { e.stopPropagation(); toggleTasks(d.dataset.sttasks, box); };
      if (openTasks.has(d.dataset.sttasks)) renderTasks(d.dataset.sttasks, box); });
    body.querySelectorAll("[data-archive]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      if (await VGActions.run("archive", byId[d.dataset.archive], actionCtx(), e)) { const row = d.closest(".vg-sugg"); if (row) row.remove(); } else d.disabled = false; });
    const ftMark = (key, how) => { const [d] = key.split("|"); review.ft = { ...(review.ft || {}), [key]: { how, date: today(), t: key.slice(d.length + 1) } };
      logDiscovery(`${how === "done" ? "Marked done" : "Dropped"} a standup plan: ${key.slice(d.length + 1).slice(0, 60)}`); persistSoon(); refreshLens(); };
    body.querySelectorAll("[data-ftdone]").forEach(d => d.onclick = e => { e.stopPropagation(); ftMark(d.dataset.ftdone, "done"); });
    body.querySelectorAll("[data-ftdrop]").forEach(d => d.onclick = e => { e.stopPropagation(); ftMark(d.dataset.ftdrop, "dropped"); });
    body.querySelectorAll("[data-ftundo]").forEach(d => d.onclick = e => { e.stopPropagation(); const ft = { ...(review.ft || {}) }; delete ft[d.dataset.ftundo]; review.ft = ft; persistSoon(); refreshLens(); });
    body.querySelectorAll("[data-ftopen]").forEach(d => d.onclick = e => { e.stopPropagation(); opts.openNote(standupPath(d.dataset.ftopen), e.ctrlKey || e.metaKey); });
    body.querySelectorAll("[data-reviewed]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      if (!await VGActions.run("current", byId[d.dataset.reviewed], actionCtx(), e)) d.disabled = false; });
    body.querySelectorAll("[data-ghost]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      try { await createGhost(byId[d.dataset.ghost]); refreshLens(); } catch (err) { d.disabled = false; toast("Couldn't create the note", "warn"); } });
    body.querySelectorAll("[data-openboth]").forEach(d => d.onclick = e => { e.stopPropagation(); const [a, b] = d.dataset.openboth.split("|"); opts.openNote(a, false); opts.openNote(b, true); });
    body.querySelectorAll("[data-notdup]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [a, b] = d.dataset.notdup.split("|");
      if (!await confirmBox("Not duplicates", `Stop suggesting <b>${esc(byId[a].name)}</b> and <b>${esc(byId[b].name)}</b> as duplicates?`, "Not duplicates")) return;
      await opts.dismissPair(a, b, "similar"); DATA.near_dupes = (DATA.near_dupes || []).filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))); refreshLens(); });
    const pick = body.querySelector(".vg-rp-pick"); if (pick) pick.onchange = () => { pathTopic = +pick.value; refreshLens(); };
    const sp = body.querySelector("[data-savepath]"); if (sp) sp.onclick = () => savePath();
    const rv = body.querySelector("[data-rvskip]");
    if (rv) rv.onchange = () => { riverSkipTop = rv.checked; refreshLens(); };
    body.querySelectorAll("[data-addmap]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [mid, id] = d.dataset.addmap.split("|");
      if (await addToMap(mid, [id], d)) refreshLens(); });
    body.querySelectorAll("[data-addall]").forEach(d => d.onclick = async e => { e.stopPropagation(); const m = mocs.find(x => x.id === d.dataset.addall); if (!m) return;
      const ids = m.clusters.flatMap(c => (m.missing[c] || []).filter(id => byId[id]));
      if (!await confirmBox("Add to map", `Add <b>${plural(ids.length, "note")}</b> to <b>${esc(m.title)}</b> under "Also in this topic"?`, "Add")) return;
      if (await addToMap(m.id, ids, d)) refreshLens(); });
    body.querySelectorAll("[data-draftmap]").forEach(d => d.onclick = e => { e.stopPropagation(); const c = +d.dataset.draftmap;
      writeMap(topicNotes(c).sort(byInfluence).map(n => n.id), clusterName(c)); });
    body.querySelectorAll("[data-fold]").forEach(d => d.onclick = e => { e.stopPropagation(); const f = d.dataset.fold;
      const ids = new Set(nodes.filter(n => !special(n) && folderOf(n.id) === f).map(n => n.id)); if (!lensBeside()) closeLens();
      setHighlight(ids, `folder · ${f}`); select(null); const lit = ids; fit(n => lit.has(n.id), 400); });
    body.querySelectorAll("[data-fp]").forEach(d => d.onclick = e => { e.stopPropagation();
      const box = body.querySelector(".vg-rg-detail"); if (!box) return;
      const folders = [...body.querySelectorAll(".vg-rg-arc")].map(x => x.dataset.fold), [i, j] = d.dataset.fp.split(",").map(Number), A = folders[i], B = folders[j];
      const ls = links.filter(l => l.kind === "link" && !special(l.s) && !special(l.t) && ((folderOf(l.s.id) === A && folderOf(l.t.id) === B) || (folderOf(l.s.id) === B && folderOf(l.t.id) === A)));
      box.innerHTML = `<div class="vg-card"><div class="vg-card-h"><span>${esc(A)} ↔ ${esc(B)}</span><span class="vg-muted vg-card-hint">${plural(ls.length, "link")}</span></div>${ls.slice(0, 40).map(l =>
        `<button class="vg-item" data-id="${esc(l.s.id)}"><span class="vg-item-main"><span>${esc(l.s.name)} → ${esc(l.t.name)}</span><span class="vg-item-sub">${esc(folderOf(l.s.id))} → ${esc(folderOf(l.t.id))}</span></span></button>`).join("")}${ls.length > 40 ? `<div class="vg-empty">…and ${ls.length - 40} more</div>` : ""}</div>`;
      wireLens(box); box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }); });
  }

  // ---------------------------------------------------------------- food web: dependents and keystones
  // What depends on a note: everything above it in the web that links to it, and what links to those, and so on.
  // A keystone is a stale note many others depend on: the notes most worth keeping current.
  let depMemo = null;
  function dependents(id) {
    const F = mapCache.foodweb; if (!F) return new Set();
    if (depMemo && depMemo.F === F && depMemo.links === links.length && depMemo.m.has(id)) return depMemo.m.get(id);
    if (!depMemo || depMemo.F !== F || depMemo.links !== links.length) depMemo = { F, links: links.length, m: new Map() };
    const y = i => (F.pos.get(i) || [0, -1e9])[1], seen = new Set([id]), q = [id];
    while (q.length) { const x = q.shift(); for (const m of nb[x] || []) if (!seen.has(m) && byId[m] && !special(byId[m]) && !byId[m].isolated && y(m) < y(x) - 60) { seen.add(m); q.push(m); } }
    seen.delete(id); depMemo.m.set(id, seen); return seen;
  }
  const keystones = () => !mapCache.foodweb ? [] : nodes.filter(n => !special(n) && !n.ghost && !n.isolated && staleFor(n, Q.stale_days))
    .map(n => ({ n, deps: dependents(n.id).size })).filter(x => x.deps >= 3).sort((a, b) => b.deps - a.deps || b.n.age - a.n.age);

  // ---------------------------------------------------------------- radar triage: the oldest waiting tasks, one note at a time
  let triage = null;
  function startTriage() {
    const q = nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0).sort((a, b) => (b.taskAge ?? b.age ?? 0) - (a.taskAge ?? a.age ?? 0)).map(n => n.id);
    if (!q.length) { toast("No open tasks", "ok"); return; }
    if (st.view !== "radar") setView("radar");
    triage = { q, i: 0 }; showTriage();
  }
  function showTriage() {
    const bar = $(".vg-triage"); if (!triage) { bar.hidden = true; return; }
    const id = triage.q[triage.i], n = byId[id]; bar.hidden = false;
    $(".vg-triage-text").textContent = `Triage ${triage.i + 1} / ${triage.q.length} · ${n.name} · oldest task ${n.taskAge ?? n.age} days`;
    select(id); centreOn(id, 1.6);
  }
  function stopTriage() { triage = null; $(".vg-triage").hidden = true; }
  $(".vg-triage-next").onclick = () => { if (!triage) return; triage.i = (triage.i + 1) % triage.q.length; showTriage(); };
  $(".vg-triage-prev").onclick = () => { if (!triage) return; triage.i = (triage.i - 1 + triage.q.length) % triage.q.length; showTriage(); };
  $(".vg-triage-stop").onclick = () => { stopTriage(); select(null); };

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
  const fuzzy = (q, s) => {   // subsequence score: contiguous + word-start matches rank higher
    s = s.toLowerCase(); q = q.replace(/\s+/g, ""); let i = 0, score = 0, run = 0, prev = -2;   // spaces separate words; titles often use - or _ instead
    for (const ch of q) {
      const j = s.indexOf(ch, i); if (j < 0) return -1;
      run = j === prev + 1 ? run + 1 : 0; score += 1 + run * 2 + (j === 0 || " -_/·".includes(s[j - 1]) ? 3 : 0);
      prev = j; i = j + 1;
    }
    // letters scattered through a long text (a cluster's keywords) match almost any query: not a match
    if (q.length > 3 && score < q.length * 1.6) return -1;
    return score - s.length * 0.01;
  };
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
    const input = $(".vg-pq"); input.value = "";
    input.placeholder = palMode && palMode.pick ? palMode.placeholder || "Choose a note…" : palMode && palMode.linkFrom ? `Link “${byId[palMode.linkFrom].name}” from which note?` : palMode && palMode.pickFor ? "Which note or MOC is this star?" : palMode ? `Path from “${byId[palMode.pathFrom].name}” to…` : "Search notes and clusters…";
    renderPalette(""); input.focus();
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
      const ids = new Set(); links.forEach(l => { if (l.kind === "gap" || l.kind === "similar") { ids.add(l.s.id); ids.add(l.t.id); } });
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
    neural: ["brain", "Neural", "Topics as brain lobes, links firing between them"], cosmos: ["orbit", "Cosmos", "Maps become stars; place planets and fly missions"] };
  // network graphs and scenes share one tab; Display = style presets + node size/colour, layers, saved views (was the
  // sidebar's View tab); Health = the overlays (was the sidebar's Health tab)
  const PICK_TABS = [["views", "Views"], ["lenses", "Lenses"], ["style", "Display"], ["health", "Health"]];
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
    Object.entries(GRAPH_INFO).forEach(([k, [ic, name, hint]]) => { if (!(opts.compact && k === "cosmos")) out.push({ tab: "views", k, ic, name, hint, on: st.view === k, run: () => setView(k) }); });
    Object.entries(MAPS).forEach(([k, name]) => out.push({ tab: "views", k, ic: MAP_INFO[k][0], name, hint: MAP_INFO[k][1], on: st.view === k, run: () => setView(k) }));
    if (!opts.compact) Object.entries(LENSES).forEach(([k, l]) => out.push({ tab: "lenses", k, ic: "grid", name: l.name, hint: l.hint, on: lensKey === k, run: () => openLens(k) }));
    Object.entries(PRESETS).forEach(([k, p]) => out.push({ tab: "style", k, ic: "sparkles", name: p.name, hint: p.hint, on: st.preset === k, run: () => applyPreset(k) }));
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));   // A–Z within every tab
    if (opts.writeNote && !opts.compact) out.push({ tab: "views", k: "newscene", ic: "plus", name: "New scene", hint: "Your own view, written in a note", on: false, run: () => newScene() });
    return out;
  }
  // The views tab in groups (a view not named here lands in "More"); Recent first when there's history
  const VIEW_GROUPS = [
    ["Graph", ["2d", "3d", "neural", "cosmos"]],
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
      ? tabs.map(([t, name]) => { const xs = items.filter(i => i.tab === t && hit(i)); return xs.length ? `<div class="vg-list-h">${name}</div><div class="vg-tiles">${xs.map(tile).join("")}</div>` : ""; }).join("") || `<div class="vg-empty">No view matches “${esc(q)}”.</div>`
      : pickTab === "views" ? viewGroups(items.filter(i => i.tab === "views")).map(([name, xs]) => `<div class="vg-list-h">${name}</div><div class="vg-tiles">${xs.map(tile).join("")}</div>`).join("")
      : items.some(i => i.tab === pickTab) ? `${pickTab === "style" ? `<div class="vg-list-h">Styles</div>` : ""}<div class="vg-tiles">${items.filter(i => i.tab === pickTab).map(tile).join("")}</div>` : "";
    $$(".vg-picker-tab").forEach(b => b.onclick = () => { pickTab = b.dataset.tab; $(".vg-picker-q").value = ""; renderPicker(); });
    $$(".vg-picker-body .vg-tile").forEach(b => b.onclick = () => { const it = items.find(i => i.tab === b.dataset.tab && i.k === b.dataset.k); pickTab = it.tab; closeMenu(); it.run(); });
  }
  function openPicker(tab) {
    const p = $(".vg-picker"), b = $(".vg-pickbtn");
    pickTab = tab || (lensKey ? "lenses" : "views");
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
  // Missions and quests take ~85 ms to work out: do it once the graph is on screen, not during the opening zoom
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
    hideGameItem,   // the sidebar's "Not for me" on a quest or mission   // actions taken elsewhere (sidebar) count toward XP and quests
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
