#!/usr/bin/env node
// The phone's bottom bar says what each button is. A bare "7" on an inbox icon read as nothing to two personas (round 4):
// every button carries a visible word that fits inside it, and the Needs you button says what its badge counts.
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const w of [360, 390]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
      await tools(tab, { wait: 150 }).screen("today");
      const r = await tab.ev(`(() => { const dock = document.querySelector(".vg-hq-dock"), dr = dock.getBoundingClientRect();
        return { inside: dr.left >= 0 && dr.right <= innerWidth, btns: [...dock.querySelectorAll(".vg-hq-dockbtn")].map(b => { const l = b.querySelector(".vg-hq-docklabel"), br = b.getBoundingClientRect(), lr = l && l.getBoundingClientRect();
          return { aria: b.getAttribute("aria-label"), text: l ? l.textContent.trim() : "", fits: !!l && l.scrollWidth <= b.clientWidth && lr.left >= br.left - 0.5 && lr.right <= br.right + 0.5 && lr.height > 0 }; }) }; })()`);
      check(r.btns.length >= 6, w + "px: the bar has its buttons");
      check(r.inside, w + "px: the bar fits the screen");
      for (const b of r.btns) { check(b.text, `${w}px: "${b.aria}" shows a word`); check(b.fits, `${w}px: "${b.text}" fits inside its button`); }
      const needs = await tab.ev(`(() => { const b = document.querySelector('.vg-hq-dockbtn[data-go="needs"]'); const g = b.querySelector(".vg-hq-badge"); return { label: b.querySelector(".vg-hq-docklabel") && b.querySelector(".vg-hq-docklabel").textContent.trim(), badge: g ? g.textContent.trim() : null }; })()`);
      check(needs.badge, w + "px: the sample has something waiting, so the badge shows");
      check(/needs/i.test(needs.label || ""), w + `px: the badge sits on a button that says what it counts ("${needs.label}")`);
    }
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "every bottom-bar button on a phone shows a word that fits", "hq dock labels");
})();
