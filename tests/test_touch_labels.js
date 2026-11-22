#!/usr/bin/env node
// On a phone, the tappable labels on the 3D scenes are 24 px tall: their tap area is grown to 40 px without changing how they look (persona round 3, phone).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await ev(`window.vaultGraph._debug.openView("reactor")`); await sleep(1500);
    const r = await ev(`(() => { const bs = [...document.querySelectorAll(".vgv-labels button")].filter(b => b.getBoundingClientRect().height > 0);
      if (!bs.length) return null;
      return bs.map(b => { const a = getComputedStyle(b, "::after"), box = b.getBoundingClientRect(); return Math.round(box.height + Math.abs(parseFloat(a.top) || 0) * 0 + (a.content !== "none" ? parseFloat(a.height) || 0 : 0)); }); })()`);
    check(r && r.length > 0, "the reactor has tappable labels to measure");
    check(r && r.every(h => h >= 40), "each label's tap area should reach 40 px (got " + JSON.stringify(r && [...new Set(r)]) + ")");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Scene labels have a 40 px tap area on a phone");
})();
