#!/usr/bin/env node
// A person's number on People says what it counts: "15 open" for open tasks, "7 mentions" for journal mentions. Three persona runs
// asked "15 what?", so the bare number is a label with its unit, and it still equals the rows under it.
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tools(tab, { wait: 150 }).screen("people"); await sleep(200);
    const cards = await tab.ev(`[...document.querySelectorAll(".vg-hq-person")].map(c => ({ badge: c.querySelector("h3 span").innerText.trim(), rows: c.querySelectorAll(".vg-hq-item").length }))`);
    check(cards.length > 0, "the sample has people (" + cards.length + ")");
    cards.forEach(c => {
      const m = c.badge.match(/^(\d+) (open|mentions?)$/);
      check(m, 'the badge names its unit ("' + c.badge + '")');
      if (m && m[2] === "open") check(Number(m[1]) === c.rows, "the open count equals its rows (" + c.badge + " vs " + c.rows + ")");
    });
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "a person's number says what it counts", "person count label");
})();
