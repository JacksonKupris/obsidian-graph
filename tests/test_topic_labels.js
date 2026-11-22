#!/usr/bin/env node
// Two topics claimed by one map must not end up with the same label: the Topics list, the Maps bars and search all show the label,
// and "Inventory Flow · Odoo" twice cannot be told apart.
//   node tests/test_topic_labels.js        exit 0 = pass
const { checks, finish } = require("./kit");
const E = new Function(`${require("../build").engineSource()}; return VGEngine;`)();
const { check, fails } = checks();
const mk = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}.md`);
const A = mk("a", 4), B = mk("b", 4), C = mk("c", 4), cid = {};
A.forEach(r => cid[r] = 1); B.forEach(r => cid[r] = 2); C.forEach(r => cid[r] = 3);
const run = (names, keywords) => E.mapsOf({ maps: [{ path: "Inventory Flow.md", text: "# Inventory Flow\n", links: [...A, ...B, ...C] }], tags: {}, knowledge: [...A, ...B, ...C],
  clusters: [A, B, C], ids: [1, 2, 3], names, keywords, bc: {}, cid, mapRules: { min_claim: 2, min_cover: 0.5 }, bridgeNotes: {} }).labels;
const labels = run(["Odoo · Stock", "Odoo · Pick", "Odoo · Ship"], ["Odoo · Stock", "Odoo · Pick", "Odoo · Ship"]);
check("every topic of one map has its own label", new Set(Object.values(labels)).size, 3);
check("all three are labelled", Object.keys(labels).length, 3);
check("a unique label stays as it was", run(["Alpha · Stock", "Beta · Pick", "Gamma · Ship"], ["Stock", "Pick", "Ship"])[1].startsWith("Inventory Flow"), true);
const same = run(["Odoo · Odoo", "Odoo · Odoo", "Odoo · Odoo"], ["Odoo", "Odoo", "Odoo"]);
check("even identical names and keywords stay apart", new Set(Object.values(same)).size, 3);
finish(fails, "topic labels: one map's topics each get their own label");
