#!/usr/bin/env node
// Every stat card opens the detail behind its number (persona pass 2026-11-21: "36 unlinked notes" only faded the graph, no list).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const cards = await tab.ev(`[...document.querySelectorAll("[data-stat]")].map(b => b.dataset.stat)`);
    check(cards.includes("unlinked") && cards.includes("gaps"), "the unlinked and gaps stat cards exist (the test can't fail without them), got " + cards);
    await tab.ev(`document.querySelector('[data-stat="unlinked"]').click()`); await sleep(600);
    const open = await tab.ev(`({ lens: !document.querySelector(".vg-lens").hidden, rows: document.querySelectorAll(".vg-lens-body .vg-sugg").length, title: (document.querySelector(".vg-lens-title")||{}).textContent })`);
    check(open.lens && open.rows > 0, "the unlinked card should open a list of those notes: " + JSON.stringify(open));
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "stat cards open their detail");
})();
