#!/usr/bin/env node
// When the picture draws fewer notes than the vault has, the status line says which ones are left out (3D explainer and bewildered,
// 0.6.242: "49 of 51 notes" with the 2 unlinked notes explained somewhere else), and the count agrees once they are shown.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const data = env.data(), unlinked = data.nodes.filter(n => n.isolated && !n.person && !n.moc && !n.ghost).length;
  assert.ok(unlinked > 0, "the sample has unlinked notes (the test can't fail without them)");
  const tab = await openPage({ html: env.pageWith("", data), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await sleep(1500); await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(1500);
    const status = () => tab.ev(`document.querySelector(".vg-status").innerText.replace(/ +/g, " ")`);
    let s = await status();
    assert.ok(/of \d+ notes/.test(s), "the notes drawn are fewer than the vault's: " + s);
    assert.ok(new RegExp(unlinked + " unlinked hidden").test(s), "the status names the " + unlinked + " unlinked notes it leaves out: " + s);
    await tab.ev(`document.querySelector(".vg-isolated").click()`); await sleep(1200);
    s = await status();
    assert.ok(!/unlinked hidden/.test(s), "nothing is named as hidden once unlinked notes are shown: " + s);
    console.log("PASS: the status line names the notes it leaves out");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
