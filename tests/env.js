// What the tests run on, in one place: the sample vault (fixtures/, the default) or a real vault (--vault [dir];
// without a dir, local.json's "vault"). Every test loads the page, rules and notes through here.
//   const env = require("./env")
//   env.rules · env.data() · env.page() · env.pageWith(mountOptions) · env.inlineJson(v) · env.out(...p) · env.notes() · env.VAULT (null for the sample) · env.args
const fs = require("fs"), path = require("path"), build = require("../build");
const ROOT = build.ROOT, SAMPLE = path.join(ROOT, "fixtures");

function localConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")); } catch (e) { return {}; }
}
const at = process.argv.indexOf("--vault");
const given = at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : null;
const named = at < 0 ? null : given || localConfig().vault || null;
if (at >= 0 && !named) { console.log(`FAIL - --vault needs a folder (pass --vault <dir> or set "vault" in local.json)`); process.exit(2); }
const VAULT = named && path.resolve(named);
if (VAULT && !fs.existsSync(VAULT)) { console.log(`FAIL - no vault at ${VAULT} (pass --vault <dir> or set "vault" in local.json)`); process.exit(2); }

// a vault's rules file: local.json "rules", else where this vault keeps it today (the analysis's folder)
const RULES_FILE = VAULT ? path.resolve(VAULT, localConfig().rules || "_scripts/vault_graph_rules.json") : path.join(ROOT, "config", "rules.json");
const rules = build.loadRules(RULES_FILE);

const data = () => JSON.parse(fs.readFileSync(VAULT ? path.join(VAULT, rules.files.data) : path.join(SAMPLE, "sample-graph.json"), "utf8"));
const page = () => build.buildPage(data(), rules);
// the page with extra mount options (`mobile: true,`, a recall stub...) put where it mounts the graph. A page that
// no longer mounts it that way throws, so a test can't quietly run without its options.
const MOUNT = 'window.vaultGraph = mountVaultGraph(document.getElementById("vg"), DATA, {';
function pageWith(extra) {
  const p = page();
  if (!extra) return p;
  if (!p.includes(MOUNT)) throw new Error("the page doesn't mount the graph the way tests/env.js MOUNT expects");
  return p.replace(MOUNT, () => `${MOUNT} ${extra}`);   // a function: a "$" in the options stays as written
}
// a value as JS source safe inside an inline <script> (note text can hold "</script>" or "<!--")
const inlineJson = v => JSON.stringify(v).replace(/</g, "\\u003c");
// generated test output (screenshots, reports, the polish loop's last pass): .out/, never in a vault
const out = (...p) => path.join(ROOT, ".out", ...p);

// the notes of the vault under test; the sample vault's are generated (not committed) the first time they're needed
function dir() {
  if (VAULT) return VAULT;
  const d = path.join(SAMPLE, "sample-vault");
  // HQ's tasks are relative to the local day; a yesterday cache is stale even if graph data is unchanged.
  const generated = path.join(d, ".generated-day"), now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const stale = () => !fs.existsSync(generated) || fs.readFileSync(generated, "utf8").trim() !== day
    || fs.statSync(d).mtimeMs < fs.statSync(path.join(SAMPLE, "sample-graph.json")).mtimeMs
    || data().nodes.some(n => !n.ghost && !n.person && !fs.existsSync(path.join(d, n.id)));
  if (!fs.existsSync(d) || stale()) require("child_process").execFileSync(process.execPath, [path.join(SAMPLE, "make_sample.js")], { stdio: "ignore" });
  return d;
}

// the vault's notes as the plugin's search reads them (VGRules.recallChunks), for tests that search
function notes() {
  const VGRules = new Function(`${build.rulesSource(rules)}; return VGRules;`)();
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

// data.hq for the vault under test, read the way the plugin reads it: the notes VGRules.hqKind picks, and each
// device's run records, through VGRules.hqGather
function hqData(today) {
  const VGRules = new Function(`${build.rulesSource(rules)}; return VGRules;`)(), H = rules.hq || {};
  const dir = module.exports.dir(), files = [], day = today || VGRules.today();
  const skip = new Set([".obsidian", ".trash", ".git", ".cache", ".smart-env", "node_modules"]);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name), rel = path.relative(dir, p).replace(/\\/g, "/");
    if (e.isDirectory()) { if (!skip.has(e.name)) walk(p); return; }
    if (H.automation_status && rel.startsWith(H.automation_status + "/") && e.name.endsWith(".json")) { try { files.push({ path: rel, json: JSON.parse(fs.readFileSync(p, "utf8")) }); } catch (err) { /* half-written */ } return; }
    if (!e.name.endsWith(".md")) return;
    const text = fs.readFileSync(p, "utf8");
    if (VGRules.hqKind(rel, VGRules.frontOf(text), day)) files.push({ path: rel, text });
  });
  walk(dir);
  return VGRules.hqGather(files, { today: day });
}
// the HQ page on the vault under test (graph data + its HQ notes), with extra mount options
function hqPage(extra, o = {}) {
  const d = { ...data(), hq: o.hq !== undefined ? o.hq : hqData(o.today) };
  if (o.data) Object.assign(d, o.data);
  const p = build.buildHQPage(d, rules);
  return extra ? p.replace(build.HQ_OPTS, () => extra) : p;
}

// arguments to pass on to another test, so it runs on the same vault
const args = VAULT ? ["--vault", VAULT] : [];

module.exports = { ROOT, VAULT, RULES_FILE, rules, data, page, pageWith, hqData, hqPage, inlineJson, out, notes, dir, args };
