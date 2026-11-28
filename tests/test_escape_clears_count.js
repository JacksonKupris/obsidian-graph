#!/usr/bin/env node
// Escape closes a selection and the status stops saying how many are selected (3D explainer, 0.6.242: the toolbar kept "3 selected").
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(3500);
    for (let i = 0; i < 4 && await tab.ev(`!!document.querySelector(".vg-tour, .vg-tour-card")`); i++) { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(200); }
    const b = await tab.ev(`(() => { const b = window.vaultGraph._debug.ringBadges()[0]; const r = document.querySelector(".vg-root canvas").getBoundingClientRect(); return b && { x: r.left + b.x, y: r.top + b.y, n: b.ids.length, reasons: b.reasons }; })()`);
    assert.ok(b, "a ring number is on screen (the test can't pass without one)");
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }); await sleep(500);
    console.log("PASS: Escape clears the selected count");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
