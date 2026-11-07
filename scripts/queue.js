#!/usr/bin/env node
// The release queue: what is open, what has merged and not shipped, and the next step for each, read from git and GitHub
// at the moment you ask, so there is no list to keep up to date. Releases themselves stay a decision (RELEASING.md).
//   node scripts/queue.js        npm run queue
// Needs: git, and for pull requests the GitHub CLI (`gh auth login`). Without gh or a connection, the git half still prints
// (merged since the last release, branches with no pull request) and says what is missing.
const { spawnSync } = require("child_process");
const { ROOT, gitIn } = require("./lib");

// -> "pass" | "fail" | "pending" | "none", from a pull request's check results
function checkState(checks) {
  const rs = (checks || []).map(c => String(c.conclusion || c.state || c.status || "").toUpperCase());
  if (!rs.length) return "none";
  if (rs.some(r => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(r))) return "fail";
  if (rs.every(r => ["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"].includes(r))) return "pass";
  return "pending";
}

// What git alone knows -> { tag, merged: [subject], loose: [{ branch, ahead }] }. dir: the repository (tests pass a scratch one)
function gitState(dir = ROOT, base = "origin/main", prHeads = new Set()) {
  const git = gitIn(dir);
  const tag = git("describe", "--tags", "--abbrev=0", base);
  const range = tag.ok ? `${tag.out}..${base}` : base;
  const merged = git("log", range, "--first-parent", "--pretty=%s").out.split("\n").filter(Boolean);
  const loose = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin").out.split("\n")
    .filter(r => r && r !== "origin/HEAD" && r !== base && !prHeads.has(r.replace(/^origin\//, "")))
    .map(r => ({ branch: r.replace(/^origin\//, ""), ahead: +git("rev-list", "--count", `${base}..${r}`).out || 0 })).filter(b => b.ahead > 0);
  return { tag: tag.ok ? tag.out : null, merged, loose };
}

// The next step for a pull request, one rule for every place that shows one
const nextStep = pr => ({ pass: "ready to merge (you)", fail: "fix the failing check, then wait for it", pending: "wait for the checks", none: "no checks yet: open the PR page" }[pr.checks]) + (pr.draft ? " (draft)" : "");

// state: { git, prs: [{ number, title, branch, draft, checks }] | null, prsWhy } -> the lines to print
function render(state) {
  const { git, prs } = state, out = [];
  out.push(`Release queue (last release: ${git.tag || "none found"})`);
  out.push("", `Open pull requests${prs ? ` (${prs.length})` : ""}`);
  if (!prs) out.push(`  not shown: ${state.prsWhy}`);
  else if (!prs.length) out.push("  none");
  else prs.forEach(p => out.push(`  #${p.number} ${p.title}  [${p.branch}]  checks: ${p.checks}  -> ${nextStep(p)}`));
  out.push("", `Merged, not released (${git.merged.length})`);
  if (!git.merged.length) out.push("  nothing: main is what was released");
  else { git.merged.forEach(m => out.push("  " + m)); out.push("  -> release when you decide: npm run release (RELEASING.md)"); }
  out.push("", `Pushed branches with no pull request (${git.loose.length})`);
  if (!git.loose.length) out.push("  none");
  else git.loose.forEach(b => out.push(`  ${b.branch} (${b.ahead} commit${b.ahead === 1 ? "" : "s"} ahead of main)  -> open a PR, or delete the branch`));
  return out;
}

// pull requests through gh -> { prs } or { why }
function openPrs(dir = ROOT, run = (...a) => spawnSync("gh", a, { cwd: dir, encoding: "utf8" })) {
  const r = run("pr", "list", "--state", "open", "--json", "number,title,headRefName,isDraft,statusCheckRollup", "--limit", "100");
  if (r.error) return { why: "the GitHub CLI (gh) isn't installed. Install it, then `gh auth login`" };
  if (r.status) return { why: `gh failed (${(r.stderr || "").trim().split("\n")[0] || "no message"}). Run \`gh auth status\`; offline, only the git half is shown` };
  try { return { prs: JSON.parse(r.stdout).map(p => ({ number: p.number, title: p.title, branch: p.headRefName, draft: !!p.isDraft, checks: checkState(p.statusCheckRollup) })) }; }
  catch (e) { return { why: "gh printed something that isn't JSON" }; }
}

function main() {
  const git = gitIn(ROOT);
  if (!git("rev-parse", "--git-dir").ok) { console.log("FAIL - not inside the repository. cd into it, then npm run queue"); process.exit(1); }
  const f = git("fetch", "--tags", "--quiet", "origin");
  const note = f.ok ? [] : ["(could not reach GitHub: showing what this computer last fetched)"];
  const pr = openPrs(ROOT), heads = new Set((pr.prs || []).map(p => p.branch));
  console.log([...note, ...render({ git: gitState(ROOT, "origin/main", heads), prs: pr.prs || null, prsWhy: pr.why })].join("\n"));
}

module.exports = { checkState, gitState, nextStep, render, openPrs };
if (require.main === module) main();
