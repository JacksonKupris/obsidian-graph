#!/usr/bin/env node
// This vault's rules in the plugin (the built main.js, a stand-in Obsidian, an in-memory vault): loadRules layers the
// vault's rules file over what Obsidian's settings say over the defaults; the settings tab's setRule changes one value
// in the file and leaves the rest as written; every rule and action follows at once.
//   node tests/test_plugin_rules.js        exit 0 = pass
const env = require("./env");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// the plugin as built, under a stand-in Obsidian (tests/plugin_stub.js)
const { Plugin, VGRules, VGActions, TFile } = require("./plugin_stub").load(env.rules);

const RULES = "_scripts/vault_graph_rules.json";
function fakePlugin(files, { daily, newFolder, people = [] } = {}) {
  const md = people.map(p => ({ path: p, extension: "md" }));
  const app = {
    vault: { adapter: { read: async p => { if (!(p in files)) throw new Error("no file"); return files[p]; }, write: async (p, t) => { files[p] = t; } },
      getConfig: k => ({ newFileLocation: newFolder ? "folder" : "current", newFileFolderPath: newFolder }[k]), getMarkdownFiles: () => md },
    metadataCache: { getFileCache: f => ({ frontmatter: { tags: people.includes(f.path) ? ["meta/person"] : [] } }) },
    plugins: { plugins: daily ? { "periodic-notes": { settings: { daily: { folder: daily } } } } : {} },
    internalPlugins: { getPluginById: () => null }, workspace: { getLeavesOfType: () => [] },
  };
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { rulesPath: RULES } });
  return p;
}
(async () => {
  // a vault with no rules file: Obsidian's settings, then the defaults
  { const p = fakePlugin({}, { daily: "Journal/Daily", newFolder: "Inbox/", people: ["Team/Ann.md", "Team/Bo.md", "x/Other.md"] });
    await p.loadRules();
    check("no rules file: Obsidian's daily folder (its top)", VGRules.folders.daily, "Journal");
    check("no rules file: the new-note folder is the inbox", VGRules.folders.inbox, "Inbox");
    check("no rules file: people are where person notes are", VGRules.folders.people, "Team");
    check("no rules file: the rest are the defaults", VGRules.folders.archive, env.rules.folders.archive);
    // the first change from the settings tab creates the file with just that value
    await p.setRule(["folders", "archive"], "Old");
    check("a first rule makes a rules file", JSON.parse(p.app.vault.adapter && (await p.app.vault.adapter.read(RULES))), { folders: { archive: "Old" } });
    check("the archive action follows the rules", VGActions.archiveFolder("Projects/a.md"), "Old/Projects"); }
  // the Link action's Related line goes in a links section, never under a heading that only starts with "Related"
  { const add = Plugin.addRelatedLine, L = "- [[B]] — similar meaning (0.8)";
    const own = "# Plan\n\n## Related Project Contexts\n\n- [[X]] - servers\n\n### Contacts\n\n- Support: call";
    check("a 'Related Project Contexts' section isn't the links section", add(own, L).split("\n").slice(-4, -1), ["## Related (added " + VGRules.today() + ")", "", L]);
    const rel = "# Note\n\n## Related\n\n- [[A]]\n\n## Notes\n\ntext";
    check("an existing Related section gets the line", add(rel, L).split("\n").slice(4, 7), ["- [[A]]", L, ""]);
    const ctx = "# X - Context\n\nbody\n\n---\n\n**Related Standups**\n- [[Daily Standup 2026-10-01]]";
    check("a context note's footer stays last", add(ctx, L).split("\n").slice(-4, -2), ["---", ""]); }
  // Rename a made map: the file moves (links follow, through Obsidian), its heading takes the topic's name, the list
  // below the marker is made again, and what you wrote above the marker stays
  { const files = new Map(), mk = (p, text) => { const f = Object.assign(new TFile(), { path: p, basename: p.split("/").pop().replace(/\.md$/, ""), name: p.split("/").pop(), extension: "md", parent: { path: p.slice(0, p.lastIndexOf("/")) } }); files.set(p, { f, text }); return f; };
    mk("00-Inbox/Old Name Hub.md", "---\ntags:\n  - meta/hub\n---\n# Old Name Hub\n\nMy own note about this topic.\n\n%% vault-graph:generated — edit above this line; everything below is regenerated %%\n\n## All notes\n- [[A]]\n");
    mk("t/A.md", "a"); mk("t/B.md", "b");
    const at = p => (files.get(p) || {}).f || null, renamed = [];
    const app = { vault: { getAbstractFileByPath: at, read: async f => files.get(f.path).text, cachedRead: async f => files.get(f.path).text,
        process: async (f, fn) => { const e = files.get(f.path); e.text = fn(e.text); return e.text; }, modify: async (f, t) => { files.get(f.path).text = t; },
        createFolder: async () => {}, getMarkdownFiles: () => [...files.values()].map(e => e.f) },
      fileManager: { renameFile: async (f, dest) => { const e = files.get(f.path); files.delete(f.path); Object.assign(f, { path: dest, basename: dest.split("/").pop().replace(/\.md$/, "") }); files.set(dest, e); renamed.push(dest); } },
      metadataCache: { fileToLinktext: f => f.basename, getFirstLinkpathDest: () => null } };
    const p = Object.assign(Object.create(Plugin.prototype), { app, settings: {} });
    p.graphData = async () => ({ clusters: [{ id: 1, name: "Topic Now", size: 2 }], nodes: [{ id: "t/A.md", cluster: 1, bc: 0.2 }, { id: "t/B.md", cluster: 1, bc: 0.1 }] });
    const dest = await p.renameMap("00-Inbox/Old Name Hub.md", 1), text = files.get(dest).text;
    check("rename map: the file has the topic's name", [dest, renamed], ["00-Inbox/Topic Now Hub.md", ["00-Inbox/Topic Now Hub.md"]]);
    check("rename map: heading, own text, and the list made again", [text.includes("# Topic Now Hub"), text.includes("My own note about this topic."), text.includes("- [[B]]")], [true, true, true]); }
  // a vault rules file wins over Obsidian's settings, key by key
  { const text = '{\n  "folders": {\n    "inbox": "00-Inbox",\n    "daily": "01-Daily",\n    "skip": ["_templates", "00-Inbox"]\n  },\n  "stale_days": 180,\n  "note":   "kept as written"\n}\n';
    const files = { [RULES]: text }, p = fakePlugin(files, { daily: "Journal", newFolder: "Inbox" });
    await p.loadRules();
    check("the rules file wins over Obsidian's settings", [VGRules.folders.inbox, VGRules.folders.daily], ["00-Inbox", "01-Daily"]);
    check("what the file doesn't say is detected or default", VGRules.folders.archive, env.rules.folders.archive);
    check("the stale rule uses the file's days", [VGRules.isStale({ id: "a/b.md", name: "b", age: 181 }), VGRules.isStale({ id: "a/b.md", name: "b", age: 179 })], [true, false]);
    await p.setRule(["folders", "inbox"], "Capture");
    await p.setRule(["stale_days"], 90);
    check("setRule changes only that value in the file", files[RULES], text.replace('"inbox": "00-Inbox"', '"inbox": "Capture"').replace('"stale_days": 180', '"stale_days": 90'));
    check("every rule follows at once", [VGRules.folders.inbox, VGRules.isStale({ id: "a/b.md", name: "b", age: 100 })], ["Capture", true]);
    check("the Create-note action writes to the new inbox", VGActions.TODAY.write && /Capture/.test(String(VGActions.TODAY.write.ask({ name: "X", refs: [] })[1])), true); }
  console.log(fails.length ? "FAIL - " + fails.join("\n  ") : "ok - the vault's rules: file over Obsidian's settings over defaults, edited in place");
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + (e && e.stack || e)); process.exit(1); });
