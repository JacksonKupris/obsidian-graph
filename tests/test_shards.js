#!/usr/bin/env node
// The shards GitHub runs side by side together hold every step of tests/run.js exactly once, so splitting the suite can't drop a test.
const { spawnSync } = require("child_process"), path = require("path"), { finish } = require("./kit");
const list = a => { const r = spawnSync(process.execPath, [path.join(__dirname, "run.js"), "--list", ...a], { encoding: "utf8" }); return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null; };
const fails = [], all = list([]), N = 3;
if (!all || all.length < 40) fails.push("the full list is missing or short: " + (all && all.length));
else {
  const parts = [1, 2, 3].map(i => list(["--shard=" + i + "/" + N]) || []);
  const got = parts.flat();
  if (got.length !== all.length || new Set(got).size !== all.length || all.some(x => !got.includes(x))) fails.push("shards hold " + got.length + " steps (" + new Set(got).size + " distinct) of " + all.length);
  if (parts.some(p => !p.length)) fails.push("a shard is empty");
  if (list(["--shard=4/3"]) !== null) fails.push("--shard=4/3 should be refused");
}
finish(fails, "shards: " + (all ? all.length : 0) + " steps split into " + N + " with none dropped or repeated", "shards");
