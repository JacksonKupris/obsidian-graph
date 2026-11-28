#!/usr/bin/env node
// One count of maps. The status pill counts every map drawn as a hexagon; the Display panel's Maps row said fewer ("4 maps, drawn as
// hexagons") and its Notes to write row said "1 notes". Both read the shared counts now and use the shared plural.
// The data is trimmed to exactly one note to write, so the singular case is the one tested.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data(), V = "window.vaultGraph._debug";
  check((data.wanted || []).length > 0, "the sample data needs a note to write for this test");
  data.wanted = (data.wanted || []).slice(0, 1);
  const hexes = (data.nodes || []).filter(n => n.moc).length;
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await sleep(500);
    const row = cls => tab.ev(`(() => { const i = document.querySelector(".${cls}"); return i ? i.closest("label").textContent.replace(/\\s+/g, " ").trim() : ""; })()`);
    const maps = await row("vg-l-mocs"), write = await row("vg-l-wanted");
    check(new RegExp(`^Maps\\s*${hexes} maps?\\b`).test(maps), `the Maps row should count all ${hexes} maps drawn (got "${maps}")`);
    check(/^Notes to write\s*1 note\b/.test(write), `one note to write should read "1 note" (got "${write}")`);
  } finally { await tab.close(); }
  finish(fails, "the Display panel counts the same maps as the status pill", "maps count");
})();
