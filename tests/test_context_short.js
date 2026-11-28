#!/usr/bin/env node
// "From your notes" shows a short line per related note, not a paragraph: VGRules.snippetLine cuts at a word with an ellipsis, and the panel uses it.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
try {
  const R = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof R.snippetLine === "function", "VGRules.snippetLine should exist");
  if (typeof R.snippetLine === "function") {
    const long = "We looked at the warehouse handbook and the receiving checklist and decided the two should be merged into a single page with one owner so that nobody has to guess which copy is current when a new hire asks.";
    const out = R.snippetLine(long);
    check(out.length <= 141 && out.endsWith("…"), `a long snippet is cut with an ellipsis: ${out.length} chars "${out.slice(-20)}"`);
    check(long.startsWith(out.slice(0, -1)) && long[out.length - 1] === " ", "it cuts at a word and keeps the start");
    check(R.snippetLine("- [ ] **Short** one") === "Short one", `a short snippet stays whole and plain: "${R.snippetLine("- [ ] **Short** one")}"`);
  }
  const s = fs.readFileSync(path.join(__dirname, "..", "src/hq/10-shared.js"), "utf8");
  check(/VGRules\.snippetLine\(h\.snippet\)/.test(s), "the context panel should show VGRules.snippetLine(h.snippet)");
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "related-note snippets are one short line", "context short");
