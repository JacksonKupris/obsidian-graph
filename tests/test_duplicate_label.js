#!/usr/bin/env node
// A group of tasks worded alike is folded under one line. The line says how many tasks are inside and that each is counted, so a card
// whose count is 6 and whose visible rows are 4 adds up.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date(), api: {} }); window.vaultHQ.setScreen("people"); })()`);
    await tab.waitFor(`document.querySelectorAll(".vg-hq-person").length ? 1 : 0`, 15000); await sleep(300);
    const r = await tab.ev(`(() => [...document.querySelectorAll(".vg-hq-person")].map(c => ({ n: parseInt((c.querySelector("h3 span") || {}).textContent, 10) || 0, rows: c.querySelectorAll(".vg-hq-item").length, label: [...c.querySelectorAll(".vg-hq-duplicates > summary")].map(s => s.textContent.trim()) })))()`);
    const folded = r.filter(c => c.label.length);
    check(folded.length > 0, "the sample vault needs a person with folded duplicates for this test to mean anything");
    for (const c of folded) {
      check(c.label.every(l => /counted/i.test(l)), `a folded group should say its tasks are counted: ${JSON.stringify(c.label)}`);
      check(c.rows === c.n, `the count ${c.n} should equal the rows inside the card including folded ones (${c.rows})`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "a folded group says its tasks are counted and the card adds up", "duplicate label");
})();
