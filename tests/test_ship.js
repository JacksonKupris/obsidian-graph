#!/usr/bin/env node
// npm run ship: the rule for what to do next with a pull request, from what GitHub reports.
//   node tests/test_ship.js        exit 0 = pass
const { checks, finish } = require("./kit");
const { plan } = require("../scripts/ship");
const { fails, ok: check } = checks();
const ok = c => ({ name: c, conclusion: "SUCCESS" }), bad = c => ({ name: c, conclusion: "FAILURE" }), run = c => ({ name: c, status: "IN_PROGRESS", conclusion: "" });
const pr = (o = {}) => ({ state: "OPEN", mergeable: "MERGEABLE", statusCheckRollup: [ok("test (1)"), ok("test (2)")], ...o });
check(plan(pr()).action === "merge", "passing checks merge");
check(plan(pr({ statusCheckRollup: [ok("test (1)"), run("test (2)")] })).action === "wait", "a running check waits");
const f = plan(pr({ statusCheckRollup: [ok("test (1)"), bad("test (3)")] }));
check(f.action === "stop" && f.why.includes("test (3)"), "a failed check stops and names the job: " + JSON.stringify(f));
check(plan(pr({ mergeable: "CONFLICTING" })).action === "stop", "a conflict stops");
check(plan(pr({ statusCheckRollup: [] })).action === "stop", "no checks is not a pass");
check(plan(pr({ state: "MERGED" })).action === "release", "an already merged pull request goes straight to release");
check(plan(pr({ state: "CLOSED" })).action === "stop", "a closed pull request stops");
check(plan(null).action === "stop", "no answer from GitHub stops, it is not read as 'running'");
finish(fails, "ship: merge, wait, stop and release decisions");
