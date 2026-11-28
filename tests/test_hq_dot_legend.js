#!/usr/bin/env node
// The journal and standup dots are explained the same way on the week strip and the month grid: one legend, built once.
// The month note used to say "a dot means a journal, a second dot a standup too" while the strip named each dot (two persona runs).
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tools(tab, { wait: 150 }).screen("calendar"); await sleep(200);
    const r = await tab.ev(`(() => { const L = e => e ? { text: e.innerText.replace(/\\s+/g, " ").trim(), j: !!e.querySelector("i.is-j"), s: !!e.querySelector("i.is-s") } : null;
      const legend = e => e && e.querySelector(".vg-hq-legend-dots") ? L(e.querySelector(".vg-hq-legend-dots")) : null;
      return { strip: legend(document.querySelector(".vg-hq-weeklegend")), month: legend(document.querySelector(".vg-hq-calkey")), calkey: (document.querySelector(".vg-hq-calkey") || {}).innerText || "",
        cellJ: document.querySelectorAll(".vg-hq-calday .vg-hq-marks i.is-j").length, cellAny: document.querySelectorAll(".vg-hq-calday .vg-hq-marks i").length }; })()`);
    check(r.strip && r.month, "both the week strip and the month grid carry the dot legend (" + !!r.strip + ", " + !!r.month + ")");
    if (r.strip && r.month) {
      check(r.strip.text === r.month.text, 'same words in both: "' + r.strip.text + '" vs "' + r.month.text + '"');
      check(r.month.j && r.month.s && /Journal/.test(r.month.text) && /Standup/.test(r.month.text), "the legend names both dots with their own mark");
    }
    check(!/second dot/.test(r.calkey), "the old 'a second dot' wording is gone");
    check(r.cellAny > 0 && r.cellJ > 0, "month-grid journal dots use the same mark class as the legend (" + r.cellJ + " of " + r.cellAny + ")");
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "the dot legend is the same on the strip and the month grid", "dot legend");
})();
