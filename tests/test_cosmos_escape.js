#!/usr/bin/env node
// Escape closes what Cosmos opens: the Populate proposal, and Ship mode (bewildered persona: neither could be left with the keyboard).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`window.vaultGraph._debug.openView("cosmos")`); await sleep(1500);
    for (let i = 0; i < 4 && await tab.ev(`!!document.querySelector(".vg-tour, .vg-tour-card")`); i++) { await esc(); }
    // pressed as a person does: a click leaves focus where it lands, then the real key
    const click = sel => tab.ev(`(() => { const b = document.querySelector("${sel}"); if (!b) return false; b.focus(); b.click(); return true; })()`);
    async function esc() { for (const type of ["keyDown", "keyUp"]) await tab.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(250); }
    const open = () => tab.ev(`!document.querySelector(".vg-inspector").hidden`);
    assert.ok(await click(".vg-seedbtn"), "Cosmos has a Populate button"); await sleep(300);
    assert.strictEqual(await open(), true, "Populate opens its proposal");
    await esc();
    assert.strictEqual(await open(), false, "Escape closes the Populate proposal");
    const ship = () => tab.ev(`!!window.vaultGraph._debug.st.ship`);
    assert.ok(await click(".vg-shipbtn"), "Cosmos has a Ship button"); await sleep(300);
    assert.strictEqual(await ship(), true, "Ship turns Ship mode on");
    await esc();
    assert.strictEqual(await ship(), false, "Escape leaves Ship mode");
    assert.strictEqual(await tab.ev(`document.querySelector(".vg-shipbtn").getAttribute("aria-pressed")`), "false", "the button says it is off");
    // the proposal over Ship mode closes first, one layer per press
    await click(".vg-shipbtn"); await click(".vg-seedbtn"); await sleep(300);
    await esc();
    assert.deepStrictEqual([await open(), await ship()], [false, true], "the first Escape closes the proposal only");
    await esc();
    assert.strictEqual(await ship(), false, "the second leaves Ship mode");
    console.log("PASS: Escape closes the Populate proposal and leaves Ship mode");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
