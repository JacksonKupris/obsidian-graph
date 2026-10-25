#!/usr/bin/env node
// The fast checks: build, the rules and code checks, and the page smoke test (every view and lens draws, no dead
// ends). On the sample vault by default; --vault [dir] runs them on a real vault's rules and graph data.
//   node tests/run.js [--vault [dir]]        exit 1 when any fails
// Slower, by hand: click_all.js (every control, ~5 min), layout_random.js, shots.js, polish_loop.js.
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const env = require("./env"), build = require("../build");

// the plugin as it would be installed, built with the rules under test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-build-"));
for (const [f, text] of Object.entries(build.buildPlugin(env.rules))) fs.writeFileSync(path.join(dir, f), text);

const steps = [["main.js", ["--check", path.join(dir, "main.js")]], ["rules.js", [path.join(dir, "rules.js")]],
  ["test_rules.js", [path.join(__dirname, "test_rules.js"), ...env.args]], ["test_cdp.js", [path.join(__dirname, "test_cdp.js")]],
  ["test_pick.js", [path.join(__dirname, "test_pick.js"), ...env.args]],["smoke_page.js", [path.join(__dirname, "smoke_page.js"), ...env.args]]];
let failed = 0;
for (const [name, args] of steps) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10 * 60 * 1000 });
  // only a clean exit 0 passes: a step killed (or timed out) has status null, one that didn't start has r.error
  const bad = r.status !== 0, why = r.error ? [r.error.code === "ETIMEDOUT" ? "timed out after 10 minutes" : r.error.message] : r.signal ? [`killed (${r.signal})`] : [];
  const out = [...((r.stdout || "").trim() || (r.stderr || "").trim() || "ok").split(/\r?\n/), ...why];
  console.log(`  ${bad ? "FAIL" : "test"}  ${name}: ${bad ? out.slice(-12).join("\n") : out[out.length - 1]}`);
  failed += bad ? 1 : 0;
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} failed (${env.VAULT ? env.VAULT : "sample vault"})` : `ok - ${env.VAULT ? env.VAULT : "sample vault"}`);
process.exit(failed ? 1 : 0);
