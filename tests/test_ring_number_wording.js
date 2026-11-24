#!/usr/bin/env node
// The number on a ring badge counts the flagged notes grouped into it on screen, so it changes with the pane size and zoom and can span two topics
// (explainer and returning personas: "8 at 1280, 10 at 390, on a topic of 6 notes"). The legend says that, instead of "number = notes".
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    for (const view of ["2d", "3d"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      const r = await tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); if (!e) return null;
        const c = e.cloneNode(true); c.querySelector(".vg-lg-attn-names").remove(); return { names: e.querySelector(".vg-lg-attn-names").textContent, text: c.innerText.replace(/\\s+/g, " ").trim(), title: e.getAttribute("title") || "" }; })()`);
      assert.ok(r, view + ": the needs-attention entry is in the legend");
      assert.ok(/groups the flagged notes/.test(r.names) && /zoom/.test(r.names), view + ": the opened ring list says what a number groups: " + r.names);
      assert.ok(r.text.length < 60, view + ": the always-visible legend row stays short, so it cannot cover the pane centre: " + r.text);
      assert.ok(/groups/.test(r.title) && /zoom/.test(r.title), view + ": the tooltip says a badge groups nearby flagged notes and zooming splits it: " + r.title);
    }
    console.log("PASS: the ring number is described as the flagged notes grouped into it");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
