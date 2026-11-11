#!/usr/bin/env node
// Execute the actual release CLI with stand-in git, filesystem and GitHub calls; never tag, push or edit the real checkout.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../scripts/release.js"), "utf8");
// the real scripts/lib.js, seeing the same stand-ins as the release script
const libSource = fs.readFileSync(path.join(__dirname, "../scripts/lib.js"), "utf8");
const libWith = context => { const module = { exports: {} }; vm.runInNewContext(libSource, { ...context, module }); return module.exports; };
async function run(options = {}) {
  let now = 1e12; const calls = [], writes = [], messages = [], asked = [], ranTests = [], spawned = [];
  const states = options.runs || [[{ path: ".github/workflows/test.yml", status: "completed", conclusion: "success", html_url: "u" }]];
  const fetch = async url => { asked.push(url); const list = states[Math.min(asked.length - 1, states.length - 1)]; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ workflow_runs: list }) }; };
  let exit = null;
  const stop = {};
  const spawnSync = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: options.branch || "main" };
      if (args[0] === "status") return { status: 0, stdout: options.dirty ? " M src/hq.js" : "" };
      if (args[0] === "remote") return { status: 0, stdout: "https://github.com/owner/repo.git" };
      if (args[0] === "push" && options.pushFails) return { status: 1, stderr: "rejected" };
      if (args[0] === "tag" && args[2] === "0.6.14" && options.tagged) return { status: 0, stdout: "0.6.14" };
      if (args[0] === "diff") return { status: 0, stdout: Number(args[3].slice(5)) < (options.versionCommits || 0) ? "package.json\nmanifest.json" : "src/hq.js\npackage.json" };   // HEAD~n: the n newest commits change only the version
      if (args[0] === "log" && args.includes("--format=%H")) return { status: 0, stdout: "sha" + args[args.length - 1].slice(5) };
      if (args[0] === "log" && options.tagged) return { status: 0, stdout: options.commits || "" };
    }
    if (args.some(arg => String(arg).replace(/\\/g, "/").endsWith("tests/run.js"))) ranTests.push(args);
    return { status: 0, stdout: "" };
  };
  const context = {
    __dirname: path.join(__dirname, "../scripts"),
    require: name => name === "fs" ? { readFileSync: () => options.pulled && calls.some(c => c[0] === "sync") ? '{"version":"0.6.14","devDependencies":{"lib":"1"}}' : '{"version":"0.6.14"}', writeFileSync: (...args) => writes.push(args), openSync: () => 9 } :
      name === "child_process" ? { spawnSync, spawn: (command, args) => { spawned.push([command, ...args]); return { once: (event, fn) => { if (event === "exit" && options.childExit !== undefined) fn(options.childExit); }, unref() { calls.push(["unref"]); } }; } } : name === "./sync" ? { sync: () => (calls.push(["sync"]), { ok: !options.behind, lines: [] }) } :
      name === "./lib" ? libWith(context) : require(name),
    process: { execPath: process.execPath, versions: process.versions, env: {}, argv: ["node", "release.js", "--no-wait", ...(options.args || [])], exit: code => { if (exit === null) exit = code; throw stop; } },
    console: { log: message => messages.push(message), warn() {} }, fetch, Promise, setTimeout: (fn, ms) => { now += ms; fn(); }, Date: { now: () => now, parse: Date.parse },
  };
  try { await vm.runInNewContext(source, context); } catch (error) { if (error !== stop) throw error; }
  return { calls, writes, messages, exit, asked, ranTests, spawned };
}
const t = (status, conclusion) => [{ path: ".github/workflows/test.yml", status, conclusion, html_url: "u" }];
(async () => {
// a release with nothing in it is refused, before anything changes; new commits or --force let it through
{ const empty = await run({ tagged: true });
  assert.strictEqual(empty.exit, 1, "an empty release should be refused"); assert(empty.messages.some(m => /nothing has changed since 0\.6\.14/.test(m)), "it should say why");
  assert(!empty.calls.some(c => c[1] === "push" || c[1] === "tag" && c[2] !== "--list") && !empty.writes.length, "a refused release changes nothing");
  assert.strictEqual((await run({ tagged: true, commits: "abc A change" })).exit, 0, "new commits should release"); assert.strictEqual((await run({ tagged: true, args: ["--force"] })).exit, 0, "--force should re-issue"); }
// --background: a release still going after 8 s is left running with its log named; a quick refusal is reported as in the foreground
{ const bg = await run({ args: ["--background", "patch"] });
  assert.strictEqual(bg.exit, 0, "background should return at once"); assert.strictEqual(bg.spawned.length, 1, "one detached release");
  assert(bg.spawned[0].some(x => /release\.js$/.test(x)) && !bg.spawned[0].includes("--background") && bg.spawned[0].includes("patch"), "the child is the same release without --background: " + bg.spawned[0]);
  assert(bg.calls.some(c => c[0] === "unref"), "the child is left running"); assert(bg.messages.some(m => /Releasing in the background/.test(m)), "it names the log");
  assert(!bg.calls.some(c => c[0] === "git" && c[1] === "push"), "the parent itself tags and pushes nothing");
  const refused = await run({ args: ["--background"], childExit: 1 });
  assert.strictEqual(refused.exit, 1, "a quick refusal keeps its exit code"); assert(!refused.calls.some(c => c[0] === "unref"), "nothing left running after a refusal"); }
// a package.json that the sync pulled in is the one written back, with its dependencies
{ const pulled = await run({ pulled: true }); assert.strictEqual(pulled.exit, 0);
  assert.deepStrictEqual(JSON.parse(pulled.writes[0][1]).devDependencies, { lib: "1" }, "a release keeps what the sync pulled into package.json"); }
const good = await run();
assert.strictEqual(good.exit, 0);
assert.strictEqual(JSON.parse(good.writes[0][1]).version, "0.6.15");
assert(good.calls.some(call => call[0] === "sync"), "a release syncs with GitHub first");
assert(good.calls.some(call => call.join(" ") === "git push --atomic -q origin main 0.6.15"), "main and the tag go together or not at all");
assert(good.calls.some(call => call[1] === "commit"));
assert(!good.calls.some(call => call[1] === "commit" && call.some(arg => /co-authored-by/i.test(String(arg)))), "no attribution lines");
assert(!good.calls.some(call => call.includes("-f") || call.includes("--force")));
for (const options of [{ branch: "import" }, { dirty: true }, { behind: true }]) {
  const bad = await run(options);
  assert.strictEqual(bad.exit, 1);
  assert.strictEqual(bad.writes.length, 0);
  assert(!bad.calls.some(call => call[1] === "push"));
}
// only what GitHub has tested goes out, and nothing runs on this computer
assert.strictEqual(good.ranTests.length, 0, "a release runs no tests here");
assert(good.asked[0].includes("head_sha=sha0&"), "it asks about the commit being released");
assert((await run({ versionCommits: 1, args: ["--force"] })).asked[0].includes("head_sha=sha1&"), "a version commit's code is its parent");
assert((await run({ versionCommits: 2, args: ["--force"] })).asked[0].includes("head_sha=sha2&"), "a hand-made version commit followed by a Release commit: the code is before both, whatever they're called");
for (const [name, runs, says] of [["failed", [t("completed", "failure")], /tests failure/], ["missing", [[]], /no test run/], ["for another workflow", [[{ path: ".github/workflows/release.yml", status: "completed", conclusion: "success" }]], /no test run/]]) {
  const r = await run({ runs });
  assert.strictEqual(r.exit, 1, `${name} tests should stop a release`); assert(r.messages.some(m => says.test(m)), `${name}: it should say why`);
  assert(!r.writes.length && !r.calls.some(c => c[1] === "push" || c[1] === "commit"), `${name}: a refused release changes nothing`); }
const justMerged = await run({ runs: [[], [], t("completed", "success")] });
assert.strictEqual(justMerged.exit, 0, "a run that hasn't started yet is waited for"); assert(justMerged.messages.some(m => /start testing/.test(m)));
const waited = await run({ runs: [t("in_progress"), t("in_progress"), t("completed", "success")] });
assert.strictEqual(waited.exit, 0, "tests still running: it waits"); assert.strictEqual(waited.asked.length, 3); assert(waited.calls.some(c => c.join(" ") === "git push --atomic -q origin main 0.6.15"));
const lateFail = await run({ runs: [t("in_progress"), t("completed", "failure")] }); assert.strictEqual(lateFail.exit, 1); assert(!lateFail.writes.length);
assert.strictEqual((await run({ pushFails: true })).exit, 1);
// GitHub's side holds the same line, for a tag pushed by hand
const yml = f => fs.readFileSync(path.join(__dirname, "../.github/workflows", f), "utf8"), rel = yml("release.yml"), tst = yml("test.yml");
assert(!/uses: \.\/\.github\/workflows\/test\.yml/.test(rel), "publishing doesn't run the tests again");
assert(/gh run list --workflow test\.yml/.test(rel) && /\^Release /.test(rel), "publishing checks the tests passed on the code");
assert(/git diff --name-only HEAD\^ HEAD/.test(rel), "a Release commit is checked to change only the version");
assert(/while test -z .*code="\$code\^"/.test(rel) && /fetch-depth: 20/.test(rel), "publishing looks past every version-only commit for the tested code");
assert(/paths-ignore: \[package\.json, manifest\.json\]/.test(tst), "a version commit starts no test run");
console.log("ok - release requires current clean main and GitHub's tests passed, runs none here, preserves history and atomically pushes main/tag");
})().catch(e => { console.log("FAIL - release: " + (e && e.message)); process.exit(1); });
