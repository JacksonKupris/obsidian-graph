#!/usr/bin/env node
// The cockpit: the rail follows the selection, the palette finds and does, threads and the brief read true, the weekly review
// goes somewhere from every step. And it scales: a vault of 20,000 notes with thousands of open items stays quick to draw,
// long lists come a page at a time, and the costly list is worked out once per change of data, not once per drawing.
//   node tests/test_hq_cockpit.js [--vault [dir]]        exit 0 = pass
const assert = require("assert"), cdp = require("./cdp"), env = require("./env"), { VGRules } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// threads
const P = [{ path: "a.md", title: "Service Alarm Webhooks", name: "Scope" }, { path: "b.md", title: "Sticker Audit Page" }, { path: "c.md", title: "Scope of Work One" }, { path: "d.md", title: "Scope of Work Two" }, { path: "e.md", title: "Scope of Work Three" }];
const T = VGRules.hqThreads([{ key: "1", title: "Test the service alarm on the console" }, { key: "2", text: "Check [[Sticker Audit Page]] totals" }, { key: "3", title: "Buy milk" }, { key: "4", title: "Finish the scope of work" }], P);
assert.strictEqual((T.find(t => t.project && t.project.path === "a.md") || { items: [] }).items[0].key, "1", "words didn't find the thread");
assert.strictEqual((T.find(t => t.project && t.project.path === "b.md") || { items: [] }).items[0].key, "2", "a link didn't find the thread");
assert.deepStrictEqual(T[T.length - 1].items.map(i => i.key).sort(), ["3", "4"], "work that fits nowhere (or only shares common words) should stay out of threads");
assert.strictEqual(T[T.length - 1].project, null);
assert.strictEqual(VGRules.hqThreads([{ key: "1", title: "Test the service alarm on the console" }], [{ path: "a.md", title: "Service Alarm Webhooks", group: "closed" }])[0].project, null, "open work joined a closed project");
assert.strictEqual(VGRules.hqThreads([{ key: "1", title: "Update bills to use the credit card" }], [{ path: "a.md", title: "Hamachi Network Password + Kiosk Software Update", group: "active" }])[0].project, null, "one shared word of a long title made a thread");
assert.strictEqual(VGRules.hqThreads([{ key: "1", title: "Update the console's packages" }, { key: "2", title: "Run the sticker fix on the console database" }], [{ path: "a.md", title: "Fix Dispatch Console Out-of-Memory Crashes", group: "active" }])[0].project, null, "the name of a system made a thread");
const AREA = VGRules.hqThreads([{ key: "1", title: "Update the Console's packages" }, { key: "2", title: "Fix the Odoo console login" }, { key: "3", title: "Pay the bills" }, { key: "4", title: "Consoles are down" }], [], { Dispatch: ["console"], Odoo: ["odoo console"] });
assert.deepStrictEqual(AREA.map(t => [t.title, t.items.length]), [["Dispatch", 2], ["Odoo", 1], ["Everything else", 1]], "work with no project should group by the area it names, longest phrase first");
assert.strictEqual(VGRules.plainSnippet("> **SES lists** are [[Note|case]] `sensitive` | ▼ x"), "SES lists are case sensitive x", "a preview shows markup");
// the brief says only what's true
const brief = VGRules.hqBrief({ hq: { journals: [{ path: "j", tasks: [{ mark: "x", text: "A ✅ 2026-10-27" }] }] } }, [{ kind: "approval", key: "a", title: "x" }], {}, "2026-10-28", []);
assert(brief.some(s => s.startsWith("1 done yesterday")), "brief: " + brief); assert(brief.some(s => s.includes("1 approval")), "brief: " + brief);
assert.deepStrictEqual(VGRules.hqBrief({}, [], {}, "2026-10-28", []), [], "an empty vault should have no brief, not invented sentences");

(async () => {
  const tab = await cdp.open({ html: env.hqPage(""), port: 9362 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    const mount = (data = "DATA") => tab.ev(`(() => { window.__calls = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), ${data}, { now: new Date("2026-10-28T12:00:00"), ask: async () => true, openGraph: () => window.__calls.push(["graph"]),
      api: { capture: async (t, k) => window.__calls.push(["capture", t, k]), hqMark: async () => {}, hqFocus: async () => {}, hqHome: async h => window.__calls.push(["home", h]), openNote: p => window.__calls.push(["open", p]), openDaily: async d => window.__calls.push(["daily", d]), openStandup: async d => window.__calls.push(["standup", d]), setTaskStatus: async () => {}, logWork: async () => false,
        searchNotes: async q => [{ path: "Old fix.md", heading: "How it was solved", snippet: "We did this before" }], searchMeaning: async q => [{ path: "Close in meaning.md", heading: "" }] } }); })()`);
    await mount(); await sleep(120);
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await tab.ev(`window.vaultHQ.setScreen("today")`); await sleep(120);
    // the rail
    check(await tab.ev(`!!document.querySelector(".vg-hq-rail")`), "no rail on a wide pane");
    await sleep(60); check(await tab.ev(`/How it was solved|Old fix/.test(document.querySelector(".vg-hq-rail").textContent)`), "the rail doesn't show what the notes know");
    const rows = await tab.ev(`[...document.querySelectorAll(".vg-hq-col .vg-hq-sec .vg-hq-item[data-key]")].slice(0, 2).map(r => r.dataset.key)`);
    if (rows.length > 1) { const before = await tab.ev(`(window.__row = document.querySelector(".vg-hq-col .vg-hq-sec .vg-hq-item[data-key]"), 1)`);
      await tab.ev(`document.querySelectorAll(".vg-hq-col .vg-hq-sec .vg-hq-item[data-key] .vg-hq-txt")[1].click()`); await sleep(40);
      const title = await tab.ev(`window.vaultHQ.items().find(i => i.key === ${JSON.stringify(rows[1])}).title`);
      check((await tab.ev(`document.querySelector(".vg-hq-railtitle").textContent`)) === title, "selecting a row didn't change the rail");
      check(await tab.ev(`window.__row.isConnected`), "selecting rebuilt the list instead of just the rail"); }
    // the palette
    const press = (k, o = "") => tab.ev(`(document.activeElement && document.querySelector(".vg-hq").contains(document.activeElement) ? document.activeElement : document.querySelector(".vg-hq")).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, ${o} }))`);
    await press("k", "ctrlKey: true"); await sleep(30); check(await tab.ev(`!!document.querySelector(".vg-hq-palette") && document.activeElement === document.querySelector(".vg-hq-palinput")`), "Ctrl K didn't open the palette");
    const type = v => tab.ev(`(() => { const i = document.querySelector(".vg-hq-palinput"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await type("wrap"); await sleep(20); check(await tab.ev(`document.querySelector(".vg-hq-palrow.is-at").textContent.includes("Wrap up")`), "typing didn't find the command");
    await press("Enter"); await sleep(40); check(await tab.ev("window.vaultHQ.screen()") === "wrap", "Enter didn't run the command"); check(await tab.ev(`!document.querySelector(".vg-hq-palette")`), "the palette stayed open");
    await press("k", "ctrlKey: true"); await sleep(20); await type("zzq"); await sleep(10); check(await tab.ev(`document.querySelector(".vg-hq-palrow.is-at").textContent.includes("Add task")`), "with nothing found, adding should be what Enter does");
    await type("today"); await sleep(10); check(await tab.ev(`!document.querySelector(".vg-hq-palrow.is-at").textContent.includes("Add task")`), "Enter would add a task instead of finding: finding comes first");
    await type("call the vendor"); await sleep(250);
    check(await tab.ev(`[...document.querySelectorAll(".vg-hq-palrow")].some(r => r.textContent.includes("Add task: call the vendor"))`), "the palette doesn't offer to add it");
    check(await tab.ev(`document.querySelector(".vg-hq-palrows").textContent.includes("Old fix") && document.querySelector(".vg-hq-palrows").textContent.includes("Close in meaning")`), "the palette doesn't show notes and meaning");
    await tab.ev(`[...document.querySelectorAll(".vg-hq-palrow")].find(r => r.textContent.includes("Add task")).click()`); await sleep(30);
    check((await tab.ev("window.__calls")).some(c => c[0] === "capture" && c[1] === "call the vendor" && c[2] === "task"), "the palette's Add task didn't capture");
    await press("k", "ctrlKey: true"); await sleep(20); await press("Escape"); check(await tab.ev(`!document.querySelector(".vg-hq-palette")`), "Esc didn't close the palette");
    // Home's parts turn off and stay off; the key sheet opens and closes; a brand-new vault gets a welcome, not zeroes
    await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(30);
    const parts = await tab.ev(`(() => { const had = !!document.querySelector(".vg-hq-customizebtn"); return had; })()`);
    await press("?"); await sleep(20); check(await tab.ev(`!!document.querySelector(".vg-hq-keys")`), "? doesn't open the key sheet"); await press("Escape"); check(await tab.ev(`!document.querySelector(".vg-hq-keys")`), "Esc doesn't close the key sheet");
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), { nodes: [], links: [], hq: { journals: [], standups: [], projects: [], backlog: [], reports: [], reviews: [], decisions: [], runs: {}, runlog: [], inbox: [] } }, { now: new Date("2026-10-28T12:00:00"), api: { capture: async () => {}, openDaily: async () => {} } }); })()`); await sleep(30);
    check(await tab.ev(`/Welcome/.test(document.querySelector(".vg-hq-main").textContent) && !!document.querySelector(".vg-hq-captureinput")`), "a new vault gets no welcome");
    await mount(); await sleep(60); await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(30);
    // every screen draws and goes somewhere
    for (const s of ["home", "today", "needs", "people", "projects", "threads", "wrap", "review", "automations"]) { await tab.ev(`window.vaultHQ.setScreen(${JSON.stringify(s)})`); await sleep(25);
      check(await tab.ev(`document.querySelectorAll(".vg-hq-main button").length > 0`), `${s} is a dead end`); check(await tab.ev(`window.vaultHQ.screen()`) === s, `${s} didn't open`); }
    await tab.ev(`window.vaultHQ.setScreen("review")`); check(await tab.ev(`document.querySelectorAll(".vg-hq-reviewstep").length`) === 5, "the review isn't five steps");
    await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(20); await tab.ev(`document.querySelector("[data-customize]").click()`); await sleep(20); await tab.ev(`document.querySelector('[data-homepart="brief"]').click()`); await sleep(20);
    check((await tab.ev("window.__calls")).some(c => c[0] === "home" && c[1].includes("brief")), "Customize doesn't save"); check(await tab.ev(`!document.querySelector(".vg-hq-brief")`), "turning the brief off didn't hide it"); await tab.ev(`document.querySelector('[data-homepart="brief"]').click()`); await sleep(20);
    // phone width: no rail, the same work inline
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true }); await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(60); await tab.ev(`window.vaultHQ.setScreen("today")`); await sleep(60);
    check(await tab.ev(`!document.querySelector(".vg-hq-rail") && !!document.querySelector(".vg-hq-ctxbtn")`), "phone width should use the inline context");
    check(await tab.ev(`document.documentElement.scrollWidth <= innerWidth + 1`), "the page scrolls sideways on a phone");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    // ---- scale: 20,000 notes, 3,000 open tasks over the carry window, 600 projects
    await tab.ev(`(() => { const d = JSON.parse(JSON.stringify(DATA)); const day = "2026-10-2"; d.nodes = Array.from({ length: 20000 }, (_, i) => ({ id: "n/" + i + ".md", name: "Note " + i, cluster: i % 40, bc: i % 97, words: 500, age: i % 400, inlinks: i % 9, outlinks: i % 7, born: "2025-0" + (1 + i % 9) + "-1" + (i % 9), tags: [], folder: "n" }));
      d.links = []; d.mocs = []; d.clusters = Array.from({ length: 40 }, (_, i) => ({ id: i, name: "Topic " + i, size: 500 }));
      d.hq.journals = Array.from({ length: 30 }, (_, i) => ({ path: VGRules.folders.daily + "/2026/10-October/Journal/2026-10-" + String(i % 28 + 1).padStart(2, "0") + ".md", date: "2026-10-" + String(i % 28 + 1).padStart(2, "0"), tasks: Array.from({ length: 100 }, (_, j) => ({ line: j, mark: " ", text: "Task " + i + " " + j + " about service number " + j, section: "" })) }));
      d.hq.projects = Array.from({ length: 600 }, (_, i) => ({ path: "P/" + i + ".md", name: "P" + i, title: "Project " + i + " alpha" + i, kind: "Scope", status: "in-progress", group: "active", tasks: [], decisions: [], days: [], summary: "" }));
      window.__big = d; })()`);
    await mount("window.__big"); await sleep(120);
    const timed = await tab.ev(`(async () => { const out = {}; for (const s of ["home", "today", "needs", "people", "projects", "threads", "review"]) { const t = performance.now(); window.vaultHQ.setScreen(s); out[s] = Math.round(performance.now() - t); await new Promise(r => setTimeout(r, 10)); } const t = performance.now(); for (let i = 0; i < 6; i++) window.vaultHQ.setScreen(i % 2 ? "today" : "wrap"); out.again = Math.round((performance.now() - t) / 6); out.items = window.vaultHQ.items().length; out.rows = document.querySelectorAll(".vg-hq-item").length; const box = document.querySelector(".vg-hq-global-search"); box.focus(); const k = performance.now(); box.value = "ab"; box.dispatchEvent(new Event("input", { bubbles: true })); box.value = "abc"; box.dispatchEvent(new Event("input", { bubbles: true })); out.key = Math.round(performance.now() - k); const s = performance.now(); await new Promise(r => setTimeout(r, 200)); out.results = Math.round(performance.now() - s - 200); box.value = ""; box.dispatchEvent(new Event("input", { bubbles: true })); return out; })()`);
    console.log("  hq at 20,000 notes:", JSON.stringify(timed));
    const worst = Math.max(...["home", "today", "needs", "people", "projects", "threads", "review"].map(k => timed[k]));
    check(worst < 1500, `a screen took ${worst} ms on a big vault`); check(timed.again < 120, `redrawing takes ${timed.again} ms: the list isn't being kept`);
    check(timed.items > 2000, `only ${timed.items} items: the big vault isn't big`); check(timed.rows < 400, `${timed.rows} rows in the page: long lists aren't paged`); check(timed.key < 40, `typing took ${timed.key} ms a keystroke`);
    const errs = await tab.ev("typeof __errs === 'undefined' ? [] : __errs"); check(!errs.length, "errors: " + errs);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - cockpit:\n    " + fails.join("\n    ") : "ok - cockpit: rail, palette, threads, brief, review, phone width, and 20,000 notes");
  process.exit(fails.length ? 1 : 0);
})();
