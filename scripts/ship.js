#!/usr/bin/env node
// Ship a pull request: wait for its checks, merge it when they pass, release, and end with one line that says what happened.
//   node scripts/ship.js <pr number>        npm run ship -- 36
// It runs in the foreground so a person sees it, and an agent starts it in the background so it is told when it ends. A failed
// check, a conflict or a failed release stops it with the reason and the next step; nothing is retried blindly.
// Needs the GitHub CLI (`gh auth login`). By hand: wait for the checks, merge on GitHub, then `npm run release` on main (RELEASING.md).
const { spawnSync } = require("child_process");
const path = require("path");
const { ROOT } = require("./lib"), { checkState } = require("./queue");

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

async function ship(pr, { poll = 30000 } = {}) {
  const say = m => console.log(m);
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
  const git = spawnSync("git", ["switch", "main"], { cwd: ROOT, encoding: "utf8" });
  if (git.status !== 0) return { ok: false, line: `MERGED #${pr} but NOT RELEASED: could not switch to main (${(git.stderr || "").trim()}). Run npm run release on main.` };
  const r = spawnSync(process.execPath, [path.join(__dirname, "release.js")], { cwd: ROOT, encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || ""); say(out.trim());
  const done = out.split("\n").find(l => /^Released /.test(l));
  return r.status === 0 && done ? { ok: true, line: `SHIPPED #${pr}: ${done}` } : { ok: false, line: `MERGED #${pr} but NOT RELEASED: ${out.trim().split("\n").pop()}. Run npm run release on main.` };
}

if (require.main === module) {
  const pr = Number(process.argv[2]);
  if (!pr) { console.error("Usage: npm run ship -- <pull request number>"); process.exit(2); }
  ship(pr).then(r => { console.log(r.line); process.exit(r.ok ? 0 : 1); });
}
module.exports = { plan, ship };
