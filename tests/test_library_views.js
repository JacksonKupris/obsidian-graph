#!/usr/bin/env node
// A view from the graphs library inside the plugin's own page, in headless Chrome: the library's canvas lies over the plugin's
// for the view and is put away for every other view; the library gets the plugin's data and fold, its stat line reaches the
// plugin's status, a real click on a note of the fold selects that note in the plugin, and the plugin's selection is marked
// in the library's view. Each check can fail: the view is looked up by name, so a scene that was never registered fails too.
//   node tests/test_library_views.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const data = env.data(), { fails, ok } = checks();
  const D = "window.vaultGraph._debug", q = s => `document.querySelector(${JSON.stringify(s)})`;
  let tab = null;
  try {
    tab = await openPage({ html: env.pageWith("", data) });
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const calm = async () => { await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.drawNow()`); await sleep(60); };
    ok(await tab.ev(`typeof VaultGraphViews === "object" && typeof VaultGraphViews.mountViews === "function"`), "the graphs library is built into the page");
    ok(await tab.ev(`!!${D}.scenes()["genome-lib"]`), "the plugin has a scene for the library's Genome fold");

    await tab.ev(`${D}.setView("genome-lib")`); await sleep(1900); await calm();
    const host = await tab.ev(`(() => { const h = ${q(".vg-lib")}, c = h && h.querySelector("canvas"); return { there: !!h, hidden: h ? h.hidden : null, canvas: !!c, w: c ? c.clientWidth : 0, plugin: ${q(".vg-cv")}.style.visibility }; })()`);
    ok(host.there && !host.hidden && host.canvas && host.w > 200, `the library's canvas is shown over the plugin's: ${JSON.stringify(host)}`);
    ok(host.plugin === "hidden", "the plugin's own canvas is put away under it");
    const api = `${D}.scenes()["genome-lib"].api`;
    const fold = await tab.ev(`(() => { const G = ${api}.handle().api.layout(); return { beads: G.beads.length }; })()`);
    ok(fold.beads === data.strand.days.length, `the library folds the plugin's ${data.strand.days.length} days (${fold.beads} beads)`);
    const stat = await tab.ev(`${api}.handle().stat()`);
    ok(/days · .* domains · .* loops/.test(stat) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(stat), `the library's stat line is the plugin's status: ${stat}`);

    // a real click on a note of the fold selects it in the plugin
    const note = await tab.ev(`(() => { const h = ${api}.handle(); for (let y = 100; y < innerHeight - 60; y += 8) for (let x = 60; x < innerWidth - 60; x += 8) { const k = h.keyAt(x, y); if (k && k.kind === "note") return { id: k.id, x, y }; } return null; })()`);
    ok(!!note, "a note of the fold is on screen to click");
    if (note) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: note.x, y: note.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === note.id, "a click on a note of the library's fold selects it in the plugin");
      ok((await tab.ev(`${api}.handle().api.selected()`)) === note.id, "and the library's view marks the same note");
      // the other way round: a note the plugin selects (a search, the sidebar) is marked in the library's view
      const other = await tab.ev(`${api}.handle().api.notes().find(id => id !== ${JSON.stringify(note.id)})`);
      await tab.ev(`window.vaultGraph.focusNote(${JSON.stringify(other)})`); await sleep(400); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === other, "the plugin selected another note (the test's own premise)");
      ok((await tab.ev(`${api}.handle().api.selected()`)) === other, "a note the plugin selects is marked in the library's view");
    }

    // another view: the library's canvas goes away and the plugin's own is back
    await tab.ev(`${D}.setView("2d")`); await sleep(900); await calm();
    const back = await tab.ev(`({ hidden: ${q(".vg-lib")}.hidden, plugin: ${q(".vg-cv")}.style.visibility })`);
    ok(back.hidden === true && back.plugin === "", `leaving the view puts the library's canvas away and the plugin's back: ${JSON.stringify(back)}`);
    ok((await tab.ev("window.__errs")).length === 0, `no page errors: ${JSON.stringify(await tab.ev("window.__errs"))}`);
  } catch (e) { fails.push(e.stack || String(e)); }
  finally { if (tab) await tab.close(); }
  finish(fails, "the graphs library's view works inside the plugin", "a graphs library view fails inside the plugin");
})();
