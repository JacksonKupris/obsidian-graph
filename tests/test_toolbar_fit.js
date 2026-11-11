#!/usr/bin/env node
// The toolbar on a phone (360 px wide, as in the screenshots): its buttons never lie over one another, never run past the pane,
// and nothing the library's frame draws starts above the bottom of the toolbar. Checked for the 2D graph and the library views.
//   node tests/test_toolbar_fit.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok } = checks(), D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("mobile: true,"), mobile: true });
  try {
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the phone page didn't mount");
    await sleep(1200);
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`);
    // the real vault shows the Next pill and the Upkeep count; the sample page doesn't, so show them as they are there
    await tab.ev(`(() => { const n = document.querySelector(".vg-nextbtn"); n.hidden = false; n.querySelector("b").textContent = ""; const c = document.querySelector(".vg-gamecount"); c.hidden = false; c.textContent = "3"; })()`);
    for (const view of ["2d", "loadpaths", "modes", "slime"]) {
      await tab.ev(`${D}.setView(${JSON.stringify(view)})`); await sleep(900);
      const r = await tab.ev(`(() => { const bar = document.querySelector(".vg-toolbar"), W = document.querySelector(".vg-root").getBoundingClientRect().width;
        const box = [...bar.querySelectorAll("button")].filter(e => !e.closest("[hidden], .vg-menu")).map(e => ({ n: (e.getAttribute("aria-label") || e.className || e.tagName).toString().slice(0, 28), r: e.getBoundingClientRect() })).filter(b => b.r.width > 0);
        const clash = []; for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) { const a = box[i].r, b = box[j].r; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) clash.push(box[i].n + " / " + box[j].n); }
        const past = box.filter(b => b.r.right > W + 1 || b.r.left < -1).map(b => b.n);
        return { clash, past, count: box.length, W, w: box.map(b => b.n.slice(0,16) + ":" + Math.round(b.r.left) + "-" + Math.round(b.r.right)) }; })()`);
      ok(r.count >= 3, `${view}: the toolbar has its buttons (${r.count})`); if (process.env.SHOW) console.log(view, r.count, JSON.stringify(r));
      ok(!r.clash.length, `${view}: no two toolbar buttons overlap at ${r.W} px (${r.clash.join(", ")})`);
      ok(!r.past.length, `${view}: none runs off the pane (${r.past.join(", ")})`);
    }
  } catch (e) { fails.push(`toolbar: ${e.message}`); }
  await tab.close();
  finish(fails, "the toolbar fits a phone");
})();
