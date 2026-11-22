#!/usr/bin/env node
// Escape closes an open dialog even when focus has left it (found by the random walk 2026-11-22: eight Escapes left a confirm dialog open).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const key = k => ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
    await key("?"); await sleep(300);
    check(await ev(`!!document.querySelector(".vg-confirm")`), "? opens a dialog (the check can't fail without one)");
    await ev(`document.activeElement.blur(); document.querySelector(".vg-root").focus()`);
    check(await ev(`!document.querySelector(".vg-confirm").contains(document.activeElement)`), "focus is outside the dialog");
    await key("Escape"); await sleep(200);
    check(await ev(`!document.querySelector(".vg-confirm")`), "Escape closes the dialog although focus is outside it");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Escape closes a dialog wherever focus is");
})();
