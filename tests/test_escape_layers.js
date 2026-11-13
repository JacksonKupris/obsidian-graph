#!/usr/bin/env node
// Escape closes the topmost layer first. A report (lens) sits over the scene, so with a game in play underneath, the first Escape
// closes the report and the game keeps running; the second Escape is the game's own (it ends the run).
//   node tests/test_escape_layers.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const D = "window.vaultGraph._debug", ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`);
    await ev(`${D}.openView("wikirace")`); await sleep(400);
    const started = await ev(`(() => { const s = ${D}.scenes().wikirace; if (!s || !s.api) return "no scene"; s.api.start(); return s.state.state; })()`);
    check(started === "play", `Wikirace should be in play to test against (got ${started}); the test cannot fail without it`);
    await ev(`${D}.openView("lens:flowlens")`); await sleep(600);
    check(await ev(`!!document.querySelector(".vg-lens:not([hidden])")`), "the report should be open over the game");
    const press = () => ev(`(() => { const t = document.querySelector(".vg-lens:not([hidden]) .vg-lens-close") || document.querySelector(".vg-root button"); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()`);
    await press(); await sleep(200);
    check(await ev(`!document.querySelector(".vg-lens:not([hidden])")`), "the first Escape should close the report, not the game under it");
    check(await ev(`${D}.scenes().wikirace.state.state`) === "play", "the game should still be running after the report closed");
    await press(); await sleep(200);
    check(await ev(`${D}.scenes().wikirace.state.state`) === "title", "the second Escape should end the game run");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Escape closes the topmost layer first");
})();
