#!/usr/bin/env node
// npm run ship: the rule for what to do next with a pull request, from what GitHub reports.
//   node tests/test_ship.js        exit 0 = pass
const { checks, finish } = require("./kit");
const { plan, allPlan, allEnd, releaseOutcome } = require("../scripts/ship");
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
// --all: which pull requests it takes, and the line it ends with
const ap = allPlan([{ number: 9, draft: false }, { number: 7, draft: true }, { number: 3, draft: false }]);
check(JSON.stringify(ap.take) === "[3,9]" && ap.skipped.length === 1 && ap.skipped[0].includes("#7"), "--all takes ready pull requests oldest first and names the drafts: " + JSON.stringify(ap));
const rel = { ok: true, done: "Released 1.2.3: x" };
check(allEnd([], [3, 9], 2, rel).line === "SHIPPED #3, #9: Released 1.2.3: x" && allEnd([], [3, 9], 2, rel).ok, "everything merged and released");
const part = allEnd(["NOT SHIPPED #9: checks failed"], [3], 1, rel);
check(!part.ok && part.line.startsWith("SHIPPED #3") && part.line.includes("1 not shipped"), "one failed pull request: the rest ship, and the run does not report success: " + JSON.stringify(part));
check(allEnd([], [], 2, rel).line.startsWith("SHIPPED what was already merged"), "nothing open but main is ahead of the last release: it releases");
const none = allEnd([], [], 0, null);
check(none.ok && none.line.startsWith("NOTHING TO RELEASE"), "nothing open and nothing waiting is not an error");
check(!allEnd(["NOT SHIPPED #9: x"], [], 0, null).ok, "nothing could be merged: not a success");
const broke = allEnd([], [3], 1, { ok: false, why: "tests failed" });
check(!broke.ok && broke.line.startsWith("MERGED #3 but NOT RELEASED: tests failed"), "a failed release says what merged and that it is not out");
// what GitHub's release after the merge means (nothing is released from this computer)
const done = (conclusion) => ({ status: "completed", conclusion, url: "u" });
check(releaseOutcome(null, "1.0.0", "1.0.0").ok === false, "no run for main's newest commit is a stop");
check(releaseOutcome({ status: "in_progress" }, "1.0.0", "1.0.0").action === "wait", "a running run is waited for");
check(releaseOutcome(done("failure"), "1.0.0", "1.0.0").ok === false, "a failed run is a stop that names the run");
check(releaseOutcome(done("success"), "1.0.0", "1.0.1", "url").done === "Released 1.0.1: url", "a new tag after the run is the release");
check(/^No release/.test(releaseOutcome(done("success"), "1.0.0", "1.0.0").done), "no new tag after a green run says nothing shipped");
finish(fails, "ship: merge, wait, stop and release decisions; --all picks, skips and ends with one line");
