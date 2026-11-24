#!/usr/bin/env node
// "How to read this" can be tapped on a phone: the Biggest gap strip used to sit on the same spot, so a tap on the button hit the strip
// (three personas on the 3D view: "the explanation isn't reachable on a phone"). The point under the button's centre must be the button.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    let checked = 0;
    for (const view of ["3d", "neural", "subway", "weather"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      const r = await tab.ev(`(() => { const b = document.querySelector(".vg-viewhelp"); if (!b || b.hidden) return null; const q = b.getBoundingClientRect();
        const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { onButton: !!e && (e === b || b.contains(e)), hit: e && (e.className || e.tagName) }; })()`);
      if (!r) continue;
      checked++;
      assert.ok(r.onButton, view + ": a tap on How to read this lands on it, not on " + r.hit);
    }
    assert.ok(checked >= 2, "at least two views show the button, so this can fail (" + checked + ")");
    console.log("PASS: How to read this is reachable on a phone in " + checked + " views");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
