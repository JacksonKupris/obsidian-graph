#!/usr/bin/env node
// On a phone a screen's name shows once. The top bar already says "Today" (or People, Threads...), so the page heading with the same
// words is kept for screen readers but not shown a second time. A heading that says something different stays visible.
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    const t = tools(tab, { wait: 150 });
    for (const s of ["today", "people", "threads", "calendar", "projects"]) {
      await t.screen(s);
      const r = await tab.ev(`(() => { const bar = (document.querySelector(".vg-hq-top .vg-hq-crumb b") || {}).innerText || "", hs = [...document.querySelectorAll(".vg-hq h1.vg-hq-h1")]; const shown = hs.filter(h => !h.classList.contains("vg-hq-sr") && h.innerText.trim() === bar.trim()); return { bar, h1s: hs.length, dup: shown.length }; })()`);
      check(r.bar && r.h1s >= 1, s + ": the bar names the screen and a page heading exists for screen readers (" + JSON.stringify(r) + ")");
      check(r.dup === 0, s + ": the name \"" + r.bar + "\" is not shown twice");
    }
    await t.screen("home");
    check(await tab.ev(`!!document.querySelector(".vg-hq h1.vg-hq-h1:not(.vg-hq-sr)")`), "a heading that says something different (the Home greeting) stays visible");
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "a screen's name is shown once on a phone", "title once");
})();
