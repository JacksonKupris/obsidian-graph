#!/usr/bin/env node
// The Maps card names every map the status pill counts. The pill and the Display panel count every note drawn as a hexagon (6 in the
// sample); the card listed only the maps that cover a topic (4), so two hexagons were on the canvas and in no list (found by the
// bewildered and explainer personas). The rest are listed under their own heading and open like any note.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data(), V = "window.vaultGraph._debug";
  const maps = data.nodes.filter(n => n.moc), covering = new Set((data.mocs || []).filter(m => !m.nav).map(m => m.id));
  const others = maps.filter(n => !covering.has(n.id));
  check(others.length > 0, "the sample data needs a map that covers no topic");
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`${V}.setView("2d")`); await sleep(500);
    await tab.ev(`(document.querySelector('.vg-tab[data-tab="insights"]') || {click(){}}).click()`); await sleep(300);
    const card = await tab.ev(`(() => { const c = [...document.querySelectorAll('.vg-panel[data-panel="insights"] .vg-card')].find(e => /^Maps/.test(e.textContent.trim())); return c ? c.textContent.replace(/\\s+/g, " ") : null; })()`);
    const title = n => ((data.mocs || []).find(m => m.id === n.id) || {}).title || n.name;   // a map that covers a topic is listed by its title
    maps.forEach(n => check((card || "").includes(title(n)), `the Maps card must name "${title(n)}", a map drawn on the graph`));
  } finally { await tab.close(); }
  finish(fails, "the Maps card names every map the pill counts", "maps card all");
})();
