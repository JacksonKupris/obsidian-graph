#!/usr/bin/env node
// The maths behind the science views and lenses, against answers known from outside this code: published worked examples,
// closed forms and small graphs you can check by hand. If a view claims to be a method, this is where it's held to it.
//   node tests/test_science.js        exit 0 = pass
const fs = require("fs"), path = require("path"), assert = require("assert");
const S = new Function(`${fs.readFileSync(path.join(__dirname, "..", "src", "science.js"), "utf8")}; return VGScience;`)();
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a}, want ${b} +/- ${tol}`);

// ---- Kaplan-Meier: Freireich's 6-MP leukaemia trial (1963), the textbook's worked example (Kleinbaum & Klein, Survival Analysis)
const sixMP = [[6, 1], [6, 1], [6, 1], [6, 0], [7, 1], [9, 0], [10, 1], [10, 0], [11, 0], [13, 1], [16, 1], [17, 0], [19, 0], [20, 0], [22, 1], [23, 1], [25, 0], [32, 0], [32, 0], [34, 0], [35, 0]].map(([t, e]) => ({ t, event: !!e }));
const placebo = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map(t => ({ t, event: true }));
const km = S.kaplanMeier(sixMP);
for (const [t, want] of [[6, 0.857], [7, 0.807], [10, 0.753], [13, 0.690], [16, 0.627], [22, 0.538], [23, 0.448]]) near(S.survivalAt(km, t), want, 0.001, `6-MP S(${t})`);
assert.strictEqual(S.medianOf(km), 23, "6-MP's median is 23 weeks");
assert.strictEqual(S.medianOf(S.kaplanMeier(placebo)), 8, "placebo's median is 8 weeks");
// Greenwood at t=6: S=.857, se=.076 (the published figure); the log-log 95% interval is .620 to .952
const at6 = km.steps.find(x => x.t === 6); near(at6.lo, 0.620, 0.002, "6-MP interval low at 6"); near(at6.hi, 0.952, 0.002, "6-MP interval high at 6");
assert(km.steps.every(x => x.lo <= x.s + 1e-9 && x.hi >= x.s - 1e-9 && x.lo >= 0 && x.hi <= 1), "an interval leaves the curve or the 0-1 range");
for (let i = 1; i < km.steps.length; i++) assert(km.steps[i].s <= km.steps[i - 1].s, "a survival curve went up");
assert.strictEqual(S.survivalAt(S.kaplanMeier([{ t: 5, event: false }, { t: 9, event: false }]), 100), 1, "censoring alone must not lower the curve");
near(S.conditional(km, 6, 17), 1 - 0.448 / 0.857, 0.001, "conditional survival is S(t+w)/S(t)");
near(S.restrictedMean(S.kaplanMeier([{ t: 10, event: true }]), 20), 10, 1e-9, "one event at 10: 10 days open");
// ---- the log-rank test, same trial: chi-square 16.79 on one degree of freedom, p about 4e-5 (Kleinbaum & Klein, 16.793)
const lr = S.logRank(placebo, sixMP); near(lr.chi2, 16.793, 0.01, "log-rank chi-square"); assert(lr.p < 1e-4 && lr.p > 1e-5, `log-rank p ${lr.p}`); near(lr.observed, 21, 0, "placebo's observed"); near(lr.expected, 10.75, 0.01, "placebo's expected");
near(S.logRank(sixMP, sixMP).chi2, 0, 1e-9, "a group against itself"); near(S.erfc(0), 1, 1e-6, "erfc(0)"); near(S.erfc(1), 0.157299, 1e-5, "erfc(1)");
// ---- tasks' lives
{ const j = [{ date: "2026-10-01", path: "a", tasks: [{ mark: " ", text: "Ship it" }, { mark: " ", text: "Still open" }, { mark: "x", text: "No date" }, { mark: "-", text: "Dropped" }] }, { date: "2026-10-05", path: "b", tasks: [{ mark: "x", text: "Ship it ✅ 2026-10-06" }, { mark: " ", text: "still OPEN!" }] }];
  const { rows, skipped } = S.taskLives(j, "2026-10-11"), by = Object.fromEntries(rows.map(r => [r.text.slice(0, 5), r]));
  assert.strictEqual(rows.length, 2, "the same words in a later journal are the same task"); assert.deepStrictEqual([by["Ship "].t, by["Ship "].event], [5, true], "from the first journal to its date"); assert.deepStrictEqual([by["Still"].t, by["Still"].event], [10, false], "still open is censored at today");
  assert.deepStrictEqual(skipped, { undated: 1, cancelled: 1 }, "no known end: counted, not guessed"); }

// ---- graphs you can check by hand
const line = S.graphOf(["a", "b", "c", "d", "e"], [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
const cycle = S.graphOf(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]);
const K5ids = ["1", "2", "3", "4", "5"], K5 = S.graphOf(K5ids, K5ids.flatMap((a, i) => K5ids.slice(i + 1).map(b => [a, b])));
const star = S.graphOf(["h", "a", "b", "c", "d"], [["h", "a"], ["h", "b"], ["h", "c"], ["h", "d"]]);
assert.strictEqual(S.graphOf(["a", "b"], [["a", "b"], ["b", "a"], ["a", "a"], ["a", "x"]]).edges.length, 1, "repeats, self-links and strangers are dropped");
near(S.spectralRadius(K5), 4, 1e-4, "K5's largest eigenvalue is n-1"); near(S.spectralRadius(star), 2, 1e-4, "a star's is sqrt(leaves)"); near(S.spectralRadius(cycle), 2, 1e-4, "a cycle's is 2 (bipartite: plain power iteration wouldn't settle)");
assert.deepStrictEqual(S.cutPoints(line).cut.map(i => line.ids[i]).sort(), ["b", "c", "d"], "a line's middle vertices"); assert.strictEqual(S.cutPoints(line).bridges.length, 4, "a line is all bridges");
assert.deepStrictEqual(S.cutPoints(cycle), { cut: [], bridges: [] }, "a cycle has no cut vertex or bridge"); assert.deepStrictEqual(S.cutPoints(K5).cut, [], "nor has K5"); assert.deepStrictEqual(S.cutPoints(star).cut.map(i => star.ids[i]), ["h"], "a star's hub");
// two triangles joined at one vertex, and a long chain (the recursion a recursive version would overflow on)
{ const bow = S.graphOf(["a", "b", "c", "d", "e"], [["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"], ["d", "e"], ["e", "c"]]); assert.deepStrictEqual(S.cutPoints(bow).cut.map(i => bow.ids[i]), ["c"], "a bowtie's knot"); assert.strictEqual(S.cutPoints(bow).bridges.length, 0, "a bowtie has no bridge");
  const n = 200000, long = { n, adj: Array.from({ length: n }, (_, i) => [...(i ? [i - 1] : []), ...(i < n - 1 ? [i + 1] : [])]) }; assert.strictEqual(S.cutPoints(long).cut.length, n - 2, "a long chain"); }
assert.deepStrictEqual(S.cutDamage(line, [2])[0], { i: 2, stranded: 2, parts: 2 }, "the middle of five strands two");
// percolation against brute force, and its ends
{ const order = [2, 0, 1, 3, 4], fast = S.percolationCurve(line, order); order.forEach((_, q) => { const gone = new Set(order.slice(0, q)), big = S.components(line, gone)[0] || 0; near(fast[q], big / 5, 1e-9, `S[${q}] by union-find against a plain count`); }); assert.strictEqual(fast[5], 0, "nothing left"); }
{ const rk = S.robustness(star, 60); assert.strictEqual(S.attackOrder(star)[0], 0, "the attack takes the hub first"); assert(rk.Rattack < rk.Rrandom, "losing the hub first must hurt more than losing notes at random"); assert(S.robustnessR([1, 0.8, 0.6, 0.4, 0.2, 0]) > 0.39 && S.robustnessR([1, 0.8, 0.6, 0.4, 0.2, 0]) <= 0.5, "R of a straight line is about 0.4"); }
// Molloy-Reed: a random 3-regular graph has kappa 3 and collapses at f_c = 1/2
{ const ids = Array.from({ length: 8 }, (_, i) => String(i)), cube = S.graphOf(ids, [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [String(a), String(b)])), r = S.robustness(cube, 5); near(r.kappa, 3, 1e-9, "kappa"); near(r.fc, 0.5, 1e-9, "f_c"); }
{ const c = S.concentration([1, 1, 1, 1]); near(c.effective, 4, 1e-9, "four equal shares: four effective"); near(S.concentration([9, 1]).hhi, 0.82, 1e-9, "HHI"); assert.strictEqual(S.concentration([]).effective, 0); assert.strictEqual(S.busFactor(star), 1, "a star falls with its hub"); assert.strictEqual(S.busFactor(K5), 3, "K5 keeps half until three are gone"); }
// ---- SIR
{ const a = S.outbreakStats(K5, 0, 0, 50), b = S.outbreakStats(K5, 0, 1, 50); assert.strictEqual(a.mean, 1, "nothing spreads at T=0"); assert.strictEqual(b.mean, 5, "everything reached at T=1");
  near(S.outbreakStats(S.graphOf(["a", "b"], [["a", "b"]]), 0, 0.3, 20000).mean, 1.3, 0.02, "one link at T=.3: 1.3 on average");
  // a path from its end: P(reach the k-th) = T^k, in closed form
  const p = S.outbreakStats(line, 0, 0.5, 40000); near(p.hit[1], 0.5, 0.02, "T"); near(p.hit[2], 0.25, 0.02, "T^2"); near(p.hit[4], 0.0625, 0.01, "T^4");
  const e = S.epidemic(K5); near(e.excess, 4 - 1 + 0 + 0, 1e-9, "excess degree of K5"); near(e.Tc, 1 / 3, 1e-9, "T_c = 1/3 on a regular graph of degree 4"); near(e.TcSpectral, 0.25, 1e-3, "1/lambda1"); near(e.R0(0.5), 1.5, 1e-9, "R0");
  // the transition itself: on a big random graph a large outbreak is rare well below T_c and common well above it
  const n = 2000, rand = S.rng(9), ids = Array.from({ length: n }, (_, i) => String(i)), pairs = []; for (let i = 0; i < n * 3; i++) pairs.push([String(Math.floor(rand() * n)), String(Math.floor(rand() * n))]); const er = S.graphOf(ids, pairs), T0 = S.epidemic(er).Tc;
  near(T0, 1 / 6, 0.02, "an ER graph with mean degree 6 has T_c = 1/6"); const [lo, hi] = S.sweep(er, [T0 * 0.5, T0 * 2.5], 200); assert(lo.pBig < 0.02, `below threshold: ${lo.pBig}`); assert(hi.pBig > 0.4, `above threshold: ${hi.pBig}`); }
const again = S.outbreakStats(K5, 1, 0.4, 100, 5), twice = S.outbreakStats(K5, 1, 0.4, 100, 5); assert.strictEqual(again.mean, twice.mean, "the same vault must give the same answer");
// ---- the neuron, against its closed form
{ const P = S.LIF, one = S.graphOf(["a"], []);
  // no input: stays at rest and never fires
  { const net = S.lifNetwork(one, { inhibitory: 0 }); net.setDrive(0, 0); for (let i = 0; i < 40000; i++) assert(!net.step(0.5).length, "a resting neuron fired"); near(net.V[0], P.rest, 1e-6, "relaxes to rest"); }
  // below threshold never fires, however long; above it fires at the textbook rate
  { const net = S.lifNetwork(one, { inhibitory: 0 }); net.setDrive(0, 14.9); let n = 0; for (let i = 0; i < 20000; i++) n += net.step(0.5).length; assert.ok(n <= 1, "subthreshold input kept firing"); assert.strictEqual(S.lifRate(14.9), 0); }
  for (const mv of [18, 25, 40]) { const net = S.lifNetwork(one, { inhibitory: 0 }); net.setDrive(0, mv); const dt = 0.02, ms = 10000; let n = 0; for (let t = 0; t < ms; t += dt) n += net.step(dt).length; near(n / (ms / 1000), S.lifRate(mv), S.lifRate(mv) * 0.03 + 0.5, `rate at ${mv} mV`); }
  // refractory: two spikes are never closer than the period, even driven very hard
  { const net = S.lifNetwork(one, { inhibitory: 0 }); net.setDrive(0, 500); const times = []; for (let t = 0; t < 200; t += 0.05) net.step(0.05).forEach(f => times.push(f.t)); for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= P.refractory - 1e-9, "a spike inside the refractory period"); assert(times.length > 20); }
  // a spike arrives after the axon's delay, not before; excitation raises the target and inhibition lowers it
  const pair = S.graphOf(["a", "b"], [["a", "b"]]);
  for (const [inhib, sign] of [[0, 1], [1, -1]]) { const net = S.lifNetwork(pair, { inhibitory: inhib, delay: () => 8 }); net.V[0] = P.threshold + 1; net.V[1] = P.rest; let first; for (let t = 0; t < 4; t += 0.5) { const s = net.step(0.5); if (s.length && !first) first = s.find(f => f.i === 0); } assert(first, "the first cell should fire"); near(net.V[1], P.rest, 1e-9, "arrived before the axon's delay");
    for (let t = 4; t < 9; t += 0.5) net.step(0.5); assert(sign > 0 ? net.V[1] > P.rest + 0.5 : net.V[1] < P.rest - 2, `the post-synaptic change should have sign ${sign}, V is ${net.V[1]}`); }
  // a balanced network stays alive and irregular instead of seizing: the same drive with no inhibition fires far more
  const run = inh => { const n = 400, rand = S.rng(4), ids = Array.from({ length: n }, (_, i) => String(i)), ps = []; for (let i = 0; i < n * 6; i++) ps.push([String(Math.floor(rand() * n)), String(Math.floor(rand() * n))]); const net = S.lifNetwork(S.graphOf(ids, ps), { inhibitory: inh }); let c = 0; for (let t = 0; t < 1000; t++) c += net.step(1, () => 0.55).length; return c / n; };
  const balanced = run(0.2), runaway = run(0); assert(balanced > 0.5 && balanced < 40, `a balanced network's rate is ${balanced} Hz`); assert(runaway > balanced * 1.5, `inhibition should hold it down: ${runaway} against ${balanced}`); }
// ---- anatomy
{ const B = S.BRAIN; assert(B.z > B.x && B.x > B.y, "a brain is longest front to back, then wide, then high");
  // the surface itself, measured: an adult cerebrum is about 167 mm long, 140 wide and 93 high, and the folds and temporal poles mustn't spoil that
  { let ex = 0, ez = 0, y0 = 0, y1 = 0; for (let i = 0; i < 40000; i++) { const y = 1 - (i + 0.5) / 40000 * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963, x = Math.cos(th) * rr, z = Math.sin(th) * rr, r = S.cortexAt(x, y, z).r; ex = Math.max(ex, Math.abs(x * r)); ez = Math.max(ez, Math.abs(z * r)); y0 = Math.min(y0, y * r); y1 = Math.max(y1, y * r); } near(ex / ez * 167, 140, 8, "width in mm at a 167 mm length"); near((y1 - y0) / (2 * ez) * 167, 93, 10, "height in mm at a 167 mm length"); }
  const top = S.cortexAt(0.25, -1, 0).r, mid = S.cortexAt(0.005, -1, 0).r; assert(mid < top * 0.8, `the longitudinal fissure should cut in on top: ${mid} against ${top}`);
  assert.strictEqual(S.lobeOf(0.3, -0.3, 0.9), "frontal"); assert.strictEqual(S.lobeOf(0.3, -0.7, -0.45), "parietal"); assert.strictEqual(S.lobeOf(0.3, 0, -0.95), "occipital"); assert.strictEqual(S.lobeOf(0.8, 0.5, 0.1), "temporal");
  // over the sphere's directions, the lobes hold roughly their real shares of the surface
  const area = {}; let total = 0; for (let i = 0; i < 20000; i++) { const y = 1 - (i + 0.5) / 20000 * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963, x = Math.cos(th) * rr, z = Math.sin(th) * rr, c = S.cortexAt(x, y, z), w = c.r * c.r; if (y > 0.75) continue; area[c.lobe] = (area[c.lobe] || 0) + w; total += w; }
  for (const [k, want] of Object.entries(S.LOBE_SHARE)) near(area[k] / total, want, 0.1, `${k}'s share of the surface`);
  const sizes = Array.from({ length: 19 }, (_, i) => ({ id: i, size: 60 - i * 3 })), got = S.assignLobes(sizes), sum = {}; sizes.forEach(c => sum[got[c.id]] = (sum[got[c.id]] || 0) + c.size); const all = sizes.reduce((s, c) => s + c.size, 0); for (const [k, want] of Object.entries(S.LOBE_SHARE)) near(sum[k] / all, want, 0.05, `${k}'s share of the notes`);
  const spots = S.lobeSpots("frontal", 6); assert.strictEqual(spots.length, 6); assert(spots.every(p => S.lobeOf(...p) === "frontal"), "a spot left its lobe"); }
// ---- as a computer: reservoirs, against what's known
{ const ring = n => { const ids = Array.from({ length: n }, (_, i) => String(i)), ps = []; for (let i = 0; i < n; i++) for (const d of [1, 2]) ps.push([String(i), String((i + d) % n)]); return S.graphOf(ids, ps); };
  // by hand: a triangle's clustering is 1, a square's 0, a 4-regular ring's 1/2 (Watts & Strogatz's lattice, 3(k-2)/4(k-1))
  near(S.clustering(S.graphOf(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]])), 1, 1e-9, "a triangle's clustering"); near(S.clustering(cycle), 0, 1e-9, "a square's clustering"); near(S.clustering(ring(30)), 0.5, 1e-9, "a k=4 ring's clustering");
  near(S.meanPath(line, 1000), 2, 1e-9, "a path of 5: mean distance 2"); near(S.meanPath(K5, 1000), 1, 1e-9, "K5: 1");
  { const r = ring(60), q = S.rewired(r, 3); assert.deepStrictEqual(q.adj.map(a => a.length), r.adj.map(a => a.length), "a rewire changed someone's degree"); assert.strictEqual(q.edges.length, r.edges.length); assert(S.clustering(q) < 0.25, `rewiring should destroy a lattice's clustering: ${S.clustering(q)}`); }
  // the textbook picture: a lattice with a few long links is small-world, a random graph isn't
  { const n = 200, base = ring(n), ids = base.ids, ps = base.edges.map(([a, b]) => [ids[a], ids[b]]), rand = S.rng(8); for (let i = 0; i < 12; i++) ps.push([ids[Math.floor(rand() * n)], ids[Math.floor(rand() * n)]]); const sw = S.smallWorld(S.graphOf(ids, ps), 4), er = S.smallWorld(S.randomGraph(n, 400, 2), 4); assert(sw.sigma > 3, `small-world sigma ${sw.sigma}`); assert(er.sigma < 1.6, `a random graph's sigma ${er.sigma}`); }
  // the echo state: scaled to the radius asked for, and a stable reservoir's echo of an input fades
  { const g = S.randomGraph(60, 180, 4), r = S.reservoir(g, { rho: 0.9 }); near(S.largestAbsEigen(g, r.w, 400), 0.9, 0.02, "the spectral radius it was scaled to"); const rows = S.reservoir(g, { rho: 0.9, input: 0.5 }).run([...Array(200).fill(1), ...Array(300).fill(0)], 60, 0); assert(rows[rows.length - 1].slice(0, 60).every(v => Math.abs(v) < 0.01), "an input's echo should fade: the echo state property"); }
  // ridge recovers a known linear map
  { const rand = S.rng(2), rows = Array.from({ length: 300 }, () => Float64Array.from([rand(), rand(), 1])), w = S.ridge(rows, 1e-10)(rows.map(r => 2 * r[0] - 3 * r[1] + 0.5)); near(w[0], 2, 1e-3, "ridge w0"); near(w[1], -3, 1e-3, "ridge w1"); near(w[2], 0.5, 1e-3, "ridge w2"); }
  // Jaeger: capacity can't pass the readings and is well above zero on a healthy reservoir; with no links nothing is held past the input
  { const g = S.randomGraph(80, 240, 6), m = S.memoryCapacity(g, { read: 80, rho: 0.9, inputShare: 0.5 }); assert(m.mc <= 80 + 1e-9 && m.mc > 5, `memory capacity ${m.mc}`); assert(m.curve[0] > 0.5, `one step back should be easy: ${m.curve[0]}`); assert(m.curve[0] > m.curve[m.curve.length - 1], "recall should fade with delay");
    const none = S.memoryCapacity(S.randomGraph(80, 0, 6), { read: 80, inputShare: 0.5 }); assert(none.mc < 1.5, `with no links there's no memory: ${none.mc}`); }
  // NARMA-10: a fair reservoir clearly beats guessing the mean; a linkless one has no ten steps of memory to do it with
  { const y = S.narma(2000, S.rng(3)).y.slice(50); assert(y.every(v => isFinite(v)), "NARMA diverged"); const good = S.narmaError(S.randomGraph(150, 600, 5), { read: 150, inputShare: 0.5, rho: 0.95 }), none = S.narmaError(S.randomGraph(150, 0, 5), { read: 150, inputShare: 0.5 }); assert(good < 0.85, `NARMA-10 on a random reservoir: ${good}`); assert(good < none, `links should help: ${good} against ${none}`); }
}
// ---- ecology, against webs you can check by hand. i feeds on what it links to.
{ const T = out => S.trophic(out), lv = (t, i) => t.level[i]; const chain = T([[1], [2], []]); near(lv(chain, 0), 3, 1e-6, "fox"); near(lv(chain, 1), 2, 1e-6, "rabbit"); near(lv(chain, 2), 1, 1e-6, "grass"); near(chain.incoherence, 0, 1e-9, "a clean chain has no incoherence");
  // the omnivore triangle, by hand (MacKay's own small example): minimise (a-1)^2 + (b-1)^2 + (a+b-1)^2, so a = b = 2/3, F0 = 1/9
  const omni = T([[1, 2], [2], []]); near(lv(omni, 2), 1, 1e-6, "grass"); near(lv(omni, 1), 1 + 2 / 3, 1e-6, "rabbit"); near(lv(omni, 0), 1 + 4 / 3, 1e-6, "omnivore"); near(omni.incoherence, 1 / 9, 1e-6, "F0");
  // a pure cycle has no direction: all one height, incoherence 1, where Levine's sum never settles
  const cycle3 = T([[1], [2], [0]]); near(lv(cycle3, 0), 1, 1e-6, "a cycle"); near(lv(cycle3, 1), 1, 1e-6, "a cycle"); near(cycle3.incoherence, 1, 1e-6, "a cycle shows no direction");
  // two notes that link both ways: level, whatever else they link to
  const pair = T([[1], [0]]); near(lv(pair, 0), 1, 1e-6, "mutual links"); near(pair.incoherence, 1, 1e-6, "mutual links");
  // parts are separate: each starts at level 1
  const two = T([[1], [], [3], []]); near(lv(two, 2), 2, 1e-6, "second part"); near(lv(two, 3), 1, 1e-6, "second part");
  // the failure that prompted this: many loops must not run away. Heights stay bounded by the chain's own length.
  { const n = 400, rand = S.rng(12), out = Array.from({ length: n }, () => []); for (let i = 0; i < n * 4; i++) { const a = Math.floor(rand() * n), b = Math.floor(rand() * n); if (a !== b && !out[a].includes(b)) out[a].push(b); } const r = T(out); assert(r.maxLevel < 20, `a loopy random web should stay low: top ${r.maxLevel}`); assert(r.incoherence > 0.6 && r.incoherence <= 1.01, `and mostly incoherent: ${r.incoherence}`); assert(r.level.every(x => x >= 1 - 1e-9 && isFinite(x)), "a level left the range"); }
  // a real one-way hierarchy with a little noise stays coherent, and comes out in the right order
  { const layers = 6, per = 30, out = Array.from({ length: layers * per }, () => []), rand = S.rng(3); for (let L = 1; L < layers; L++) for (let i = 0; i < per; i++) for (let k = 0; k < 3; k++) out[L * per + i].push((L - 1) * per + Math.floor(rand() * per)); const r = T(out), avg = L => { let s = 0; for (let i = 0; i < per; i++) s += r.level[L * per + i]; return s / per; }; for (let L = 1; L < layers; L++) near(avg(L) - avg(L - 1), 1, 0.15, `layer ${L} climbs by one`); assert(r.incoherence < 0.1, `a layered web is coherent: ${r.incoherence}`); }
  near(chain.connectance, 2 / 9, 1e-9, "connectance is links over species squared"); assert.strictEqual(chain.basal, 1); assert.strictEqual(chain.top, 1); near(chain.maxLevel, 3, 1e-6, "top"); near(chain.meanLevel, 2.5, 1e-6, "mean level of the consumers"); assert.deepStrictEqual(T([]).level, []); near(T([[1, 2], [], []]).omnivory[0], 0, 1e-9, "feeding on one level is no omnivory"); assert(omni.omnivory[0] > 0.1, "feeding on two levels is"); }
// ---- Little's law, in cases by hand, and the law itself on messy data
{ const f = S.flow([{ born: "2026-01-01", done: "2026-01-11" }, { born: "2026-01-06", done: "2026-01-11" }], "2026-01-11", 10); near(f.L, 1.5, 1e-9, "10 + 5 task-days over 10 days: 1.5 in progress on average"); near(f.W, 7.5, 1e-9, "mean time in the window"); near(f.lambda, 0.2, 1e-9, "2 tasks over 10 days"); near(f.L, f.lambda * f.W, 1e-9, "L = lambda W"); near(f.throughput, 0.2, 1e-9, "both finished in the window"); assert.strictEqual(f.cumOut[10], 2); assert.strictEqual(f.cumIn[5], 2, "the second arrives on day 5");
  const open = S.flow([{ born: "2026-01-01", done: null }], "2026-01-11", 10); assert.strictEqual(open.openNow, 1, "still open today"); near(open.L, 1, 1e-9, "open the whole window"); assert.strictEqual(open.cumOut[10], 0);
  const before = S.flow([{ born: "2025-12-01", done: "2026-01-06" }], "2026-01-11", 10); near(before.L, 0.5, 1e-9, "only time inside the window counts"); assert.strictEqual(before.cumIn[10], 0, "it arrived before the window"); assert.strictEqual(before.cumOut[10], 1, "and left inside it");
  assert.strictEqual(S.flow([{ born: "2025-01-01", done: "2025-02-01" }], "2026-01-11", 10).L, 0, "gone before the window started");
  const rand = S.rng(5), rows = Array.from({ length: 800 }, () => { const b = Math.floor(rand() * 300), d = rand() < 0.2 ? null : b + Math.floor(rand() * 60), iso = n => new Date(Date.UTC(2026, 0, 1) + n * 864e5).toISOString().slice(0, 10); return { born: iso(b), done: d == null ? null : iso(d) }; }), m = S.flow(rows, "2026-10-01", 120); near(m.L, m.lambda * m.W, 1e-9, "Little's law holds on any data"); assert(m.L > 0 && m.wip.every(x => x >= 0), "sane"); }
{ const d = S.directedGraph(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "a"]]); assert.deepStrictEqual(S.reachCounts(d), [2, 2, 2, 0], "round a loop each reaches the other two; d reaches none"); }
{ const line2 = S.directedGraph(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "d"]]), r = S.reliance(line2); near(r[0].score, 1 + 0.5 + 0.25, 1e-9, "1, then a half, then a quarter"); assert.strictEqual(r[0].direct, 1); assert.strictEqual(r[0].reach, 3); near(r[3].score, 0, 1e-9, "the end of the line");
  const hub = S.directedGraph(["h", "a", "b", "c", "x", "y", "z"], [["h", "a"], ["h", "b"], ["h", "c"], ["x", "y"], ["y", "z"]]), s = S.reliance(hub); assert(s[0].score > s[4].score, "three direct dependents should outweigh a long thin chain of two"); }
// ---- wind, against Buys Ballot: round a low it turns counter-clockwise on a map with north up, and it leans in
{ const low = (x, y) => { const d = Math.hypot(x, y) || 1, [u, v] = S.surfaceWind(x / d, y / d); return { u, v, cross: x * v - y * u, inward: -(x * u + y * v) / d }; };   // pressure rises away from a low; y runs down the screen
  for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, -0.8]]) { const w = low(x, y); assert(w.cross < 0, 'round a low: counter-clockwise as seen, which is a negative cross product when y runs down'); near(w.inward, Math.sin(S.WIND_INFLOW), 1e-9, 'it leans in by the inflow angle'); near(Math.hypot(w.u, w.v), 1, 1e-9, 'speed follows the gradient'); }
  const [ue, ve] = S.surfaceWind(1, 0, 0); near(ue, 0, 1e-9, 'east of a low, no friction: no east-west part'); near(ve, -1, 1e-9, 'east of a low, it blows north, up the screen'); const [us] = S.surfaceWind(0, 1, 0); near(us, 1, 1e-9, 'south of a low it blows east');
  const hi = S.surfaceWind(-1, 0); assert(hi[0] > 0, 'east of a high, it spills outward'); }
// ---- one way: excess degree for a directed graph, in a case by hand
{ const d = S.directedGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['b', 'c'], ['a', 'a']]); assert.strictEqual(d.edges.length, 2, 'repeats and self-links dropped'); assert.deepStrictEqual(d.adj, [[1], [2], []]); near(S.epidemic(d).excess, 0.5, 1e-9, 'of 2 links, one leads to a note with 1 way out, one to a dead end'); const s = S.outbreakStats(d, 0, 1, 10); assert.strictEqual(s.mean, 3, 'it reaches down the chain'); assert.strictEqual(S.outbreakStats(d, 2, 1, 10).mean, 1, 'and never back up it'); }
// the network study: the same answer however it runs, with no worker to hand it runs here, and one result per network
{ const ids = Array.from({ length: 24 }, (_, i) => `n${i}`), pairs = ids.flatMap((id, i) => [[id, ids[(i + 1) % 24]], [id, ids[(i + 5) % 24]]]), g = S.graphOf(ids, pairs), g2 = S.graphOf(ids, pairs), g3 = S.graphOf(ids, pairs.slice(1));
  assert.strictEqual(S.graphKey(g), S.graphKey(g2), "the same links gave a different network key"); assert.notStrictEqual(S.graphKey(g), S.graphKey(g3), "a dropped link kept the network key");
  const first = S.netStudy(g), again = S.netStudy(g2); assert.strictEqual(first, again, "the same network was worked out twice"); assert.strictEqual(S.netStats.runs, 1);
  first.then(r => { assert.strictEqual(S.netStats.via, "here"); assert.deepStrictEqual(JSON.stringify(r), JSON.stringify(S.netStudyNow(S.graphOf(ids, pairs))), "stepping changed the answer"); assert.strictEqual(r.runs.yours.length, S.NET_RHOS.length); }).catch(e => { console.error(e); process.exit(1); }); }
// control chart: worked by hand. Moves of 1,2,1,1 average 1.25, so the limits are the mean 11 +/- 3.325
{ const X = S.xmr([10, 11, 13, 12, 11]); near(X.mean, 11.4, 1e-9, "XmR mean"); near(X.mr, 1.25, 1e-9, "XmR average move"); near(X.ucl, 11.4 + 2.66 * 1.25, 1e-9, "XmR upper limit"); assert.strictEqual(X.signals.length, 0, "no signal in a steady run");
  assert(S.xmr([10, 11, 10, 11, 10, 11, 10, 30]).signals.some(s => s.i === 7 && s.rule === "above"), "a point past the limit"); assert(S.xmr([1, 1, 2, 1, 2, 1, 1, 2, 9, 9, 10, 9, 10, 9, 10, 9]).signals.some(s => s.rule === "run-high"), "eight in a row above the centre");
  assert.strictEqual(S.xmr([0, 0, 1, 0, 0, 1]).lcl, 0, "a count's limit doesn't go below 0"); }
// Hill numbers: equal shares give the richness at every order; order rises as evenness rises
{ const e = S.hill([5, 5, 5, 5, 5]); near(e.q0, 5, 1e-9, "richness"); near(e.q1, 5, 1e-9, "q1, even"); near(e.q2, 5, 1e-9, "q2, even"); const u = S.hill([96, 1, 1, 1, 1]); assert(u.q1 < 1.4 && u.q2 < 1.1, "one topic taking nearly all"); near(S.hill([50, 50]).q1, 2, 1e-9, "two equal"); assert.strictEqual(S.hill([0, 0]).q1, 0, "nothing at all"); }
// k-core: a triangle with a tail. The triangle is the 2-core, the tail is 1, a lone note 0.
{ const c = S.kCore([[1, 2], [0, 2], [0, 1, 3], [2], []]); assert.deepStrictEqual([...c], [2, 2, 2, 1, 0], "triangle, tail, lone note"); assert.deepStrictEqual([...S.kCore([[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]])], [3, 3, 3, 3], "a complete four"); }
// Chao1 (Chao 1984): S + f1^2 / 2 f2; with no doubletons, the bias-corrected f1(f1-1)/2
{ const c = S.chao1([1, 1, 1, 1, 2, 2, 5]); assert.strictEqual(c.S, 7); assert.strictEqual(c.unseen, 4, "16 / 4"); assert.strictEqual(c.total, 11); assert.strictEqual(S.chao1([1, 1, 1, 3]).unseen, 3, "no doubletons"); }
// location quotient: in step is 1; twice its share is 2; nothing finished has no answer
{ near(S.locationQuotient(10, 100, 20, 200), 1, 1e-9, "in step"); near(S.locationQuotient(6, 100, 1, 33.33), 2, 0.01, "twice its share"); assert.strictEqual(S.locationQuotient(5, 10, 0, 10), null); }
// days to a limit: 70 up in 7 days is 10 a day, so 300 left is 30 days; no old sample, or not growing, no answer
{ const h = { "2026-10-26": { sync: 630 }, "2026-11-01": { sync: 699 } }; near(S.daysToLimit(h, "2026-11-02", "sync", 700, 1000), 30, 1e-9, "days to the limit"); assert.strictEqual(S.daysToLimit({ "2026-11-01": { sync: 1 } }, "2026-11-02", "sync", 700, 1000), null); assert.strictEqual(S.daysToLimit({ "2026-10-20": { sync: 800 } }, "2026-11-02", "sync", 700, 1000), null, "shrinking"); }
// areas: the shares, what's outside the window doesn't count, nothing finished has no quotient
{ const rows = [{ text: "a", event: false }, { text: "a", event: false }, { text: "b", event: false }, { text: "b", event: false }, { text: "a", event: true, done: "2026-11-01" }, { text: "b", event: true, done: "2026-11-01" }, { text: "b", event: true, done: "2026-10-30" }, { text: "b", event: true, done: "2026-10-29" }, { text: "a", event: true, done: "2020-01-01" }, { text: "x", event: false }];
  const B = S.areaBalance(rows, "2026-11-02", 90, t => (t === "x" ? null : t)); assert.strictEqual(B.open, 4); assert.strictEqual(B.done, 4, "old work outside the window"); assert.strictEqual(B.rows[0].area, "a"); near(B.rows[0].lq, 2, 1e-9, "half of open, a quarter of finished"); near(B.rows[1].lq, 2 / 3, 1e-9, "the other"); }
// aging: with nothing censored the 85% point is the time the survival curve reaches 15%; open tasks past it are listed oldest first
{ const done = Array.from({ length: 20 }, (_, i) => ({ t: i + 1, event: true })); assert.strictEqual(S.serviceLevel(done, 0.85).days, 17, "17 of 20 by day 17"); const L = S.serviceLevel([...done, { t: 40, event: false, text: "old" }, { t: 60, event: false, text: "older" }, { t: 2, event: false, text: "new" }], 0.85); assert.deepStrictEqual(L.late.map(r => r.text), ["older", "old"]); assert.strictEqual(S.serviceLevel([{ t: 5, event: false }], 0.85).days, null, "never reached"); }
console.log("ok - science: Kaplan-Meier and log-rank on the 6-MP trial, SIR and its threshold, cut points, percolation, the neuron's closed form, anatomy");
