#!/usr/bin/env node
// A home count tile opens the list it counts, scrolled to it: "N unlinked notes" lands on the Islands section (N rows), not on
// "Named, never linked" at the top of Blind spots, whose count is a different number. The persona run read 2 on the tile and 20 on the first heading.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
    const tile = await tab.ev(`(() => { const b = document.querySelector('[data-stat="unlinked"]'); if (!b) return null; const n = +((b.innerText.match(/\\d+/) || [])[0]); b.click(); return n; })()`);
    check(tile !== null && !Number.isNaN(tile), "the unlinked tile must exist and show a number: " + tile);
    await sleep(600);
    const r = await tab.ev(`(() => { const body = document.querySelector(".vg-lens-body"); if (!body) return null;
      const B = body.getBoundingClientRect(), secs = [...body.querySelectorAll(".ds-section")].map(s => { const h = s.querySelector("h4"), r = s.getBoundingClientRect();
        return { title: h.firstChild.textContent.trim(), count: +((h.textContent.match(/(\\d+)\\s*$/) || [])[1]), top: Math.round(r.top - B.top), bottom: Math.round(r.bottom - B.top) }; });
      const landed = body.querySelector(".ds-section.is-landed"), L = secs.find(s => landed && s.title === landed.dataset.sec);
      return { landed: L, secs: secs.map(s => s.title), view: B.height }; })()`);
    check(r && r.landed, "the list must open on a marked section: " + JSON.stringify(r));
    if (r && r.landed) {
      check(r.landed.title === "Islands", `the tile counts ${tile} unlinked notes but the list lands on "${r.landed.title}" (${r.landed.count})`);
      check(r.landed.count === tile, `the tile says ${tile}, the section it lands on says ${r.landed.count}`);
      check(r.landed.top >= 0 && r.landed.top < r.view, `the section must be on screen: top ${r.landed.top} in a list ${r.view} tall`);
    }
  } finally { await tab.close(); }
  finish(fails, "a count tile lands on the list it counts");
})();
