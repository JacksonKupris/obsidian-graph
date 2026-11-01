#!/usr/bin/env node
// npm run sync between two computers: two clones of a scratch repository stand in for them, and a bare repository for
// GitHub (its github.com address is mapped onto it, so the pull request links come out as they would). Each case is what
// someone does day to day: commit and sync, pick up the other computer's work, keep uncommitted work, a conflict (nothing
// may change), a branch carried from one computer to the other with its pull request link, main moving ahead of a branch,
// a branch deleted on GitHub, a rebase left unfinished.
//   node tests/test_sync.js        exit 0 = pass
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const { sync } = require("../scripts/sync");
const fails = [], check = (what, ok, detail) => { if (!ok) fails.push(what + (detail ? `\n      ${detail}` : "")); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-sync-")), URL = "https://github.com/someone/project.git";
const git = (dir, ...a) => { const r = spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  if (r.status) throw new Error(`git ${a.join(" ")} in ${path.basename(dir)}: ${r.stderr}`); return (r.stdout || "").trim(); };
const write = (dir, f, text) => fs.writeFileSync(path.join(dir, f), text);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const commit = (dir, f, text, msg) => { write(dir, f, text); git(dir, "add", f); git(dir, "commit", "-q", "-m", msg); };
const said = r => r.lines.join("\n");

try {
  // GitHub, and a first commit on main
  const hub = path.join(tmp, "hub.git"); git(tmp, "init", "-q", "--bare", "-b", "main", hub);
  const clone = name => { const d = path.join(tmp, name);
    // line endings fixed at clone time: set after the checkout, Windows' autocrlf makes every file look changed
    git(tmp, "-c", `url.${hub.replace(/\\/g, "/")}.insteadOf=${URL}`, "clone", "-q", "-c", "core.autocrlf=false", URL, d);
    git(d, "config", `url.${hub.replace(/\\/g, "/")}.insteadOf`, URL); git(d, "config", "user.name", name); git(d, "config", "user.email", `${name}@example.com`);
    return d; };
  const A = clone("A");
  git(A, "switch", "-q", "-c", "main"); commit(A, "a.txt", "one\n", "start"); commit(A, "b.txt", "x\n", "b");
  let r = sync(A);
  check("a new main is put on GitHub", r.ok && git(hub, "rev-parse", "main") === git(A, "rev-parse", "HEAD"), said(r));
  const B = clone("B");

  // A commits and syncs; B syncs and has it
  commit(A, "a.txt", "one\ntwo\n", "two"); r = sync(A);
  check("commit + sync pushes", r.ok && /Pushed 1 commit on main/.test(said(r)), said(r));
  r = sync(B);
  check("the other computer takes it", r.ok && read(B, "a.txt") === "one\ntwo\n" && /Took 1 commit on main/.test(said(r)), said(r));

  // B has uncommitted work in another file; A pushes; B syncs: takes it, and the work is still there, uncommitted
  write(B, "b.txt", "x\nwork in progress\n");
  commit(A, "a.txt", "one\ntwo\nthree\n", "three"); sync(A);
  r = sync(B);
  check("uncommitted work survives taking new commits", r.ok && read(B, "a.txt").endsWith("three\n") && read(B, "b.txt") === "x\nwork in progress\n"
    && /1 file changed here and not committed yet/.test(said(r)), said(r));
  git(B, "checkout", "--", "b.txt");

  // a conflict: both change the same line. B's sync changes nothing and says how to settle it
  commit(A, "a.txt", "one\ntwo\nTHREE from A\n", "A edits"); sync(A);
  commit(B, "a.txt", "one\ntwo\nthree from B\n", "B edits");
  const before = git(B, "rev-parse", "HEAD"); r = sync(B);
  check("a conflict fails, names the file, gives the steps", !r.ok && /a\.txt/.test(said(r)) && /git rebase --continue/.test(said(r)), said(r));
  check("a conflict leaves everything as it was", git(B, "rev-parse", "HEAD") === before && read(B, "a.txt") === "one\ntwo\nthree from B\n" && !git(B, "status", "--porcelain"));
  git(B, "reset", "-q", "--hard", "origin/main");

  // a branch: A starts it and syncs (it goes to GitHub, with its pull request link); B carries on with it
  git(A, "switch", "-q", "-c", "feature/x"); commit(A, "c.txt", "feature\n", "feature start");
  r = sync(A);
  check("a new branch goes to GitHub", r.ok && /Put feature\/x on GitHub/.test(said(r)) && git(hub, "rev-parse", "feature/x") === git(A, "rev-parse", "HEAD"), said(r));
  check("it gives the pull request link", /Open a pull request: https:\/\/github\.com\/someone\/project\/compare\/main\.\.\.feature%2Fx\?expand=1/.test(said(r)), said(r));
  git(B, "fetch", "-q"); git(B, "switch", "-q", "feature/x"); commit(B, "c.txt", "feature\nmore from B\n", "B continues");
  r = sync(B); check("the other computer pushes to the branch", r.ok && /Pushed 1 commit on feature\/x/.test(said(r)), said(r));
  r = sync(A); check("and the first one takes it", r.ok && read(A, "c.txt") === "feature\nmore from B\n", said(r));

  // main moves on (another pull request merged): the branch is told, and local main catches up without switching
  git(B, "switch", "-q", "main"); commit(B, "d.txt", "other\n", "other change"); sync(B);
  r = sync(A);
  check("a branch behind main is told how to catch up", r.ok && /main has 1 commit this branch doesn't.*git merge origin\/main/.test(said(r)), said(r));
  check("local main is brought up to date from another branch", git(A, "rev-parse", "main") === git(hub, "rev-parse", "main") && /Main: took 1 commit/.test(said(r)), said(r));
  git(A, "merge", "-q", "--no-edit", "origin/main"); r = sync(A);
  check("merging main in then syncing pushes it, no force needed", r.ok && git(hub, "rev-parse", "feature/x") === git(A, "rev-parse", "HEAD"), said(r));

  // the pull request is merged and GitHub deletes the branch: listed, never deleted here
  git(hub, "update-ref", "refs/heads/main", git(A, "rev-parse", "HEAD")); git(hub, "branch", "-D", "feature/x");
  git(A, "switch", "-q", "main"); r = sync(A);
  check("a branch deleted on GitHub is listed, not deleted", r.ok && /Deleted on GitHub.*feature\/x/.test(said(r)) && git(A, "branch", "--list", "feature/x"), said(r));

  // a rebase left unfinished: sync won't touch it
  commit(A, "a.txt", "conflict A\n", "a1"); sync(A); commit(B, "a.txt", "conflict B\n", "b1");
  git(B, "fetch", "-q"); spawnSync("git", ["rebase", "origin/main"], { cwd: B });
  r = sync(B); check("an unfinished rebase is reported, not touched", !r.ok && /rebase is still in progress/.test(said(r)), said(r));
  spawnSync("git", ["rebase", "--abort"], { cwd: B });
} catch (e) { fails.push(e.message); }
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
console.log(fails.length ? "FAIL - sync:\n  " + fails.join("\n  ") : "ok - sync: push, take, keep uncommitted work, conflicts change nothing, branches travel with a pull request link");
process.exit(fails.length ? 1 : 0);
