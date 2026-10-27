#!/usr/bin/env node
// Publish a version: bump it, test, tag and push. The tag runs .github/workflows/release.yml, which tests again and makes
// the GitHub release (main.js, manifest.json, styles.css) that BRAT installs. Then, when Obsidian is open on the vault,
// BRAT is asked to install it there (added to BRAT's list the first time).
//   node scripts/release.js [patch|minor|major|<x.y.z>] [--no-wait]        default: patch
// Run from the import branch with everything committed; it is pushed as main.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), PKG = path.join(ROOT, "package.json");
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  if (r.status) { console.log(`FAIL - ${cmd} ${args.join(" ")}\n${(r.stderr || r.stdout || "").trim()}`); process.exit(1); } return (r.stdout || "").trim(); };
const git = (...a) => sh("git", a);

// 1. a clean import branch
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "import") { console.log("FAIL - release from the import branch"); process.exit(1); }
if (git("status", "--porcelain")) { console.log("FAIL - commit or stash your changes first"); process.exit(1); }
const slug = (git("remote", "get-url", "origin").match(/github\.com[:/](.+?)(\.git)?$/) || [])[1];
if (!slug) { console.log("FAIL - origin isn't a GitHub repository"); process.exit(1); }

// 2. the new version, in package.json and manifest.json
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8")), arg = process.argv.slice(2).find(a => !a.startsWith("--")) || "patch";
const [ma, mi, pa] = pkg.version.split(".").map(Number);
const version = /^\d+\.\d+\.\d+$/.test(arg) ? arg : { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[arg];
if (!version) { console.log(`FAIL - unknown version step "${arg}" (patch, minor, major or x.y.z)`); process.exit(1); }
if (git("tag", "--list", version)) { console.log(`FAIL - ${version} is already tagged`); process.exit(1); }
pkg.version = version;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
sh(process.execPath, ["build.js", "manifest"]);

// 3. the fast tests on the sample vault (CI runs them again before it publishes)
const t = spawnSync(process.execPath, [path.join(ROOT, "tests", "run.js")], { cwd: ROOT, stdio: "inherit" });
if (t.status) { git("checkout", "--", "package.json", "manifest.json"); console.log("Not released: tests failed"); process.exit(1); }

// 4. commit, tag, push
git("commit", "-q", "-m", `Release ${version}`, "--", "package.json", "manifest.json");
git("tag", version);
git("push", "-q", "origin", "import:main", version);
git("branch", "-f", "main", "import");
console.log(`Pushed ${version}: https://github.com/${slug}/actions`);
if (process.argv.includes("--no-wait")) process.exit(0);

// 5. wait for the release, then have BRAT install it in a running Obsidian
const api = p => fetch(`https://api.github.com/repos/${slug}/${p}`, { headers: { "User-Agent": "vault-graph-release" } }).then(r => r.ok ? r.json() : null);
(async () => {
  const end = Date.now() + 20 * 60e3;
  for (;;) {
    const rel = await api(`releases/tags/${version}`);
    if (rel && (rel.assets || []).length >= 3) break;
    const runs = await api(`actions/runs?event=push&branch=${version}`), run = runs && (runs.workflow_runs || [])[0];
    if (run && run.status === "completed" && run.conclusion !== "success") { console.log(`FAIL - the release run ${run.conclusion}: ${run.html_url}`); process.exit(1); }
    if (Date.now() > end) { console.log(`No release after 20 minutes: ${run ? run.html_url : `https://github.com/${slug}/actions`}`); process.exit(1); }
    await new Promise(r => setTimeout(r, 20e3));
  }
  console.log(`Released ${version}: https://github.com/${slug}/releases/tag/${version}`);
  let vault = null; try { vault = JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")).vault; } catch (e) { /* no local vault */ }
  const helper = vault && path.join(vault, "_System", "obsidian_cli.py");
  if (!helper || !fs.existsSync(helper)) return;
  const js = `const b = app.plugins.plugins["obsidian42-brat"]; if (!b) return "no BRAT";
const repo = ${JSON.stringify(slug)}, listed = b.settings.pluginList.includes(repo);
const ok = listed ? await b.betaPlugins.updatePlugin(repo, false, false) : await b.betaPlugins.addPlugin(repo, false, false, false, "", false, true);
return ok ? "installed" : "BRAT couldn't install it";`;
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c",
    "import sys, json; sys.path.insert(0, sys.argv[1]); import obsidian_cli; print(json.dumps(obsidian_cli.eval_js(sys.argv[2])))", path.dirname(helper), js], { encoding: "utf8" });
  // the plugin folder's manifest says what was installed (the CLI's own reply can be cut off while BRAT reloads the plugin)
  const out = (r.stdout || "").trim(), id = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).id;
  let now = null; try { now = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", id, "manifest.json"), "utf8")).version; } catch (e) { /* not installed */ }
  console.log(now === version ? `BRAT installed ${version} in Obsidian`
    : out === "null" ? "Obsidian isn't running: BRAT installs it next time it opens" : `BRAT didn't install ${version}: ${out || (r.stderr || "").trim().split("\n").pop()}`);
})();
