#!/usr/bin/env node
// The needs-attention entry in the legend says it holds the reasons (3D explainer, 0.6.242: "six coloured rings and no reason beside any
// colour"; the list was one click away but nothing on the entry said so).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await sleep(1500);
    await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(1500);
    const r = await tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); if (!e) return null; const c = e.cloneNode(true); c.querySelector(".vg-lg-attn-names").remove(); return { text: c.textContent.replace(/ +/g, " ").trim() }; })()`);
    assert.ok(r, "the needs-attention entry is in the legend (the test can't pass without it)");
    assert.ok(/reasons/i.test(r.text), "the entry says it has reasons: " + JSON.stringify(r));
    console.log("PASS: the legend entry points at the ring reasons");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
