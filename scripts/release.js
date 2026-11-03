#!/usr/bin/env node
// Publish a version: bump it, test, tag and push. The tag runs .github/workflows/release.yml, which tests again and makes
// the GitHub release (main.js, manifest.json, styles.css). Then install_release.js puts it in this computer's vault
// (local.json or --vault) and reloads it in a running Obsidian; BRAT installs it everywhere else.
//   node scripts/release.js [patch|minor|major|<x.y.z>] [--no-wait] [--vault <dir>]        default: patch
//   node scripts/release.js --resume [--vault <dir>]     wait for the current version's release (after a re-run, or offline)
// Run on main with everything committed. Works from any clone with push access; the same steps by hand: RELEASING.md.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), PKG = path.join(ROOT, "package.json");
const fail = msg => { console.log("FAIL - " + msg); process.exit(1); };
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
const git = (...a) => { const r = run("git", a); if (r.status) fail(`git ${a.join(" ")}\n${(r.stderr || r.stdout || "").trim()}`); return (r.stdout || "").trim(); };
const args = process.argv.slice(2), flag = f => args.includes(f);
const vaultAt = args.indexOf("--vault"), vaultArg = vaultAt >= 0 ? args[vaultAt + 1] : undefined;
if (vaultAt >= 0 && (!vaultArg || vaultArg.startsWith("--"))) fail("--vault needs a folder");

// 0. what every step needs: Node 22 (fetch), git, a GitHub origin
if (Number(process.versions.node.split(".")[0]) < 22) fail(`Node ${process.versions.node}: this needs Node 22 or newer (nodejs.org)`);
const slug = (git("remote", "get-url", "origin").match(/github\.com[:/](.+?)(\.git)?$/) || [])[1];
if (!slug) fail("origin isn't a GitHub repository");
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
let version = pkg.version;

if (flag("--resume")) {
  if (!git("tag", "--list", version)) fail(`${version} was never tagged here: run npm run release`);
} else {
  // 1. main, committed, and the same as GitHub's (sync: another computer may have merged or released since)
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`you're on "${branch}"; releases go from main, once its pull request is merged:\n  git switch main\n  npm run release`);
  if (git("status", "--porcelain")) fail("commit or stash your changes first (git status lists them)");
  const s = require("./sync").sync();
  console.log(s.lines.join("\n")); if (!s.ok) process.exit(1);
  // a release with nothing in it changes every device for no reason (it happened: someone else had just released). --force is for a re-issue.
  const now = JSON.parse(fs.readFileSync(PKG, "utf8")).version;
  if (!flag("--force") && git("tag", "--list", now) && !git("log", "--oneline", `${now}..HEAD`)) fail(`nothing has changed since ${now}: https://github.com/${slug}/releases/tag/${now}\nThat release already has everything on main. To re-issue it anyway: npm run release -- --force`);

  // 2. the new version, in package.json and manifest.json
  const step = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--vault") || "patch";
  const [ma, mi, pa] = pkg.version.split(".").map(Number);
  version = /^\d+\.\d+\.\d+$/.test(step) ? step : { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[step];
  if (!version) fail(`unknown version step "${step}" (patch, minor, major or x.y.z)`);
  if (git("tag", "--list", version)) fail(`${version} is already tagged; pass a higher one: npm run release -- x.y.z`);
  const restore = () => run("git", ["checkout", "--", "package.json", "manifest.json"]), was = pkg.version;
  pkg.version = version;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
  const m = run(process.execPath, ["build.js", "manifest"]);
  if (m.status) { restore(); fail(`node build.js manifest\n${(m.stderr || m.stdout).trim()}`); }

  // 3. the fast tests on the sample vault (CI runs them again before it publishes)
  console.log(`Testing ${version}...`);
  const t = spawnSync(process.execPath, [path.join(ROOT, "tests", "run.js")], { cwd: ROOT, stdio: "inherit" });
  if (t.status !== 0) { restore(); fail(`tests failed; nothing was committed or pushed, and the version is back to ${was}`); }

  // 4. commit, tag, push. A push that fails (offline, rejected) leaves the commit and tag here, to push later.
  git("commit", "-q", "-m", `Release ${version}`, "--", "package.json", "manifest.json");
  git("tag", version);
  const p = run("git", ["push", "--atomic", "-q", "origin", "main", version]);
  if (p.status) fail(`committed and tagged ${version} here, but the push failed:\n${(p.stderr || "").trim()}\nOnce that's sorted: git push origin main ${version}   then: npm run release -- --resume`);
  console.log(`Pushed ${version}: https://github.com/${slug}/actions`);
  if (flag("--no-wait")) process.exit(0);
}

// 5. wait for the release. GitHub allows 60 unauthenticated API calls an hour, so this asks once every 30 s
// (about 10 calls for a normal run) and says so when the limit is hit, instead of waiting blind.
async function api(p) {
  const headers = { "User-Agent": "vault-graph-release", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const r = await fetch(`https://api.github.com/repos/${slug}/${p}`, { headers });
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000, mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60e3)) : "a few";
    fail(`GitHub's hourly API limit is used up (resets in ${mins} min). The release may still be fine: https://github.com/${slug}/actions\nAfter the reset: npm run release -- --resume`);
  }
  return r.ok ? r.json() : null;
}
(async () => {
  const end = Date.now() + 20 * 60e3, actions = `https://github.com/${slug}/actions`;
  console.log(`Waiting for GitHub to test and publish ${version} (usually 5-6 minutes)...`);
  for (let latest = null; ; ) {
    const runs = await api(`actions/runs?event=push&branch=${version}&per_page=1`);
    latest = runs && (runs.workflow_runs || [])[0] || null;
    if (latest && latest.status === "completed") {
      if (latest.conclusion === "success") break;
      fail(`the release run ${latest.conclusion}: ${latest.html_url}
Open that page; the red lines under Annotations name the failing test.
- It passes on your computer (a flaky test): click "Re-run jobs" > "Re-run failed jobs", then: npm run release -- --resume
- A real failure: fix it, commit, then npm run release (the next version; ${version} stays unpublished)`);
    }
    if (Date.now() > end) fail(`no release after 20 minutes: ${latest ? latest.html_url : actions}\nWhen it's done: npm run release -- --resume`);
    await new Promise(r => setTimeout(r, 30e3));
  }
  const rel = await api(`releases/tags/${version}`);
  if (!rel || (rel.assets || []).length < 3) fail(`the run passed but release ${version} has no files: https://github.com/${slug}/releases`);
  console.log(`Released ${version}: ${rel.html_url}`);

  // 6. install it in this computer's vault; without one, say how to get it
  const inst = require("./install_release");
  if (!inst.vaultOf(vaultArg)) { console.log("No vault set on this computer, so nothing was installed. In Obsidian, BRAT installs it (RELEASING.md), or: npm run install-release -- --vault <your vault>"); return; }
  const r = await inst.install(version, vaultArg);
  console.log(r.lines.join("\n")); if (!r.ok) process.exit(1);
})().catch(e => fail(`${e.message}\nIf you're offline, once you're back: npm run release -- --resume`));
