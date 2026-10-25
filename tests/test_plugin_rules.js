#!/usr/bin/env node
// This vault's rules in the plugin (the built main.js, a stand-in Obsidian, an in-memory vault): loadRules layers the
// vault's rules file over what Obsidian's settings say over the defaults; the settings tab's setRule changes one value
// in the file and leaves the rest as written; every rule and action follows at once.
//   node tests/test_plugin_rules.js        exit 0 = pass
const env = require("./env");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// the plugin as built, under a stand-in Obsidian (tests/plugin_stub.js)
const { Plugin, VGRules, VGActions } = require("./plugin_stub").load(env.rules);

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
