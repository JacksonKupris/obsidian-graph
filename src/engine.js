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

  return { pyCmp, pyRandom, louvain, absorbSmall, betweenness };
})();
