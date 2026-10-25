#!/usr/bin/env node
// The analysis engine (src/engine.js) on its own: Python's random draws and shuffle (values taken from CPython's
// random.Random(7)), Louvain on two linked cliques, betweenness on a path, small topics joining their neighbour.
// Parity with the Python analysis on a real vault is the vault's test (_scripts/tests/test_graph_vault.js).
//   node tests/test_engine.js        exit 0 = pass
const fs = require("fs"), path = require("path");
const E = new Function(`${fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8")}; return VGEngine;`)();
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

const r = E.pyRandom(7);
check("random.Random(7).getrandbits(32) x3", [r.uint32(), r.uint32(), r.uint32()], [1390851128, 4071050724, 647892279]);
check("random.Random(7).shuffle(range(10))", E.pyRandom(7).shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [8, 3, 1, 4, 7, 0, 9, 6, 2, 5]);
check("Python's string order (code points)", ["b", "a", "\u{1F600}", "！"].sort(E.pyCmp), ["a", "b", "！", "\u{1F600}"]);

// two cliques of four, one link between them: two topics, split at the bridge
const g = {}, tie = (a, b, w = 1) => { (g[a] = g[a] || {})[b] = w; (g[b] = g[b] || {})[a] = w; };
["a", "b", "c", "d"].forEach((x, i, xs) => xs.slice(i + 1).forEach(y => tie(x, y)));
["p", "q", "r", "s"].forEach((x, i, xs) => xs.slice(i + 1).forEach(y => tie(x, y)));
tie("d", "p");
const lv = E.louvain(g);
check("Louvain: two cliques are two topics", [new Set(["a", "b", "c", "d"].map(x => lv[x])).size, new Set(["p", "q", "r", "s"].map(x => lv[x])).size, lv.a !== lv.p], [1, 1, true]);
// a two-note fragment tied mostly to the first clique joins it
tie("x", "a", 3); tie("y", "x"); const comm = { ...lv, x: 9, y: 9 };
check("a small topic joins the one it's most tied to", E.absorbSmall(comm, g, 6, 0.25).x, lv.a);
// a path a-b-c: b is on the only shortest path between a and c
check("betweenness on a path", E.betweenness({ a: { b: 1 }, b: { a: 1, c: 1 }, c: { b: 1 } }), { a: 0, b: 1, c: 0 });

console.log(fails.length ? "FAIL - " + fails.join("\n  ") : "ok - engine: Python's random, Louvain, absorbing, betweenness");
process.exit(fails.length ? 1 : 0);
