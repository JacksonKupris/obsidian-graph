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
module.exports = { ROOT, fail, gitIn, gitOrFail, githubSlug, localConfig, python };
