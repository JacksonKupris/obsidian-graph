// The two stars of a binary integrate their own orbit, and notes linked to both are test particles in both fields.
// node tests/test_cosmos_binary.js        exit 0 = pass
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/view/50-cosmos.js"), "utf8");
const a = source.indexOf("  // ---- binary physics"), b = source.indexOf("  // ---- end binary physics");
assert(a > 0 && b > a, "the binary physics block is missing from 50-cosmos.js");
const ctx = { SOFT2: 36, Math, out: null };
vm.createContext(ctx);
vm.runInContext(`${source.slice(a, b)}\nthis.api = { binInit, binStep, binAccel };`, ctx);
const { binInit, binStep, binAccel } = ctx.api;
const GM = 24, SEP = 156, energy = (r, gm) => 0.5 * (r.vx ** 2 + r.vy ** 2) - 2 * gm / Math.hypot(r.x, r.y), ang = r => r.x * r.vy - r.y * r.vx;

// 1. energy and angular momentum hold over 10,000 steps, for a circular and for an eccentric binary
for (const squash of [1, 0.8]) {
  const bin = binInit(GM, SEP, 1.3); bin.vx *= squash; bin.vy *= squash;
  const E0 = energy(bin, GM), L0 = ang(bin); let worstE = 0, worstL = 0;
  for (let i = 0; i < 10000; i++) { binStep(bin, GM, 1); worstE = Math.max(worstE, Math.abs(energy(bin, GM) / E0 - 1)); worstL = Math.max(worstL, Math.abs(ang(bin) / L0 - 1)); }
  assert(worstE < 0.01, `energy drifted ${worstE} (squash ${squash})`); assert(worstL < 1e-9, `angular momentum drifted ${worstL}`);
}
// 2. a circular binary stays circular: the separation is the same after many laps
{ const bin = binInit(GM, SEP, 0); for (let i = 0; i < 10000; i++) binStep(bin, GM, 1); assert(Math.abs(Math.hypot(bin.x, bin.y) / SEP - 1) < 0.01, "a circular binary changed its separation"); }

// 3. a note in both fields: run a particle with the stars moving, return its worst distance from the barycentre as a fraction of the start
function fly(px, py, vx, vy, steps = 10000) {
  const bin = binInit(GM, SEP, 0), p = { x: px, y: py, vx, vy }; let lo = Infinity, hi = 0, escaped = false;
  for (let i = 0; i < steps; i++) {
    let [ax, ay] = binAccel(bin, GM, p.x, p.y); p.vx += ax / 2; p.vy += ay / 2; p.x += p.vx; p.y += p.vy; binStep(bin, GM, 1);
    [ax, ay] = binAccel(bin, GM, p.x, p.y); p.vx += ax / 2; p.vy += ay / 2;
    const r = Math.hypot(p.x, p.y); lo = Math.min(lo, r); hi = Math.max(hi, r); if (r > 5000) { escaped = true; break; }
  }
  return { lo, hi, escaped };
}
{ const R = SEP * 2.6 + 10, v = Math.sqrt(2 * GM / R), s = fly(R, 0, 0, v);   // what the plugin starts a linked-to-both note on
  assert(!s.escaped && s.lo > R * 0.8 && s.hi < R * 1.2, `a circumbinary note left its orbit: ${s.lo.toFixed(0)} to ${s.hi.toFixed(0)} from ${R.toFixed(0)}`); }
// 4. L4 for equal masses is unstable (Routh's limit is a mass ratio under 0.0385), so a note placed there must drift away
{ const R = SEP * 0.866, w = Math.sqrt(2 * GM / SEP ** 3), th = Math.PI / 3, s = fly(R * Math.cos(th), R * Math.sin(th), -w * R * Math.sin(th), w * R * Math.cos(th));
  assert(s.escaped || s.hi > R * 1.5 || s.lo < R * 0.5, `an L4 note should not stay: ${s.lo.toFixed(0)} to ${s.hi.toFixed(0)}`); }
console.log("ok - binary leapfrog conserves energy and angular momentum; circumbinary notes stay bound; L4 is unstable for equal stars");
