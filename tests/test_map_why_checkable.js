#!/usr/bin/env node
// The reason for "Add X to a map" names the map and the group of notes it is about, so a colleague can check it; it does not say "the topic this map covers".
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const data = {
  nodes: [{ id: "a.md", name: "Deposit rules", bc: 5, cluster: 1 }, { id: "b.md", name: "Lease template", bc: 2, cluster: 1 }, { id: "M.md", name: "Rentals", moc: true }],
  clusters: [{ id: 1, label: "Rental App" }],
  mocs: [{ id: "M.md", title: "Rentals", clusters: [1], missing: { 1: ["a.md"] } }], links: [],
};
const item = VGRules.todayList(data, { today: "2026-10-28" }).find(i => i.kind === "map");
assert.ok(item, "no map suggestion built");
assert.ok(!/topic this map covers/i.test(item.why), `the reason is not checkable: ${item.why}`);
assert.ok(/Rentals/.test(item.why) && /Rental App/.test(item.why), `the reason should name the map and the group of notes: ${item.why}`);
console.log("ok - the add-to-map reason names the map and the group of notes");
