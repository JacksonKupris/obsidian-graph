#!/usr/bin/env node
// Words on HQ Today that persona-explainer could not say or check: a failed automation names when it last ran by date and time (not a day count that
// can disagree with the file), the card says why an alert is first, and the carried-over button says what it does.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const src = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
try {
  const R = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  const w = R.jobWords({ name: "nightly-backup", state: "failed", last: "2026-11-21T02:00:00", summary: "disk full" }, new Date("2026-11-22T09:01:00"));
  check(/Nov 21/.test(w.why) && /2:00 AM/.test(w.why), `a failed job says when it last ran by date and time: "${w.why}"`);
  check(!/days? ago/.test(w.why), `no day count that can disagree with the file: "${w.why}"`);
  check(/^Disk full\./.test(w.why), `the job's own summary starts with a capital: "${w.why}"`);
  const s = src("src/hq/10-shared.js");
  check(/it\.kind === "job"/.test(s.split("\n").find(l => l.includes("const whyNext")) || ""), "whyNext should say why an automation alert is first");
  check(!/Sweep them, oldest first/.test(src("src/hq/30-work.js")), 'the carried-over button still says "Sweep them"');
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "Today's words can be explained and checked", "today words");
