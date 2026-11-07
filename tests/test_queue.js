#!/usr/bin/env node
// npm run queue: the check states, what git alone knows (a scratch repository with a release tag, a merged pull request and
// a pushed branch nobody opened a pull request for), the gh half through a stand-in that can fail, and the printed lines.
//   node tests/test_queue.js        exit 0 = pass
const { checks, finish } = require("./kit");
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const { checkState, gitState, render, openPrs } = require("../scripts/queue");
const { fails, that: check } = checks();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-queue-"));
const git = (dir, ...a) => { const r = spawnSync("git", a, { cwd: dir, encoding: "utf8" }); if (r.status) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return (r.stdout || "").trim(); };
const commit = (dir, f, msg) => { fs.writeFileSync(path.join(dir, f), msg + "\n"); git(dir, "add", f); git(dir, "commit", "-q", "-m", msg); };
try {
  // check states
  check(checkState([]) === "none" && checkState(undefined) === "none", "no checks should be 'none'");
  check(checkState([{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }]) === "pass", "all passed");
  check(checkState([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]) === "fail", "one failure fails the lot");
  check(checkState([{ status: "IN_PROGRESS", conclusion: "" }]) === "pending", "still running is pending");

  // git: main with a release tag, then a merged PR, and a pushed branch with no PR (a bare repo stands in for GitHub)
  const hub = path.join(tmp, "hub.git"), A = path.join(tmp, "A");
  git(tmp, "init", "-q", "--bare", "-b", "main", hub); git(tmp, "clone", "-q", hub, A);
  git(A, "config", "user.name", "t"); git(A, "config", "user.email", "t@example.com"); git(A, "switch", "-q", "-c", "main");
  commit(A, "a.txt", "first"); git(A, "tag", "0.1.0"); git(A, "push", "-q", "origin", "main", "--tags");
  git(A, "switch", "-q", "-c", "feat/done"); commit(A, "b.txt", "feature"); git(A, "switch", "-q", "main");
  git(A, "merge", "-q", "--no-ff", "-m", "Merge pull request #1 from x/feat/done", "feat/done"); git(A, "push", "-q", "origin", "main");
  git(A, "switch", "-q", "-c", "feat/loose"); commit(A, "c.txt", "loose work"); git(A, "push", "-q", "-u", "origin", "feat/loose");
  git(A, "switch", "-q", "-c", "feat/open"); commit(A, "d.txt", "open work"); git(A, "push", "-q", "-u", "origin", "feat/open");
  const g = gitState(A, "origin/main", new Set(["feat/open"]));
  check(g.tag === "0.1.0", `last release ${g.tag}`);
  check(g.merged.length === 1 && /pull request #1/.test(g.merged[0]), `merged since the release: ${JSON.stringify(g.merged)}`);
  check(g.loose.length === 1 && g.loose[0].branch === "feat/loose" && g.loose[0].ahead === 1, `branches with no PR: ${JSON.stringify(g.loose)}`);
  check(gitState(A, "origin/main", new Set(["feat/open", "feat/loose"])).loose.length === 0, "a branch with a PR is not 'loose'");
  const none = gitState(path.join(tmp, "nowhere-" + Date.now()));
  check(none.tag === null && none.merged.length === 0, "a folder that isn't a repository shows nothing, without throwing");

  // gh through a stand-in: good output, a missing gh, a failing gh, junk
  const good = JSON.stringify([{ number: 7, title: "T", headRefName: "feat/open", isDraft: false, statusCheckRollup: [{ conclusion: "SUCCESS" }] }]);
  const p = openPrs(A, () => ({ status: 0, stdout: good }));
  check(p.prs && p.prs[0].checks === "pass" && p.prs[0].branch === "feat/open", "parses a pull request");
  check(/isn't installed/.test(openPrs(A, () => ({ error: new Error("ENOENT") })).why || ""), "a missing gh says to install it");
  check(/gh auth status/.test(openPrs(A, () => ({ status: 1, stderr: "not logged in" })).why || ""), "a failing gh names the next step");
  check(/isn't JSON/.test(openPrs(A, () => ({ status: 0, stdout: "oops" })).why || ""), "junk output is reported, not swallowed");

  // the printed lines: every section, the next step for each state, and the reason when pull requests can't be listed
  const text = render({ git: g, prs: [{ number: 7, title: "T", branch: "b", draft: false, checks: "pass" }, { number: 8, title: "U", branch: "c", draft: true, checks: "fail" }] }).join("\n");
  for (const want of ["last release: 0.1.0", "#7 T", "ready to merge (you)", "fix the failing check", "(draft)", "Merged, not released (1)", "npm run release", "feat/loose", "open a PR, or delete the branch"])
    check(text.includes(want), `the queue lacks "${want}"`);
  check(render({ git: g, prs: null, prsWhy: "gh missing" }).join("\n").includes("not shown: gh missing"), "no gh: says why");
  check(render({ git: { tag: null, merged: [], loose: [] }, prs: [] }).join("\n").includes("main is what was released"), "an empty queue says so");
} catch (e) { check(false, "threw: " + e.message); }
fs.rmSync(tmp, { recursive: true, force: true });
finish(fails, "queue: check states, the git half, gh failures and the printed lines", "queue");
