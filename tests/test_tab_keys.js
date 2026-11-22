#!/usr/bin/env node
// With a note selected, Tab steps to the next linked note only while the graph itself has focus. On any button or link
// (the note panel, the side panel) Tab keeps its normal meaning, or a keyboard user can't reach those controls (persona round 3).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await ev(`(() => { const s = ${D}.st, n = ${D}.attention ? null : null; const id = (document.querySelector(".vg-side [data-id]") || {}).dataset.id; ${D}.st.selected = id; window.__sel = id; })()`);
    const press = target => ev(`(() => { const t = ${target}; if (!t) return "missing"; const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); t.dispatchEvent(e); return e.defaultPrevented; })()`);
    check(await ev(`!!${D}.st.selected`), "a note should be selected to start");
    check(await press(`document.querySelector(".vg-side button")`) === false, "Tab on a panel button should keep its normal meaning");
    check(await press(`document.querySelector(".vg-toolbar button")`) === false, "Tab on a toolbar button should keep its normal meaning");
    check(await press(`document.querySelector("canvas.vg-canvas, .vg-root canvas")`) === true, "Tab on the graph should still step to the next linked note");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Tab steps through linked notes only from the graph");
})();
