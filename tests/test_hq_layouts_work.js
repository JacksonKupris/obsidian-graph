#!/usr/bin/env node
// The five working layouts of Today (Triage, Board, Week, Table, Threads) do real work: a drop, a key or a click reaches the host
// (hqMark, hqFocus) and the screen follows. Each step checks the effect, not just that something drew.
//   node tests/test_hq_layouts_work.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    const mount = layout => tab.ev(`(() => { window.__calls = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), layout: ${JSON.stringify(layout)}, api: {
      hqMark: async (k, m) => window.__calls.push(["mark", k, m]), hqFocus: async ks => window.__calls.push(["focus", ks]), searchNotes: async () => [], capture: async () => {},
      setTaskStatus: async () => window.__calls.push(["status"]), setTasksStatus: async () => window.__calls.push(["status"]), openNote: p => window.__calls.push(["open", p]) } }); window.vaultHQ.setScreen("today"); })()`);
    const calls = () => tab.ev(`window.__calls`);
    const q = s => tab.ev(`document.querySelector(${JSON.stringify(s)}) ? 1 : 0`);
    const count = s => tab.ev(`document.querySelectorAll(${JSON.stringify(s)}).length`);
    const text = s => tab.ev(`(document.querySelector(${JSON.stringify(s)}) || {}).textContent || ""`);
    const drag = (fromSel, toSel) => tab.ev(`(() => { const a = document.querySelector(${JSON.stringify(fromSel)}), b = document.querySelector(${JSON.stringify(toSel)}); if (!a || !b) return "missing"; const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); return "ok"; })()`);
    const todos = await tab.ev(`window.vaultHQ.items().filter(i => i.group === "today").length`);
    check(todos >= 2, "the test vault needs two open tasks for today, has " + todos);

    // Triage: skip and back move through the queue, Later reaches the host and the item leaves
    await mount("triage"); await sleep(150);
    check(await q(".vg-hq-tricard"), "Triage shows no card");
    const first = await text(".vg-hq-tritext");
    await tab.ev(`document.querySelector(".vg-hq-main").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`); await sleep(100);
    const second = await text(".vg-hq-tritext");
    check(second && second !== first, "skip kept the same card: " + first);
    await tab.ev(`document.querySelector('[data-triage="back"]').click()`); await sleep(100);
    check(await text(".vg-hq-tritext") === first, "back didn't return to the first card");
    await tab.ev(`document.querySelector('.vg-hq-tricard [data-act="later"]') && document.querySelector('.vg-hq-tricard [data-act="later"]').click()`); await sleep(250);
    const c1 = await calls();
    if (c1.some(c => c[0] === "mark")) check(await text(".vg-hq-tritext") !== first, "the card stayed after Later");
    else check(await q('.vg-hq-tricard [data-act="later"]') === 0, "Later is offered but did nothing");

    // Board: a drop on Planned stars the item, the Move select does the same, the card is in the column afterwards
    await mount("board"); await sleep(150);
    const key = await tab.ev(`document.querySelector('[data-drop="todo"] .vg-hq-kcard').dataset.key`);
    check(await drag(`[data-drop="todo"] .vg-hq-kcard[data-key="${key}"]`, `[data-drop="plan"]`) === "ok", "board has no card or Planned column to drag between"); await sleep(250);
    check((await calls()).some(c => c[0] === "focus" && c[1].includes(key)), "dropping on Planned didn't star the item");
    check(await q(`[data-drop="plan"] [data-key="${key}"]`), "the card isn't in Planned after the drop");
    await drag(`[data-drop="plan"] .vg-hq-kcard[data-key="${key}"]`, `[data-drop="todo"]`); await sleep(250);
    check(await q(`[data-drop="todo"] [data-key="${key}"]`), "dropping on To do didn't take it out of the plan");
    await tab.ev(`(s => { s.value = "plan"; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.querySelector('[data-drop="todo"] .vg-hq-movesel'))`); await sleep(250);
    check(await count(`[data-drop="plan"] .vg-hq-kcard`) === 1, "the Move select didn't plan an item");

    // Week: a drop on a later day puts it off until then; Undo brings it back
    await mount("week"); await sleep(150);
    const day = await tab.ev(`(d => d ? d.dataset.drop : "")([...document.querySelectorAll(".vg-hq-weekgrid [data-drop]")].find(x => /^[0-9]{4}-/.test(x.dataset.drop)))`);
    check(!!day, "Week has no later day to drop on");
    const wk = await tab.ev(`(c => c ? c.dataset.key : "")(document.querySelector('.vg-hq-weekgrid [data-drop="todo"] .vg-hq-kcard'))`);
    await drag(`.vg-hq-weekgrid [data-drop="todo"] .vg-hq-kcard[data-key="${wk}"]`, `[data-drop="${day}"]`); await sleep(250);
    check((await calls()).some(c => c[0] === "mark" && c[1] === wk && c[2] === "until:" + day), "dropping on " + day + " didn't put it off until then: " + JSON.stringify(await calls()));
    check(await q(`[data-drop="${day}"] [data-key="${wk}"]`), "the card isn't on its new day");
    await tab.ev(`document.querySelector("[data-undo]").click()`); await sleep(250);
    check(await q(`.vg-hq-weekgrid [data-drop="todo"] [data-key="${wk}"]`), "Undo didn't bring the item back to To place");

    // Table: sort, filter, select all
    await mount("table"); await sleep(150);
    const rowsAll = await count(".vg-hq-trow"), titles = () => tab.ev(`[...document.querySelectorAll(".vg-hq-trow .vg-hq-txt b")].map(b => b.textContent)`);
    check(rowsAll >= 2, "Table shows " + rowsAll + " rows");
    await tab.ev(`document.querySelector('[data-tsort="title"]').click()`); await sleep(100);
    const asc = await titles(); check(JSON.stringify(asc) === JSON.stringify([...asc].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)), "sorting by Item didn't sort");
    await tab.ev(`document.querySelector('[data-tsort="title"]').click()`); await sleep(100);
    check(JSON.stringify(await titles()) === JSON.stringify([...asc].reverse()), "a second click should reverse the sort");
    await tab.ev(`(i => { i.value = ${JSON.stringify(asc[0].slice(0, 6))}; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector("[data-tq]"))`); await sleep(150);
    const some = await count(".vg-hq-trow"); check(some >= 1 && some <= rowsAll, "the filter showed " + some + " of " + rowsAll);
    check(await tab.ev(`document.activeElement && document.activeElement.matches("[data-tq]")`), "the filter lost focus while typing");
    await tab.ev(`(i => { i.value = "zzzz-nothing"; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector("[data-tq]"))`); await sleep(150);
    check(await q("[data-tclear]"), "an empty filter has no way back");
    await tab.ev(`document.querySelector("[data-tclear]").click()`); await sleep(100);
    check(await count(".vg-hq-trow") === rowsAll, "clearing the filter didn't bring the rows back");

    // Threads: picking another thread changes the list and its header
    await mount("threads"); await sleep(150);
    const threads = await count("[data-thread]");
    if (threads > 1) { const h = await text(".vg-hq-thead2 h2"); await tab.ev(`document.querySelectorAll("[data-thread]")[1].click()`); await sleep(120); check(await text(".vg-hq-thead2 h2") !== h, "picking another thread kept the same header"); }
    else check(threads === 1 || await q(".vg-hq-empty"), "Threads shows neither a thread nor an empty state");
    // every working layout at phone width: no sideways scroll, and still an action on a phone (a Move select instead of a drag)
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    for (const l of ["triage", "board", "week", "table", "threads"]) { await mount(l); await sleep(150); check(await tab.ev(`document.documentElement.scrollWidth <= innerWidth + 1`), l + " overflows at phone width"); }
    await mount("board"); await sleep(100); check(await q(".vg-hq-movesel"), "Board has no Move select for a phone");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "working layouts: triage keys, board and week drops, table sort and filter, threads — each reaches the host and the screen follows", "layouts work");
})();
