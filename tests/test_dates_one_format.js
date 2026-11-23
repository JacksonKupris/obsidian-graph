#!/usr/bin/env node
// Dates on Home read the same way everywhere ("Oct 12", "Nov 23"), never as a raw 2026-10-12, so a person doesn't have to translate between styles.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const RAW = /\b20\d\d-\d\d-\d\d\b/;
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);   // the page's own mount, with the note actions
    await sleep(400);
    const lines = (await tab.ev(`document.querySelector(".vg-hq").innerText`)).split(String.fromCharCode(10));
    check(lines.length > 10, "Home has text to check");
    for (const l of lines.filter(l => RAW.test(l))) check(false, `a raw date on Home: "${l.trim()}"`);
    // the same rule holds for the carried-over reasons the lists build
    const { VGRules } = env.notes();
    const list = VGRules.todayList(await tab.ev(`DATA`), { today: "2026-10-28" });
    for (const it of list.filter(i => /^From 20\d\d-/.test(i.why || ""))) check(false, `a raw date in a reason: "${it.why}"`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "dates read in one style on Home", "dates one format");
})();
