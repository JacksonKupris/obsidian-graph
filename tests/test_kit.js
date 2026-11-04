#!/usr/bin/env node
// The test kit does what the tests rely on, and they use it: a test can fail through it, and no copy comes back.
//   node tests/test_kit.js        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { checks, openPage, tools } = require("./kit");

// checks collect failures, and only failures
{ const { fails, check, ok, that } = checks(); check("same", { a: 1 }, { a: 1 }); ok(true, "fine"); that("fine", true); assert.deepStrictEqual(fails, []);
  check("differs", 1, 2); ok(false, "bad"); that("broken", false, "why"); assert.strictEqual(fails.length, 3); assert.ok(fails[0].includes("got 1, want 2")); assert.strictEqual(fails[1], "bad"); assert.ok(fails[2].includes("why")); }

// finish really exits 1 on a failure, and 0 and "ok" without one
const runFinish = args => spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "kit.js"))}).finish(${args})`], { encoding: "utf8" });
{ const bad = runFinish('["a", "b"], "fine", "stage"'); assert.strictEqual(bad.status, 1); assert.ok(/^FAIL - stage:/.test(bad.stdout) && /a/.test(bad.stdout) && /b/.test(bad.stdout), bad.stdout);
  const good = runFinish('[], "fine"'); assert.strictEqual(good.status, 0); assert.strictEqual(good.stdout.trim(), "ok - fine"); }

// no copy of the kit's parts in a test. Each pattern has to find the kit's own, or it couldn't catch another.
const kit = fs.readFileSync(path.join(__dirname, "kit.js"), "utf8");
const COPIES = [["sleep", /const sleep = ms =>/], ["the no-Chrome skip", /skipped: no Chrome found/], ["the same-value check", /got \$\{JSON\.stringify\(got\)\}/]];
const tests = fs.readdirSync(__dirname).filter(f => f.endsWith(".js") && !["kit.js", "test_kit.js", "run.js"].includes(f));
for (const [what, rx] of COPIES) { assert.ok(rx.test(kit), `the guard for ${what} doesn't match the kit`);
  const copies = tests.filter(f => rx.test(fs.readFileSync(path.join(__dirname, f), "utf8"))); assert.deepStrictEqual(copies, [], `${what} is written again: use tests/kit.js`); }
// a hand-picked port is how a leftover from another run fails a test: only the phone's runs choose one
const picked = tests.filter(f => !["click_all.js", "cdp.js"].includes(f) && /\bport: *\d/.test(fs.readFileSync(path.join(__dirname, f), "utf8")));
assert.deepStrictEqual(picked, [], "a test picks its own port: leave it out and it gets a free one");

// two pages at once, each on its own free port, and the drivers work on a real page
(async () => {
  const html = '<!doctype html><button id="b" onclick="window.hit = (window.hit || 0) + 1">x</button><script>window.vaultHQ = { setScreen: s => { window.at = s; } };</script>';
  const a = await openPage({ html }), b = await openPage({ html });
  try { const { click, screen } = tools(a, { wait: 0 });
    assert.strictEqual(await click("#b"), true); assert.strictEqual(await click("#missing"), false); assert.strictEqual(await a.ev("window.hit"), 1);
    assert.strictEqual(await b.ev("window.hit || 0"), 0, "the two pages should be separate");
    await screen('to"day'); assert.strictEqual(await a.ev("window.at"), 'to"day');
    const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "vg-kit-")); await tools(a, { shots: dir }).shot("one"); assert.ok(fs.statSync(path.join(dir, "one.png")).size > 0, "no screenshot"); fs.rmSync(dir, { recursive: true, force: true });
    await tools(a).shot("nothing");
  } finally { await a.close(); await b.close(); }
  console.log("ok - test kit: checks fail, finish exits, free ports, drivers on a real page");
})().catch(e => { console.log(`FAIL - ${e.message}`); process.exit(1); });
