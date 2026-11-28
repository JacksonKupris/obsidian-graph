#!/usr/bin/env node
// On a phone the toolbar shows "3D" once as a label for the view (3D explainer, 0.6.242: the view picker and the 2D/3D toggle both read "3D").
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(400);
    await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(3500);
    for (let i = 0; i < 4 && await tab.ev(`!!document.querySelector(".vg-tour")`); i++) { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(200); }
    // every visible control whose shown text is exactly "3D" (a select shows its chosen option)
    const found = await tab.ev(`[...document.querySelectorAll(".vg-toolbar *")].filter(e => { const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const t = e.tagName === "SELECT" ? e.options[e.selectedIndex].text : (e.children.length ? "" : e.textContent); return t.trim() === "3D"; }).map(e => e.tagName + "." + e.className)`);
    assert.ok(found.length >= 1, "the 2D/3D toggle shows 3D (the test can't fail without it): " + found.join(", "));
    assert.ok(found.length <= 1, "the toolbar shows exactly 3D " + found.length + " times: " + found.join(", "));
    console.log("PASS: 3D is named once on a phone");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
