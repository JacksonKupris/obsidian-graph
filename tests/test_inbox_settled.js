#!/usr/bin/env node
// An inbox note that a decision note links to, or that is marked done, is not waiting on the person: it stays out of Needs you.
// A note with nothing settled about it still shows.
const assert = require("assert"), env = require("./env"), build = require("../build");
const VGRules = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();   // the vault's rules, so the Inbox folder and decision type are known
const inbox = VGRules.folders.inbox, at = p => p.replace("Inbox/", inbox + "/");   // the test vault names its inbox folder in its own rules
const note = (path, text) => ({ path: at(path), text });
const files = [
  note("Inbox/Open Plan 2026-11-01.md", "# Open Plan\n\nStill to do.\n"),
  note("Inbox/Decided Plan 2026-11-02.md", "# Decided Plan\n\nA plan.\n"),
  note("Inbox/Done Plan 2026-11-03.md", "---\nstatus: done\n---\n# Done Plan\n"),
  note("Inbox/Shipped Plan 2026-11-04.md", "---\nstatus: shipped\n---\n# Shipped Plan\n"),
  note("Inbox/Draft Plan 2026-11-05.md", "---\nstatus: draft\n---\n# Draft Plan\n"),
  note("Systems/Work/Decisions/Plan Approved 2026-11-02.md", "---\ntype: decision\ndecided_by: Jackson\nstatus: active\n---\n# Plan Approved\n\nDecided in [[Decided Plan 2026-11-02]] and carried out.\n"),
];
const hq = VGRules.hqGather(files, { today: "2026-11-23" });
const list = VGRules.todayList({ nodes: [], hq }, { today: "2026-11-23" }).filter(i => i.kind === "inbox").map(i => i.path.replace(inbox + "/", "Inbox/"));
assert.ok(list.includes("Inbox/Open Plan 2026-11-01.md"), `an unsettled inbox note still shows: ${JSON.stringify(list)}`);
assert.ok(list.includes("Inbox/Draft Plan 2026-11-05.md"), `a draft is still waiting: ${JSON.stringify(list)}`);
assert.ok(!list.includes("Inbox/Decided Plan 2026-11-02.md"), `a note a decision links to is settled: ${JSON.stringify(list)}`);
assert.ok(!list.includes("Inbox/Done Plan 2026-11-03.md"), `a note marked done is settled: ${JSON.stringify(list)}`);
assert.ok(!list.includes("Inbox/Shipped Plan 2026-11-04.md"), `a note marked shipped is settled: ${JSON.stringify(list)}`);
console.log("ok - settled inbox notes stay out of Needs you");
