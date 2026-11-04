#!/usr/bin/env node
// Similar notes from the words they share, with nothing installed: what counts as a word, who gets paired, how the list is ranked, and an index as an extra.
//   node tests/test_word_matching.js        exit 0 = pass
const assert = require("assert"), build = require("../build");
const E = new Function(`${build.engineSource()}; return VGEngine;`)();
const filler = i => `Unrelated subject number word${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 26)]} elsewhere${"abcdefghij"[i % 10]}`;
const raw = { "Sticker Liner.md": "The liner and inlay go through the converter, then the cut-down step.\n", "RFID Inlay.md": "An inlay on a liner reaches the converter before the cut-down.\n" };
for (let i = 0; i < 30; i++) raw[`Other ${i}.md`] = `${filler(i)} ${filler(i + 1)}\n`;
const ids = Object.keys(raw), V = E.wordVectors(ids, raw, "^Related");

// ---- what counts as a word
{ const v = E.wordVectors(["a.md", "b.md", ...ids], { ...raw, "a.md": "---\ntags: [secret]\n---\nplate WI0071 shared_column dashed orange shared thing\n```\ncodeword\n```\n[x](http://linkword.example)\n## Related\nrelatedword\n## After\nkeptword\n", "b.md": "WI0071 shared_column dashed orange secret codeword linkword relatedword keptword thing shared\n" }, "^Related").get("a.md");
  for (const w of ["wi0071", "shared_column", "dashed", "orange", "secret", "codeword", "linkword", "relatedword"]) assert(!v.has(w), `"${w}" shouldn't count as a word of the note`);
  assert(v.has("keptword"), "a section after a generated one is the note's own text"); }
// the line the plugin itself writes when a note is created from a link names other notes
{ const { VGRules } = require("./plugin_stub").load(require("./env").rules), line = VGRules.createdFromLine(["Secretname Note"]); assert(/Secretname/.test(line), line);
  const v = E.wordVectors(["a.md", "b.md", ...ids], { ...raw, "a.md": `# A\n\n${line}\n\nkeptword thing\n`, "b.md": "secretname keptword\n" }, "^Related").get("a.md"); assert(!v.has("secretname"), `the plugin's own line counted as the note's words: ${line}`); assert(v.has("keptword")); }
assert(Math.abs([...V.get("Sticker Liner.md").values()].reduce((s, x) => s + x * x, 0) - 1) < 1e-9, "a note's word list is at unit length");
assert.deepStrictEqual([...E.wordVectors(ids, raw, "^Related").get("RFID Inlay.md")], [...V.get("RFID Inlay.md")], "the same notes give the same result");

// ---- the pair with the words behind it, not paired once linked
const pairs = E.similarPairs(V, {}, new Set()), hit = pairs.find(x => [x[0], x[1]].sort().join() === "RFID Inlay.md,Sticker Liner.md");
assert(hit, "two notes on one subject should pair"); assert(hit[2] > 0.5, `their score is ${hit[2]}`); assert(hit[3].includes("inlay") && hit[3].includes("liner"), `its words: ${hit[3]}`);
assert(pairs.every(x => x[2] > 0), "two notes with nothing in common aren't a pair");
assert(!E.similarPairs(V, { "RFID Inlay.md": { "Sticker Liner.md": 1 } }, new Set()).some(x => x[0] === hit[0] && x[1] === hit[1]), "linked notes aren't suggested");
assert(!E.similarPairs(V, {}, new Set(["RFID Inlay.md"])).some(x => x.includes("RFID Inlay.md")), "a private note isn't suggested");

// ---- the list: both first, one note can't fill it, two records stay out, dismissed stays out, an index only adds
const w = (a, b, s) => [`${a}.md`, `${b}.md`, s, ["word"]], skip = (a, b) => a === "Gone.md" || b === "Gone.md";
{ const similar = [w("A", "B", 0.5), w("C", "D", 0.2), w("Hub", "E", 0.9), w("Hub", "F", 0.8), w("Hub", "G", 0.7), w("Hub", "H", 0.6), w("Rec1", "Rec2", 0.95), w("Gone", "A", 0.99)];
  const meaning = [["C.md", "D.md", 0.8], ["M.md", "N.md", 0.85], ["P.md", "Q.md", 0.95], ["Rec1.md", "Rec3.md", 0.8]];
  const { rel, near } = E.similarLinks({ similar, meaning, records: ["Rec1.md", "Rec2.md", "Rec3.md"], skip });
  const key = x => `${x[0]}|${x[1]}`, list = rel.map(key);
  assert.strictEqual(list[0], "C.md|D.md", "a pair both methods found comes first, whatever its score"); assert(/shared words: word · similar meaning/.test(rel[0][3]), rel[0][3]);
  assert.strictEqual(list.filter(k => k.includes("Hub")).length, 3, "one note appears at most three times");
  assert(!list.includes("Rec1.md|Rec2.md") && !list.includes("Rec1.md|Rec3.md"), "two records aren't suggested"); assert(!list.some(k => k.includes("Gone")), "a dismissed pair isn't suggested");
  assert.strictEqual(list[list.length - 1], "M.md|N.md", "the index's own pairs come after word matching"); assert(/similar meaning \(0.85\)/.test(rel[rel.length - 1][3]), rel[rel.length - 1][3]);
  assert.deepStrictEqual(near.map(key), ["P.md|Q.md"], "near-copies still come from the index"); }
{ const { rel } = E.similarLinks({ similar: [w("A", "B", 0.5), w("C", "D", 0.4)], twins: [["B.md", "A.md", 1]], skip: () => false }); assert.deepStrictEqual(rel.map(x => x[0]), ["C.md"], "two copies of a note are a duplicate, not a link to suggest"); }
{ const { rel } = E.similarLinks({ similar: [w("Guide", "Copy1", 0.5), w("Guide", "Copy2", 0.5), w("Guide", "E", 0.4)], twins: [["Copy1.md", "Copy2.md", 0.99]], skip: () => false }); assert.strictEqual(rel.filter(x => /Copy/.test(x[1])).length, 1, "a note and its copy take one place in the list"); assert.strictEqual(rel.length, 2); }
{ const { rel, near } = E.similarLinks({ similar: [w("A", "B", 0.5)], skip: () => false }); assert.strictEqual(rel.length, 1, "no index, still suggestions"); assert.strictEqual(near.length, 0); assert(!/meaning/.test(rel[0][3]), rel[0][3]); }

// ---- topics don't need the index: the same with and without it
{ const job = o => E.topicsJob({ graph: {}, knowledge: ids, raw, tags: {}, prev: {}, stack: {}, ...o }).topics.map(t => t.members.slice().sort()).sort();
  assert.deepStrictEqual(job({}), job({ smart: { sources: "{}", models: "{}", blobs: {} } }), "an installed index changes the topics"); }
console.log("ok - word matching: the words that count, who pairs, the list's order and limits, topics the same with or without an index");
