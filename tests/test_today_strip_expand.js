#!/usr/bin/env node
// The graphs' "Biggest gap" strip is cut off with an ellipsis on a phone. Its full text opens on a tap, but nothing said so and a keyboard
// couldn't reach it (two personas on the 3D view). The text is a button that says whether it is open, and Enter opens it.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const view of ["2d", "3d", "neural"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      const r = await tab.ev(`(() => { const t = document.querySelector(".vg-today-text"); if (!t || t.closest("[hidden]")) return null;
        const was = t.closest(".vg-today").classList.contains("is-open"), a = { role: t.getAttribute("role"), tab: t.tabIndex, ex: t.getAttribute("aria-expanded") };
        t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return { ...a, was, after: t.getAttribute("aria-expanded"), open: t.closest(".vg-today").classList.contains("is-open") }; })()`);
      assert.ok(r, view + ": the strip is showing");
      assert.ok(r.role === "button" && r.tab === 0 && (r.ex === "true") === r.was, view + ": the text is a focusable button whose aria-expanded matches its state: " + JSON.stringify(r));
      assert.ok((r.after === "true") === r.open && r.open !== r.was, view + ": Enter flips it and aria-expanded follows: " + JSON.stringify(r));
    }
    console.log("PASS: the strip's text is a button that opens with the keyboard and says so");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
