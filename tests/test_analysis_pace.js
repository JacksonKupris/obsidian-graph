#!/usr/bin/env node
// The background analysis, on the real plugin code: after a pause in editing, at most every 3 hours going by the synced file, since
// each run rewrites about 1 MB that Sync keeps a version of. "Re-analyse now" isn't held back.
//   node tests/test_analysis_pace.js        exit 0 = pass
const assert = require("assert"), env = require("./env"), stub = require("./plugin_stub");
const { Plugin } = stub.load(env.rules, { Platform: { isDesktopApp: true } });
const HOUR = 3600 * 1000, tick = () => new Promise(r => setTimeout(r, 10));
// ageMs: how old the synced file is (null: there isn't one). Returns what the timer did once it fired.
async function fire(ageMs, edits = 1) {
  const calls = [], again = [], p = Object.create(Plugin.prototype);
  Object.assign(p, { settings: { dataPath: "_scripts/out/vault-graph.json" }, refreshing: false, refresh: async quiet => calls.push(quiet),
    app: { vault: { adapter: { stat: async () => { if (ageMs === null) throw new Error("no file"); return { mtime: Date.now() - ageMs }; } }, getMarkdownFiles: () => Array.from({ length: edits }, () => ({ path: "a.md", stat: { mtime: Date.now() + 60000 } })) } } });
  const real = Plugin.prototype.scheduleAutoRefresh; let first = true;
  p.scheduleAutoRefresh = function (s) { if (first) { first = false; return real.call(this, s); } again.push(s); };
  p.scheduleAutoRefresh(0); await tick(); await tick();
  return { calls, again };
}
(async () => {
  const soon = await fire(HOUR);
  assert.deepStrictEqual(soon.calls, [], "an hour after the last run it should wait");
  assert(soon.again.length === 1 && soon.again[0] > 1.9 * 3600 && soon.again[0] <= 2 * 3600, `it should look again in two hours: ${soon.again}`);
  assert.deepStrictEqual((await fire(4 * HOUR)).calls, [true], "four hours on it should run, quietly");
  const none = await fire(4 * HOUR, 0); assert.deepStrictEqual([none.calls, none.again], [[], []], "with no edits there's nothing to run");
  // the command runs straight away: refresh itself has no wait in it
  const p = Object.create(Plugin.prototype); let ran = 0; Object.assign(p, { settings: { script: "x" }, refreshing: false, hasAnalysis: async () => true, updateStatus() {}, runPython: async () => { ran++; return ""; }, mergeContentFromDisk: async () => {}, reloadSoon() {} });
  await p.refresh(true); await tick(); assert.strictEqual(ran, 1, "Re-analyse now should run at once");
  console.log("ok - background analysis: after a pause, at most every 3 hours, shared through the synced file; Re-analyse now at once");
  process.exit(0);
})().catch(e => { console.log(`FAIL - ${e.message}`); process.exit(1); });
