#!/usr/bin/env node
// A week-strip day's spoken label says what its dots show. It used to read "Wed 25, journal and standup" for every day, including
// days with no dots (two personas: a screen reader hears the opposite of the picture). Journal / standup / both / "nothing written yet".
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tools(tab, { wait: 150 }).screen("calendar"); await sleep(200);
    const days = await tab.ev(`[...document.querySelectorAll(".vg-hq-strip .vg-hq-day")].map(b => ({ label: b.getAttribute("aria-label"), j: !!b.querySelector(".is-j"), s: !!b.querySelector(".is-s") }))`);
    check(days.length === 7, "the strip has seven days (" + days.length + ")");
    check(days.some(d => d.j || d.s) && days.some(d => !d.j && !d.s), "the sample has days with dots and days without, so this can fail (" + days.map(d => (d.j ? "J" : "-") + (d.s ? "S" : "-")).join(" ") + ")");
    days.forEach(d => {
      const says = { j: /journal/i.test(d.label), s: /standup/i.test(d.label), none: /nothing written/i.test(d.label) };
      check(says.j === d.j && says.s === d.s && says.none === (!d.j && !d.s), "the label follows the dots: " + JSON.stringify(d));
    });
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "a week-strip day's label says what its dots show", "day label");
})();
