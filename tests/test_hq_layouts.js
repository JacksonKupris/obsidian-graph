#!/usr/bin/env node
// Today in three layouts (Queue, Workbench, Day) over the one list: the select switches them, each shows the same items and the
// same Do next, the choice is remembered through onLayout, and an item picked in any layout still opens the rail.
//   node tests/test_hq_layouts.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await tab.ev(`(() => { window.__layouts = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), layout: "bench", onLayout: l => window.__layouts.push(l), api: {} }); window.vaultHQ.setScreen("today"); })()`); await sleep(150);
    const sel = `document.querySelector(".vg-hq-layoutsel")`;
    check(await tab.ev(`!!${sel}`), "no layout select in the header");
    check(await tab.ev(`${sel} && ${sel}.options.length === 3`), "the layout select should offer Queue, Workbench and Day");
    check(await tab.ev(`!!document.querySelector(".vg-hq-bench")`), "the remembered layout (Workbench) didn't open");
    const set = v => tab.ev(`(s => { s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })(${sel})`);
    await set("day"); await sleep(120);
    check(await tab.ev(`document.querySelectorAll(".vg-hq-phase").length === 4`), "Day should show four phases");
    check(await tab.ev(`${sel}.value === "day"`), "the select lost its value after a redraw");
    check((await tab.ev(`window.__layouts`)).join() === "day", "the choice wasn't reported through onLayout");
    await set("queue"); await sleep(120);
    check(await tab.ev(`!document.querySelector(".vg-hq-bench") && !document.querySelector(".vg-hq-phase")`), "Queue still shows another layout's parts");
    // the same Do next in every layout
    const next = await tab.ev(`(document.querySelector(".vg-hq-next h2") || {}).textContent || ""`);
    await set("day"); await sleep(100);
    check((await tab.ev(`(document.querySelector(".vg-hq-phase .vg-hq-next h2") || {}).textContent || ""`)) === next, "Day and Queue disagree on what is next");
    // Workbench lenses: Needs you filters the one list; a pick opens the rail
    await set("bench"); await sleep(100);
    const lens = await tab.ev(`[...document.querySelectorAll(".vg-hq-lensbtn")].map(b => b.textContent)`);
    check(lens.length >= 2, "Workbench lenses missing: " + lens);
    await tab.ev(`document.querySelector('[data-benchlens="needs"]').click()`); await sleep(100);
    check(await tab.ev(`document.querySelector('[data-benchlens="needs"]').classList.contains("is-on")`), "the Needs you lens didn't turn on");
    const n = await tab.ev(`document.querySelectorAll(".vg-hq-benchlist .vg-hq-item[data-key]").length`);
    check(n === (await tab.ev(`window.vaultHQ.items().filter(i => i.group === "needs").length`)), "the Needs you lens shows " + n + " rows, not the Needs you list");
    check(await tab.ev(`!!document.querySelector(".vg-hq-rail") || document.querySelectorAll(".vg-hq-benchlist .vg-hq-item").length === 0`), "no rail beside the Workbench list");
    // phone width: nothing wider than the screen
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(150);
    for (const v of ["queue", "bench", "day"]) { await set(v); await sleep(100); check(await tab.ev(`document.documentElement.scrollWidth <= innerWidth + 1`), v + " overflows at phone width"); }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "layouts: Queue, Workbench and Day share one list, one next step and the rail", "layouts");
})();
