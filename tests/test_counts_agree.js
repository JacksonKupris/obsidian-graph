#!/usr/bin/env node
// One number of notes on screen: the status line says how many notes are drawn, and the canvas's own label (what a screen reader
// announces) must say the same, also after the filters change what is drawn. They had said 49 and 51.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
    const read = () => tab.ev(`(() => { const num = s => { const m = /(\\d+)\\s+notes?/.exec(s || ""); return m ? +m[1] : null; };
      return { sr: num(document.querySelector("[id^=vg-cv-label]").textContent), status: num((document.querySelector(".vg-status") || {}).textContent) }; })()`);
    let r = await read();
    check(r.sr !== null && r.status !== null, `both counts must be on the page: ${JSON.stringify(r)}`);
    check(r.sr === r.status, `canvas label says ${r.sr} notes, the status line ${r.status}`);
    for (const view of ["2d", "neural"]) {
      await tab.ev(`${V}.openView(${JSON.stringify(view)})`); await sleep(500);
      r = await read(); check(r.sr === r.status, `${view}: canvas label says ${r.sr} notes, the status line ${r.status}`);
    }
  } finally { await tab.close(); }
  finish(fails, "the canvas label and the status line count the same notes");
})();
