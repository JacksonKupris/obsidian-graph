// science.js - the real methods behind the science views and lenses, with nothing about Obsidian or the screen in them, so each
// can be checked against the textbook result (tests/test_science.js). A view or lens computes here and only draws what it gets.
//   Survival: Kaplan & Meier 1958, Greenwood 1926, Mantel 1966. Spreading: Kermack & McKendrick 1927, on a network as bond
//   percolation (Newman 2002). Robustness: Tarjan 1972, Molloy & Reed 1995, Newman & Ziff 2000, Schneider et al. 2011.
//   Neurons: Lapicque's leaky integrate-and-fire, with Brunel's balanced 80/20 network (2000).
//   Guide search: Cas9's targeting (Jinek et al. 2012) and its off-targets by mismatch count (Hsu et al. 2013).
const VGScienceMake = () => {
  // ---- random numbers that repeat: the same vault gives the same answer
  function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // ---- a graph as arrays: edges are undirected pairs of names; repeats and self-links are dropped
  function graphOf(ids, pairs) {
    const at = new Map(ids.map((id, i) => [id, i])), adj = ids.map(() => []), seen = new Set(), edges = [];
    for (const [a, b] of pairs) { const i = at.get(a), j = at.get(b); if (i == null || j == null || i === j) continue; const key = i < j ? `${i}|${j}` : `${j}|${i}`; if (seen.has(key)) continue; seen.add(key); adj[i].push(j); adj[j].push(i); edges.push([i, j]); }
    return { ids, at, adj, edges, n: ids.length };
  }
  // ---- how degrees are distributed, which sets both the epidemic threshold and how a network breaks
  function moments(g) { const n = g.n || 1; let k1 = 0, k2 = 0; for (const a of g.adj) { k1 += a.length; k2 += a.length * a.length; } return { k1: k1 / n, k2: k2 / n }; }
  // the largest eigenvalue of the adjacency matrix, by power iteration; on A+I, so a two-sided graph converges too
  function spectralRadius(g, steps = 200) {
    if (!g.n) return 0; let v = new Float64Array(g.n).fill(1 / Math.sqrt(g.n)), l = 0;
    for (let s = 0; s < steps; s++) { const w = new Float64Array(g.n); for (let i = 0; i < g.n; i++) { w[i] = v[i]; for (const j of g.adj[i]) w[i] += v[j]; }
      const norm = Math.hypot(...(g.n < 5000 ? w : w.slice(0, 5000))) || 1; let dot = 0; for (let i = 0; i < g.n; i++) dot += w[i] * v[i]; for (let i = 0; i < g.n; i++) w[i] /= norm; const next = dot - 1; v = w; if (Math.abs(next - l) < 1e-9 && s > 5) { l = next; break; } l = next; }
    return Math.max(0, l);
  }
  // ---- spreading (SIR). An SIR outbreak's final size is the same as keeping each link with probability T and taking what the
  // seed can then reach (Newman 2002), so one run is one breadth-first walk. gen[i]: which generation first reached a note.
  function outbreak(g, seed, T, rand) {
    const gen = new Int32Array(g.n).fill(-1); gen[seed] = 0; let frontier = [seed], size = 1, g0 = 0;
    while (frontier.length) { g0++; const next = []; for (const i of frontier) for (const j of g.adj[i]) if (gen[j] < 0 && rand() < T) { gen[j] = g0; next.push(j); size++; } frontier = next; }
    return { size, gen };
  }
  // many runs from one seed: mean and spread of the size, and each note's chance of being reached
  function outbreakStats(g, seed, T, runs = 300, s = 7) {
    const rand = rng(s + seed * 31), hit = new Float64Array(g.n), sizes = []; let genSum = new Float64Array(g.n);
    for (let r = 0; r < runs; r++) { const o = outbreak(g, seed, T, rand); sizes.push(o.size); for (let i = 0; i < g.n; i++) if (o.gen[i] >= 0) { hit[i]++; genSum[i] += o.gen[i]; } }
    sizes.sort((a, b) => a - b);
    return { mean: sizes.reduce((x, y) => x + y, 0) / runs, p50: sizes[runs >> 1], p90: sizes[Math.floor(runs * 0.9)], max: sizes[runs - 1], hit: Array.from(hit, h => h / runs), gen: Array.from(genSum, (x, i) => (hit[i] ? x / hit[i] : -1)) };
  }
  // Newman's threshold for an uncorrelated network: R0 = T(<k^2>-<k>)/<k>, a large outbreak possible once R0 > 1. Real graphs
  // cluster, so the mean-field 1/lambda1 is given beside it.
  function epidemic(g) { const { k1, k2 } = moments(g); let excess = k1 ? (k2 - k1) / k1 : 0; if (g.directed) { const inn = new Float64Array(g.n); for (const x of g.adj) for (const j of x) inn[j]++; let sum = 0, m = 0; g.adj.forEach((x, i) => { sum += inn[i] * x.length; m += x.length; }); excess = m ? sum / m : 0; }   // one way, what matters is what leaves a note a mistake just reached (Newman 2002)
    const l = spectralRadius(g); return { k1, k2, excess, Tc: excess ? Math.min(1, 1 / excess) : 1, lambda1: l, TcSpectral: l ? Math.min(1, 1 / l) : 1, R0: T => T * excess }; }
  // final size against T, from random seeds: the phase transition
  function sweep(g, Ts, runs = 120, s = 11) { const rand = rng(s); return Ts.map(T => { let sum = 0, big = 0; const need = Math.max(3, g.n * 0.1); for (let r = 0; r < runs; r++) { const size = outbreak(g, Math.floor(rand() * g.n), T, rand).size; sum += size; if (size >= need) big++; } return { T, mean: sum / runs / (g.n || 1), pBig: big / runs }; }); }

  // ---- survival. rows: { t: days followed, event: true when it happened, false when still open (censored) }.
  function kaplanMeier(rows) {
    const list = rows.filter(r => r.t >= 0).slice().sort((a, b) => a.t - b.t), steps = [{ t: 0, s: 1, lo: 1, hi: 1, atRisk: list.length, events: 0, censored: 0 }]; let s = 1, v = 0, i = 0, atRisk = list.length;
    while (i < list.length) {
      const t = list[i].t; let d = 0, c = 0;
      while (i < list.length && list[i].t === t) { if (list[i].event) d++; else c++; i++; }
      if (d) { s *= 1 - d / atRisk; if (atRisk > d) v += d / (atRisk * (atRisk - d)); }
      // Kalbfleisch and Prentice's log-log interval: it stays inside 0 to 1
      let lo = s, hi = s; if (s > 0 && s < 1) { const se = Math.sqrt(v) / Math.abs(Math.log(s)); lo = Math.pow(s, Math.exp(1.96 * se)); hi = Math.pow(s, Math.exp(-1.96 * se)); }
      if (d || c) steps.push({ t, s, lo, hi, atRisk, events: d, censored: c });
      atRisk -= d + c;
    }
    return { steps, n: list.length, events: list.filter(r => r.event).length };
  }
  const survivalAt = (km, t) => { let s = 1; for (const x of km.steps) { if (x.t > t) break; s = x.s; } return s; };
  // first time the curve is at or under a half: null when it never gets there, which is itself the finding
  const medianOf = (km, p = 0.5) => { const x = km.steps.find(y => y.s <= p); return x ? x.t : null; };
  // of what's still open at t, the share done within w more days: S(t+w)/S(t)
  const conditional = (km, t, w) => { const a = survivalAt(km, t); return a > 0 ? 1 - survivalAt(km, t + w) / a : 0; };
  // restricted mean: the area under the curve up to tau, the expected days open within that time
  function restrictedMean(km, tau) { let area = 0, prev = 0, s = 1; for (const x of km.steps) { if (x.t >= tau) break; area += s * (x.t - prev); prev = x.t; s = x.s; } return area + s * (tau - prev); }
  // the complementary error function (Numerical Recipes' Chebyshev fit), for the chi-square tail with one degree of freedom
  function erfc(x) { const z = Math.abs(x), t = 1 / (1 + 0.5 * z), r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; }
  // Mantel's log-rank test: do two groups' curves differ by more than chance? p is the chi-square tail with one degree of freedom
  function logRank(a, b) {
    const times = [...new Set([...a, ...b].filter(r => r.event).map(r => r.t))].sort((x, y) => x - y); let oa = 0, ea = 0, v = 0;
    for (const t of times) {
      const na = a.filter(r => r.t >= t).length, nb = b.filter(r => r.t >= t).length, da = a.filter(r => r.t === t && r.event).length, db = b.filter(r => r.t === t && r.event).length, n = na + nb, d = da + db;
      if (n < 1) continue; oa += da; ea += d * na / n; if (n > 1) v += d * (na / n) * (nb / n) * (n - d) / (n - 1);
    }
    const chi2 = v > 0 ? (oa - ea) * (oa - ea) / v : 0; return { chi2, p: v > 0 ? erfc(Math.sqrt(chi2 / 2)) : 1, observed: oa, expected: ea };
  }
  // The rows for a task's life, from journals [{ date, tasks: [{ mark, text }] }]. The same words in later journals are the same
  // task, first written on the earliest. Done with a date is an event; still open is censored at today. Done with no date, or
  // cancelled, has no known end, and is counted, not guessed at.
  function taskLives(journals, today) {
    const DONE = /✅\s*(\d{4}-\d{2}-\d{2})/, clean = t => String(t).replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "").replace(/\[[^\]]*::[^\]]*\]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
    const days = (a, b) => Math.round((VGShared.utcNoon(b) - VGShared.utcNoon(a)) / VGShared.DAY_MS), by = new Map();
    for (const j of journals || []) for (const t of j.tasks || []) { const key = clean(t.text); if (!key) continue; const m = String(t.text).match(DONE), mark = String(t.mark || " ").toLowerCase(); let e = by.get(key); if (!e) by.set(key, e = { text: String(t.text), born: j.date, done: null, open: false, undated: false, cancelled: false, path: j.path, line: t.line });
      if (j.date < e.born) { e.born = j.date; e.path = j.path; e.line = t.line; } if (mark === "x") { if (m && (!e.done || m[1] < e.done)) e.done = m[1]; else if (!m) e.undated = true; } else if (mark === " ") e.open = true; else if (mark === "-") e.cancelled = true; }
    const rows = [], skipped = { undated: 0, cancelled: 0 };
    for (const e of by.values()) {
      if (e.done && e.done >= e.born) rows.push({ ...e, t: days(e.born, e.done), event: true });
      else if (e.open) rows.push({ ...e, t: days(e.born, today), event: false });
      else if (e.cancelled) skipped.cancelled++; else if (e.undated) skipped.undated++;
    }
    return { rows, skipped };
  }

  // ---- robustness
  const components = (g, gone) => { const seen = new Uint8Array(g.n), sizes = []; for (let s = 0; s < g.n; s++) { if (seen[s] || (gone && gone.has(s))) continue; let size = 0; const q = [s]; seen[s] = 1; while (q.length) { const i = q.pop(); size++; for (const j of g.adj[i]) if (!seen[j] && !(gone && gone.has(j))) { seen[j] = 1; q.push(j); } } sizes.push(size); } return sizes.sort((a, b) => b - a); };
  // Tarjan: cut vertices and bridges, iterative so a long chain can't overflow the stack. Bridges as [i, j].
  function cutPoints(g) {
    const disc = new Int32Array(g.n).fill(-1), low = new Int32Array(g.n), cut = new Uint8Array(g.n), bridges = []; let time = 0;
    for (let root = 0; root < g.n; root++) { if (disc[root] >= 0) continue; let kids = 0; const stack = [[root, -1, 0]]; disc[root] = low[root] = time++;
      while (stack.length) { const top = stack[stack.length - 1], [u, parent] = top;
        if (top[2] < g.adj[u].length) { const v = g.adj[u][top[2]++]; if (v === parent) continue; if (disc[v] >= 0) { low[u] = Math.min(low[u], disc[v]); continue; } disc[v] = low[v] = time++; if (u === root) kids++; stack.push([v, u, 0]); }
        else { stack.pop(); if (parent >= 0) { low[parent] = Math.min(low[parent], low[u]); if (parent !== root && low[u] >= disc[parent]) cut[parent] = 1; if (low[u] > disc[parent]) bridges.push([parent, u]); } } }
      if (kids > 1) cut[root] = 1; }
    return { cut: [...cut.keys()].filter(i => cut[i]), bridges };
  }
  // what removing each cut vertex does: the notes it strands from the biggest connected part
  function cutDamage(g, list) { const base = components(g)[0] || 0; return list.map(i => { const sizes = components(g, new Set([i])); return { i, stranded: base - 1 - (sizes[0] || 0), parts: sizes.length }; }).sort((a, b) => b.stranded - a.stranded); }
  // The largest connected part as notes are removed one by one, by Newman and Ziff's method: put them back in reverse with a
  // union-find, which is the whole curve in one pass. order: removal order. Returns S[q] at q = 0..n, as a share of n.
  function percolationCurve(g, order) {
    const parent = new Int32Array(g.n).fill(-1), size = new Int32Array(g.n), on = new Uint8Array(g.n), S = new Float64Array(g.n + 1); let big = 0;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let q = g.n; q > 0; q--) { const i = order[q - 1]; parent[i] = i; size[i] = 1; on[i] = 1; for (const j of g.adj[i]) if (on[j]) { const a = find(i), b = find(j); if (a !== b) { if (size[a] < size[b]) { parent[a] = b; size[b] += size[a]; } else { parent[b] = a; size[a] += size[b]; } } } big = Math.max(big, size[find(i)]); S[q - 1] = big / (g.n || 1); }
    S[g.n] = 0; return S;
  }
  function randomOrder(n, rand) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // the attack: always the note with the most remaining links, recomputed after each removal
  function attackOrder(g) { const deg = g.adj.map(a => a.length), gone = new Uint8Array(g.n), order = []; for (let q = 0; q < g.n; q++) { let best = -1; for (let i = 0; i < g.n; i++) if (!gone[i] && (best < 0 || deg[i] > deg[best])) best = i; gone[best] = 1; order.push(best); for (const j of g.adj[best]) if (!gone[j]) deg[j]--; } return order; }
  // Schneider's R: the area under the curve, 0 to 0.5. One number for how well the network holds.
  const robustnessR = S => { const n = S.length - 1; if (n < 1) return 0; let sum = 0; for (let q = 1; q <= n; q++) sum += S[q]; return sum / n; };
  function robustness(g, runs = 30, s = 3) {
    const rand = rng(s), n = g.n, mean = new Float64Array(n + 1); for (let r = 0; r < runs; r++) { const c = percolationCurve(g, randomOrder(n, rand)); for (let q = 0; q <= n; q++) mean[q] += c[q] / runs; }
    const attack = percolationCurve(g, attackOrder(g)), { k1, k2 } = moments(g), kappa = k1 ? k2 / k1 : 0;
    return { random: Array.from(mean), attack: Array.from(attack), Rrandom: robustnessR(mean), Rattack: robustnessR(attack), kappa, fc: kappa > 1 ? Math.max(0, 1 - 1 / (kappa - 1)) : 0, holds: kappa > 2 };   // Molloy-Reed: a giant part exists while kappa > 2
  }
  // how concentrated a share is: Herfindahl's index and its effective number (1/HHI), the usual measure of a market or a bus factor
  function concentration(values) { const t = values.reduce((x, y) => x + y, 0); if (!t) return { hhi: 0, effective: 0, top: 0 }; let h = 0, top = 0; for (const v of values) { const p = v / t; h += p * p; top = Math.max(top, p); } return { hhi: h, effective: 1 / h, top }; }
  // the fewest notes, taken busiest first, that split a part so no piece keeps half of it: a topic's bus factor
  function busFactor(g) { const order = attackOrder(g), S = percolationCurve(g, order); if (!g.n) return 0; for (let q = 1; q <= g.n; q++) if (S[q] < 0.5) return q; return g.n; }

  // ---- neurons: leaky integrate-and-fire. tau dV/dt = -(V - rest) + R*I, with a spike at threshold, a reset and a refractory
  // period. Real units: millivolts and milliseconds. Between spikes V relaxes exactly, not by small Euler steps. 80% of cells
  // excite and 20% inhibit (Dale's principle), inhibition stronger, which keeps the network firing irregularly at low rates
  // (Brunel 2000) instead of locking into a seizure. A spike reaches its targets after the time the axon takes to carry it.
  const LIF = { rest: -70, threshold: -55, reset: -75, tau: 20, refractory: 2, epsp: 1.4, ipsp: -5.6 };
  // the textbook rate for a steady input: 1/(t_ref + tau*ln((V_inf - reset)/(V_inf - threshold))), in hertz
  const lifRate = (driveMv, P = LIF) => { const inf = P.rest + driveMv; return inf <= P.threshold ? 0 : 1000 / (P.refractory + P.tau * Math.log((inf - P.reset) / (inf - P.threshold))); };
  function lifNetwork(g, o = {}) {
    const P = { ...LIF, ...(o.params || {}) }, n = g.n, rand = rng(o.seed || 5), V = new Float64Array(n).fill(P.rest), until = new Float64Array(n), drive = new Float64Array(n), inhib = new Uint8Array(n), count = new Float64Array(n), delayOf = o.delay || (() => 3), queue = [];
    for (let i = 0; i < n; i++) { V[i] = P.rest + rand() * (P.threshold - P.rest) * 0.9; if (o.inhibitory !== 0 && rand() < (o.inhibitory == null ? 0.2 : o.inhibitory)) inhib[i] = 1; }
    let t = 0, spikes = 0;
    return { P, V, inhib, count, time: () => t, total: () => spikes,
      setDrive(i, mv) { drive[i] = mv; },
      // dt in simulated ms. Returns the spikes of this step: [{ i, j, t, arrive, inhib }], one per outgoing connection
      step(dt, poisson) {
        const out = [], end = t + dt, decay = Math.exp(-dt / P.tau);
        if (queue.length) { let k = 0; for (const q of queue) { if (q.arrive <= end) { if (until[q.j] <= q.arrive) V[q.j] += q.inhib ? P.ipsp : P.epsp; } else queue[k++] = q; } queue.length = k; }
        for (let i = 0; i < n; i++) {
          const inf = P.rest + drive[i]; if (until[i] > end) continue;
          V[i] = inf + (V[i] - inf) * decay;
          if (poisson && poisson(i) > rand()) V[i] += P.epsp;   // background input from outside the network, one synapse at a time
          if (V[i] >= P.threshold) { V[i] = P.reset; until[i] = end + P.refractory; count[i]++; spikes++; const f = { i, t: end, inhib: !!inhib[i], to: [] }; for (const j of g.adj[i]) { const arrive = end + delayOf(i, j); queue.push({ j, arrive, inhib: !!inhib[i] }); f.to.push({ j, arrive }); } out.push(f); }
        }
        t = end; return out;
      } };
  }

  // ---- anatomy. A brain in its own frame: x right, y down (the canvas's), z towards the front, on a unit scale where the long
  // axis is 1. Adult proportions: about 167 mm long, 140 wide, 93 high above the base. Directions are unit vectors from the centre.
  const BRAIN = { x: 0.84, y: 0.62, z: 1 };
  const smooth = (a, b, v) => { const u = Math.max(0, Math.min(1, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
  // cortex: lobes by landmarks. The central sulcus separates frontal from parietal; the Sylvian fissure lifts off the temporal lobe;
  // the parieto-occipital line marks the occipital. Shares of cortex are roughly frontal 41%, temporal 22%, parietal 19%, occipital 18%.
  const LOBE_SHARE = { frontal: 0.41, temporal: 0.22, parietal: 0.19, occipital: 0.18 };
  function lobeOf(x, y, z) {
    if (z < -0.62 - y * 0.15) return "occipital";
    if (y > 0.06 + (z < 0 ? -z * 0.1 : z * 0.2) && Math.abs(x) > 0.34 && z < 0.72) return "temporal";
    return z > 0.1 + y * 0.45 ? "frontal" : "parietal";   // the central sulcus leans back towards the top
  }
  // folding: gyri and sulci, from a sum of bent ridges; about a third of cortex's area is on the crowns and the rest is hidden
  // in the folds, which a shell can only suggest. 1 on a crown, 0 at the bottom of a sulcus.
  function gyri(x, y, z) {
    // the zero of each |sin| is a winding line: sulci, with shorter side-branches off them, the way a real cortex folds
    const warp = 3.1 * Math.sin(2.1 * x + 1.3 * y) + 2.3 * Math.sin(1.7 * z - 2.2 * y + 0.7), a = Math.abs(Math.sin(13 * z + warp + 1.1 * Math.sin(4.3 * y))), b = Math.abs(Math.sin(9.7 * y + 0.6 * warp + 3.1 * x)), c = Math.abs(Math.sin(7.1 * x + 0.8 * warp - 6.2 * z));
    return Math.pow(Math.min(a, 0.3 + 0.7 * b, 0.45 + 0.55 * c), 0.6);
  }
  // how far along a unit direction the surface of the cerebrum lies. Returns { r, fold, lobe }.
  function cortexAt(dx, dy, dz) {
    const L = Math.hypot(dx, dy, dz) || 1, x = dx / L, y = dy / L, z = dz / L;
    let r = 1 / Math.hypot(x / BRAIN.x, y / BRAIN.y, z / BRAIN.z);
    // the frontal pole narrows; the base is flatter than the top
    r *= 1 - 0.1 * smooth(0.45, 1, z) * Math.abs(x) * 2 - 0.1 * smooth(0.1, 0.8, y);
    // temporal poles hang below the Sylvian fissure
    const temporal = Math.exp(-((Math.abs(x) - 0.62) ** 2 / 0.05 + (y - 0.42) ** 2 / 0.05 + (z - 0.18) ** 2 / 0.18)); r *= 1 + 0.16 * temporal;
    // the longitudinal fissure, between the hemispheres, deepest on top; and the Sylvian fissure
    const lf = Math.exp(-(x * x) / 0.0028) * smooth(0.45, -0.25, y); r *= 1 - 0.34 * lf;
    const syl = Math.exp(-((y - 0.1 - 0.12 * z) ** 2) / 0.0035) * smooth(0.25, 0.5, Math.abs(x)) * smooth(0.65, 0.3, z) * smooth(-0.55, -0.2, z); r *= 1 - 0.09 * syl;
    const fold = gyri(x, y, z); r *= 1 + 0.05 * (fold - 0.55);
    return { r, fold: fold * (1 - 0.8 * lf) * (1 - 0.6 * syl), lobe: lobeOf(x, y, z) };
  }
  // the cerebellum and brainstem as their own solids, behind and under: fine folia run across it
  const CEREBELLUM = { cx: 0, cy: 0.5, cz: -0.62, rx: 0.5, ry: 0.27, rz: 0.3 };
  const STEM = { cx: 0, cy: 0.66, cz: -0.24, r: 0.085 };
  // spread the topics over the lobes in the lobes' real shares of cortex, biggest first into whichever lobe is most under its share.
  // Where a topic lands says nothing about what it's about: real anatomy has no place for "Odoo". Sizes are what's true here.
  function assignLobes(sizes) {
    const names = Object.keys(LOBE_SHARE), have = Object.fromEntries(names.map(k => [k, 0])), total = sizes.reduce((s, x) => s + x.size, 0) || 1, out = {};
    [...sizes].sort((a, b) => b.size - a.size || (a.id > b.id ? 1 : -1)).forEach(c => { const lobe = names.slice().sort((a, b) => (have[a] / total - LOBE_SHARE[a]) - (have[b] / total - LOBE_SHARE[b]))[0]; have[lobe] += c.size; out[c.id] = lobe; });
    return out;
  }
  // a topic's spot: sample the sphere with a repeating golden spiral, keep directions in the lobe, then take them far apart
  function lobeSpots(lobe, count) {
    const all = []; for (let i = 0; i < 1600; i++) { const y = 1 - (i + 0.5) / 1600 * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963, x = Math.cos(th) * rr, z = Math.sin(th) * rr; if (Math.abs(x) > 0.16 && lobeOf(x, y, z) === lobe && y < 0.72) all.push([x, y, z]); }
    if (!all.length) return Array.from({ length: count }, () => [0.5, 0, 0]);
    const out = [all[0]]; while (out.length < count) { let best = all[0], far = -1; for (const p of all) { let m = Infinity; for (const q of out) m = Math.min(m, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2); if (m > far) { far = m; best = p; } } out.push(best); }
    return out;
  }
  // ---- could this network compute? Reservoir computing takes a fixed network, drives it with a signal and trains only a linear
  // readout (Jaeger 2001), which is how real wiring diagrams get tested as computers (Suarez et al. 2021). Links carry no weights
  // here, so each gets a random strength; symmetric, since links have no direction. What's measured is the wiring.
  function largestAbsEigen(g, w, steps = 120) { let v = new Float64Array(g.n).fill(1 / Math.sqrt(g.n || 1)), l = 0; for (let s = 0; s < steps; s++) { const u = new Float64Array(g.n); for (let i = 0; i < g.n; i++) { const a = g.adj[i], ws = w[i]; let t = 0; for (let k = 0; k < a.length; k++) t += ws[k] * v[a[k]]; u[i] = t; } let n2 = 0; for (let i = 0; i < g.n; i++) n2 += u[i] * u[i]; const n = Math.sqrt(n2); if (!n) return 0; l = n; for (let i = 0; i < g.n; i++) u[i] /= n; v = u; } return l; }
  function reservoir(g, o = {}) {
    const rand = rng(o.seed || 21), rho = o.rho == null ? 0.9 : o.rho, inScale = o.input == null ? 0.2 : o.input, n = g.n, w = g.adj.map(a => new Float64Array(a.length));
    const seen = new Map(); for (let i = 0; i < n; i++) g.adj[i].forEach((j, k) => { const key = i < j ? i * n + j : j * n + i; if (!seen.has(key)) seen.set(key, (rand() * 2 - 1)); w[i][k] = seen.get(key); });
    const l = largestAbsEigen(g, w) || 1; for (let i = 0; i < n; i++) for (let k = 0; k < w[i].length; k++) w[i][k] *= rho / l;
    const win = Array.from({ length: n }, () => (rand() < 0.5 ? -1 : 1) * inScale * (rand() < (o.inputShare == null ? 0.25 : o.inputShare) ? 1 : 0));
    // run returns one row of readings per step, from at most `read` of the notes, spread evenly
    return { w, win, run(u, read = 200, washout = 100) { const x = new Float64Array(n), keep = []; const stride = Math.max(1, n / read); for (let f = 0; f < n; f += stride) keep.push(Math.floor(f)); const rows = []; for (let t = 0; t < u.length; t++) { const y = new Float64Array(n); for (let i = 0; i < n; i++) { const a = g.adj[i], ws = w[i]; let s = win[i] * u[t]; for (let k = 0; k < a.length; k++) s += ws[k] * x[a[k]]; y[i] = Math.tanh(s); } x.set(y); if (t >= washout) { const r = new Float64Array(keep.length + 1); keep.forEach((id, c) => { r[c] = x[id]; }); r[keep.length] = 1; rows.push(r); } } return rows; } };
  }
  // ridge regression by Cholesky on the normal equations: solver(targets) gives the readout's weights for any number of targets
  function ridge(rows, lambda = 1e-6) {
    const d = rows[0].length, A = new Float64Array(d * d); for (const r of rows) for (let i = 0; i < d; i++) { const ri = r[i]; if (ri) for (let j = 0; j <= i; j++) A[i * d + j] += ri * r[j]; }
    const tr = Array.from({ length: d }, (_, i) => A[i * d + i]).reduce((a, b) => a + b, 0) / d || 1; for (let i = 0; i < d; i++) A[i * d + i] += lambda * tr + 1e-12;
    for (let i = 0; i < d; i++) { for (let j = 0; j <= i; j++) { let s = A[i * d + j]; for (let k = 0; k < j; k++) s -= A[i * d + k] * A[j * d + k]; A[i * d + j] = i === j ? Math.sqrt(Math.max(s, 1e-14)) : s / A[j * d + j]; } }
    return target => { const b = new Float64Array(d); rows.forEach((r, t) => { const v = target[t]; for (let i = 0; i < d; i++) b[i] += r[i] * v; }); for (let i = 0; i < d; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * d + k] * b[k]; b[i] = s / A[i * d + i]; } for (let i = d - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < d; k++) s -= A[k * d + i] * b[k]; b[i] = s / A[i * d + i]; } return b; };
  }
  const predictWith = (rows, w) => rows.map(r => { let s = 0; for (let i = 0; i < w.length; i++) s += r[i] * w[i]; return s; });
  const r2 = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; } return saa && sbb ? (sab * sab) / (saa * sbb) : 0; };
  // Jaeger's memory capacity: for each delay k, how well the readout recalls the input from k steps ago, summed. It can't exceed the
  // number of readings. Scored on data the readout wasn't trained on. curve: the recall at each delay.
  function memoryCapacity(g, o = {}) {
    const rand = rng(o.seed || 31), T = o.steps || 1600, wash = 100, split = Math.floor((T - wash) * 0.7), K = o.maxDelay || 60, u = Array.from({ length: T }, () => rand() * 2 - 1), rows = reservoir(g, o).run(u, o.read || 200, wash), train = rows.slice(0, split), test = rows.slice(split), solve = ridge(train), curve = [];
    let mc = 0; for (let k = 1; k <= K; k++) { const target = t => u[t + wash - k] ?? 0, w = solve(train.map((_, t) => target(t))), pred = predictWith(test, w), want = test.map((_, t) => target(t + split)), c = r2(pred, want); curve.push(c); mc += c >= 0.02 ? c : 0; }   // recall this low is noise on a finite test: Jaeger's bias
    return { mc, curve };
  }
  // NARMA-10, the field's standard test (Atiya & Parlos 2000): a task that needs both memory and non-linearity. Error against the
  // target's own spread: 1 is no better than always guessing the mean; 0 is perfect.
  function narma(T, rand) { const u = Array.from({ length: T }, () => rand() * 0.5), y = new Array(T).fill(0); for (let t = 9; t < T - 1; t++) { let s = 0; for (let i = 0; i < 10; i++) s += y[t - i]; y[t + 1] = 0.3 * y[t] + 0.05 * y[t] * s + 1.5 * u[t - 9] * u[t] + 0.1; } return { u, y }; }
  function narmaError(g, o = {}) {
    const rand = rng(o.seed || 41), T = o.steps || 2400, wash = 200, { u, y } = narma(T, rand), rows = reservoir(g, { input: 0.8, ...o }).run(u.map(v => v * 2 - 0.5), o.read || 200, wash), split = Math.floor((T - wash) * 0.7), target = y.slice(wash), w = ridge(rows.slice(0, split), 1e-7)(target.slice(0, split)), pred = predictWith(rows.slice(split), w), want = target.slice(split), mean = want.reduce((a, b) => a + b, 0) / want.length; let e = 0, v = 0; want.forEach((t, i) => { e += (pred[i] - t) ** 2; v += (t - mean) ** 2; });
    return v ? Math.sqrt(e / v) : 1;
  }
  // ---- what shape is it? Clustering and path length (Watts & Strogatz 1998), against the same graph with its links rewired so
  // every note keeps its link count (Maslov & Sneppen 2002), which is the fair null: a hub stays a hub
  function clustering(g) { let sum = 0, cnt = 0; const mark = new Int32Array(g.n).fill(-1); for (let i = 0; i < g.n; i++) { const a = g.adj[i]; if (a.length < 2) continue; a.forEach(x => { mark[x] = i; }); let tri = 0; for (const x of a) for (const y of g.adj[x]) if (mark[y] === i) tri++; sum += tri / (a.length * (a.length - 1)); cnt++; } return cnt ? sum / cnt : 0; }
  function meanPath(g, samples = 80, seed = 13) { const big = (() => { const seen = new Uint8Array(g.n); let best = []; for (let s = 0; s < g.n; s++) { if (seen[s]) continue; const c = [s]; seen[s] = 1; for (let q = 0; q < c.length; q++) for (const j of g.adj[c[q]]) if (!seen[j]) { seen[j] = 1; c.push(j); } if (c.length > best.length) best = c; } return best; })(); if (big.length < 2) return 0; const rand = rng(seed), dist = new Int32Array(g.n); let total = 0, pairs = 0; for (let s = 0; s < Math.min(samples, big.length); s++) { const src = samples >= big.length ? big[s] : big[Math.floor(rand() * big.length)]; dist.fill(-1); dist[src] = 0; const q = [src]; for (let h = 0; h < q.length; h++) for (const j of g.adj[q[h]]) if (dist[j] < 0) { dist[j] = dist[q[h]] + 1; q.push(j); total += dist[j]; pairs++; } } return pairs ? total / pairs : 0; }
  function rewired(g, seed = 1, swaps = 10) { const rand = rng(seed), edges = g.edges.map(e => e.slice()), has = new Set(edges.map(([a, b]) => (a < b ? a * g.n + b : b * g.n + a))), key = (a, b) => (a < b ? a * g.n + b : b * g.n + a), m = edges.length; for (let s = 0; s < m * swaps; s++) { const x = Math.floor(rand() * m), y = Math.floor(rand() * m); if (x === y) continue; const [a, b] = edges[x]; let [c, d] = edges[y]; if (rand() < 0.5) [c, d] = [d, c]; if (a === d || c === b || a === c || b === d || has.has(key(a, d)) || has.has(key(c, b))) continue; has.delete(key(a, b)); has.delete(key(c, d)); has.add(key(a, d)); has.add(key(c, b)); edges[x] = [a, d]; edges[y] = [c, b]; } const adj = Array.from({ length: g.n }, () => []); edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); }); return { ids: g.ids, at: g.at, adj, edges, n: g.n }; }
  function randomGraph(n, m, seed = 1) { const rand = rng(seed), ids = Array.from({ length: n }, (_, i) => String(i)), adj = ids.map(() => []), edges = [], has = new Set(); let tries = 0; while (edges.length < m && tries++ < m * 30) { const a = Math.floor(rand() * n), b = Math.floor(rand() * n), k = a < b ? a * n + b : b * n + a; if (a === b || has.has(k)) continue; has.add(k); adj[a].push(b); adj[b].push(a); edges.push([a, b]); } return { ids, adj, edges, n, at: new Map(ids.map((x, i) => [x, i])) }; }
  // Humphries & Gurney's sigma: over 1, more clustered than chance at about chance's path length
  function smallWorld(g, nulls = 8) { const C = clustering(g), L = meanPath(g); let Cr = 0, Lr = 0; for (let i = 0; i < nulls; i++) { const r = rewired(g, i + 1); Cr += clustering(r) / nulls; Lr += meanPath(r) / nulls; } const gamma = Cr ? C / Cr : 0, lambda = Lr ? L / Lr : 0; return { C, L, Cr, Lr, gamma, lambda, sigma: lambda ? gamma / lambda : 0 }; }
  // ---- ecology: trophic levels, by MacKay, Johnson & Sansom (2020). Levine's classic sum assumes food chains run mostly one way: on a
  // network full of loops, as notes are, it can't settle on anything sensible (a real vault came out at level 302). This asks instead:
  // give every note a height so that each link climbs by as close to 1 as it can. That's a least-squares problem, with one answer per
  // connected part, whatever the loops. On a simple chain it's the same as Levine's. out[i]: what note i links to; i feeds on them.
  // incoherence F0 is what's left over: 0 when every link climbs exactly 1, a true hierarchy; 1 when links show no direction at all.
  function trophic(out) {
    const n = out.length, into = Array.from({ length: n }, () => []); out.forEach((a, i) => a.forEach(j => into[j].push(i)));
    const u = Array.from({ length: n }, (_, i) => out[i].length + into[i].length), v = Array.from({ length: n }, (_, i) => out[i].length - into[i].length);   // i eats j: energy goes j to i, so i's "in" is what it links to
    // solve (diag(u) - A - A^T) h = v by conjugate gradients, one connected part at a time: the matrix is a graph Laplacian
    const part = new Int32Array(n).fill(-1), parts = []; for (let s = 0; s < n; s++) { if (part[s] >= 0) continue; const c = [s]; part[s] = parts.length; for (let k = 0; k < c.length; k++) { for (const j of out[c[k]]) if (part[j] < 0) { part[j] = parts.length; c.push(j); } for (const j of into[c[k]]) if (part[j] < 0) { part[j] = parts.length; c.push(j); } } parts.push(c); }
    const h = new Float64Array(n), mul = (x, y, c) => { for (const i of c) { let t = u[i] * x[i]; for (const j of out[i]) t -= x[j]; for (const j of into[i]) t -= x[j]; y[i] = t; } };
    for (const c of parts) { if (c.length < 2) continue; const r = new Float64Array(n), d = new Float64Array(n), q = new Float64Array(n); let rs = 0; for (const i of c) { r[i] = v[i]; d[i] = r[i]; rs += r[i] * r[i]; }
      for (let it = 0; it < c.length * 4 && rs > 1e-20; it++) { mul(d, q, c); let dq = 0; for (const i of c) dq += d[i] * q[i]; if (!dq) break; const al = rs / dq; let next = 0; for (const i of c) { h[i] += al * d[i]; r[i] -= al * q[i]; next += r[i] * r[i]; } const be = next / rs; rs = next; for (const i of c) d[i] = r[i] + be * d[i]; }
      let low = Infinity; for (const i of c) low = Math.min(low, h[i]); for (const i of c) h[i] -= low; }
    const level = Array.from(h, x => x + 1);
    let waste = 0, links = 0; out.forEach((a, i) => a.forEach(j => { waste += (level[i] - level[j] - 1) ** 2; links++; }));
    // omnivory (Christensen & Pauly 1992): the spread of the levels it feeds on. 0 feeds on one level; more means it eats across them
    const omnivory = out.map((a, i) => { if (a.length < 2) return 0; const m = a.reduce((s, j) => s + level[j], 0) / a.length; return a.reduce((s, j) => s + (level[j] - m) ** 2, 0) / a.length; });
    const consumers = level.filter((x, i) => out[i].length), mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return { level, omnivory, incoherence: links ? waste / links : 0, basal: out.filter(a => !a.length).length, top: into.filter((a, i) => !a.length && out[i].length).length, links, connectance: n ? links / (n * n) : 0, meanLevel: mean(consumers), maxLevel: n ? Math.max(...level) : 0, omnivores: omnivory.filter(x => x > 0.01).length };
  }
  // ---- weather: surface wind. Aloft, wind runs along the isobars, balanced between pressure and the Earth's turn (geostrophic). Near
  // the ground friction turns it about 25 degrees in towards low pressure. In the northern hemisphere that takes it counter-clockwise
  // round a low and clockwise round a high (Buys Ballot's law). gx, gy: the pressure gradient on screen, where y runs down.
  const WIND_INFLOW = 25 * Math.PI / 180;
  const surfaceWind = (gx, gy, inflow = WIND_INFLOW) => { const c = Math.cos(inflow), s = Math.sin(inflow); return [c * gy - s * gx, -c * gx - s * gy]; };

  // ---- queues: Little's law (1961), L = lambda W. Over any stretch of time, the average number of things in a system equals the rate they
  // arrive times the average time each spends there, whatever the arrivals and whatever the order. rows: { born, done } with dates, done
  // null while open. The window is the last `days` days; time inside the window is what counts, so it balances exactly by construction.
  function flow(rows, today, days = 90) {
    const ms = VGShared.DAY_MS, end = VGShared.utcNoon(today), start = end - days * ms, dayOf = d => Math.round((VGShared.utcNoon(d) - start) / ms), wip = new Array(days + 1).fill(0), arrived = new Array(days + 1).fill(0), left = new Array(days + 1).fill(0); let inWindow = 0, total = 0, entered = 0;
    for (const r of rows) { const a = dayOf(r.born), b = r.done ? dayOf(r.done) : Infinity; if (b <= 0 || a > days || b < a) continue; const from = Math.max(0, a), to = Math.min(days, b); for (let d = from; d < to; d++) { wip[d]++; total++; } if (to === days && b > days) wip[days]++; if (a >= 0) arrived[a]++; if (b <= days && b > 0) left[b]++; inWindow++; if (a >= 0 || a < 0) entered++; }
    const cum = a => { let s = 0; return a.map(x => (s += x)); }, L = total / days, doneCount = left.reduce((x, y) => x + y, 0), arrivedCount = arrived.reduce((x, y) => x + y, 0), lambda = entered / days, W = entered ? total / entered : 0;
    return { wip, cumIn: cum(arrived), cumOut: cum(left), L, lambda, W, throughput: doneCount / days, arrivals: arrivedCount / days, openNow: wip[days], days, net: arrivedCount - doneCount };
  }
  // ---- debt: a stale note costs in proportion to how much rests on it and how long it's been left. reach: how many notes depend on it,
  // directly or through others, on the one-way graph where an edge means "leans on me".
  function reachCounts(g) { return g.adj.map((_, s) => { const seen = new Uint8Array(g.n), q = [s]; seen[s] = 1; let c = 0; for (let h = 0; h < q.length; h++) for (const j of g.adj[q[h]]) if (!seen[j]) { seen[j] = 1; q.push(j); c++; } return c; }); }
  // how much rests on each note when reliance fades with distance: a note directly on it counts 1, two links away a half, three a quarter.
  // Through enough hops nearly everything reaches everything, so a plain count tells notes apart hardly at all. Also the direct count.
  function reliance(g, fade = 0.5) { const dist = new Int32Array(g.n); return g.adj.map((a, s) => { dist.fill(-1); dist[s] = 0; const q = [s]; let score = 0; for (let h = 0; h < q.length; h++) for (const j of g.adj[q[h]]) if (dist[j] < 0) { dist[j] = dist[q[h]] + 1; score += Math.pow(fade, dist[j] - 1); q.push(j); } return { score, direct: a.length, reach: q.length - 1 }; }); }
  // the debt ranking: a stale note's cost is what rests on it times the years it's been left. notes: { age (days), stale }, in g's order.
  function debtRanks(g, notes) { const rely = reliance(g); return notes.map((n, i) => ({ i, ...rely[i], age: n.age || 0, stale: n.stale })).filter(r => r.stale && r.score > 0).map(r => ({ ...r, cost: r.score * (r.age / 365) })).sort((a, b) => b.cost - a.cost); }
  // the same network with direction kept, for what travels one way: pairs are [from, to]
  function directedGraph(ids, pairs) { const at = new Map(ids.map((id, i) => [id, i])), adj = ids.map(() => []), seen = new Set(), edges = []; for (const [a, b] of pairs) { const i = at.get(a), j = at.get(b); if (i == null || j == null || i === j) continue; const key = i * ids.length + j; if (seen.has(key)) continue; seen.add(key); adj[i].push(j); edges.push([i, j]); } return { ids, at, adj, edges, n: ids.length, directed: true }; }
  // ---- the "As a neural net" study: reservoir tests on the vault's wiring, a rewired copy and a random one. Steps, so it can pause
  // between runs when it has to share a thread; a worker just runs them straight through.
  const NET_RHOS = [0.5, 0.8, 0.95, 1.1, 1.3], NET_SEEDS = 4;
  function* netStudySteps(g) {
    const kinds = { yours: () => g, rewired: s => rewired(g, s), random: s => randomGraph(g.n, g.edges.length, s) }, runs = {};
    for (const [name, make] of Object.entries(kinds)) { runs[name] = []; for (const rho of NET_RHOS) { const mc = [], na = []; for (let s = 1; s <= NET_SEEDS; s++) { const G = make(s); mc.push(memoryCapacity(G, { rho, seed: s * 7 + 1, steps: 1200 }).mc); yield; na.push(narmaError(G, { rho, seed: s * 11 + 1, steps: 1600 })); yield; } runs[name].push({ rho, mc, na }); } }
    const sw = smallWorld(g, 6); yield;
    return { runs, sw, sizes: components(g), n: g.n, m: g.edges.length };
  }
  function netStudyNow(g) { const it = netStudySteps(g); let r = it.next(); while (!r.done) r = it.next(); return r.value; }
  // what identifies a network, so a refresh that changes no link keeps every result worked out from it
  function graphKey(g) { return g.key || (g.key = `${g.directed ? "d" : "u"}|${g.ids.join("\n")}|${g.edges.map(e => `${e[0]},${e[1]}`).join(";")}`); }
  // Runs in a worker so the app stays free (it takes seconds), and one result is kept per network for the whole app: another tab, the
  // self-test or a reopened lens reuses it. If a worker can't start, the steps run here with a pause between them.
  const netMemo = new Map(), netStats = { runs: 0, via: null };
  async function netHere(g) { const it = netStudySteps(g); let r = it.next(); while (!r.done) { await new Promise(go => setTimeout(go)); r = it.next(); } return r.value; }
  function netStudy(g) {
    const key = graphKey(g); if (netMemo.has(key)) return netMemo.get(key);
    netStats.runs++; while (netMemo.size >= 2) netMemo.delete(netMemo.keys().next().value);
    const p = VGShared.offThread({ makers: { VGScienceMake }, listen: "e => { const S = VGScienceMake(), { ids, edges } = e.data; postMessage(S.netStudyNow(S.graphOf(ids, edges.map(x => [ids[x[0]], ids[x[1]]])))); }", message: { ids: g.ids, edges: g.edges }, here: () => netHere(g), label: "the network tests are", stats: netStats });
    netMemo.set(key, p); return p;
  }
  // ---- control charts: Shewhart's individuals chart (XmR). Limits come from how much a value moves from one to the next (2.66 = 3 / d2, with
  // d2 = 1.128 for ranges of two), so a run of values can't widen its own limits by trending. A signal: a point outside the limits, or eight
  // in a row on one side of the centre (Western Electric). Counts can't go below 0, so nor can the lower limit.
  function xmr(values) {
    const n = values.length, mean = values.reduce((a, b) => a + b, 0) / (n || 1), ranges = values.slice(1).map((v, i) => Math.abs(v - values[i])), mr = ranges.reduce((a, b) => a + b, 0) / (ranges.length || 1), ucl = mean + 2.66 * mr, lcl = Math.max(0, mean - 2.66 * mr), signals = [];
    values.forEach((v, i) => { if (v > ucl || v < lcl) signals.push({ i, rule: v > ucl ? "above" : "below" }); });
    let run = 0, side = 0; values.forEach((v, i) => { const s = Math.sign(v - mean); if (s && s === side) run++; else { run = s ? 1 : 0; side = s; } if (run === 8) signals.push({ i, rule: side > 0 ? "run-high" : "run-low" }); });
    return { mean, mr, ucl, lcl, signals };
  }
  // ---- diversity: Hill numbers (Hill 1973), an ecologist's "effective number of species". q 1 = exp(Shannon), q 2 = inverse Simpson. Five topics
  // shared equally are 5 at every order; one taking nearly everything is near 1, however many others appear.
  function hill(counts) { const c = counts.filter(x => x > 0), t = c.reduce((a, b) => a + b, 0); if (!t) return { q0: 0, q1: 0, q2: 0 }; return { q0: c.length, q1: Math.exp(-c.reduce((a, x) => a + x / t * Math.log(x / t), 0)), q2: 1 / c.reduce((a, x) => a + (x / t) ** 2, 0) }; }
  // ---- k-core (Seidman 1983; peeling as in Batagelj & Zaversnik 2003): the largest set where each note has k links inside the set. adj: undirected.
  function kCore(adj) { const n = adj.length, deg = adj.map(a => a.length), core = new Int32Array(n), gone = new Uint8Array(n); let k = 0, left = n; while (left) { let changed = true; while (changed) { changed = false; for (let i = 0; i < n; i++) if (!gone[i] && deg[i] <= k) { gone[i] = 1; core[i] = k; left--; changed = true; for (const j of adj[i]) if (!gone[j]) deg[j]--; } } k++; } return core; }
  // ---- unseen species: Chao1 (Chao 1984). From how many kinds were seen once (f1) and twice (f2), a lower bound on the kinds never seen: f1^2 / (2 f2).
  function chao1(counts) { const f1 = counts.filter(c => c === 1).length, f2 = counts.filter(c => c === 2).length, S = counts.filter(c => c > 0).length, unseen = f2 > 0 ? f1 * f1 / (2 * f2) : f1 * (f1 - 1) / 2; return { S, f1, f2, unseen, total: S + unseen }; }
  // ---- location quotient (regional economics, Isard 1960): a part's share of one total against its share of another. 1 = in step; 2 = twice its share.
  const locationQuotient = (a, A, b, B) => (b && B && A ? (a / A) / (b / B) : null);
  // Each area's open tasks against what it finished in the last days, biggest quotient first. areaOf(text) says which area a task is in.
  function areaBalance(rows, today, days, areaOf) {
    const since = VGShared.shiftDay(today, -days), parts = {};
    for (const r of rows) { const a = areaOf(r.text); if (!a) continue; const p = parts[a] = parts[a] || { open: 0, done: 0 }; if (!r.event) p.open++; else if (r.done >= since) p.done++; }
    const list = Object.entries(parts), O = list.reduce((s, [, p]) => s + p.open, 0), D = list.reduce((s, [, p]) => s + p.done, 0);
    return { open: O, done: D, rows: list.map(([area, p]) => ({ area, ...p, lq: locationQuotient(p.open, O, p.done, D) })).sort((x, y) => (y.lq == null ? 1e9 : y.lq) - (x.lq == null ? 1e9 : x.lq)) };
  }
  // Aging work in progress (Vacanti, Actionable Agile, 2015): the time by which a share of tasks finish, read from the survival curve so tasks
  // still open count, and which open tasks are already older than that.
  function serviceLevel(rows, share = 0.85) { const km = kaplanMeier(rows), hit = km.steps.find(x => x.s <= 1 - share); const days = hit ? hit.t : null; return { days, share, late: days == null ? [] : rows.filter(r => !r.event && r.t > days).sort((a, b) => b.t - a.t) }; }
  // ---- two-way links: pairs of notes that link to each other, and what the web's incoherence would be without the links in drops ([from, to] indexes)
  function twoWayPairs(g) { const has = new Set(g.edges.map(([a, b]) => a * g.n + b)); return g.edges.filter(([a, b]) => a < b && has.has(b * g.n + a)); }
  function incoherenceWithout(g, drops) { const off = new Set(drops.map(([a, b]) => a * g.n + b)); return trophic(g.adj.map((a, i) => a.filter(j => !off.has(i * g.n + j)))).incoherence; }
  // ---- vitals: the findings worth acting on, each from the method its lens uses. rows: taskLives' rows; notes: { id, name, age, stale };
  // pairs: [from, to] for links written into a note. A daily sample of these numbers is what shows whether acting on them worked.
  function vitals(o) {
    const balance = o.areaOf ? areaBalance(o.rows, o.today, 90, o.areaOf) : null, piling = balance && balance.rows.find(r => r.open >= 5 && r.lq != null && r.lq >= 2);
    const g = directedGraph(o.notes.map(n => n.id), o.pairs), spread = directedGraph(g.ids, g.edges.map(([a, b]) => [g.ids[b], g.ids[a]]));
    const F = flow(o.rows.map(r => ({ born: r.born, done: r.event ? r.done : null })), o.today, 90), old = o.rows.filter(r => !r.event && r.t > 30).length;
    const ranks = debtRanks(spread, o.notes), total = ranks.reduce((s, r) => s + r.cost, 0), top = ranks[0], web = g.edges.length ? trophic(g.adj) : null;
    return { pile: { open: F.openNow, came: F.cumIn[F.days], left: F.cumOut[F.days], net: F.net, old, wip: F.wip, ...(piling ? { piling: { area: piling.area, open: piling.open, done: piling.done } } : {}) }, debt: { total, count: ranks.length, top: top ? { id: g.ids[top.i], name: o.notes[top.i].name, cost: top.cost, direct: top.direct, reach: top.reach, years: top.age / 365 } : null, list: ranks.slice(0, 5).map(r => ({ id: g.ids[r.i], name: o.notes[r.i].name })) }, web: { incoherence: web ? web.incoherence : null, links: g.edges.length, twoWay: twoWayPairs(g).length } };
  }
  const vitalsSample = v => ({ open: v.pile.open, debt: Math.round(v.debt.total), incoherence: v.web.incoherence == null ? null : +v.web.incoherence.toFixed(2), ...(v.sync ? { sync: v.sync.used } : {}) });
  // when a growing store reaches its limit, at the rate since the latest sample a week or more old. Null with no such sample, or if it isn't growing.
  function daysToLimit(history, day, key, now, limit) { const end = VGShared.utcNoon(day), past = Object.keys(history || {}).filter(d => end - VGShared.utcNoon(d) >= 7 * VGShared.DAY_MS && history[d][key] != null).sort().pop(); if (past == null) return null; const days = (end - VGShared.utcNoon(past)) / VGShared.DAY_MS, rate = (now - history[past][key]) / days; return rate > 0 ? Math.max(0, (limit - now) / rate) : null; }
  // the change in one sample's number against the latest sample a week or more old, or null when there isn't one yet
  function vitalsDelta(history, day, key, now) { const edge = VGShared.utcNoon(day) - 7 * VGShared.DAY_MS, past = Object.keys(history || {}).filter(d => VGShared.utcNoon(d) <= edge && history[d][key] != null).sort().pop(); return past == null || now == null ? null : now - history[past][key]; }
  // ---- CRISPR-Cas9 as a search of a note's text. A guide finds its exact sequence. A site counts only where the required
  // neighbour (the PAM: guide.before / guide.after) sits right beside it. Sequences a few letters off are the off-targets:
  // reported apart (near), never as matches. A note is read line by line into what each line is (frontmatter, code, task,
  // body), never with one pattern over the whole file, and a guide skips code unless it asks for it.
  const GUIDE_WHERE = ["frontmatter", "task", "body", "code"], GUIDE_DEFAULT = ["frontmatter", "task", "body"];
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  // mismatches a guide of this length may tolerate: at most one letter in five (a 20-letter guide: 4), so a short guide has none
  const guideMismatches = (length, asked) => Math.max(0, Math.min(Math.floor(+asked || 0), Math.floor(length / 5)));
  // the columns of a line inside `inline code`: [start, end) for each span
  function codeSpans(t) {
    const out = []; let i = 0;
    while ((i = t.indexOf("`", i)) >= 0) {
      let n = 1; while (t[i + n] === "`") n++;
      let j = i + n, end = -1;
      while ((j = t.indexOf("`", j)) >= 0) { let m = 1; while (t[j + m] === "`") m++; if (m === n) { end = j; break; } j += m; }
      if (end < 0) { i += n; continue; }
      out.push([i, end + n]); i = end + n;
    }
    return out;
  }
  // each line of a note with what it is. Frontmatter is the block between a first-line --- and the next ---; without the
  // closing line there is none. A fence closes on the same mark, at least as long, alone on its line.
  function guideLines(text) {
    const lines = String(text == null ? "" : text).split(/\r?\n/), fmEnd = /^---\s*$/.test(lines[0]) ? lines.findIndex((t, i) => i > 0 && /^---\s*$/.test(t)) : -1;
    let fence = null;
    return lines.map((t, i) => {
      if (i <= fmEnd) return { line: i + 1, text: t, where: "frontmatter" };
      const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(t);
      if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null; return { line: i + 1, text: t, where: "code" }; }
      if (m) { fence = m[1]; return { line: i + 1, text: t, where: "code" }; }
      return { line: i + 1, text: t, where: /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/.test(t) ? "task" : "body" };
    });
  }
  // guide: { seq, mismatches, where: [GUIDE_WHERE...], word (default true: a guide that starts or ends in a letter or digit
  // doesn't match inside a longer word), caseSensitive, before, after }. Returns { hits, near, skipped }: hits are exact,
  // near differ in 1..mismatches letters, each { line, col, found, mismatches, where, text }; skipped counts exact sites
  // left out by where they are (where) or by the neighbour rule (context). Sites on a line never overlap: exact first.
  function guideScan(text, guide) {
    const fold = s => (guide.caseSensitive ? s : s.toLowerCase()), seq = fold(String(guide.seq || "")), L = seq.length;
    const out = { hits: [], near: [], skipped: { where: 0, context: 0 } }; if (!L) return out;
    const k = guideMismatches(L, guide.mismatches), allow = new Set(guide.where && guide.where.length ? guide.where : GUIDE_DEFAULT);
    const edges = guide.word !== false, needL = edges && WORD_CHAR.test(seq[0]), needR = edges && WORD_CHAR.test(seq[L - 1]);
    const before = fold(guide.before || ""), after = fold(guide.after || "");
    for (const ln of guideLines(text)) {
      let t = fold(ln.text); if (t.length !== ln.text.length) t = ln.text;   // a letter whose lower case is longer: compare as written, so columns hold
      if (t.length < L) continue;
      const spans = ln.where === "code" ? [] : codeSpans(ln.text), found = [];
      for (let i = 0; i + L <= t.length; i++) {
        if (needL && ((i > 0 && WORD_CHAR.test(t[i - 1])) || !WORD_CHAR.test(t[i]))) continue;
        if (needR && ((i + L < t.length && WORD_CHAR.test(t[i + L])) || !WORD_CHAR.test(t[i + L - 1]))) continue;
        let d = 0; for (let j = 0; j < L && d <= k; j++) if (t.charCodeAt(i + j) !== seq.charCodeAt(j)) d++;
        if (d <= k) found.push({ col: i, d });
      }
      const taken = [];
      for (const f of found.sort((a, b) => a.d - b.d || a.col - b.col)) {
        if (taken.some(c => f.col < c + L && c < f.col + L)) continue; taken.push(f.col);
        const where = spans.some(([a, b]) => f.col >= a && f.col < b) ? "code" : ln.where;
        if (!allow.has(where)) { if (!f.d) out.skipped.where++; continue; }
        if ((before && !t.slice(0, f.col).endsWith(before)) || (after && !t.startsWith(after, f.col + L))) { if (!f.d) out.skipped.context++; continue; }
        (f.d ? out.near : out.hits).push({ line: ln.line, col: f.col, found: ln.text.slice(f.col, f.col + L), mismatches: f.d, where, text: ln.text });
      }
    }
    const order = (a, b) => a.line - b.line || a.col - b.col; out.hits.sort(order); out.near.sort(order);
    return out;
  }
  // a site with the text around it instead of its whole line: { line, col, found, mismatches, where, pre, post }
  function guideExcerpt(h, pad = 44) {
    const a = Math.max(0, h.col - pad), b = Math.min(h.text.length, h.col + h.found.length + pad);
    return { line: h.line, col: h.col, found: h.found, mismatches: h.mismatches, where: h.where, pre: (a > 0 ? "…" : "") + h.text.slice(a, h.col).replace(/^\s+/, ""), post: h.text.slice(h.col + h.found.length, b).replace(/\s+$/, "") + (b < h.text.length ? "…" : "") };
  }
  // one guide over many notes: add(path, text) for each, then done(). notes lists those with a site (the first `keep`
  // of each kind as excerpts, with the full counts); hits, near and skipped are totals; allowed is the mismatches used.
  function guideSurvey(guide, keep = 20) {
    const out = { notes: [], scanned: 0, hits: 0, near: 0, skipped: { where: 0, context: 0 }, allowed: guideMismatches(String(guide.seq || "").length, guide.mismatches) };
    return { add(path, text) { const r = guideScan(text, guide); out.scanned++; out.hits += r.hits.length; out.near += r.near.length; out.skipped.where += r.skipped.where; out.skipped.context += r.skipped.context;
        if (r.hits.length || r.near.length) out.notes.push({ path, hits: r.hits.slice(0, keep).map(h => guideExcerpt(h)), near: r.near.slice(0, keep).map(h => guideExcerpt(h)), hitsCount: r.hits.length, nearCount: r.near.length }); },
      done() { out.notes.sort((a, b) => b.hitsCount - a.hitsCount || b.nearCount - a.nearCount || (a.path < b.path ? -1 : 1)); return out; } };
  }
  // ---- the repair. A cut is one line of a note with the guide's exact sites on it rewritten:
  // { line, where, sites, before, after }. repair.to is what each site becomes. Empty takes the site out, with one of the
  // two spaces it leaves and, in frontmatter, the comma of an [a, b] list; after is null when only a list mark is left
  // (the line goes, so a YAML list stays a list). Look-alikes are never cut.
  const BARE_ITEM = /^\s*(?:(?:[-*+]|\d+[.)])(?:\s+\[.\])?)?\s*(?:""|'')?\s*$/;
  function guideCuts(text, guide, repair) {
    const to = String(repair && repair.to != null ? repair.to : ""), byLine = new Map(), out = [];
    for (const h of guideScan(text, { ...guide, mismatches: 0 }).hits) { if (!byLine.has(h.line)) byLine.set(h.line, []); byLine.get(h.line).push(h); }
    for (const [line, hits] of byLine) {
      const was = hits[0].text; let t = was;
      for (const h of hits.slice().sort((a, b) => b.col - a.col)) {
        let a = h.col, b = h.col + h.found.length;
        if (!to) {
          if (h.where === "frontmatter") { const next = /^\s*,\s*/.exec(t.slice(b)), prev = /,\s*$/.exec(t.slice(0, a)); if (next) b += next[0].length; else if (prev) a -= prev[0].length; }
          else if (t[b] === " " && (a === 0 || t[a - 1] === " ")) b++;
          else if (b === t.length && t[a - 1] === " ") a--;
        }
        t = t.slice(0, a) + to + t.slice(b);
      }
      if (t !== was) out.push({ line, where: hits[0].where, sites: hits.length, before: was, after: !to && BARE_ITEM.test(t) && !BARE_ITEM.test(was) ? null : t });
    }
    return out.sort((a, b) => a.line - b.line);
  }
  // Write cuts into a note's text as it reads now: { text, done, left }. A cut whose line no longer reads as it did when
  // shown is left (its line number is in left). Line ends are kept. What is written is exactly each cut's after.
  function guideApply(text, cuts) {
    const s = String(text == null ? "" : text), nl = s.includes("\r\n") ? "\r\n" : "\n", lines = s.split(/\r?\n/), left = [], seen = new Set(); let done = 0;
    for (const c of (cuts || []).slice().sort((a, b) => b.line - a.line)) {
      if (seen.has(c.line) || lines[c.line - 1] !== c.before) { left.push(c.line); continue; }
      seen.add(c.line); if (c.after == null) lines.splice(c.line - 1, 1); else lines[c.line - 1] = c.after; done++;
    }
    return { text: done ? lines.join(nl) : s, done, left: left.sort((a, b) => a - b) };
  }
  // the report note of one applied run: run is the log's entry, notes are [{ path, cuts, left }] with the cuts written
  function guideReport(run, notes) {
    const code = s => (s.includes("`") ? "`` " + s + " ``" : "`" + s + "`"), sc = run.scope || {};
    const head = [`# Guide Scan ${run.id}`, "", `- Guide: ${code(run.guide.seq)}${run.guide.after ? `, only when followed by ${code(run.guide.after)}` : ""}`, `- Repair: ${run.to ? `replaced with ${code(run.to)}` : "taken out"}`,
      `- Where: ${sc.folder ? `folder ${sc.folder}` : sc.tag ? `tag #${sc.tag}` : "the whole vault"}`, `- Written: ${run.cuts} ${run.cuts === 1 ? "line" : "lines"} in ${run.notes} ${run.notes === 1 ? "note" : "notes"}${run.left ? `; ${run.left} left because the line had changed` : ""}`, `- Originals: ${run.kept}`, ""];
    const body = notes.map(n => [`## [[${n.path.replace(/\.md$/, "")}]]`, ...n.cuts.filter(c => !n.left.includes(c.line)).flatMap(c => [`- Line ${c.line}`, `  - Before: ${code(c.before)}`, `  - After: ${c.after == null ? "line removed" : code(c.after)}`]), ...(n.left.length ? [`- Left as it was: line ${n.left.join(", ")}`] : []), ""]);
    return [...head, ...body.flat()].join("\n");
  }
  return { GUIDE_WHERE, GUIDE_DEFAULT, guideMismatches, guideLines, guideScan, guideExcerpt, guideSurvey, guideCuts, guideApply, guideReport,areaBalance, serviceLevel, daysToLimit, xmr, hill, kCore, chao1, locationQuotient, twoWayPairs, incoherenceWithout, debtRanks, vitals, vitalsSample, vitalsDelta, NET_RHOS, NET_SEEDS, netStudySteps, netStudyNow, netStudy, netStats, graphKey, flow, reachCounts, reliance, trophic, surfaceWind, WIND_INFLOW, directedGraph, largestAbsEigen, reservoir, ridge, r2, memoryCapacity, narma, narmaError, clustering, meanPath, rewired, randomGraph, smallWorld, rng, graphOf, moments, spectralRadius, outbreak, outbreakStats, epidemic, sweep, kaplanMeier, survivalAt, medianOf, conditional, restrictedMean, logRank, erfc, taskLives, components, cutPoints, cutDamage, percolationCurve, randomOrder, attackOrder, robustnessR, robustness, concentration, busFactor, LIF, lifRate, lifNetwork, BRAIN, lobeOf, gyri, cortexAt, CEREBELLUM, STEM, LOBE_SHARE, assignLobes, lobeSpots };
};
const VGScience = VGScienceMake();
