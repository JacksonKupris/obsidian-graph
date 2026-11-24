#!/usr/bin/env node
// Neural view: the header never says "BRIDGES 0" next to help that says the core holds bridge notes (3 personas, 0.6.249).
// The core holds the most connecting notes, and a bridge count shows only when there are bridges.
//   node tests/test_neural_bridges.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const data = env.data();
  check(data.nodes.filter(n => n.bridge).length === 0, "the sample has no bridge notes (the test can't fail without that)");
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`${D}.openView("neural")`); await sleep(1500);
    const text = await tab.ev(`document.body.innerText + "|" + [...document.querySelectorAll(".vg-toast")].map(t => t.textContent).join("|")`);
    check(/BRIDGES/i.test(text) === false || !/BRIDGES\s*0\b/i.test(text), "the Neural header says BRIDGES 0");
    check(!/core holds your bridge notes/i.test(text), "the Neural toast says the core holds bridge notes");
    check(/NOTES\s*\d+/.test(text), "the Neural header shows its counts (the test can't fail without it)");
  } finally { await tab.close(); }
  finish(fails, "Neural header and toast agree about bridges");
})().catch(e => { console.error(e); process.exit(1); });
