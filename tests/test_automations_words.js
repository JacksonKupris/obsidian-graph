#!/usr/bin/env node
// The Automations page writes a last run the way the Today card does (one date style from one function), drops machinery words, and doesn't say the
// schedule twice.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const src = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
try {
  const R = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof R.whenWords === "function", "VGRules.whenWords should be the one place a run time is written");
  if (R.whenWords) {
    check(R.whenWords("2026-11-21T02:00:00") === "Nov 21, 2:00 AM", `whenWords: "${R.whenWords("2026-11-21T02:00:00")}"`);
    check(R.whenWords("") === "", "no time gives an empty string");
    const w = R.jobWords({ name: "n", state: "failed", last: "2026-11-21T02:00:00", summary: "x" }, new Date("2026-11-22T09:00:00"));
    check(w.why.includes(R.whenWords("2026-11-21T02:00:00")), `jobWords uses whenWords: "${w.why}"`);
  }
  const s = src("src/hq/30-work.js"), line = s.split("\n").find(l => l.includes("Last recorded run")) || "";
  check(!/toLocaleString\(\)/.test(line), "Automations still writes the date with the browser's default style");
  check(s.includes("!j.when && j.every_hours"), "Automations repeats the schedule when the note already gives one");
  check(!/\(cron\)/i.test(s), "no machinery words in the page source");
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "Automations words are one style and say each thing once", "automations words");
