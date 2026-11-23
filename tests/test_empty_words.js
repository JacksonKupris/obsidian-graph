#!/usr/bin/env node
// What a screen says when it shows less than everything or nothing: Projects names how many it shows of how many, and Wrap up says how to get
// something onto it and labels its way back.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const go = screen => tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(screen)}); })()`).then(() => sleep(250));
    await go("projects");
    const p = await tab.ev(`(() => { const l = document.querySelector(".vg-hq-lede"), s = document.querySelector('select[data-filter], select'); return { lede: l ? l.textContent : "", cards: document.querySelectorAll(".vg-hq-grid > *").length }; })()`);
    const every = await tab.ev(`VGRules.hqProjects(DATA).length`);
    if (p.cards && p.cards < every) check(new RegExp(`${p.cards} of ${every}`).test(p.lede), `Projects shows ${p.cards} of ${every} but the line says "${p.lede}"`);
    else check(/Every project/.test(p.lede), `all shown, so the line should say every project: "${p.lede}"`);
    await go("wrap");
    const w = await tab.ev(`(() => { const e = document.querySelector(".vg-hq-empty"); return e ? { text: e.querySelector("p").textContent, btn: [...e.querySelectorAll("button")].map(b => b.textContent.trim()) } : null; })()`);
    if (w) {
      check(/tick|mark|finish/i.test(w.text), `Wrap up's empty state doesn't say how to get something on it: "${w.text}"`);
      check(w.btn.some(b => /back to today/i.test(b)), `the way back should say where it goes: ${JSON.stringify(w.btn)}`);
    } else check(false, "Wrap up shows no empty state on the sample vault; the test needs one");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Projects and Wrap up say what they show and what to do", "empty words");
})();
