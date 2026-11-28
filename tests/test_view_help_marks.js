#!/usr/bin/env node
// "How to read this" in 3D names every mark the legend can show: rings, hexagons, diamonds and dashed notes (3D persona round, 0.6.229:
// the card explained moving and size but not the marks a person sees on the notes).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelectorAll(".vg-tour").forEach(e => e.remove())`);
    await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(900);
    check(await tab.ev(`!document.querySelector(".vg-viewhelp").hidden`), "3D has a How to read this button (the check can't pass without it)");
    await tab.ev(`document.querySelector(".vg-viewhelp").click()`); await sleep(200);
    const text = await tab.ev(`document.querySelector(".vg-viewcard").textContent`);
    for (const w of ["Ring", "Hexagon", "Diamond", "Dashed"]) check(text.includes(w), `the card explains: ${w}`);
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "How to read this explains the marks");
})();
