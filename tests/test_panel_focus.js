#!/usr/bin/env node
// Choosing a note in search moves focus into its panel; Escape closes the panel and focus goes back to the graph (persona round 3, keyboard).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  const key = k => ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await key("/"); await sleep(300);
    await ev(`(() => { const q = document.querySelector(".vg-pq"); q.value = "a"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(400);
    await ev(`document.querySelector(".vg-pitem").click()`); await sleep(800);
    check(await ev(`!document.querySelector(".vg-inspector").hidden`), "choosing a note opens its panel");
    check(await ev(`document.querySelector(".vg-inspector").contains(document.activeElement)`), "focus should be inside the note panel (it is on " + await ev(`document.activeElement && (document.activeElement.className || document.activeElement.tagName)`) + ")");
    await key("Escape"); await sleep(500);
    check(await ev(`document.activeElement && (document.activeElement.classList.contains("vg-cv") || document.activeElement.classList.contains("vg-root"))`), "after closing, focus goes back to the graph (on " + await ev(`document.activeElement && (document.activeElement.className || document.activeElement.tagName)`) + ", inspector hidden=" + await ev(`document.querySelector(".vg-inspector").hidden`) + ")");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Focus follows the note panel in and out");
})();
