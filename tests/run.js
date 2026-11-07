#!/usr/bin/env node
// The fast checks: build, the rules and code checks, and the page smoke test (every view and lens draws, no dead
// ends). On the sample vault by default; --vault [dir] runs them on a real vault's rules and graph data.
//   node tests/run.js [--vault [dir]]        exit 1 when any fails
// live_e2e.js acts on every suggestion in a copy of the vault. Slower, by hand: click_all.js (every control, ~5 min), layout_random.js, shots.js, polish_loop.js.
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const env = require("./env"), build = require("../build");

// the plugin as it would be installed, built with the rules under test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-build-"));
for (const [f, text] of Object.entries(build.buildPlugin(env.rules))) fs.writeFileSync(path.join(dir, f), text);

const steps = [["main.js", ["--check", path.join(dir, "main.js")]], ["rules.js", [path.join(dir, "rules.js")]],
  ["test_word_matching.js", [path.join(__dirname, "test_word_matching.js")]], ["test_shared.js", [path.join(__dirname, "test_shared.js")]], ["test_kit.js", [path.join(__dirname, "test_kit.js")]], ["test_parts.js", [path.join(__dirname, "test_parts.js"), ...env.args]],
  ["test_release.js", [path.join(__dirname, "test_release.js")]],
  ["test_fixture_dates.js", [path.join(__dirname, "test_fixture_dates.js"), ...env.args]],
  ["test_rules.js", [path.join(__dirname, "test_rules.js"), ...env.args]], ["test_design.js", [path.join(__dirname, "test_design.js"), ...env.args]], ["test_moves.js", [path.join(__dirname, "test_moves.js"), ...env.args]], ["test_hq_layout.js", [path.join(__dirname, "test_hq_layout.js"), ...env.args]], ["test_hq_features.js", [path.join(__dirname, "test_hq_features.js"), ...env.args]], ["test_hq_ux.js", [path.join(__dirname, "test_hq_ux.js"), ...env.args]], ["test_hq_polish.js", [path.join(__dirname, "test_hq_polish.js"), ...env.args]], ["test_hq_next.js", [path.join(__dirname, "test_hq_next.js"), ...env.args]], ["test_analysis_pace.js", [path.join(__dirname, "test_analysis_pace.js")]], ["test_hq_a11y.js", [path.join(__dirname, "test_hq_a11y.js"), ...env.args]], ["test_triage.js", [path.join(__dirname, "test_triage.js"), ...env.args]], ["test_play.js", [path.join(__dirname, "test_play.js"), ...env.args]], ["test_cdp.js", [path.join(__dirname, "test_cdp.js")]], ["test_plugin_rules.js", [path.join(__dirname, "test_plugin_rules.js")]], ["test_engine.js", [path.join(__dirname, "test_engine.js")]], ["test_cosmos_binary.js", [path.join(__dirname, "test_cosmos_binary.js")]], ["test_science.js", [path.join(__dirname, "test_science.js")]], ["test_depth.js", [path.join(__dirname, "test_depth.js"), ...env.args]], ["test_engine_data.js", [path.join(__dirname, "test_engine_data.js")]],
  ["test_cosmos_capture.js", [path.join(__dirname, "test_cosmos_capture.js")]], ["test_dungeon.js", [path.join(__dirname, "test_dungeon.js"), ...env.args]], ["test_cyberpunk.js", [path.join(__dirname, "test_cyberpunk.js"), ...env.args]], ["test_timelapse.js", [path.join(__dirname, "test_timelapse.js"), ...env.args]], ["test_dimensions.js", [path.join(__dirname, "test_dimensions.js"), ...env.args]], ["test_born_date.js", [path.join(__dirname, "test_born_date.js")]], ["test_hq_reactions.js", [path.join(__dirname, "test_hq_reactions.js"), ...env.args]], ["test_hq_brain.js", [path.join(__dirname, "test_hq_brain.js"), ...env.args]], ["test_hq_cockpit.js", [path.join(__dirname, "test_hq_cockpit.js"), ...env.args]], ["test_search_quality.js", [path.join(__dirname, "test_search_quality.js"), ...env.args]], ["test_sync.js", [path.join(__dirname, "test_sync.js")]],
  ["test_no_python.js", [path.join(__dirname, "test_no_python.js")]], ["test_cosmos_views.js", [path.join(__dirname, "test_cosmos_views.js")]], ["test_cosmos_seed.js", [path.join(__dirname, "test_cosmos_seed.js")]], ["test_cosmos_coupling.js", [path.join(__dirname, "test_cosmos_coupling.js")]], ["test_queue.js", [path.join(__dirname, "test_queue.js")]], ["test_ship.js", [path.join(__dirname, "test_ship.js")]], ["test_shards.js", [path.join(__dirname, "test_shards.js")]], ["test_map_apply.js", [path.join(__dirname, "test_map_apply.js")]], ["live_e2e.js", [path.join(__dirname, "live_e2e.js"), ...env.args]],
  ["test_pick.js", [path.join(__dirname, "test_pick.js"), ...env.args]], ["test_today.js", [path.join(__dirname, "test_today.js"), ...env.args]], ["test_words.js", [path.join(__dirname, "test_words.js"), ...env.args]], ["test_graph_a11y.js", [path.join(__dirname, "test_graph_a11y.js"), ...env.args]], ["test_view_labels.js", [path.join(__dirname, "test_view_labels.js"), ...env.args]], ["test_cosmos_phone.js", [path.join(__dirname, "test_cosmos_phone.js"), ...env.args]],
  ["test_hq_back.js", [path.join(__dirname, "test_hq_back.js")]], ["test_save_binary.js", [path.join(__dirname, "test_save_binary.js")]],
  ["test_hq_plugin.js", [path.join(__dirname, "test_hq_plugin.js"), ...env.args]], ["test_hq.js", [path.join(__dirname, "test_hq.js"), ...env.args]],
  ["test_hq_daily.js", [path.join(__dirname, "test_hq_daily.js"), ...env.args]],
  ["test_hq_navigation.js", [path.join(__dirname, "test_hq_navigation.js"), ...env.args]],
  ["test_hq_improvements.js", [path.join(__dirname, "test_hq_improvements.js"), ...env.args]],
  ["test_hq_usability.js", [path.join(__dirname, "test_hq_usability.js"), ...env.args]],
  ["test_other_vault.js", [path.join(__dirname, "test_other_vault.js")]], ["test_lens_load.js", [path.join(__dirname, "test_lens_load.js"), ...env.args]], ["test_sweep_vitals.js", [path.join(__dirname, "test_sweep_vitals.js"), ...env.args]],
  ["smoke_page.js", [path.join(__dirname, "smoke_page.js"), ...env.args]]];
// --shard=i/n runs every n-th step starting at i (GitHub runs the shards side by side); no flag runs all of them
const shardArg = (process.argv.find(a => a.startsWith("--shard=")) || "").slice(8);
const [shard, shards] = shardArg ? shardArg.split("/").map(Number) : [1, 1];
if (!(shards >= 1 && shard >= 1 && shard <= shards)) { console.error("FAIL  --shard=" + shardArg + ": use --shard=i/n with 1 <= i <= n"); process.exit(1); }
const label = (env.VAULT ? env.VAULT : "sample vault") + (shards > 1 ? ", shard " + shard + "/" + shards : "");
if (process.argv.includes("--list")) { console.log(steps.filter((_, i) => i % shards === shard - 1).map(x => x[0]).join("\n")); process.exit(0); }
let ran = 0;
let failed = 0, skipped = 0;
// the repo's manifest.json (what BRAT reads) is the one the build makes: same id, same version as package.json
if (shard === 1) { const want = build.buildPlugin(build.loadRules())["manifest.json"];
  let got = ""; try { got = fs.readFileSync(path.join(build.ROOT, "manifest.json"), "utf8"); } catch (e) { /* missing */ }
  const ok = got.replace(/\r\n/g, "\n") === want;
  console.log(`  ${ok ? "test" : "FAIL"}  manifest.json: ${ok ? "ok - matches the build" : "out of date: run node build.js manifest"}`);
  failed += ok ? 0 : 1; }
for (const [name, args] of steps.filter((_, i) => i % shards === shard - 1)) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10 * 60 * 1000 });
  // only a clean exit 0 passes: a step killed (or timed out) has status null, one that didn't start has r.error
  const bad = r.status !== 0, why = r.error ? [r.error.code === "ETIMEDOUT" ? "timed out after 10 minutes" : r.error.message] : r.signal ? [`killed (${r.signal})`] : [];
  const out = [...((r.stdout || "").trim() || (r.stderr || "").trim() || "ok").split(/\r?\n/), ...why];
  // a person at a terminal and GitHub see every step; a script or an agent reading the output sees failures and the total (--verbose for all)
  if (bad || process.stdout.isTTY || process.env.CI || process.argv.includes("--verbose")) console.log(`  ${bad ? "FAIL" : "test"}  ${name}: ${bad ? out.slice(-30).join("\n") : out[out.length - 1]}`);
  failed += bad ? 1 : 0; ran++;
  skipped += /skipped: no Chrome/.test(r.stdout || "") ? 1 : 0;
}
if (skipped) console.log(`  note  ${skipped} browser tests skipped: no Chrome found (set CHROME_PATH to its program). GitHub runs them before it publishes.`);
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} of ${ran} failed (${label})` : `ok - ${ran} passed, ${label}`);
process.exit(failed ? 1 : 0);
