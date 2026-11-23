#!/usr/bin/env node
// Triage's queue ranks every kind of item together by one score, so a score-3 inbox note never sits above the person's own task and an automation
// alert only leads when it is the chosen next step. VGRules.triageQueue is the one rule; the layout only calls it.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
try {
  const R = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
  check(typeof R.triageQueue === "function", "VGRules.triageQueue should exist");
  if (typeof R.triageQueue === "function") {
    const it = (key, kind, group, score) => ({ key, kind, group, score });
    const list = [it("inbox", "inbox", "needs", 3), it("job", "job", "needs", 13), it("appr", "approval", "needs", 21), it("task", "task", "today", 20), it("plan", "plan", "today", 15), it("rep", "report", "needs", 2.8)];
    const keys = q => q.map(i => i.key).join(",");
    const q = R.triageQueue(list, null, []);
    check(keys(q) === "appr,task,plan,job,inbox,rep", `ranked together by score: ${keys(q)}`);
    check(keys(R.triageQueue(list, list[0], [])).startsWith("inbox,"), "the chosen next step still leads");
    check(keys(R.triageQueue(list, null, ["appr"])).endsWith(",appr"), "a skipped item goes to the end");
    check(new Set(q.map(i => i.key)).size === list.length, "every item appears once");
  }
  const s = fs.readFileSync(path.join(__dirname, "..", "src/hq/29-layouts-more.js"), "utf8");
  check(/VGRules\.triageQueue\(/.test(s), "triQueue in the layout should call VGRules.triageQueue");
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "triage queue is ranked once, across kinds", "triage order");
