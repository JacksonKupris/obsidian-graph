#!/usr/bin/env node
// Closing the loop. Nothing open goes out of sight: a subtask goes with its open parent, and one with no open parent is listed in its own
// right. A sweep moves a task and its subtasks to a project. Vitals say what the numbers mean, what to do, and whether it's moving.
//   node tests/test_sweep_vitals.js [--vault [dir]]        exit 0 = pass
const assert = require("assert"), cdp = require("./cdp"), env = require("./env"), stub = require("./plugin_stub"), { VGRules: R } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = env.rules.hq || {}, DAILY = env.rules.folders.daily;
const S = new Function(`${require("fs").readFileSync(require("path").join(__dirname, "..", "src", "science.js"), "utf8")}; return VGScience;`)();

// ---- subtasks
const OLD = `${DAILY}/2026/Journal/2026-03-24.md`;
const text = [
  "# Day", "## IT",
  "- [ ] Parent", "    - [ ] Child one", "        - [ ] Grandchild", "    - [x] Child done",   // 2-5: go with the parent
  "- [x] Finished parent ✅ 2026-08-17", "    - [ ] Left behind",                                               // 6-7: listed on its own
  "- Plain bullet", "    - [ ] Under a bullet", "        - [ ] Its child",                         // 8-10: listed, with its child
  "- [ ] Lone task",
].join("\n");
{
  // everything goes through hqGather and todayList, as HQ does
  if (H.journal) {
    const hq = R.hqGather([{ path: OLD, text, fm: {} }], { today: "2026-11-02" });
    const items = R.todayList({ nodes: [], links: [], hq }, { today: "2026-11-02" }).filter(i => i.kind === "carried"), by = w => items.find(i => i.title.includes(w));
    assert.deepStrictEqual(items.map(i => i.title).sort(), ["Left behind", "Lone task", "Parent", "Under a bullet"], "what's listed");
    assert.deepStrictEqual(by("Parent").subs.map(s => s.text.trim()), ["Child one", "Grandchild"], "open subtasks at any depth go with the top parent; a done one doesn't");
    assert.deepStrictEqual(by("Under a bullet").subs.map(s => s.line), [10], "a loose subtask keeps its own child");
    assert.strictEqual(by("Parent").section, "IT", "its heading");
    assert.strictEqual(by("Left behind").under, "Finished parent", "says what it sits under"); assert.strictEqual(by("Left behind").underDone, true, "left under a finished task");
    assert.ok(by("Left behind").why.includes("under Finished parent"), "Today's list says what it sits under too");
    assert.ok(!by("Under a bullet").underDone, "a plain bullet isn't a finished task");
    assert.strictEqual(by("Lone task").subs, undefined);
    assert.deepStrictEqual(R.taskRowsOf({ ...by("Parent") }).map(r => r.line), [2, 3, 4], "closing a task closes its open subtasks");
    // today's journal lists only what you wrote at the top; loose ones wait until tomorrow rather than clutter today
    const D = `${DAILY}/2026/Journal/2026-11-02.md`, today = R.todayList({ nodes: [], links: [], hq: R.hqGather([{ path: D, text, fm: {} }], { today: "2026-11-02" }) }, { today: "2026-11-02" }).filter(i => i.kind === "task");
    assert.ok(!today.some(i => /Left behind|Under a bullet/.test(i.title)), "a loose subtask in today's list");
  }
  // the history the science lenses use isn't changed by any of this: it still counts top-level tasks
  const j = R.journalOf(OLD, text); if (j) assert.ok(!j.tasks.some(x => x.loose), "the history picked up loose subtasks");
}
// ---- the next step in the evening, and two reports from one day
{ const task = [{ kind: "task", group: "today", key: "t", title: "T" }], next = o => R.hqNextStep({ list: task, day: "2026-11-02", ...o }).key;
  assert.strictEqual(next({ hour: 21, done: 5, standup: true }), "wrap", "the evening, work done, standup started");
  assert.strictEqual(next({ hour: 21, done: 5, standup: false }), "standup"); assert.strictEqual(next({ hour: 9, done: 5, standup: true }), "plan", "the morning still plans"); assert.strictEqual(next({ hour: 21, done: 0, standup: true }), "plan", "nothing done yet");
  assert.strictEqual(R.reportTitle("Backlog Reconciliation 2026-10-28 165418-420853 host"), "Backlog Reconciliation 2026-10-28"); }
// ---- what stays out of a standup: the rule, with this vault's pattern if it has one
{ const Q = new Function(`${require("../build").rulesSource({ ...env.rules, hq: { ...H, standup_skip: "\\b(vault|obsidian)\\b" } })}; return VGRules;`)();
  assert.strictEqual(Q.forStandup("Released Vault Graph 0.6.39"), false); assert.strictEqual(Q.forStandup("Fixed Obsidian Sync"), false); assert.strictEqual(Q.forStandup("Deployed Kiosk Prospects"), true);
  const none = new Function(`${require("../build").rulesSource({ ...env.rules, hq: { ...H, standup_skip: "" } })}; return VGRules;`)(); assert.strictEqual(none.forStandup("Vault work"), true, "no pattern, nothing left out"); }
// the evening's brief: no asking to pick a focus
{ const list = [{ kind: "plan", group: "today", key: "p", title: "P" }], data = { nodes: [], links: [], hq: { journals: [], standups: [], projects: [], reports: [], reviews: [] } };
  assert.ok(R.hqBrief(data, list, {}, "2026-11-02", [], 9).some(x => /none picked/.test(x)), "the morning asks"); assert.ok(!R.hqBrief(data, list, {}, "2026-11-02", [], 21).some(x => /none picked/.test(x)), "the evening doesn't"); }
// ---- two-way links: the numbers on a small case, and which lines can go
{ const ids = ["a", "b", "c", "d"], g = S.directedGraph(ids, [["a", "b"], ["b", "a"], ["b", "c"], ["c", "d"]]);
  assert.deepStrictEqual(S.twoWayPairs(g), [[0, 1]], "one two-way pair"); assert.ok(S.trophic(g.adj).incoherence > 0.1, "a loop is disorder"); assert.ok(S.incoherenceWithout(g, [[1, 0]]) < 0.01, `a straight chain once it's gone, got ${S.incoherenceWithout(g, [[1, 0]])}`);
  assert.strictEqual(S.vitals({ rows: [], today: "2026-11-02", notes: ids.map(id => ({ id, name: id, age: 0, stale: false })), pairs: [["a", "b"], ["b", "a"]] }).web.twoWay, 1); }
for (const [line, yes] of [["- [[Note]]", true], ["  * [[Note|text]] — why it matters", true], ["- [ ] [[Note]]", true], ["See [[Note]] for more.", false], ["- Read [[Note]] first", false], ["- [[A]] and [[B]]", false]]) assert.strictEqual(R.bareLinkLine(line), yes, line);
assert.strictEqual(R.linkKindOf("- [[N]]", "See Also"), "see also"); assert.strictEqual(R.linkKindOf("- [[N]]", "Process"), "list"); assert.strictEqual(R.linkKindOf("Read [[N]] now", "See Also"), "sentence");
assert.ok(!R.createdFromLine(["A", "B"]).includes("[["), "a stub line links back"); assert.ok(R.createdFromLine(["A", "B"]).includes("A, B"));
// ---- a way up: the first matching tag, else the system's map, never the note itself
{ const Q = new Function(`${require("../build").rulesSource({ ...env.rules, hierarchy: { system_root: "02-Systems", tag_hubs: { "technology/sql": "SQL", "technology/x": "Missing" } } })}; return VGRules;`)(), has = n => ["SQL", "Kiosk"].includes(n);
  assert.deepStrictEqual(Q.wayUp({ id: "02-Systems/Kiosk/Guides/A.md", name: "A", tags: ["technology/sql"] }, has), { hub: "SQL", why: "technology/sql" });
  assert.deepStrictEqual(Q.wayUp({ id: "02-Systems/Kiosk/Guides/A.md", name: "A", tags: [] }, has), { hub: "Kiosk", why: "in Kiosk" }, "its system's map");
  assert.strictEqual(Q.wayUp({ id: "02-Systems/Kiosk/Kiosk.md", name: "Kiosk", tags: [] }, has), null, "a map isn't its own parent"); assert.strictEqual(Q.wayUp({ id: "x/SQL.md", name: "SQL", tags: ["technology/sql"] }, has), null, "a hub isn't its own parent"); assert.strictEqual(Q.wayUp({ id: "x/B.md", name: "B", tags: ["technology/x"] }, has), null, "a hub that isn't there"); }
// ---- Today's adopt uses the same suggestion, and Vitals' Still current is the shared action
{ const hqSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "hq", "70-frame.js"), "utf8"); assert.ok(/VGActions\.run\("current"/.test(hqSrc), "Vitals' Still current has its own copy of the action");
  const act = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "actions.js"), "utf8"); assert.ok(/it\.up && c\.api\.setParents/.test(act), "adopt doesn't use the parent suggestion"); }
// ---- moving: the text a project note gets
{ const out = R.addProjectTask("# Note\n\n## Tasks\n\n- [ ] Was here\n", "Moved (from [[2026-03-24]])", ["Child one", "Grandchild"]);
  assert.ok(out.includes("- [ ] Was here\n- [ ] Moved (from [[2026-03-24]])\n    - [ ] Child one\n    - [ ] Grandchild"), `moved text: ${out}`);
  const crlf = R.addProjectTask("# Note\r\n", "A", ["B"]); assert.ok(crlf.includes("- [ ] A\r\n    - [ ] B"), "line endings"); }

// ---- the numbers, against a small case worked by hand
{ const notes = [{ id: "base", name: "Base", age: 730, stale: true }, { id: "mid", name: "Mid", age: 10, stale: false }, { id: "top", name: "Top", age: 400, stale: true }];
  const rows = [{ born: "2026-10-01", t: 32, event: false }, { born: "2026-10-20", t: 13, event: false }, { born: "2026-10-10", done: "2026-10-15", t: 5, event: true }];
  const v = S.vitals({ rows, today: "2026-11-02", notes, pairs: [["top", "mid"], ["mid", "base"]] });
  assert.strictEqual(v.pile.open, 2); assert.strictEqual(v.pile.came, 3); assert.strictEqual(v.pile.left, 1); assert.strictEqual(v.pile.net, 2); assert.strictEqual(v.pile.old, 1, "older than 30 days");
  assert.strictEqual(v.pile.wip[v.pile.wip.length - 1], 2, "the trend ends where the count is");
  // base: mid on it directly (1), top through mid (a half), times 2 years = 3. top: nothing rests on it, so no debt.
  assert.strictEqual(v.debt.top.id, "base"); assert.strictEqual(v.debt.top.direct, 1); assert.strictEqual(v.debt.top.reach, 2); assert.ok(Math.abs(v.debt.total - 3) < 1e-9, `debt ${v.debt.total}`); assert.strictEqual(v.debt.count, 1);
  assert.ok(v.web.incoherence < 0.01, `a straight chain is a strict hierarchy, got ${v.web.incoherence}`);
  const none = S.vitals({ rows: [], today: "2026-11-02", notes, pairs: [] }); assert.strictEqual(none.debt.top, null); assert.strictEqual(none.web.incoherence, null);
  assert.deepStrictEqual(S.vitalsSample(v), { open: 2, debt: 3, incoherence: +v.web.incoherence.toFixed(2) });
  const h = { "2026-10-20": { open: 10 }, "2026-10-26": { open: 8 }, "2026-10-30": { open: 1 } };
  assert.strictEqual(S.vitalsDelta(h, "2026-11-02", "open", 5), -3, "against the latest sample a week or more old");
  assert.strictEqual(S.vitalsDelta({ "2026-10-30": { open: 1 } }, "2026-11-02", "open", 5), null, "no sample that old yet"); }

(async () => {
  // ---- the real plugin code: Move and Sweep through viewActions, on a stand-in vault
  if (H.journal) {
    const { Plugin, TFile } = stub.load(env.rules), PROJ = "Project.md", files = new Map();
    const mk = (p, t) => files.set(p, { f: Object.assign(new TFile(), { path: p, basename: p.split("/").pop().replace(/\.md$/, ""), name: p.split("/").pop(), extension: "md" }), text: t });
    mk(OLD, text); mk(PROJ, "# Project\n\n## Tasks\n\n- [ ] Existing\n");
    const fileOf = p => (files.get(p) || {}).f || null;
    const app = { vault: { getAbstractFileByPath: fileOf, process: async (f, fn) => { const e = files.get(f.path); e.text = fn(e.text); return e.text; }, read: async f => files.get(f.path).text, cachedRead: async f => files.get(f.path).text, modify: async (f, t) => { files.get(f.path).text = t; }, adapter: { exists: async () => false, read: async () => "{}", write: async () => {}, mkdir: async () => {}, list: async () => ({ files: [], folders: [] }) }, getMarkdownFiles: () => [...files.keys()].map(fileOf), on() {} },
      metadataCache: { on: () => ({}), offref() {}, getFileCache: () => ({}), resolvedLinks: {}, unresolvedLinks: {} }, workspace: { getLeavesOfType: () => [] }, loadLocalStorage: () => "t", saveLocalStorage() {} };
    const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: "shared.json" } }), a = p.viewActions({});
    assert.strictEqual(typeof a.moveTasks, "function", "the plugin doesn't offer Move"); assert.strictEqual(typeof a.vitals, "function", "the plugin doesn't offer vitals");
    const hq = R.hqGather([{ path: OLD, text, fm: {} }], { today: "2026-11-02" }), item = R.todayList({ nodes: [], links: [], hq }, { today: "2026-11-02" }).find(i => i.title === "Parent");
    const n = await a.moveTasks([item], PROJ), j = files.get(OLD).text.split("\n"), to = files.get(PROJ).text;
    assert.strictEqual(n, 3, "a task and two subtasks"); assert.ok(j[2].startsWith("- [-] Parent") && j[3].includes("[-] Child one") && j[4].includes("[-] Grandchild"), "cancelled where they were");
    assert.ok(j[5].includes("[x] Child done"), "a finished subtask stays as it was");
    assert.ok(to.includes("- [ ] Parent (from [[2026-03-24]])\n    - [ ] Child one\n    - [ ] Grandchild"), `moved: ${to}`);
    // Undo puts both notes back, as one action
    if (p.wrapWriteActions) { const before = files.get(OLD).text, toBefore = files.get(PROJ).text; p.publish = async () => {}; p.nextStepSoon = () => {}; p.wrapWriteActions(); const it2 = R.todayList({ nodes: [], links: [], hq: R.hqGather([{ path: OLD, text: before, fm: {} }], { today: "2026-11-02" }) }, { today: "2026-11-02" }).find(i => i.title === "Lone task");
      assert.ok(it2, "a task left to move"); await p.moveTasks([it2], PROJ); assert.notStrictEqual(files.get(OLD).text, before, "nothing moved"); const entry = p.undoLog[p.undoLog.length - 1]; assert.ok(entry, "Move left no undo entry"); await p.undo(entry.id);
      assert.strictEqual(files.get(OLD).text, before, "Undo left the journal changed"); assert.strictEqual(files.get(PROJ).text, toBefore, "Undo left the project changed"); }
    // dropping list lines, through the plugin: several from one note, a changed line stays, and Undo puts them all back
    { mk("Links.md", "# L\n- [[One]]\nA sentence with [[Two]].\n- [[Three]]\n- [[Four]]\n"); const was = files.get("Links.md").text;
      assert.strictEqual(typeof p.dropLinkLines, "function", "no dropLinkLines"); assert.strictEqual(typeof a.dropLinkLines, "undefined");   // the view's option, not a write anyone else calls
      const n2 = await p.dropLinkLines([{ path: "Links.md", line: 1, text: "- [[One]]" }, { path: "Links.md", line: 3, text: "- [[Three]]" }, { path: "Links.md", line: 4, text: "- [[Changed]]" }, { path: "Links.md", line: 2, text: "A sentence with [[Two]]." }]);
      assert.strictEqual(n2, 2, "two lines dropped; a changed line and a sentence stay"); assert.strictEqual(files.get("Links.md").text, "# L\nA sentence with [[Two]].\n- [[Four]]\n");
      if (p.undoLog) { const entry = p.undoLog[p.undoLog.length - 1]; await p.undo(entry.id); assert.strictEqual(files.get("Links.md").text, was, "Undo left the note changed"); } }
    // setting a parent through the plugin: added once, an existing parent kept, Undo takes it out
    { mk("Up.md", "---\ntags:\n  - x\n---\n# Up\n"); mk("Has.md", "---\nparent: Other\n---\n# Has\n"); const was = files.get("Up.md").text;
      app.fileManager = { processFrontMatter: async (f, fn) => { const e = files.get(f.path), fm = R.frontOf(e.text); fn(fm); const y = Object.entries(fm).map(([k, v]) => (Array.isArray(v) ? [`${k}:`, ...v.map(x => `  - ${x}`)].join("\n") : `${k}: ${v}`)).join("\n"); e.text = e.text.replace(/^---\n[\s\S]*?\n---/, `---\n${y}\n---`); } };
      const n3 = await p.setParents([{ path: "Up.md", hub: "SQL" }, { path: "Has.md", hub: "SQL" }]); assert.strictEqual(n3, 1, "only the note with no parent"); assert.ok(files.get("Up.md").text.includes("parent: [[SQL]]"), files.get("Up.md").text); assert.ok(files.get("Has.md").text.includes("parent: Other"), "an existing parent was replaced");
      if (p.undoLog) { const entry = p.undoLog[p.undoLog.length - 1]; await p.undo(entry.id); assert.strictEqual(files.get("Up.md").text, was, "Undo left the parent"); } }
    // changed since it was shown: left where it is, and not copied
    const gone = await a.moveTasks([{ ...item, text: "Not the line any more", subs: [] }], PROJ); assert.strictEqual(gone, 0); assert.ok(!files.get(PROJ).text.includes("Not the line"), "a changed line was copied");
  }
  // ---- on the page: Vitals and the Sweep's controls
  const V = { pile: { open: 12, came: 30, left: 18, net: 12, old: 4, wip: [1, 3, 6, 12] }, debt: { total: 40, count: 3, top: { id: "x.md", name: "Old Guide", cost: 20, direct: 4, reach: 9, years: 2.5 } }, web: { incoherence: 0.44, links: 600, twoWay: 90 } };
  const tab = await cdp.open({ html: env.hqPage("", { today: undefined }), port: 9396 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    const hasCarried = (await tab.ev(`window.vaultHQ.items().filter(i => i.kind === "carried").length`)) > 0;
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.__calls = []; const rec = k => async (...a) => { window.__calls.push([k, ...a]); return 1; };
      window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { state: { review: { hqTour: true, vitals: { "2020-01-01": { open: 20, debt: 40, incoherence: 0.7 } } } }, ask: async () => true, openGraph: to => window.__calls.push(["graph", to]),
        api: { vitals: async () => (${JSON.stringify(V)}), moveTasks: rec("moveTasks"), setTasksStatus: rec("setTasksStatus"), setTaskStatus: rec("setTaskStatus"), stampReviewed: rec("stampReviewed"), openNote: rec("openNote") } }); })()`);
    check(await tab.waitFor(`document.querySelector(".vg-hq-vitals") ? 1 : 0`, 5000), "Vitals never showed on Home");
    const t = await tab.ev(`document.querySelector(".vg-hq-vitals").textContent`);
    for (const w of ["The pile grew by 12 in 90 days", "30 came in, 18 finished", "12 open from earlier days", "4 older than 30 days", "down 8 in a week", "Review Old Guide first", "4 linked directly", "Your links run partly one way", "Incoherence 0.44", "down 0.26 in a week"]) check(t.includes(w), `Vitals: no "${w}" in: ${t}`);
    check(!/NaN|undefined/.test(t), "Vitals shows a broken number");
    const click = sel => tab.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
    check(await click('[data-graphlens="debt"]'), "no way into Knowledge debt"); check(await click('[data-graphview="foodweb"]'), "no way into the Food web");
    check(await click('[data-vital-current]'), "no Still current"); await sleep(100);
    const calls = await tab.ev(`window.__calls`);
    check(calls.some(c => c[0] === "graph" && c[1].lens === "debt"), "the lens button didn't reach the host"); check(calls.some(c => c[0] === "graph" && c[1].view === "foodweb"), "the Food web button didn't reach the host"); check(calls.some(c => c[0] === "stampReviewed" && c[1] === "x.md"), "Still current didn't stamp the note");
    check(await tab.ev(`!!document.querySelector('[data-graphlens="twoway"]')`), "Vitals has no way into Two-way links");
    if (hasCarried) {
      await tab.ev(`window.vaultHQ.setScreen("sweep")`); await sleep(100);
      check(await tab.ev(`!!document.querySelector('[data-one="move"]') && !!document.querySelector('[data-batch="move"]')`), "the Sweep has no Move");
      check(await click('[data-sweepby="section"]'), "no way to group by heading"); await sleep(60);
      check(await tab.ev(`!!document.querySelector('.vg-hq-sweep [data-section]') && !document.querySelector('.vg-hq-sweep [data-day]')`), "grouping by heading didn't change the groups");
      // Keep all by heading acts on that heading's tasks, through the same path as by day
      const before = await tab.ev(`document.querySelectorAll('.vg-hq-sweep .vg-hq-item').length`); await click('.vg-hq-sweep [data-section][data-batch="keep"]'); await sleep(60);
      check((await tab.ev(`document.querySelectorAll('.vg-hq-sweep .vg-hq-item').length`)) < before, "Keep all by heading did nothing");
      await click('[data-sweepby="day"]');
      // one at a time, then out again; leaving the screen ends it
      await tab.ev(`window.vaultHQ.setScreen("today")`); await tab.ev(`window.vaultHQ.setScreen("sweep")`); await sleep(60);   // coming back brings kept tasks back
      check(await click('.vg-hq-filters [data-walk="on"]'), "no One at a time in the Sweep"); await sleep(60); check(await tab.ev(`!!document.querySelector(".vg-hq-walk")`), "One at a time didn't start");
      check(await tab.ev(`!!document.querySelector('.vg-hq-walk [data-one="-"]') && !!document.querySelector('.vg-hq-walk [data-one="move"]')`), "One at a time can't cancel or move");
      await tab.ev(`window.vaultHQ.setScreen("today")`); await tab.ev(`window.vaultHQ.setScreen("sweep")`); await sleep(60); check(await tab.ev(`!document.querySelector(".vg-hq-walk")`), "One at a time outlived the screen");
      // leftovers under a finished task get their own group, and only that group's Cancel all touches them
      const hasLeft = await tab.ev(`window.vaultHQ.items().filter(i => i.kind === "carried" && i.underDone).length`);
      if (hasLeft) { check(await click('[data-leftover][data-batch="-"]'), "the leftovers have no Cancel all"); await sleep(100); const last = (await tab.ev(`window.__calls`)).filter(c => c[0] === "setTasksStatus").pop(); check(last && last[1].length >= hasLeft, "Cancel all on the leftovers didn't cancel them"); }
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  if (fails.length) { console.error(fails.map(f => `  - ${f}`).join("\n")); process.exit(1); }
  console.log("ok - sweep and vitals: subtasks kept with their tasks or listed, Move through the plugin, Vitals with trend and actions");
})().catch(e => { console.error(e); process.exit(1); });
