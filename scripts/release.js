#!/usr/bin/env node
// Publish a version: check GitHub's tests passed on main, bump it, tag and push. The tag runs .github/workflows/release.yml,
// which checks the same and makes the GitHub release (main.js, manifest.json, styles.css). Then install_release.js puts it in this computer's vault
// (local.json or --vault) and reloads it in a running Obsidian; BRAT installs it everywhere else.
//   node scripts/release.js [patch|minor|major|<x.y.z>] [--no-wait] [--vault <dir>]        default: patch
//   node scripts/release.js [patch|minor|major|<x.y.z>] --background     the same release in a separate process that logs to a file; returns at once
//   node scripts/release.js --resume [--vault <dir>]     wait for the current version's release (after a re-run, or offline)
// Run on main with everything committed. Works from any clone with push access; the same steps by hand: RELEASING.md.
const fs = require("fs"), path = require("path"), { spawnSync, spawn } = require("child_process");
const { ROOT, fail, gitOrFail, githubSlug } = require("./lib"), PKG = path.join(ROOT, "package.json");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
const git = gitOrFail(ROOT);
const args = process.argv.slice(2), flag = f => args.includes(f);
const vaultAt = args.indexOf("--vault"), vaultArg = vaultAt >= 0 ? args[vaultAt + 1] : undefined;
if (vaultAt >= 0 && (!vaultArg || vaultArg.startsWith("--"))) fail("--vault needs a folder");

// 0. what every step needs: Node 22 (fetch), git, a GitHub origin
if (Number(process.versions.node.split(".")[0]) < 22) fail(`Node ${process.versions.node}: this needs Node 22 or newer (nodejs.org)`);
const slug = githubSlug(git("remote", "get-url", "origin"));
if (!slug) fail("origin isn't a GitHub repository");
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
let version = pkg.version;

// GitHub allows 60 unauthenticated API calls an hour, so waiting asks once every 15 to 30 s and says so when the limit is
// hit, instead of waiting blind.
async function api(p) {
  const headers = { "User-Agent": "vault-graph-release", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const r = await fetch(`https://api.github.com/repos/${slug}/${p}`, { headers });
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000, mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60e3)) : "a few";
    fail(`GitHub's hourly API limit is used up (resets in ${mins} min). The release may still be fine: https://github.com/${slug}/actions\nAfter the reset: npm run release -- --resume`);
  }
  return r.ok ? r.json() : null;
}
// The tests that count are GitHub's, on the commit being released, so a release needs nothing from this computer and a
// busy one (a game, a build) can't fail a timing test. HEAD is the code unless it's a version commit, which changes only the number.
async function testedOnGitHub() {
  const sha = git("log", "-1", "--format=%H", git("log", "-1", "--format=%s").startsWith("Release ") ? "HEAD^" : "HEAD"), page = `https://github.com/${slug}/actions`, end = Date.now() + 20 * 60e3, appear = Date.now() + 2 * 60e3;   // a merge a moment ago: GitHub takes a little while to start the run
  let saidWait = false;
  for (let said = false; ; ) {
    const runs = await api(`actions/runs?head_sha=${sha}&event=push&per_page=20`);
    if (!runs) fail(`couldn't ask GitHub about ${sha.slice(0, 7)}. Nothing changed. ${page}`);
    const test = (runs.workflow_runs || []).find(r => /(^|\/)test\.yml/.test(r.path || ""));
    if (!test) { if (Date.now() < appear) { if (!saidWait) { console.log(`Waiting for GitHub to start testing ${sha.slice(0, 7)}...`); saidWait = true; } await new Promise(r => setTimeout(r, 15e3)); continue; }
      fail(`GitHub has no test run for ${sha.slice(0, 7)}, so it can't be released. Nothing changed. Check ${page}, or push a commit to main through a pull request`); }
    if (test.status === "completed") {
      if (test.conclusion === "success") { console.log(`GitHub's tests passed on ${sha.slice(0, 7)}`); return; }
      fail(`GitHub's tests ${test.conclusion} on ${sha.slice(0, 7)}, so it can't be released. Nothing changed.\n${test.html_url}\nThe red lines under Annotations name the failing test. A flaky test: Re-run jobs, then release again. A real failure: fix it through a pull request.`); }
    if (!said) { console.log(`Waiting for GitHub's tests on ${sha.slice(0, 7)}: ${test.html_url}`); said = true; }
    if (Date.now() > end) fail(`GitHub's tests were still running after 20 minutes. Nothing changed. ${test.html_url}`);
    await new Promise(r => setTimeout(r, 30e3));
  }
}

async function publish() {
  if (!git("tag", "--list", version)) fail(`${version} was never tagged here: run npm run release`);
}

async function bumpAndTag() {
  // 1. main, committed, and the same as GitHub's (sync: another computer may have merged or released since)
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`you're on "${branch}"; releases go from main, once its pull request is merged:\n  git switch main\n  npm run release`);
  if (git("status", "--porcelain")) fail("commit or stash your changes first (git status lists them)");
  const s = require("./sync").sync();
  console.log(s.lines.join("\n")); if (!s.ok) process.exit(1);
  // a release with nothing in it changes every device for no reason (it happened: someone else had just released). --force is for a re-issue.
  const now = JSON.parse(fs.readFileSync(PKG, "utf8")).version;
  if (!flag("--force") && git("tag", "--list", now) && !git("log", "--oneline", `${now}..HEAD`)) fail(`nothing has changed since ${now}: https://github.com/${slug}/releases/tag/${now}\nThat release already has everything on main. To re-issue it anyway: npm run release -- --force`);

  // 2. only what GitHub has tested. Nothing has changed yet, so a refusal leaves nothing to undo.
  await testedOnGitHub();

  // 3. the new version, in package.json and manifest.json
  const step = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--vault") || "patch";
  const [ma, mi, pa] = pkg.version.split(".").map(Number);
  version = /^\d+\.\d+\.\d+$/.test(step) ? step : { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[step];
  if (!version) fail(`unknown version step "${step}" (patch, minor, major or x.y.z)`);
  if (git("tag", "--list", version)) fail(`${version} is already tagged; pass a higher one: npm run release -- x.y.z`);
  const restore = () => run("git", ["checkout", "--", "package.json", "manifest.json"]);
  pkg.version = version;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
  const m = run(process.execPath, ["build.js", "manifest"]);
  if (m.status) { restore(); fail(`node build.js manifest\n${(m.stderr || m.stdout).trim()}`); }

  // 4. commit, tag, push. A push that fails (offline, rejected) leaves the commit and tag here, to push later.
  git("commit", "-q", "-m", `Release ${version}`, "--", "package.json", "manifest.json");
  git("tag", version);
  const p = run("git", ["push", "--atomic", "-q", "origin", "main", version]);
  if (p.status) fail(`committed and tagged ${version} here, but the push failed:\n${(p.stderr || "").trim()}\nOnce that's sorted: git push origin main ${version}   then: npm run release -- --resume`);
  console.log(`Pushed ${version}: https://github.com/${slug}/actions`);
  if (flag("--no-wait")) process.exit(0);
}

// --background: the same release (tests wait, tag, publish, install) in a detached process, so the terminal is free for the next change.
// A refusal comes fast (wrong branch, dirty tree, nothing changed), so a child that exits within 8 s is reported here as it would be
// in the foreground; one still going is left running and its log named.
async function inBackground() {
  const log = path.join(require("os").tmpdir(), `vault-graph-release-${Date.now()}.log`), fd = fs.openSync(log, "w");
  const child = spawn(process.execPath, [path.join(__dirname, "release.js"), ...args.filter(a => a !== "--background")], { cwd: ROOT, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  const early = await new Promise(done => { child.once("exit", code => done(code)); child.once("error", () => done(1)); setTimeout(() => done(null), 8000); });
  if (early === null) { child.unref(); console.log(`Releasing in the background. Progress: ${log}\nWhen it ends the log says Released <version> and what was installed; npm run queue shows what is still waiting.`); process.exit(0); }
  console.log(fs.readFileSync(log, "utf8").trim()); process.exit(early);
}

(async () => {
  if (flag("--background")) await inBackground();
  if (flag("--resume")) await publish(); else await bumpAndTag();
  const end = Date.now() + 20 * 60e3, actions = `https://github.com/${slug}/actions`;
  console.log(`Waiting for GitHub to publish ${version} (usually under a minute)...`);
  for (let latest = null; ; ) {
    const runs = await api(`actions/runs?event=push&branch=${version}&per_page=1`);
    latest = runs && (runs.workflow_runs || [])[0] || null;
    if (latest && latest.status === "completed") {
      if (latest.conclusion === "success") break;
      fail(`the release run ${latest.conclusion}: ${latest.html_url}
Open that page; the red lines under Annotations say what stopped it.
- GitHub had a hiccup: click "Re-run jobs", then: npm run release -- --resume
- A real failure: fix it, commit, then npm run release (the next version; ${version} stays unpublished)`);
    }
    if (Date.now() > end) fail(`no release after 20 minutes: ${latest ? latest.html_url : actions}\nWhen it's done: npm run release -- --resume`);
    await new Promise(r => setTimeout(r, 15e3));
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
