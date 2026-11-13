#!/usr/bin/env node
// A view from the graphs library inside the plugin's own page, in headless Chrome: the library's canvas lies over the plugin's
// for the view and is put away for every other view; the library gets the plugin's data and fold, its stat line reaches the
// plugin's status, a real click on a note of the fold selects that note in the plugin, and the plugin's selection is marked
// in the library's view. Each check can fail: the view is looked up by name, so a scene that was never registered fails too.
//   node tests/test_library_views.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const full = env.data(), { fails, ok } = checks();
  // Fed at hub notes, the sample's simulation finds no link worth suggesting, so the main page here is the sample without
  // the hubs that own no topic (Simulate's Add and Decline are pressed on it); the whole sample is opened at the end.
  const BUGS = "02-Projects/Rental App/Rental App Bugs Hub.md", own = new Set(full.mocs.map(m => m.id)), extra = new Set(full.nodes.filter(n => n.moc && !own.has(n.id)).map(n => n.id));
  const data = env.topicMapsOnly(full);
  const D = "window.vaultGraph._debug", q = s => `document.querySelector(${JSON.stringify(s)})`;
  let tab = null;
  try {
    tab = await openPage({ html: env.pageWith(`linkNotes: async (...a) => { (window.__links = window.__links || []).push(a); return true; }, guideScan: async g => { const s = VGScience.guideSurvey(g); for (const [p, t] of window.__guideNotes || []) s.add(p, t); return s.done(); },`, data) });
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

    // a phone has no Escape key: its back gesture is handle.back(), the same step Escape takes. It closes an open lens, then says there is nothing left
    await tab.ev(`window.vaultGraph.openLens("survival")`); await sleep(800);
    ok(await tab.ev(`!${q(".vg-lens")}.hidden`), "a lens is open");
    // each press closes the topmost layer (a first-visit tour, then the lens): the lens is shut within a few presses and then nothing is left
    let presses = 0; while (presses < 6 && await tab.ev(`window.vaultGraph.back()`) === true) presses++;
    ok(presses >= 1 && presses < 6 && await tab.ev(`${q(".vg-lens")}.hidden`), `back closes the lens (${presses} presses)`);
    ok(await tab.ev(`window.vaultGraph.back()`) === false, "with nothing open, back has nothing to close");

    // fresh vault data patched into the page: the library's view is mounted again from it, not left on the old notes
    await tab.ev(`window.__h0 = ${api}.handle()`);
    ok(await tab.ev(`window.vaultGraph.applyLive(structuredClone(${JSON.stringify(data)}))`) === true, "the plugin takes the fresh data in place");
    await tab.ev(`${D}.drawNow()`); await sleep(1500);
    ok(await tab.ev(`!!${api}.handle() && ${api}.handle() !== window.__h0`), "the library's view was mounted again with the fresh data");

    // the library's frame lies under the toolbar, and its stat line (the status pill's) is not drawn twice
    const lay = await tab.ev(`(() => { const f = ${q(".vg-lib .vgv-frame")}, t = ${q(".vg-toolbar")}, s = ${q(".vg-lib .vgv-stat")}; return { frame: f && f.getBoundingClientRect().top, bar: t && t.getBoundingClientRect().bottom, stat: s && getComputedStyle(s).display }; })()`);
    ok(lay.frame !== null && lay.bar !== null && lay.frame >= lay.bar - 1, `the library's frame starts under the toolbar (${JSON.stringify(lay)})`);
    ok(lay.stat === "none", "and its own stat line is not drawn behind the toolbar");

    // a real click on a note of the fold selects it in the plugin
    // the notes of the fold in the open, as the library's own hit test finds them (a few, spread out)
    const cands = await tab.ev(`(() => { const h = ${api}.handle(), seen = new Set(), out = []; for (let y = 100; y < innerHeight - 60; y += 8) for (let x = 60; x < innerWidth - 60; x += 8) { const k = h.keyAt(x, y); if (k && k.kind === "note" && !seen.has(k.id) && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") { seen.add(k.id); out.push({ id: k.id, x, y }); } } return out.filter((c, i) => i % 3 === 0).slice(0, 8); })()`);
    ok(cands.length > 0, "a note of the fold is on screen to click");
    // a click on one of them selects it (a note under a day's bead may open the day instead, so each is tried until one selects: the view must select at least one)
    let note = null;
    for (const c of cands) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      if ((await tab.ev(`window.vaultGraph.viewport().selected`)) === c.id) { note = c; break; }
      await tab.ev(`window.vaultGraph.viewport().selected && window.vaultGraph.select && window.vaultGraph.select(null)`);
    }
    ok(!!note, `a click on a note of the library's fold selects it in the plugin (tried ${cands.length}: ${cands.map(c => c.id.split("/").pop()).join(", ")})`);
    if (note) {
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
    const cnote = await tab.ev(`(() => { const h = ${cones}.handle(); for (let y = 100; y < innerHeight - 60; y += 8) for (let x = 60; x < innerWidth - 60; x += 8) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
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
    const lnote = await tab.ev(`(() => { const h = ${truss}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
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
    const mnote = await tab.ev(`(() => { const h = ${drum}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
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
    const snote = await tab.ev(`(() => { const h = ${mould}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
    ok(!!snote, "a note of Slime mould is on screen to click");
    if (snote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: snote.x, y: snote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === snote.id, "a click on a note selects it in the plugin");
      ok((await tab.ev(`${mould}.handle().api.selected()`)) === snote.id && / links? carry on$/.test(await tab.ev(`${mould}.handle().stat()`)), "and Slime mould gives its links");
    }

    // Slime mould Simulate: Decline is remembered and writes nothing; Add link goes through the shared link action (confirmation, then one write)
    const press = text => tab.ev(`(() => { const b = [...document.querySelectorAll(".vg-lib button")].find(x => x.textContent.trim() === ${JSON.stringify(text)} && x.offsetParent); if (b) b.click(); return !!b; })()`);
    ok(await press("Simulate"), "Slime mould has a Simulate button"); await sleep(2500);
    const firstRow = () => tab.ev(`(() => { const b = [...document.querySelectorAll(".vg-lib button")].find(x => x.textContent.trim() === "Add link" && x.offsetParent); const r = b && [...document.querySelectorAll(".vg-lib .vgv-insights > div")].find(x => x.contains(b)); return r ? r.firstChild.textContent : null; })()`);
    const beforeDecline = await firstRow();
    ok(await press("Decline"), "Simulate suggests links with a Decline button"); await sleep(200);
    ok((await tab.ev(`${mould}.declined().length`)) === 1 && !(await tab.ev(`(window.__links || []).length`)), "Decline is remembered and writes nothing");
    ok((await tab.ev(`JSON.parse(localStorage.getItem("vg-declined-links") || "[]").length`)) === 1, "the decline is kept on this device");
    // the view is mounted again (another view and back): the declined link is not offered again
    await tab.ev(`${D}.setView("2d")`); await sleep(600); await tab.ev(`${D}.setView("slime")`); await sleep(1900); await calm();
    ok(await press("Simulate"), "Simulate is there again after a remount"); await sleep(2500);
    const afterRemount = await firstRow();
    ok(!!beforeDecline && afterRemount !== beforeDecline, `the declined link is not offered again: ${JSON.stringify(afterRemount)}`);
    ok(await press("Add link"), "and an Add link button"); await sleep(300);
    ok(await tab.ev(`!!document.querySelector(".vg-confirm") && /Link these notes/.test(document.querySelector(".vg-confirm").textContent)`), "Add link asks to confirm first");
    ok(!(await tab.ev(`(window.__links || []).length`)), "nothing is written before the confirmation");
    await tab.ev(`document.querySelector('.vg-confirm [data-c="ok"]').click()`); await sleep(300);
    const wrote = await tab.ev(`window.__links || []`);
    ok(wrote.length === 1 && /slime mould/.test(wrote[0][2]), `confirming writes the link once: ${JSON.stringify(wrote)}`);

    // Cyberpunk: the library's 3D city, hidden beside the plugin's own until it has been looked at; a real click on a tower selects its note
    ok(await tab.ev(`!!${D}.scenes()["cyberpunk-lib"] && !!${D}.scenes().cyberpunk`), "the plugin has its own Cyberpunk and a scene for the library's");
    await tab.ev(`${D}.setView("cyberpunk-lib")`); await sleep(1900); await calm();
    const city = `${D}.scenes()["cyberpunk-lib"].api`;
    await tab.ev(`${city}.handle().api.hold()`);
    const towers = await tab.ev(`${city}.handle().api.towers()`);
    ok(towers >= 10, `the library builds towers from the plugin's notes (${towers})`);
    const cstat2 = await tab.ev(`${city}.handle().stat()`);
    // the plugin's selection from the views above is still picked, so the line is the whole city's or the picked tower's
    ok(/( towers? · \d+ dark · \d+ districts?$| in · (dark|busy|dim)| · map of \d+ notes?$)/.test(cstat2) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(cstat2), `its stat line is the plugin's status: ${cstat2}`);
    const tnote = await tab.ev(`(() => { const h = ${city}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
    ok(!!tnote, "a tower of Cyberpunk is on screen to click");
    if (tnote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: tnote.x, y: tnote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === tnote.id, "a click on a tower selects its note in the plugin");
      ok((await tab.ev(`${city}.handle().api.selected()`)) === tnote.id, "and the city marks the same tower");
    }

    // Radar: the library's first flat view, hidden beside the plugin's own; a real click on a blip selects its note
    ok(await tab.ev(`!!${D}.scenes()["radar-lib"] && !!${D}.scenes().radar`), "the plugin has its own Radar and a scene for the library's");
    await tab.ev(`${D}.setView("radar-lib")`); await sleep(1900); await calm();
    const rad = `${D}.scenes()["radar-lib"].api`;
    await tab.ev(`${rad}.handle().api.hold()`);
    ok((await tab.ev(`${rad}.handle().api.blips()`)) >= 1, "the library builds blips from the plugin's notes with open tasks");
    const rstat = await tab.ev(`${rad}.handle().stat()`);
    ok(/^[0-9]+ open tasks? · [0-9]+ notes?$| · [0-9]+ open tasks? · waiting [0-9]+ days$/.test(rstat) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(rstat), `its stat line is the plugin's status: ${rstat}`);
    const rnote = await tab.ev(`(() => { const h = ${rad}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "note" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
    ok(!!rnote, "a blip of Radar is on screen to click");
    if (rnote) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: rnote.x, y: rnote.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`window.vaultGraph.viewport().selected`)) === rnote.id, "a click on a blip selects its note in the plugin");
      ok((await tab.ev(`${rad}.handle().api.selected()`)) === rnote.id, "and Radar marks the same blip");
    }

    // Heat clock: hidden beside the plugin's own; a real click on a cell picks its topic in the library's view
    ok(await tab.ev(`!!${D}.scenes()["clock-lib"] && !!${D}.scenes().clock`), "the plugin has its own Heat clock and a scene for the library's");
    await tab.ev(`${D}.setView("clock-lib")`); await sleep(1900); await calm();
    const clk = `${D}.scenes()["clock-lib"].api`;
    ok((await tab.ev(`${clk}.handle().api.rings()`)) >= 1, "the library builds rings from the plugin's rhythm");
    const hstat = await tab.ev(`${clk}.handle().stat()`);
    ok(/^[0-9]+ topics? · busiest /.test(hstat) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(hstat), `its stat line is the plugin's status: ${hstat}`);
    const hring = await tab.ev(`(() => { const h = ${clk}.handle(); for (let y = 100; y < innerHeight - 60; y += 6) for (let x = 60; x < innerWidth - 60; x += 6) { const k = h.keyAt(x, y); if (k && k.kind === "ring" && (document.elementFromPoint(x, y) || {}).tagName === "CANVAS") return { id: k.id, x, y }; } return null; })()`);
    ok(!!hring, "a cell of the Heat clock is on screen to click");
    if (hring) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x: hring.x, y: hring.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(60); }
      await sleep(300); await calm();
      ok((await tab.ev(`${clk}.handle().api.focus()`)) === hring.id, "a click on a cell picks its topic");
    }

    // Food web (3D): hidden beside the plugin's own; the levels come from the plugin's converter (webForViews), one place
    ok(await tab.ev(`!!${D}.scenes()["foodweb-lib"] && !!${D}.scenes().foodweb`), "the plugin has its own Food web and a scene for the library's");
    await tab.ev(`${D}.setView("foodweb-lib")`); await sleep(1900); await calm();
    const fw = `${D}.scenes()["foodweb-lib"].api`;
    ok((await tab.ev(`${fw}.handle().api.notes()`)) >= 3, "the library builds spheres from the plugin's notes");
    const fstat = await tab.ev(`${fw}.handle().stat()`);
    ok(/^mean level [0-9.]+ · top [0-9.]+ · incoherence [0-9.]+ · [0-9]+ endangered notes?$/.test(fstat) && (await tab.ev(`${q(".vg-status")}.innerText`)).includes(fstat), `its stat line is the plugin's status: ${fstat}`);

    // another view: the library's canvas goes away and the plugin's own is back
    await tab.ev(`${D}.setView("2d")`); await sleep(900); await calm();
    const back = await tab.ev(`({ hidden: ${q(".vg-lib")}.hidden, plugin: ${q(".vg-cv")}.style.visibility })`);
    ok(back.hidden === true && back.plugin === "", `leaving the view puts the library's canvas away and the plugin's back: ${JSON.stringify(back)}`);
    ok((await tab.ev("window.__errs")).length === 0, `no page errors: ${JSON.stringify(await tab.ev("window.__errs"))}`);
    // every hub note is a node of the graph: the library is fed at one that owns no topic, and the main graph lists its notes
    if (!env.VAULT) {
      ok(extra.has(BUGS), "the sample has a hub that owns no topic");
      await tab.close(); tab = await openPage({ html: env.pageWith("", full) });
      if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount with the whole sample");
      await tab.ev(`${D}.setView("slime")`); await sleep(1900);
      const fed = await tab.ev(`${D}.scenes().slime.api.handle().api.hubs()`);
      ok(fed.includes(BUGS), `Slime mould is fed at a hub that owns no topic (${fed.map(h => h.split("/").pop())})`);
      await tab.ev(`${D}.setView("2d")`); await sleep(900); await tab.ev(`window.vaultGraph.restoreViewport({ selected: ${JSON.stringify(BUGS)} })`); await sleep(300);
      const ins = await tab.ev(`(() => { const b = ${q(".vg-inspector")}; return { hidden: b.hidden, text: b.innerText.slice(0, 200), rows: b.querySelectorAll(".vg-sugg").length }; })()`);
      ok(!ins.hidden && /Notes it lists/i.test(ins.text) && ins.rows === 3, `selected in the main graph, that hub lists its three notes: ${JSON.stringify(ins)}`);
    }
  } catch (e) { fails.push(e.stack || String(e)); }
  finally { if (tab) await tab.close(); }
  finish(fails, "the graphs library's view works inside the plugin", "a graphs library view fails inside the plugin");
})();
