#!/usr/bin/env node
// The release GitHub makes after a merge to main (the `release` job in .github/workflows/test.yml), and the publish step
// release.yml shares. Merging a pull request is the release: the job needs the test shards, so it only runs on code that passed.
//   node scripts/ci_release.js                 decide from git, then bump, commit, tag, push and publish (what the job runs)
//   node scripts/ci_release.js --plan          print what it would do and change nothing (runs anywhere, also by hand)
//   node scripts/ci_release.js --publish <v>   build the three files and make the GitHub release for tag <v> (release.yml)
// A pull request whose title has [minor] or [major] makes that step; the head commit with [no release] makes none. Only
// changes to what ships (src/, config/, build.js, package files) release, so a docs or test merge doesn't reach every device.
// By hand, or when this job fails: RELEASING.md.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { ROOT, gitIn, nextVersion, shipsInPlugin, stepFromMessages } = require("./lib");

// what to do about main -> { action: "skip" | "publish" | "release", why, version?, step? }   (the one rule; plan() in tests)
//   last: the newest version tag ("0.6.84") or ""; tagHasRelease: GitHub has a release for it; files / messages: changed since it
//   current: package.json's version; behind: origin/main has a commit this run didn't test (a later run releases it too)
function plan({ last, tagHasRelease, files, messages, headMessage, current, behind }) {
  if (behind) return { action: "skip", why: "main has a newer commit; its run releases this one too" };
  if (last && !tagHasRelease) return { action: "publish", version: last, why: `${last} is tagged but has no GitHub release` };
  if (/\[no release\]/i.test(headMessage || "")) return { action: "skip", why: "the head commit says [no release]" };
  const shipped = files.filter(shipsInPlugin);
  if (!shipped.length) return { action: "skip", why: `nothing that ships has changed since ${last || "the start"}` };
  const step = stepFromMessages(messages), version = nextVersion(current, step);
  return { action: "release", step, version, why: `${shipped.length} shipped file(s) changed since ${last || "the start"}: ${step}` };
}

// the three files Obsidian and BRAT install, on a GitHub release for the tag
function publish(version, run = (c, a) => spawnSync(c, a, { cwd: ROOT, stdio: "inherit" })) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (pkg.version !== version) throw new Error(`the tag ${version} doesn't match package.json's ${pkg.version}`);
  for (const [c, a] of [[process.execPath, ["build.js", "manifest"]], ["git", ["diff", "--exit-code", "manifest.json"]], [process.execPath, ["build.js", "--out", "dist"]]])
    if (run(c, a).status) throw new Error(`${c} ${a.join(" ")} failed`);
  const r = run("gh", ["release", "create", version, "dist/main.js", "dist/manifest.json", "dist/styles.css", "--title", version, "--generate-notes", "--verify-tag"]);
  if (r.status) throw new Error(`gh release create ${version} failed`);
}

function main() {
  const git = gitIn(ROOT), args = process.argv.slice(2), dry = args.includes("--plan");
  const out = (...a) => { const r = git(...a); if (!r.ok) { console.error(`git ${a.join(" ")}: ${r.err}`); process.exit(1); } return r.out; };
  if (args[0] === "--publish") { publish(args[1]); return; }
  if (!dry) { git("fetch", "--tags", "--quiet", "origin", "main"); }
  const tags = out("tag", "--list", "--sort=-v:refname").split(/\r?\n/).filter(t => /^\d+\.\d+\.\d+$/.test(t));
  const last = tags[0] || "", range = last ? `${last}..HEAD` : "HEAD";
  const files = last ? out("diff", "--name-only", `${last}`, "HEAD").split(/\r?\n/).filter(Boolean) : out("ls-files").split(/\r?\n/);
  const has = last ? spawnSync("gh", ["release", "view", last], { cwd: ROOT }).status === 0 : true;
  const head = out("rev-parse", "HEAD"), remote = git("rev-parse", "origin/main");
  const p = plan({
    last, tagHasRelease: has, files, current: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version,
    messages: out("log", "--format=%s%n%b", range), headMessage: out("log", "-1", "--format=%B"),
    behind: !dry && remote.ok && remote.out !== head,
  });
  console.log(`${p.action}: ${p.why}${p.version ? ` (${p.version})` : ""}`);
  if (dry || p.action === "skip") return;
  if (p.action === "release") {
    const pkgFile = path.join(ROOT, "package.json"), pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    pkg.version = p.version; fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
    if (spawnSync(process.execPath, ["build.js", "manifest"], { cwd: ROOT, stdio: "inherit" }).status) process.exit(1);
    out("-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-q", "-m", `Release ${p.version}`, "--", "package.json", "manifest.json");
    out("tag", p.version);
    out("push", "--atomic", "origin", "HEAD:main", p.version);   // refused if main moved: a newer run releases it all
  }
  publish(p.version);
}
if (require.main === module) { try { main(); } catch (e) { console.error(`NOT RELEASED: ${e.message}\nRe-run this job once; a published tag with no release is picked up then. By hand: RELEASING.md`); process.exit(1); } }
module.exports = { plan, publish };
