// vault_hq.js - reads a vault folder the way the plugin does, for pages that run without Obsidian (the phone app, the tests).
// hqFromFolder(dir, rules, today) -> { hq, journalHistory }: data.hq (what HQ reads) and every journal's tasks (what Task survival reads).
const fs = require("fs"), path = require("path"), build = require("../build");
const SKIP = new Set([".obsidian", ".trash", ".git", ".cache", ".smart-env", "node_modules"]);

function hqFromFolder(dir, rules, today) {
  const VGRules = new Function(`${build.rulesSource(rules)}; return VGRules;`)(), H = rules.hq || {}, day = today || VGRules.today(), files = [], journalHistory = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name), rel = path.relative(dir, p).split(path.sep).join("/");
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); return; }
    if (H.automation_status && rel.startsWith(H.automation_status + "/") && e.name.endsWith(".json")) { try { files.push({ path: rel, json: JSON.parse(fs.readFileSync(p, "utf8")) }); } catch (err) { /* half-written */ } return; }
    if (!e.name.endsWith(".md")) return;
    const text = fs.readFileSync(p, "utf8"), j = VGRules.journalOf(rel, text);
    if (j) journalHistory.push(j);
    if (VGRules.hqKind(rel, VGRules.frontOf(text), day, /^\s*[-*+] \[ \]/m.test(text))) files.push({ path: rel, text });
  });
  walk(dir);
  return { hq: VGRules.hqGather(files, { today: day }), journalHistory };
}
module.exports = { hqFromFolder };
