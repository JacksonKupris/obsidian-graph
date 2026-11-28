#!/usr/bin/env node
// Edit colours is offered on every screen with every theme, not only Custom. On a preset it opens with that theme's own colours,
// Cancel leaves the theme alone, Save turns it into a Custom set. Reported by Jackson 2026-11-24 ("only on the home page").
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const theme of ["obsidian", "midnight", "paper", "forest", "dusk"]) {
      await tab.ev(`(() => { window.__pal = null; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {}, palette: ${JSON.stringify(theme)}, onPalette: k => { window.__pal = k; } }); })()`);
      await sleep(300);
      for (const s of ["home", "needs", "projects"]) {
        await tab.ev(`window.vaultHQ.setScreen("${s}")`); await sleep(200);
        check(await tab.ev(`!!document.querySelector("[data-editcolors]")`), `${theme}: Edit colours on ${s}`);
      }
      await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(300);
      const shown = await tab.ev(`[...document.querySelectorAll("[data-colour]")].map(x => x.value)`);
      const live = await tab.ev(`(() => { const s = getComputedStyle(document.querySelector(".vg-hq")); const c = document.createElement("canvas").getContext("2d"); return ["--background-primary", "--text-normal"].map(v => { c.fillStyle = "#000"; c.fillStyle = s.getPropertyValue(v).trim(); return c.fillStyle; }); })()`);
      check(shown.length === 8 && shown[0] === live[0] && shown[2] === live[1], `${theme}: the editor opens with the theme's own page and text colours: ${shown[0]} ${shown[2]} vs ${live}`);
      await tab.ev(`document.querySelector("[data-colour-cancel]").click()`); await sleep(200);
      check(await tab.ev(`window.__pal === null || window.__pal === ${JSON.stringify(theme)}`), `${theme}: Cancel leaves the theme alone, got ${await tab.ev("window.__pal")}`);
      await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(300);
      // a theme with a pairing under 4.5:1 keeps Save off until the person fixes it (Suggest does)
      if (await tab.ev(`document.querySelector("[data-colour-save]").disabled`)) { await tab.ev(`document.querySelector("[data-colour-suggest]").click()`); await sleep(200); }
      await tab.ev(`document.querySelector("[data-colour-save]").click()`); await sleep(300);
      check(/^custom:#/.test(await tab.ev(`window.__pal || ""`)), `${theme}: Save turns it into a custom set: ${await tab.ev("window.__pal")}`);
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Edit colours works from every theme");
})();
