#!/usr/bin/env node
// The design system holds, and what HQ asks of the plugin exists. Sizes, radii and motion come from tokens.css; colour comes from
// the theme, apart from named palettes; the accent is readable in both themes; no token is used that isn't defined; nothing
// styles the whole app from here. And every api.x that HQ and the shared actions call is one the real plugin provides: tests use
// stand-ins, which pass even when the real thing is missing.
//   node tests/test_design.js        exit 0 = pass
const fs = require("fs"), path = require("path"), env = require("./env"), stub = require("./plugin_stub");
const SRC = path.join(__dirname, "..", "src"), read = f => fs.readFileSync(path.join(SRC, f), "utf8");
const fails = [], strip = t => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));   // comments go, line numbers stay
const files = { "hq.css": strip(read("hq.css")), "view.css": strip(read("view.css")), "parts.css": strip(read("parts.css")) }, tokens = strip(read("tokens.css"));
const eachDecl = (text, prop, fn) => text.split("\n").forEach((line, i) => { for (const m of line.matchAll(new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;}]+)`, "g"))) fn(m[1].trim(), i + 1, line); });

for (const [file, text] of Object.entries(files)) {
  const at = (i, what) => fails.push(`${file}:${i} ${what}`);
  // every rule opens and closes: a half-deleted rule silently takes the next rule with it
  { let depth = 0, line = 1; for (const c of text) { if (c === "\n") line++; if (c === "{") depth++; if (c === "}" && --depth < 0) { at(line, "a } with no rule open"); break; } } if (depth > 0) at(line, "a rule never closes"); }
  // type: the scale, or relative to what's around it
  eachDecl(text, "font-size", (v, i) => { if (!/^(var\(--(ds-fs|vg-fs|font-ui)|inherit|0\b|[\d.]+em\b)/.test(v)) at(i, `font-size ${v} isn't on the scale`); });
  // shape
  eachDecl(text, "border-radius", (v, i) => { if (!/^(var\(--(ds-r|hq-r|vg-r)|0\b|50%|inherit)/.test(v)) at(i, `border-radius ${v} isn't on the scale`); });
  // motion
  eachDecl(text, "transition", (v, i) => { if (/\ball\b/.test(v)) at(i, "transition: all animates things nobody meant to"); if (/(^|[\s,])\.?\d*\.?\d+m?s\b/.test(v) && !/^width 1s linear/.test(v)) at(i, `transition ${v} has a literal duration`); });
  // depth
  eachDecl(text, "box-shadow", (v, i, line) => { if (/\d{2,}px/.test(v) && /rgba/.test(v) && !/9999px|is-neural|vg-hud/.test(line)) at(i, `box-shadow ${v} isn't on the scale`); });
  // colour: from the theme. What may be literal: a name in a token block, a mask, a game's or a legend's own swatches
  text.split("\n").forEach((line, n) => { const i = n + 1;
    if (!/#[0-9a-f]{3,8}\b/i.test(line) || /^\s*--/.test(line) || /--vg-hud[\w-]*:/.test(line) || /mask-image/.test(line) || /is-neural|\.vg-lg-|is-thermal|vg-nova|vg-ms-|vg-ach|vg-visbtn/.test(line)) return;
    if ((line.match(/#[0-9a-f]{3,8}\b/gi) || []).every(h => /^#(fff|000)$/i.test(h)) && /vg-track|vg-toast|vg-visbtn/.test(line)) return;
    at(i, `a literal colour: ${line.trim().slice(0, 90)}`); });
  // nothing here reaches outside the plugin's own elements
  text.split("\n").forEach((line, n) => { if (/^\s*(\*|button|input|a|body|html)\s*[,{:]/.test(line) && !/body:has\(\.vg-root\.is-playing\)/.test(line)) at(n + 1, `styles the whole app: ${line.trim().slice(0, 60)}`); });
  const important = (text.match(/!important/g) || []).length, cap = file === "hq.css" ? 10 : 32;
  if (important > cap) fails.push(`${file}: ${important} !important, more than ${cap}`);
}
// every own variable used is defined somewhere (a typo here fails silently in the browser)
{ const all = tokens + Object.values(files).join("\n"), defined = new Set([...all.matchAll(/(--(?:ds|hq|vg)-[\w-]+)\s*:/g)].map(m => m[1]));
  const setByCode = new Set(["--ds-accent-soft", "--hq-panel-top", "--hq-heat", "--vg-bottom", "--vg-under-today", "--hq-row", "--hq-feed-h"]);
  [...all.matchAll(/var\((--(?:ds|hq|vg)-[\w-]+)\s*([,)])/g)].forEach(m => { if (m[2] === ")" && !defined.has(m[1]) && !setByCode.has(m[1])) fails.push(`var(${m[1]}) is used but never defined`); }); }
// the accent is readable: as a button and as text, in both themes (WCAG AA is 4.5)
{ const lum = hex => { const h = hex.length === 4 ? "#" + [...hex.slice(1)].map(c => c + c).join("") : hex, c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const [light, dark] = tokens.split(".theme-dark .vg-root");
  const pick = (block, name) => (block.match(new RegExp(`${name}: (?:color-mix\\(in srgb, )?var\\([^,]+, (#[0-9a-f]{3,6})\\)`, "i")) || [])[1];
  for (const [theme, block] of [["light", light], ["dark", dark]]) {
    const bg = pick(block, "--ds-bg"), accent = pick(block, "--ds-accent"), ink = pick(block, "--ds-accent-ink"), text = pick(block, "--ds-accent-text"), body = pick(block, "--ds-text"), muted = pick(block, "--ds-muted");
    for (const [what, a, b, min] of [["a button's label", ink, accent, 4.5], ["accent text", text, bg, 4.5], ["body text", body, bg, 7], ["muted text", muted, bg, 4.5]]) {
      if (!a || !b) { fails.push(`${theme}: can't find ${what}'s colours in tokens.css`); continue; }
      if (ratio(a, b) < min) fails.push(`${theme}: ${what} is ${ratio(a, b).toFixed(2)}:1, under ${min}`); } } }
// every api the screens call exists on the real plugin
{ const { Plugin } = stub.load(env.rules), app = { vault: {}, workspace: { getLeavesOfType: () => [] } };
  const real = new Set(Object.keys(Object.assign(Object.create(Plugin.prototype), { app, settings: {} }).viewActions(null)));
  // what HQ's own view adds to them
  [...require("../build").pluginSource().matchAll(/\bapi\.([a-zA-Z]\w+) = /g)].forEach(m => real.add(m[1]));
  const hqDir = path.join(SRC, "hq"), sources = [...fs.readdirSync(hqDir).map(f => path.join(hqDir, f)), path.join(SRC, "actions.js")];
  const asked = new Set(sources.flatMap(f => [...fs.readFileSync(f, "utf8").matchAll(/\bapi\.([a-zA-Z]\w+)/g)].map(m => m[1])));
  const notActions = new Set(["call", "apply"]);
  const missing = [...asked].filter(k => !real.has(k) && !notActions.has(k));
  if (missing.length) fails.push(`HQ calls api.${missing.join(", api.")}, which the plugin doesn't provide`); }

if (fails.length) { console.log(`FAIL - design:\n  ${fails.slice(0, 40).join("\n  ")}${fails.length > 40 ? `\n  and ${fails.length - 40} more` : ""}`); process.exit(1); }
console.log("ok - design: sizes, radii, motion and colour from the system; readable accent; every api HQ calls exists");
