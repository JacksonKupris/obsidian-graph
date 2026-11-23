#!/usr/bin/env node
// A card is one item, so its label names one thing ("Automation alert"), not the plural list name ("automation alerts"). VGRules.kindName is the
// one word per kind, and every kind that has a plural (kindWords) has a singular.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
try {
  const R = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof R.kindName === "function", "VGRules.kindName should exist");
  if (typeof R.kindName === "function") {
    check(R.kindName("job") === "Automation alert", `job: "${R.kindName("job")}"`);
    check(R.kindName("carried") === "Carried-over task", `carried: "${R.kindName("carried")}"`);
    for (const k of ["link", "map", "write", "hub", "chart", "adopt", "rename", "task", "plan", "approval", "review", "inbox", "job", "backlog", "report"]) {
      const n = R.kindName(k); check(n && n !== R.kindWords(k) && /^[A-Z]/.test(n), `${k}: "${n}" should be a capitalised singular, not "${R.kindWords(k)}"`);
    }
  }
  const s = fs.readFileSync(path.join(__dirname, "..", "src/hq/29-layouts-more.js"), "utf8");
  check(/VGRules\.kindName\(cur1\.kind\)/.test(s), "the Triage card eyebrow should use VGRules.kindName");
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "a card names its kind in the singular", "kind name");
