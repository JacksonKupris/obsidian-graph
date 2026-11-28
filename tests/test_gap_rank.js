#!/usr/bin/env node
// "Biggest gap" is one ranking everywhere (the analysis's own order), and the screens say what ranks it.
// Found by the 3D persona round (0.6.229): the banner's biggest gap named 7 daily notes while another listed gap named 8, with no word on why.
// The matrix lens used to re-rank with its own formula, so its first gap could differ from the banner's.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`${D}.openView("2d")`); await sleep(800);
    const banner = await tab.ev(`(document.querySelector(".vg-today-text") || {}).textContent || ""`);
    const m = /Biggest gap: (.+? ↔ .+?) · named /.exec(banner);
    check(!!m, "the 2D banner names the biggest gap (the check can't fail without one): " + banner);
    check(/Ranked by/.test(await tab.ev(`(document.querySelector(".vg-today-text") || {}).title || ""`)), "the banner's hover says what ranks the gap");
    await tab.ev(`${D}.openView("lens:matrix")`); await sleep(600);
    const first = await tab.ev(`(document.querySelector(".vg-lens-body .vg-gaprow .vg-item-main span") || {}).textContent || ""`);
    check(m && first === m[1], `the matrix lists the banner's gap first: banner "${m && m[1]}", matrix "${first}"`);
    const sec = await tab.ev(`[...document.querySelectorAll(".vg-lens-body")].map(x => x.textContent).join(" ")`);
    check(/Ranked by/.test(sec), "the matrix's Biggest gaps says what ranks them");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the biggest gap is the same everywhere and says what ranks it");
})();
