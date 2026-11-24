#!/usr/bin/env node
// Tapping a ring's number opens the notes behind it and says why they were flagged (3D explainer, 0.6.242: "Selection · 3 notes
// selected" with a list and no reason).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    await tab.ev(`window.vaultGraph._debug.openView("2d")`); await sleep(3500);
    for (let i = 0; i < 4 && await tab.ev(`!!document.querySelector(".vg-tour, .vg-tour-card")`); i++) { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(200); }
    const b = await tab.ev(`(() => { const b = window.vaultGraph._debug.ringBadges()[0]; const r = document.querySelector(".vg-root canvas").getBoundingClientRect(); return b && { x: r.left + b.x, y: r.top + b.y, n: b.ids.length, reasons: b.reasons }; })()`);
    assert.ok(b, "a ring number is on screen (the test can't pass without one)");
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }); await sleep(500);
    const box = await tab.ev(`(() => { const e = document.querySelector(".vg-inspector"); return e && !e.hidden ? e.innerText.replace(/ +/g, " ") : null; })()`);
    assert.ok(box && /selected/.test(box), "the number opens the selection: " + box);
    assert.ok(/Why flagged|Flagged because|needs attention/i.test(box), "the selection says why they are flagged: " + box);
    console.log("PASS: a ring number's selection names the reasons");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
