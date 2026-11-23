#!/usr/bin/env node
// "From your notes" on a Triage card: a note that matches only one of two words (the "gardener: late" alert pulling up a menu-config note that says
// "Run Gardener") is not related, and every note it does show says why it matched. One rule (VGRules.relatedNotes), used by every surface.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
try {
  const VGRules = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof VGRules.relatedNotes === "function", "VGRules.relatedNotes should exist");
  if (typeof VGRules.relatedNotes === "function") {
    const hit = (p, heading, snippet, why = ["text"]) => ({ path: p, heading, snippet, why, score: 5 });
    const hits = [
      hit("Menus/Oldhome.md", "Oldhome", "Oldhome / Vault / name Run Gardener type command action Shell commands"),
      hit("Systems/Gardener Report 2026-11-08.md", "Gardener", "The gardener was late: it did not run on 11-07"),
      hit("Systems/Late Fees.md", "Late Fees", "Late fees apply after 30 days", ["name"]),
    ];
    const out = VGRules.relatedNotes(hits, "gardener: late");
    check(!out.some(h => h.path === "Menus/Oldhome.md"), "a note that matches one of two words is not related");
    check(out.some(h => h.path === "Systems/Gardener Report 2026-11-08.md"), "a note that mentions both words stays");
    check(out.every(h => typeof h.reason === "string" && h.reason.length > 3), "every related note says why it matched: " + JSON.stringify(out.map(h => h.reason)));
    check(VGRules.relatedNotes(hits, "gardener").length === 2, "a one-word question keeps the notes that have the word");
    check(VGRules.relatedNotes([hit("A.md", "A", "---\nname: x\ntype: command\naction: shell\n---")], "shell command").length === 0, "raw property keys are not a reason");
    // the shared place: the Triage panel calls it, it does not filter on its own
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "hq", "10-shared.js"), "utf8");
    check(/VGRules\.relatedNotes\(/.test(src), "the Triage panel (contextPanel/loadContext) should use VGRules.relatedNotes");
  }
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails);
