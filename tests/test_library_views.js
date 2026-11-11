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
    tab = await openPage({ html: env.pageWith(`guideScan: async g => { const s = VGScience.guideSurvey(g); for (const [p, t] of window.__guideNotes || []) s.add(p, t); return s.done(); },`, data) });
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

    // Cas9: a Guide scan's result reaches the library as its scan, and the library finds the same sites the plugin's own Cas9 does
    ok(await tab.ev(`!!${D}.scenes()["cas9-lib"]`), "the plugin has a scene for the library's Cas9");
    const own = `${D}.scenes().cas9.api`, lib = `${D}.scenes()["cas9-lib"].api`;
    await tab.ev(`${D}.setView("cas9")`); await sleep(1200); await calm();
    const ids = await tab.ev(`(() => { const ids = ${own}.layout().all.map(n => n.id); window.__guideNotes = ids.map((id, i) => [id, i % 9 === 4 ? "the fleet word" : i === 7 || i === 30 ? "a fleat" : "nothing"]); return ids; })()`);
    await tab.ev(`${D}.openLens("guide")`); await sleep(300);
    await tab.ev(`(() => { const f = document.querySelector(".vg-guide"); f.querySelector('[data-guide="seq"]').value = "fleet"; f.querySelector('[data-guide="mismatches"]').value = "1"; f.requestSubmit(); })()`); await sleep(600);
    await tab.ev(`${D}.closeLens()`); await sleep(200);
    await tab.ev(`${D}.setView("cas9")`); await sleep(1200); await calm();
    const ownSites = await tab.ev(`${own}.layout().sites.map(n => n.id)`);
    ok(ownSites.length === ids.filter((_, i) => i % 9 === 4).length && ownSites.length > 3, `the plugin's own Cas9 has the scan's ${ownSites.length} sites (the test's own premise)`);
    await tab.ev(`${D}.setView("cas9-lib")`); await sleep(1900); await calm();
    const libSites = await tab.ev(`${lib}.handle().api.layout().sites.map(s => s.id || s)`);
    ok(JSON.stringify(libSites) === JSON.stringify(ownSites), `the library's Cas9 has the same sites as the plugin's: ${libSites.length} of ${ownSites.length}`);
    ok(/fleet/.test(await tab.ev(`${lib}.handle().stat()`)), `its stat line names the guide: ${await tab.ev(`${lib}.handle().stat()`)}`);
    ok((await tab.ev(`${lib}.scanForViews(null)`)) === null, "before a scan the scan input is null");

    // Light cones: a menu view that exists only in the library; a real click on a note selects it and lights its cones
    ok(await tab.ev(`!!${D}.scenes().cones && ${D}.views().includes("cones") && !${D}.scenes().cones.hidden`), "Light cones is a view in the menu");
    await tab.ev(`${D}.setView("cones")`); await sleep(1900); await calm();
    const cones = `${D}.scenes().cones.api`;
    const dated = await tab.ev(`${cones}.handle().api.notes().length`);
    ok(dated >= 10, `the library places the plugin's dated notes (${dated})`);
    // the plugin's selection from the Genome fold above is still picked, so the line is the picked form
    const cstat = await tab.ev(`${cones}.handle().stat()`);
    ok(/dated notes · \d+ links?|in its past/.test(cstat) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(cstat), `its stat line is the plugin's status: ${cstat}`);
    const cnote = await tab.ev(`(() => { const h = ${cones}.handle(); for (let y = 100; y < innerHeight - 60; y += 8) for (let x = 60; x < innerWidth - 60; x += 8) { const k = h.keyAt(x, y); if (k && k.kind === "note") return { id: k.id, x, y }; } return null; })()`);
    ok(!!cnote, "a note of Light cones is on screen to click");
    if (cnote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: cnote.x, y: cnote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === cnote.id, "a click on a note selects it in the plugin");
      ok((await tab.ev(`${cones}.handle().api.selected()`)) === cnote.id && /in its past/.test(await tab.ev(`${cones}.handle().stat()`)), "and Light cones counts its past and future");
    }

    // Load paths: the vault as a truss; a real click on a note selects it in the plugin and shows its bars
    ok(await tab.ev(`!!${D}.scenes().loadpaths && ${D}.views().includes("loadpaths") && !${D}.scenes().loadpaths.hidden`), "Load paths is a view in the menu");
    await tab.ev(`${D}.setView("loadpaths")`); await sleep(1900); await calm();
    const truss = `${D}.scenes().loadpaths.api`;
    const joints = await tab.ev(`${truss}.handle().api.notes().length`);
    ok(joints >= 10, `the library makes joints of the plugin's linked notes (${joints})`);
    const lstat = await tab.ev(`${truss}.handle().stat()`);
    ok((await tab.ev(`${q(".vg-status")}.innerText`)).includes(lstat), `its stat line is the plugin's status: ${lstat}`);
    const lnote = await tab.ev(`(() => { const h = ${truss}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note") return { id: k.id, x, y }; } return null; })()`);
    ok(!!lnote, "a note of Load paths is on screen to click");
    if (lnote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: lnote.x, y: lnote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === lnote.id, "a click on a note selects it in the plugin");
      ok((await tab.ev(`${truss}.handle().api.selected()`)) === lnote.id && /bars? carrying/.test(await tab.ev(`${truss}.handle().stat()`)), "and Load paths gives its bars");
    }

    // Normal modes: the vault as a ringing sheet; a real click on a note selects it in the plugin, and the arrows step the mode
    ok(await tab.ev(`!!${D}.scenes().modes && ${D}.views().includes("modes") && !${D}.scenes().modes.hidden`), "Normal modes is a view in the menu");
    await tab.ev(`${D}.setView("modes")`); await sleep(1900); await calm();
    const drum = `${D}.scenes().modes.api`;
    const hold = await tab.ev(`(${drum}.handle().api.hold(0.25), ${drum}.handle().api.modes().length)`);
    ok(hold >= 9, `the library finds modes in the plugin's linked notes (${hold})`);
    const mstat = await tab.ev(`${drum}.handle().stat()`);
    ok((await tab.ev(`${q(".vg-status")}.innerText`)).includes(mstat), `its stat line is the plugin's status: ${mstat}`);
    const mnote = await tab.ev(`(() => { const h = ${drum}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note") return { id: k.id, x, y }; } return null; })()`);
    ok(!!mnote, "a note of Normal modes is on screen to click");
    if (mnote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: mnote.x, y: mnote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === mnote.id, "a click on a note selects it in the plugin");
      ok((await tab.ev(`${drum}.handle().api.selected()`)) === mnote.id && /in mode 1$/.test(await tab.ev(`${drum}.handle().stat()`)), "and Normal modes gives its swing");
    }

    // Slime mould: the written links as tubes that grow; a real click on a note selects it in the plugin
    ok(await tab.ev(`!!${D}.scenes().slime && ${D}.views().includes("slime") && !${D}.scenes().slime.hidden`), "Slime mould is a view in the menu");
    await tab.ev(`${D}.setView("slime")`); await sleep(1900); await calm();
    const mould = `${D}.scenes().slime.api`;
    const tubes = await tab.ev(`(${mould}.handle().api.setStep(${mould}.handle().api.steps()), ${mould}.handle().api.links())`);
    ok(tubes >= 9, `the library finds tubes in the plugin's linked notes (${tubes})`);
    const sstat = await tab.ev(`${mould}.handle().stat()`);
    ok((await tab.ev(`${q(".vg-status")}.innerText`)).includes(sstat), `its stat line is the plugin's status: ${sstat}`);
    const snote = await tab.ev(`(() => { const h = ${mould}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note") return { id: k.id, x, y }; } return null; })()`);
    ok(!!snote, "a note of Slime mould is on screen to click");
    if (snote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: snote.x, y: snote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === snote.id, "a click on a note selects it in the plugin");
      ok((await tab.ev(`${mould}.handle().api.selected()`)) === snote.id && / links? carry on$/.test(await tab.ev(`${mould}.handle().stat()`)), "and Slime mould gives its links");
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
