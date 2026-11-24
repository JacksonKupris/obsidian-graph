#!/usr/bin/env node
// The first-run tour shows once. It used to count as seen only when the person pressed Skip or Done, so leaving the page with the card
// open (or reloading it) brought the tour back on the next open, every time (3D persona round, 0.6.229).
// Uses the page's own saved state (localStorage), the same store a person's browser keeps.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`localStorage.removeItem("vault-graph:" + DATA.vault)`);
    // a fresh open: remount with the page's own store so the tour is due
    const remount = `(() => { window.vaultGraph.destroy(); document.querySelectorAll(".vg-tour").forEach(e => e.remove());
      window.vaultGraph = mountVaultGraph(document.getElementById("vg"), DATA, { store: {
        load: () => { try { return JSON.parse(localStorage.getItem("vault-graph:" + DATA.vault)); } catch (e) { return null; } },
        save: s => { try { localStorage.setItem("vault-graph:" + DATA.vault, JSON.stringify(s)); } catch (e) { /* unavailable */ } } } }); })()`;
    await tab.ev(remount);
    check(await tab.waitFor(`document.querySelector(".vg-tour") ? 1 : 0`, 8000), "the tour shows on the first open (the check can't pass if it never shows)");
    await sleep(1500);   // the card stays open: no Skip, no Done, as when a person closes the tab
    const saved = await tab.ev(`(JSON.parse(localStorage.getItem("vault-graph:" + DATA.vault)) || {}).toured === true`);
    check(saved, "the tour counts as seen as soon as it is shown");
    await tab.ev(remount);
    await sleep(3500);
    check(!await tab.ev(`!!document.querySelector(".vg-tour")`), "the second open doesn't show the tour again");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the tour shows once");
})();
