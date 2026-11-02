// vault_graph_rules.js - the Vault Graph's shared rulebook: what "stale", "on a map", "quest done" and
// "mission still worth showing" mean. One copy, used by the graph view (page and plugin) and the plugin's
// sidebar; the build puts it ahead of both. Rule data (thresholds, patterns) lives in vault_graph_rules.json,
// which Python reads too.
//
// Rules are pure: they never read a surface's private state. Each caller passes a graph `g`, usually
// VGRules.graph(data); the view passes its own live adapter with the same shape:
//   g.node(id)            the node, or undefined
//   g.linked(a, b)        a real link joins the two notes
//   g.suggested(a, b)     the analysis still suggests the pair (gap or similar)
//   g.mapById(id)         a topic map (MOC, not nav), or undefined
//   g.mapForCluster(c)    the topic map covering cluster c, or undefined
//   g.hasCluster(c)       cluster c still exists
//   g.wanted(id)          id is still linked-to but unwritten
//   g.reviewed(key)       the review queue marked this item done
//
// Rule data: the build puts in defaults (the rules file it was given); the plugin replaces them when it loads with this vault's
// (VGRules.configure: its Obsidian settings, then its rules file). Every rule is rebuilt in place, and callers read
// VGRules.x when they run, so the vault's rules reach all of them.
const VGRules = (() => {
  function make(R) {
  const RECORD_TAG = new RegExp(R.record_tags), RECORD_PATH = new RegExp(R.record_paths), DATED = new RegExp(R.dated_name);
  // Records (finished work, release notes, meetings, reports, dated logs) are meant to stay as written: never "stale".
  const isRecord = n => (n.tags || []).some(t => RECORD_TAG.test(t)) || RECORD_PATH.test(n.id) || DATED.test(n.name || "");
  const isStale = (n, days = R.stale_days) => !!n && !isRecord(n) && n.age > days;

  // this device's calendar day (not UTC's): what "today" and every dated heading or stamp mean
  const localDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const today = () => localDay(new Date());
  // a title as a file name: nothing a path or a wikilink can't hold, at most 120 characters
  const safeName = s => String(s).replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

  // Notes match by name, lower-cased: wikilinks resolve by basename, so a same-name copy is the same note
  const stemCase = id => String(id || "").split("/").pop().replace(/\.md$/i, "");
  const stem = id => stemCase(id).toLowerCase();
  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  const dismissKey = (a, b) => pairKey(stem(a), stem(b));   // vault_gaps._dismissed matches by name too
  // a and b linked either way in Obsidian's resolvedLinks ({path: {target: n}}), a same-name copy counting (vault_gaps._linked)
  const linkedByName = (resolved, a, b) => [[a, b], [b, a]].some(([x, y]) => Object.keys((resolved || {})[x] || {}).some(t => stem(t) === stem(y)));

  // On a map = the map links the note or a same-name copy of it (the plugin's "Already in..." rule). linkedNames:
  // names the map links that aren't graph notes (set by liveMerge), which "Already in..." counts as well.
  const memo = new WeakMap();
  function onMap(m, id) {
    if (!m) return false;
    let c = memo.get(m);
    if (!c || c.members !== m.members || c.n !== m.members.length || c.linked !== m.linkedNames) {
      c = { members: m.members, n: m.members.length, linked: m.linkedNames, ids: new Set(m.members), stems: new Set([...m.members.map(stem), ...(m.linkedNames || [])]) };
      memo.set(m, c);
    }
    return c.ids.has(id) || c.stems.has(stem(id));
  }
  // first topic map listing the cluster (nav maps never count)
  const mapForCluster = (mocs, c) => (mocs || []).find(m => !m.nav && m.clusters.includes(c));
  // Could this note be a topic map? (moc_align.is_moc / vault_graph_rules.is_map_candidate: same rule.) 00-Inbox
  // is allowed, since Create map writes there; the analysis then claims the topic with `claims`.
  const HUB_NAME = new RegExp(R.hub_name, "i"), NOT_MAP_NAME = new RegExp(R.not_map_name, "i"), NOT_MAP_TOPS = new Set(R.not_map_tops);
  function isMapCandidate(id, frontmatter) {
    const fm = frontmatter || {}, name = stemCase(id);
    if (!id.includes("/") || NOT_MAP_TOPS.has(id.split("/")[0]) || id.includes("/" + R.folders.archive + "/") || NOT_MAP_NAME.test(name)) return false;
    const tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, ""));
    return tags.includes("meta/moc") || String(fm.type || "").toLowerCase() === "moc" || HUB_NAME.test(name);
  }
  const isHubName = id => HUB_NAME.test(stemCase(id));
  // a pair the graph suggests linking: daily co-mentions (gap), meaning (similar, Smart Connections), or many notes linking
  // both (shared). Every surface asks this, so a new kind of suggestion reaches all of them.
  const SUGGESTION_KINDS = new Set(["gap", "similar", "shared"]);
  // a private note (private_name in the rules file, or private: true): never offered as a link (vault_gaps._private)
  const PRIVATE = R.private_name ? new RegExp(R.private_name, "i") : null;
  const isPrivate = (id, fm) => (!!PRIVATE && PRIVATE.test(stemCase(id))) || (!!fm && fm.private === true);
  const isSuggestion = l => !!l && SUGGESTION_KINDS.has(l.kind);
  // a hub: shown, never clustered (a map or hub by tag, a hub by name, a dashboard at the vault's top level)
  const ROOT_HUBS = new Set(R.root_hubs || []);
  const isHub = (id, tags) => [].concat(tags || []).some(t => /^#?meta\/(hub|moc)$/i.test(String(t))) || ROOT_HUBS.has(id) || isHubName(id);
  // what a note is to the graph (vault_gaps.load_vault): "daily", "skip" (a folder no analysis reads), "hub" (shown,
  // never clustered), "person" or "note" (a topic note). The engine and the plugin's live merge both ask this.
  const SKIP_TOPS = new Set(R.folders.skip || []);
  const noteKind = (id, tags) => { const top = String(id).split("/")[0];
    if (top === R.folders.daily) return "daily";
    if (SKIP_TOPS.has(top)) return "skip";
    if (isHub(id, tags)) return "hub";
    return top === R.folders.people ? "person" : "note"; };
  // How prose names a note (vault_gaps._mention_matcher counts these, "Link mentions" links them): its title,
  // the topic of a "<Topic> - Context" note, and its aliases
  const CONTEXT_SUFFIX = new RegExp(R.context_suffix, "i");
  const isContextNote = name => CONTEXT_SUFFIX.test(name), contextTopic = name => name.replace(CONTEXT_SUFFIX, "");
  // A title counts only when it's distinctive (2+ words, or an acronym, CamelCase, digit or underscore word) and not
  // too generic (mention_stop); an alias always counts. vault_graph_rules.mention_names is the same rule.
  const MENTION_STOP = new Set((R.mention_stop || []).map(s => s.toLowerCase()));
  const distinctive = k => k.length >= 4 && (k.split(/\s+/).length >= 2 || /[A-Z].*[A-Z]|\d|_/.test(k)) && !MENTION_STOP.has(k.toLowerCase());
  const mentionNames = (name, aliases) => [...new Set([...[name, name.replace(CONTEXT_SUFFIX, "")].map(s => s.trim()).filter(distinctive),
    ...[].concat(aliases || []).filter(a => typeof a === "string").map(s => s.trim()).filter(s => s.length >= 2)])].sort((a, b) => b.length - a.length);
  // Food-web level 0 (producers: relied on, link out little) .. 4 (apex: logs, plans, task lists) per linked note.
  // By rank of a smoothed out-share, so a note with two outlinks no longer tops the web; vault_graph_rules.trophic_levels
  // is the same rule (the weekly note's keystones). In/out = links between graph notes, the analysis and liveMerge alike.
  function trophicLevels(notes) {
    const score = n => { const i = n.inlinks || 0, o = n.outlinks || 0; return (o + 1) / (i + o + 2) + 0.01 * Math.log1p(i + o) * (o >= i ? 1 : -1); };
    const ranked = notes.map(n => [score(n), n]).sort((a, b) => a[0] - b[0] || (a[1].id < b[1].id ? -1 : a[1].id > b[1].id ? 1 : 0));
    const cuts = R.trophic_cuts, out = new Map();
    ranked.forEach(([, n], k) => {
      let lv = cuts.filter(c => k / ranked.length >= c).length;
      if ((n.inlinks || 0) + (n.outlinks || 0) < R.trophic_min_degree) lv = Math.min(Math.max(lv, 1), cuts.length - 1);
      out.set(n.id, lv);
    });
    return out;
  }
  // A note in a provisional folder (00-Inbox) joins the graph once a topic note links to it, unless it's vault
  // maintenance or a report (vault_graph_rules.joins_when_linked: same rule)
  const PROVISIONAL = new Set(R.provisional_tops), PROVISIONAL_SKIP = new RegExp(R.provisional_skip_tags);
  const joinsWhenLinked = (id, tags) => PROVISIONAL.has(String(id).split("/")[0]) && ![].concat(tags || []).some(t => PROVISIONAL_SKIP.test(String(t).replace(/^#/, "")));
  // a map claims a topic when it lists enough of it
  const claims = (count, size) => count >= R.map_min_claim && count >= R.map_min_cover * size;

  // Scene blocks: a scene written in a note (```vault-graph-scene, YAML) instead of code. These are the words a block
  // may use; the renderer has one part per word (a test checks each has one), the plugin shows a block's errors under
  // it, and nothing in a block runs as code. when: which notes a rule picks (first matching rule wins).
  const SCENE_WHEN = {
    stale: n => isStale(n), current: n => !isStale(n), active: n => (n.age || 0) <= 7, quiet: n => (n.age || 0) > 30 && !isStale(n),
    unlinked: n => !!n.isolated, tasks: n => (n.tasks || 0) > 0, record: n => isRecord(n), else: () => true,
  };
  const SCENE_PARTS = {
    group: ["topic"],
    place: ["grid", "ring", "rows", "free"],
    as: ["walker", "block", "window", "gem", "flask", "star", "tree", "tower"],
    motion: ["none", "drift", "roam", "patrol", "lurch-in", "orbit", "rise", "fall"],
    wall: ["none", "map-coverage", "activity", "size"],
    angle: ["flat", "tilt", "iso"],
    every: ["activity", "tasks", "stale"],          // how often an event fires: as busy as the group is, or by its counts
    verb: ["shoot", "spark", "dispatch", "spar"],   // shoot/spark: a bolt at the nearest match; dispatch: a run there and
  };                                                // back; spar: two from the group trade blows, the more relied-on wins
  const fuzzyScore = (query, text) => {
    const s = String(text).toLowerCase(), q = String(query).toLowerCase().replace(/\s+/g, "");
    let i = 0, score = 0, run = 0, prev = -2;
    for (const ch of q) {
      const j = s.indexOf(ch, i); if (j < 0) return -1;
      run = j === prev + 1 ? run + 1 : 0; score += 1 + run * 2 + (j === 0 || " -_/·".includes(s[j - 1]) ? 3 : 0);
      prev = j; i = j + 1;
    }
    if (q.length > 3 && score < q.length * 1.6) return -1;
    return score - s.length * 0.01;
  };
  // Recall: find where something was dealt with before, inside notes, from whatever is half-remembered: words (also
  // misspelled or partial), when ("last month", "in June"), who (a name from the people folder), what kind of thing
  // (a command, SQL, a table, a checklist, a screenshot, an error) and where (a folder word). The same engine as
  // _System/vault_recall.py (tests/test_rules.js compares them), tuned by vault_graph_rules.json "recall".
  // recallChunks(text) / recallNoteDate(path, text) -> what to cache per note;
  // recallSearch([{ path, date, chunks }], query, { n, codeOnly, people, today }) -> [{ path, kind, lang, heading, line, score, why, date, snippet }]
  const RC = R.recall || { boost: {}, stop: "", synonyms: {}, per_note: 2, cues: { kinds: {} } };
  const ROLLUP = RC.rollup_pattern ? new RegExp(RC.rollup_pattern) : null;
  const RC_STOP = new Set(RC.stop.split(" ")), RC_WORD = /[a-z0-9][a-z0-9_\-.]*[a-z0-9]|[a-z0-9]/g, CUES = RC.cues;
  const KIND_RX = Object.fromEntries(Object.entries(CUES.kinds).filter(([, v]) => v.text).map(([k, v]) => [k, new RegExp(v.text, "i")]));
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const recallWords = text => {
    const out = [];
    text = String(text).replace(/([a-z])([A-Z])/g, "$1 $2") + " " + text;   // ExchangeOnline also counts as exchange, online
    for (const w of text.toLowerCase().match(RC_WORD) || []) {
      if (RC_STOP.has(w)) continue;
      out.push(w);
      if (/[-_.]/.test(w)) w.split(/[-_.]/).forEach(p => { if (p && !RC_STOP.has(p)) out.push(p); });
    }
    return out;
  };
  // when a note is from: a date in its name or path, else its frontmatter created/date
  function recallNoteDate(path, text) {
    const rx = /(20\d\d)-(\d\d)-(\d\d)/, stem = stemCase(path);
    let m = stem.match(rx) || String(path).match(rx);
    if (!m) { const fm = String(text).match(/^---\n([\s\S]*?)\n---/); m = fm && fm[1].match(/^(?:created|date)\s*:\s*['"]?(20\d\d)-(\d\d)-(\d\d)/m); }
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
  function recallChunks(text) {
    // line numbers count from the top of the file, frontmatter included (the line Obsidian opens at)
    const all = String(text).replace(/\r\n/g, "\n"), fm = all.match(/^---\n[\s\S]*?\n---\n/), skip = fm ? fm[0].split("\n").length - 1 : 0;
    const body = fm ? all.slice(fm[0].length) : all, out = [];
    let heading = "", buf = [], start = 1 + skip, code = null, lang = "", cstart = 0, cbuf = [];
    body.split("\n").forEach((line, k) => {
      const i = k + 1 + skip, f = line.match(/^(```+|~~~+)\s*([\w+\-#.]*)/);
      if (code !== null) { if (f && line.trim().startsWith(code.slice(0, 3))) { out.push(["code", heading, cstart, cbuf.join("\n"), lang]); code = null; } else cbuf.push(line); return; }
      if (f) { code = f[1]; lang = f[2].toLowerCase(); cstart = i; cbuf = []; return; }
      const h = line.match(/^(#{1,6})\s+(.*)/);
      if (h) { if (buf.some(x => x.trim())) out.push(["section", heading, start, buf.join("\n"), ""]); heading = h[2].trim(); buf = []; start = i; return; }
      buf.push(line);
    });
    if (buf.some(x => x.trim())) out.push(["section", heading, start, buf.join("\n"), ""]);
    return out.filter(c => c[0] === "code" ? c[3].trim() : c[3].trim().length > 20);
  }
  const iso = d => d.toISOString().slice(0, 10);
  // [from, to] ISO dates for a time phrase in the query, or null ("recently" = last 30 days)
  function recallTimeRange(query, today) {
    const t = today ? new Date(today + "T12:00:00Z") : new Date(), q = String(query).toLowerCase(), day = 864e5;
    const at = n => iso(new Date(t.getTime() - n * day)), wd = (t.getUTCDay() + 6) % 7;
    const monthSpan = (y, m) => [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    if (q.includes("yesterday")) return [at(1), at(1)];
    if (q.includes("today")) return [at(0), at(0)];
    if (q.includes("last week")) return [at(wd + 7), at(wd + 1)];
    if (q.includes("this week")) return [at(wd), at(0)];
    if (q.includes("last month")) { const m = t.getUTCMonth(); return m === 0 ? monthSpan(t.getUTCFullYear() - 1, 12) : monthSpan(t.getUTCFullYear(), m); }
    if (q.includes("this month")) return [iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), at(0)];
    if (q.includes("last year")) return [`${t.getUTCFullYear() - 1}-01-01`, `${t.getUTCFullYear() - 1}-12-31`];
    if (q.includes("this year")) return [`${t.getUTCFullYear()}-01-01`, at(0)];
    if (/\brecent(ly)?\b|\blately\b/.test(q)) return [at(30), at(0)];
    if (/\ba while (ago|back)\b|\blong (time )?ago\b/.test(q)) return ["2000-01-01", at(90)];
    for (let i = 0; i < 12; i++) {
      const name = MONTHS[i], m = q.match(new RegExp(`\\b(${name}|${name.slice(0, 3)})\\b\\.?\\s*(20\\d\\d)?`));
      if (m && (name !== "may" || m[2])) {   // "may" is a common word: the month only with a year ("May 2025")
        const y = m[2] ? +m[2] : (i + 1 <= t.getUTCMonth() + 1 ? t.getUTCFullYear() : t.getUTCFullYear() - 1);
        return monthSpan(y, i + 1);
      }
    }
    const y = q.match(/\b(20[12]\d)\b/);
    return y ? [`${y[1]}-01-01`, `${y[1]}-12-31`] : null;
  }
  // a and b one edit apart (insert, delete, swap or replace one letter)
  function edit1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
      return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]); }
    const [s, l] = a.length < b.length ? [a, b] : [b, a]; let i = 0;
    while (i < s.length && s[i] === l[i]) i++;
    return s.slice(i) === l.slice(i + 1);
  }
  // "near <note>": the note whose name best matches the words after a near-word, or null
  function recallNearTarget(query, paths) {
    const ql = String(query).toLowerCase();
    for (const w of CUES.near_words || []) {
      const m = ql.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:the\\s+)?(.+)$`)); if (!m) continue;
      const want = new Set(recallWords(m[1])), ov = p => recallWords(stemCase(p)).filter((x, i, a) => a.indexOf(x) === i && want.has(x)).length;
      let best = null; for (const p of paths) if (!best || ov(p) > ov(best) || (ov(p) === ov(best) && stemCase(p).length < stemCase(best).length)) best = p;
      if (best && ov(best) >= Math.max(1, Math.floor(want.size / 2))) return best;
    }
    return null;
  }
  // A note's search data that doesn't depend on the query (each chunk's word counts, the note's name, heading and folder
  // words), kept for as long as the note's chunks are: the plugin caches chunks per note until it changes, so each
  // keystroke scores the vault instead of re-reading every chunk's words (about 15,000 in this vault).
  const DOCS = new WeakMap();
  function docsOf(n) {
    let ds = n.chunks && typeof n.chunks === "object" ? DOCS.get(n.chunks) : null;
    if (ds) return ds;
    const name = stemCase(n.path), nw = new Set(recallWords(name)), pw = new Set(n.path.includes("/") ? recallWords(n.path.slice(0, n.path.lastIndexOf("/"))) : []);
    ds = n.chunks.map(([kind, heading, line, body, lang]) => {
      const tf = new Map(); recallWords(body).forEach(w => tf.set(w, (tf.get(w) || 0) + 1));
      return { path: n.path, name, kind, heading, line, body, lang, tf, len: [...tf.values()].reduce((a, b) => a + b, 0), date: n.date || "", nw, hw: new Set(recallWords(heading)), pw };
    });
    DOCS.set(n.chunks, ds);
    return ds;
  }
  // The searchable chunks of a set of notes, with the vocabulary (word -> chunks it's in) and the average chunk length,
  // reused while no note in the set changed (same notes, same cached chunks)
  let lastSet = null;
  function docSet(notes, codeOnly) {
    const L = lastSet;
    if (L && L.codeOnly === !!codeOnly && L.chunks.length === notes.length && notes.every((n, i) => L.chunks[i] === n.chunks)) return L;
    const docs = [];
    for (const n of notes) for (const d of docsOf(n)) if (!codeOnly || d.kind === "code") docs.push(d);
    const vocab = new Map(); docs.forEach(d => d.tf.forEach((_, w) => vocab.set(w, (vocab.get(w) || 0) + 1)));
    // which chunks hold each word: a search reads those, not all of them, so it stays fast as the vault grows
    const index = new Map(), note = (w, i) => { let a = index.get(w); if (!a) index.set(w, a = []); if (a[a.length - 1] !== i) a.push(i); };
    docs.forEach((d, i) => { d.tf.forEach((_, w) => note(w, i)); d.nw.forEach(w => note(w, i)); d.hw.forEach(w => note(w, i)); });
    return lastSet = { chunks: notes.map(n => n.chunks), codeOnly: !!codeOnly, docs, vocab, index, avg: docs.length ? docs.reduce((s, d) => s + d.len, 0) / docs.length : 0 };
  }
  function recallSearch(notes, query, o = {}) {
    const B = RC.boost, q = recallWords(query), qs = new Set(q), daily = (R.folders.daily || "01-Daily") + "/", FW = CUES.fuzzy_weight;
    const terms = new Map([...qs].map(t => [t, 1]));
    // each query word's own terms (itself, its synonyms, its close spellings): a word counts as matched when one of them is there
    const own = new Map([...qs].map(t => [t, new Set([t])]));
    [...qs].forEach(t => Object.entries(RC.synonyms).forEach(([k, alts]) => { if (t === k || alts.includes(t)) [k, ...alts].forEach(x => { own.get(t).add(x); if (!terms.has(x)) terms.set(x, 0.5); }); }));   // a synonym counts half
    const kinds = Object.entries(CUES.kinds).filter(([, v]) => v.words.some(w => qs.has(w))).map(([k]) => k);
    const span = recallTimeRange(query, o.today), who = [...qs].filter(t => (o.people || []).includes(t));
    // the graph: links (with similar-meaning pairs) and how much each note is relied on (o.graph = { links: [[a, b, kind]], use: { path: n } })
    const G = o.graph || { links: [], use: {} }, nbr = new Map(), sim = new Map(), add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
    G.links.forEach(([a, b, k]) => { const m = k === "similar" ? sim : nbr; add(m, a, b); add(m, b, a); });
    const use = G.use || {}, umax = Math.max(1e-9, ...Object.values(use).map(v => Math.log1p(v)), 0) || 1;
    const near = recallNearTarget(query, notes.map(n => n.path)), nearSet = near ? new Set([...(nbr.get(near) || []), ...(sim.get(near) || [])]) : new Set();
    const { docs, vocab, avg, index } = docSet(notes, o.codeOnly);
    if (!docs.length) return [];
    // a word the vault doesn't have: close spellings and longer words that start with it
    [...qs].forEach(t => { if (vocab.has(t) || /^\d+$/.test(t) || t.length < 4) return;
      [...vocab.keys()].filter(w => w.startsWith(t) || (t.length >= 5 && edit1(t, w))).sort((a, b) => vocab.get(b) - vocab.get(a)).slice(0, 3)
        .forEach(w => { own.get(t).add(w); if (!terms.has(w)) terms.set(w, FW); }); });
    const N = docs.length, df = new Map(), hits = [];
    terms.forEach((_, t) => df.set(t, vocab.get(t) || 0));   // the vocabulary already counts the chunks each word is in
    const wanted = new Set(); terms.forEach((_, t) => (index.get(t) || []).forEach(i => wanted.add(i)));
    for (const i of wanted) { const d = docs[i];
      const { nw, hw, pw } = d, why = new Set(), L = d.len || 1; let score = 0;
      terms.forEach((wt, t) => {
        const f = d.tf.get(t) || 0; if (!f && !nw.has(t) && !hw.has(t)) return;
        const n = df.get(t) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        let s = f ? idf * f * (1.4 + 1) / (f + 1.4 * (1 - 0.75 + 0.75 * L / avg)) : 0;
        if (nw.has(t)) { s += idf * B.name; why.add("name"); }
        if (hw.has(t)) { s += idf * B.heading; why.add("heading"); }
        if (f) why.add(d.kind === "code" ? "code" : "text");
        if (wt === FW && !qs.has(t)) why.add("close spelling");
        score += s * wt;
      });
      if (!score) continue;
      const matched = [...qs].filter(t => pw.has(t) || [...own.get(t)].some(w => d.tf.has(w) || nw.has(w) || hw.has(w))).length;
      score *= Math.pow(matched / Math.max(1, qs.size), 1.5);   // every query word that matches counts a lot
      if (ROLLUP && ROLLUP.test(d.path)) score *= B.rollup;   // a rollup repeats the standups it sums up: the original answers first
      if (qs.size && [...qs].every(t => [...own.get(t)].some(w => nw.has(w)))) score *= B.name_all;   // a note named for all of it is about it
      if (d.kind === "code") score *= B.code;
      const ls = d.body.split("\n").filter(l => l.trim());
      if (ls.length && ls.filter(l => /^\s*([-*]\s*)?\[\[/.test(l)).length / ls.length >= 0.5) score *= B.links;   // a hub points at the answer
      if (d.path.startsWith(daily) && d.kind !== "code") score *= B.daily;
      for (const k of kinds) { const v = CUES.kinds[k];   // the kind of thing asked for
        if ((d.kind === "code" && (v.langs || []).includes(d.lang)) || (KIND_RX[k] && ls.some(l => KIND_RX[k].test(l)))) { score *= CUES.kind_boost; why.add(k); break; } }
      if (span) { if (d.date && span[0] <= d.date && d.date <= span[1]) { score *= CUES.time_boost; why.add("when"); } else score *= CUES.time_miss; }
      if (who.some(p => d.tf.has(p))) { score *= CUES.person_boost; why.add("who"); }
      if ([...qs].some(t => pw.has(t))) { score *= CUES.folder_boost; why.add("folder"); }
      if (nearSet.has(d.path)) { score *= CUES.near_boost; why.add("near"); }
      score *= 1 + CUES.usage_boost * Math.log1p(use[d.path] || 0) / umax;   // notes you rely on, a little higher
      hits.push({ score, d, why: [...why].sort() });
    }
    hits.sort((a, b) => b.score - a.score || (a.d.path < b.d.path ? -1 : a.d.path > b.d.path ? 1 : a.d.line - b.d.line));
    const seen = new Map(), out = [];
    for (const { score, d, why } of hits) {
      if ((seen.get(d.path) || 0) >= RC.per_note) continue;   // a long note doesn't fill the list
      seen.set(d.path, (seen.get(d.path) || 0) + 1);
      const ls = d.body.split("\n").filter(l => l.trim()), count = l => q.filter(t => l.toLowerCase().includes(t)).length;
      const best = ls.reduce((bi, l, i) => count(l) > count(ls[bi]) ? i : bi, 0), lo = Math.max(0, best - (d.kind === "code" ? 1 : 0));
      out.push({ path: d.path, kind: d.kind, lang: d.lang, heading: d.heading, line: d.line, score: Math.round(score * 100) / 100, why, date: d.date,
        snippet: ls.slice(lo, lo + (d.kind === "code" ? 4 : 2)).map(l => l.slice(0, 200)).join("\n") });
      if (out.length >= (o.n || 10)) break;
    }
    // related: notes similar in meaning to the top hits, then the top hit's most relied-on linked notes
    const have = new Set(out.map(h => h.path)), byPath = new Map(notes.map(n => [n.path, n])), rel = [];
    out.slice(0, 3).forEach(h => [...(sim.get(h.path) || [])].sort((a, b) => (use[b] || 0) - (use[a] || 0))
      .forEach(p => { if (!have.has(p) && byPath.has(p)) { have.add(p); rel.push([p, "similar meaning"]); } }));
    if (out.length) [...(nbr.get(out[0].path) || [])].sort((a, b) => (use[b] || 0) - (use[a] || 0) || (a < b ? -1 : a > b ? 1 : 0))
      .forEach(p => { if (rel.length < CUES.related && !have.has(p) && byPath.has(p)) { have.add(p); rel.push([p, "linked to the top result"]); } });
    rel.slice(0, CUES.related).forEach(([p, why]) => { const n = byPath.get(p), ch = n.chunks[0];
      const ls = ch ? ch[3].split("\n").filter(l => l.trim()) : [], count = l => q.filter(t => l.toLowerCase().includes(t)).length;
      const best = ls.reduce((bi, l, i) => count(l) > count(ls[bi]) ? i : bi, 0);
      out.push({ path: p, kind: "related", lang: "", heading: ch ? ch[1] : "", line: ch ? ch[2] : 1, score: 0, why: [why], date: n.date || "",
        snippet: ls.slice(best, best + 2).map(l => l.slice(0, 200)).join("\n") }); });
    return out;
  }

  // the view key of the i-th scene block in a note: the same in the plugin (which opens it) and the view (which draws it)
  const sceneKey = (path, i = 0) => "note-" + stem(path).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + (i ? "-" + i : "");
  // sceneSpec(raw) -> { spec, errors }: a parsed block, checked and with defaults filled in. Unknown words are
  // reported (and skipped), never guessed.
  function sceneSpec(raw) {
    const errors = [], o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (o !== raw) errors.push("The block isn't a list of `key: value` lines.");
    const pick = (key, v, dflt) => { if (v == null || v === "") return dflt; const w = String(v).trim().toLowerCase();
      if (SCENE_PARTS[key].includes(w)) return w; errors.push(`${key}: "${v}" isn't one of ${SCENE_PARTS[key].join(", ")}.`); return dflt; };
    const colour = v => v == null ? null : /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(v).trim()) ? String(v).trim() : (errors.push(`colour: "${v}" isn't a #hex colour.`), null);
    const name = String(o.name || "").trim();
    if (!name) errors.push("name: missing.");
    const entity = [].concat(o.entity || []).map((r, i) => {
      if (!r || typeof r !== "object") { errors.push(`entity ${i + 1}: needs when/as.`); return null; }
      const isElse = r.else != null, when = isElse ? "else" : String(r.when || "").trim().toLowerCase();
      if (!SCENE_WHEN[when]) { errors.push(`entity ${i + 1}: when "${r.when}" isn't one of ${Object.keys(SCENE_WHEN).join(", ")}.`); return null; }
      return { when, as: pick("as", isElse ? r.else : r.as, "walker"), colour: colour(r.colour || r.color), motion: pick("motion", r.motion, "none"), label: r.label ? String(r.label).slice(0, 40) : null };
    }).filter(Boolean);
    if (!entity.length) entity.push({ when: "else", as: "walker", colour: null, motion: "none", label: null });
    const events = [].concat(o.events || []).map((e, i) => {
      const m = String((e && e.do) || "").trim().toLowerCase().match(/^(\w+)(?:\s+nearest\s+(\w+))?$/);
      if (!m || !SCENE_PARTS.verb.includes(m[1])) { errors.push(`event ${i + 1}: do "${e && e.do}" should be "<${SCENE_PARTS.verb.join("|")}> nearest <rule>".`); return null; }
      if (m[2] && !SCENE_WHEN[m[2]]) { errors.push(`event ${i + 1}: "${m[2]}" isn't one of ${Object.keys(SCENE_WHEN).join(", ")}.`); return null; }
      const from = e.from ? String(e.from).trim().toLowerCase() : "current";
      if (!SCENE_WHEN[from]) { errors.push(`event ${i + 1}: from "${e.from}" isn't a rule.`); return null; }
      return { verb: m[1], target: m[2] || (m[1] === "spar" ? null : "stale"), from, every: pick("every", e.every, "activity"), colour: colour(e.colour || e.color) };
    }).filter(Boolean);
    const sky = [].concat(o.sky || []).map(colour).filter(Boolean);
    return { errors, spec: { name: name || "Untitled scene", blurb: String(o.blurb || "").slice(0, 160), group: pick("group", o.group, "topic"),
      place: pick("place", o.place, "grid"), angle: pick("angle", o.angle, "iso"), wall: pick("wall", o.wall, "none"), entity, events,
      sky: sky.length ? sky : null, ground: colour(o.ground) } };
  }

  // sceneYaml(o) -> the text of a ```vault-graph-scene block for a scene object (what sceneSpec reads back). Keys in the
  // guide's order; strings quoted so a colour's # isn't read as a comment.
  function sceneYaml(o) {
    const q = v => JSON.stringify(String(v)), out = [`name: ${q(o.name)}`];
    if (o.blurb) out.push(`blurb: ${q(o.blurb)}`);
    for (const k of ["group", "place", "angle", "wall"]) if (o[k]) out.push(`${k}: ${o[k]}`);
    if (o.sky && o.sky.length) out.push(`sky: [${o.sky.map(q).join(", ")}]`);
    if (o.ground) out.push(`ground: ${q(o.ground)}`);
    if ((o.entity || []).length) { out.push("entity:");
      o.entity.forEach(r => { out.push(r.when === "else" ? `  - else: ${r.as}` : `  - when: ${r.when}\n    as: ${r.as}`);
        if (r.colour) out.push(`    colour: ${q(r.colour)}`); if (r.motion && r.motion !== "none") out.push(`    motion: ${r.motion}`); if (r.label) out.push(`    label: ${q(r.label)}`); }); }
    if ((o.events || []).length) { out.push("events:");
      o.events.forEach(e => { out.push(`  - every: ${e.every}`, `    do: ${e.verb}${e.target ? " nearest " + e.target : ""}`); if (e.from && e.from !== "current") out.push(`    from: ${e.from}`); if (e.colour) out.push(`    colour: ${q(e.colour)}`); }); }
    return out.join("\n");
  }

  // ---- HQ: the vault's own work, read from its notes (the rules file's "hq"): today's journal tasks, the last
  // standup's plan, tasks carried over, projects, the vault backlog, reports to tick, drafts to review,
  // decisions and scheduled jobs. hqKind(path, frontmatter, today) says which notes to read; hqGather(files, o) reads
  // them into data.hq, the same in the plugin (Obsidian's files) and the tests (a folder); todayList makes its items.
  const H = R.hq || {};
  const HQ_RX = k => (H[k] ? new RegExp(H[k]) : null), HQ_JOURNAL = HQ_RX("journal"), HQ_STANDUP = HQ_RX("standup");
  const HQ_PLAN = H.plan_heading ? new RegExp(H.plan_heading, "i") : null;
  const STATUS = H.statuses || {}, statusGroup = s => Object.keys(STATUS).find(k => (STATUS[k] || []).includes(String(s || "").toLowerCase())) || "other";
  // the project kinds by frontmatter type, with their labels (an older rules file names one scope_type)
  const PROJECT_TYPES = H.project_types || (H.scope_type ? { [H.scope_type]: "Scope" } : {});
  // a note's frontmatter tags, without #: a list, or Obsidian's comma or space separated text
  const tagsOf = fm => [].concat((fm && fm.tags) || []).flatMap(t => String(t).split(/[\s,]+/)).map(t => t.replace(/^#/, "")).filter(Boolean);
  // a note's project type: its type field (a type/ tag alone isn't enough: hubs and docs carry type/project too)
  const projectType = fm => { const type = String((fm && fm.type) || "").toLowerCase(); return PROJECT_TYPES[type] ? type : null; };
  // the status tag a project status carries (status_tags: by status, else by its group), or null to leave the tags alone
  const projectStatusTag = s => { const T = H.status_tags || {}, k = String(s || "").toLowerCase(); return T[k] || T[statusGroup(k)] || null; };
  // a project's tags with its status tag set: the other status/ tags go
  const withStatusTag = (fm, s) => { const tag = projectStatusTag(s), tags = tagsOf(fm); return tag ? [...tags.filter(t => !t.startsWith("status/")), tag] : tags; };
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  // a task line as Obsidian counts it: "- [ ] text", numbered too; [prefix, mark, "] ", text]
  const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\] )(.*)$/;
  // the done date as the vault writes it (rules "completion_field"): the Tasks plugin's emoji ("✅" -> "✅ 2026-10-27"),
  // or an inline field ("completion" -> "[completion:: 2026-10-27]"). Either form already on a line counts as stamped.
  const completionStamp = day => (/^\w+$/.test(H.completion_field || "") ? `[${H.completion_field}:: ${day}]` : `${H.completion_field} ${day}`);
  const hasCompletion = text => /✅ \d{4}-\d{2}-\d{2}|\[completion:: ?\d{4}/.test(text) || (/^\w+$/.test(H.completion_field || "") && new RegExp(`\\[${H.completion_field}::`).test(text));
  // a task line with a new mark; done stamps the day (the journal's "Completed Today" reads it), except in a note whose
  // ticks are instructions (stamp false: a report row the gardener applies)
  function taskLine(line, mark, day, stamp = true) {
    const m = String(line).match(TASK_LINE); if (!m) return line;
    const add = stamp && H.completion_field && mark === "x" && !hasCompletion(m[4]) ? " " + completionStamp(day || today()) : "";
    return m[1] + mark + m[3] + (add ? m[4].replace(/\s+$/, "") + add : m[4]);
  }
  // does ticking a task in this note stamp the day? Not in a report: its rows are read back by the gardener
  const stampsDone = path => !reportPrefix(path) && !automationReport(path);
  // today's standup with one more line under its "work completed" heading: numbered after the last top-level item
  // (or a bullet when the section has none), before the section's end (the next heading as big, or a --- line).
  // The text unchanged when the line is already there; null when the note has no such heading.
  function addWorkLine(text, line, heading = H.completed_heading) {
    const rx = heading ? new RegExp(heading, "i") : null; if (!rx) return null;
    const nl = String(text).includes("\r\n") ? "\r\n" : "\n", lines = String(text).split(/\r?\n/);
    const at = lines.findIndex(l => { const h = l.match(/^#{1,6}\s+(.*)/); return h && rx.test(h[1]); });
    if (at < 0) return null;
    const level = lines[at].match(/^#+/)[0].length;
    let end = lines.findIndex((l, i) => i > at && (/^---\s*$/.test(l) || ((l.match(/^(#{1,6})\s/) || [])[1] || "x".repeat(9)).length <= level));
    if (end < 0) end = lines.length;
    const body = lines.slice(at + 1, end), want = plainTask(line).toLowerCase();
    if (body.some(l => plainTask(l.replace(/^\s*(?:\d+[.)]|[-*+])\s+/, "")).toLowerCase() === want)) return text;
    const nums = body.map(l => l.match(/^(\d+)[.)]\s/)).filter(Boolean).map(m => +m[1]);
    let last = end; while (last > at + 1 && !lines[last - 1].trim()) last--;
    const item = `${nums.length ? Math.max(...nums) + 1 + "." : body.some(l => /^[-*+]\s/.test(l)) ? "-" : "1."} ${plainTask(line)}`;
    lines.splice(last, 0, ...(last === at + 1 ? ["", item] : [item]));
    return lines.join(nl);
  }
  // a report's rows to tick: every task line (any depth), its section, and the line it sits under (a MOC row's note)
  function reportRows(text) {
    const out = []; let section = "", context = "";
    String(text).split(/\r?\n/).forEach((l, i) => {
      const h = l.match(/^#{1,6}\s+(.*)/); if (h) { section = h[1].trim(); context = ""; return; }
      const m = l.match(TASK_LINE);
      if (m) out.push({ line: i, text: m[4], mark: m[2], section, context: /^\s/.test(l) ? context : "" });
      else if (/^[-*+]\s/.test(l)) context = l.replace(/^[-*+]\s+/, "");
    });
    return out;
  }
  // a report row as words: links as their names, paths as file names, the gardener's %%act%% notes gone
  const plainRow = t => plainTask(String(t).replace(/%%[\s\S]*?%%/g, "").replace(/`([^`]*\/)?([^`/]+?)(\.md)?`/g, "$2"));
  const plainRowFull = t => plainTask(stripAnsi(String(t).replace(/%%[\s\S]*?%%/g, "")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ? `${target} (${alias})` : target)
    .replace(/`([^`]+\/[^`]+)`/g, "$1").replace(/`/g, "")));
  // an inline field added to a task line ([delegate:: claude]); a field it already has keeps its value
  const taskField = (line, key, value) => new RegExp(`\\[${key}::`).test(line) ? line : `${String(line).replace(/\s+$/, "")} [${key}:: ${value}]`;
  // a task's words without its inline fields, links as their text, bold and code marks gone
  const stripAnsi = t => String(t).replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "");
  const plainTask = t => stripAnsi(t).replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  const inlineField = (t, key) => { const m = String(t).match(new RegExp(`\\[${key}::\\s*([^\\]]*)\\]`)); return m ? m[1].trim() : ""; };
  // frontmatter as plain values: scalars and lists, enough for type, status, dates and tags
  function frontOf(text) {
    const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) return {};
    const fm = {}; let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w][\w -]*):\s*(.*)$/), item = line.match(/^\s+-\s+(.*)$/), clean = v => v.trim().replace(/^["']|["']$/g, "");
      if (kv) { key = kv[1]; fm[key] = kv[2].trim() ? clean(kv[2]) : []; }
      else if (item && key && Array.isArray(fm[key])) fm[key].push(clean(item[1]));
    }
    return fm;
  }
  const dateIn = (rx, path) => { const m = rx && String(path).match(rx); return m ? m[1] : null; };
  const hqJournalDate = path => dateIn(HQ_JOURNAL, path);
  const dailyNotePath = (date, kind = "journal") => {
    if (!["journal", "standup"].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid daily note date or kind");
    const d = new Date(`${date}T12:00:00`);
    if (isNaN(d) || localDay(d) !== date) throw new Error("Invalid daily note date");
    const [year, month] = date.split("-");
    const folder = `${R.folders.daily}/${year}/${month}-${d.toLocaleString("en-US", { month: "long" })}`;
    return `${folder}/${kind === "standup" ? `Standups/Daily Standup ${date}` : `Journal/${date}`}.md`;
  };
  const journalRank = (path, date) => {
    const [year, month] = String(date || "").split("-"), p = String(path).toLowerCase();
    const monthName = month && new Date(`${date}T12:00:00`).toLocaleString("en-US", { month: "long" }).toLowerCase();
    const monthShort = monthName && monthName.slice(0, 3);
    const parts = p.split("/");
    const yearAt = year ? parts.indexOf(year) : -1, monthPart = yearAt < 0 ? "" : parts[yearAt + 1];
    const hasYear = yearAt >= 0;
    const hasMonth = !!monthPart && (monthPart === month || monthPart === `${month}-${monthName}` || monthPart === monthName || monthPart === monthShort);
    return hasYear && hasMonth ? 3 : hasYear ? 2 : 1;
  };
  const canonicalDailyPath = (paths, date, kind = "journal") => (paths || []).map(x => typeof x === "string" ? x : x.path)
    .filter(p => p.startsWith(R.folders.daily + "/") && dateIn(kind === "standup" ? HQ_STANDUP : HQ_JOURNAL, p) === date)
    .sort((a, b) => journalRank(b, date) - journalRank(a, date) || a.localeCompare(b))[0] || null;
  const canonicalJournalPath = (paths, date) => canonicalDailyPath(paths, date);
  const canonicalJournal = (hq, date) => {
    const journals = (hq && hq.journals) || [], path = canonicalJournalPath(journals, date);
    return journals.find(j => j.path === path) || null;
  };
  const inDaily = path => String(path).startsWith(R.folders.daily + "/");
  const reportPrefix = path => String(path).startsWith(R.folders.reports + "/") ? (H.reports || []).find(p => stemCase(path).startsWith(p + " ")) : null;
  const automationReport = path => String(path).startsWith(R.folders.reports + "/") ? (H.automations || []).find(a => a.report && stemCase(path).startsWith(a.report)) : null;
  // which kind of HQ note a path is, or null
  function hqKind(path, fm, day) {
    path = String(path); fm = fm || {}; day = day || today();
    if (!H.journal || path.startsWith(R.folders.archive + "/") || path.startsWith(R.folders.templates + "/")) return null;
    const ok = (d, n) => !!d && daysBetween(d, day) >= 0 && daysBetween(d, day) <= n;
    if (inDaily(path)) {
      if (ok(dateIn(HQ_JOURNAL, path), H.carry_days)) return "journal";
      if (ok(dateIn(HQ_STANDUP, path), H.carry_days)) return "standup";
    }
    const type = String(fm.type || "").toLowerCase();
    if (path === H.backlog) return "backlog";
    // a project note outside the vault's tooling folder (agent memory there uses type: project too)
    if (projectType(fm) && !path.startsWith(R.folders.system + "/")) return "project";
    if (type && type === H.review_type && (path.startsWith(H.review_folder + "/") || path.startsWith(R.folders.reports + "/"))) return "review";
    if (reportPrefix(path) || automationReport(path)) return "report";
    if (type && type === H.decision_type) return "decision";
    if (H.run_log && path.startsWith(H.run_log + " ")) return "runlog";
    if (path.startsWith(R.folders.inbox + "/") && !(H.review_folder && path.startsWith(H.review_folder + "/"))) return "inbox";
    return null;
  }
  // [{ line, text, mark, section }] for each top-level task in a note (subtasks travel with their parent); nested:
  // subtasks too, with sub: true. Tasks in code blocks aren't tasks.
  function tasksIn(text, o = {}) {
    const out = [], stack = []; let section = "", code = false;
    String(text).split(/\r?\n/).forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { code = !code; return; } if (code) return;
      const h = l.match(/^#{1,6}\s+(.*)/); if (h) { section = h[1].trim(); stack.length = 0; return; }
      const m = l.match(TASK_LINE), indent = (l.match(/^\s*/) || [""])[0].length, sub = indent > 0;
      if (!m) return;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1], task = { line: i, text: m[4], mark: m[2], section,
        ...(o.nested ? { sub, ...(parent ? { parent: { line: parent.line, title: plainTask(parent.text) } } : {}) } : {}) };
      if (o.nested || !sub) out.push(task);
      stack.push({ indent, line: i, text: m[4] });
    });
    return out;
  }
  // every open task in a note, subtasks too: what closing the whole note ticks
  const openTaskLines = text => tasksIn(text, { nested: true }).filter(t => t.mark === " ");
  // the mark a project's open tasks get when it's set to this status: x when it closes it, - when it closes it as
  // cancelled (its status tag is status/cancelled), null when it doesn't close it
  const closeMark = s => statusGroup(s) !== "closed" ? null : projectStatusTag(s) === "status/cancelled" ? "-" : "x";
  // the top-level items under the first heading matching rx (numbered or bulleted), until the next heading as big
  function itemsUnder(text, rx) {
    const lines = String(text).split(/\r?\n/), out = []; let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^(#{1,6})\s+(.*)/);
      if (h) { if (level && h[1].length <= level) break; if (!level && rx.test(h[2])) level = h[1].length; continue; }
      const m = level && lines[i].match(/^(?:\d+[.)]|[-*+])\s+(?!\[.\] )(.*\S)/);
      if (m) out.push({ line: i, text: m[1] });
    }
    return out;
  }
  const bodyOf = text => String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // a project's one-paragraph summary: its **Summary:** (or **Summary**:) line, else the first paragraph under a
  // "What", "Story" or "Summary" heading
  function scopeSummary(text) {
    const b = bodyOf(text), s = b.match(/^\*\*Summary(?::\*\*|\*\*:)\s*(.+)$/m);
    if (s) return plainTask(s[1]);
    const lines = b.split(/\r?\n/), at = lines.findIndex(l => /^#{1,6}\s+(What|Story|Summary)\b/i.test(l));
    if (at < 0) return "";
    const para = []; for (const l of lines.slice(at + 1)) { if (/^#/.test(l) || (para.length && !l.trim())) break; if (l.trim() && !/^[-|>]/.test(l.trim())) para.push(l.trim()); }
    return plainTask(para.join(" "));
  }
  // its estimate as written ("3–5 days"): on a line that names an estimate (not a table row), or just under an
  // "estimate" heading
  function scopeEstimate(text) {
    const lines = bodyOf(text).split(/\r?\n/), dur = l => l.match(/(\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:engineering\s+|working\s+)?(days?|weeks?)\b/i);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], near = /^#{1,6}\s.*estimat/i.test(l) ? lines.slice(i + 1, i + 4) : !/^\s*\|/.test(l) && /estimat|allowance/i.test(l) ? [l] : [];
      for (const x of near) { const m = dur(x); if (m) return `${m[1].replace(/\s*[–-]\s*/, "–")} ${m[2].toLowerCase()}`; }
    }
    return "";
  }
  const titleOf = (text, path) => { const m = bodyOf(text).match(/^#\s+(.+)$/m); return plainTask(m ? m[1] : stemCase(path)); };
  // hqGather(files, { today }) -> data.hq. files: [{ path, text, fm? }] (fm: Obsidian's frontmatter; read from the
  // text when missing), plus each device's run records as { path, json } from the automation_status folder.
  function hqGather(files, o = {}) {
    const day = o.today || today(), hq = { date: day, journals: [], standups: [], projects: [], backlog: [], reports: [], reviews: [], decisions: [], runs: {}, runlog: [], inbox: [] };
    const newestReport = {};
    for (const f of files || []) {
      if (f.json) { Object.entries(f.json || {}).forEach(([name, run]) => { if (run && (!hq.runs[name] || String(run.last_run) > String(hq.runs[name].last_run))) hq.runs[name] = run; }); continue; }
      const fm = f.fm || frontOf(f.text), kind = hqKind(f.path, fm, day), name = stemCase(f.path);
      if (kind === "journal") hq.journals.push({ path: f.path, date: dateIn(HQ_JOURNAL, f.path), tasks: tasksIn(f.text) });
      else if (kind === "standup") hq.standups.push({ path: f.path, date: dateIn(HQ_STANDUP, f.path), plan: HQ_PLAN ? itemsUnder(f.text, HQ_PLAN) : [],
        deviation: Number(fm.deviation_hours) || 0, projects: [].concat(fm["related-projects"] || []).map(plainTask).filter(Boolean) });
      else if (kind === "project") {
        const tasks = openTaskLines(f.text).map(t => ({ ...t, title: plainTask(t.text),
          related: [...String(t.text).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)].map(m => m[1]) }));
        const tags = tagsOf(fm), systems = [...new Set([...tags.filter(t => /^(?:system|project)\//i.test(t)), ...[].concat(fm.system || [], fm.project || []).map(plainTask).filter(Boolean)])];
        const references = value => [].concat(value || []).map(v => String(v).replace(/^\[\[|\]\]$/g, "").split("|")[0]).filter(Boolean);
        hq.projects.push({ path: f.path, name, kind: PROJECT_TYPES[projectType(fm)], title: titleOf(f.text, f.path).replace(/^(Scope of Work|User Story)\s*[—–:-]\s*/i, ""),
        status: String(fm.status || "").toLowerCase(), group: statusGroup(fm.status), summary: scopeSummary(f.text), estimate: scopeEstimate(f.text), created: String(fm.created || ""),
        tags, systems, tasks, chunks: recallChunks(f.text), parents: references(fm.parent || fm["Parent task"]), related: references(fm.related),
        updated: String(fm.updated || fm.modified || fm.created || "") });
      }
      else if (kind === "inbox") hq.inbox.push({ path: f.path, name, title: titleOf(f.text, f.path) });
      else if (kind === "backlog") tasksIn(f.text).filter(t => t.mark === " ").forEach(t => hq.backlog.push({ path: f.path, ...t }));
      else if (kind === "report") { const prefix = reportPrefix(f.path) || automationReport(f.path).report, date = (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
        const rows = reportRows(f.text).filter(r => r.mark === " ");
        if (!newestReport[prefix] || f.path.localeCompare(newestReport[prefix].path) > 0)
          newestReport[prefix] = { path: f.path, name, prefix, date, open: rows.length, rows: reportPrefix(f.path) ? rows : [], job: !reportPrefix(f.path) }; }
      else if (kind === "review") hq.reviews.push({ path: f.path, name, title: titleOf(f.text, f.path), status: String(fm.status || "").toLowerCase(), task: plainTask(fm.task || ""), created: String(fm.created || ""),
        reviewOnly: f.path.startsWith(R.folders.reports + "/") });
      else if (kind === "decision") hq.decisions.push({ path: f.path, name, title: titleOf(f.text, f.path), date: String(fm.date || fm.created || ""), status: String(fm.status || "").toLowerCase(),
        by: plainTask([].concat(fm.decided_by || []).join(", ")), project: plainTask([].concat(fm.project || []).join(", ")) });
      else if (kind === "runlog") String(f.text).split(/\r?\n/).filter(l => /^- \d{4}-\d{2}-\d{2}/.test(l)).forEach(l => hq.runlog.push(plainTask(l.slice(2))));
      // how often each project came up: the dailies in the window that name it (its file name, code name or title)
      if (kind === "journal" || kind === "standup") (hq.mentionText = hq.mentionText || []).push([dateIn(kind === "journal" ? HQ_JOURNAL : HQ_STANDUP, f.path), String(f.text).toLowerCase()]);
    }
    hq.reports = Object.values(newestReport);
    hq.journalDuplicates = [...new Set(hq.journals.map(j => j.date).filter(Boolean))].map(date => {
      const paths = hq.journals.filter(j => j.date === date).map(j => j.path);
      return paths.length > 1 ? { date, canonical: canonicalJournalPath(paths, date), paths: paths.sort() } : null;
    }).filter(Boolean);
    const code = s => s.name.replace(/^.*[—–-]\s*/, "").toLowerCase();
    hq.projects.forEach(s => { s.days = [...new Set((hq.mentionText || []).filter(([, t]) => t.includes(s.name.toLowerCase()) || t.includes(code(s)) || (s.title.length > 8 && t.includes(s.title.toLowerCase()))).map(([d]) => d))].sort(); });
    delete hq.mentionText;
    hq.journals.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.path.localeCompare(b.path))); hq.standups.sort((a, b) => (a.date < b.date ? 1 : -1));
    hq.projects.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.name < b.name ? -1 : 1));
    hq.decisions.sort((a, b) => (a.date < b.date ? 1 : -1)); hq.runlog = hq.runlog.slice(-20);
    return hq;
  }
  // Each scheduled job with its last run: ok, failed, late (no run in twice its interval; a work-hours job only counts
  // as late during working hours) or never run. now: a Date
  function hqJobs(hq, now) {
    now = now || new Date();
    const reports = new Map(((hq && hq.reports) || []).filter(r => r.job).map(r => [r.prefix, r]));
    return (H.automations || []).map(a => {
      const rep = a.report && reports.get(a.report), run = (hq && hq.runs || {})[a.name];
      const last = rep ? rep.date + "T12:00:00" : run ? run.last_run : null;
      const ok = rep ? true : run && typeof run.ok === "boolean" ? run.ok : null;
      const hours = last ? (now - new Date(last)) / 36e5 : Infinity, h = now.getHours(), wd = now.getDay();
      const late = !!last && Number.isFinite(hours) && hours > (a.every_hours || 24) * 2 && (!a.work_hours_only || (h >= 8 && h <= 18 && wd !== 0 && wd !== 6));
      const collectedReport = a.review_report
        ? ((hq && hq.reviews) || []).filter(r => r.reviewOnly && r.name.startsWith(a.review_report + " ")).sort((a, b) => b.path.localeCompare(a.path))[0] : null;
      return { ...a, last, ok, late, summary: stripAnsi(rep ? rep.name : run ? String(run.summary || "") : ""), device: run ? run.device || "" : "", report: rep ? rep.path : collectedReport ? collectedReport.path : null,
        state: !last ? "never" : ok === false ? "failed" : late ? "late" : ok === true ? "ok" : "unknown" };
    });
  }
  // The projects (scopes of work, project notes, user stories): kind, status group, summary, estimate, the days the
  // dailies named it, active decisions
  function hqProjects(data) {
    const hq = (data && data.hq) || {}, decisions = (hq.decisions || []).filter(d => d.status === "active");
    return (hq.projects || []).map(s => ({ ...s, decisions: decisions.filter(d => d.project && (d.project.includes(s.name) || d.project.toLowerCase().includes(s.title.toLowerCase()))) }));
  }
  function hqProjectSearch(data, projects, query, o = {}) {
    const q = String(query).trim(); if (!q) return projects;
    const graph = {
      links: (data.links || []).filter(l => l.kind === "link" || l.kind === "similar").map(l => [l.source, l.target, l.kind]),
      use: Object.fromEntries((data.nodes || []).map(n => [n.id, (n.inlinks || 0) + (n.opens90 || 0)])),
    };
    const notes = projects.map(p => ({ path: p.path, date: p.created || "", chunks: p.chunks || [["section", p.title, 1, p.summary || p.title, ""]] }));
    const hits = q.length >= 3 ? recallSearch(notes, q, { n: Math.max(1, projects.length * (RC.per_note || 2)), graph, today: o.today }) : [];
    const byPath = new Map();
    hits.filter(h => h.kind !== "related").forEach(h => { if (!byPath.has(h.path)) byPath.set(h.path, h); });
    return projects.map(p => ({ p, hit: byPath.get(p.path), score: Math.max(fuzzyScore(q, p.title), fuzzyScore(q, p.name || ""),
      fuzzyScore(q, p.path) - 2) })).filter(r => r.score >= 0 || r.hit)
      .sort((a, b) => Number(b.score >= 0) - Number(a.score >= 0) || b.score - a.score || (b.hit?.score || 0) - (a.hit?.score || 0) || a.p.path.localeCompare(b.p.path))
      .map(r => ({ ...r.p, searchHit: r.hit }));
  }
  // Which part of HQ shows an item: today (work), needs (only you can decide it) or upkeep (the vault itself)
  const TODAY_GROUP = { task: "today", plan: "today", carried: "today", approval: "needs", review: "needs", job: "needs", backlog: "needs", report: "needs", inbox: "needs" };
  const todayGroup = kind => TODAY_GROUP[kind] || "upkeep";
  // the HQ items of todayList (see below), from data.hq
  function hqItems(data, o, add) {
    const hq = data.hq; if (!hq) return;
    const day = o.today || hq.date || today(), marks = (o.review || {}).hq || {};
    const skip = k => marks[k] === `later:${day}` || String(marks[k] || "").startsWith("done:");   // Later: for the day; Done: a plan item (no checkbox)
    const put = it => { if (!skip(it.key)) add(it); };
    const label = t => plainTask(t) || "(untitled task)";
    const fieldsOf = t => ({ delegated: inlineField(t, H.delegate_field || "delegate"), review: inlineField(t, "review") });
    const todayJournal = canonicalJournal(hq, day);
    (todayJournal ? [todayJournal] : []).forEach(j => j.tasks.filter(t => t.mark === " ").forEach((t, i) =>
      put({ key: `task|${j.path}|${t.text}`, kind: "task", path: j.path, line: t.line, text: t.text, ...fieldsOf(t.text), ids: [j.path], title: label(t.text), why: t.section || "Today's journal", score: 20 - i * 0.01 })));
    const plan = hq.standups.find(s => s.date < day);
    if (plan) plan.plan.forEach((p, i) => put({ key: `plan|${plan.path}|${i}|${p.text}`, kind: "plan", path: plan.path, line: p.line, text: p.text, ids: [plan.path], title: label(p.text), why: `Planned in ${stemCase(plan.path)}`, score: 15 - i * 0.01 }));
    hq.projects.filter(s => s.group === "waiting").forEach(s => { const waited = s.updated ? daysBetween(s.updated, day) : 0;
      put({ key: `approval|${s.path}`, kind: "approval", path: s.path, ids: [s.path], title: s.title, why: `${s.status}${waited > 0 ? ` for ${waited} day${waited === 1 ? "" : "s"}` : ""}`, waited, score: waited > (H.approval_overdue_days || 3) ? 21 : 12 }); });
    hq.reviews.filter(r => r.status === "waiting" || r.reviewOnly && ["pending", "proposed"].includes(r.status)).forEach(r => put({ key: `review|${r.path}`, kind: "review", path: r.path, ids: [r.path], title: r.reviewOnly ? reportTitle(r.name) : r.title,
      why: r.reviewOnly ? "Review only · no rows applied" : r.task ? `Draft for: ${r.task}` : "Draft waiting", reviewOnly: !!r.reviewOnly, score: 11.5 }));
    hqJobs(hq, o.now).filter(j => j.state === "failed" || j.state === "late").forEach(j => put({ key: `job|${j.name}|${j.last}`, kind: "job", path: H.automations_note, name: j.name, ids: [],
      title: `${j.name}: ${j.state === "failed" ? "failed" : "late"}`, why: j.summary || j.when, score: j.state === "failed" ? 13 : 10 }));
    [...new Set(hq.journals.map(j => j.date).filter(d => d < day))].map(d => canonicalJournal(hq, d)).filter(Boolean).forEach(j => { const age = daysBetween(j.date, day);
      j.tasks.filter(t => t.mark === " ").forEach(t => put({ key: `carried|${j.path}|${t.text}`, kind: "carried", path: j.path, line: t.line, text: t.text, date: j.date, age, ...fieldsOf(t.text), ids: [j.path],
        title: label(t.text), why: `From ${j.date} · ${age} day${age === 1 ? "" : "s"} ago`, score: Math.max(1, 9 - age * 0.25) })); });
    (hq.inbox || []).forEach(n => put({ key: `inbox|${n.path}`, kind: "inbox", path: n.path, ids: [n.path], title: n.title || n.name, why: "In the inbox", score: 3 }));
    hq.backlog.forEach(b => put({ key: `backlog|${b.path}|${b.text}`, kind: "backlog", path: b.path, line: b.line, text: b.text, ids: [b.path], title: label(b.text), why: stemCase(b.path), score: 3 }));
    hq.reports.filter(r => r.open > 0 && !r.job).forEach(r => put({ key: `report|${r.path}`, kind: "report", path: r.path, ids: [r.path], title: `${r.name}: ${r.open} row${r.open === 1 ? "" : "s"} to tick`, why: "Tick the rows to apply", score: 2.8 }));
  }

  // ---- Today: the one list of next steps. It replaced three overlapping lists (the review queue, the daily quests
  // and the missions). Each item is one action (VGActions.TODAY does it); the graph view, its game panel and the
  // sidebar all show this list, and questDone says when an item has been done, wherever it was done.
  //   todayList(data, { review, hidden, today, skipDays, groups, now }) -> [{ key, kind, title, why, ids, score, xp, ...fields }]
  // groups: only these (todayGroup: "today", "needs", "upkeep"); each surface filters the one list. HQ kinds (from
  // data.hq): task (today's journal), plan (the last standup's next-day plan), carried (open tasks from earlier
  // journals), approval (a scope waiting on approval), review (a draft to accept or reject), job (a scheduled job that
  // failed or is late), backlog (an open vault decision), report (rows to tick). "Later" hides one for the day and Done marks a plan item (review.hq: key -> "later:<day>" | "done:<day>").
  // data: the graph data (graph_data() or the plugin's liveMerge of it; the view passes its live copy).
  // kinds: link (a suggested pair; from = the staler note, which gets the Related line), map (a note its topic's map
  // doesn't list), write (a note 3+ notes link to that doesn't exist), hub (a relied-on note gone quiet, or one you
  // pinned), chart (a topic of 6+ notes with no map), adopt (a note nothing links to a topic).
  const TODAY_XP = { link: 10, map: 6, write: 12, hub: 4, chart: 25, adopt: 8, rename: 4, task: 5, plan: 5, carried: 5, approval: 3, review: 6, job: 3, backlog: 6, report: 4 };
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  // A new task under the journal's task heading, after the tasks already there (or at the end of a note without the heading)
  function addTaskLine(text, task) {
    const heading = (R.hq && R.hq.journal_tasks_heading) || "Today's Tasks", nl = text.includes("\r\n") ? "\r\n" : "\n", lines = text.split(/\r?\n/), line = `- [ ] ${task.trim()}`;
    const at = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase().includes(heading.toLowerCase()));
    if (at < 0) return text.replace(/\s*$/, "") + nl + nl + line + nl;
    let i = at + 1; for (let j = at + 1; j < lines.length; j++) { if (/^#{1,6}\s/.test(lines[j]) || /^```/.test(lines[j])) break; if (/^\s*[-*] \[.\]/.test(lines[j])) i = j + 1; }
    lines.splice(i, 0, line); return lines.join(nl);
  }
  // Who each open item is about, for HQ's People screen: a link to the person always counts; their name in plain words
  // counts unless it's also an ordinary word (hq.people_ambiguous: "Show", "Will").
  // The day's loop. Focus: up to three items you picked for today (review.focus, for that day only). Done today: journal tasks
  // stamped today, and plan items marked done today.
  // A note's text as it reads, for a preview: no markup, no table bars, no fold markers
  const plainSnippet = s => String(s || "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^[\s>#*-]+|[▼▶]/gm, "").replace(/\*\*|__|`|\|/g, " ").replace(/\s+/g, " ").trim();
  const FOCUS_MAX = 3;   // three is a decision; ten is a list
  const focusKeys = (review, day) => { const f = (review || {}).focus; return f && f.day === day ? (f.keys || []) : []; };
  function hqFocusItems(list, review, day) { const by = new Map(list.map(it => [it.key, it])); return focusKeys(review, day).map(k => by.get(k)).filter(Boolean); }
  function doneToday(data, review, day) {
    const hq = data.hq || {}, out = [], seen = new Set(), add = (text, path) => { const t = plainTask(text).replace(/\s*✅.*$/, "").trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push({ text: t, path }); } };
    (hq.journals || []).forEach(j => (j.tasks || []).forEach(t => { if (t.mark && t.mark.toLowerCase() === "x" && String(t.text).includes(`✅ ${day}`)) add(t.text, j.path); }));
    Object.entries((review || {}).hq || {}).forEach(([k, v]) => { if (v === `done:${day}` && k.startsWith("plan|")) add(k.split("|").slice(3).join("|"), k.split("|")[1]); });
    return out;
  }
  // The calendar: a month of work, one row per day, from the same doneToday every other surface uses. lead: blank cells
  // before the 1st, with the week starting on Monday like the week strip.
  function hqCalendar(data, review, month) {
    const [y, m] = String(month).split("-").map(Number), hq = data.hq || {}, journals = new Set((hq.journals || []).map(j => j.date)), standups = new Set((hq.standups || []).map(s => s.date));
    const days = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, "0")}`; return { date, n: i + 1, done: doneToday(data, review, date).length, journal: journals.has(date), standup: standups.has(date) }; });
    const peak = Math.max(0, ...days.map(d => d.done)), busiest = peak ? days.find(d => d.done === peak) : null;
    return { month, days, lead: (new Date(y, m - 1, 1).getDay() + 6) % 7, peak, busiest, total: days.reduce((a, d) => a + d.done, 0), worked: days.filter(d => d.done).length };
  }
  const monthShift = (month, by) => { const [y, m] = String(month).split("-").map(Number), d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  // Focus sessions: minutes per day, in the shared file. A day's time from two devices keeps the larger, like the other bests.
  const sessionMinutes = (review, day) => ((review || {}).sessions || {})[day] || 0;
  const sessionAdded = (review, day, minutes, keep = 60) => { const all = { ...((review || {}).sessions || {}), [day]: sessionMinutes(review, day) + minutes }; return Object.fromEntries(Object.entries(all).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, keep)); };
  const minutesWords = n => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`);
  // The project board: its columns are the status groups, in the order work moves. A column that holds a status choice takes
  // drops; moving there sets its first choice.
  const BOARD_GROUPS = ["planned", "active", "waiting", "closed"];
  const statusForGroup = group => (H.status_choices || []).find(s => statusGroup(s) === group) || null;
  // Threads: open work grouped by the project it belongs to. An item links its project, or its words pick one out: at least two
  // words of the project's title and half of them, or the one word of a short title that no other project has. Words many
  // projects or many open items share say nothing. A wrong group is worse than none, so what fits nowhere comes last, with no
  // project. Work with no project of its own goes by the area it names (hq.thread_areas: the longest phrase wins, so "Odoo
  // console" isn't the Dispatch Console). Biggest thread first; closed projects aren't where open work goes.
  function hqThreads(items, projects, areas = H.thread_areas || {}) {
    const phrases = Object.entries(areas).flatMap(([area, list]) => list.map(p => ({ area, len: p.length, re: new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i") })));
    const areaOf = text => { let best = null; for (const p of phrases) if ((!best || p.len > best.len) && p.re.test(text)) best = p; return best && best.area; };
    projects = projects.filter(p => p.group !== "closed");
    const words = s => new Set(recallWords(String(s)).filter(w => w.length > 3 && !/^\d+$/.test(w))), by = projects.map(p => ({ p, w: words(p.title), names: [p.title, p.name].filter(Boolean).map(n => `[[${n}`) }));
    const df = new Map(), said = new Map(); by.forEach(x => x.w.forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const itemWords = items.map(it => { const text = `${it.text || ""} ${it.title || ""}`, tw = words(text); tw.forEach(w => said.set(w, (said.get(w) || 0) + 1)); return { it, text, tw }; });
    const common = Math.max(2, projects.length * 0.08), chatter = Math.max(3, items.length * 0.03), telling = w => df.get(w) <= common && (said.get(w) || 0) <= chatter, groups = new Map(), rest = [];
    for (const { it, text, tw } of itemWords) { let best = null, bestScore = 0;
      for (const x of by) { let score = x.names.some(n => text.includes(n)) ? 100 : 0;
        if (!score) { let shared = 0, unique = false; x.w.forEach(w => { if (tw.has(w) && telling(w)) { shared++; if (df.get(w) === 1 && w.length > 4) unique = true; } }); if ((shared >= 2 && shared * 2 >= x.w.size) || (unique && x.w.size <= 2)) score = shared; }
        if (score > bestScore) { best = x; bestScore = score; } }
      if (best) { if (!groups.has(best.p.path)) groups.set(best.p.path, { project: best.p, title: best.p.title, items: [] }); groups.get(best.p.path).items.push(it); continue; }
      const area = areaOf(text); if (!area) { rest.push(it); continue; }
      if (!groups.has(area)) groups.set(area, { project: null, area, title: area, items: [] }); groups.get(area).items.push(it); }
    const out = [...groups.values()].sort((a, b) => b.items.length - a.items.length || (a.title < b.title ? -1 : 1));
    if (rest.length) out.push({ project: null, title: "Everything else", items: rest });
    return out;
  }
  // The morning brief: short sentences of plain fact, what you'd want to know before starting
  function hqBrief(data, list, review, day, threads) {
    const out = [], yesterday = localDay(new Date(new Date(`${day}T12:00:00`).getTime() - 864e5)), done = doneToday(data, review, yesterday).length, today = doneToday(data, review, day).length;
    if (today) out.push(`${today} done so far today.`); else if (done) out.push(`${done} done yesterday.`);
    const focus = hqFocusItems(list, review, day), plan = list.filter(i => i.kind === "plan" || i.kind === "task").length;
    if (focus.length) out.push(`Focus: ${focus.map(i => i.title).join("; ")}.`); else if (plan) out.push(`${plan} planned for today, none picked yet.`);
    const top = (threads || []).find(t => t.project || t.area); if (top && top.items.length > 1) out.push(`Most open work is in ${top.title} (${top.items.length}).`);
    const approvals = list.filter(i => i.kind === "approval"), reviews = list.filter(i => i.kind === "review"); if (approvals.length || reviews.length) out.push(`${[approvals.length ? `${approvals.length} approval${approvals.length === 1 ? "" : "s"}` : "", reviews.length ? `${reviews.length} draft${reviews.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} waiting on you.`);
    const failed = list.filter(i => i.kind === "job"); if (failed.length) out.push(`${failed.length} automation${failed.length === 1 ? " needs" : "s need"} attention.`);
    const who = hqPeople(data, list).filter(p => p.items.length)[0]; if (who && who.items.length > 1) out.push(`${who.name} is in ${who.items.length} open items.`);
    return out;
  }
  const PEOPLE_KINDS = new Set(["task", "plan", "carried", "approval", "review"]);   // your work; a suggestion or a backlog line that names someone isn't
  function hqPeople(data, list) {
    const ambiguous = new Set(((R.hq && R.hq.people_ambiguous) || []).map(s => s.toLowerCase()));
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (data.nodes || []).filter(n => n.person).map(n => { const plain = !ambiguous.has(n.name.toLowerCase()) && n.name.length > 2 ? new RegExp(`\\b${esc(n.name)}\\b`) : null, link = `[[${n.name}`;
      const items = list.filter(it => { if (!PEOPLE_KINDS.has(it.kind)) return false; const t = `${it.text || ""} ${it.title || ""}`; return t.includes(link) || (plain && plain.test(t)); });
      const decisions = ((data.hq && data.hq.decisions) || []).filter(d => (d.by || "").includes(n.name)).slice(0, 3);
      return { id: n.id, name: n.name, items, decisions, mentions: n.mentions || 0, recent: n.recent || 0 }; })
      .sort((a, b) => b.items.length - a.items.length || b.recent - a.recent || a.name.localeCompare(b.name));
  }
  // More / Less like this: each reaction moves that kind of item up or down the list, by a small and capped amount, so one
  // kind can't bury everything. Upkeep suggestions can also be hidden outright; your own work can't.
  const REACTION_CAP = 3;
  // When a note came into being, the plugin's side of analysis/vault_graph.py's born_date: the earliest of its frontmatter
  // date, a date or month in its name, and its file's creation date
  const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function nameDate(name) {
    let m = /(20\d\d-\d\d-\d\d)/.exec(name); if (m) return m[1];
    m = /(?<![\d-])(20\d\d)-(0[1-9]|1[0-2])(?![\d-])/.exec(name); if (m) return `${m[1]}-${m[2]}-01`;
    m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? +(20\d\d)\b/i.exec(name);
    return m ? `${m[2]}-${String(MONTH_NUM[m[1].toLowerCase()]).padStart(2, "0")}-01` : null;
  }
  const bornDate = (name, created, fileDay) => [created && /^\d{4}-\d{2}-\d{2}/.test(String(created)) ? String(created).slice(0, 10) : null, nameDate(name), fileDay].filter(d => d && d >= "2015-01-01").sort()[0] || fileDay;
  const reactionNudge = (review, kind) => { const r = ((review && review.reactions) || {})[kind]; if (!r) return 0;
    return Math.max(-REACTION_CAP, Math.min(REACTION_CAP, (r.more || 0) - (r.less || 0))) * ((R.hq && R.hq.reaction_weight) || 0); };
  const canHideKind = kind => todayGroup(kind) === "upkeep";
  const KIND_WORDS = { link: "link suggestions", map: "add-to-map suggestions", write: "notes to write", hub: "note reviews", chart: "maps to make", adopt: "unlinked notes", rename: "map renames", task: "today's tasks", plan: "standup plan items", carried: "carried-over tasks", approval: "approvals", review: "drafts to review", inbox: "inbox notes", job: "automation alerts", backlog: "backlog items", report: "reports" };
  const kindWords = kind => KIND_WORDS[kind] || `${kind} items`;
  function todayList(data, o = {}) {
    const nodes = data.nodes || [], byId = new Map(nodes.map(n => [n.id, n])), mocs = (data.mocs || []).filter(m => !m.nav);
    const mapIds = new Set((data.mocs || []).map(m => m.id)), plain = n => !!n && !n.person && !n.ghost && !mapIds.has(n.id);
    const name = id => (byId.get(id) || {}).name || stemCase(id);
    const ranked = nodes.filter(n => plain(n) && !n.isolated).sort((a, b) => (b.bc || 0) - (a.bc || 0)).map(n => n.id);
    const rank = new Map(ranked.map((id, i) => [id, i + 1]));
    const review = o.review || {}, day = o.today || localDay(new Date()), skipDays = o.skipDays || 14;
    const skipped = k => !!(review.skipped && review.skipped[k]) && (Date.parse(day) - Date.parse(review.skipped[k])) / 864e5 < skipDays;
    const hidden = new Set(o.hidden || []), out = [], seen = new Set(), groups = o.groups ? new Set(o.groups) : null;
    const hiddenKinds = new Set(review.hiddenKinds || []);
    const add = it => { if (seen.has(it.key) || hidden.has(it.key) || skipped(it.key) || (hiddenKinds.has(it.kind) && canHideKind(it.kind)) || (groups && !groups.has(todayGroup(it.kind)))) return; seen.add(it.key); out.push({ xp: TODAY_XP[it.kind] || 5, group: todayGroup(it.kind), ...it }); };
    hqItems(data, { ...o, today: day }, add);
    (data.links || []).forEach(l => {
      if (!isSuggestion(l) || !byId.get(l.source) || !byId.get(l.target)) return;
      const [a, b] = [l.source, l.target], from = (byId.get(b).age || 0) > (byId.get(a).age || 0) ? b : a;
      add({ key: `link|${a}|${b}`, kind: "link", a, b, from, to: from === a ? b : a, names: [name(a), name(b)], ids: [a, b], title: `Link ${name(a)} ↔ ${name(b)}`, why: l.why || "", score: (l.kind === "shared" ? 2.4 : 3) + (l.ev ? l.ev.length : 0) });   // linked by the same notes: a little below the rest
    });
    mocs.forEach(m => (m.clusters || []).forEach(c => ((m.missing || {})[c] || []).slice(0, 3).forEach(id => { if (!byId.get(id)) return;
      const r = rank.get(id);
      add({ key: `map|${m.id}|${id}`, kind: "map", m: m.id, mapTitle: m.title, id, name: name(id), ids: [id, m.id], title: `Add ${name(id)} to ${m.title}`, why: `It's in the topic this map covers${r ? ` (#${r} by influence)` : ""}`, score: 2 + (r ? 30 / r : 0) }); })));
    (data.wanted || []).filter(w => w.creatable && (w.refs || []).length >= 3).forEach(w =>
      add({ key: `write|${w.id}`, kind: "write", id: w.id, name: w.name, refs: w.refs, ids: [w.id], title: `Write “${w.name}”`, why: `${w.refs.length} notes link to it, but it doesn't exist`, score: 1 + w.refs.length / 3 }));
    (review.pinned || []).filter(id => byId.get(id)).forEach(id => add({ key: `pin|${id}`, kind: "hub", id, name: name(id), ids: [id], title: `Review ${name(id)}`, why: "You asked to review this", score: 9 }));
    ranked.slice(0, 60).map(id => byId.get(id)).filter(n => n.recent === 0 && (!data.has_usage || n.opens90 === 0)).slice(0, 8).forEach(n =>
      add({ key: `review|${n.id}`, kind: "hub", id: n.id, name: n.name, ids: [n.id], title: `Review ${n.name}`, why: `#${rank.get(n.id)} by influence, quiet for ${data.recent_days || 30}+ days`, score: 1.5 }));
    (data.clusters || []).filter(c => c.size >= 6 && !mapForCluster(mocs, c.id)).slice(0, 3).forEach(c =>
      add({ key: `chart|${c.id}`, kind: "chart", c: c.id, name: c.label || c.name, ids: nodes.filter(n => n.cluster === c.id).map(n => n.id), title: `Give ${c.label || c.name} a map`, why: `${c.size} notes, and no map lists them`, score: 2.5 }));
    // a map the plugin made (Create map) whose name no longer says anything about its topic: rename it to the topic's
    // name. The topic's own name (c.name), not its label, which the analysis takes from the map that claims it. A name
    // that still shares a word with the topic's name, keywords or central notes ("Serial Killers" for a topic whose
    // central note is Ted Bundy) still describes it, and is kept.
    const topicOf = new Map((data.clusters || []).map(c => [c.id, c]));
    const words = t => new Set((String(t).toLowerCase().match(/[a-z0-9]{4,}/g) || []).map(w => w.replace(/s$/, "")));
    mocs.filter(m => m.generated && (m.clusters || []).length === 1).forEach(m => { const c = topicOf.get(m.clusters[0]), now = c && c.name;
      const about = c ? words([c.name, c.keywords || "", ...(c.core || [])].join(" ")) : new Set();
      if (now && now.toLowerCase() !== String(m.title).toLowerCase() && ![...words(m.title)].some(w => about.has(w)))
        add({ key: `rename|${m.id}|${now}`, kind: "rename", m: m.id, c: m.clusters[0], from: m.title, name: now, ids: [m.id],
          title: `Rename ${m.title} Hub to ${now} Hub`, why: "Its topic is called that now", score: 2.2 }); });
    nodes.filter(n => plain(n) && n.isolated).sort((a, b) => (b.words || 0) - (a.words || 0)).slice(0, 5).forEach(n =>
      add({ key: `adopt|${n.id}`, kind: "adopt", id: n.id, name: n.name, ids: [n.id], title: `Link ${n.name} to its topic`, why: "Nothing links it to a topic note yet", score: 1.2 }));
    // best first; ties in a different order each day (seeded by the date), the same order all day
    const seed = fnv(day);
    out.forEach(it => { const n = reactionNudge(review, it.kind); if (n) it.score = (it.score || 0) + n; });
    return out.sort((a, b) => b.score - a.score || (fnv(a.key) ^ seed) - (fnv(b.key) ^ seed));
  }
  // Today's picks: the first three items, kept for the day so they can be ticked off (the XP layer counts them)
  const todayPick = (list, n = 3) => { const picked = [], kinds = new Set();
    for (const it of list) { if (picked.length >= n) break; if (kinds.has(it.kind) && list.length > 2 * n) continue; kinds.add(it.kind); picked.push(it); }
    for (const it of list) { if (picked.length >= n) break; if (!picked.includes(it)) picked.push(it); }
    return picked.map(it => ({ ...it, done: false })); };

  // A Today item is done once the vault shows it, wherever the change was made
  function questDone(q, g) {
    if (q.done) return true;
    if (q.kind === "link") return !!(q.a && q.b && g.node(q.a)) && g.linked(q.a, q.b);
    if (q.kind === "map") {   // the quest's own map (its key), not whichever map covers the note's topic today
      const m = g.mapById(String(q.key || "").split("|")[1]);
      return m ? onMap(m, q.id) : true;   // a map that's gone or no longer a topic map: nothing left to do
    }
    if (q.kind === "write") return !g.wanted(q.id);   // gone from "wanted" = written (here or elsewhere)
    if (q.kind === "chart") return !!g.mapForCluster(q.c);
    if (q.kind === "rename") { const m = g.mapById(q.m); return !m || String(m.title).toLowerCase() === String(q.name).toLowerCase(); }
    if (q.kind === "adopt") return !g.node(q.id) || !g.node(q.id).isolated;
    if (q.kind === "hub" && q.id && g.node(q.id) && g.node(q.id).age === 0) return true;   // reviewed/edited today
    if (TODAY_GROUP[q.kind] && g.hqOpen && !g.hqOpen(q.key)) return true;   // an HQ item gone from the notes: done there (or anywhere)
    return g.reviewed(q.key);
  }

  // A pick built on something that no longer exists (a pair relinked elsewhere or dismissed, a topic or map gone, a
  // note deleted) is dropped, not left as a dead end
  function missionValid(m, g) {
    if (m.kind === "wormhole" || m.kind === "link") return !!(m.a && m.b && g.node(m.a) && g.node(m.b)) && (g.linked(m.a, m.b) || g.suggested(m.a, m.b));
    if (m.kind === "chart" || m.kind === "expedition") return g.hasCluster(m.c);
    if (m.kind === "drift") return !!g.mapById(m.m);
    if (m.kind === "map") return !!g.mapById(m.m || String(m.key || "").split("|")[1]);
    if (m.kind === "adopt" || m.kind === "hub") return !!g.node(m.id);
    if (m.kind === "rename") return !!g.mapById(m.m);
    return true;
  }
  // The standard graph over a data object (graph_data(), or the plugin's liveMerge of it). Built per call:
  // callers rebuild after data changes rather than holding a copy that can drift.
  function graph(data, extra = {}) {
    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const links = new Set(), sugg = new Set();
    (data.links || []).forEach(l => {
      if (l.kind === "link") links.add(pairKey(l.source, l.target));
      else if (isSuggestion(l)) sugg.add(pairKey(l.source, l.target));
    });
    const mocs = (data.mocs || []).filter(m => !m.nav), mocById = new Map(mocs.map(m => [m.id, m]));
    const clusters = new Set((data.clusters || []).map(c => c.id)), wanted = new Set((data.wanted || []).map(w => w.id));
    const reviewed = (extra.review && extra.review.done) || {}, hqMarks = (extra.review && extra.review.hq) || {};
    let hqKeys = null;   // the HQ items the notes still hold (built when first asked)
    const hqOpen = key => (hqKeys = hqKeys || new Set(todayList(data, { groups: ["today", "needs"], today: (data.hq || {}).date }).map(i => i.key))).has(key);
    return {
      hqOpen,
      node: id => byId.get(id),
      linked: (a, b) => links.has(pairKey(a, b)),
      suggested: (a, b) => sugg.has(pairKey(a, b)),
      mapById: id => mocById.get(id),
      mapForCluster: c => mapForCluster(mocs, c),
      hasCluster: c => clusters.has(c),
      wanted: id => wanted.has(id),
      reviewed: key => !!reviewed[key] || String(hqMarks[key] || "").startsWith("done:"),
    };
  }

  // The shared game file (review state, quests, XP) is written by every device. mergeShared(base, mine, disk) is a
  // three-way merge: base is what this device last read or wrote, mine is its state now, disk is the file as it is
  // (maybe from another device). An entry removed here (base has it, mine doesn't) stays removed; one added on the
  // other device (disk has it, base doesn't) is kept. XP adds both devices' gains. Anything else: this device wins.
  // A copy of the game state as the file holds it: missions carry helper functions, which the file leaves out
  // (structuredClone throws on them).
  const sharedSnapshot = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
  function mergeShared(base, mine, disk) {
    if (!disk || typeof disk !== "object") return mine;
    base = base || {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const obj = x => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
    const mergeMap = (b, m, d) => {
      b = obj(b); m = obj(m); d = obj(d);
      const out = {};
      Object.keys(m).forEach(k => { if (k in d || !(k in b) || !same(m[k], b[k])) out[k] = m[k]; });
      Object.keys(d).forEach(k => { if (!(k in m) && (!(k in b) || !same(d[k], b[k]))) out[k] = d[k]; });
      return out;
    };
    // a list as a map by key, merged, back in this device's order with the other device's additions after
    const mergeList = (b, m, d, key) => {
      const asMap = l => Object.fromEntries((Array.isArray(l) ? l : []).map(x => [key(x), x]));
      const merged = mergeMap(asMap(b), asMap(m), asMap(d));
      const order = [...(Array.isArray(m) ? m : []), ...(Array.isArray(d) ? d : [])].map(key);
      return [...new Set(order)].filter(k => k in merged).map(k => merged[k]);
    };
    const str = x => (typeof x === "string" ? x : JSON.stringify(x));
    const out = { ...disk, ...mine };
    const rb = obj(base.review), rm = obj(mine.review), rd = obj(disk.review);
    out.review = { ...rd, ...rm };
    ["skipped", "done", "ft", "hq"].forEach(k => { out.review[k] = mergeMap(rb[k], rm[k], rd[k]); });   // hq: HQ's Later and Done marks (not in the ledgers, so Undo can take one back)
    out.review.pinned = mergeList(rb.pinned, rm.pinned, rd.pinned, str);
    out.review.hiddenKinds = mergeList(rb.hiddenKinds, rm.hiddenKinds, rd.hiddenKinds, str);
    if (rm.reactions || rd.reactions) { const b = obj(rb.reactions), m = obj(rm.reactions), d = obj(rd.reactions), add = (k, f) => Math.max(0, (obj(d[k])[f] || 0) + (obj(m[k])[f] || 0) - (obj(b[k])[f] || 0));   // adds both devices' gains, like XP
      out.review.reactions = Object.fromEntries([...new Set([...Object.keys(m), ...Object.keys(d)])].map(k => [k, { more: add(k, "more"), less: add(k, "less") }])); }
    ["sessions", "sessionFor"].forEach(field => { if (rm[field] || rd[field]) { const m = obj(rm[field]), d = obj(rd[field]); out.review[field] = Object.fromEntries([...new Set([...Object.keys(m), ...Object.keys(d)])].map(k => [k, Math.max(m[k] || 0, d[k] || 0)])); } });
    const cb = obj(base.cosmos), cm = obj(mine.cosmos), cd = obj(disk.cosmos);
    if (mine.cosmos || disk.cosmos) {
      const c = out.cosmos = { ...cd, ...cm };
      if (cm.dungeon || cd.dungeon) { const m = obj(cm.dungeon), d = obj(cd.dungeon); c.dungeon = { reached: Math.max(m.reached || 0, d.reached || 0), best: Math.max(m.best || 0, d.best || 0), bestRun: Math.max(m.bestRun || 0, d.bestRun || 0), hunt: [m.hunt || "", d.hunt || ""].sort().pop() }; }
      if (cm.triage || cd.triage) { const m = obj(cm.triage), d = obj(cd.triage); c.triage = { best: Math.max(m.best || 0, d.best || 0), bestCombo: Math.max(m.bestCombo || 0, d.bestCombo || 0), runs: Math.max(m.runs || 0, d.runs || 0) }; }
      if (cm.survivors || cd.survivors) { const m = obj(cm.survivors), d = obj(cd.survivors), most = k => Math.max(m[k] || 0, d[k] || 0); c.survivors = { best: most("best"), longest: most("longest"), wins: most("wins"), runs: most("runs") }; }
      if (cm.wikirace || cd.wikirace) { const m = obj(cm.wikirace), d = obj(cd.wikirace), late = String(m.day || "") >= String(d.day || "") ? m : d, same = m.day === d.day; c.wikirace = { day: late.day || "", today: same ? Math.max(m.today || 0, d.today || 0) : late.today || 0, best: Math.max(m.best || 0, d.best || 0), streak: same ? Math.max(m.streak || 0, d.streak || 0) : late.streak || 0 }; }
      if (cm.viewOpens || cd.viewOpens) { const b = obj(cb.viewOpens), m = obj(cm.viewOpens), d = obj(cd.viewOpens), v = {}; new Set([...Object.keys(m), ...Object.keys(d)]).forEach(k => { v[k] = (d[k] || 0) + Math.max(0, (m[k] || 0) - (b[k] || 0)); }); c.viewOpens = v; }   // adds both devices' gains, like XP
      c.ach = mergeMap(cb.ach, cm.ach, cd.ach);
      c.hidden = mergeList(cb.hidden, cm.hidden, cd.hidden, str).slice(-500);
      c.kept = mergeList(cb.kept, cm.kept, cd.kept, str);
      c.done = mergeList(cb.done, cm.done, cd.done, x => x.id);
      c.log = mergeList(cb.log, cm.log, cd.log, x => x.date + "|" + x.text).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 200);
      const n = x => (typeof x === "number" ? x : 0);
      // a counter both devices added to keeps both additions (from the last common value)
      const counter = k => typeof cb[k] === "number" ? Math.max(0, n(cm[k]) + n(cd[k]) - cb[k]) : Math.max(n(cm[k]), n(cd[k]));
      c.xp = counter("xp");
      if (typeof cm.alchemyRuns === "number" || typeof cd.alchemyRuns === "number") c.alchemyRuns = counter("alchemyRuns");
      const dm = obj(cm.daily), dd = obj(cd.daily);
      if (dm.date && dm.date === dd.date) {
        const doneD = new Set((dd.quests || []).filter(q => q.done).map(q => q.key));
        c.daily = { ...dm, bonus: !!(dm.bonus || dd.bonus), quests: (dm.quests || []).map(q => (doneD.has(q.key) && !q.done ? { ...q, done: true } : q)) };
      } else if (dd.date && (!dm.date || dd.date > dm.date)) c.daily = dd;
    }
    out.pending = mergeList(base.pending, mine.pending, disk.pending, str);
    return out;
  }

  // Obsidian Sync keeps one copy of a file two devices both wrote, so a device that saves without having seen the
  // other's latest copy (a phone waking up) drops what the other marked. So each device also keeps a ledger of its
  // marks (_scripts/vault-graph-devices/<device>.json): missions finished, items hidden, reviews done or skipped,
  // quests done, pairs dismissed. Only that device writes it, so Sync never chooses between copies, and every reader
  // folds all ledgers in. Marks only accumulate; a skip or review keeps its newest date, so a skip still expires.
  const newer = (a, b) => (a == null ? b : b == null ? a : String(b) > String(a) ? b : a);
  const pairId = p => [p.a, p.b].map(x => String(x).toLowerCase()).sort().join("|");
  function ledgerAdd(ledger, shared, dismissed, today) {
    const l = ledger && typeof ledger === "object" ? JSON.parse(JSON.stringify(ledger)) : {};
    l.v = 1; l.done = l.done || []; l.hidden = l.hidden || []; l.quests = l.quests || {}; l.dismissed = l.dismissed || [];
    l.review = { done: { ...((l.review || {}).done || {}) }, skipped: { ...((l.review || {}).skipped || {}) } };
    const c = (shared && shared.cosmos) || {}, r = (shared && shared.review) || {};
    const ids = new Set(l.done.map(d => d.id));
    (c.done || []).forEach(d => { if (d && d.id && !ids.has(d.id)) { ids.add(d.id); l.done.push(d); } });
    l.done = l.done.slice(-1000);
    l.hidden = [...new Set([...l.hidden, ...(c.hidden || [])])].slice(-500);
    ["done", "skipped"].forEach(k => Object.entries(r[k] || {}).forEach(([key, v]) => { l.review[k][key] = newer(l.review[k][key], v); }));
    const d = c.daily;
    if (d && d.date) {
      const keys = new Set([...(l.quests[d.date] || []), ...(d.quests || []).filter(q => q.done).map(q => q.key)]);
      if (keys.size) l.quests[d.date] = [...keys];
    }
    if (today) Object.keys(l.quests).forEach(day => { if ((Date.parse(today) - Date.parse(day)) / 864e5 > 14) delete l.quests[day]; });   // daily quests are per day
    const seen = new Set(l.dismissed.map(pairId));
    (dismissed || []).forEach(p => { if (p && p.a && p.b && !seen.has(pairId(p))) { seen.add(pairId(p)); l.dismissed.push(p); } });
    return l;
  }
  // The shared game state with every device's ledger folded in: what any device marked stays marked here.
  function applyLedgers(shared, ledgers) {
    const ls = (ledgers || []).filter(l => l && typeof l === "object");
    if (!ls.length) return shared;
    const out = sharedSnapshot(shared) || { v: 1 };
    const c = out.cosmos = out.cosmos || {}, r = out.review = out.review || {};
    c.done = c.done || [];
    const ids = new Set(c.done.map(d => d.id)), hidden = new Set(c.hidden || []);
    for (const l of ls) {
      (l.done || []).forEach(d => { if (d && d.id && !ids.has(d.id)) { ids.add(d.id); c.done.push(d); } });
      (l.hidden || []).forEach(h => hidden.add(h));
      ["done", "skipped"].forEach(k => Object.entries((l.review || {})[k] || {}).forEach(([key, v]) => { r[k] = r[k] || {}; r[k][key] = newer(r[k][key], v); }));
      const keys = c.daily && c.daily.date && (l.quests || {})[c.daily.date];
      if (keys) c.daily.quests = (c.daily.quests || []).map(q => (keys.includes(q.key) && !q.done ? { ...q, done: true } : q));
    }
    c.hidden = [...hidden].slice(-500);
    if (c.daily && c.daily.quests) c.daily.quests = c.daily.quests.filter(q => !hidden.has(q.key));   // as hideGameItem does
    if (c.missions) c.missions = c.missions.filter(m => !hidden.has(m.id));
    return out;
  }
  const ledgerDismissed = ledgers => (ledgers || []).flatMap(l => (l && l.dismissed) || []);

  // Marks are keyed by a note's path, so they follow it when it moves. Each device keeps the moves it saw in its ledger
  // (moved: { old: { to, at } }), since Sync shows another device a move as a delete and a create, with no rename to
  // hear. Every read goes through followLedgers, so a mark in any device's ledger or an old copy of a file still lands
  // on the note. A path that exists again (a new note took the old name, or the move was undone) is not followed.
  const hasMove = (moves, p) => Object.prototype.hasOwnProperty.call(moves, p);
  function ledgerMoves(ledgers) {
    const out = {};
    (ledgers || []).forEach(l => Object.entries((l && l.moved) || {}).forEach(([from, m]) => { if (m && m.to && (!hasMove(out, from) || String(m.at) > String(out[from].at))) out[from] = m; }));
    return out;
  }
  function movedPath(moves, path, exists) {
    const seen = new Set(); let p = path;
    while (hasMove(moves, p) && !seen.has(p) && !(exists && exists(p))) { seen.add(p); p = moves[p].to; }
    return p;
  }
  // The same state with every path in it moved: a value, a key, or one part of a key like "link|a.md|b.md".
  function followMoves(state, moves, exists) {
    if (!moves || !Object.keys(moves).length) return state;
    const text = s => (s.includes("|") ? s.split("|").map(x => movedPath(moves, x, exists)).join("|") : movedPath(moves, s, exists));
    const walk = v => {
      if (typeof v === "string") return text(v);
      if (Array.isArray(v)) {   // two entries that are now the same note count once
        const seen = new Set();
        return v.map(walk).filter(x => { const k = typeof x === "string" ? x : x && typeof x.id === "string" ? `id:${x.id}` : null; if (k === null) return true; if (seen.has(k)) return false; seen.add(k); return true; });
      }
      if (!v || typeof v !== "object") return v;
      const out = {};
      Object.entries(v).forEach(([k, x]) => { const to = text(k), val = walk(x); out[to] = to in out ? (typeof val === "string" && typeof out[to] === "string" ? newer(out[to], val) : k === to ? val : out[to]) : val; });
      return out;
    };
    return walk(state);
  }
  // A ledger after this device saw moves: they're on record for the other devices, and its own marks use the new paths.
  function ledgerMoved(ledger, moves, at, exists) {
    const { moved, ...marks } = ledger && typeof ledger === "object" ? ledger : {};
    const fresh = Object.fromEntries(Object.entries(moves).filter(([from, to]) => from !== to).map(([from, to]) => [from, { to, at }]));
    return { v: 1, ...followMoves(marks, fresh, exists), moved: { ...(moved || {}), ...fresh } };
  }
  // A note as an enemy: what it is decides what it is, the same in every game and on every run.
  // r: body radius in cells; h: height against a wall's 1; z: how far it floats; pain: chance a hit staggers it
  const FOE_KINDS = {
    wisp:    { name: "Wisp",    is: "unlinked or tiny note", hp: 20,  speed: 3.6, melee: 7,  ranged: 0,  shot: 0,   every: 0.9, r: 0.3,  h: 0.55, z: 0.22, pain: 0.9,  score: 50 },
    grunt:   { name: "Grunt",   is: "ordinary note",         hp: 45,  speed: 2.2, melee: 10, ranged: 7,  shot: 7,   every: 2.4, r: 0.32, h: 0.85, z: 0,    pain: 0.7,  score: 100 },
    spitter: { name: "Spitter", is: "well-linked note",      hp: 70,  speed: 1.7, melee: 10, ranged: 12, shot: 8.5, every: 1.6, r: 0.42, h: 0.85, z: 0.12, pain: 0.5,  score: 200 },
    hunter:  { name: "Hunter",  is: "person",                hp: 130, speed: 3.3, melee: 22, ranged: 0,  shot: 0,   every: 0.8, r: 0.35, h: 0.95, z: 0,    pain: 0.3,  score: 350 },
    brute:   { name: "Brute",   is: "long note or other map", hp: 240, speed: 1.3, melee: 28, ranged: 18, shot: 6,   every: 2.6, r: 0.5,  h: 1.15, z: 0,    pain: 0.2,  score: 500 },
    boss:    { name: "Boss",    is: "the topic's map",       hp: 900, speed: 1.5, melee: 40, ranged: 16, shot: 8,   every: 1.0, r: 0.7,  h: 1.6,  z: 0,    pain: 0.04, score: 5000, fan: 3 },
  };
  const foeLinks = n => (n.inlinks || 0) + (n.outlinks || 0);
  const foePercentile = (vals, f) => { const a = vals.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0; };
  const foeStats = notes => ({ long: foePercentile(notes.map(n => n.words || 0), 0.9), tiny: foePercentile(notes.map(n => n.words || 0), 0.2), linked: foePercentile(notes.map(foeLinks), 0.75) });
  const foeKind = (n, s) => (n.person ? "hunter" : n.moc || (n.words || 0) >= s.long ? "brute" : n.isolated || (n.words || 0) < s.tiny ? "wisp" : foeLinks(n) >= s.linked ? "spitter" : "grunt");

  // Wikirace: today's route, the same on every device while the links are the same. par is the fewest hops without using a
  // hub, so it can always be matched for free. hubs and people aren't ends of a route. edges: [[a, b]] (a link goes both ways).
  function wikiraceRoute(edges, day, o = {}) {
    const avoid = o.avoid || new Set(), min = o.minHops || 3, max = o.maxHops || 6, near = new Map(), hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
    edges.forEach(([a, b]) => { if (a === b || avoid.has(a) || avoid.has(b)) return; [[a, b], [b, a]].forEach(([x, y]) => { if (!near.has(x)) near.set(x, new Set()); near.get(x).add(y); }); });
    const starts = [...near.keys()].sort(); if (!starts.length) return null;
    const first = hash(String(day)) % starts.length;
    for (let i = 0; i < starts.length; i++) {
      const from = starts[(first + i) % starts.length], dist = new Map([[from, 0]]), queue = [from];
      for (let k = 0; k < queue.length; k++) { const d = dist.get(queue[k]); if (d < max) near.get(queue[k]).forEach(y => { if (!dist.has(y)) { dist.set(y, d + 1); queue.push(y); } }); }
      const ends = [...dist].filter(([, d]) => d >= min).map(([id]) => id).sort();
      if (ends.length) { const to = ends[hash(day + "|" + from) % ends.length]; return { from, to, par: dist.get(to), day }; }
    }
    return null;
  }
  const wikiraceScore = ({ hops, par, hubs = 0, traps = 0, seconds = 0 }) => Math.max(0, 1000 - Math.max(0, hops - par) * 100 - hubs * 50 - traps * 75 - Math.floor(seconds));
  // A generated report's file name as people read it: its date stays, the machine's run stamp and host don't.
  const reportTitle = name => String(name).replace(/(\d{4}-\d{2}-\d{2})\s+\d{6}-\d+(\s+\S+)?$/, "$1");
  // What HQ's search understands besides words: kind:, status:, system:, tag:, in: and is:stale, is:old or is:focus. Only names
  // it knows are filters, so "note: this" or a time like 10:30 stays plain words.
  const SEARCH_FILTERS = ["kind", "status", "system", "tag", "in", "is"];
  function hqSearchQuery(query) {
    const filters = [], text = String(query).replace(/(?:^|\s)([a-z]+):("[^"]+"|\S+)/gi, (all, k, v) => { const key = k.toLowerCase(); if (!SEARCH_FILTERS.includes(key)) return all; filters.push({ key, value: v.replace(/^"|"$/g, "").toLowerCase() }); return " "; }).replace(/\s+/g, " ").trim();
    return { text, filters };
  }
  // does one HQ item or project pass every filter? A filter that means nothing for this kind of thing doesn't pass it.
  function hqSearchPasses(x, filters, o = {}) {
    const has = (v, ...of) => of.some(s => String(s == null ? "" : s).toLowerCase().includes(v)), stale = o.staleDays || 90, project = !!x.group && !x.kindKey && !x.key;
    return filters.every(({ key, value }) => {
      if (key === "kind") return has(value, x.kind, project ? "" : kindWords(x.kind));
      if (key === "status") return project && has(value, x.status, x.group);
      if (key === "system") return project ? (x.systems || []).some(s => has(value, s, systemLabel(s))) : has(value, x.path);
      if (key === "tag") return (x.tags || []).some(t => has(value, t));
      if (key === "in") return has(value, x.path);
      if (key === "is") {
        const age = project ? (x.updated && o.today ? Math.round((Date.parse(o.today) - Date.parse(x.updated)) / 864e5) : 0) : x.age || 0;
        if (value === "stale") return age >= stale; if (value === "old") return age >= 14;
        if (value === "focus") return !project && (o.focus || []).includes(x.key);
      }
      return false;
    });
  }
  // A note's text as blocks to show in a preview, without Obsidian: its frontmatter and embeds go, and it stops at max characters.
  function notePreview(text, max = 20000) {
    const body = String(text || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), cut = body.length > max, blocks = []; let fence = null, para = [];
    const flush = () => { if (para.length) { blocks.push({ kind: "p", text: para.join(" ") }); para = []; } };
    for (const line of (cut ? body.slice(0, max) : body).split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) { if (fence) { blocks.push({ kind: "code", text: fence.join("\n") }); fence = null; } else { flush(); fence = []; } continue; }
      if (fence) { fence.push(line); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/), item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(\[.\]\s+)?(.*)$/);
      if (!line.trim()) flush();
      else if (h) { flush(); blocks.push({ kind: "h", level: h[1].length, text: plainSnippet(h[2]) }); }
      else if (item) { flush(); blocks.push({ kind: "li", text: plainSnippet(item[2]), done: !!(item[1] && /x/i.test(item[1])), task: !!item[1], deep: /^\s{2,}/.test(line) }); }
      else if (/^\s*!\[/.test(line) || /^\s*\|?[-: |]+\|?\s*$/.test(line)) continue;
      else para.push(plainSnippet(line));
    }
    flush(); if (fence) blocks.push({ kind: "code", text: fence.join("\n") });
    return { blocks: blocks.filter(b => b.kind === "code" || b.text), cut };
  }
  // A week's work as Markdown, for a standup, an update or a note. week: the Monday.
  function weekReview(data, review, monday) {
    const start = new Date(`${monday}T12:00:00`), days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return localDay(d); });
    const rows = days.map(date => ({ date, done: doneToday(data, review, date), minutes: sessionMinutes(review, date) })), total = rows.reduce((a, r) => a + r.done.length, 0), focus = rows.reduce((a, r) => a + r.minutes, 0);
    const lines = [`**${total} done** on ${rows.filter(r => r.done.length).length} days${focus ? ` · ${minutesWords(focus)} focused` : ""}`, ""];
    rows.filter(r => r.done.length).forEach(r => { lines.push(`## ${new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`, "", ...r.done.map(d => `- ${d.text}`), ""); });
    return { total, focus, text: lines.join("\n").trim() + "\n" };
  }
  const weekStart = day => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
  // Focus time per project, in the shared file by note path, so it follows the note like every other mark.
  const projectMinutes = (review, path) => ((review || {}).sessionFor || {})[path] || 0;
  // Triage Run: the open tasks a run deals, oldest first, and what a swipe scores. An older task is worth more; a run of
  // decisions multiplies it, up to five times.
  const triageDeck = items => (items || []).filter(it => (it.kind === "task" || it.kind === "carried") && !it.delegated).sort((a, b) => (b.age || 0) - (a.age || 0));
  const triagePoints = (age, combo) => Math.round((10 + Math.min(age || 0, 120) / 4) * (1 + Math.min(combo || 0, 16) * 0.25));
  // A project/ tag as people say it: the system's name from the rules file, or the tag's own words.
  function systemLabel(tag) {
    const named = Object.entries(R.systems || {}).find(([, s]) => s && (s.tags || []).includes(tag));
    if (named) return named[0];
    const words = String(tag).replace(/^project\//, "").replace(/[-_]/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  // The one read of the shared state: every ledger folded in, every path where its note is now.
  function followLedgers(shared, ledgers, exists) {
    const moves = ledgerMoves(ledgers), follow = v => followMoves(v, moves, exists);
    const marks = (ledgers || []).filter(l => l && typeof l === "object").map(({ moved, ...l }) => follow(l));
    return marks.length ? applyLedgers(follow(shared), marks) : shared;
  }

  return { plainSnippet, hqThreads, hqBrief, FOCUS_MAX, focusKeys, hqFocusItems, doneToday, addTaskLine, hqPeople, reactionNudge, canHideKind, kindWords, nameDate, bornDate, HQ: H, PROJECT_TYPES, STATUS_CHOICES: H.status_choices || [], projectType, projectStatusTag, withStatusTag, tagsOf, openTaskLines, closeMark, TASK_LINE, taskLine, completionStamp, hasCompletion, stampsDone, addWorkLine, reportRows, plainRow, plainRowFull, stripAnsi, taskField, plainTask, inlineField, frontOf, tasksIn, itemsUnder, scopeSummary, scopeEstimate, hqJournalDate, dailyNotePath, canonicalDailyPath, canonicalJournalPath, canonicalJournal, hqKind, hqGather, hqJobs, hqProjects, hqProjectSearch, fuzzyScore, todayGroup, TODAY_GROUP, statusGroup,
    RULES: R, folders: R.folders, files: R.files, mergeShared, sharedSnapshot, ledgerAdd, applyLedgers, ledgerDismissed, ledgerMoves, movedPath, followMoves, ledgerMoved, followLedgers, systemLabel, triageDeck, triagePoints, FOE_KINDS, foeStats, foeKind, wikiraceRoute, wikiraceScore, hqCalendar, monthShift, sessionMinutes, sessionAdded, minutesWords, BOARD_GROUPS, statusForGroup, reportTitle, hqSearchQuery, hqSearchPasses, notePreview, weekReview, weekStart, projectMinutes, linkedByName, isRecord, isStale, localDay, today, safeName, stem, pairKey, dismissKey, onMap, mapForCluster, isMapCandidate, isHubName, isHub, noteKind, SUGGESTION_KINDS, isSuggestion, isPrivate, isContextNote, contextTopic, claims, mentionNames, trophicLevels, joinsWhenLinked,
    SCENE_WHEN, SCENE_PARTS, sceneSpec, sceneYaml, sceneKey, recallWords, recallChunks, recallNoteDate, recallTimeRange, recallNearTarget, recallSearch, todayList, todayPick, TODAY_XP, questDone, missionValid, graph };
  }
  // rule data in layers: each later one wins, key by key (nested objects merge; a list or a value replaces)
  const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
  const mergeRules = (...layers) => layers.reduce((a, b) => { const out = { ...a };
    Object.entries(b || {}).forEach(([k, v]) => { out[k] = isObj(v) && isObj(a[k]) ? mergeRules(a[k], v) : v; }); return out; }, {});
  const api = make(__RULES_JSON__);
  api.mergeRules = mergeRules;
  api.configure = R => { const fresh = make(R); Object.keys(fresh).forEach(k => { api[k] = fresh[k]; }); return api; };
  return api;
})();
