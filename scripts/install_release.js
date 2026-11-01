#!/usr/bin/env node
// Install a GitHub release of the plugin into this PC's vault: its main.js, manifest.json and styles.css go straight
// into the vault's plugin folder, then a running Obsidian reloads the plugin. It doesn't go through BRAT, whose
// update call failed silently more than once (0.6.10, 0.6.14); BRAT on other PCs still finds the release on its own.
//   node scripts/install_release.js [<x.y.z>] [--vault <dir>]     default: the latest release, local.json's vault
//   npm run install-release [-- 0.6.15] [-- --vault <dir>]
// Used by release.js once the release is published.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const FILES = ["main.js", "manifest.json", "styles.css"];

const slugOf = () => { const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" });
  return ((r.stdout || "").match(/github\.com[:/](.+?)(\.git)?\s*$/) || [])[1]; };
// this computer's vault: --vault <dir> when given, else local.json's "vault" (the file is per computer, not in git)
const vaultOf = given => { if (given) return path.resolve(given);
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")).vault || null; } catch (e) { return null; } };
// a network failure (offline) comes out of fetch as a TypeError; an answer GitHub refused carries its status
const get = async url => { let r;
  try { r = await fetch(url, { headers: { "User-Agent": "vault-graph-install" } }); }
  catch (e) { throw new Error(`can't reach GitHub (offline?): ${e.cause ? e.cause.code || e.cause.message : e.message}. RELEASING.md, Offline, says what works without it`); }
  if (r.status === 403 || r.status === 429) throw new Error("GitHub's hourly API limit is used up; try again in an hour");
  if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status }); return r; };

// JavaScript run in the running Obsidian through the vault's CLI helper (_System/obsidian_cli.py), which only talks to
// an Obsidian that's already open. -> { running: false } | { running: true, value } | { error }. The helper's eval_js
// says null both for "no answer" and for a null result, so the JavaScript given here always returns a string.
const PY = `import sys, json
sys.path.insert(0, sys.argv[1])
import obsidian_cli as o
if not o.obsidian_running():
    print(json.dumps({"running": False})); sys.exit()
try:
    v = o.eval_js(sys.argv[2], 60)
    print(json.dumps({"running": True, "value": v} if v is not None else {"error": "Obsidian didn't answer"}))
except Exception as e:
    print(json.dumps({"error": str(e).strip().split(chr(10))[0]}))`;
function obsidianEval(vault, js) {
  const helper = path.join(vault, "_System", "obsidian_cli.py");
  if (!fs.existsSync(helper)) return { noHelper: true };   // only Jackson's vault has it
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", PY, path.dirname(helper), js], { encoding: "utf8", timeout: 150e3 });
  if (r.error) return { error: `couldn't run Python: ${r.error.message}` };
  try { return JSON.parse((r.stdout || "").trim().split("\n").pop()); }
  catch (e) { return { error: ((r.stderr || r.stdout || "").trim().split("\n").pop()) || `Python exited ${r.status}` }; }
}

// reload the plugin in a running Obsidian and read back the version it loaded -> a line for the person
function reload(vault, id, version) {
  const q = JSON.stringify(id), manual = "turn Vault Graph off and on in Settings > Community plugins";
  const state = obsidianEval(vault, `return app.plugins.enabledPlugins.has(${q}) ? "on" : "off";`);
  if (state.noHelper) return `If Obsidian is open, ${manual} to load it`;
  if (state.error) return `Couldn't reach Obsidian (${state.error}): ${manual}`;
  if (!state.running) return "Obsidian isn't running: it loads this version when it opens";
  if (state.value === "off") return "Vault Graph is turned off in Obsidian: turn it on in Settings > Community plugins";
  // the reply to the reload itself can be lost while the plugin restarts, so only the read-back below decides
  obsidianEval(vault, `await app.plugins.disablePlugin(${q}); await app.plugins.enablePlugin(${q}); return "reloaded";`);
  let loaded = null;
  for (let i = 0; i < 3 && loaded !== version; i++) {
    const r = obsidianEval(vault, `const p = app.plugins.plugins[${q}]; return p ? p.manifest.version : "not loaded";`);
    loaded = r.error ? r.error : r.value;
  }
  return loaded === version ? `Obsidian reloaded it: ${version} is running` : `Obsidian has ${loaded}, not ${version}: ${manual}`;
}

// -> { ok, version, lines: [what happened, for the person running it] }
async function install(version, vaultDir) {
  const slug = slugOf(), vault = vaultOf(vaultDir), lines = [];
  if (!slug) return { ok: false, lines: ["FAIL - origin isn't a GitHub repository"] };
  if (!vault) return { ok: false, lines: ['FAIL - which vault? pass --vault <folder>, or put {"vault": "<folder>"} in local.json'] };
  if (!fs.existsSync(path.join(vault, ".obsidian"))) return { ok: false, lines: [`FAIL - ${vault} isn't an Obsidian vault (no .obsidian folder)`] };
  let rel;
  try { rel = await (await get(`https://api.github.com/repos/${slug}/releases/${version ? "tags/" + version : "latest"}`)).json(); }
  catch (e) { if (e.status === 404) return { ok: false, lines: [`FAIL - no release ${version || "yet"}; the published ones: https://github.com/${slug}/releases`] }; throw e; }
  const assets = Object.fromEntries((rel.assets || []).map(a => [a.name, a.browser_download_url]));
  const missing = FILES.filter(f => !assets[f]);
  if (missing.length) return { ok: false, lines: [`FAIL - release ${rel.tag_name} has no ${missing.join(", ")}`] };
  const got = {}; for (const f of FILES) got[f] = await (await get(assets[f])).text();
  const man = JSON.parse(got["manifest.json"]);
  if (man.version !== rel.tag_name) return { ok: false, lines: [`FAIL - release ${rel.tag_name} carries manifest ${man.version}`] };
  const dir = path.join(vault, ".obsidian", "plugins", man.id);
  // every file is downloaded before any is written, and each lands whole (written beside, then renamed over), so a
  // failure leaves the old version in place rather than half of each. The plugin's settings (data.json) aren't touched.
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(dir, f + ".new"), got[f]);
  for (const f of FILES) fs.renameSync(path.join(dir, f + ".new"), path.join(dir, f));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version;
  if (onDisk !== man.version) return { ok: false, lines: [`FAIL - ${dir} says ${onDisk} after writing ${man.version}`] };
  lines.push(`Installed ${man.version} in ${path.relative(vault, dir)}`, reload(vault, man.id, man.version));
  return { ok: true, version: man.version, lines };
}

module.exports = { install, vaultOf };

if (require.main === module) {
  const a = process.argv.slice(2), at = a.indexOf("--vault"), dir = at >= 0 ? a[at + 1] : undefined;
  if (at >= 0 && (!dir || dir.startsWith("--"))) { console.log("FAIL - --vault needs a folder"); process.exit(1); }
  const version = a.find((x, i) => !x.startsWith("--") && (at < 0 || i !== at + 1));
  install(version, dir).then(r => { console.log(r.lines.join("\n")); process.exit(r.ok ? 0 : 1); },
    e => { console.log("FAIL - " + e.message); process.exit(1); });
}
