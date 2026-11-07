// Bodies change each other's orbits only on close passes (hyperbolic deflection), and the sky stays bound without a constant coupling.
// Runs the real stepBodies / passBys from src/view/50-cosmos.js headless, with constants swapped in the extracted text.
// node tests/test_cosmos_coupling.js        exit 0 = pass
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/view/50-cosmos.js"), "utf8");
const a = source.indexOf("  const GM_UNIT"), b = source.indexOf("  // let go of a dragged body");
assert(a > 0 && b > a, "the physics block is missing from 50-cosmos.js");
const block = source.slice(a, b);
const need = ["BODY_COUPLE = 0,", "DYN_FRICTION = 0.0003", "PASS_BY = 1, PASS_REACH = 0.5", "setOrbit(b, p, p ? 230 : Math.min(r, 1400), 0, Math.atan2(b.ry, b.rx), 1);"];
for (const n of need) assert(block.includes(n), "source changed, cannot find: " + n);

function sky({ coupling = 0, friction = 0.0003, passBy = 1, reach = 0.5, bodies }) {
  const code = block.replace(need[0], `BODY_COUPLE = ${coupling},`).replace(need[1], `DYN_FRICTION = ${friction}`).replace(need[2], `PASS_BY = ${passBy}, PASS_REACH = ${reach}`)
    .replace(need[3], `{ globalThis.__flung.push(b.id); setOrbit(b, p, p ? 230 : Math.min(r, 1400), 0, Math.atan2(b.ry, b.rx), 1); }`);
  const cos = { bodies: bodies.map(x => ({ ...x })), auto: { motion: true }, arranged: 0 };
  const ctx = { cos, Math, __flung: [], hash: s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), nodes: [], special: () => false, matchQuery: () => () => false,
    bodyCaptured: new Map(), anchorNb: () => new Set(), trails: new Map(), noteTrails: new Map(), cosmosCapture() {}, persistSoon() {}, kick() {}, toast() {}, drag: null };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(code + "\nthis.api = { arrangeOrbits, stepBodies, passBys, setOrbit, count: () => passByCount, gmOf };", ctx);
  return { cos, api: ctx.api, flung: ctx.__flung };
}
const B = (id, type, extra) => ({ id, type, x: 0, y: 0, target: id, mass: 1, ...extra });
// two stars 400 units from the core, passing each other with the given miss distance and relative speed
const two = (speed, offset) => [B("s1", "star", { x: 400, y: offset / 2, rx: 400, ry: offset / 2, vx: speed / 2, vy: 0 }), B("s2", "star", { x: 400, y: -offset / 2, rx: 400, ry: -offset / 2, vx: -speed / 2, vy: 0 })];
const rel = c => [c.bodies[0].vx - c.bodies[1].vx, c.bodies[0].vy - c.bodies[1].vy];
// passBys alone: first the bodies approach (remembered, nothing happens), then they have passed periapsis
function flyby(passBy, { speed = 4, offset = 60 } = {}) {
  const s = sky({ passBy, bodies: two(speed, offset) }), { api } = s, [b1, b2] = s.cos.bodies, mom = () => [0, 1].map(k => ["vx", "vy"].map(v => b1[v] * api.gmOf(b1) + b2[v] * api.gmOf(b2))[k]);
  b1.x = 400 - 50; b2.x = 400 + 50; api.passBys();   // b1 is behind b2, closing on it
  b1.x = 400 + 1; b2.x = 400 - 1;                    // b1 is ahead: periapsis crossed
  const p0 = mom(), w0 = rel(s.cos); api.passBys();
  return { w0, w1: rel(s.cos), p0, p1: mom(), count: api.count() };
}
// 1. a close pass turns the relative velocity, keeps its size and the pair's momentum; switched off, nothing changes
{
  const f = flyby(1), sp = w => Math.hypot(w[0], w[1]), turn = Math.acos((f.w0[0] * f.w1[0] + f.w0[1] * f.w1[1]) / (sp(f.w0) * sp(f.w1)));
  assert.equal(f.count, 1, "a close pass between two stars should count as one event");
  assert(turn > 0.05, `the pass should bend the orbit, turned ${turn} rad`);
  assert(Math.abs(sp(f.w1) / sp(f.w0) - 1) < 1e-9, "the relative speed must be kept");
  assert(Math.hypot(f.p1[0] - f.p0[0], f.p1[1] - f.p0[1]) < 1e-9, "momentum must be conserved");
  const off = flyby(0); assert.equal(off.count, 0); assert.deepEqual(off.w1, off.w0, "with pass-by off the velocities are untouched");
  // a closer, slower pass bends more
  const near = flyby(1, { offset: 30, speed: 3 }), turnNear = Math.acos((near.w0[0] * near.w1[0] + near.w0[1] * near.w1[1]) / (sp(near.w0) * sp(near.w1)));
  assert(turnNear > turn, `a closer, slower pass should bend more (${turnNear} vs ${turn})`);
}
// 2. a distant pass does nothing
{ const f = flyby(1, { offset: 4000 }); assert.equal(f.count, 0, "a pass beyond a mutual Hill radius is not an event"); assert.deepEqual(f.w1, f.w0); }
// 3. a pair bound to each other is left to the integration
{ const f = flyby(1, { speed: 0.05 }); assert.equal(f.count, 0, "bound pairs are not deflected"); }
// 4. in the arranged sky, with no constant coupling and no fudge friction, the sky stays bound and passes happen
const skies = {
  small: [B("s1", "star"), B("s2", "star"), B("s3", "star")],
  default: [B("s1", "star"), B("s2", "star"), B("s3", "star"), B("s4", "star"), B("bin", "binary", { target: ["a", "b"] }), B("p1", "planet"), B("p2", "planet"), B("bh", "blackhole"), B("rep", "repulsor")],
  crowded: [..."12345678".split("").map(i => B("s" + i, "star")), B("bin1", "binary", { target: ["a", "b"] }), B("bin2", "binary", { target: ["c", "d"] }), B("bh1", "blackhole"), B("bh2", "blackhole"), B("rep", "repulsor")],
};
const FRAMES = 100000;   // about 28 minutes at 60 fps
for (const [name, bodies] of Object.entries(skies)) {
  const s = sky({ bodies }); s.api.arrangeOrbits(false);   // the source's own defaults
  for (let f = 0; f < FRAMES; f++) { s.api.stepBodies(0.5); s.api.stepBodies(0.5); }
  assert(s.cos.bodies.every(x => Number.isFinite(x.x) && Number.isFinite(x.y)), name + ": a body went to NaN");
  assert.equal(s.flung.length, 0, `${name}: ${s.flung.length} bodies were flung out (first ${s.flung[0]})`);
  console.log(`ok - ${name}: ${FRAMES} frames, ${s.api.count()} passes, none flung out`);
}
// the reason the default is 0: the old 6% constant pull loses a body from the crowded arranged sky in this time
{ const old = sky({ coupling: 0.06, bodies: skies.crowded }); old.api.arrangeOrbits(false);
  for (let f = 0; f < FRAMES; f++) { old.api.stepBodies(0.5); old.api.stepBodies(0.5); }
  assert(old.flung.length >= 1, "the 6% coupling no longer loses a body from the crowded sky: re-measure before keeping the default at 0"); }
// 5. random crossing skies, no constant coupling: passes do happen (and not with pass-by off), and almost nothing is flung out.
//    Measured over 12 skies of 30,000 frames: reach 1 gave 111 passes and 2 flung bodies per sky; 0.5 gave 6 passes and 0.1; 0.25 gave none.
{
  const lcg = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), crowd = [..."1234".split("").map(i => B("s" + i, "star")), B("bin", "binary", { target: ["a", "b"] }), B("bh", "blackhole"), B("rep", "repulsor")];
  const totals = passBy => { let passes = 0, flung = 0; for (let seed = 1; seed <= 8; seed++) { const r = lcg(seed * 77), s = sky({ coupling: 0, passBy, bodies: crowd });
    s.cos.bodies.forEach(x => s.api.setOrbit(x, null, 200 + r() * 900, r() * 0.3, r() * 6.28, r() < 0.5 ? 1 : -1));
    for (let f = 0; f < 30000; f++) { s.api.stepBodies(0.5); s.api.stepBodies(0.5); } passes += s.api.count(); flung += s.flung.length; } return { passes, flung }; };
  const on = totals(1), off = totals(0);
  assert(on.passes >= 8, `8 crossing skies should show passes, saw ${on.passes}`); assert.equal(off.passes, 0);
  assert(on.flung <= off.flung + 3, `pass-by flung out ${on.flung} bodies in 8 skies (${off.flung} without it)`);
  console.log(`ok - 8 crossing skies: ${on.passes} passes, ${on.flung} flung out (${off.flung} without pass-by)`);
}
console.log("ok - pass-by: deflection, conservation, off switch, reach, bound pairs, bound sky");
