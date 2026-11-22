#!/usr/bin/env node
// mutate.js - mutation testing: break a core source file one small way at a time and check a test notices.
// A break no test notices (a survivor) is a spot where a test can't fail.
//   node scripts/mutate.js src/shared.js                  the file's tests are named in config/mutation.json
//   node scripts/mutate.js src/rules.js --limit 60        a spread of 60 mutants (same ones every run)
//   --lines 100-200                                       only mutants on those lines
//   --concurrency 2                                       copies of the repo working at once (default 2)
//   --tests test_a,test_b                                 override the tests (names in tests/, without .js)
// Writes .out/mutation/<file>.md (score, then each survivor with its line). Exit 0 when it ran; the score is the result, not a gate.
// Each mutant runs in a throwaway copy of the repo, so the real files are never touched. The tests named in the config are the
// behaviour tests: a test that reads source text (the guards in test_shared.js) would "kill" a change for the wrong reason.
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const { mutants, apply } = require("./mutation-lib");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const { fail } = require("./lib");
if (!target) fail("name the file to break, e.g. node scripts/mutate.js src/shared.js");

const rel = path.relative(ROOT, path.resolve(ROOT, target)).split(path.sep).join("/");
if (!fs.existsSync(path.join(ROOT, rel))) fail(`no file ${rel}`);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "mutation.json"), "utf8"));
const tests = (flag("--tests") ? flag("--tests").split(",") : config.files[rel]) ;
if (!tests || !tests.length) fail(`no tests named for ${rel}: add it to config/mutation.json (files), listing the behaviour tests that cover it`);
const timeoutMs = config.timeoutMs || 60000;
const concurrency = Number(flag("--concurrency", 2));

const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
let list = mutants(source);
const lines = flag("--lines");
if (lines) { const [a, b] = lines.split("-").map(Number); list = list.filter(m => m.line >= a && m.line <= (b || a)); }
const limit = Number(flag("--limit", 0));
if (limit && list.length > limit) { const step = list.length / limit; list = Array.from({ length: limit }, (_, i) => list[Math.floor(i * step)]); }   // an even spread, the same every run

// a copy of the repo without what is big or generated; node_modules is joined, not copied
const SKIP = new Set([".git", "node_modules", ".out", ".stryker-tmp", "look-shots"]);
function copyRepo(to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    fs.cpSync(path.join(ROOT, e.name), path.join(to, e.name), { recursive: true });
  }
  const nm = path.join(ROOT, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(to, "node_modules"), "junction");
}

// run the tests in order in a copy; resolves { killedBy } (the first test that failed or hung) or { killedBy: null }
function runTests(dir) {
  return tests.reduce((chain, t) => chain.then(r => r.killedBy ? r : new Promise(resolve => {
    const child = spawn(process.execPath, [path.join("tests", t + ".js")], { cwd: dir, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); resolve({ killedBy: t + " (hung)" }); }, timeoutMs);
    child.on("exit", code => { clearTimeout(timer); resolve({ killedBy: code === 0 ? null : t }); });
    child.on("error", () => { clearTimeout(timer); resolve({ killedBy: t + " (could not run)" }); });
  })), Promise.resolve({ killedBy: null }));
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vg-mutate-"));
  const dirs = Array.from({ length: concurrency }, (_, i) => path.join(work, "w" + i));
  dirs.forEach(copyRepo);
  try {
    const base = await runTests(dirs[0]);
    if (base.killedBy) fail(`the tests fail before any change (${base.killedBy}): fix them first, a score would mean nothing`);
    console.log(`${rel}: ${list.length} mutants, tests: ${tests.join(", ")}`);
    const results = new Array(list.length);
    let next = 0, done = 0;
    await Promise.all(dirs.map(async dir => {
      const file = path.join(dir, rel);
      while (next < list.length) {
        const i = next++, m = list[i];
        fs.writeFileSync(file, apply(source, m));
        results[i] = await runTests(dir);
        fs.writeFileSync(file, source);
        if (++done % 25 === 0) console.log(`  ${done}/${list.length}`);
      }
    }));
    const survivors = list.filter((m, i) => !results[i].killedBy);
    const killedBy = {};
    results.forEach(r => { if (r.killedBy) killedBy[r.killedBy] = (killedBy[r.killedBy] || 0) + 1; });
    const score = list.length ? Math.round(100 * (list.length - survivors.length) / list.length) : 100;
    const srcLines = source.split("\n");
    const md = [`# Mutation: ${rel}`, "", `${list.length - survivors.length} of ${list.length} changes were caught (${score}%). ${survivors.length} survived.`, "",
      `Caught by: ${Object.entries(killedBy).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}.`, "",
      "A survivor is a change no test noticed. For each, write a test that fails with the change, then leave the code as it is.", "",
      ...survivors.map(m => `- line ${m.line}:${m.col} (${m.kind}) \`${m.from}\` -> \`${m.to || "(removed)"}\`  ${"`" + srcLines[m.line - 1].trim().slice(0, 110) + "`"}`)].join("\n") + "\n";
    const outDir = path.join(ROOT, ".out", "mutation"); fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, rel.replace(/[\\/]/g, "_") + ".md");
    fs.writeFileSync(outFile, md);
    console.log(`${score}% caught (${list.length - survivors.length}/${list.length}); ${survivors.length} survived. Report: ${path.relative(ROOT, outFile)}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})();
