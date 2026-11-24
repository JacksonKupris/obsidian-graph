#!/usr/bin/env node
// Notes with the same influence share a rank ("#1, #1, #3"), so the list never ranks one above another on equal evidence;
// the order within a tie follows the name, so it is the same on every open.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data();
  const plain = data.nodes.filter(n => !n.moc && !n.person && !n.ghost && !n.isolated).slice(0, 6);
  check(plain.length >= 5, "the sample data needs five plain linked notes");
  plain.forEach((n, i) => { n.bc = i < 2 ? 0.9 : i === 2 ? 0.5 : 0.1 + i / 100; });   // two tied at the top, then distinct
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`window.vaultGraph._debug.setView("2d")`); await sleep(500);
    await tab.ev(`(document.querySelector('.vg-tab[data-tab="insights"]') || {click(){}}).click()`); await sleep(300);
    const rows = await tab.ev(`(() => { const c = [...document.querySelectorAll('.vg-panel[data-panel="insights"] .vg-card')].find(e => /hold topics together/.test(e.textContent)); return c ? [...c.querySelectorAll(".vg-item")].map(r => r.textContent.replace(/ +/g, " ").trim()).slice(0, 4) : null; })()`);
    check(rows && rows.length >= 3, "the card of notes that hold topics together must list notes: " + JSON.stringify(rows));
    const ranks = (rows || []).map(r => (r.match(/#(\d+) most connecting/) || [])[1]);
    check(ranks[0] === "1" && ranks[1] === "1", `two notes with the same influence must both be #1: ${JSON.stringify(ranks)}`);
    check(ranks[2] === "3", `the next note is #3, as in a race with a tie: ${JSON.stringify(ranks)}`);
    const names = plain.slice(0, 2).map(n => n.name).sort((a, b) => a.localeCompare(b));
    check((rows[0] || "").startsWith(names[0].slice(0, 4)), `within the tie the name decides the order: ${JSON.stringify(rows.slice(0, 2))}`);
  } finally { await tab.close(); }
  finish(fails, "tied notes share a rank, in name order", "rank ties");
})();
