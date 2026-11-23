#!/usr/bin/env node
// Triage's key hint only lists what the card can do right now (x done, l later, f plan), is left out on a phone where there are no keys, and
// Skip says what it does. Found by persona-bewildered: the hint named three actions with no buttons for them.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    const mount = (layout, api) => tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), layout: ${JSON.stringify(layout)}, api: ${api} }); window.vaultHQ.setScreen("today"); })()`);
    for (const [width, mobile] of [[1280, false], [390, true]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile });
      await mount("triage", "{}"); await sleep(200);
      const read = await tab.ev(`(() => { const c = document.querySelector(".vg-hq-tricard"); if (!c) return null; const h = document.querySelector(".vg-hq-trikeys"), s = c.querySelector('[data-triage="skip"]');
        return { hint: h ? h.textContent : "", acts: [...c.querySelectorAll("[data-act]")].map(b => b.dataset.act), star: !!c.querySelector(".vg-hq-star"), skipTitle: s ? s.title : "", skipText: s ? s.textContent : "" }; })()`);
      const at = `${width}px`;
      check(read, at + ": Triage shows no card");
      if (!read) continue;
      if (/\bx done\b/.test(read.hint)) check(read.acts.includes("main") || read.acts.includes("done"), `${at}: the hint says "x done" but the card has no Done button (${read.acts})`);
      if (/\bl later\b/.test(read.hint)) check(read.acts.includes("later"), `${at}: the hint says "l later" but the card has no Later button (${read.acts})`);
      if (/\bf plan\b/.test(read.hint)) check(read.star, `${at}: the hint says "f plan" but the card has no Plan button`);
      if (mobile) check(!read.hint, `${at}: a phone has no keys, so no key hint: "${read.hint}"`);
      check(/end|later|comes back/i.test(read.skipTitle), `${at}: Skip should say what it does (title: "${read.skipTitle}")`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "triage hint lists only what the card can do, none on a phone, and Skip says what it does", "triage hints");
})();
