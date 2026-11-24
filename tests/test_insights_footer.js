#!/usr/bin/env node
// The Insights footer says what the numbers are in plain words: when the notes were analysed, how many daily notes were read, and the span
// they cover, with years, so the two dates never read as the same day. Found by the 3D persona round (0.6.229): "Data from 2026-11-24 ·
// 74 daily notes since Nov 24" looked like 74 notes in a day.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`); await sleep(400);
    const foot = await tab.ev(`(document.querySelector('[data-panel="insights"] .vg-foot') || {}).textContent || ""`);
    check(!!foot, "the Insights panel has a footer (the check can't pass without one)");
    check(!/Data from/.test(foot), "the footer no longer opens with 'Data from': " + foot);
    check(/^Analysed .*\d{4}/.test(foot), "it says when the notes were analysed, with the year: " + foot);
    const years = foot.match(/\b\d{4}\b/g) || [];
    check(years.length >= 2, "the span of daily notes names its years, so the start can't read as the same day: " + foot);
    check(/\d+ daily notes? read/.test(foot), "it says how many daily notes were read: " + foot);
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the Insights footer reads as analysed date, notes read and span");
})();
