#!/usr/bin/env node
// On a desktop the needs-attention entry in the legend opens a list that names each ring colour (bewildered persona, 0.6.229: "six unlabelled rings").
// It is the same list the phone's Key opens, drawn by the same legend; a click opens it, Escape closes it, and it stays inside the pane.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    const esc = async () => { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(300); };
    const endTour = async () => { for (let i = 0; i < 4 && await tab.ev(`!!document.querySelector(".vg-tour, .vg-tour-card")`); i++) await esc(); };   // the first-run tour takes Escape first; removing its elements would leave it running
    for (const view of ["2d", "3d"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200); await endTour();
      const info = () => tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); if (!e) return null;
        const n = e.querySelector(".vg-lg-attn-names"), b = n.getBoundingClientRect(), p = document.querySelector(".vg-root").getBoundingClientRect();
        return { tip: (e.getAttribute("title") || "").replace(/^[^:]*: /, "").split(", ").filter(Boolean), names: n.innerText.replace(/\\s+/g, " ").trim(),
          shown: n.getClientRects().length > 0, inside: b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1, expanded: e.getAttribute("aria-expanded"), role: e.getAttribute("role") }; })()`);
      let r = await info();
      assert.ok(r && r.tip.length, view + ": the needs-attention entry is in the legend with its reasons");
      assert.ok(!r.shown, view + ": the names stay folded until asked for, so the legend keeps one row");
      assert.strictEqual(r.role, "button", view + ": the entry is a button");
      await tab.ev(`document.querySelector(".vg-legend .vg-lg-attn-set").click()`); await sleep(300);
      r = await info();
      assert.ok(r.shown && r.expanded === "true", view + ": a click opens the names: " + JSON.stringify(r));
      for (const label of r.tip) assert.ok(r.names.includes(label), view + ': the list names "' + label + '": "' + r.names + '"');
      assert.ok(r.inside, view + ": the list sits inside the pane: " + JSON.stringify(r));
      await esc();
      r = await info();
      assert.ok(!r.shown && r.expanded === "false", view + ": Escape closes the list: " + JSON.stringify(r));
    }
    console.log("PASS: the desktop legend names every ring colour on a click");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
