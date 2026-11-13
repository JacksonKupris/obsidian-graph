
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Real "last edited" dates. File dates mean nothing here (bulk link and tag passes and Obsidian Sync touched nearly
// every note), so a note's age is days since its *content* changed: a fingerprint of the body without frontmatter,
// Related / Merged-from sections, "Possible duplicate" / "Overlaps with" lines, generated hub lists or whitespace.
// A note's fingerprint: its body without generated sections (FNV-1a over UTF-16 code units); the log is
// .obsidian/plugins/jk-vault-graph/content-log.json ({path: {h, since}}), kept current here as you edit and checked by every analysis run.
const CONTENT = { log: {}, path: VGRules.files.content_log, dirty: false };   // in the plugin folder: not indexed, so it stays out of recent-files lists
const GEN_MARK = "%% vault-graph:generated", DROP_SECTION = /^#{1,6}\s*(related\b|merged from\b)/i, DROP_LINE = /possible duplicate:|overlaps with/i;
const FM_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
function contentBody(text) {
  const out = []; let skip = false;
  for (const line of text.replace(FM_BLOCK, "").split(GEN_MARK)[0].split(/\r\n|\r|\n/)) {
    if (line.trimStart().startsWith("#")) { skip = DROP_SECTION.test(line.trim()); if (skip) continue; }
    if (skip || DROP_LINE.test(line)) continue;
    out.push(line);
  }
  return out.join(" ").split(/\s+/).filter(Boolean).join(" ");
}
function fingerprint(text) {
  const s = contentBody(text); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const daysSince = iso => Math.max(0, Math.round((Date.parse(today() + "T12:00") - Date.parse(iso + "T12:00")) / VGShared.DAY_MS));
// age = days since the content changed, or since it was last confirmed current ("Still current" stamps `reviewed:`)
function contentAge(app, path, fallback) {
  const e = CONTENT.log[path], f = fileIn(app.vault, path);
  const rv = f && (fmIn(app.metadataCache, f) || {}).reviewed;
  const since = [e && e.since, rv && /^\d{4}-\d{2}-\d{2}/.test(String(rv)) ? String(rv).slice(0, 10) : null].filter(Boolean).sort().pop();
  return since ? daysSince(since) : fallback;
}

// Live link sync. Clusters, influence, gaps and evidence come from the weekly analysis,
// but links change every day, so the link edges are rebuilt from Obsidian's own index on every open:
// new links show at once, removed links disappear, notes created since the run join the cluster most of
// their neighbours are in, deleted notes drop out, and suggestions you've since linked stop showing.
// this vault's folders, worked out again whenever the rules change (ruleConsts)
let DAILY_TOP, PEOPLE_TOP, SKIP_TOP, EXCLUDE_PREFIXES;   // EXCLUDE_PREFIXES: never analysed (vault_lib.EXCLUDE_PREFIXES)
function ruleConsts() {
  DAILY_TOP = VGRules.folders.daily; PEOPLE_TOP = VGRules.folders.people;
  SKIP_TOP = new Set([...VGRules.folders.skip, VGRules.folders.scripts, ".trash"]);
  EXCLUDE_PREFIXES = (VGRules.folders.exclude || []).map(p => p.replace(/\/?$/, "/"));
  CONTENT.path = VGRules.files.content_log;
}
ruleConsts();   // the built-in rules until onload's loadRules brings this vault's
// a scene written in a note: ```vault-graph-scene ... ``` (VGRules.sceneSpec reads it)
const SCENE_LANG = "vault-graph-scene", SCENE_BLOCK = /^```vault-graph-scene[^\S\n]*\n([\s\S]*?)^```/gm, SCENE_BLOCK_START = /^```vault-graph-scene/gm;
const hasOpenTask = fc => (fc.listItems || []).some(i => i.task === " ");
const DISMISSED = new Set();   // dismissed pairs by note name (dismissKey); kept current by the plugin, applied in liveMerge
// Shared rules: records are never "stale"; dismissals match
// by note name like the analysis, so a same-name copy counts as dismissed too
const { dismissKey } = VGRules, staleFor = (n, days) => VGRules.isStale(n, days);   // the current rules' stale
function liveMerge(app, data, since) {
  const vault = app.vault, cache = app.metadataCache, resolved = cache.resolvedLinks || {};
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const exists = id => !!fileIn(vault, id);
  const knowledge = file => {   // a topic note (VGRules.noteKind, the engine's and the analysis's rule; catch-all hubs aside)
    if (file.extension !== "md" || SKIP_TOP.has(file.path.split("/")[0]) || EXCLUDE_PREFIXES.some(x => file.path.startsWith(x)) || file.path.split("/").includes("node_modules")) return false;
    return VGRules.noteKind(file.path, VGEngine.frontmatterTags(fmIn(cache, file))) === "note";
  };
  // Inbox notes a topic note links to join (VGRules.joinsWhenLinked): a note you just created for a wanted link
  const linkedFromTopics = new Set();
  for (const [src, targets] of Object.entries(resolved)) {
    const f = fileIn(vault, src);
    if ((byId.has(src) && !byId.get(src).person && !byId.get(src).moc) || (f instanceof TFile && knowledge(f))) Object.keys(targets).forEach(t => linkedFromTopics.add(t));
  }
  const joins = file => linkedFromTopics.has(file.path) && !VGRules.isHubName(file.path)
    && VGRules.joinsWhenLinked(file.path, (fmIn(cache, file) || {}).tags);
  const removed = data.nodes.filter(n => !n.person && !exists(n.id)).map(n => n.id);   // MOCs too
  removed.forEach(id => byId.delete(id));
  const added = [];
  for (const file of vault.getMarkdownFiles()) {
    if (byId.has(file.path) || !(knowledge(file) || joins(file))) continue;
    const n = { id: file.path, name: file.basename, cluster: -1, bc: 0, folder: file.parent ? file.parent.path : "", mentions: 0, recent: 0,
      inlinks: 0, outlinks: 0, broken: 0, tasks: 0, words: 0, age: 0, refs: false, isolated: true, live: true };
    byId.set(n.id, n); added.push(n);
  }
  const isNote = id => byId.has(id) && !byId.get(id).person && !byId.get(id).moc;
  const key = VGRules.pairKey;
  const old = new Set(data.links.filter(l => l.kind === "link").map(l => key(l.source, l.target)));
  const now = new Map(), inl = new Map(), outl = new Map();
  for (const [src, targets] of Object.entries(resolved)) {
    if (!isNote(src)) continue;
    for (const dst of Object.keys(targets)) {
      if (dst === src || !isNote(dst)) continue;
      outl.set(src, (outl.get(src) || 0) + 1); inl.set(dst, (inl.get(dst) || 0) + 1);
      now.set(key(src, dst), [src, dst]);
    }
  }
  let gained = 0, lost = 0;
  now.forEach((_, k) => { if (!old.has(k)) gained++; });
  old.forEach(k => { if (!now.has(k)) lost++; });
  // Obsidian's link index is empty or still being built (startup, a big sync): it reads as "most links deleted". Keep
  // the analysis links untouched and say so; graphData() merges again once the index is complete. Real edits never
  // remove more than half the vault's links in one go.
  if (old.size >= 20 && lost > old.size * 0.5) {
    data.live = { added: 0, removed: 0, gained: 0, lost: 0, written: 0, mapAdds: 0, indexNotReady: true, indexLinks: now.size, analysisLinks: old.size };
    return;
  }
  // wanted notes: drop the ones written since the run (they're real notes now)
  const written = new Set((data.wanted || []).filter(w => cache.getFirstLinkpathDest && cache.getFirstLinkpathDest(w.name, "")).map(w => w.id));
  data.wanted = (data.wanted || []).filter(w => !written.has(w.id)).map(w => ({ ...w, refs: w.refs.filter(r => byId.has(r)) })).filter(w => w.refs.length);
  const wantedIds = new Set(data.wanted.map(w => w.id));
  const keep = data.links.filter(l => l.kind !== "link" && byId.has(l.source) && (byId.has(l.target) || wantedIds.has(l.target))
    && !(VGRules.isSuggestion(l) && (now.has(key(l.source, l.target)) || DISMISSED.has(dismissKey(l.source, l.target)))));   // acted on or dismissed since the run
  data.links = keep.concat([...now.values()].map(([s, t]) => ({ source: s, target: t, w: 1, kind: "link" })));
  // pairs linked by the same notes (VGEngine.sharedPairs): a suggestion every vault gets from its own links. Not a pair
  // you dismissed, already linked (a same-name copy counts), one title, one dated series, a private note, or already suggested.
  { const nbs = new Map(), put = (a, b) => { if (!nbs.has(a)) nbs.set(a, new Set()); nbs.get(a).add(b); };
    now.forEach(([s, t]) => { put(s, t); put(t, s); });
    const offered = new Set(data.links.filter(l => VGRules.isSuggestion(l)).map(l => key(l.source, l.target)));
    const fm = id => { const f = fileIn(vault, id); return f instanceof TFile ? fmIn(cache, f) : undefined; };
    const series = id => VGEngine.seriesKey(id), title = id => VGEngine.cleanTitle(id).toLowerCase();
    // two notes with one title (dates and brackets aside) are copies or one name for two things: not a pair to link
    VGEngine.sharedPairs(nbs, { skip: (a, b) => offered.has(key(a, b)) || DISMISSED.has(dismissKey(a, b)) || VGRules.linkedByName(resolved, a, b) || title(a) === title(b)
        || (!!series(a) && series(a) === series(b)) || VGRules.isPrivate(a, fm(a)) || VGRules.isPrivate(b, fm(b)) })
      .forEach(p => data.links.push({ source: p.a, target: p.b, w: 1, kind: "shared", why: `${p.n} notes link to both` })); }
  const deg = new Map();
  now.forEach(([s, t]) => { (deg.get(s) || deg.set(s, []).get(s)).push(t); (deg.get(t) || deg.set(t, []).get(t)).push(s); });
  for (const n of byId.values()) {
    if (n.person || n.moc) continue;
    n.inlinks = inl.get(n.id) || 0; n.outlinks = outl.get(n.id) || 0; n.isolated = !deg.has(n.id);
    n.age = contentAge(app, n.id, n.age);   // real edits since the analysis count ("stale" goes away when you edit); bulk touches don't
    const f = fileIn(vault, n.id);   // tasks checked off or added since the analysis (the run counts "- [ ]" lines the same way)
    if (f instanceof TFile && (!since || f.stat.mtime > since)) n.tasks = ((cache.getFileCache(f) || {}).listItems || []).filter(li => li.task === " ").length;
  }
  for (const n of added) {   // a new note joins its neighbours' most common cluster
    const votes = {};
    (deg.get(n.id) || []).forEach(m => { const c = byId.get(m).cluster; if (c >= 0) votes[c] = (votes[c] || 0) + 1; });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best) n.cluster = +best[0];
    const f = fileIn(vault, n.id);
    n.age = contentAge(app, n.id, 0);
  }
  // Maps the analysis hasn't seen yet (Create map, or by hand) are maps at once -- the Today list, City's town halls
  // and "no map" all see them. Same rules as the analysis,
  // so a map never shows here and then vanishes at the next refresh. Its topic is the cluster most of its links point
  // into, and only a topic with no map yet: one map per topic.
  // a map deleted or renamed since the analysis is no map any more (renamed, it's found again below at its new path)
  data.mocs = (data.mocs || []).filter(m => exists(m.id));
  const known = new Set(data.mocs.map(m => m.id)), mapped = new Set(data.mocs.flatMap(m => m.clusters));
  const sizeOf = new Map((data.clusters || []).map(k => [k.id, k.size]));
  for (const file of vault.getMarkdownFiles()) {
    if (known.has(file.path) || !VGRules.isMapCandidate(file.path, fmIn(cache, file))) continue;
    const targets = Object.keys(resolved[file.path] || {}).filter(id => isNote(id));
    const votes = {}; targets.forEach(id => { const c = byId.get(id).cluster; if (c >= 0) votes[c] = (votes[c] || 0) + 1; });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]; if (!best || !VGRules.claims(best[1], sizeOf.get(+best[0]) || 0)) continue;
    const c = +best[0]; if (mapped.has(c)) continue;
    mapped.add(c); const title = file.basename.replace(/ (hub|moc)$/i, ""), mem = new Set(targets);
    const missing = [...byId.values()].filter(n => n.cluster === c && !n.person && !n.moc && !mem.has(n.id)).map(n => n.id);
    data.mocs = [...(data.mocs || []), { id: file.path, title, nav: false, clusters: [c], members: targets, missing: { [c]: missing }, live: true }];
    data.links = data.links.filter(l => !(l.kind === "moc" && l.source === file.path));   // it may already be a hub node with its links: they are written again below
    byId.set(file.path, { ...VGRules.mocNode(file.path, title, c, targets.length), live: true });
    targets.forEach(t => data.links.push({ source: file.path, target: t, w: 1, kind: "moc" }));
  }
  // the rest of what buttons change, so their warnings clear without waiting for the analysis:
  const dailyLinked = new Set(); for (const src in resolved) if (src.startsWith(DAILY_TOP + "/")) Object.keys(resolved[src]).forEach(t => dailyLinked.add(t));
  data.said_unlinked = (data.said_unlinked || []).filter(([id]) => byId.has(id) && !dailyLinked.has(id));   // "Link mentions" (or linking by hand)
  // "Not duplicates", or linked since: the analysis only offers unlinked pairs, but one built on another device before
  // your link synced there still has it, and linking is how you say the two are separate notes
  // a pair with the same text ("text") stays a duplicate even when one links the other
  data.near_dupes = (data.near_dupes || []).filter(([a, b, , how]) => byId.has(a) && byId.has(b) && !DISMISSED.has(dismissKey(a, b)) && (how === "text" || !VGRules.linkedByName(resolved, a, b)));
  for (const n of byId.values()) { const f = fileIn(vault, n.id);   // "Add reference"
    if (!n.person && f instanceof TFile && (!since || f.stat.mtime > since)) { const fm = fmIn(cache, f) || {}, r = fm.references; n.refs = !!(r && [].concat(r).length);
      // tags too ("Complete all", a status edit by hand): the shared rules read status/ and type/ tags, so stale clears at once
      n.tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, "").trim()).filter(Boolean); } }
  data.nodes = [...byId.values()];
  // Maps: members = the analysis's members (links + Dataview) plus whatever the map links to now, so a note
  // added to a map since the run stops being suggested for it. Same-name copies count as members too.
  const stem = VGRules.stem;
  let mapAdds = 0;
  for (const m of data.mocs || []) {
    const members = new Set(m.members || []);
    for (const id of Object.keys(resolved[m.id] || {})) if (byId.has(id) && !members.has(id)) { members.add(id); mapAdds++; }
    // names the map links, graph notes or not (a root dashboard): appendSection's "Already in…" counts these too,
    // so VGRules.onMap must, or a note whose name the map already links is suggested forever and never added
    m.linkedNames = [...new Set(Object.keys(resolved[m.id] || {}).map(stem))];
    const names = new Set([...[...members].map(stem), ...m.linkedNames]);
    m.members = [...members];
    for (const c of Object.keys(m.missing || {})) m.missing[c] = m.missing[c].filter(id => byId.has(id) && !members.has(id) && !names.has(stem(id)));
  }
  data.live = { added: added.length, removed: removed.length, gained, lost, written: written.size, mapAdds };
}

// Append a line to the note's last links section ("## Related", "## Related (added <date>)", "## Related notes"),
// or create "## Related (added <date>)" before the context-note footer ("---" + "**Related Standups**") or at the end.
// Other "## Related ..." headings ("Related Project Contexts", "Related Standups", "Related Issues Fixed") are the
// note's own sections, not where its links go. Line endings kept.
const RELATED_HEAD = /^## Related(?: notes)?(?: \(added [^)]*\))?\s*$/i;
function addRelatedLine(text, line) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.trim() === line.trim())) return text;
  let head = -1;
  lines.forEach((l, i) => { if (RELATED_HEAD.test(l)) head = i; });
  if (head >= 0) {
    let end = lines.findIndex((l, i) => i > head && (/^#{1,2} /.test(l) || l === "---"));
    if (end < 0) end = lines.length;
    let at = end;
    while (at > head + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, line);
    if (lines[at + 1] !== undefined && lines[at + 1].trim() !== "" && !lines[at + 1].startsWith("- ")) lines.splice(at + 1, 0, "");
    return lines.join(nl);
  }
  const section = [`## Related (added ${today()})`, "", line, ""];
  const footer = lines.findIndex((l, i) => l === "---" && (lines[i + 1] || "").trim() === "" && (lines[i + 2] || "").startsWith("**Related Standups**"));
  if (footer >= 0) { lines.splice(footer, 0, ...section); return lines.join(nl); }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return [...lines, "", ...section].join(nl);
}

module.exports.addRelatedLine = addRelatedLine;   // for tests

