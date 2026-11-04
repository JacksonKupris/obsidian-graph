#!/usr/bin/env node
// Keep this computer the same as GitHub, on whatever branch you're on: take what other computers pushed to it, push
// what this one committed, and keep main up to date too. Run it before starting work and after each commit, on every
// computer (release.js runs it first). Work happens on a branch per change, merged into main by a pull request
// (RELEASING.md, "How code flows").
//   node scripts/sync.js        npm run sync
// Work you haven't committed stays as it is: set aside while new commits come in, then put back. Your commits go on top
// of the branch's newer ones on GitHub (a rebase), so its history stays one line. A conflict is undone, leaving
// everything as it was, and the files are named with the steps to settle them.
const fs = require("fs"), path = require("path");
const { ROOT, gitIn, githubSlug } = require("./lib");
const commits = n => (n === 1 ? "1 commit" : `${n} commits`);
// the address as configured (get-url would give it after url.*.insteadOf rewriting)
const repoUrl = git => { const slug = githubSlug(git("config", "--get", "remote.origin.url").out); return slug ? `https://github.com/${slug}` : null; };

// -> { ok, lines: [what happened, for the person running it] }. dir: the repository (tests pass a scratch one)
function sync(dir = ROOT) {
  const git = gitIn(dir);
  const lines = [], done = ok => ({ ok, lines });
  // a rebase or merge left unfinished (by hand, or an interrupted run) has to be settled first; checked before the
  // branch, since a rebase in progress isn't on one
  const inGit = p => fs.existsSync(path.resolve(dir, git("rev-parse", "--git-path", p).out));
  if (inGit("rebase-merge") || inGit("rebase-apply")) { lines.push("FAIL - a rebase is still in progress here. Finish it (git rebase --continue) or undo it (git rebase --abort), then npm run sync"); return done(false); }
  if (inGit("MERGE_HEAD")) { lines.push("FAIL - a merge is still in progress here. Finish it (git commit) or undo it (git merge --abort), then npm run sync"); return done(false); }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
  if (!branch || branch === "HEAD") { lines.push("FAIL - not on a branch (a detached checkout): git switch main, then npm run sync"); return done(false); }
  const f = git("fetch", "-q", "--prune", "--tags", "origin");
  if (!f.ok) { lines.push(`FAIL - can't reach GitHub: ${f.err.split("\n").pop()}`, "Keep working and committing; run npm run sync once you're online."); return done(false); }

  // 1. this branch: take GitHub's newer commits on it (another computer's), then push this one's
  const remote = git("rev-parse", "-q", "--verify", `refs/remotes/origin/${branch}`).ok;
  const count = () => git("rev-list", "--left-right", "--count", `${branch}...origin/${branch}`).out.split(/\s+/).map(Number);
  let first = false;
  if (remote) {
    if (!git("rev-parse", "--abbrev-ref", `${branch}@{upstream}`).ok) git("branch", "-q", "-u", `origin/${branch}`);
    let [ahead, behind] = count();
    if (behind) {
      const stashes = git("stash", "list").out.split("\n").filter(Boolean).length;
      if (!git("rebase", "--autostash", `origin/${branch}`).ok) {
        const files = git("diff", "--name-only", "--diff-filter=U").out.split("\n").filter(Boolean);
        git("rebase", "--abort");   // back to exactly how it was, uncommitted work included
        lines.push(`FAIL - your commits and GitHub's change the same lines${files.length ? " in " + files.join(", ") : ""}. Nothing was changed here.`,
          "To settle it:", "  git pull --rebase", "  (open each file named, keep the right lines, delete the <<<<<<< ======= >>>>>>> marks)",
          "  git add <file>", "  git rebase --continue", "  npm run sync");
        return done(false);
      }
      if (git("stash", "list").out.split("\n").filter(Boolean).length > stashes)
        lines.push("Note: your uncommitted changes clash with the new commits, so they're kept aside: git stash pop, then settle the files it names");
      lines.push(`Took ${commits(behind)} on ${branch} from GitHub`);
      [ahead, behind] = count();
    }
    if (ahead) {
      const p = git("push", "-q", "origin", branch);
      if (!p.ok) { lines.push(`FAIL - couldn't push ${commits(ahead)} on ${branch}: ${p.err.split("\n").pop()}`, "Sign in to GitHub (the push asks), then npm run sync again"); return done(false); }
      lines.push(`Pushed ${commits(ahead)} on ${branch} to GitHub`);
    }
  } else if (git("rev-list", "--count", `origin/main..${branch}`).out !== "0" || branch === "main") {
    // a branch only this computer has: put it on GitHub, so every computer can carry on with it
    const p = git("push", "-q", "-u", "origin", branch);
    if (!p.ok) { lines.push(`FAIL - couldn't put ${branch} on GitHub: ${p.err.split("\n").pop()}`, "Sign in to GitHub (the push asks), then npm run sync again"); return done(false); }
    lines.push(`Put ${branch} on GitHub`); first = true;
  }

  // 2. main, when you're on another branch: brought up to date without switching to it (only ever fast-forward)
  if (branch !== "main" && git("rev-parse", "-q", "--verify", "refs/heads/main").ok) {
    const [mAhead, mBehind] = git("rev-list", "--left-right", "--count", "main...origin/main").out.split(/\s+/).map(Number);
    if (mBehind && !mAhead) { git("update-ref", "refs/heads/main", "refs/remotes/origin/main"); lines.push(`Main: took ${commits(mBehind)} from GitHub`); }
    else if (mAhead) lines.push(`Note: main here has ${commits(mAhead)} GitHub doesn't. Switch to it and sync: git switch main, npm run sync`);
  }

  // 3. where this branch stands, and what to do next
  const head = git("log", "-1", "--format=%h %s").out, url = repoUrl(git);
  lines.push(`In sync with GitHub: ${branch} at ${head}`);
  if (branch !== "main") {
    const newer = Number(git("rev-list", "--count", `${branch}..origin/main`).out), mine = Number(git("rev-list", "--count", `origin/main..${branch}`).out);
    // merged in, not rebased: rebasing a branch that's already on GitHub rewrites what other computers have
    if (newer) lines.push(`main has ${commits(newer)} this branch doesn't. To build on them: git merge origin/main, then npm run sync`);
    if (mine && url) lines.push(`${first ? "Open a pull request" : "Its pull request"}: ${url}/compare/main...${encodeURIComponent(branch)}?expand=1`);
  }
  const dirty = git("status", "--porcelain").out.split("\n").filter(Boolean).length;
  if (dirty) lines.push(`${dirty === 1 ? "1 file" : dirty + " files"} changed here and not committed yet: commit them (git add -A, git commit -m "..."), then npm run sync`);
  // local branches GitHub no longer has (deleted after their pull request was merged, or closed): listed, never deleted
  const gone = git("for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads").out.split("\n")
    .filter(l => / \[gone\]$/.test(l)).map(l => l.split(" ")[0]).filter(b => b !== branch);
  if (gone.length) lines.push(`Deleted on GitHub (pull request merged or closed): ${gone.join(", ")}. Once nothing on them is needed: git branch -D ${gone.join(" ")}`);
  return done(true);
}

module.exports = { sync };

if (require.main === module) { const r = sync(); console.log(r.lines.join("\n")); process.exit(r.ok ? 0 : 1); }
