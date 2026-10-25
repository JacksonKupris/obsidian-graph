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

// math.fsum: exact partials, one rounding (values from Python's docs and math.fsum)
check("fsum([0.1] * 10)", E.fsum(Array(10).fill(0.1)), 1);
check("fsum with cancelling terms", E.fsum([1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50]), 1e-100);
// a dated note's series; an undated note has none
check("series of a dated note", [E.seriesKey("02-Systems/Reporting/Transaction Updates 2026-05-05.md"), E.seriesKey("a/Release Notes 2026-04.md"), E.seriesKey("a/Plan.md")], ["transaction updates", "release notes", ""]);
// the ajson log: the last line for a key wins, null deletes, a torn line is skipped
{ const m = E.parseAjson('"a": {"v": 1},\n"b": {"v": 2},\n"a": {"v": 3},\n"c": null,\n"d": {"v"');
  check("ajson: last line wins, in first-seen order", [...m.entries()], [["a", { v: 3 }], ["b", { v: 2 }], ["c", null]]); }
// embeddings: float32 slots in a blob, for the notes asked for
{ const f32 = new Float32Array([1, 0, 0, 1, 0.5, 0.5]), blob = new Uint8Array(f32.buffer);
  const sources = ['"x": {"path": "n/A.md", "embedding": {"default": {"v.bin": {"file_i": 0}}}},', '"y": {"path": "n/B.md", "embedding": {"default": {"v.bin": {"file_i": 2}}}},', '"z": {"path": "n/C.md", "embedding": {"default": {"v.bin": {"file_i": 9}}}},'].join("\n");
  const v = E.embeddings({ sources, models: '"m": {"dims": 2},', blob: () => blob }, ["n/A.md", "n/B.md", "n/C.md"]);
  check("embeddings: each note's slot (a slot past the end is skipped)", [...v].map(([k, x]) => [k, [...x]]), [["n/A.md", [1, 0]], ["n/B.md", [0.5, 0.5]]]); }

console.log(fails.length ? "FAIL - " + fails.join("\n  ") : "ok - engine: Python's random and fsum, embeddings, Louvain, absorbing, betweenness");
process.exit(fails.length ? 1 : 0);
