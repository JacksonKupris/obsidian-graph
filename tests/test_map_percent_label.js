#!/usr/bin/env node
// A topic has two percentages, so each says which: the Insights Maps card gives how much of the topic its map lists, the Topics tab gives how healthy it is.
const { checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    const rows = await tab.ev(`[...document.querySelectorAll(".vg-maprow")].map(r => r.textContent.replace(/\\s+/g, " "))`);
    check(rows.length > 0, "the Maps card must have rows, or this test reads nothing: " + rows.length);
    for (const r of rows) check(/\d+% of \d+ listed/.test(r), "a Maps row gives a bare percentage with no name for it: " + r);
  } finally { await tab.close(); }
  finish(fails, "the Maps card names what its percentage measures");
})();
