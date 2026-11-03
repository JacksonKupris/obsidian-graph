// science.js - the real methods behind the science views and lenses, with nothing about Obsidian or the screen in them, so each
// can be checked against the textbook result (tests/test_science.js). A view or lens computes here and only draws what it gets.
//   Survival: Kaplan & Meier 1958, Greenwood 1926, Mantel 1966. Spreading: Kermack & McKendrick 1927, on a network as bond
//   percolation (Newman 2002). Robustness: Tarjan 1972, Molloy & Reed 1995, Newman & Ziff 2000, Schneider et al. 2011.
//   Neurons: Lapicque's leaky integrate-and-fire, with Brunel's balanced 80/20 network (2000).
const VGScience = (() => {
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
  function epidemic(g) { const { k1, k2 } = moments(g), excess = k1 ? (k2 - k1) / k1 : 0, l = spectralRadius(g); return { k1, k2, excess, Tc: excess ? Math.min(1, 1 / excess) : 1, lambda1: l, TcSpectral: l ? Math.min(1, 1 / l) : 1, R0: T => T * excess }; }
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
    const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5), by = new Map();
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
  return { largestAbsEigen, reservoir, ridge, r2, memoryCapacity, narma, narmaError, clustering, meanPath, rewired, randomGraph, smallWorld, rng, graphOf, moments, spectralRadius, outbreak, outbreakStats, epidemic, sweep, kaplanMeier, survivalAt, medianOf, conditional, restrictedMean, logRank, erfc, taskLives, components, cutPoints, cutDamage, percolationCurve, randomOrder, attackOrder, robustnessR, robustness, concentration, busFactor, LIF, lifRate, lifNetwork, BRAIN, lobeOf, gyri, cortexAt, CEREBELLUM, STEM, LOBE_SHARE, assignLobes, lobeSpots };
})();
