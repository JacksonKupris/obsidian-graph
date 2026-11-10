#!/usr/bin/env node
// Ship a pull request: wait for its checks, merge it when they pass, release, and end with one line that says what happened.
//   node scripts/ship.js <pr number>        npm run ship -- 36
//   node scripts/ship.js --all              npm run ship -- --all    sync, merge every open pull request whose checks pass, release once
// It runs in the foreground so a person sees it, and an agent starts it in the background so it is told when it ends. A failed
// check, a conflict or a failed release stops it with the reason and the next step; nothing is retried blindly.
// Needs the GitHub CLI (`gh auth login`). By hand: wait for the checks, merge on GitHub, then `npm run release` on main (RELEASING.md).
const { spawnSync } = require("child_process");
const path = require("path");
const { ROOT, gitIn } = require("./lib"), { checkState, gitState, openPrs } = require("./queue");

// pull request view -> { action: "wait" | "merge" | "release" | "stop", why }   (the one rule for what ship does next)
function plan(view) {
  if (!view) return { action: "stop", why: "GitHub did not answer" };
  if (view.state === "MERGED") return { action: "release", why: "already merged" };
  if (view.state === "CLOSED") return { action: "stop", why: "the pull request is closed" };
  if (view.mergeable === "CONFLICTING") return { action: "stop", why: "it conflicts with main: merge origin/main into the branch and push" };
  const s = checkState(view.statusCheckRollup);
  if (s === "none") return { action: "stop", why: "no checks have started" };
  if (s === "fail") {
    const bad = (view.statusCheckRollup || []).filter(c => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(String(c.conclusion || c.state).toUpperCase())).map(c => c.name || c.context);
    return { action: "stop", why: `checks failed: ${bad.join(", ") || "see the pull request"}` };
  }
  return s === "pass" ? { action: "merge", why: "checks passed" } : { action: "wait", why: "checks running" };
}

const gh = (...a) => spawnSync("gh", a, { cwd: ROOT, encoding: "utf8" });
function view(pr) {
  const r = gh("pr", "view", String(pr), "--json", "state,mergeable,statusCheckRollup,title");
  try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const say = m => console.log(m);
// wait for the checks, then merge -> { ok, line? }   (ok: the pull request is in main, by this run or an earlier one)
async function merge(pr, { poll = 30000 } = {}) {
  let v, p;
  for (;;) {
    v = view(pr); p = plan(v);
    if (p.action !== "wait") break;
    await sleep(poll);
  }
  if (p.action === "stop") return { ok: false, line: `NOT SHIPPED #${pr}: ${p.why}. Nothing was merged or released by this run.` };
  if (p.action === "merge") {
    say(`#${pr} (${v.title}): ${p.why}, merging`);
    const m = gh("pr", "merge", String(pr), "--merge");
    if (m.status !== 0) return { ok: false, line: `NOT SHIPPED #${pr}: the merge failed: ${(m.stderr || "").trim().split("\n").pop()}. Merge it on GitHub, then run npm run release on main.` };
  }
  return { ok: true };
}

// release what main holds -> { ok, done: "Released x.y.z: ..." | undefined, why }
function releaseMain() {
  const git = spawnSync("git", ["switch", "main"], { cwd: ROOT, encoding: "utf8" });
  if (git.status !== 0) return { ok: false, why: `could not switch to main (${(git.stderr || "").trim()})` };
  const r = spawnSync(process.execPath, [path.join(__dirname, "release.js")], { cwd: ROOT, encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || ""); say(out.trim());
  const done = out.split("\n").find(l => /^Released /.test(l));
  return r.status === 0 && done ? { ok: true, done } : { ok: false, why: out.trim().split("\n").pop() };
}

async function ship(pr, opts) {
  const m = await merge(pr, opts);
  if (!m.ok) return m;
  const r = releaseMain();
  return r.ok ? { ok: true, line: `SHIPPED #${pr}: ${r.done}` } : { ok: false, line: `MERGED #${pr} but NOT RELEASED: ${r.why}. Run npm run release on main.` };
}

// open pull requests -> { take: [number, oldest first], skipped: [line] }   (the one rule for what --all picks up)
function allPlan(prs) {
  const sorted = [...prs].sort((a, b) => a.number - b.number);
  return { take: sorted.filter(p => !p.draft).map(p => p.number), skipped: sorted.filter(p => p.draft).map(p => `SKIPPED #${p.number}: it is a draft. Mark it ready on GitHub to ship it.`) };
}
// what the run ends with, one line that says whether a release went out. lines: what was said about each pull request left open;
// merged: the numbers this run merged; waiting: commits in main since the last release; release: releaseMain()'s answer, or null
function allEnd(lines, merged, waiting, release) {
  const bad = lines.filter(l => /^NOT SHIPPED/.test(l)).length;
  if (!merged.length && !waiting) return { ok: !bad, line: bad ? "NOTHING RELEASED: no pull request could be merged and main has nothing new." : "NOTHING TO RELEASE: no open pull requests and main is released." };
  const what = merged.length ? merged.map(n => "#" + n).join(", ") : "what was already merged";
  if (!release || !release.ok) return { ok: false, line: `MERGED ${what} but NOT RELEASED: ${(release || {}).why || "the release did not run"}. Run npm run release on main.` };
  return { ok: !bad, line: `SHIPPED ${what}: ${release.done}` + (bad ? ` (${bad} not shipped, see above)` : "") };
}

async function shipAll(opts) {
  const s = spawnSync(process.execPath, [path.join(__dirname, "sync.js")], { cwd: ROOT, encoding: "utf8" });
  say(((s.stdout || "") + (s.stderr || "")).trim());
  if (s.status !== 0) return { ok: false, line: "NOTHING SHIPPED: the sync failed (see above). Settle it, then run this again." };
  const open = openPrs(ROOT);
  if (!open.prs) return { ok: false, line: `NOTHING SHIPPED: ${open.why}.` };
  const { take, skipped } = allPlan(open.prs), lines = [...skipped], merged = [];
  skipped.forEach(say);
  for (const pr of take) {
    const m = await merge(pr, opts);
    if (m.ok) merged.push(pr); else { lines.push(m.line); say(m.line); }
  }
  gitIn(ROOT)("fetch", "--tags", "--quiet", "origin");
  const waiting = gitState(ROOT).merged.length;
  return allEnd(lines, merged, waiting, merged.length || waiting ? releaseMain() : null);
}

if (require.main === module) {
  const all = process.argv[2] === "--all", pr = Number(process.argv[2]);
  if (!all && !pr) { console.error("Usage: npm run ship -- <pull request number>   or   npm run ship -- --all"); process.exit(2); }
  (all ? shipAll() : ship(pr)).then(r => { console.log(r.line); process.exit(r.ok ? 0 : 1); });
}
module.exports = { plan, ship, allPlan, allEnd };
