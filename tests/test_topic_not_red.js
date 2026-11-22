#!/usr/bin/env node
// Red means "needs attention" (the warning ring, the tasks colour). No topic colour may be red, in the light or the neon set, so a red node
// is never mistaken for a problem and a topic is never mistaken for one.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit");
const { fails, ok: check } = checks();
const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return null; const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
try {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "view", "00-core.js"), "utf8");
  for (const name of ["PALETTE", "NEON"]) {
    const m = src.match(new RegExp("const " + name + " = \\[([^\\]]*)\\]")), cols = m ? m[1].match(/#[0-9a-fA-F]{6}/g) : null;
    check(cols && cols.length === 16, name + " should list 16 topic colours (got " + (cols && cols.length) + ")");
    for (const c of cols || []) { const h = hue(c); check(h === null || (h > 20 && h < 340), `${name} ${c} is red (hue ${h && Math.round(h)}): red is the attention colour`); }
  }
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails);
