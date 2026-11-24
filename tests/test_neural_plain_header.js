#!/usr/bin/env node
// Neural view: the header says its rate is a model, not a measure of the vault, and the screen-style buttons say what they are
// (explainer and bewildered personas, 0.6.249: LIF, E/I, Hz, STD/NV/CRT unreadable; Hz read as a real measurement).
//   node tests/test_neural_plain_header.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`${D}.openView("neural")`); await sleep(1500);
    const hdr = await tab.ev(`(document.querySelector(".vg-hud-title") || {}).textContent || ""`);
    check(/LOBES/.test(hdr), "the Neural header shows (the test can't fail without it): " + hdr.slice(0, 60));
    check(/model only/i.test(hdr), "the header says the rate is a model: " + hdr.slice(0, 160));
    check(!/\bLIF\b|\bE\/I\b/.test(hdr), "the header uses LIF or E/I: " + hdr.slice(0, 160));
    const btns = await tab.ev(`[...document.querySelectorAll(".vg-visbtn")].map(b => [b.textContent, b.title || b.getAttribute("aria-label") || ""])`);
    check(btns.length === 4, "four screen-style buttons (the test can't fail without them): " + btns.length);
    btns.forEach(([t, name]) => check(name.length > t.length, `the ${t} button names what it does (${name || "no title"})`));
  } finally { await tab.close(); }
  finish(fails, "the Neural header and screen buttons are plain");
})().catch(e => { console.error(e); process.exit(1); });
