#!/usr/bin/env node
// The morning brief's waiting-on-you line gives the same total as the Needs you chip and says what makes it up.
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const list = [{ kind: "approval", key: "a", title: "A", group: "needs" }, { kind: "review", key: "r", title: "R", group: "needs" }, { kind: "backlog", key: "b", title: "B", group: "needs" }, { kind: "inbox", key: "i", title: "I", group: "needs" }, { kind: "job", key: "j", title: "J", group: "needs" }, { kind: "task", key: "t", title: "T", group: "today" }];
const lines = VGRules.hqBrief({}, list, {}, "2026-10-28", []);
const line = lines.find(s => /waiting on you/.test(s));
assert.ok(line, "no waiting-on-you line: " + JSON.stringify(lines));
assert.ok(/^5 waiting on you/.test(line), `the total should match Needs you (5), not just approvals and drafts: ${line}`);
assert.ok(/1 approval/.test(line) && /1 draft/.test(line) && /1 backlog item/.test(line) && /1 inbox note/.test(line) && /1 automation alert/.test(line), `every part is named and they add up to the total: ${line}`);
assert.ok(!/other/.test(line), `no vague "other": ${line}`);
const only = VGRules.hqBrief({}, [{ kind: "approval", key: "a", title: "A", group: "needs" }], {}, "2026-10-28", []).find(s => /waiting on you/.test(s));
assert.ok(/^1 waiting on you/.test(only) && !/other/.test(only), `one kind, no "other": ${only}`);
console.log("ok - the brief's waiting-on-you total matches Needs you and says what is in it");
