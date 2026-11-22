#!/usr/bin/env node
// The shortcut sheet (and every confirm/form dialog) has a name and keeps Tab inside it (persona round 3, keyboard).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))`); await sleep(400);
    check(await ev(`!!document.querySelector(".vg-confirm-box")`), "? opens the shortcut sheet");
    check(await ev(`document.querySelector(".vg-confirm-box").getAttribute("aria-label") === "Keyboard shortcuts"`), "the dialog has the name Keyboard shortcuts");
    const kept = await ev(`(() => { const box = document.querySelector(".vg-confirm"), ok = box.querySelector('[data-c="ok"]'); ok.focus();
      const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); box.dispatchEvent(e); return e.defaultPrevented || box.contains(document.activeElement); })()`);
    check(kept, "Tab on the last button should stay inside the dialog");
    const stray = await ev(`(() => { const box = document.querySelector(".vg-confirm"); const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); box.querySelector('[data-c="ok"]').dispatchEvent(e); return e.defaultPrevented; })()`);
    check(stray, "Tab from the only button is held inside (default prevented)");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Dialogs are named and hold Tab");
})();
