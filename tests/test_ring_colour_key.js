#!/usr/bin/env node
// On a phone the open Key names what each ring colour means, in words, because the tooltip that listed the reasons never shows on touch
// (explainer and bewildered personas: "the four-colour ring has no key"). Every reason that a ring on screen carries is named.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const view of ["2d", "3d"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      await tab.ev(`(() => { const r = document.querySelector(".vg-root"); if (!r.classList.contains("legend-open")) document.querySelector(".vg-legend-key").click(); })()`); await sleep(300);
      const r = await tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); if (!e) return null;
        const tip = (e.getAttribute("title") || "").replace(/^[^:]*: /, "").split(", ").filter(Boolean);
        return { text: e.innerText.replace(/\\s+/g, " ").trim(), tip }; })()`);
      assert.ok(r && r.tip.length, view + ": the needs-attention entry is in the legend with its reasons");
      for (const label of r.tip) assert.ok(r.text.includes(label), view + ': the open Key names "' + label + '" in visible text: "' + r.text + '"');
      await tab.ev(`document.querySelector(".vg-root").classList.contains("legend-open") && document.querySelector(".vg-legend-key").click()`); await sleep(200);
    }
    console.log("PASS: the open Key on a phone names every ring colour");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
