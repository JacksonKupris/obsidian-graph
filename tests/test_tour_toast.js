#!/usr/bin/env node
// While the first-run tour is showing, explanatory toasts stay quiet: they sat on top of the tour card (persona round 3, design).
// Results and warnings still show.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const up = await tab.waitFor(`document.querySelector(".vg-tour, .vg-tour-card") ? 1 : 0`, 8000);
    check(!!up, "the tour starts on an untouched page (the check can't fail without it)");
    await ev(`${D}.toast("Biggest gap: shown as a hint")`); await sleep(300);
    check(await ev(`!document.querySelector(".vg-toast")`), "an explanatory toast stays quiet while the tour shows");
    await ev(`${D}.toast("Something went wrong", "warn")`); await sleep(300);
    check(await ev(`!!document.querySelector(".vg-toast.is-warn")`), "a warning still shows during the tour");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Toasts stay out of the tour's way");
})();
