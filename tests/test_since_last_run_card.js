#!/usr/bin/env node
// Insights' "Since <date>" card exists only when there is an earlier analysis to compare with. With none it was a card that said
// "Nothing to compare yet", a dead end on every first run (3D persona round, 0.6.229). With one it still lists what changed.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const since of [null, "2026-11-20"]) {
    const data = env.data(); data.changes = since ? { since, linked_delta: 2, new_notes: [], gaps_closed: [], gaps_new: [], acted: [], quiet: [], active: [], new_clusters: [] } : { since: null };
    const tab = await openPage({ html: env.pageWith("", data) });
    try {
      if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
      await tab.ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`); await sleep(400);
      const text = await tab.ev(`(document.querySelector('[data-panel="insights"]') || {}).textContent || ""`);
      check(text.length > 50, "the Insights panel rendered (the check can't pass on an empty panel)");
      if (since) check(/Since 2026-11-20/.test(text) && /linked note/.test(text), "with an earlier analysis the card lists what changed");
      else check(!/Since last run|Nothing to compare/.test(text), "with no earlier analysis there is no empty card");
    } catch (e) { fails.push("crashed: " + e.message); }
    await tab.close();
  }
  finish(fails, "Since last run appears only when there is something to compare");
})();
