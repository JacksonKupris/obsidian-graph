#!/usr/bin/env node
// A star or black hole's panel leads with its counts and notes; name, target, orbit physics and gravity sit folded under
// "Settings and orbit", and a review queue isn't scored for health (bewildered, returning and explainer personas, 2026-11-25).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const { fails, ok: check } = checks();
  const look = () => tab.ev(`(() => { const box = document.querySelector(".vg-inspector"), fold = box.querySelector("details.ds-more"), row = box.querySelector(".vg-ins-sec [data-id]");
    const shown = e => !!e && e.checkVisibility(), top = e => e ? e.getBoundingClientRect().top : -1;
    return { fold: !!fold, open: !!fold && fold.open, summary: fold ? fold.querySelector("summary").textContent.trim() : "", physics: [...box.querySelectorAll(".vg-physline, [data-b=mass], [data-b=name]")].filter(shown).length,
      inFold: fold ? fold.querySelectorAll(".vg-physline, [data-b=mass], [data-b=name]").length : 0, row: top(row), h: innerHeight, health: /healthy/i.test(box.textContent) }; })()`);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`${D}.openView("cosmos")`); await sleep(1500);
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const type of ["star", "blackhole"]) {
      check(await tab.ev(`${D}.openBody("${type}")`), "the first visit places a " + type); await sleep(500);
      const a = await look();
      check(a.fold && !a.open && /Settings and orbit/.test(a.summary), type + ": settings are folded: " + JSON.stringify(a));
      check(a.inFold >= 3 && a.physics === 0, type + ": name, physics and gravity are inside the fold and out of sight: " + JSON.stringify(a));
      check(a.row > 0 && a.row < a.h, type + ": the first note shows without scrolling: " + JSON.stringify(a));
      check(a.health === (type === "star"), type + (type === "star" ? " shows how healthy it is" : " is a review queue, so it has no health score") + ": " + JSON.stringify(a));
      await tab.ev(`document.querySelector(".vg-inspector details.ds-more summary").click()`); await sleep(200);
      check((await look()).physics >= 2, type + ": opening the fold shows the settings");
      await tab.ev(`(() => { const s = document.querySelector(".vg-inspector [data-b=name]"); s.value = "Renamed"; s.dispatchEvent(new Event("change")); })()`); await sleep(400);
      const b = await look();
      check(b.open, type + ": the fold stays open after a setting changes: " + JSON.stringify(b));
      await tab.ev(`document.querySelector(".vg-inspector .vg-ins-close").click()`); await sleep(300);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the body panel leads with notes and folds the settings", "cosmos panel");
})();
