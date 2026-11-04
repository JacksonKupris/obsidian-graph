#!/usr/bin/env node
// Test the plugin on a vault's data and install its check file into that vault. The plugin itself
// comes from the GitHub releases through BRAT (npm run release); --plugin installs this build over it for a trial, and
// reloads it in a running Obsidian (BRAT replaces it with the next release).
//   node scripts/deploy.js [--vault <dir>] [--no-tests] [--plugin]        vault: local.json's "vault" when not given
// The vault's rules file holds its folder names and thresholds; it must have every key config/rules.json has (a key
// the code reads but the vault lacks would fail at runtime). Only changed files are written: the plugin folder is
// synced, and every rewrite there is a stored version.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
if (!process.argv.includes("--vault")) process.argv.push("--vault");   // env.js: local.json's vault
const env = require("../tests/env"), build = require("../build"), { python } = require("./lib");

// 1. the vault's rules have every key the code reads
const missing = [];
const walk = (want, have, at) => Object.keys(want).filter(k => !k.startsWith("_")).forEach(k => {
  if (!have || !(k in have)) missing.push(at + k);
  else if (want[k] && typeof want[k] === "object" && !Array.isArray(want[k])) walk(want[k], have[k], at + k + ".");
});
walk(build.loadRules(), env.rules, "");
if (missing.length) { console.log(`FAIL - ${path.relative(env.VAULT, env.RULES_FILE)} is missing: ${missing.join(", ")} (see config/rules.json)`); process.exit(1); }

// 2. the fast checks on this vault
if (!process.argv.includes("--no-tests")) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "tests", "run.js"), "--vault", env.VAULT], { stdio: "inherit" });
  if (r.status) { console.log("Not installed: tests failed"); process.exit(1); }
}

// 3. the plugin folder is BRAT's: the release's main.js, styles.css and manifest.json. The rulebook on its own (with this
// vault's rules built in) is for the vault's own checks.
const id = build.pluginId(env.rules), dir = path.join(env.VAULT, path.dirname(env.rules.files.content_log));
const built = build.buildPlugin(env.rules), CHECK_FILES = { "rules.js": "vault_graph_rules.js" };
let changed = [];
if (process.argv.includes("--plugin")) {
  changed = ["main.js", "styles.css", "manifest.json"].filter(f => build.writeIfChanged(path.join(dir, f), built[f]));
  console.log(changed.length ? `Installed ${changed.join(", ")} in ${path.relative(env.VAULT, dir)} (until the next release)` : `${path.relative(env.VAULT, dir)} is up to date`);
}
for (const f of Object.keys(CHECK_FILES)) if (fs.existsSync(path.join(dir, f))) fs.unlinkSync(path.join(dir, f));   // where they went before BRAT

// 3b. the check file goes in the vault's scripts folder
const scriptsDir = path.join(env.VAULT, env.rules.folders.scripts), installed = Object.entries(CHECK_FILES).filter(([f, to]) => build.writeIfChanged(path.join(scriptsDir, to), built[f])).map(([, to]) => to);
if (installed.length) console.log(`Installed ${installed.join(", ")} in ${path.relative(env.VAULT, scriptsDir)}`);

// 4. the vault's own checks on the installed plugin (its notes, its dashboards), when it has them. These and the reload below
// use the vault's own Python tools, which are separate from the plugin; a vault without them skips both.
const vaultTests = path.join(env.VAULT, env.rules.folders.scripts, "tests", "run.py");
if (!process.argv.includes("--no-tests") && fs.existsSync(vaultTests)) {
  const r = spawnSync(python(), [vaultTests], { stdio: "inherit" });
  if (r.status) console.log("The vault's checks failed (the plugin is installed; see above)");
}

// 5. reload it in Obsidian, through the vault's own command-line helper (it only asks a running Obsidian)
const helper = path.join(env.VAULT, env.rules.folders.system, "obsidian_cli.py");
if (changed.length && fs.existsSync(helper)) {
  const r = spawnSync(python(), ["-c", `import sys; sys.path.insert(0, sys.argv[1]); import obsidian_cli; print(obsidian_cli.reload_plugin(sys.argv[2]))`, path.dirname(helper), id], { encoding: "utf8" });
  console.log((r.stdout || "").trim() === "True" ? "Reloaded the plugin in Obsidian" : "Obsidian isn't running: the plugin loads next time it opens");
}
