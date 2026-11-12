// lib.js - what the scripts share: failing out, running git, finding this computer's vault and its Python.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");

const fail = msg => { console.log("FAIL - " + msg); process.exit(1); };
// git in a folder, for code that decides what a failure means: git(...args) -> { ok, out, err }
const gitIn = dir => (...args) => { const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" }); return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() }; };
// git that ends the script on a failure, saying what failed: git(...args) -> its output
const gitOrFail = dir => (...args) => { const r = gitIn(dir)(...args); if (!r.ok) fail(`git ${args.join(" ")}\n${r.err || r.out}`); return r.out; };
// "owner/name" from a GitHub address, or undefined
const githubSlug = url => (String(url).match(/github\.com[:/](.+?)(\.git)?\s*$/) || [])[1];
// this computer's settings (local.json, not in git). A missing or broken file is no settings.
const localConfig = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")); } catch (e) { return {}; } };
const python = () => (process.platform === "win32" ? "python" : "python3");
// The release rules, written once for the local script (release.js) and the one GitHub runs after a merge (ci_release.js).
// the next version from the current one and a step: patch, minor, major or an exact x.y.z (undefined when it is none of them)
const nextVersion = (current, step) => {
  const [ma, mi, pa] = String(current).split(".").map(Number);
  return /^\d+\.\d+\.\d+$/.test(step) ? step : { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[step];
};
// whether a changed file ends up in the plugin's three files (what build.js reads); a docs, test or script change releases nothing
const shipsInPlugin = file => /^(src\/|config\/|build\.js$|package(-lock)?\.json$|manifest\.json$)/.test(String(file).replace(/\\/g, "/"));
// the step a merge asks for in its message (a pull request's title is in its merge commit): "[major]" or "[minor]", else patch
const stepFromMessages = messages => /\[major\]/i.test(messages) ? "major" : /\[minor\]/i.test(messages) ? "minor" : "patch";
module.exports = { nextVersion, shipsInPlugin, stepFromMessages, ROOT, fail, gitIn, gitOrFail, githubSlug, localConfig, python };
