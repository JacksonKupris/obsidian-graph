// What the tests run on, in one place: the sample vault (fixtures/, the default) or a real vault (--vault [dir];
// without a dir, local.json's "vault"). Every test loads the page, rules and notes through here.
//   const env = require("./env")
//   env.rules · env.data() · env.page() · env.out(...p) · env.notes() · env.VAULT (null for the sample) · env.args
const fs = require("fs"), path = require("path"), build = require("../build");
const ROOT = build.ROOT, SAMPLE = path.join(ROOT, "fixtures");

function localConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")); } catch (e) { return {}; }
}
const at = process.argv.indexOf("--vault");
const given = at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : null;
const VAULT = at < 0 ? null : path.resolve(given || localConfig().vault || "");
if (VAULT && !fs.existsSync(VAULT)) { console.log(`FAIL - no vault at ${VAULT} (pass --vault <dir> or set "vault" in local.json)`); process.exit(2); }

// a vault's rules file: local.json "rules", else where this vault keeps it today (the analysis's folder)
const RULES_FILE = VAULT ? path.resolve(VAULT, localConfig().rules || "_scripts/vault_graph_rules.json") : path.join(ROOT, "config", "rules.json");
const rules = build.loadRules(RULES_FILE);

const data = () => JSON.parse(fs.readFileSync(VAULT ? path.join(VAULT, rules.files.data) : path.join(SAMPLE, "sample-graph.json"), "utf8"));
const page = () => build.buildPage(data(), rules);
// generated test output (screenshots, reports, the polish loop's last pass): .out/, never in a vault
const out = (...p) => path.join(ROOT, ".out", ...p);

// the notes of the vault under test; the sample vault's are generated (not committed) the first time they're needed
function dir() {
  if (VAULT) return VAULT;
  const d = path.join(SAMPLE, "sample-vault");
  if (!fs.existsSync(d)) require("child_process").execFileSync(process.execPath, [path.join(SAMPLE, "make_sample.js")], { stdio: "ignore" });
  return d;
}

// the vault's notes as the plugin's search reads them (VGRules.recallChunks), for tests that search
function notes() {
  const VGRules = new Function(`${fs.readFileSync(path.join(ROOT, "src", "rules.js"), "utf8").replace("__RULES_JSON__", JSON.stringify(rules))}; return VGRules;`)();
  const dir = module.exports.dir(), list = [];
  const skip = new Set([".obsidian", ".trash", ".git", ".cache", "node_modules", rules.folders.templates]);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name), rel = path.relative(dir, p).replace(/\\/g, "/");
    if (e.isDirectory()) { if (!skip.has(e.name) && rel !== rules.folders.reports && !(rules.folders.exclude || []).some(x => rel.startsWith(x))) walk(p); }
    else if (e.name.endsWith(".md")) { const t = fs.readFileSync(p, "utf8"); list.push({ path: rel, date: VGRules.recallNoteDate(rel, t), chunks: VGRules.recallChunks(t) }); }
  });
  walk(dir);
  return { VGRules, list };
}

// arguments to pass on to another test, so it runs on the same vault
const args = VAULT ? ["--vault", VAULT] : [];

module.exports = { ROOT, VAULT, RULES_FILE, rules, data, page, out, notes, dir, args };
