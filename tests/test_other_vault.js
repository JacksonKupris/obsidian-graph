#!/usr/bin/env node
// A vault that isn't the author's: no rules file, daily notes wherever Obsidian's settings say, no standups. HQ has to find the journals,
// a new one has to go where the person's own daily notes go, and nothing should ask for a habit they don't have. A vault with its own
// rules file keeps them exactly.
//   node tests/test_other_vault.js        exit 0 = pass
const assert = require("assert"), stub = require("./plugin_stub"), env = require("./env");
const DAY = "2026-11-02";
function fake(R, Plugin, TFile, { files = {}, dn, pn, rules }) {
  const store = new Map(Object.entries(files)), mk = p => Object.assign(new TFile(), { path: p, basename: p.split("/").pop().replace(/\.md$/, ""), name: p.split("/").pop(), extension: "md", stat: { mtime: 1 } });
  const app = { vault: { adapter: { read: async p => { if (p === "rules.json" && rules) return JSON.stringify(rules); throw new Error("no file"); }, exists: async () => false, list: async () => ({ files: [], folders: [] }) }, getConfig: () => undefined, getMarkdownFiles: () => [...store.keys()].map(mk), cachedRead: async f => store.get(f.path), read: async f => store.get(f.path) },
    metadataCache: { getFileCache: () => ({ listItems: [{ task: " " }] }) }, plugins: { plugins: pn ? { "periodic-notes": { settings: { daily: pn } } } : {} }, internalPlugins: { getPluginById: () => (dn ? { enabled: true, instance: { options: dn } } : null), plugins: {} }, workspace: { getLeavesOfType: () => [] } };
  return Object.assign(Object.create(Plugin.prototype), { app, settings: { rulesPath: "rules.json" } });
}
const load = () => { const { Plugin, VGRules, TFile } = stub.load(env.rules); return { Plugin, R: VGRules, TFile }; };
const NO_HQ_DEFAULTS = "no rules file";
(async () => {
  // core Daily notes, the default format, in a folder of its own
  { const { Plugin, R, TFile } = load(), p = fake(R, Plugin, TFile, { dn: { folder: "Daily" }, files: { "Daily/2026-11-01.md": "# Yesterday\n- [ ] An old job\n", "Daily/2026-03-05.md": "- [ ] A really old job\n- [x] Done ✅ 2026-03-06\n", "Daily/Not a date.md": "- [ ] Not a journal\n", "Work/2026-11-01.md": "- [ ] Outside the daily folder\n" } });
    await p.loadRules();
    assert.strictEqual(R.folders.daily, "Daily", NO_HQ_DEFAULTS);
    assert.strictEqual(R.dailyNotePath(DAY), `Daily/${DAY}.md`, "a new journal goes where this person's daily notes go");
    const hq = await p.hqData(); assert.deepStrictEqual(hq.journals.map(j => j.date).sort(), ["2026-03-05", "2026-11-01"], "HQ found the journals");
    const carried = R.todayList({ nodes: [], links: [], hq }, { today: DAY }).filter(i => i.kind === "carried").map(i => i.title).sort(); assert.deepStrictEqual(carried, ["A really old job", "An old job"], "their open tasks");
    const next = R.hqNextStep({ list: [], day: DAY, hour: 18, done: 3, standup: false }); assert.notStrictEqual(next.key, "standup", "asked for a standup in a vault with none");
    assert.strictEqual(R.standupsInUse(hq), false); }
  // their own format, with folders and month names, through Periodic Notes
  { const { Plugin, R, TFile } = load(), p = fake(R, Plugin, TFile, { pn: { folder: "Notes/Journal", format: "YYYY/MM-MMMM/DD-MM-YYYY" }, files: { "Notes/Journal/2026/10-October/30-10-2026.md": "- [ ] In their format\n" } });
    await p.loadRules();
    assert.strictEqual(R.dailyNotePath(DAY), "Notes/Journal/2026/11-November/02-11-2026.md", "their format, whole folder");
    const hq = await p.hqData(); assert.deepStrictEqual(hq.journals.map(j => j.date), ["2026-10-30"], "a date in another order still reads as the date"); }
  // words in a format, and a repeated year
  { const { Plugin, R, TFile } = load(), p = fake(R, Plugin, TFile, { dn: { folder: "D", format: "YYYY/[Week of] YYYY-MM-DD" }, files: { "D/2026/Week of 2026-10-30.md": "- [ ] x\n" } });
    await p.loadRules(); assert.strictEqual(R.dailyNotePath(DAY), "D/2026/Week of 2026-11-02.md"); assert.strictEqual((await p.hqData()).journals.length, 1, "a literal and a repeated year"); }
  // Obsidian's default: no folder set, daily notes at the top of the vault
  { const { Plugin, R, TFile } = load(), p = fake(R, Plugin, TFile, { dn: {}, files: { "2026-10-30.md": "- [ ] At the top\n", "Ideas/Plain.md": "- [ ] Not a journal\n" } });
    await p.loadRules(); assert.strictEqual(R.dailyNotePath(DAY), `${DAY}.md`); assert.deepStrictEqual((await p.hqData()).journals.map(j => j.date), ["2026-10-30"], "journals at the vault's top"); }
  // a vault that says for itself keeps exactly what it says: this is the author's case
  { const { Plugin, R, TFile } = load(), p = fake(R, Plugin, TFile, { dn: { folder: "Elsewhere", format: "DD-MM-YYYY" }, rules: { folders: { daily: "01-Daily" }, hq: { journal: "/Journal/([0-9]{4}-[0-9]{2}-[0-9]{2})[.]md$" } }, files: { "01-Daily/2026/10-October/Journal/2026-10-30.md": "- [ ] Mine\n" } });
    await p.loadRules();
    assert.strictEqual(R.dailyNotePath(DAY), "01-Daily/2026/11-November/Journal/2026-11-02.md", "a rules file was overridden by Obsidian's settings");
    assert.strictEqual((await p.hqData()).journals.length, 1); assert.strictEqual(R.standupsInUse({ standups: [] }), true, "a rules file's standups stay on"); }
  console.log("ok - another vault: journals found where Obsidian says, new ones go there, no standups asked for; a rules file wins");
})().catch(e => { console.error(e); process.exit(1); });
