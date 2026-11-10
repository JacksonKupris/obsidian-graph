#!/usr/bin/env node
// Genome fold in headless Chrome: the journals' strand is folded in real 3D (a scene with space: true keeps its notes' depth,
// opens turned, and a drag turns it), every day has a bead, a real click on a note selects it and Escape puts everything back
// where it was, a real click on a day opens that day's journal, a loop shows the notes its two days share, the 2D/3D switch
// lays it flat and stands it up again, and with no journals it says what it needs and offers the graph.
//   node tests/test_genome.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const fs = require("fs"), path = require("path"), env = require("./env");
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
(async () => {
  const data = env.data(), { fails, ok: check } = checks();
  const opened = "openNote: (p, pane) => { (window.__opened = window.__opened || []).push(p); },";
  const D = "window.vaultGraph._debug", S = `${D}.scenes().genome`, A = `${S}.api`, q = s => `document.querySelector(${JSON.stringify(s)})`;
  const mount = async d => { const tab = await openPage({ html: env.pageWith(opened, d) });
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.setView("genome")`); await sleep(1900);
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.drawNow()`); return tab; };
  // a real click at a place on the canvas (canvas coordinates): the mouse is walked there, as a person's would be
  const clickAt = async (tab, x, y) => {
    await tab.ev(`window.__at = null; if (!window.__listening) { window.__listening = true; ${q(".vg-cv")}.addEventListener("pointermove", e => { window.__at = [e.offsetX, e.offsetY]; }, true); }`);
    let sx = x + 300, sy = y + 80;
    for (let i = 0; i < 12; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sx, y: sy, button: "none" }); await sleep(30);
      const at = await tab.ev("window.__at"); if (!at) { sx += 7; continue; } sx += (x - at[0]) * 0.9; sy += (y - at[1]) * 0.9; }
    for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: sx, y: sy, button: "left", clickCount: 1 });
    await sleep(200); return [sx, sy];
  };
  let tab = null;
  try {
    check(data.strand && data.strand.days.length >= 20, "the sample data has no strand of journals to fold");
    tab = await mount();
    const frame = async () => { await tab.ev(`${D}.drawNow()`); await sleep(30); };
    const shot = async name => { if (!SHOTS) return; await frame(); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
    const pressed = () => tab.ev(`(document.querySelector('[data-dim][aria-pressed="true"]') || {dataset: {}}).dataset.dim`);
    // the fold: a bead for every day, with depth
    const fold = await tab.ev(`(() => { const G = ${A}.fold(); return { n: G.fold.n, beads: G.beads.length, deep: G.beads.filter(b => Math.abs(b[2]) > 5).length, notes: G.pos.size, domains: G.fold.domains.length, loops: G.fold.loops.length, stress: G.fold.stress }; })()`);
    check(fold.n === data.strand.days.length && fold.beads === fold.n, `${fold.beads} beads for ${data.strand.days.length} days`);
    check(fold.deep > fold.n / 4, `only ${fold.deep} of ${fold.n} days have any depth: the fold is flat`);
    check(fold.notes >= 10, `only ${fold.notes} notes are placed on the fold`);
    // real space: it opens in 3D, and the notes keep the depth the layout gave them
    check(await tab.ev(`${D}.st.three`) === true, "a scene in real space didn't open in 3D");
    check(await pressed() === "3d", "the 2D/3D switch doesn't say 3D");
    const depth = await tab.ev(`(() => { const G = ${A}.fold(); let off = 0, deep = 0; G.pos.forEach((p, id) => { const n = ${D}.nodes().find(x => x.id === id); if (Math.abs(n.z - p[2]) > 1e-6 || Math.abs(n.x - p[0]) > 1e-6) off++; if (Math.abs(n.z) > 5) deep++; }); return { off, deep }; })()`);
    check(depth.off === 0, `${depth.off} notes aren't where the fold put them`);
    check(depth.deep > 5, `only ${depth.deep} notes have any depth: the layout's third number was dropped`);
    const drawn = await tab.ev(`(() => { const G = ${A}.fold(); let n = 0; G.pos.forEach((p, id) => { const s = ${D}.P.get(id); if (s && s.r >= 6) n++; }); return n; })()`);
    check(drawn === fold.notes, `${drawn} of ${fold.notes} notes can be clicked`);
    const status = await tab.ev(`${q(".vg-status")}.textContent`);
    check(status.includes(`${fold.n} days`) && status.includes(`stress ${fold.stress.toFixed(2)}`), `the status line doesn't give the days and the stress: ${status}`);
    await shot("fold");
    // a real click on a note selects it; Escape puts everything back, the turn included
    const where = id => tab.ev(`(() => { const p = ${D}.P.get(${JSON.stringify(id)}); return p ? [p.x, p.y] : null; })()`);
    const target = await tab.ev(`(() => { const cv = ${q(".vg-cv")}, G = ${A}.fold(); let best = null; G.pos.forEach((_, id) => { const p = ${D}.P.get(id); if (!p || best || p.x < cv.clientWidth * 0.25 || p.x > cv.clientWidth * 0.75 || p.y < cv.clientHeight * 0.25 || p.y > cv.clientHeight * 0.75) return;
      let clear = true; ${D}.P.forEach((o, oid) => { if (oid !== id && Math.hypot(o.x - p.x, o.y - p.y) < o.r + p.r + 6) clear = false; }); if (clear) best = { id, x: p.x, y: p.y }; }); return best; })()`);
    check(target, "no note stands clear in the middle of the fold to click");
    if (target) {
      const yaw0 = await tab.ev(`${A}.yaw()`);
      await clickAt(tab, target.x, target.y);
      check(await tab.ev(`${D}.st.selected`) === target.id, `a click selected ${await tab.ev(`${D}.st.selected`)}, not the note under the pointer ${target.id}`);
      await shot("selected");
      await tab.ev(`${q(".vg-root")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(250); await frame();
      const back = await where(target.id);
      check(await tab.ev(`${D}.st.selected`) == null, "Escape didn't close the note");
      check(await tab.ev(`${D}.st.view`) === "genome" && Math.abs(await tab.ev(`${A}.yaw()`) - yaw0) < 1e-9 && back && Math.hypot(back[0] - target.x, back[1] - target.y) < 1.5, "Escape didn't come back to the same place and turn");
    }
    // a drag on empty space turns the fold: the notes move on screen, not in the fold
    if (target) {
      const before = await where(target.id), world = await tab.ev(`(() => { const n = ${D}.nodes().find(x => x.id === ${JSON.stringify(target.id)}); return [n.x, n.y, n.z]; })()`);
      const empty = await tab.ev(`(() => { const cv = ${q(".vg-cv")}, r = cv.getBoundingClientRect(); for (let y = cv.clientHeight - 30; y > 60; y -= 20) for (let x = 30; x < cv.clientWidth - 30; x += 20) { let clear = true; ${D}.P.forEach(o => { if (Math.hypot(o.x - x, o.y - y) < o.r + 30) clear = false; }); if (clear && document.elementFromPoint(r.left + x, r.top + y) === cv) return [r.left + x, r.top + y]; } return null; })()`);
      check(empty, "no empty space on the canvas to drag");
      if (empty) {
        await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: empty[0], y: empty[1], button: "none" });
        await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: empty[0], y: empty[1], button: "left", clickCount: 1 });
        for (let i = 1; i <= 6; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: empty[0] + i * 25, y: empty[1], button: "left", buttons: 1 }); await sleep(20); }
        await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: empty[0] + 150, y: empty[1], button: "left", clickCount: 1 }); await sleep(120); await frame();
        const after = await where(target.id), world2 = await tab.ev(`(() => { const n = ${D}.nodes().find(x => x.id === ${JSON.stringify(target.id)}); return [n.x, n.y, n.z]; })()`);
        check(after && Math.hypot(after[0] - before[0], after[1] - before[1]) > 4, "a drag didn't turn the fold");
        check(world.every((v, i) => Math.abs(v - world2[i]) < 1e-6), "a drag moved the note in the fold, not the view of it");
      }
    }
    // a real click on a day opens that day's journal
    const bead = await tab.ev(`(() => { const cv = ${q(".vg-cv")}, r = cv.getBoundingClientRect(), G = ${A}.fold(); for (let i = G.fold.n - 1; i >= 0; i--) { const p = ${A}.at(i); if (!p || p.x < 20 || p.y < 20 || p.x > cv.clientWidth - 20 || p.y > cv.clientHeight - 20) continue;
      let clear = document.elementFromPoint(r.left + p.x, r.top + p.y) === cv; ${D}.P.forEach(o => { if (Math.hypot(o.x - p.x, o.y - p.y) < o.r + 14) clear = false; });
      for (let j = 0; j < G.fold.n && clear; j++) { const o = j !== i && ${A}.at(j); if (o && Math.hypot(o.x - p.x, o.y - p.y) < 12) clear = false; }
      if (clear) return { i, x: p.x, y: p.y, path: G.strand.paths[i], inGraph: !!${D}.nodes().find(n => n.id === G.strand.paths[i]) }; } return null; })()`);
    check(bead, "no day stands clear on the fold to click");
    if (bead) {
      await tab.ev(`window.__opened = []; ${D}.st.selected = null`); await clickAt(tab, bead.x, bead.y);
      const got = bead.inGraph ? await tab.ev(`${D}.st.selected`) : (await tab.ev(`window.__opened`))[0];
      check(got === bead.path, `a click on day ${bead.i} opened ${got}, not its journal ${bead.path}`);
      check(/Journal\/\d{4}-\d\d-\d\d\.md$/.test(bead.path), `a day's note isn't a journal: ${bead.path}`);
      await tab.ev(`${D}.st.selected && ${q(".vg-root")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    }
    // a loop shows the notes its two days share
    check(fold.loops > 0, "the sample's journals fold with no loop");
    if (fold.loops) {
      const shared = await tab.ev(`(() => { const G = ${A}.fold(), l = G.fold.loops[0]; ${A}.showLoop(0); const a = new Set(G.strand.rows[l.a]), both = G.strand.rows[l.b].filter(j => a.has(j)).map(j => G.strand.ids[j]), lit = [...(${D}.st.highlight || [])]; return { want: [...new Set(both)].sort(), lit: lit.sort(), count: l.count }; })()`);
      check(shared.lit.length > 0 && shared.lit.every(id => shared.want.includes(id)), `the loop lit ${shared.lit.length} notes that aren't all named on both its days`);
      const today = await tab.ev(`(() => { const t = ${S}.today(); return t && t.text; })()`);
      check(today && today.includes("Strongest loop"), `the today strip doesn't name the strongest loop: ${today}`);
      await shot("loop");
    }
    // the 2D/3D switch lays it flat and stands it up again
    await tab.ev(`${q('[data-dim="2d"]')}.click()`); await sleep(900); await frame();
    check(await tab.ev(`${D}.st.three`) === false && await pressed() === "2d", "the switch didn't lay the fold flat");
    check(await tab.ev(`${q(".vg-cv")}.classList.contains("is-tilt3d")`) === false, "flat, the canvas leans back as a picture would");
    await shot("flat");
    await tab.ev(`${q('[data-dim="3d"]')}.click()`); await sleep(900); await frame();
    check(await tab.ev(`${D}.st.three`) === true && await pressed() === "3d" && Math.abs(await tab.ev(`${A}.yaw()`)) > 0.1, "the switch didn't stand the fold up again");
    // another scene after it is flat again, with no depth left on its notes
    await tab.ev(`${D}.setView("subway")`); await sleep(1500);
    check(await tab.ev(`${D}.st.three`) === false && await tab.ev(`${D}.nodes().filter(n => ${D}.maps().subway.pos.has(n.id) && Math.abs(n.z) > 1e-6).length`) === 0, "the scene opened after it kept the fold's depth");
    let errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
    await tab.close(); tab = null;
    // no journals: it says what it needs, and its button opens the graph
    tab = await mount({ ...data, strand: { days: [], paths: [], ids: [], rows: [] } });
    const st2 = await tab.ev(`${q(".vg-status")}.textContent`); check(st2.includes("0 days of journals"), `with no journals the status says: ${st2}`);
    if (SHOTS) { const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, "empty.png"), Buffer.from(r.result.data, "base64")); }
    const mid = await tab.ev(`[${q(".vg-cv")}.clientWidth / 2, ${q(".vg-cv")}.clientHeight / 2 + 25]`);
    await clickAt(tab, mid[0], mid[1]); await sleep(300);
    check(await tab.ev(`${D}.st.view`) === "2d", "the empty fold's button didn't open the graph");
    errs = await tab.ev("window.__errs"); check(!errs.length, "page errors with no journals: " + errs.join("; "));
    console.log(`  genome: ${fold.n} days, ${fold.notes} notes, ${fold.domains} domains, ${fold.loops} loops, stress ${fold.stress.toFixed(2)}`);
  } catch (e) { fails.push(e.message); }
  if (tab) await tab.close();
  finish(fails, "Genome fold: real 3D with depth kept, clicks on notes and days, Escape back to the same turn, loops, flat and back, the empty state", "genome");
})();
