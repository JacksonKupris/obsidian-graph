// test_mutation.js - the mutation tool can fail: it lists the breaks it should, applies one cleanly, and a weak test leaves a
// break alive while a strong one catches it (run through the real runner on a small file, in a throwaway folder).
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const { mutants, apply } = require("../scripts/mutation-lib");
const ROOT = path.join(__dirname, "..");

const src = 'const f = (a, b) => { if (!a) return "none"; return a + b > 3 && true; };\n';
const list = mutants(src);
const kinds = k => list.filter(m => m.kind === k).map(m => `${m.from}>${m.to}`);
assert.deepStrictEqual(kinds("operator"), ["+>-", ">>>=", "&&>||"], "operators swap one for the other");
assert.deepStrictEqual(kinds("not"), ["!>"], "a ! is dropped");
assert.deepStrictEqual(kinds("boolean"), ["true>false"]);
assert.deepStrictEqual(kinds("number"), ["3>4"]);
assert.deepStrictEqual(kinds("string"), ['"none">""']);
assert.ok(list.some(m => m.kind === "condition" && m.from === "!a" && m.to === "false"), "an if's test is made false");
assert.deepStrictEqual(list.map(m => m.id), list.map((_, i) => i + 1), "ids run in order, the same every time");
assert.deepStrictEqual(mutants(src).map(m => m.start), list.map(m => m.start), "the same list on every run");
for (const m of list) assert.doesNotThrow(() => new Function(apply(src, m)), `mutant ${m.id} is still valid code`);
assert.strictEqual(apply(src, list.find(m => m.from === "&&")), src.replace("&&", "||"), "apply changes only that spot");
assert.strictEqual(mutants('const o = { "k": 1 }; // "a" + 1\n"use strict";').filter(m => m.kind === "string").length, 0, "keys, comments and directives are left alone");

// the runner end to end: a tiny repo with one source file and two tests, one weak and one strong
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-mutation-test-"));
try {
  fs.mkdirSync(path.join(dir, "scripts")); fs.mkdirSync(path.join(dir, "config")); fs.mkdirSync(path.join(dir, "tests")); fs.mkdirSync(path.join(dir, "src"));
  for (const f of ["mutate.js", "mutation-lib.js", "lib.js"]) fs.copyFileSync(path.join(ROOT, "scripts", f), path.join(dir, "scripts", f));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
  fs.writeFileSync(path.join(dir, "src", "add.js"), "module.exports = (a, b) => a + b;\n");
  fs.writeFileSync(path.join(dir, "tests", "weak.js"), 'require("assert").strictEqual(typeof require("../src/add")(1, 2), "number");\n');
  fs.writeFileSync(path.join(dir, "tests", "strong.js"), 'require("assert").strictEqual(require("../src/add")(1, 2), 3);\n');
  const run = tests => {
    fs.writeFileSync(path.join(dir, "config", "mutation.json"), JSON.stringify({ timeoutMs: 20000, files: { "src/add.js": tests } }));
    const r = spawnSync(process.execPath, ["scripts/mutate.js", "src/add.js", "--concurrency", "1"], { cwd: dir, encoding: "utf8" });
    return { out: r.stdout, report: fs.existsSync(path.join(dir, ".out", "mutation", "src_add.js.md")) ? fs.readFileSync(path.join(dir, ".out", "mutation", "src_add.js.md"), "utf8") : "" };
  };
  const weak = run(["weak"]);
  assert.ok(/1 survived/.test(weak.out), "the weak test leaves the + -> - change alive: " + weak.out);
  assert.ok(/`\+` -> `-`/.test(weak.report), "the report names the survivor");
  fs.rmSync(path.join(dir, ".out"), { recursive: true });
  const strong = run(["weak", "strong"]);
  assert.ok(/0 survived/.test(strong.out) && /100% caught/.test(strong.out), "the strong test catches it: " + strong.out);
  fs.writeFileSync(path.join(dir, "tests", "strong.js"), "process.exit(1);\n");
  assert.ok(/fail before any change/.test(run(["strong"]).out), "a failing baseline stops the run");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log("ok - mutation tool: the changes it makes, and that a weak test is caught out");
