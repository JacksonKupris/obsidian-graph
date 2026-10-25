// engine.js - the analysis, moving here from analysis/*.py one part at a time (ROADMAP phase 4), so the plugin can
// analyse on every device and each step exists once. A part moves when its parity test shows it gives what the Python
// gives on a real vault (the vault's _scripts/tests/test_graph_vault.js). The build puts this after rules.js.
//
// Graphs are plain objects {node: {neighbour: weight}} in a fixed key order. Every loop below goes through keys in the
// same order as the Python it mirrors (dicts keep insertion order there too), so floating-point sums and ties come out
// the same.
const VGEngine = (() => {
  // Python's string order (code points); JS compares UTF-16 units, which differs only around surrogate pairs
  const SURR = /[\uD800-\uDFFF]/;
  const pyCmp = (a, b) => { if (a === b) return 0;
    if (!SURR.test(a) && !SURR.test(b)) return a < b ? -1 : 1;
    const A = Array.from(a, c => c.codePointAt(0)), B = Array.from(b, c => c.codePointAt(0));
    for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i];
    return A.length - B.length; };
  const sorted = xs => [...xs].sort((a, b) => pyCmp(String(a), String(b)));

  // Python's random.Random(seed) for a non-negative int seed below 2^32, and its shuffle: the same Mersenne Twister
  // (init_by_array, genrand_uint32) and the same draws (getrandbits, _randbelow), so Louvain visits nodes in the same order
  function pyRandom(seed) {
    const N = 624, mt = new Uint32Array(N); let mti = N + 1;
    const initGenrand = s => { mt[0] = s >>> 0; for (mti = 1; mti < N; mti++) { const p = mt[mti - 1] ^ (mt[mti - 1] >>> 30); mt[mti] = (Math.imul(1812433253, p) + mti) >>> 0; } };
    const key = [seed >>> 0];
    initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++; j++; if (i >= N) { mt[0] = mt[N - 1]; i = 1; } if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++; if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
    const uint32 = () => {
      if (mti >= N) {
        for (let kk = 0; kk < N; kk++) { const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % N] & 0x7fffffff); mt[kk] = mt[(kk + 397) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        mti = 0;
      }
      let y = mt[mti++];
      y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
      return y >>> 0;
    };
    const getrandbits = k => uint32() >>> (32 - k);   // k <= 32
    const randbelow = n => { const k = 32 - Math.clz32(n); let r = getrandbits(k); while (r >= n) r = getrandbits(k); return r; };
    return {
      uint32, getrandbits, randbelow,
      shuffle(x) { for (let i = x.length - 1; i > 0; i--) { const j = randbelow(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; },
    };
  }

  // ---- topics (vault_gaps.louvain / _louvain_level / absorb_small)
  // Louvain modularity clustering (weighted, undirected): node -> community number
  function louvain(adj, seed = 7) {
    const rng = pyRandom(seed);
    let graph = new Map(sorted(Object.keys(adj)).map(n => [n, new Map(sorted(Object.keys(adj[n])).map(t => [t, adj[n][t]]))]));
    let membership = new Map([...graph.keys()].map(n => [n, n]));
    for (;;) {
      const [comm, moved] = louvainLevel(graph, rng);
      if (!moved) break;
      membership = new Map([...membership].map(([n, s]) => [n, comm.get(s)]));
      const agg = new Map();
      for (const [u, nbrs] of graph) for (const [v, w] of nbrs) {
        const cu = comm.get(u), cv = comm.get(v);
        if (!agg.has(cu)) agg.set(cu, new Map());
        const row = agg.get(cu); row.set(cv, (row.get(cv) || 0) + w);
      }
      graph = agg;
      for (const c of new Set(comm.values())) if (!graph.has(c)) graph.set(c, new Map());
    }
    const ids = new Map(sorted(new Set(membership.values())).map((c, i) => [c, i]));
    return Object.fromEntries([...membership].map(([n, c]) => [n, ids.get(c)]));
  }
  function louvainLevel(graph, rng) {
    const k = new Map(), comm = new Map();
    for (const [u, nb] of graph) { let s = 0; for (const w of nb.values()) s += w; k.set(u, s); comm.set(u, u); }
    let m2 = 0; for (const v of k.values()) m2 += v;
    const tot = new Map(k);
    if (m2 === 0) return [comm, false];
    let movedAny = false, improved = true;
    const nodes = sorted(graph.keys());
    while (improved) {
      improved = false;
      rng.shuffle(nodes);
      for (const u of nodes) {
        const cu = comm.get(u), wTo = new Map(), ku = k.get(u);
        for (const [v, w] of graph.get(u)) if (v !== u) { const c = comm.get(v); wTo.set(c, (wTo.get(c) || 0) + w); }
        tot.set(cu, tot.get(cu) - ku);
        let best = cu, bestGain = (wTo.get(cu) || 0) - tot.get(cu) * ku / m2;
        for (const [c, w] of wTo) { const gain = w - tot.get(c) * ku / m2; if (gain > bestGain + 1e-12) { best = c; bestGain = gain; } }
        tot.set(best, tot.get(best) + ku);
        if (best !== cu) { comm.set(u, best); improved = movedAny = true; }
      }
    }
    return [comm, movedAny];
  }
  // Louvain leaves fragments of 3-5 notes; each joins the topic it is most tied to when that tie is at least `share` of
  // all its ties (and that topic is no smaller), else it stays a topic of its own
  function absorbSmall(comm0, g, small = 6, share = 0.25) {
    const comm = new Map(Object.entries(comm0));
    for (let round = 0; round < 3; round++) {
      const size = new Map(); for (const c of comm.values()) size.set(c, (size.get(c) || 0) + 1);
      let changed = false;
      const order = [...size].filter(([, n]) => n < small).map(([c]) => c).sort((a, b) => size.get(a) - size.get(b) || a - b);
      for (const c of order) {
        const ms = [...comm].filter(([, x]) => x === c).map(([r]) => r);
        if (!ms.length) continue;
        const ties = new Map(); let total = 0;
        for (const r of ms) for (const [t, w] of Object.entries(g[r] || {})) { total += w; const ct = comm.has(t) ? comm.get(t) : c; if (ct !== c) ties.set(ct, (ties.get(ct) || 0) + w); }
        if (ties.size && total) {
          let best = null, bw = -Infinity;
          for (const [x, w] of ties) if (w > bw || (w === bw && x < best)) { best = x; bw = w; }   // max by (weight, -id)
          if (bw / total >= share && size.get(best) >= size.get(c)) {
            for (const r of ms) comm.set(r, best);
            size.set(best, size.get(best) + size.get(c)); size.set(c, 0); changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return Object.fromEntries(comm);
  }

  // ---- influence (vault_gaps.betweenness): Brandes betweenness on the unweighted link graph, normalised
  function betweenness(adj) {
    const nodes = Object.keys(adj), bc = Object.fromEntries(nodes.map(n => [n, 0]));
    for (const s of nodes) {
      const stack = [], preds = new Map(), sigma = new Map(nodes.map(n => [n, 0])), dist = new Map(nodes.map(n => [n, -1]));
      sigma.set(s, 1); dist.set(s, 0);
      const q = [s]; let head = 0;
      while (head < q.length) {
        const v = q[head++]; stack.push(v);
        for (const w of Object.keys(adj[v])) {
          if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); q.push(w); }
          if (dist.get(w) === dist.get(v) + 1) { sigma.set(w, sigma.get(w) + sigma.get(v)); if (!preds.has(w)) preds.set(w, []); preds.get(w).push(v); }
        }
      }
      const delta = new Map(nodes.map(n => [n, 0]));
      while (stack.length) {
        const w = stack.pop();
        for (const v of preds.get(w) || []) delta.set(v, delta.get(v) + sigma.get(v) / sigma.get(w) * (1 + delta.get(w)));
        if (w !== s) bc[w] += delta.get(w);
      }
    }
    const n = nodes.length, scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
    return Object.fromEntries(nodes.map(v => [v, bc[v] * scale]));
  }

  // ---- sums: math.fsum (Shewchuk's exact partials, then one correctly rounded result), and dot products with it.
  // Python's math.sumprod gives this same correctly rounded sum for float32 vectors (checked on 20,000 pairs of this
  // vault's embeddings), so meaning scores match to the last bit.
  function fsum(xs) {
    const partials = [];
    for (let x of xs) {
      let i = 0;
      for (let y of partials) {
        if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
        const hi = x + y, lo = y - (hi - x);
        if (lo) partials[i++] = lo;
        x = hi;
      }
      partials.length = i; partials.push(x);
    }
    let n = partials.length, hi = 0, lo = 0;
    if (n > 0) {
      hi = partials[--n];
      while (n > 0) { const x = hi, y = partials[--n]; hi = x + y; const yr = hi - x; lo = y - yr; if (lo !== 0) break; }
      if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) { const y = lo * 2, x = hi + y, yr = x - hi; if (y === yr) hi = x; }
    }
    return hi;
  }
  const dot = (a, b) => { const p = new Array(a.length); for (let i = 0; i < a.length; i++) p[i] = a[i] * b[i]; return fsum(p); };

  // ---- note names (vault_gaps._name, _series_key): Python's \d is any Unicode digit, so \p{Nd} here
  const stemOf = r => { const base = String(r).split("/").pop(), i = base.lastIndexOf("."); return i > 0 ? base.slice(0, i) : base; };
  const DATED = /\p{Nd}{4}-\p{Nd}{2}(-\p{Nd}{2})?/u, DATED_G = /\p{Nd}{4}-\p{Nd}{2}(-\p{Nd}{2})?/gu, SERIES_G = /[\p{Nd}\s_\-–—()]+/gu;
  // the series a dated note belongs to: what its title says before the date ("Transaction Updates 2026-05-05" ->
  // "transaction updates"; "Release Notes 2025-04-29 - Draft" -> "release notes"), else its title without dates; "" when undated
  const seriesKey = r => { const name = stemOf(r), m = name.match(DATED); if (!m) return "";
    const lead = name.slice(0, m.index).replace(SERIES_G, " ").trim().toLowerCase();
    return lead || name.replace(DATED_G, " ").replace(SERIES_G, " ").trim().toLowerCase(); };

  // ---- embeddings (vault_gaps.load_embeddings): the Smart Connections plugin's index, if it has one.
  // *.ajson files are append-only logs of `"<key>": {...},` lines (the last one wins; null = deleted). Each source's
  // embedding.default.<file>.file_i is a slot in the binary file <file>: float32 vectors of the model's dims.
  function parseAjson(text) {
    const out = new Map();
    for (const raw of String(text).split("\n")) {
      const line = raw.trim().replace(/,$/, ""); if (!line) continue;
      try { const o = JSON.parse("{" + line + "}"), k = Object.keys(o); if (k.length) out.set(k[k.length - 1], o[k[k.length - 1]]); } catch (e) { /* a torn line */ }
    }
    return out;
  }
  // files: { sources: smart_sources.ajson text, models: embedding_models.ajson text, blob(name) -> Uint8Array | null };
  // notes: the paths to keep. Returns Map path -> Float64Array (the float32 values), in the log's order.
  function embeddings(files, notes) {
    const want = notes instanceof Set ? notes : new Set(notes), vectors = new Map();
    if (!files || files.sources == null || files.models == null) return vectors;
    const dims = new Set([...parseAjson(files.models).values()].filter(m => m && m.dims).map(m => m.dims));
    if (dims.size !== 1) return vectors;   // several models: which file is whose can't be told
    const d = [...dims][0], blobs = new Map();
    for (const value of parseAjson(files.sources).values()) {
      if (!(value && want.has(value.path))) continue;
      const refs = ((value.embedding || {}).default) || {};
      for (const [file, ref] of Object.entries(refs)) {
        if (!(ref && typeof ref === "object" && "file_i" in ref) || /[\/\\]/.test(file)) continue;
        if (!blobs.has(file)) blobs.set(file, files.blob(file) || new Uint8Array(0));
        const b = blobs.get(file), at = ref.file_i * d * 4;
        if (at + d * 4 > b.length) continue;   // a slot past the end: written after the file was read
        const view = new DataView(b.buffer, b.byteOffset + at, d * 4), v = new Float64Array(d);
        for (let i = 0; i < d; i++) v[i] = view.getFloat32(i * 4, true);
        vectors.set(value.path, v);
      }
    }
    return vectors;
  }
  // each note's k nearest in meaning: [[score, path]] best first, ties by the larger path (heapq.nlargest on tuples).
  // sameName false leaves out same-name copies (the similar-notes report).
  function topNeighbours(vectors, k, sameName = true) {
    const paths = sorted(vectors.keys()), scores = new Map(paths.map(p => [p, []]));
    for (let i = 0; i < paths.length; i++) { const p = paths[i], vp = vectors.get(p), sp = scores.get(p);
      for (let j = i + 1; j < paths.length; j++) { const q = paths[j], d = dot(vp, vectors.get(q)); sp.push([d, q]); scores.get(q).push([d, p]); } }
    const low = p => stemOf(p).toLowerCase(), out = new Map();
    for (const [p, list] of scores) out.set(p, list.filter(x => sameName || low(x[1]) !== low(p)).sort((a, b) => b[0] - a[0] || pyCmp(b[1], a[1])).slice(0, k));
    return out;
  }

  // ---- the graph topics are found in (vault_gaps.cohesion_graph): links, plus weaker ties links miss: consecutive
  // notes of a dated series, mutual nearest-in-meaning notes, and each note's two closest notes in the same folder
  const SERIES_W = 1.0, SEMANTIC_W = 0.45, FOLDER_W = 0.3, FOLDER_MAX = 60, SEMANTIC_TOP_K = 5;
  function cohesionGraph(graph, knowledge, vectors) {
    const g = new Map(), row = a => { if (!g.has(a)) g.set(a, new Map()); return g.get(a); };
    for (const [r, nbrs] of Object.entries(graph)) for (const [t, w] of Object.entries(nbrs)) { const m = row(r); m.set(t, (m.get(t) || 0) + w); }
    const tie = (a, b, w) => { if (a === b) return; const ma = row(a), mb = row(b); ma.set(b, (ma.get(b) || 0) + w); mb.set(a, (mb.get(a) || 0) + w); };
    const series = new Map();
    for (const r of knowledge) { const key = seriesKey(r); if (key) { if (!series.has(key)) series.set(key, []); series.get(key).push([stemOf(r).match(DATED)[0], r]); } }
    for (const members of series.values()) if (members.length >= 2) {
      members.sort((a, b) => pyCmp(a[0], b[0]) || pyCmp(a[1], b[1]));
      for (let i = 1; i < members.length; i++) tie(members[i - 1][1], members[i][1], SERIES_W);
    }
    if (vectors && vectors.size) {
      const top = topNeighbours(vectors, SEMANTIC_TOP_K);
      for (const [p, near] of top) for (const [, q] of near) if (pyCmp(p, q) < 0 && (top.get(q) || []).some(([, q2]) => q2 === p)) tie(p, q, SEMANTIC_W);
      const folders = new Map();
      for (const r of vectors.keys()) if (r.split("/").slice(1).join("/").includes("/")) { const f = r.slice(0, r.lastIndexOf("/")); if (!folders.has(f)) folders.set(f, []); folders.get(f).push(r); }
      for (const ms of folders.values()) {
        if (ms.length < 3 || ms.length > FOLDER_MAX) continue;
        const inF = new Set(ms);
        for (const p of ms) {
          const near = top.get(p) || [];
          near.filter(([, q]) => inF.has(q)).sort((a, b) => b[0] - a[0] || pyCmp(b[1], a[1])).slice(0, 2).forEach(([, q]) => tie(p, q, FOLDER_W));
          if (!near.some(([, q]) => inF.has(q))) {   // nothing close enough: its nearest folder-mate
            let best = null, bd = -Infinity;
            for (const q of ms) { if (q === p) continue; const d = dot(vectors.get(p), vectors.get(q)); if (d > bd) { best = q; bd = d; } }
            tie(p, best, FOLDER_W);
          }
        }
      }
    }
    const out = {};
    for (const r of sorted(g.keys())) { const nb = g.get(r); if (!nb.size) continue; out[r] = {}; for (const t of sorted(nb.keys())) out[r][t] = nb.get(t); }
    return out;
  }

  // ---- the notes topics are found among, and their links (vault_gaps.load_vault, the topic part)
  // notes: [{ path, tags }] (tags as frontmatterTags gives them); links: { path: [resolved .md targets] };
  // o: { kind(path, tags) (VGRules.noteKind), isHub(path, tags), joinsWhenLinked(path, tags) } from this vault's rules.
  // Not daily notes, skipped folders, people or hubs; an inbox note joins once a topic note links to it; catch-all
  // task lists (30+ links, half of them to notes that link nowhere else) are dropped like hubs.
  // -> { knowledge: [paths], hubs: [paths], graph: {path: {path: links}} (linked notes only, in order) }
  const CATCHALL_MIN_LINKS = 30;
  function topicGraph(notes, links, o) {
    const tagsOf = new Map(notes.map(n => [n.path, n.tags || []]));
    const knowledge = new Set(), hubs = new Set();
    for (const { path } of notes) {
      const kind = o.kind(path, tagsOf.get(path));
      if (kind === "note") knowledge.add(path); else if (kind === "hub") hubs.add(path);
    }
    for (const r of [...knowledge]) for (const t of links[r] || []) {
      if (knowledge.has(t) || !tagsOf.has(t)) continue;
      const tags = tagsOf.get(t);
      if (o.joinsWhenLinked(t, tags) && !o.isHub(t, tags)) knowledge.add(t);
    }
    const adj = new Map([...knowledge].map(r => [r, new Map()]));
    for (const { path: r } of notes) {
      if (!knowledge.has(r)) continue;
      for (const t of new Set(links[r] || [])) if (knowledge.has(t) && t !== r) { bump(adj.get(r), t); bump(adj.get(t), r); }
    }
    const catchalls = [...knowledge].filter(r => adj.get(r).size >= CATCHALL_MIN_LINKS && [...adj.get(r).keys()].filter(t => adj.get(t).size === 1).length >= 0.5 * adj.get(r).size);
    for (const r of catchalls) { for (const t of adj.get(r).keys()) adj.get(t).delete(r); adj.delete(r); knowledge.delete(r); hubs.add(r); }
    const linked = sorted([...knowledge].filter(r => adj.get(r).size)), graph = {};
    const inLinked = new Set(linked);
    for (const r of linked) { graph[r] = {}; for (const t of sorted(adj.get(r).keys())) if (inLinked.has(t)) graph[r][t] = adj.get(r).get(t); }
    return { knowledge: sorted(knowledge), hubs: sorted(hubs), graph };
  }
  // notes linked to but never written (vault_graph.link_health): unresolved: { path: { target: links } } (Obsidian's
  // unresolvedLinks); notes: the topic notes. Ranked by how many topic notes link each, the 40 most linked.
  const ATTACHMENT = /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp4|mov|mp3|csv|xlsx?|docx?|pptx?|zip|canvas|excalidraw)$/i;
  const PLACEHOLDER = /^(resource|link|note|page|item|example|placeholder)\s*\d*$|['",]/i, FILENAME_BAD = /[\\/:*?"<>|#^[\]]/;
  function wantedNotes(unresolved, notes, max = 40) {
    const inNotes = new Set(notes), refs = new Map(), spell = new Map();
    for (const [src, targets] of Object.entries(unresolved || {})) {
      if (!inNotes.has(src)) continue;
      for (const raw of Object.keys(targets)) {
        const name = raw.replace(/\\$/, "").split("/").pop().trim(), k = name.toLowerCase();
        if (!(name.length > 2 && name.length < 120) || PLACEHOLDER.test(name) || ATTACHMENT.test(name)) continue;
        if (!refs.has(k)) { refs.set(k, new Set()); spell.set(k, new Map()); }
        refs.get(k).add(src); bump(spell.get(k), name);
      }
    }
    return [...refs].sort((a, b) => b[1].size - a[1].size || pyCmp(a[0], b[0])).slice(0, max).map(([k, rs]) => {
      const name = mostCommon(spell.get(k));
      return { id: `wanted:${k}`, name, refs: sorted(rs), creatable: !FILENAME_BAD.test(name) };
    });
  }
  // a note's topic tags from its frontmatter, as the analysis reads them: lower case, without periodic ones
  const frontmatterTags = fm => { let t = fm && typeof fm === "object" ? fm.tags : null; if (typeof t === "string") t = [t]; if (!Array.isArray(t)) return [];
    return [...new Set(t.filter(x => x).map(x => String(x).trim().toLowerCase()).filter(x => !x.endsWith("/standup") && x !== "daily"))]; };

  // ---- topic names (vault_gaps._cluster_names, _readable_names, _stacks, _label, stable_cluster_ids)
  // Python counts characters by code point (slices, len); these helpers do the same
  const cps = t => Array.from(String(t)), cpLen = t => cps(t).length, cpSlice = (t, a, b) => cps(t).slice(a, b).join("");
  const isUpperIn = t => /\p{Lu}/u.test(t);
  const capitalize = t => { const c = cps(t); return c.length ? c[0].toUpperCase() + c.slice(1).join("").toLowerCase() : ""; };
  const titleCase = t => { let out = "", prev = false; for (const ch of cps(t)) { const cased = ch.toLowerCase() !== ch.toUpperCase(); out += cased ? (prev ? ch.toLowerCase() : ch.toUpperCase()) : ch; prev = cased; } return out; };   // str.title()
  const stripChars = (t, set) => { const c = cps(t); let a = 0, b = c.length; while (a < b && set.includes(c[a])) a++; while (b > a && set.includes(c[b - 1])) b--; return c.slice(a, b).join(""); };
  // Counter.most_common(1)[0][0]: the highest count, the first counted on a tie
  const mostCommon = m => { let best = null, bn = -Infinity; for (const [k, n] of m) if (n > bn) { best = k; bn = n; } return best; };
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  const wordStem = w => (w.length > 4 ? w.toLowerCase().replace(/s+$/, "") : w.toLowerCase());
  const TITLE_STOP = new Set(("the and for with from into how to of in on a an vs via notes note context overview guide process documentation draft new old final complete part pages page md readme " +
    "fix address investigate create update updates issue issues add bug").split(" "));
  const TEXT_STOP = new Set([...TITLE_STOP, ...(`this that these those there their them they then than when where which while what who will would should could can cannot not are was were been being have has had does did doing done also just only
    very more most some such each other into onto over under after before about above below between through during all any both few many much own same your you our its it's we he she his her him use used using uses make made
    one two three first second next last need needs needed get gets got set sets via per out off yes no now see like well back way new add added adding remove removed check checked work worked working run runs running
    file files table column value values data type name names list item items step steps note notes page link links section example time date today yesterday tomorrow week status todo task tasks http https www com`).split(/\s+/)]);
  const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/, WORD = /[A-Za-z][A-Za-z0-9]{2,}/g;
  // a note body's content words, in the order they appear (no frontmatter, code, links or URLs; the first 6000 characters)
  function noteWords(text) {
    const body = cpSlice(String(text).replace(FRONTMATTER, ""), 0, 6000).replace(/```[\s\S]*?```|`[^`]*`|\[\[[^\]]*\]\]|\]\([^)]*\)|https?:\/\/\S+/g, " ");
    return [...new Set((body.match(WORD) || []).filter(w => !TEXT_STOP.has(w.toLowerCase())))];
  }
  // 2-3 words per topic, frequent in its notes and rare in the others' (tf-idf): title words weigh 3, a body word
  // counts when it's in several of the topic's notes (2+ and 15%+). Shown in the notes' own spelling (EC2, RTI, Odoo).
  function topicWords(clusters, raw) {
    const spelling = new Map(), words = [];
    const spell = (st, tok) => { if (!spelling.has(st)) spelling.set(st, new Map()); bump(spelling.get(st), tok); };
    for (const m of clusters) {
      const titleC = new Map(), bodyC = new Map();
      for (const r of m) {
        const title = [...new Set((stemOf(r).match(WORD) || []).filter(t => !TITLE_STOP.has(wordStem(t))))];
        const body = (raw && raw[r] != null ? noteWords(raw[r]) : []).filter(t => !TEXT_STOP.has(wordStem(t)) && !TEXT_STOP.has(t.toLowerCase()));
        for (const t of title) { bump(titleC, wordStem(t)); spell(wordStem(t), t); }
        for (const st of new Set(body.map(wordStem))) bump(bodyC, st);
        for (const t of body) spell(wordStem(t), t);
      }
      const floor = Math.max(2, 0.15 * m.length), c = new Map([...titleC].map(([w, n]) => [w, 3 * n]));
      for (const [w, n] of bodyC) if (n >= floor) bump(c, w, n);
      words.push(c);
    }
    const df = new Map(); words.forEach(c => c.forEach((_, w) => bump(df, w)));
    return words.map(c => {
      const score = w => -(c.get(w) * Math.log((1 + words.length) / df.get(w)));
      const shown = [...c.keys()].sort((a, b) => score(a) - score(b) || pyCmp(a, b)).slice(0, 3).map(w => mostCommon(spelling.get(w)));
      return shown.map(t => (isUpperIn(t) ? t : capitalize(t))).join(" · ") || "(untitled)";
    });
  }
  const NAME_LEAD = /^(?:[^\p{L}\p{N}_]|\p{Nd}|_)+/u, PHRASE_STOP = new Set("the and for with from into how to of in on a an vs via md readme context draft final copy".split(" "));
  // a title as a phrase source: no dates, brackets, "- Context", leading numbering; dashes inside words become spaces
  // "... Part VI - The Greatest Generation": one part of a whole; the whole's name is what comes before (vault_gaps.PART_RE)
  const PART = /\s+(?:Part|Pt\.?)\s+(?:[IVXL]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$/i;
  const cleanTitle = r => {
    let t = stemOf(r).replace(PART, "").replace(DATED_G, " ").replace(/\(.*?\)|\s-\s*Context$|\s+Context$/g, " ").replace(/(?<=[\p{L}\p{N}_])[-_](?=[\p{L}\p{N}_])/gu, " ");
    return stripChars(t.replace(NAME_LEAD, "").replace(/\s+/g, " "), [" ", "-", "—", "_", "·", ","]);
  };
  // names people would give: the phrase most of a topic's titles share, else its most central note's title; two
  // topics never share a name (the second gets its top keyword added)
  function readableNames(clusters, keywords, core) {
    const gramsOf = clusters.map(m => {
      const g = new Map();
      for (const r of m) {
        const toks = cleanTitle(r).match(/[A-Za-z][A-Za-z0-9&+.]*/g) || [], seen = new Set();
        for (const n of [3, 2, 1]) for (let i = 0; i + n <= toks.length; i++) {
          const ph = toks.slice(i, i + n);
          if (PHRASE_STOP.has(ph[0].toLowerCase()) || PHRASE_STOP.has(ph[n - 1].toLowerCase()) || (n === 1 && (ph[0].length < 3 || TITLE_STOP.has(wordStem(ph[0]))))) continue;
          const key = ph.map(wordStem).join(" ");
          if (!seen.has(key)) { seen.add(key); if (!g.has(key)) g.set(key, new Map()); bump(g.get(key), ph.join(" ")); }
        }
      }
      return g;
    });
    const total = sp => [...sp.values()].reduce((a, b) => a + b, 0), df = new Map();
    gramsOf.forEach(g => g.forEach((sp, k) => { if (total(sp) >= 2) bump(df, k); }));
    const names = clusters.map((m, ci) => {
      const g = gramsOf[ci], kw = keywords[ci], cr = core[ci];
      let best = null, bs = 0;
      for (const [key, sp] of g) {
        const cov = total(sp) / m.length;
        if (total(sp) < 2 || cov < 0.25) continue;
        const score = cov * (1 + 0.35 * (key.split(" ").length - 1)) / (1 + 0.5 * Math.max(0, (df.get(key) || 0) - 1));   // longer and distinctive wins
        if (score > bs) { best = mostCommon(sp); bs = score; }
      }
      let name;
      if (best) {
        name = isUpperIn(best) ? best : titleCase(best);
        if (!name.includes(" ")) { const extra = kw.split(" · ").find(w => wordStem(w) !== wordStem(name) && !name.toLowerCase().includes(w.toLowerCase())); if (extra) name = `${name} · ${extra}`; }
      } else {
        name = cr.length ? cleanTitle(cr[0]) : kw.split(" · ")[0];
        if (cpLen(name) > 34) { const cut = cpSlice(name, 0, 33), i = cut.lastIndexOf(" "); name = (i >= 0 ? cut.slice(0, i) : cut) + "…"; }
      }
      return name || kw;
    });
    const taken = new Map();
    names.forEach((n, i) => { bump(taken, n.toLowerCase()); if (taken.get(n.toLowerCase()) > 1) { const extra = keywords[i].split(" · ").find(w => !n.toLowerCase().includes(w.toLowerCase())); names[i] = `${n} · ${extra != null ? extra : String(i)}`; } });
    return names;
  }
  // a topic's stack: the technology (else project) tag most of its notes carry and few other topics do
  const STACK_SKIP = new Set("api backend frontend automation programming refactor upgrade stack server storage memory hardware database kiosk stack excalidraw clickup git github".split(" "));
  const STACK_WORDS = { aws: "AWS", ses: "SES", ec2: "EC2", rds: "RDS", s3: "S3", iam: "IAM", sns: "SNS", sql: "SQL", ssl: "SSL", ssh: "SSH", vpn: "VPN", voip: "VoIP", "ci-cd": "CI/CD",
    rti: "RTI", cvr: "CVR", odoo: "Odoo", nextjs: "Next.js", mysql: "MySQL", postgres: "Postgres", "github-actions": "GitHub Actions", "us-cellular": "US Cellular", "t-mobile": "T-Mobile",
    "google-maps": "Google Maps", cloudwatch: "CloudWatch", cloudtrail: "CloudTrail", javascript: "JavaScript", "rti-console": "RTI Console" };
  const STACK_PLATFORMS = new Set(["project/odoo", "project/cvr", "project/resgrid"]), STACK_MIN_SHARE = { "technology/": 0.2, "project/": 0.3 };
  const stackName = tag => { const parts = tag.split("/").slice(1);
    if (parts[0] === "aws" && parts.length > 1) return "AWS " + (STACK_WORDS[parts[1]] || parts[1].toUpperCase());
    const w = parts[parts.length - 1]; return STACK_WORDS[w] || w.split("-").map(x => STACK_WORDS[x] || capitalize(x)).join(" "); };
  function stacks(clusters, tags) {
    const kind = t => (t.startsWith("technology/") || STACK_PLATFORMS.has(t) ? "technology/" : "project/");
    const share = clusters.map(m => { const c = new Map();
      for (const r of m) for (const t of tags[r] || []) if ((t.startsWith("technology/") || t.startsWith("project/")) && !STACK_SKIP.has(t.split("/").pop())) bump(c, t);
      return new Map([...c].map(([t, n]) => [t, n / m.length])); });
    const df = new Map(); share.forEach(sh => sh.forEach((v, t) => { if (v >= STACK_MIN_SHARE[kind(t)]) bump(df, t); }));
    return share.map(sh => {
      const best = [...sh].filter(([t, v]) => v >= STACK_MIN_SHARE[kind(t)] && (kind(t) === "technology/" || df.get(t) <= 3))
        .map(([t, v]) => [v + (kind(t) === "technology/" ? 0.25 : 0) + 0.1 * (t.split("/").length - 2), t]).sort((a, b) => b[0] - a[0] || pyCmp(b[1], a[1]));
      return best.length ? stackName(best[0][1]) : "";
    });
  }
  const withStack = (name, stack) => (!stack || stack.split(" ").some(w => cpLen(w) > 2 && name.toLowerCase().includes(w.toLowerCase())) ? name : `${stack} · ${name}`);
  // a topic's most central notes (most links inside it), its main folder and its commonest tags (ties: by name)
  function label(members, adj, tags) {
    const inside = new Set(members), deg = new Map(members.map(r => [r, Object.entries(adj[r] || {}).reduce((s, [t, w]) => s + (inside.has(t) ? w : 0), 0)]));
    const folders = new Map(); members.forEach(r => bump(folders, (r.match(/\//g) || []).length >= 2 ? r.split("/").slice(0, 2).join("/") : r.split("/")[0]));
    const tc = new Map(); members.forEach(r => (tags[r] || []).forEach(t => bump(tc, t)));
    return { core: [...members].sort((a, b) => deg.get(b) - deg.get(a) || pyCmp(a, b)).slice(0, 4), folder: mostCommon(folders),
      tags: [...tc].sort((a, b) => b[1] - a[1] || pyCmp(a[0], b[0])).slice(0, 3).map(([t]) => t) };
  }
  // the topics: notes grouped by community, topics of fewer than minSize left out, each topic's notes in order and
  // the biggest topic first (vault_gaps.analyze)
  function topicsOf(comm, minSize = 3) {
    const by = new Map(); for (const [r, c] of Object.entries(comm)) { if (!by.has(c)) by.set(c, []); by.get(c).push(r); }
    return [...by.values()].filter(m => m.length >= minSize).map(m => sorted(m)).sort((a, b) => b.length - a.length || pyCmp(a[0], b[0]));
  }
  // keep each topic's id (and colour) across runs: match it to last run's topic with the most overlap (Jaccard 0.3+);
  // new topics get the smallest free ids, biggest first. prev: { id: [members] } from the last run.
  function stableIds(clusters, prev) {
    const sets = clusters.map(m => new Set(m)), pairs = [];
    sets.forEach((s, i) => Object.entries(prev || {}).forEach(([pid, pm]) => { const ps = new Set(pm); let both = 0; s.forEach(x => { if (ps.has(x)) both++; });
      pairs.push([both / (s.size + ps.size - both), i, Number(pid)]); }));
    pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
    const out = clusters.map(() => null), taken = new Set();
    for (const [score, i, pid] of pairs) { if (score < 0.3) break; if (out[i] === null && !taken.has(pid)) { out[i] = pid; taken.add(pid); } }
    let next = 0; const free = () => { while (taken.has(next)) next++; return next++; };
    return out.map(o => (o !== null ? o : free()));
  }

  return { pyCmp, pyRandom, louvain, absorbSmall, betweenness, fsum, dot, stemOf, seriesKey, parseAjson, embeddings, topNeighbours, cohesionGraph,
    noteWords, topicWords, topicsOf, topicGraph, frontmatterTags, wantedNotes, cleanTitle, readableNames, stacks, withStack, label, stableIds, titleCase };
})();
