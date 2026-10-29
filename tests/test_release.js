#!/usr/bin/env node
// Execute the actual release CLI with stand-in git/filesystem calls; never tag, push or edit the real checkout.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../scripts/release.js"), "utf8");
function run(options = {}) {
  const calls = [], writes = [], messages = [];
  let exit = null;
  const stop = {};
  const spawnSync = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: options.branch || "main" };
      if (args[0] === "status") return { status: 0, stdout: options.dirty ? " M src/hq.js" : "" };
      if (args[0] === "remote") return { status: 0, stdout: "https://github.com/owner/repo.git" };
      if (args[0] === "merge-base" && options.behind) return { status: 1, stderr: "remote main is not an ancestor" };
    }
    if (args.some(arg => String(arg).endsWith("tests/run.js")) && options.failedTests)
      return { status: null, error: new Error("could not start tests") };
    return { status: 0, stdout: "" };
  };
  const context = {
    __dirname: path.join(__dirname, "../scripts"),
    require: name => name === "fs" ? { readFileSync: () => '{"version":"0.6.14"}', writeFileSync: (...args) => writes.push(args) } :
      name === "child_process" ? { spawnSync } : require(name),
    process: { execPath: process.execPath, argv: ["node", "release.js", "--no-wait"], exit: code => { exit = code; throw stop; } },
    console: { log: message => messages.push(message) },
  };
  try { vm.runInNewContext(source, context); } catch (error) { if (error !== stop) throw error; }
  return { calls, writes, messages, exit };
}
const good = run();
assert.strictEqual(good.exit, 0);
assert.strictEqual(JSON.parse(good.writes[0][1]).version, "0.6.15");
assert(good.calls.some(call => call.join(" ") === "git fetch origin"));
assert(good.calls.some(call => call.join(" ") === "git merge-base --is-ancestor origin/main HEAD"));
assert(good.calls.some(call => call.join(" ") === "git push --atomic -q origin main 0.6.15"));
assert(good.calls.some(call => call[1] === "commit" && call.includes("Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>")));
assert(!good.calls.some(call => call.includes("import") || call.includes("-f") || call.includes("--force")));
for (const options of [{ branch: "import" }, { dirty: true }, { behind: true }]) {
  const bad = run(options);
  assert.strictEqual(bad.exit, 1);
  assert.strictEqual(bad.writes.length, 0);
  assert(!bad.calls.some(call => call[1] === "push"));
}
const failed = run({ failedTests: true });
assert.strictEqual(failed.exit, 1);
assert(failed.calls.some(call => call.join(" ") === "git checkout -- package.json manifest.json"));
assert(!failed.calls.some(call => call[1] === "commit" || call[1] === "push"));
console.log("ok - release requires current clean main, rejects failed tests, preserves history and atomically pushes main/tag");
