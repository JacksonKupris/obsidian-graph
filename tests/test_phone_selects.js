#!/usr/bin/env node
// On a phone the View, Display and Tools dropdowns show their whole chosen name and stay on the screen, in every view, and the Tools
// button says what it is in words a person can see or hear (3D persona round, 0.6.229: a dropdown cut off as "Graph i", a bare "⋯").
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelectorAll(".vg-tour").forEach(e => e.remove())`);
    for (const view of ["2d", "3d", "neural", "cosmos", "subway"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(900);
      const r = await tab.ev(`(() => { const out = [], c = document.createElement("canvas").getContext("2d");
        for (const s of document.querySelectorAll(".vg-sels select")) {
          const b = s.getBoundingClientRect(); if (b.width < 1) continue;
          const cs = getComputedStyle(s); c.font = cs.font; const o = s.options[s.selectedIndex], txt = o ? o.text : "";
          const room = b.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 22;   // the arrow
          out.push({ cls: s.className.replace("vg-sel ", ""), txt, need: Math.round(c.measureText(txt).width), room: Math.round(room), right: Math.round(b.right), vw: innerWidth, name: s.getAttribute("aria-label"), shown: txt.length > 0 });
        } return out; })()`);
      check(r.length >= 1 && r.some(s => /viewsel/.test(s.cls)), `${view}: the View dropdown is on the page (the check cannot pass without it): ${JSON.stringify(r)}`);
      for (const s of r) {
        check(s.right <= s.vw, `${view}: ${s.cls} stays on the screen (right edge ${s.right} of ${s.vw})`);
        // CI's Linux fonts measure about 10 percent wider than this PC's, so the room gets 15 percent slack; a clipped name (Graph in 3D: 64px in 43px) is far past it
        check(!s.shown || s.need <= s.room * 1.15, `${view}: ${s.cls} shows "${s.txt}" whole (needs ${s.need}px, has ${s.room}px)`);
        check(!!s.name, `${view}: ${s.cls} has a name`);
      }
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the phone's dropdowns show their whole names");
})();
