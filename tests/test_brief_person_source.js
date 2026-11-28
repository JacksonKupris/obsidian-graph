#!/usr/bin/env node
// The brief's line about a person says what it counts (tasks and drafts that name them), so it can be checked and isn't read as another "waiting on you" total.
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const data = { nodes: [{ id: "p1", name: "Ana Diaz", person: true }], links: [] };
const list = [1, 2, 3].map(n => ({ kind: "task", key: "t" + n, title: "Call Ana Diaz about " + n, group: "today" }));
const line = VGRules.hqBrief(data, list, {}, "2026-10-28", []).find(s => /Ana Diaz/.test(s));
assert.ok(line, "no line about the person");
assert.ok(!/in 3 open items/.test(line), `"open items" is not something the person can find on any screen: ${line}`);
assert.ok(/named in 3 open tasks and drafts/.test(line), `the line should say what it counts: ${line}`);
console.log("ok - the brief says a person is named in N open tasks and drafts");
// the reason it is mentioned: they are the person named most, and the line opens that person's tasks
assert.ok(/more than anyone else|most of anyone/.test(line), `the line should say why this person is shown: ${line}`);
const lines = VGRules.hqBriefLines(data, list, {}, "2026-10-28", [], 12);
const l = lines.find(x => /Ana Diaz/.test(x.text));
assert.ok(l && l.go === "people", "the line should open the People screen, where that person's tasks are listed first");
console.log("ok - the line says why the person is shown and opens their tasks");
