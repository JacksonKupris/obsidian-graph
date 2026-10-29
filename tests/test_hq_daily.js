#!/usr/bin/env node
// Date-aware creation through the built plugin, plus real week-strip clicks on desktop and phone.
const assert = require("assert"), fs = require("fs"), path = require("path"), env = require("./env"), stub = require("./plugin_stub"), cdp = require("./cdp");
const { Plugin, VGRules: Q, TFile } = stub.load(env.rules, { moment: value => ({
  format: format => format === "HH:mm:ss" ? "09:30:00" : format === "YYYY-MM-DD" ? value.slice(0, 10) : "09:30",
}) });

function harness() {
  const files = new Map(), folders = new Set(), opened = [], created = [];
  const add = (path, text) => {
    const f = Object.assign(new TFile(), { path, name: path.split("/").pop(), basename: path.split("/").pop().replace(/\.md$/, ""), extension: "md" });
    files.set(path, { f, text }); return f;
  };
  const app = {
    vault: {
      getAbstractFileByPath: path => files.get(path)?.f || (folders.has(path) ? { path } : null),
      getMarkdownFiles: () => [...files.values()].map(e => e.f),
      read: async f => files.get(f.path).text,
      modify: async (f, text) => { files.get(f.path).text = text; },
      createFolder: async path => { folders.add(path); },
      create: async (path, text) => {
        assert(!files.has(path), "creation must not overwrite");
        created.push(path); return add(path, text);
      },
    },
    workspace: { getLeaf: () => ({ openFile: async f => { opened.push(f.path); } }), getLeavesOfType: () => [] },
    plugins: { plugins: {} }, internalPlugins: { plugins: {} },
    fileManager: { trashFile: async f => { files.delete(f.path); } },
  };
  const plugin = Object.assign(Object.create(Plugin.prototype), { app, settings: {} });
  return { plugin, app, files, folders, opened, created, add };
}

// A small Templater interpreter: execute the template's JS with a fresh tp object, just like parse_template.
// The now function deliberately defaults to a different day; the prefix must supply the requested reference.
function templater(app) {
  const pending = new Set();
  return { start_templater_task: path => { pending.add(path); }, end_templater_task: async path => { pending.delete(path); },
    parse_template: async (config, text) => {
    assert(pending.has(config.target_file.path), "creation trigger must be guarded during rendering");
    assert.strictEqual(await app.vault.read(config.target_file), "", "Templater must receive a real readable target");
    const tp = { date: { now: (format, offset, reference = "2099-12-31") => reference }, file: { cursor: () => "CURSOR", title: config.target_file.basename } };
    const chunks = ["let tR = '';"];
    let at = 0;
    for (const match of text.matchAll(/<%([*]?)([\s\S]*?)-?%>/g)) {
      chunks.push(`tR += ${JSON.stringify(text.slice(at, match.index))};`);
      chunks.push(match[1] ? match[2].replace(/-$/, "") : `tR += (${match[2].replace(/-$/, "")});`);
      at = match.index + match[0].length;
    }
    chunks.push(`tR += ${JSON.stringify(text.slice(at))}; return tR;`);
    return new (Object.getPrototypeOf(async function () {}).constructor)("tp", "app", chunks.join("\n"))(tp, app);
  } };
}

(async () => {
  const h = harness(), api = h.plugin.viewActions({});
  const journal = Q.dailyNotePath("2026-10-26"), standup = Q.dailyNotePath("2026-11-01", "standup");
  assert(journal.endsWith("/2026/10-October/Journal/2026-10-26.md"));
  assert(standup.endsWith("/2026/11-November/Standups/Daily Standup 2026-11-01.md"));
  for (const bad of ["2026-02-30", "2026-13-01", "not-a-date", "2026-10-26/../../x"]) {
    await assert.rejects(api.openDaily(bad), /Invalid/);
  }
  assert.strictEqual(h.created.length, 0);
  await Promise.all([api.openDaily("2026-10-26"), api.openDaily("2026-10-26"), api.openStandup("2026-11-01")]);
  assert.deepStrictEqual(h.created, [journal, standup], "rapid clicks must reuse one journal");
  assert(h.files.get(journal).text.includes("# 2026-10-26"));
  assert(h.files.get(standup).text.includes("date: 2026-11-01"));
  assert(h.folders.has(journal.slice(0, journal.lastIndexOf("/"))));
  assert(h.folders.has(standup.slice(0, standup.lastIndexOf("/"))));
  h.files.get(journal).text = "Existing user text";
  await api.openDaily("2026-10-26");
  assert.strictEqual(h.files.get(journal).text, "Existing user text");
  const legacy = `${Q.folders.daily}/2026/08-August/Standups/Daily Standup 2026-10-28.md`;
  h.add(legacy, "Historical standup");
  await api.openStandup("2026-10-28");
  assert.strictEqual(h.opened.at(-1), legacy, "reuse an existing noncanonical standup, do not duplicate it");
  const proper = Q.dailyNotePath("2026-10-28", "standup");
  h.add(proper, "Canonical standup");
  await api.openStandup("2026-10-28");
  assert.strictEqual(h.opened.at(-1), proper);
  assert.strictEqual(h.files.get(legacy).text, "Historical standup");
  // Both template sources, a scoped requested date, target title and a standup script block.
  h.app.plugins.plugins["periodic-notes"] = { settings: { daily: { enabled: true, template: "Custom journal" } } };
  h.add("Custom journal.md", '# <% tp.date.now("YYYY-MM-DD") %>\n<% tp.file.title %>\n<% tp.file.cursor(0) %>');
  const prior = Q.dailyNotePath("2026-12-30", "standup");
  h.add(prior, "Previous blocks and plan");
  h.add(Q.dailyNotePath("2027-01-03", "standup"), "Future blocks must not be copied");
  h.add(`${Q.folders.templates}/Daily Standup Template.md`, `<%*
    const targetDate = tp.date.now("YYYY-MM-DD");
    const previous = app.vault.getMarkdownFiles().filter(f => f.path.includes("/Standups/Daily Standup ") && f.basename < "Daily Standup " + targetDate).sort((a,b) => b.basename.localeCompare(a.basename))[0];
    const carried = previous ? await app.vault.read(previous) : "";
  -%>\nDate: <% targetDate %>\n<% carried %>\nExplicit: <% tp.date.now("YYYY-MM-DD", 0, "2025-01-01", "YYYY-MM-DD") %>`);
  const engine = templater(h.app);
  h.app.plugins.plugins["templater-obsidian"] = { templater: engine };
  await api.openDaily("2027-01-01");
  await api.openStandup("2027-01-01");
  assert(h.files.get(Q.dailyNotePath("2027-01-01")).text.includes("# 2027-01-01\n2027-01-01"));
  assert(!h.files.get(Q.dailyNotePath("2027-01-01")).text.includes("CURSOR"));
  assert(h.files.get(Q.dailyNotePath("2027-01-01", "standup")).text.includes("Date: 2027-01-01"));
  assert(h.files.get(Q.dailyNotePath("2027-01-01", "standup")).text.includes("Previous blocks and plan"));
  assert(h.files.get(Q.dailyNotePath("2027-01-01", "standup")).text.includes("Explicit: 2025-01-01"));
  assert(!h.files.get(Q.dailyNotePath("2027-01-01", "standup")).text.includes("Future blocks"));
  h.app.plugins.plugins["periodic-notes"].settings.daily.enabled = false;
  h.app.internalPlugins.plugins["daily-notes"] = { enabled: true, instance: { options: { template: "Core journal.md" } } };
  h.add("Core journal.md", "# {{date:YYYY-MM-DD}}\nTime: {{time}}\nCustom content");
  await api.openDaily("2027-02-01");
  assert.strictEqual(h.files.get(Q.dailyNotePath("2027-02-01")).text, "# 2027-02-01\nTime: 09:30\nCustom content");
  h.app.internalPlugins.plugins["daily-notes"].instance.options.template = "Missing";
  await assert.rejects(api.openDaily("2027-02-02"), /Template not found/);
  assert(!h.files.has(Q.dailyNotePath("2027-02-02")));
  h.app.internalPlugins.plugins["daily-notes"].instance.options.template = "Custom journal";
  delete h.app.plugins.plugins["templater-obsidian"];
  await assert.rejects(api.openDaily("2027-02-02"), /Enable a compatible Templater/);
  h.app.plugins.plugins["templater-obsidian"] = { templater: { ...engine, parse_template: async () => { throw new Error("Broken template"); } } };
  await assert.rejects(api.openDaily("2027-02-02"), /Broken template/);
  assert(!h.files.has(Q.dailyNotePath("2027-02-02")));
  h.app.plugins.plugins["templater-obsidian"] = { templater: engine };
  await api.openDaily("2027-02-02");
  assert(h.files.has(Q.dailyNotePath("2027-02-02")), "retry after failure must not poison the queue");
  // A competing creator wins between template rendering and create; its content must remain untouched.
  const racePath = Q.dailyNotePath("2027-03-01");
  const create = h.app.vault.create;
  h.app.vault.create = async (path, text) => { if (path === racePath) { h.add(path, "Other creator"); throw new Error("already exists"); } return create(path, text); };
  await api.openDaily("2027-03-01");
  assert.strictEqual(h.files.get(racePath).text, "Other creator");
  h.app.plugins.plugins["templater-obsidian"].templater = { ...engine, parse_template: async config => {
    h.files.get(config.target_file.path).text = "Written while rendering";
    throw new Error("Render interrupted");
  } };
  await assert.rejects(api.openDaily("2027-03-02"), /Render interrupted/);
  assert.strictEqual(h.files.get(Q.dailyNotePath("2027-03-02")).text, "Written while rendering", "failed render must not trash concurrent content");
  if (env.VAULT) {
    // Read the vault's real templates, but execute/write only in the in-memory vault above.
    h.app.plugins.plugins["templater-obsidian"].templater = engine;
    const journalTemplate = `${Q.folders.templates}/Daily Notes Template.md`, standupTemplate = `${Q.folders.templates}/Daily Standup Template.md`;
    if (fs.existsSync(path.join(env.VAULT, journalTemplate)) && fs.existsSync(path.join(env.VAULT, standupTemplate))) {
      h.add(journalTemplate, fs.readFileSync(path.join(env.VAULT, journalTemplate), "utf8"));
      h.add(standupTemplate, fs.readFileSync(path.join(env.VAULT, standupTemplate), "utf8"));
      h.app.internalPlugins.plugins["daily-notes"].instance.options.template = journalTemplate;
      h.add(Q.dailyNotePath("2027-03-31", "standup"), "## 2. Blocks\n\n1. Keep this block\n\n---\n\n## 3. Work Expected To Be Done Tomorrow\n\n1. Keep this plan\n\n---\n\n## 4. User Stories (Iteration)\n\nKeep these stories\n");
      await api.openDaily("2027-04-01");
      await api.openStandup("2027-04-01");
      const actualJournal = h.files.get(Q.dailyNotePath("2027-04-01")).text;
      const actualStandup = h.files.get(Q.dailyNotePath("2027-04-01", "standup")).text;
      assert(actualJournal.includes("# 2027-04-01"));
      assert(actualStandup.includes("**Date:** 2027-04-01"));
      for (const phrase of ["Keep this block", "Keep this plan", "Keep these stories", "Daily Standup 2027-03-31"]) assert(actualStandup.includes(phrase), phrase);
      assert(!actualJournal.includes("<%") && !actualStandup.includes("<%"));
    }
  }
  // Creation uses the same write accounting, publication and undo registration as other HQ actions.
  const w = harness();
  let published = 0;
  w.plugin.indexSettled = () => Promise.resolve();
  w.plugin.closeUndo = async () => {};
  w.plugin.publish = async () => { published++; };
  w.plugin.wrapWriteActions();
  await w.plugin.viewActions({}).openDaily("2026-10-26");
  assert.strictEqual(published, 1);
  await w.plugin.viewActions({}).openDaily("2026-10-26");
  assert.strictEqual(published, 1, "opening existing content does not announce a write");

  for (const mobile of [false, true]) {
    const options = `now: new Date("2026-10-29T12:00:00"), api: {
      openDaily: async d => { window.__dailyCalls.push(["journal", d]); },
      openStandup: async d => { window.__dailyCalls.push(["standup", d]); },
      openNote: async p => { window.__dailyCalls.push(["open", p]); }
    }`;
    const emptyHQ = { ...env.hqData("2026-10-29"), journals: [], standups: [] };
    const tab = await cdp.open({ html: env.hqPage(options, { hq: emptyHQ }), port: 9358, mobile });
    assert(tab, "week creation regression requires Chrome");
    try {
      assert(await tab.waitFor("window.vaultHQ ? 1 : 0", 20000));
      await tab.ev("window.__dailyCalls = []");
      for (const kind of ["journal", "standup"]) {
        const point = await tab.ev(`(() => { const b = document.querySelector('[data-weekday="2026-10-26"] b'); const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
        await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
        await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
        assert.strictEqual(await tab.ev(`document.querySelector('[data-daynote="${kind}"]').textContent`), `Create ${kind}`);
        await tab.ev(`document.querySelector('[data-daynote="${kind}"]').click()`);
        assert(await tab.waitFor("!document.querySelector('.vg-hq-dialog')", 5000));
      }
      assert.deepStrictEqual(await tab.ev("window.__dailyCalls"), [["journal", "2026-10-26"], ["standup", "2026-10-26"]]);
      await tab.ev(`document.querySelector('[data-weekday="2026-11-01"]').click(); document.querySelector('[data-cancelday]').click()`);
      assert.strictEqual(await tab.ev("window.__dailyCalls.length"), 2, "cancel creates nothing");
      assert.strictEqual(await tab.ev("document.documentElement.scrollWidth > innerWidth + 1"), false, "week chooser overflow");
      await tab.ev(`window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, {
        now:new Date("2026-10-29T12:00:00"), api:{openDaily:async()=>{throw new Error("Creation failed");},openStandup:async()=>{}}
      }); document.querySelector('[data-weekday="2026-10-26"]').click(); document.querySelector('[data-daynote="journal"]').click()`);
      assert(await tab.waitFor(`document.querySelector('[data-daynote="journal"]:not(:disabled)') ? 1 : 0`, 5000), "failed creation must allow retry");
      assert.strictEqual(await tab.ev(`document.querySelector('.vg-hq-dialog [role="alert"]').textContent`), "Creation failed");
    } finally { await tab.close(); }
  }
  console.log("ok - date-aware canonical creation, templates, retries, deduplication, publication and desktop/phone week actions");
})().catch(error => { console.error(error); process.exitCode = 1; });
