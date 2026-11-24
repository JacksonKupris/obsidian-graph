#!/usr/bin/env node
// The note card says "since 16 Nov", not the stored "since 26-11-16" (explainer persona, two rounds). Dates go through VGShared.shortDate.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    let checked = 0;
    for (const view of ["2d", "3d"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(800);
      const list = env.data().nodes.filter(n => n.edited).slice(0, 8).map(n => n.id);
      assert.ok(list.length, "the sample has notes with an edit date");
      for (const id of list) {
        await tab.ev(`window.vaultGraph._debug.select(${JSON.stringify(id)})`); await sleep(250);
        const t = await tab.ev(`(() => { const c = document.querySelector(".vg-inspector"); return c ? c.innerText.replace(/\\s+/g, " ") : ""; })()`);
        if (!/unchanged/.test(t)) continue;
        checked++;
        assert.ok(!/since \d{2}-\d{2}-\d{2}/.test(t), view + " " + id + ": the card shows a raw date: " + t.slice(0, 300));
        assert.ok(/since [A-Z][a-z]{2} \d{1,2}/.test(t), view + " " + id + ": the card shows 'since 16 Nov': " + t.slice(0, 300));
      }
    }
    assert.ok(checked >= 2, "at least two note cards with an edit date were checked (" + checked + ")");
    console.log("PASS: note cards show their edit date in words (" + checked + " checked)");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
