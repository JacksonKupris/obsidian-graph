#!/usr/bin/env node
// The week strip's two kinds of dot (journal, standup) are named on the screen, not only in a hover title, at desktop and phone width.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const [w, h] of [[1280, 800], [390, 844], [320, 640]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("home"); })()`);
      await sleep(300);
      const r = await tab.ev(`(() => { const l = document.querySelector(".vg-hq-weeklegend"); if (!l) return null; const b = l.getBoundingClientRect(); return { text: l.innerText.trim(), shown: b.width > 0 && b.height > 0, cut: l.scrollWidth > l.clientWidth + 1, right: b.right, vw: innerWidth }; })()`);
      check(!!r, `${w}px: the week strip has a legend`);
      if (!r) continue;
      check(/journal/i.test(r.text) && /standup/i.test(r.text), `${w}px: the legend names both dots: "${r.text}"`);
      check(r.shown && !r.cut && r.right <= r.vw, `${w}px: the legend is visible and not cut off`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the week strip names its dots", "week legend");
})();
