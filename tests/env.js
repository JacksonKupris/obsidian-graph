// What the tests run on, in one place: the sample vault (fixtures/, the default) or a real vault (--vault [dir];
// without a dir, local.json's "vault"). Every test loads the page, rules and notes through here.
//   const env = require("./env")
//   env.rules · env.data() · env.page() · env.pageWith(mountOptions, data?) · env.topicMapsOnly(data) · env.inlineJson(v) · env.out(...p) · env.notes() · env.VAULT (null for the sample) · env.args
const fs = require("fs"), path = require("path"), build = require("../build");
const ROOT = build.ROOT, SAMPLE = path.join(ROOT, "fixtures");

const { localConfig } = require("../scripts/lib");
const at = process.argv.indexOf("--vault");
const given = at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : null;
const named = at < 0 ? null : given || localConfig().vault || null;
if (at >= 0 && !named) { console.log(`FAIL - --vault needs a folder (pass --vault <dir> or set "vault" in local.json)`); process.exit(2); }
const VAULT = named && path.resolve(named);
if (VAULT && !fs.existsSync(VAULT)) { console.log(`FAIL - no vault at ${VAULT} (pass --vault <dir> or set "vault" in local.json)`); process.exit(2); }

// a vault's rules file: local.json "rules", else where this vault keeps it today (the analysis's folder)
const RULES_FILE = VAULT ? path.resolve(VAULT, localConfig().rules || "_scripts/vault_graph_rules.json") : path.join(ROOT, "config", "rules.json");
const rules = build.loadRules(RULES_FILE);

const readData = () => JSON.parse(fs.readFileSync(VAULT ? path.join(VAULT, rules.files.data) : path.join(SAMPLE, "sample-graph.json"), "utf8"));
// the sample's graph data is made with the sample vault (dir() below), so anything asking for it first makes sure it is there
const data = () => { if (!VAULT) module.exports.dir(); return readData(); };
const page = () => build.buildPage(data(), rules);
// the page with extra mount options (`mobile: true,`, a recall stub...) put where it mounts the graph. A page that
// no longer mounts it that way throws, so a test can't quietly run without its options.
const MOUNT = 'window.vaultGraph = mountVaultGraph(document.getElementById("vg"), DATA, {';
function pageWith(extra, d) {
  const p = d ? build.buildPage(d, rules) : page();
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
    || !fs.existsSync(path.join(SAMPLE, "sample-graph.json"))
    || fs.statSync(d).mtimeMs < fs.statSync(path.join(SAMPLE, "sample-graph.json")).mtimeMs
    || readData().nodes.some(n => !n.ghost && !n.person && !fs.existsSync(path.join(d, n.id)));
  if (!fs.existsSync(d) || stale()) require("child_process").execFileSync(process.execPath, [path.join(SAMPLE, "make_sample.js"), "--analyse"], { stdio: "ignore" });   // the graph data is made with the vault, on the same day: a committed copy aged, and which weekday it was made on changed which pairs the analysis found
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
function hqData(today) { return require("../scripts/vault_hq").hqFromFolder(module.exports.dir(), rules, today).hq; }   // the same reader the phone app uses
// the HQ page on the vault under test (graph data + its HQ notes), with extra mount options
function hqPage(extra, o = {}) {
  const d = { ...data(), hq: o.hq !== undefined ? o.hq : hqData(o.today) };
  if (o.data) Object.assign(d, o.data);
  const p = build.buildHQPage(d, rules);
  return extra ? p.replace(build.HQ_OPTS, () => extra) : p;
}

// arguments to pass on to another test, so it runs on the same vault
const args = VAULT ? ["--vault", VAULT] : [];

// The sample without the hubs that own no topic. Fed at every hub, the sample's simulation finds no link worth suggesting,
// so a test that presses Simulate's Add or Decline runs on this (the vault's own data is left as it is).
function topicMapsOnly(d) { if (VAULT) return d; const own = new Set(d.mocs.map(m => m.id)), extra = new Set(d.nodes.filter(n => n.moc && !own.has(n.id)).map(n => n.id));
  if (!extra.size) throw new Error("the sample has no hub that owns no topic: topicMapsOnly removes nothing");
  return { ...d, nodes: d.nodes.filter(n => !extra.has(n.id)), links: d.links.filter(l => !extra.has(l.source) && !extra.has(l.target)) }; }
module.exports = { ROOT, VAULT, RULES_FILE, rules, data, topicMapsOnly, page, pageWith, hqData, hqPage, inlineJson, out, notes, dir, args };
