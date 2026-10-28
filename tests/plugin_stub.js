// The plugin as built (main.js), loaded under a stand-in for the obsidian module, for tests that drive the plugin's own
// code without Obsidian. Every class the module exports is one stand-in class, so `x instanceof TFile` holds for the
// fake files fakeVault makes.
//   const { Plugin, VGRules, VGActions, VGEngine, TFile } = require("./plugin_stub").load(rules)
//   const app = require("./plugin_stub").fakeVault(dir, TFile)   an app over the notes in a folder: files, frontmatter
//                                                                   tags, resolved and unresolved links by note name
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const build = require("../build");

function load(rules) {
  const file = path.join(os.tmpdir(), `vg-plugin-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(file, build.buildPlugin(rules)["main.js"] + "\n;module.exports.__VG = { VGRules, VGActions, VGEngine };");
  const Stub = class {}, stub = new Proxy({ normalizePath: p => p, Platform: {}, setIcon() {}, debounce: f => f, addIcon() {} }, { get: (t, k) => (k in t ? t[k] : Stub) });
  const orig = Module._load;
  Module._load = function (req, ...a) { return req === "obsidian" ? stub : orig.call(this, req, ...a); };
  try { const Plugin = require(file); return { Plugin, ...Plugin.__VG, TFile: Stub }; }
  finally { Module._load = orig; fs.unlinkSync(file); }
}

// frontmatter tags as Obsidian reads them, for the simple frontmatter the sample vault has
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) return undefined;
  const fm = {}; let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w][\w -]*):\s*(.*)$/), item = line.match(/^\s+-\s+(.*)$/);
    if (kv) { key = kv[1]; fm[key] = kv[2] ? kv[2].replace(/^["']|["']$/g, "") : []; }
    else if (item && key && Array.isArray(fm[key])) fm[key].push(item[1].replace(/^["']|["']$/g, ""));
  }
  return fm;
}

function fakeVault(dir, TFile, { skip = [".obsidian", ".trash", ".git"] } = {}) {
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name), rel = path.relative(dir, p).replace(/\\/g, "/");
    if (e.isDirectory()) { if (!skip.includes(e.name)) walk(p); return; }
    if (!e.name.endsWith(".md")) return;
    const f = Object.assign(new TFile(), { path: rel, name: e.name, basename: e.name.replace(/\.md$/, ""), extension: "md",
      parent: { path: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "" }, stat: fs.statSync(p) });
    f.stat = { ctime: f.stat.ctimeMs, mtime: f.stat.mtimeMs, size: f.stat.size };
    f.text = fs.readFileSync(p, "utf8");
    files.push(f);
  });
  walk(dir);
  const byPath = new Map(files.map(f => [f.path, f])), byName = new Map();
  files.forEach(f => { const k = f.basename.toLowerCase(); if (!byName.has(k)) byName.set(k, f.path); });
  const resolvedLinks = {}, unresolvedLinks = {};
  for (const f of files) {
    resolvedLinks[f.path] = {}; unresolvedLinks[f.path] = {};
    for (const m of f.text.matchAll(/\[\[([^\]|#]+)/g)) {
      const name = m[1].trim().split("/").pop(), to = byName.get(name.toLowerCase());
      const bag = to ? resolvedLinks[f.path] : unresolvedLinks[f.path], key = to || name;
      bag[key] = (bag[key] || 0) + 1;
    }
  }
  const caches = new Map(files.map(f => [f.path, { frontmatter: frontmatter(f.text), listItems: [...f.text.matchAll(/^\s*[-*] \[(.)\]/gm)].map(x => ({ task: x[1] })) }]));
  return {
    vault: { getMarkdownFiles: () => files, getAbstractFileByPath: p => byPath.get(p) || null, cachedRead: async f => f.text, getName: () => path.basename(dir),
      getConfig: () => undefined, on: () => ({}),
      adapter: { read: async p => { if (byPath.has(p)) return byPath.get(p).text; throw new Error("no file"); }, exists: async p => byPath.has(p),
        write: async () => {}, readBinary: async () => { throw new Error("no file"); }, stat: async () => null } },
    metadataCache: { initialized: true, inProgressTaskCount: 0, resolvedLinks, unresolvedLinks, getFileCache: f => caches.get(f.path) || null,
      getFirstLinkpathDest: name => byPath.get(byName.get(String(name).toLowerCase())) || null, on: () => ({}), offref() {} },
    workspace: { getLeavesOfType: () => [] },
  };
}

module.exports = { load, fakeVault, frontmatter };
