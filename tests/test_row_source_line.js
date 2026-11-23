#!/usr/bin/env node
// A task row's second line says where it came from. A journal heading that only says "Tasks" says nothing, so the row falls back to
// "Today's journal" (the rule is VGRules.sectionWords, used for every row built from a journal task).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("people"); })()`);
    await sleep(300);
    const lines = await tab.ev(`[...document.querySelectorAll(".vg-hq-item .vg-hq-txt small")].map(s => s.textContent.trim())`);
    check(lines.length > 0, "the People screen of the sample vault should show task rows with a second line");
    check(!lines.some(l => /^(tasks?|to ?dos?)$/i.test(l)), `a bare "Tasks" heading is not a source: ${JSON.stringify(lines.filter(l => /^(tasks?|to ?dos?)$/i.test(l)))}`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "task rows never show a bare Tasks heading as their source", "row source line");
})();
