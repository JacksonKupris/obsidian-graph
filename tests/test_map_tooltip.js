#!/usr/bin/env node
// Pointing at a map says what its number counts: the notes the map lists. "6 notes in Rental App" read as the topic's size
// beside a star saying 15 in orbit (bewildered persona, 2026-11-25).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); ${D}.openView("2d")`); await sleep(3500);
    const spot = () => tab.ev(`(() => { const cv = document.querySelector(".vg-cv"), r = cv.getBoundingClientRect(); for (let y = 8; y < r.height; y += 6) for (let x = 8; x < r.width; x += 6) { if (document.elementFromPoint(r.left + x, r.top + y) !== cv) continue;
      cv.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: "mouse" })); const t = document.querySelector(".vg-tip.is-on .vg-tip-meta"); if (t && /^Topic map/.test(t.textContent)) return t.textContent; } return ""; })()`);
    const text = await spot();
    check(!!text, "a map note was pointed at (the test can't fail without it)");
    check(/^Topic map · lists \d+ notes?( for .+)?$/.test(text), "the tooltip says the map lists them: " + text);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "a map's tooltip says what its number counts", "map tooltip");
})();
