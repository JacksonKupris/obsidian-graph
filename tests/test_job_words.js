#!/usr/bin/env node
// An automation that is late or failed reads as a sentence anyone follows: "Gardener hasn't run for 4 days", not "gardener: late" with a bare
// summary. One rule (VGRules.jobWords) gives the title and the reason to every surface that lists an automation problem.
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
try {
  const VGRules = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof VGRules.jobWords === "function", "VGRules.jobWords should exist");
  if (typeof VGRules.jobWords === "function") {
    const now = new Date("2026-11-22T12:00:00");
    const late = VGRules.jobWords({ name: "gardener", state: "late", last: "2026-11-18T12:00:00", every_hours: 24, summary: "" }, now);
    check(/gardener/i.test(late.title) && !/: late$/.test(late.title), `late title reads as a sentence: "${late.title}"`);
    check(/4 days/.test(late.title + " " + late.why), `late says how long: "${late.title}" / "${late.why}"`);
    check(/every day|daily|every 24 hours|each day/i.test(late.why), `late says how often it should run: "${late.why}"`);
    const failed = VGRules.jobWords({ name: "backup", state: "failed", last: "2026-11-21T09:00:00", summary: "disk full" }, now);
    check(/backup/i.test(failed.title) && /failed/i.test(failed.title) && !/: failed$/.test(failed.title), `failed title: "${failed.title}"`);
    check(/disk full/.test(failed.why) && /Nov|11-21|yesterday|1 day/i.test(failed.why), `failed says what happened and when: "${failed.why}"`);
    const hours = VGRules.jobWords({ name: "sync", state: "late", last: "2026-11-22T00:00:00", every_hours: 2, summary: "" }, now);
    check(/every 2 hours/.test(hours.why), `an every-2-hours job says so: "${hours.why}"`);
  }
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails);
