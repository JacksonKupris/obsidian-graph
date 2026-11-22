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
    // the linked-notes card opens a list of notes, and a search with no match offers a next step (persona round 2)
    await tab.ev(`document.querySelector(".vg-lens-close").click()`); await sleep(200);
    check(await tab.ev(`!!document.querySelector('[data-stat="all"]')`), "the linked-notes card exists (the test can't fail without it)");
    await tab.ev(`document.querySelector('[data-stat="all"]').click()`); await sleep(500);
    check(await tab.ev(`!document.querySelector(".vg-palette").hidden && document.querySelectorAll(".vg-pitem").length > 3`), "the linked-notes card should open a list of notes");
    await tab.ev(`(() => { const i = document.querySelector(".vg-pq"); i.value = "zzqxnotanote"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(400);
    const miss = await tab.ev(`(document.querySelector(".vg-palette-list .vg-empty") || {}).textContent || ""`);
    check(/No note or topic names match/.test(miss), "a miss says so (the test can't fail without it): " + miss);
    check(await tab.ev(`document.querySelectorAll(".vg-palette-list .vg-empty-next button").length > 0`), "a search miss should offer a next step");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "stat cards open their detail");
})();
