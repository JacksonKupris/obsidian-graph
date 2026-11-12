#!/usr/bin/env node
// Static audit of the source for repeated code and interface text that breaks the standing rules. No browser, a few seconds.
// A report, not a pass/fail test: the findings are the to-do list for moving copies into one shared piece (global-rules.md, DRY).
//   node tests/audit_repeats.js [--out file.md] [--min 3] [--gate]
//   blocks       3+ consecutive statements that appear again in another place (a copy to pull into a function)
//   lines        one long statement that appears 3+ times (a lookup, a label, a rule written out each time)
//   texts        the same interface string in 3+ places (one shared label)
//   reassurance  interface text that explains the machinery or reassures ("automatically", "right away", "no refresh")
//   views        a registered view missing what the picker and the hint need (name, short, icon, menu, hint)
// Writes .out/repeats-audit.md (and .json, compared with the last run: --gate fails when a count got worse).
const fs = require("fs"), path = require("path");
const env = require("./env");
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const OUT = arg("--out", env.out("repeats-audit.md")), MIN = +arg("--min", 3), SRC = path.join(env.ROOT, "src");

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = walk(SRC).map(f => ({ f, rel: path.relative(env.ROOT, f).replace(/\\/g, "/"), text: fs.readFileSync(f, "utf8") }));

// statements: comments cut off, blank lines dropped, whitespace squeezed
const stmts = files.map(({ rel, text }) => ({ rel, rows: text.split("\n").map((raw, i) => ({ n: i + 1, s: raw.replace(/\s\/\/.*$/, "").replace(/^\s*\/\/.*$/, "").replace(/\s+/g, " ").trim() })).filter(r => r.s.length > 0) }));

// ---- lines: long statements written more than once
const trivial = s => /^[)\]}\s;,]*$/.test(s) || /^(return|break|continue|else|try|finally)\b[ ;{]*$/.test(s) || /^\/\*|^\*/.test(s);
const lineAt = new Map();
for (const { rel, rows } of stmts) for (const { n, s } of rows) { if (s.length < 60 || trivial(s)) continue; (lineAt.get(s) || lineAt.set(s, []).get(s)).push(`${rel}:${n}`); }
const lines = [...lineAt].filter(([, w]) => w.length >= MIN).sort((a, b) => b[1].length * b[0].length - a[1].length * a[0].length);

// ---- blocks: a run of 3 statements (together 120+ characters) seen in two or more places; runs that overlap are merged
const K = 3, blockAt = new Map();
for (const { rel, rows } of stmts) for (let i = 0; i + K <= rows.length; i++) {
  const run = rows.slice(i, i + K), key = run.map(r => r.s).join("\n");
  if (key.length < 120 || run.every(r => trivial(r.s))) continue;
  (blockAt.get(key) || blockAt.set(key, []).get(key)).push({ rel, n: run[0].n });
}
const blocks = []; const used = new Set();
for (const [key, w] of [...blockAt].filter(([, w]) => w.length >= 2).sort((a, b) => b[0].length - a[0].length)) {
  const fresh = w.filter(x => ![0, 1, 2].some(d => used.has(`${x.rel}:${x.n + d}`)));
  if (fresh.length < 2) continue;
  fresh.forEach(x => [0, 1, 2].forEach(d => used.add(`${x.rel}:${x.n + d}`)));
  blocks.push({ key, where: fresh.map(x => `${x.rel}:${x.n}`) });
}

// ---- texts: the words the person reads (strings in the view, HQ, scenes and plugin), counted across places
const textAt = new Map();
for (const { rel, text } of files) text.split("\n").forEach((raw, i) => { if (/^\s*\/\//.test(raw)) return;
  for (const m of raw.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,80})\1/g)) { const t = m[2];
    if (/^[\w$.\-#:/\\[\]=>*,()~|^+%{} ]+$/.test(t) && !/ [a-z]+ [a-z]+ /i.test(t)) continue;   // selectors, paths and code, not sentences
    if (!/[A-Za-z]{3,} [A-Za-z]{2,}/.test(t) || /[<>{}]/.test(t) || /^\s*[#.\w-]+\s*[:{]/.test(t)) continue;
    (textAt.get(t) || textAt.set(t, []).get(t)).push(`${rel}:${i + 1}`); } });
const texts = [...textAt].filter(([, w]) => w.length >= MIN).sort((a, b) => b[1].length - a[1].length);

// ---- reassurance: the interface says what something is or what happened, and stops there
const SAYS = /(automatically|right away|straight away|immediately|in the background|no refresh|without (a )?refresh|joins the|🟢 ?Live|\bLive\b ?[·•]|don't worry|nothing to worry|behind the scenes|are re-?analysed|updates itself|takes? a moment)/i;
const reassurance = [];
for (const { rel, text } of files) text.split("\n").forEach((raw, i) => { if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return;
  for (const m of raw.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){8,200})\1/g)) if (SAYS.test(m[2]) && /[A-Za-z]{3,} [A-Za-z]{2,}/.test(m[2]) && !/[=;]|=>/.test(m[2])) reassurance.push({ at: `${rel}:${i + 1}`, text: m[2].slice(0, 90) }); });

// ---- views: every registered view carries what the picker, the legend and the hint need
const views = [], reg = files.find(x => x.rel.endsWith("view/20-maps.js"));
const REQUIRED = ["kind", "name", "icon", "menu", "hint"];
for (const { rel, text } of files) for (const m of text.matchAll(/^\s*view\("([\w-]+)",\s*\{([^\n]*)\}\s*\);?/gm)) {
  const missing = REQUIRED.filter(k => !new RegExp(`\\b${k}:`).test(m[2]));
  if (!/\bshort:/.test(m[2]) && !/\bkind:\s*"graph"/.test(m[2]) === false) { /* graph views show their name; short is optional */ }
  if (missing.length) views.push({ key: m[1], at: rel, missing });
}
const registered = files.reduce((n, { text }) => n + (text.match(/^\s*view\("/gm) || []).length, 0);

// ---- what to do about each kind
const HOW = {
  blocks: "Pull the run into one function in the shared layer (src/parts.js, src/shared.js, or the part's own helper) and call it from each place. A test on that function guards all of them.",
  lines: "One statement written out several times: make it a named constant or helper where the shared rules live, so a change reaches every view.",
  texts: "The same words in several places: keep the string once (a label table next to the shared frame) and read it everywhere, so wording changes in one place and stays consistent.",
  reassurance: "Say what it is or what happened, and stop (global-rules: Interface text). Move the mechanism into a code comment or the docs.",
  views: "Give the view what the picker and hint read (name, icon, menu, hint), so it can be found and explained like every other view.",
};
const rows = (list, f, max = 12) => list.slice(0, max).map(f).join("\n") + (list.length > max ? `\n- … and ${list.length - max} more (see the .json)` : "");
const out = [`# Repeats audit ${new Date().toISOString().slice(0, 10)}`, "",
  `${files.length} source files. ${blocks.length} repeated blocks, ${lines.length} repeated statements, ${texts.length} repeated texts, ${reassurance.length} reassuring texts, ${views.length} of ${registered} views missing registry fields.`, "",
  `## Repeated blocks`, HOW.blocks, "", rows(blocks, b => `- ${b.where.length}× ${b.where.slice(0, 4).join(", ")}${b.where.length > 4 ? " …" : ""}\n  \`${b.key.split("\n")[0].slice(0, 110)}\``), "",
  `## Repeated statements (${MIN}+ places)`, HOW.lines, "", rows(lines, ([s, w]) => `- ${w.length}× ${w.slice(0, 3).join(", ")}${w.length > 3 ? " …" : ""}\n  \`${s.slice(0, 110)}\``), "",
  `## Repeated texts (${MIN}+ places)`, HOW.texts, "", rows(texts, ([t, w]) => `- ${w.length}× "${t}": ${w.slice(0, 3).join(", ")}${w.length > 3 ? " …" : ""}`), "",
  `## Reassuring or explaining texts`, HOW.reassurance, "", rows(reassurance, r => `- ${r.at}: "${r.text}"`, 30), "",
  `## Views missing registry fields`, HOW.views, "", views.length ? rows(views, v => `- ${v.key} (${v.at}): ${v.missing.join(", ")}`) : "None.", ""];
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, out.join("\n"));

const now = { blocks: blocks.length, lines: lines.length, texts: texts.length, reassurance: reassurance.length, views: views.length };
const JSON_OUT = OUT.replace(/\.md$/, ".json"), prev = fs.existsSync(JSON_OUT) ? JSON.parse(fs.readFileSync(JSON_OUT, "utf8")).counts : null;
fs.writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), counts: now, blocks, lines: lines.map(([s, w]) => ({ s, w })), texts: texts.map(([t, w]) => ({ t, w })), reassurance, views }, null, 1));
const worse = prev ? Object.keys(now).filter(k => now[k] > (prev[k] ?? now[k])) : [];
console.log(Object.entries(now).map(([k, v]) => `${k} ${v}${prev ? ` (was ${prev[k]})` : ""}`).join(", "));
console.log(`Wrote ${OUT}`);
if (process.argv.includes("--gate") && worse.length) { console.log(`FAIL - more than last run: ${worse.join(", ")}`); process.exitCode = 1; }
