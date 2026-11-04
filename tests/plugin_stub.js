// The plugin as built (main.js), loaded under a stand-in for the obsidian module, for tests that drive the plugin's own
// code without Obsidian. Every class the module exports is one stand-in class, so `x instanceof TFile` holds for the
// fake files fakeVault makes.
//   const { Plugin, VGRules, VGActions, VGEngine, TFile } = require("./plugin_stub").load(rules)
//   const app = require("./plugin_stub").fakeVault(dir, TFile)   an app over the notes in a folder: files, frontmatter
//                                                                   tags, resolved and unresolved links by note name
//   const app = require("./plugin_stub").liveVault(dir, TFile)   the same, and it writes: edits land in the folder, and the
//                                                                   index catches up a moment later and says so, as Obsidian's does
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const build = require("../build");

function load(rules, overrides = {}) {
  const file = path.join(os.tmpdir(), `vg-plugin-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(file, build.buildPlugin(rules)["main.js"] + "\n;module.exports.__VG = { VGRules, VGActions, VGEngine, liveMerge };");
  const Stub = class {}, stub = new Proxy({ normalizePath: p => p, Platform: {}, setIcon() {}, debounce: f => f, addIcon() {}, ...overrides }, { get: (t, k) => (k in t ? t[k] : Stub) });
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

// Obsidian's index gives a few frontmatter tags with the # on (9 of 5,847 on one vault): every tag here has it, the harder case
const asIndexed = fm => (fm && Array.isArray(fm.tags) ? { ...fm, tags: fm.tags.map(t => `#${String(t).replace(/^#/, "")}`) } : fm);
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
    for (const m of f.text.matchAll(/\[\[([^\]|#\r\n]+)/g)) {
      const name = m[1].trim().split("/").pop(), to = byName.get(name.toLowerCase());
      const bag = to ? resolvedLinks[f.path] : unresolvedLinks[f.path], key = to || name;
      bag[key] = (bag[key] || 0) + 1;
    }
  }
  const caches = new Map(files.map(f => [f.path, { frontmatter: asIndexed(frontmatter(f.text)), links: [...f.text.matchAll(/\[\[([^\]|\r\n]+)/g)].map(m => ({ link: m[1].trim() })), listItems: [...f.text.matchAll(/^\s*[-*] \[(.)\]/gm)].map(x => ({ task: x[1] })) }]));
  return {
    vault: { getMarkdownFiles: () => files, getAbstractFileByPath: p => byPath.get(p) || null, cachedRead: async f => f.text, getName: () => path.basename(dir),
      getConfig: () => undefined, on: () => ({}),
      adapter: { read: async p => { if (byPath.has(p)) return byPath.get(p).text; throw new Error("no file"); }, exists: async p => byPath.has(p),
        write: async () => {}, mkdir: async () => {}, list: async () => ({ files: [], folders: [] }), readBinary: async () => { throw new Error("no file"); }, stat: async () => null } },
    metadataCache: { initialized: true, inProgressTaskCount: 0, resolvedLinks, unresolvedLinks, getFileCache: f => caches.get(f.path) || null,
      getFirstLinkpathDest: name => byPath.get(byName.get(String(name).toLowerCase())) || null, on: () => ({}), offref() {} },
    workspace: { getLeavesOfType: () => [] },
  };
}

// a frontmatter change, keeping every line it didn't touch (the parser above only reads simple frontmatter)
function editFrontmatter(text, change) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text), was = frontmatter(text) || {}, now = JSON.parse(JSON.stringify(was)); change(now);
  let lines = m ? m[1].split(/\r?\n/) : [];
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[k]) === JSON.stringify(now[k])) continue;
    const at = lines.findIndex(l => l.startsWith(k + ":"));
    if (at >= 0) { let e = at + 1; while (e < lines.length && /^\s+-?/.test(lines[e])) e++; lines.splice(at, e - at); }
    if (k in now) { const v = now[k]; lines.push(...(Array.isArray(v) ? [`${k}:`, ...v.map(x => `  - ${x}`)] : [`${k}: ${v}`])); }
  }
  return `---\n${lines.join("\n")}\n---\n${m ? text.slice(m[0].length) : text}`;
}
function liveVault(dir, TFile, o = {}) {
  let cur = fakeVault(dir, TFile, o), timer = null; const handlers = new Set(), disk = x => path.join(dir, x.path || x);
  const flush = () => { clearTimeout(timer); timer = null; cur = fakeVault(dir, TFile, o); };
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => { flush(); [...handlers].forEach(h => h()); }, 5); };
  const put = (x, text) => { fs.mkdirSync(path.dirname(disk(x)), { recursive: true }); fs.writeFileSync(disk(x), text); changed(); };
  const named = (p) => { const f = cur.vault.getAbstractFileByPath(p); if (f) return f; return fs.existsSync(disk(p)) ? { path: p } : null; };   // a folder or another kind of file
  // Obsidian's resolution: an explicit path wins, then a same-name note in the source's folder, then the shortest path
  const dest = (link, from) => { const t = String(link).replace(/\.md$/i, ""), low = t.toLowerCase(), base = low.split("/").pop(), here = path.posix.dirname(from || "");
    const hit = cur.vault.getMarkdownFiles().filter(f => f.basename.toLowerCase() === base && (!t.includes("/") || f.path.toLowerCase().endsWith(low + ".md")));
    return hit.find(f => path.posix.dirname(f.path) === here) || hit.slice().sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.length - b.path.length)[0] || null; };
  return { flush,
    vault: { getMarkdownFiles: () => cur.vault.getMarkdownFiles(), getAbstractFileByPath: named, getName: () => path.basename(dir), getConfig: () => undefined, on: (e, cb) => { handlers.add(cb); return cb; },
      read: async f => fs.readFileSync(disk(f), "utf8"), cachedRead: async f => fs.readFileSync(disk(f), "utf8"),
      process: async (f, fn) => { const out = fn(fs.readFileSync(disk(f), "utf8")); put(f, out); return out; }, modify: async (f, text) => put(f, text),
      create: async (p, text) => { put(p, text); flush(); return cur.vault.getAbstractFileByPath(p); }, createFolder: async p => { fs.mkdirSync(disk(p), { recursive: true }); },
      adapter: { read: async p => fs.readFileSync(disk(p), "utf8"), write: async (p, text) => { fs.mkdirSync(path.dirname(disk(p)), { recursive: true }); fs.writeFileSync(disk(p), text); }, exists: async p => fs.existsSync(disk(p)), mkdir: async p => { fs.mkdirSync(disk(p), { recursive: true }); },
        list: async p => { const es = fs.existsSync(disk(p)) ? fs.readdirSync(disk(p), { withFileTypes: true }) : [], at = e => `${p}/${e.name}`; return { files: es.filter(e => e.isFile()).map(at), folders: es.filter(e => e.isDirectory()).map(at) }; },
        stat: async p => { try { const s = fs.statSync(disk(p)); return { mtime: s.mtimeMs, ctime: s.ctimeMs, size: s.size }; } catch (e) { return null; } }, readBinary: async () => { throw new Error("no file"); } } },
    metadataCache: { initialized: true, inProgressTaskCount: 0, get resolvedLinks() { return cur.metadataCache.resolvedLinks; }, get unresolvedLinks() { return cur.metadataCache.unresolvedLinks; },
      getFileCache: f => cur.metadataCache.getFileCache(f), getCache: p => cur.metadataCache.getFileCache({ path: p }), getFirstLinkpathDest: dest,
      fileToLinktext: (f, from) => (dest(f.basename, from) === f || (dest(f.basename, from) || {}).path === f.path ? f.basename : f.path.replace(/\.md$/i, "")), on: (e, cb) => { handlers.add(cb); return cb; }, offref: ref => handlers.delete(ref) },
    fileManager: { processFrontMatter: async (f, fn) => { put(f, editFrontmatter(fs.readFileSync(disk(f), "utf8"), fn)); }, renameFile: async (f, to) => { fs.mkdirSync(path.dirname(disk(to)), { recursive: true }); fs.renameSync(disk(f), disk(to)); changed(); } },
    workspace: { getLeavesOfType: () => [], getLeaf: () => ({ openFile: async () => {} }) } };
}

module.exports = { load, fakeVault, liveVault, frontmatter };
