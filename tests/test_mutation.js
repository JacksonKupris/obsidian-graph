// test_mutation.js - mutation testing can run here: the runner comes with the graphs library, and every file and test
// config/mutation.json names exists. The runner itself is tested in the library.
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const runner = require("../package.json").scripts.mutate.replace("node ", "");
assert.ok(fs.existsSync(path.join(ROOT, runner)), "`npm run mutate` points at " + runner + ", which is missing: run npm install");
const files = Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, "config", "mutation.json"), "utf8")).files);
assert.ok(files.length, "config/mutation.json names no files");
for (const [file, tests] of files) {
  assert.ok(fs.existsSync(path.join(ROOT, file)), `config/mutation.json names ${file}, which is missing`);
  assert.ok(tests.length, `${file} has no tests`);
  for (const t of tests) assert.ok(fs.existsSync(path.join(ROOT, "tests", t + ".js")), `${file} names tests/${t}.js, which is missing`);
}
console.log("ok - mutation testing: the runner is installed and its config names real files and tests");
