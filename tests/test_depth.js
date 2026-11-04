#!/usr/bin/env node
// The 3D layer and the science lenses in a real browser: a nearer thing really hides a farther one whatever order they're drawn in,
// the camera flies, clicks land on what's drawn, the brain has its shape, its neurons fire, and each lens opens with real content.
//   node tests/test_depth.js [--vault [dir]] [--shots dir]        exit 0 = pass; --shots saves what it checked as pictures
const { checks, openPage, tools } = require("./kit");
const env = require("./env");
const fs = require("fs"), path = require("path"), sleep = ms => new Promise(r => setTimeout(r, ms)), shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
(async () => {
  // a task history for the survival lens: the page has no plugin to read journals with, so 80 tasks: half finished over time, half still open
  const history = Array.from({ length: 80 }, (_, i) => { const d = String(1 + i % 28).padStart(2, "0"), done = String(Math.min(28, 2 + i % 28 + (i % 9))).padStart(2, "0"); return { date: `2026-08-${d}`, path: "j.md", tasks: [{ mark: i % 2 ? " " : "x", text: `Task ${i}${i % 4 === 0 ? " with [[A link]]" : ""}${i % 2 ? "" : ` ✅ 2026-08-${done}`}` }] }; });
  const links = env.data().links.filter(l => l.kind === "link"), out = {}; links.forEach(l => { (out[l.source] = out[l.source] || {})[l.target] = 1; });   // the page has no Obsidian index, so direction comes from the data's own order: enough to run the real path
  const tab = await openPage({ html: env.pageWith(`taskHistory: async () => ${JSON.stringify(history)}, writtenLinks: () => (window.__noDir ? null : ${JSON.stringify(out)}),`) });
  const { fails, ok: check } = checks(), shot = name => tools(tab, { shots: SHOTS }).shot(name);
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(1000);
    const D = "window.vaultGraph._debug"; await tab.ev(`document.querySelectorAll(".vg-tour").forEach(x => x.remove())`);
    const hasGl = await tab.ev(`typeof WebGL2RenderingContext !== "undefined" && !!document.createElement("canvas").getContext("webgl2")`);
    // the 2D view stays as it was, and has no GL canvas showing
    await tab.ev(`${D}.setView("2d")`); await sleep(400); await tab.ev(`${D}.drawNow()`);
    check(await tab.ev(`(() => { const g = document.querySelector(".vg-gl"); return !g || g.hidden; })()`), "the GL canvas shows in 2D");
    if (!hasGl) { check(!process.env.CI, "GitHub's browser should have WebGL2 through SwiftShader, or none of this is tested there"); console.log("  (WebGL2 not available: the 3D layer wasn't tested)"); }
    else {
      await tab.ev(`${D}.setView("3d")`); await sleep(2500); await tab.ev(`${D}.drawNow()`);
      const info = await tab.ev(`${D}.gl.info()`); check(info && info.ok, "the 3D view isn't using WebGL"); check(info.sprites > 0, "no notes drawn in WebGL"); check(info.lines > 0, "no links drawn in WebGL");
      check(await tab.ev(`!document.querySelector(".vg-gl").hidden`), "the GL canvas is hidden in 3D");
      // the point of a depth buffer: drawn far-then-near and near-then-far, the near one is what shows
      const order = await tab.ev(`${D}.gl.depthCheck()`); check(order.nearLast[0] > order.nearLast[2] + 80, `near drawn last should show (red): ${order.nearLast}`); check(order.nearFirst[0] > order.nearFirst[2] + 80, `near drawn first should still show, the far one hidden behind it (red): ${order.nearFirst}`);
      // a sphere is lit: bright towards the light, darker away from it, not a flat disc
      const shade = await tab.ev(`${D}.gl.shadeCheck()`); check(shade.lit > shade.away + 40, `a sphere should be lit from one side: ${JSON.stringify(shade)}`);
      // the camera flies: a note nearer the camera grows and shifts more than a far one; zoom scale alone would change both alike
      const fly = await tab.ev(`(() => { const a = ${D}.active(), P = ${D}.P, cam = ${D}.cam; const seen = a.map(n => [n.id, P.get(n.id)]).filter(x => x[1]).sort((x, y) => x[1].depth - y[1].depth), near = seen[0], far = seen[seen.length - 1], s0 = [near[1].s, far[1].s]; cam.d = 300; ${D}.drawNow(); const s1 = [P.get(near[0]).s, P.get(far[0]).s]; cam.d = 0; ${D}.drawNow(); return { near: s1[0] / s0[0], far: s1[1] / s0[1] }; })()`);
      check(fly.near > fly.far + 0.02, `flying in should bring near things up faster than far ones: ${JSON.stringify(fly)}`);
      // a click lands on what's drawn: GL draws where the hit test looks, and each note has the size it was drawn at
      const placed = await tab.ev(`(() => { const a = ${D}.active(), P = ${D}.P, bad = a.filter(n => { const p = P.get(n.id); return p && !(p.r > 0); }).length; return { n: a.length, bad }; })()`); check(placed.n > 0 && placed.bad === 0, `notes with no drawn size: ${placed.bad}`);
      // a lost context drops back to the 2D canvas instead of a blank pane
      const lost = await tab.ev(`(() => { const x = document.querySelector(".vg-gl").getContext("webgl2").getExtension("WEBGL_lose_context"); if (!x) return "none"; window.__lose = x; x.loseContext(); return "lost"; })()`);
      if (lost === "lost") { await sleep(300); await tab.ev(`${D}.drawNow()`); check(await tab.ev(`document.querySelector(".vg-gl").hidden`), "after a lost context the GL canvas should step aside"); check(await tab.ev(`(() => { const c = document.querySelector(".vg-cv"), g = c.getContext("2d"), d = g.getImageData(c.width / 2 - 200, c.height / 2 - 200, 400, 400).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })()`), "after a lost context the 2D canvas should be drawing"); await tab.ev(`window.__lose.restoreContext()`); await sleep(400); }
      // leaving another view, the 3D graph ends up framed, even when the window is slow (the frames that move the notes may lag any timer)
      await tab.ev(`${D}.setView("neural")`); await sleep(600); await tab.ev(`${D}.setView("3d")`); await sleep(4500);
      const frame = await tab.ev(`(() => { ${D}.drawNow(); const P = ${D}.P, W = document.querySelector(".vg-cv").clientWidth, H = document.querySelector(".vg-cv").clientHeight; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const n of ${D}.active()) { const p = P.get(n.id); if (!p) continue; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return { x0, x1, y0, y1, W, H }; })()`);
      check(frame.x0 > -60 && frame.x1 < frame.W + 60 && frame.y0 > -60 && frame.y1 < frame.H + 60, `the 3D graph should end up framed: ${JSON.stringify(frame)}`);
      // the brain
      await tab.ev(`${D}.setView("neural")`); await sleep(2200); await tab.ev(`${D}.drawNow()`);
      const brain = await tab.ev(`${D}.gl.info()`); check(brain.mesh >= 2, `the brain's surface should draw behind and in front: ${brain.mesh}`);
      const shape = await tab.ev(`(() => { const a = ${D}.active().filter(n => !n.person && !n.ghost && !n.moc && n.cluster >= 0 && Math.abs(n.bx) > 0); const span = k => Math.max(...a.map(n => n[k])) - Math.min(...a.map(n => n[k])); return { x: span("bx"), y: span("by"), z: span("bz"), n: a.length, gap: a.filter(n => Math.hypot(n.bx, n.by, n.bz) > 150 && Math.abs(n.bx) < 8).length }; })()`);
      if (shape.n > 40) {   // the sample vault has too few notes to fill the shape
        check(shape.gap === 0, `${shape.gap} cortical notes in the fissure between the hemispheres`); }
      // the Hz and everything else on the readout are explained, one click away, and the card goes away again
      await tab.ev(`${D}.drawNow()`); await sleep(150);
      check(await tab.ev(`(() => { const b = document.querySelector(".vg-viewhelp"), r = b.getBoundingClientRect(); return !b.hidden && r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; })()`), "the neural view's help button should be there to press");
      await tab.ev(`document.querySelector(".vg-viewhelp").click()`); const card = await tab.ev(`(() => { const c = document.querySelector(".vg-viewcard"); return !c.hidden && c.getBoundingClientRect().height > 40 ? c.textContent : ""; })()`); for (const w of ["Hz", "spikes per note", "80/20", "×1/25", "thalamus"]) check(card.includes(w), `the help card should explain ${w}`);
      await tab.ev(`document.querySelector(".vg-viewhelp").click()`); check(await tab.ev(`document.querySelector(".vg-viewcard").hidden`), "the help card should close");
      const before = await tab.ev(`${D}.neuro().spikes`); for (let i = 0; i < 40; i++) { await tab.ev(`${D}.drawNow(performance.now())`); await sleep(50); } const after = await tab.ev(`${D}.neuro()`);
      check(after.spikes > before, `the network should fire: ${before} then ${after.spikes}`); check(after.ok, `a neuron broke the model's limits: ${JSON.stringify(after)}`);
    }
    // every picture of real results explains itself; a game doesn't need it
    const pressed = () => tab.ev(`document.querySelector("[data-dim='3d']").getAttribute("aria-pressed")`);
    await tab.ev(`${D}.setView("2d")`); await sleep(400); check(await tab.ev(`document.querySelector(".vg-viewhelp").hidden`), "the flat graph has nothing to explain");
    if (hasGl) { await tab.ev(`${D}.setView("neural")`); await sleep(300); check(await pressed() === "true", "going from the 2D graph to the 3D brain, the toggle should say 3D"); }
    for (const [v, word] of [["neural", "Hz"], ["foodweb", "trophic"], ["weather", "isobars"], ["cosmos", "Kepler"], ["subway", "Interchange"], ["clock", "dailies"], ["radar", "waited"], ["3d", "orbit"]]) { await tab.ev(`${D}.setView("${v}")`); await sleep(350);
      check(await tab.ev(`!document.querySelector(".vg-viewhelp").hidden`), `${v}: no How to read this`); await tab.ev(`document.querySelector(".vg-viewhelp").click()`); const text = await tab.ev(`document.querySelector(".vg-viewcard").hidden ? "" : document.querySelector(".vg-viewcard").textContent.toLowerCase()`); check(text.includes(word.toLowerCase()), `${v}: the card should mention ${word}: ${text.slice(0, 60)}`); await tab.ev(`document.querySelector(".vg-viewhelp").click()`); }
    // Food web: real levels when direction is known, and a note that links to something sits above it
    await tab.ev(`${D}.setView("foodweb")`); await sleep(1800); await tab.ev(`${D}.drawNow()`);
    check(await tab.waitFor(`/mean level/.test(document.querySelector(".vg-status").textContent) ? 1 : 0`, 4000), "the Food web should report its real levels");
    const web = await tab.ev(`(() => { const a = ${D}.nodes.filter(n => !n.person && !n.ghost && !n.moc && !n.isolated), out = ${JSON.stringify(out)}; let up = 0, down = 0; const by = new Map(a.map(n => [n.id, n])); for (const [s, ts] of Object.entries(out)) for (const t of Object.keys(ts)) { const x = by.get(s), y = by.get(t); if (x && y && !(out[t] && out[t][s])) { if (x.y < y.y - 1) up++; else if (x.y > y.y + 1) down++; } } return { up, down }; })()`);
    { const stat = await tab.ev(`document.querySelector(".vg-status").textContent`), top = parseFloat((stat.match(/top ([\d.]+)/) || [])[1]); check(top > 0 && top < 25, `trophic levels should be believable, not run away round loops: ${stat}`); }
    await shot("foodweb");
    check(web.up > web.down * 3, `a note should mostly sit above what it links to: ${JSON.stringify(web)}`);
    // Weather: real ground in 3D, wind on it, and back to flat
    if (hasGl) { await tab.ev(`${D}.setView("weather")`); await sleep(1500); await tab.ev(`document.querySelector("[data-dim='3d']").click()`); await sleep(1500); await tab.ev(`${D}.drawNow()`);
      const w3 = await tab.ev(`${D}.gl.info()`); check(w3.mesh > 0, "Weather in 3D should draw its ground through WebGL"); check(await tab.ev(`!document.querySelector(".vg-cv").classList.contains("is-tilt3d")`), "Weather in 3D shouldn't also lean the canvas"); check(await tab.ev(`${D}.st.three === true`), "Weather in 3D should orbit");
      await shot("weather3d"); if (SHOTS) { await tab.ev(`(() => { const c = ${D}.cam; c.yaw = 0.8; c.pitch = -1.2; })()`); await sleep(1500); await shot("weather3d-orbit"); await tab.ev(`(() => { const c = ${D}.cam; c.yaw = 0; c.pitch = -0.95; })()`); await sleep(300); }
      const ground = await tab.ev(`${D}.gl.weatherGround()`); check(ground.spread > 0 && ground.low > 1 && ground.high < ground.low, `low pressure should sink behind the plane, below the highest ground: ${JSON.stringify(ground)}`);
      const a = await tab.ev(`${D}.gl.pixelAt(0.5, 0.55)`); check(a[0] + a[1] + a[2] > 20, `the ground should show: ${a}`);
      await tab.ev(`document.querySelector("[data-dim='2d']").click()`); await sleep(1000); await tab.ev(`${D}.drawNow()`); check(await tab.ev(`${D}.st.three === false && document.querySelector(".vg-gl").hidden`), "Weather in 2D goes back to the flat map"); }
    // closing a view gives its WebGL context back: browsers allow only about 16, and the plugin's self-test opens a view every run
    if (hasGl) check(await tab.ev(`(() => { const root = document.createElement("div"); root.style.cssText = "position:absolute;width:900px;height:600px;left:-2000px"; document.body.appendChild(root); const before = document.querySelectorAll(".vg-gl").length, h = mountVaultGraph(root, structuredClone(DATA), { alwaysOn: true }); h.setView("neural"); h._debug.drawNow(); const made = root.querySelectorAll(".vg-gl").length; h.destroy(); root.remove(); return made >= 0 && document.querySelectorAll(".vg-gl").length === before; })()`), "a closed view should release its WebGL canvas");
    // the lenses, each with what makes it that lens; survival and the net compute after opening
    await tab.ev(`${D}.setView("2d")`); await sleep(300);
    for (const [k, words] of [["blast", ["threshold", "R₀", "link to it"]], ["survival", ["median time open", "Kaplan-Meier"]], ["spof", ["cut notes", "robustness R"]], ["netlens", ["small-world", "steps of memory", "Reservoir computing"]], ["control", ["normal range", "How to read this", "Individuals chart"]], ["attention", ["topics last week", "How to read this", "Hill numbers"]], ["flowlens", ["open now", "Little's law"]], ["triage", ["note-years", "note-years owed"]]]) {
      await tab.ev(`${D}.openLens("${k}")`); const done = await tab.waitFor(`(() => { const t = document.querySelector(".vg-lens-body").textContent; return t.trim() && !/^Loading/.test(t.trim()) ? 1 : 0; })()`, 90000); check(done, `${k}: never finished`);
      const text = await tab.ev(`document.querySelector(".vg-lens-body").textContent`); if (!/needs/.test(text.slice(0, 100))) for (const w of words) check(text.includes(w), `${k}: no "${w}"`); check(!/NaN|undefined|Infinity/.test(text), `${k}: shows a broken number: ${(text.match(/.{30}(NaN|undefined|Infinity).{10}/) || [""])[0]}`);
      if (!/needs/.test(text.slice(0, 100))) { if (k !== "triage") check(await tab.ev(`!!document.querySelector(".vg-lens-body .vg-sci-chart path")`), `${k}: no chart`);
        // every number from real results says what it means, in words that show without hovering
        const help = await tab.ev(`(() => { const b = document.querySelector(".vg-lens-body"), tiles = [...b.querySelectorAll(".vg-sci-facts:not(.vg-sci-hazard) > div")]; return { tiles: tiles.length, bare: tiles.filter(t => !(t.querySelector("small") && t.querySelector("small").textContent.trim().length > 15)).map(t => t.textContent), charts: b.querySelectorAll(".vg-sci-chart").length, reads: b.querySelectorAll(".vg-sci-read").length, seen: tiles.every(t => { const s = t.querySelector("small"); return s && s.getBoundingClientRect().height > 0; }) }; })()`);
        check(help.tiles > 0 && !help.bare.length, `${k}: numbers with no helper text: ${help.bare.join(" | ")}`); check(help.seen, `${k}: helper text isn't showing`); check(help.reads >= help.charts, `${k}: ${help.charts} charts but ${help.reads} explanations`); }
    }
    // the slider re-runs Blast radius, and Trace moves the list
    await tab.ev(`${D}.openLens("blast")`); await sleep(200);
    if (await tab.ev(`!!document.querySelector("[data-blast-t]")`)) { const r0 = () => tab.ev(`document.querySelector(".vg-sci-facts b").textContent`), a = await r0(); await tab.ev(`(() => { const s = document.querySelector("[data-blast-t]"); s.value = "0.5"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(300); check(await r0() !== a, "the slider didn't change R0"); }
    await tab.ev(`document.querySelector(".vg-lens-close").click()`);
    console.log(fails.length ? "FAIL - 3D and science lenses:\n  " + fails.join("\n  ") : `ok - depth: ${hasGl ? "occlusion, lighting, flying, the brain's shape, a firing network, a lost context" : "no WebGL here"}; the science lenses open with real content`);
  } finally { await tab.close(); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + (e && e.message || e)); process.exit(1); });
