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
const VGRules = ((R) => {
  const RECORD_TAG = new RegExp(R.record_tags), RECORD_PATH = new RegExp(R.record_paths), DATED = new RegExp(R.dated_name);
  // Records (finished work, release notes, meetings, reports, dated logs) are meant to stay as written: never "stale".
  const isRecord = n => (n.tags || []).some(t => RECORD_TAG.test(t)) || RECORD_PATH.test(n.id) || DATED.test(n.name || "");
  const isStale = (n, days = R.stale_days) => !!n && !isRecord(n) && n.age > days;

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
    if (!id.includes("/") || NOT_MAP_TOPS.has(id.split("/")[0]) || id.includes("/10-Archive/") || NOT_MAP_NAME.test(name)) return false;
    const tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, ""));
    return tags.includes("meta/moc") || String(fm.type || "").toLowerCase() === "moc" || HUB_NAME.test(name);
  }
  const isHubName = id => HUB_NAME.test(stemCase(id));
  // How prose names a note (vault_gaps._mention_matcher counts these, "Link mentions" links them): its title,
  // the topic of a "<Topic> - Context" note, and its aliases
  const CONTEXT_SUFFIX = new RegExp(R.context_suffix, "i");
  const mentionNames = (name, aliases) => [...new Set([name, name.replace(CONTEXT_SUFFIX, ""), ...[].concat(aliases || []).filter(a => typeof a === "string")]
    .map(s => s.trim()).filter(s => s.length >= 2))].sort((a, b) => b.length - a.length);
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
  // Recall: find where something was dealt with before, inside notes, from whatever is half-remembered: words (also
  // misspelled or partial), when ("last month", "in June"), who (a name from the people folder), what kind of thing
  // (a command, SQL, a table, a checklist, a screenshot, an error) and where (a folder word). The same engine as
  // _System/vault_recall.py (tests/test_rules.js compares them), tuned by vault_graph_rules.json "recall".
  // recallChunks(text) / recallNoteDate(path, text) -> what to cache per note;
  // recallSearch([{ path, date, chunks }], query, { n, codeOnly, people, today }) -> [{ path, kind, lang, heading, line, score, why, date, snippet }]
  const RC = R.recall || { boost: {}, stop: "", synonyms: {}, per_note: 2, cues: { kinds: {} } };
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
    const body = String(text).replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, ""), out = [];
    let heading = "", buf = [], start = 1, code = null, lang = "", cstart = 0, cbuf = [];
    body.split("\n").forEach((line, k) => {
      const i = k + 1, f = line.match(/^(```+|~~~+)\s*([\w+\-#.]*)/);
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
    return lastSet = { chunks: notes.map(n => n.chunks), codeOnly: !!codeOnly, docs, vocab, avg: docs.length ? docs.reduce((s, d) => s + d.len, 0) / docs.length : 0 };
  }
  function recallSearch(notes, query, o = {}) {
    const B = RC.boost, q = recallWords(query), qs = new Set(q), daily = (R.folders.daily || "01-Daily") + "/", FW = CUES.fuzzy_weight;
    const terms = new Map([...qs].map(t => [t, 1]));
    [...qs].forEach(t => Object.entries(RC.synonyms).forEach(([k, alts]) => { if (t === k || alts.includes(t)) [k, ...alts].forEach(x => { if (!terms.has(x)) terms.set(x, 0.5); }); }));   // a synonym counts half
    const kinds = Object.entries(CUES.kinds).filter(([, v]) => v.words.some(w => qs.has(w))).map(([k]) => k);
    const span = recallTimeRange(query, o.today), who = [...qs].filter(t => (o.people || []).includes(t));
    // the graph: links (with similar-meaning pairs) and how much each note is relied on (o.graph = { links: [[a, b, kind]], use: { path: n } })
    const G = o.graph || { links: [], use: {} }, nbr = new Map(), sim = new Map(), add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
    G.links.forEach(([a, b, k]) => { const m = k === "similar" ? sim : nbr; add(m, a, b); add(m, b, a); });
    const use = G.use || {}, umax = Math.max(1e-9, ...Object.values(use).map(v => Math.log1p(v)), 0) || 1;
    const near = recallNearTarget(query, notes.map(n => n.path)), nearSet = near ? new Set([...(nbr.get(near) || []), ...(sim.get(near) || [])]) : new Set();
    const { docs, vocab, avg } = docSet(notes, o.codeOnly);
    if (!docs.length) return [];
    // a word the vault doesn't have: close spellings and longer words that start with it
    [...qs].forEach(t => { if (vocab.has(t) || /^\d+$/.test(t) || t.length < 4) return;
      [...vocab.keys()].filter(w => w.startsWith(t) || (t.length >= 5 && edit1(t, w))).sort((a, b) => vocab.get(b) - vocab.get(a)).slice(0, 3)
        .forEach(w => { if (!terms.has(w)) terms.set(w, FW); }); });
    const N = docs.length, df = new Map();
    terms.forEach((_, t) => df.set(t, docs.filter(d => d.tf.has(t)).length));
    const fuzzy = [...terms].filter(([, w]) => w === FW).map(([t]) => t), hits = [];
    for (const d of docs) {
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
      const matched = [...qs].filter(t => d.tf.has(t) || nw.has(t) || hw.has(t) || pw.has(t) || fuzzy.some(w => d.tf.has(w))).length;
      score *= Math.pow(matched / Math.max(1, qs.size), 1.5);   // every query word that matches counts a lot
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
      o.events.forEach(e => { out.push(`  - every: ${e.every}`, `    do: ${e.verb}${e.target ? " nearest " + e.target : ""}`); if (e.from && e.from !== "current") out.push(`    from: ${e.from}`); }); }
    return out.join("\n");
  }

  // A daily quest is done once the vault shows it, wherever the change was made
  function questDone(q, g) {
    if (q.done) return true;
    if (q.kind === "link") return !!(q.a && q.b && g.node(q.a)) && g.linked(q.a, q.b);
    if (q.kind === "map") {   // the quest's own map (its key), not whichever map covers the note's topic today
      const m = g.mapById(String(q.key || "").split("|")[1]);
      return m ? onMap(m, q.id) : true;   // a map that's gone or no longer a topic map: nothing left to do
    }
    if (q.kind === "write") return !g.wanted(q.id);   // gone from "wanted" = written (here or elsewhere)
    if (q.kind === "hub" && q.id && g.node(q.id) && g.node(q.id).age === 0) return true;   // reviewed/edited today
    return g.reviewed(q.key);
  }

  // A mission or quest built on a suggestion that no longer exists (relinked elsewhere, dismissed, or the
  // analysis no longer finds the pair related, topic gone) is dropped, not left as a dead end
  function missionValid(m, g) {
    if (m.kind === "wormhole" || m.kind === "link") return !!(m.a && m.b && g.node(m.a) && g.node(m.b)) && (g.linked(m.a, m.b) || g.suggested(m.a, m.b));
    if (m.kind === "chart" || m.kind === "expedition") return g.hasCluster(m.c);
    if (m.kind === "drift") return !!g.mapById(m.m);
    return true;
  }
  // [done, needed] for a mission; the view awards it when done >= needed
  function missionProgress(m, g, stepsOf) {
    const base = (m.baseline || []).filter(id => g.node(id));
    if (m.kind === "wormhole" || m.kind === "link") return [g.node(m.a) && g.linked(m.a, m.b) ? 1 : 0, 1];
    if (m.kind === "nebula") return [Math.min(3, base.filter(id => !g.node(id).isolated).length), 3];
    if (m.kind === "chart") return [g.mapForCluster(m.c) ? 1 : 0, 1];
    if (m.kind === "drift") { const mm = g.mapById(m.m); return [Math.min(5, mm ? (m.baseline || []).filter(id => onMap(mm, id)).length : 0), 5]; }
    if (m.kind === "expedition" && stepsOf) { const s = stepsOf(m); return [s.filter(x => x.done).length, s.length]; }
    if (m.kind === "horizon") return [Math.min(3, base.filter(id => !isStale(g.node(id))).length), 3];
    return [0, 1];
  }
  const missionDone = (m, g, stepsOf) => { const [d, n] = missionProgress(m, g, stepsOf); return d >= n; };
  // worth showing in a list: still valid and not already achieved
  const missionOpen = (m, g, stepsOf) => missionValid(m, g) && !missionDone(m, g, stepsOf);

  // The standard graph over a data object (graph_data(), or the plugin's liveMerge of it). Built per call:
  // callers rebuild after data changes rather than holding a copy that can drift.
  function graph(data, extra = {}) {
    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const links = new Set(), sugg = new Set();
    (data.links || []).forEach(l => {
      if (l.kind === "link") links.add(pairKey(l.source, l.target));
      else if (l.kind === "gap" || l.kind === "similar") sugg.add(pairKey(l.source, l.target));
    });
    const mocs = (data.mocs || []).filter(m => !m.nav), mocById = new Map(mocs.map(m => [m.id, m]));
    const clusters = new Set((data.clusters || []).map(c => c.id)), wanted = new Set((data.wanted || []).map(w => w.id));
    const reviewed = (extra.review && extra.review.done) || {};
    return {
      node: id => byId.get(id),
      linked: (a, b) => links.has(pairKey(a, b)),
      suggested: (a, b) => sugg.has(pairKey(a, b)),
      mapById: id => mocById.get(id),
      mapForCluster: c => mapForCluster(mocs, c),
      hasCluster: c => clusters.has(c),
      wanted: id => wanted.has(id),
      reviewed: key => !!reviewed[key],
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
    ["skipped", "done", "ft"].forEach(k => { out.review[k] = mergeMap(rb[k], rm[k], rd[k]); });
    out.review.pinned = mergeList(rb.pinned, rm.pinned, rd.pinned, str);
    const cb = obj(base.cosmos), cm = obj(mine.cosmos), cd = obj(disk.cosmos);
    if (mine.cosmos || disk.cosmos) {
      const c = out.cosmos = { ...cd, ...cm };
      c.ach = mergeMap(cb.ach, cm.ach, cd.ach);
      c.hidden = mergeList(cb.hidden, cm.hidden, cd.hidden, str).slice(-500);
      c.kept = mergeList(cb.kept, cm.kept, cd.kept, str);
      c.done = mergeList(cb.done, cm.done, cd.done, x => x.id);
      c.log = mergeList(cb.log, cm.log, cd.log, x => x.date + "|" + x.text).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 200);
      const n = x => (typeof x === "number" ? x : 0);
      c.xp = typeof cb.xp === "number" ? Math.max(0, n(cm.xp) + n(cd.xp) - cb.xp) : Math.max(n(cm.xp), n(cd.xp));
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

  return { RULES: R, folders: R.folders, files: R.files, mergeShared, sharedSnapshot, ledgerAdd, applyLedgers, ledgerDismissed, linkedByName, isRecord,isStale, stem, pairKey, dismissKey, onMap, mapForCluster, isMapCandidate, isHubName, claims, mentionNames, trophicLevels, joinsWhenLinked,
    SCENE_WHEN, SCENE_PARTS, sceneSpec, sceneYaml, sceneKey, recallWords, recallChunks, recallNoteDate, recallTimeRange, recallNearTarget, recallSearch, questDone, missionValid, missionProgress, missionDone, missionOpen, graph };
})(__RULES_JSON__);
