#!/usr/bin/env node
// On a phone every HQ screen opens with the same slim bar (the screen's name, a search button and a menu button) and nothing above the
// content is hidden by script while scrolling: the week strip and the Next line scroll away with the content, so scrolling never
// changes the page height (it used to snap the list down when the header folded). The big count chips are not drawn on a phone;
// the bottom bar already carries those counts. Found by Jackson's phone screenshots: half the screen was header and it differed per page.
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    const screen = s => tools(tab, { wait: 150 }).screen(s);
    const bars = {};
    for (const s of ["home", "today", "needs", "projects", "people", "calendar"]) {
      await screen(s);
      const m = await tab.ev(`(() => { const q = x => document.querySelector(x), r = e => e ? e.getBoundingClientRect() : null, top = r(q(".vg-hq-top")), main = q(".vg-hq-main");
        const sr = r(q('.vg-hq-top [data-tray="search"]')), mr = r(q('.vg-hq-top [data-tray="menu"]'));
        return { h: top && top.height, search: sr && Math.round(sr.left), menu: mr && Math.round(mr.left),
          stripIn: !!q(".vg-hq-strip") && !!q(".vg-hq-strip").closest(".vg-hq-main"), nextIn: ${JSON.stringify(s)} === "home" || !q(".vg-hq-nextchip") || !!q(".vg-hq-nextchip").closest(".vg-hq-main"),
          chips: !!q(".vg-hq-chips") && getComputedStyle(q(".vg-hq-chips")).display !== "none", trayShown: !!q(".vg-hq-tray") && getComputedStyle(q(".vg-hq-tray")).display !== "none" }; })()`);
      bars[s] = m;
      check(m.h && m.h <= 60, `${s}: the top bar is one slim row (height ${m.h})`);
      check(m.search !== null && m.menu !== null, `${s}: the bar has a search button and a menu button`);
      check(m.stripIn, `${s}: the week strip scrolls with the content`);
      check(m.nextIn, `${s}: the Next line scrolls with the content`);
      check(!m.chips, `${s}: the count chips are not drawn on a phone`);
      check(!m.trayShown, `${s}: the search, layout and theme controls wait behind the buttons`);
    }
    const first = bars.home;
    for (const s of Object.keys(bars)) check(bars[s].search === first.search && bars[s].menu === first.menu, `${s}: the bar's buttons sit where they do on every other screen`);
    await screen("needs");
    const before = await tab.ev(`document.querySelector(".vg-hq-top").getBoundingClientRect().height`);
    await tab.ev(`document.querySelector(".vg-hq-main").scrollTop = 400`); await sleep(300);
    const after = await tab.ev(`(() => ({ h: document.querySelector(".vg-hq-top").getBoundingClientRect().height, folded: document.querySelector(".vg-hq").classList.contains("is-scrolled"), st: document.querySelector(".vg-hq-main").scrollTop }))()`);
    check(after.h === before && !after.folded, `scrolling must not fold or resize the bar (${before} -> ${after.h})`);
    check(after.st >= 390, `the list stays where it was scrolled to (${after.st})`);
    await tab.ev(`document.querySelector('.vg-hq-top [data-tray="menu"]').click()`); await sleep(150);
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq-tray")).display !== "none" && !!document.querySelector(".vg-hq-tray select, .vg-hq-tray .vg-hq-select")`), "the menu button shows the layout and theme controls");
    await tab.ev(`document.querySelector('.vg-hq-top [data-tray="search"]').click()`); await sleep(150);
    check(await tab.ev(`document.activeElement && document.activeElement.classList.contains("vg-hq-global-search")`), "the search button puts the cursor in the search box");
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "phone header is one slim bar and nothing folds on scroll", "hq phone header");
})();
