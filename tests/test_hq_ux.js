#!/usr/bin/env node
// Note preview, search filters, time per project, the week's write-up, and the UX fixes that go with them: the rail takes no
// room when it has nothing to say, thread bars differ, report names read as words, the graph's task counts wait until you zoom.
//   node tests/test_hq_ux.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, openPage, tools } = require("./kit");
const assert = require("assert"), fs = require("fs"), path = require("path"), env = require("./env"), { VGRules: R } = env.notes();
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// report names
assert.strictEqual(R.reportTitle("Backlog Reconciliation 2026-10-30 210001-235030 jackson-nuc13anhi7"), "Backlog Reconciliation 2026-10-30");
assert.strictEqual(R.reportTitle("Plain Report 2026-10-30"), "Plain Report 2026-10-30", "a clean name stays");
// the query
assert.deepStrictEqual(R.hqSearchQuery("sticker is:old kind:Scope"), { text: "sticker", filters: [{ key: "is", value: "old" }, { key: "kind", value: "scope" }] });
assert.deepStrictEqual(R.hqSearchQuery("note: fix at 10:30").filters, [], "an unknown name is plain words"); assert.strictEqual(R.hqSearchQuery("note: fix at 10:30").text, "note: fix at 10:30");
assert.deepStrictEqual(R.hqSearchQuery('in:"Kiosk Server"').filters, [{ key: "in", value: "kiosk server" }], "a quoted value");
const pass = (x, q, o) => R.hqSearchPasses(x, R.hqSearchQuery(q).filters, { today: "2026-11-01", staleDays: 90, ...o });
const P = { path: "02/Odoo/x.md", group: "active", kind: "Scope", status: "testing", systems: ["project/odoo"], tags: ["project/odoo"], updated: "2026-01-01" }, I = { key: "k", kind: "carried", path: "J/a.md", age: 20 };
assert(pass(P, "kind:scope") && !pass(P, "kind:story"), "kind on a project"); assert(pass(P, "status:testing") && pass(P, "status:active") && !pass(P, "status:planned"), "status");
assert(pass(P, "tag:odoo") && !pass(P, "tag:aws"), "tag"); assert(pass(P, "in:odoo") && !pass(P, "in:kiosk"), "in"); assert(pass(P, "is:stale"), "a project quiet ten months"); assert(!pass({ ...P, updated: "2026-10-30" }, "is:stale"), "a fresh project");
assert(pass(I, "is:old") && !pass({ ...I, age: 2 }, "is:old"), "age"); assert(!pass(I, "status:testing"), "a task has no status"); assert(pass(I, "is:focus", { focus: ["k"] }) && !pass(I, "is:focus"), "focus"); assert(pass(I, "kind:carried"), "a task's kind");
assert(!pass(I, "is:nonsense"), "a filter that means nothing passes nothing");
// a preview
const pv = R.notePreview("---\ntags: [x]\nsecret: y\n---\n# Title\n\nFirst **bold** [[Note|line]]\nstill first.\n\n- one\n  - two\n- [x] done\n- [ ] open\n\n```js\nconst a = 1;\n```\n\n![[pic.png]]\n|---|---|\n");
assert(!JSON.stringify(pv).includes("secret"), "frontmatter shows"); assert.strictEqual(pv.blocks[0].kind, "h"); assert.strictEqual(pv.blocks[1].text, "First bold line still first.", "markup shows, or lines aren't joined");
assert.deepStrictEqual(pv.blocks.filter(b => b.kind === "li").map(b => [b.text, b.deep, b.task, b.done]), [["one", false, false, false], ["two", true, false, false], ["done", false, true, true], ["open", false, true, false]]);
assert.strictEqual(pv.blocks.find(b => b.kind === "code").text, "const a = 1;"); assert(!JSON.stringify(pv).includes("pic.png"), "an embed shows"); assert(!pv.cut);
assert(R.notePreview("x".repeat(50), 10).cut, "a long note says it's cut"); assert.deepStrictEqual(R.notePreview("").blocks, []); assert.strictEqual(R.notePreview("```\nopen").blocks[0].text, "open", "an unclosed fence keeps its text");
// the week
assert.strictEqual(R.weekStart("2026-11-01"), "2026-10-26", "a Sunday belongs to the week before"); assert.strictEqual(R.weekStart("2026-10-26"), "2026-10-26");
const week = R.weekReview({ hq: { journals: [{ path: "j", date: "2026-10-27", tasks: [{ mark: "x", text: "Shipped ✅ 2026-10-27" }, { mark: "x", text: "Last week ✅ 2026-10-20" }] }] } }, { sessions: { "2026-10-27": 90 } }, "2026-10-26");
assert.strictEqual(week.total, 1); assert.strictEqual(week.focus, 90); assert(/- Shipped/.test(week.text) && !/Last week/.test(week.text), week.text); assert(/1h 30m focused/.test(week.text), week.text);
// time per project, across devices and a move
assert.strictEqual(R.projectMinutes({ sessionFor: { "a.md": 7 } }, "a.md"), 7); assert.strictEqual(R.projectMinutes({}, "a.md"), 0);
assert.deepStrictEqual(R.mergeShared({ review: {} }, { review: { sessionFor: { "a.md": 5 } } }, { review: { sessionFor: { "a.md": 9, "b.md": 1 } } }).review.sessionFor, { "a.md": 9, "b.md": 1 });
assert.deepStrictEqual(R.followMoves({ sessionFor: { "old.md": 5 } }, { "old.md": { to: "new.md", at: "1" } }, () => false).sessionFor, { "new.md": 5 }, "a project's time should follow its note");

// the real plugin gives HQ what these features ask for: everything below uses stand-ins, which can't catch one that's missing
{ const stub = require("./plugin_stub"), { Plugin, TFile } = stub.load(env.rules), files = { "a.md": "text" }, shared = {};
  const file = Object.assign(new TFile(), { path: "a.md" });
  const app = { metadataCache: { getFirstLinkpathDest: (t, from) => (t === "A" && from === "b.md" ? file : null) }, vault: { getAbstractFileByPath: p => (p in files ? file : null), cachedRead: async () => files["a.md"], adapter: { read: async p => { if (p in shared) return shared[p]; throw new Error("no file"); }, write: async (p, t) => { shared[p] = t; }, exists: async p => p in shared, list: async () => ({ files: [], folders: [] }), mkdir: async () => {} } }, workspace: { getLeavesOfType: () => [] }, loadLocalStorage: () => "d", saveLocalStorage() {} };
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: "shared.json", dismissedPath: "d.json" } }), a = p.viewActions(null);
  Promise.resolve().then(async () => {
    assert.strictEqual(await a.readNote("a.md"), "text", "the plugin can't read a note for Peek");
    assert.strictEqual(a.resolveLink("A", "b.md"), "a.md", "the plugin can't follow a link for Peek"); assert.strictEqual(a.resolveLink("Nowhere", "b.md"), null, "a link to nothing should be nothing");
    // a session takes the status bar with its clock, gives it back, and the graph's chip hears about both
    { const said = {}, bar = { setText: t => { said.text = t; }, setAttr() {}, toggleClass: (c, on) => { said[c] = on; } }; let chip = 0;
      const was = app.workspace.getLeavesOfType; app.workspace.getLeavesOfType = t => (t === "vault-graph" ? [{ view: { handle: { syncNext() { chip++; } } } }] : []); p.nextEl = bar;
      p.showFocus({ title: "The task", clock: "24:59", over: false, paused: false }); assert.strictEqual(said.text, "Focus 24:59 · The task"); assert.strictEqual(chip, 1, "the graph's chip should hear a session start"); assert.strictEqual(a.focusNow().title, "The task");
      p.showFocus({ title: "The task", clock: "+0:01", over: true, paused: false }); assert.strictEqual(said["is-over"], true, "time up isn't marked"); assert.strictEqual(chip, 1, "the chip only needs the change");
      p.graphData = async () => ({ nodes: [], links: [] }); await p.updateNextStep(); assert.strictEqual(said.text, "Focus +0:01 · The task", "the next step wrote over the clock");
      p.showFocus(null); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(chip, 2, "the graph's chip should hear a session end"); assert(/^Next: /.test(said.text), `the status bar should go back to the next step: ${said.text}`); assert.strictEqual(said["is-over"], false); assert.strictEqual(a.focusNow(), null);
      p.nextEl = null; app.workspace.getLeavesOfType = was; }
    await a.readNote("gone.md").then(() => assert.fail("reading a missing note should fail"), e => assert(/missing/.test(e.message)));
    await a.hqSession("2026-11-01", 5, "project.md"); await a.hqSession("2026-11-01", 2, "project.md"); await a.hqSession("2026-11-01", 1);
    const r = JSON.parse(shared["shared.json"]).review; assert.deepStrictEqual(r.sessions, { "2026-11-01": 8 }, "the day's time"); assert.deepStrictEqual(r.sessionFor, { "project.md": 7 }, "the project's time");
    // one HQ tab, whatever an update left behind
    const gone = [], leaves = [{ id: 1 }, { id: 2 }, { id: 3 }].map(l => ({ ...l, detach() { gone.push(l.id); } })); app.workspace.getLeavesOfType = () => leaves;
    assert.strictEqual(p.oneHQ().id, 1, "the first tab should stay"); assert.deepStrictEqual(gone, [2, 3], "extra HQ tabs should close");
  }).catch(e => { console.log(`FAIL - the plugin's side: ${e.message}`); process.exit(1); }); }

(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const shot = name => tools(tab, { shots: SHOTS }).shot(name);
    const size = async (width, mobile = false) => { await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile }); await sleep(120); };
    const screen = s => tools(tab, { wait: 60 }).screen(s);
    const click = sel => tools(tab).click(sel);
    const calls = () => tab.ev(`window.__calls`);
    let mount = (state = "{}") => tab.ev(`(() => { window.vaultHQ.destroy(); window.__calls = []; const rec = k => async (...a) => { window.__calls.push([k, ...a]); return true; }; window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { state: ${state}, ask: async () => true, input: async () => window.__say, notify: m => window.__calls.push(["notify", m]), onSession: s => { window.__focus = s; }, api: { resolveLink: (t, from) => (t === "Dir/Other" && from !== "Dir/Other.md" ? "Dir/Other.md" : t === "Linked" ? "Linked.md" : null), hqFocus: rec("hqFocus"), hqMark: rec("hqMark"), setTaskStatus: rec("setTaskStatus"), completeTask: rec("completeTask"), setTasksStatus: rec("setTasksStatus"), hqSession: rec("hqSession"), writeNote: rec("writeNote"), openNote: p => window.__calls.push(["open", p]), readNote: async p => { if (p === "gone.md") throw new Error("missing"); if (p === "Linked.md") return "Start [[Dir/Other|the other]] and [[Nowhere]] and ![[pic.png]] end.\\n\\n- see [[Dir/Other#Part|the part]]\\n"; if (p === "Dir/Other.md") return "Back to [[Linked]].\\n"; return "---\\ntags: [x]\\n---\\n# In the note\\n\\nSome words.\\n\\n- a point\\n"; }, searchNotes: async q => { window.__calls.push(["search", q]); return [{ path: "Old fix.md", heading: "How it was solved", snippet: "We did this" }, { path: "Dir/Other.md", heading: "Other" }]; } } }); })()`);
    await mount(); await size(1500); const jobs = await tab.ev(`window.vaultHQ.items().filter(i => i.kind === "job").map(i => i.key)`);
    if (jobs.length) { const set = `{ review: { hq: Object.fromEntries(${JSON.stringify(jobs)}.map(k => [k, "later:" + VGRules.localDay(new Date())])) } }`; const again = mount; mount = (state = set) => again(state); await mount(); await size(1500); }  // a failed job takes the Do next card; these checks are about a task

    // peek: from what your notes know, without leaving HQ
    await screen("today"); await sleep(120);
    check(await click(".vg-hq-rail [data-peek]"), "what your notes know should peek, not leave"); await sleep(80);
    check(await tab.ev(`/In the note/.test(document.querySelector(".vg-hq-peek").textContent) && /Some words/.test(document.querySelector(".vg-hq-peek").textContent)`), "the preview doesn't show the note"); check(!(await calls()).some(c => c[0] === "open"), "peeking left HQ"); await shot("peek");
    check(!(await tab.ev(`/tags: \\[x\\]/.test(document.querySelector(".vg-hq-peek").textContent)`)), "the preview shows frontmatter");
    await tab.ev(`document.querySelector(".vg-hq").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(40); check(!(await tab.ev(`!!document.querySelector(".vg-hq-peek")`)), "Escape doesn't close the preview");
    await click(".vg-hq-rail [data-peek]"); await sleep(60); await click(".vg-hq-peek [data-open]"); await sleep(20); check((await calls()).some(c => c[0] === "open"), "the preview's Open the note"); await click(".vg-hq-peek .vg-hq-x"); await sleep(30);
    await tab.ev(`document.querySelector(".vg-hq-rail [data-peek]").dataset.peek = "gone.md"`); await click(".vg-hq-rail [data-peek]"); await sleep(70); check(/isn't there/.test(await tab.ev(`document.querySelector(".vg-hq-peek").textContent`)), "a missing note should say so"); await click(".vg-hq-scrim[data-peekclose]"); await sleep(30); check(!(await tab.ev(`!!document.querySelector(".vg-hq-peek")`)), "the scrim doesn't close it");
    // going to another screen closes it
    await tab.ev(`document.querySelector(".vg-hq-rail [data-peek]").dataset.peek = "x.md"`); await click(".vg-hq-rail [data-peek]"); await sleep(50); await screen("home"); check(!(await tab.ev(`!!document.querySelector(".vg-hq-peek")`)), "a preview stays across screens");

    // search filters: chips add and remove, words still search, and filters alone work
    await screen("today");
    const type = q => tab.ev(`(() => { const f = document.querySelector(".vg-hq-global-search"); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await type("sticker is:old"); await sleep(320);
    check((await calls()).some(c => c[0] === "search" && c[1] === "sticker"), "the note search got the filter as words");
    check(await tab.ev(`!!document.querySelector('.vg-hq-searchchips [data-dropq="is:old"]')`), "an active filter shows no chip"); await shot("search");
    await click('[data-dropq="is:old"]'); await sleep(60); check(await tab.ev(`document.querySelector(".vg-hq-global-search").value === "sticker"`), "removing a chip should take it out of the box");
    await click('[data-addq="is:focus"]'); await sleep(60); check(await tab.ev(`document.querySelector(".vg-hq-global-search").value === "sticker is:focus"`), "a hint should go in the box"); check(await tab.ev(`document.activeElement === document.querySelector(".vg-hq-global-search")`), "the box should keep the cursor");
    await type("is:old"); await sleep(320); check(await tab.ev(`!/No matching/.test(document.querySelector(".vg-hq-main").textContent) || window.vaultHQ.items().every(i => !(i.age >= 14))`), "a filter with no words should still list what passes");
    await type("kind:zzznothing"); await sleep(120); check(/No matching/.test(await tab.ev(`document.querySelector(".vg-hq-main").textContent`)), "nothing passing should say so"); check(await tab.ev(`document.querySelectorAll(".vg-hq-searchchips button").length`) > 0, "an empty result should still offer the chips");
    await click("[data-clear-global]"); await sleep(50);

    // the rail takes no room with nothing to say, and appears when a row is picked
    await screen("people"); const noRail = await tab.ev(`!document.querySelector(".vg-hq-rail")`); check(noRail, "an empty rail takes room on People");
    if (noRail && await tab.ev(`!!document.querySelector(".vg-hq-item[data-key] .vg-hq-txt")`)) { await click(".vg-hq-item[data-key] .vg-hq-txt"); await sleep(60); check(await tab.ev(`!!document.querySelector(".vg-hq-rail .vg-hq-railtitle")`), "picking a row should bring the rail"); }
    await screen("threads"); check(await tab.ev(`!document.querySelector(".vg-hq-rail")`), "an empty rail takes room on Threads");
    // thread bars say something
    await screen("home"); const bars = await tab.ev(`[...document.querySelectorAll(".vg-hq-threadbar i")].map(i => parseInt(i.style.width))`); if (bars.length > 1) { check(Math.max(...bars) === 100, "the biggest thread should fill its bar"); check(bars.every(b => b > 0 && b <= 100), `bars: ${bars}`); }
    // keys can be found
    await click("[data-keys]"); await sleep(30); check(await tab.ev(`/Focus session/.test(document.querySelector(".vg-hq-keys").textContent)`), "the ? button should list the keys"); await click(".vg-hq-dialog [data-no]"); await sleep(20);

    // Peek's links: follow one, come back, and a link to nothing stays words
    { await mount(); await screen("today"); await tab.ev(`(() => { const a = document.createElement("button"); a.dataset.peek = "Linked.md"; a.className = "__peek"; document.querySelector(".vg-hq-main").appendChild(a); })()`); await click(".__peek"); await sleep(60);
      const peekText = () => tab.ev(`document.querySelector(".vg-hq-peek").textContent`), links = () => tab.ev(`[...document.querySelectorAll(".vg-hq-peek [data-peeklink]")].map(b => b.textContent)`);
      check(JSON.stringify(await links()) === '["the other","the part"]', `Peek's links: ${JSON.stringify(await links())}`); check(/and Nowhere and/.test(await peekText()), "a link to nothing should stay as words"); check(!/pic\.png/.test(await peekText()), "an embed shows as text"); check(!(await tab.ev(`!!document.querySelector(".vg-hq-peek [data-peekback]")`)), "the first note has nowhere to go back to");
      const look = await tab.ev(`(() => { const s = getComputedStyle(document.querySelector(".vg-hq-peek [data-peeklink]")); return { bg: s.backgroundColor, display: s.display, underline: s.textDecorationLine }; })()`); check(look.bg === "rgba(0, 0, 0, 0)" && look.display !== "block" && look.underline === "underline", `a link in a note should read as a link: ${JSON.stringify(look)}`); await shot("peek-links");
      await click(".vg-hq-peek [data-peeklink]"); await sleep(60); check(await tab.ev(`document.querySelector(".vg-hq-peek h2").textContent === "Other"`), "the link didn't open its note"); check(/Back to Linked/.test(await tab.ev(`document.querySelector(".vg-hq-peek [data-peekback]").textContent`)), "no way back");
      await click(".vg-hq-peek [data-peeklink]"); await sleep(60); check(await tab.ev(`document.querySelector(".vg-hq-peek h2").textContent === "Linked"`), "a second link"); await click(".vg-hq-peek [data-peekback]"); await sleep(60); check(await tab.ev(`document.querySelector(".vg-hq-peek h2").textContent === "Other"`), "Back goes one step"); await click(".vg-hq-peek [data-peekback]"); await sleep(60);
      check(await tab.ev(`document.querySelector(".vg-hq-peek h2").textContent === "Linked" && !document.querySelector(".vg-hq-peek [data-peekback]")`), "Back should end at the first note"); await click(".vg-hq-peek .vg-hq-x"); await sleep(30); }
    // pick a day: a word becomes a date, words that aren't one change nothing, Cancel changes nothing
    { await mount(); await screen("today"); const sel = '.vg-hq-next [data-act="snooze"]'; check(await tab.ev(`!!document.querySelector(${JSON.stringify(sel)})`), "Do next has no Pick a day"); check(!(await tab.ev(`!!document.querySelector('.vg-hq-sec .vg-hq-item [data-act="snooze"]')`)), "Pick a day crowds every row");
      const marks = async () => (await calls()).filter(c => c[0] === "hqMark");
      await tab.ev(`window.__say = null`); await click(sel); await sleep(40); check(!(await marks()).length, "Cancel snoozed it");
      await tab.ev(`window.__say = "soon"`); await click(sel); await sleep(40); check(!(await marks()).length, "words that aren't a day snoozed it"); check(/isn't a day after today/.test(await tab.ev(`document.querySelector(".vg-hq").textContent`)), "a day it can't read should say so");
      await tab.ev(`window.__say = "2 weeks"`); const key = await tab.ev(`document.querySelector(${JSON.stringify(sel)}).dataset.key`); await click(sel); await sleep(60); const m = await marks(); check(m.length === 1 && m[0][1] === key && /^until:\d{4}-\d{2}-\d{2}$/.test(m[0][2]), `Pick a day: ${JSON.stringify(m)}`); check(/^Back /.test(await tab.ev(`(document.querySelector(".vg-hq-toast") || {}).textContent || ""`)), "it should say when it comes back"); }
    // a session tells the plugin, and says once when time is up
    { await mount(); await screen("today"); await click(".vg-hq-next [data-session]"); await sleep(50); const f = await tab.ev(`window.__focus`); check(f && f.title && /^\d+:\d\d$/.test(f.clock) && !f.over && !f.paused, `a session should say its clock: ${JSON.stringify(f)}`);
      await tab.ev(`(window.vaultHQ.session().since -= 26 * 60000, window.__calls = [], 0)`); await sleep(1150); check(await tab.ev(`window.__focus.over`), "time up isn't told"); await sleep(1100); const said = (await calls()).filter(c => c[0] === "notify"); check(said.length === 1 && /25 minutes are up/.test(said[0][1]), `time up should notify once: ${JSON.stringify(said)}`);
      await click('[data-sessionctl="pause"]'); await sleep(30); await tab.ev(`0`); await sleep(1100); check(await tab.ev(`window.__focus.paused`), "Pause isn't told"); await click('[data-sessionctl="end"]'); await sleep(40); check((await tab.ev(`window.__focus`)) === null, "the end isn't told");
      await click(".vg-hq-next [data-session]"); await sleep(40); check(!!(await tab.ev(`window.__focus`)), "a second session"); await tab.ev(`window.vaultHQ.destroy()`); check((await tab.ev(`window.__focus`)) === null, "closing HQ should end what the status bar shows"); await tab.ev(`window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { api: {} })`); }
    // the week's write-up, and a session's time on its project
    await screen("calendar"); const save = await tab.ev(`!!document.querySelector("[data-weeksave]")`);
    if (save) { await tab.ev(`window.__calls = []`); await click("[data-weeksave]"); await sleep(70); const c = (await calls()).find(x => x[0] === "writeNote"); check(c && /Week in Review \d{4}-\d{2}-\d{2}\.md$/.test(c[1]) && /type\/report/.test(c[2]) && c[3].mode === "create", `Save as a note: ${JSON.stringify(c)}`); check(c && c[1].startsWith(R.folders.inbox + "/"), "the note should land in the inbox"); }
    const th = await tab.ev(`(() => { const items = window.vaultHQ.items().filter(i => i.group === "today"); return items.length ? items[0].key : null; })()`);
    if (th) { await tab.ev(`document.querySelector(".vg-hq").dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }))`); await sleep(40);
      if (await tab.ev(`!!window.vaultHQ.session()`)) { await tab.ev(`(window.vaultHQ.session().since -= 3 * 60000, window.__calls = [], 0)`); await click('[data-sessionctl="end"]'); await sleep(40); const c = (await calls()).find(x => x[0] === "hqSession"); check(c && c[2] === 3, `a session's minutes: ${JSON.stringify(c)}`); } }
    await mount(`{ review: { sessionFor: { [DATA.hq.projects[0].path]: 95 } } }`); await screen("projects"); await click("[data-board]"); await sleep(40);
    check(await tab.ev(`document.querySelector("[data-card='" + DATA.hq.projects[0].path.replace(/'/g, "\\\\'") + "']") ? /1h 35m/.test(document.querySelector("[data-card='" + DATA.hq.projects[0].path.replace(/'/g, "\\\\'") + "']").textContent) : true`), "a board card doesn't show its project's time");
    await click("[data-board]"); await sleep(20);

    // every width stays inside itself
    for (const [w, m] of [[390, true], [800, false], [1500, false]]) { await size(w, m); await screen("today"); await type("sticker is:old"); await sleep(120); check(await tab.ev(`document.querySelector(".vg-hq-main").scrollWidth <= document.querySelector(".vg-hq-main").clientWidth + 1`), `search at ${w} runs off the side`); if (w === 390) await shot("search-phone"); await click("[data-clear-global]"); await sleep(30); }
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - HQ UX:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - HQ UX: peek, search filters, the week, a project's time, the rail, thread bars, keys");
  process.exit(0);
})();
