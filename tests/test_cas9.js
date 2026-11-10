#!/usr/bin/env node
// The Cas9 scene in headless Chrome: the model's tables add up and its DNA arms keep clear of each other and of the protein;
// every atom is drawn as a lit sphere by the shared WebGL layer, in the model's three colours; every note is a base pair;
// a real click on a gold base pair selects that note and moves the enzyme to it, and Escape comes back to the same turn;
// the site buttons step from match to match; with no guide, and with a guide that matches nothing, it says so and offers
// Guide scan; laid flat it still draws; and the matte finish it asks of the shared layer leaves every other view's shading alone.
//   node tests/test_cas9.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const fs = require("fs"), path = require("path"), env = require("./env"), build = require("../build");
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// ---- the model and the arms, without a browser
function modelChecks(check) {
  const S = new Function(`${build.scienceSource()}; return VGScience;`)();
  const file = path.join(__dirname, "..", "src", "view", "14-cas9-model.js");
  check(fs.existsSync(file), "src/view/14-cas9-model.js is missing: run node scripts/cas9_model.js"); if (!fs.existsSync(file)) return;
  const M = new Function(fs.readFileSync(file, "utf8") + "; return CAS9_MODEL;")();
  const raw = Buffer.from(M.atoms, "base64"), n = raw.length / 3, sum = t => t.reduce((s, r) => s + r[1], 0);
  check(raw.length % 3 === 0 && n > 5000, `the model holds ${n} atoms`);
  check(M.protein + sum(M.rna) + sum(M.target) + sum(M.other) === n, "the model's tables don't add up to its atoms");
  check(M.protein > sum(M.rna) && sum(M.rna) > sum(M.other), "the protein should be the biggest part, then the RNA");
  check(M.flank.length === 7 && M.pam.length === 3 && M.pair.length > 30, "the flank, the PAM or the base pair template is missing");
  check(Math.abs(M.step.rise - 3.3) < 0.3 && Math.abs(M.step.turn * 180 / Math.PI - 35) < 3, `the helix step isn't B-DNA's: ${JSON.stringify(M.step)}`);
  const atoms = []; for (let i = 0; i < n; i++) atoms.push([0, 1, 2].map(k => raw[i * 3 + k] * M.q + M.lo[k]));
  const COUNT = 1200, coil = { lead: 90, ease: 40, radius: 60, pitch: 34 };
  const A = S.helixArm(M.tails.near, COUNT, M.step, { ...coil, axis: [0, 1, 0] }), B = S.helixArm(M.tails.far, COUNT, M.step, { ...coil, axis: [-1, 0, 0] });
  const pt = (X, j) => [X[j * 12], X[j * 12 + 1], X[j * 12 + 2]], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let ab = Infinity, self = Infinity, clear = Infinity;
  for (let i = 0; i < COUNT; i += 3) { const a = pt(A, i), b = pt(B, i);
    for (let j = 0; j < COUNT; j += 3) { ab = Math.min(ab, d(a, pt(B, j))); if (Math.abs(i - j) > 60) self = Math.min(self, d(a, pt(A, j)), d(b, pt(B, j))); }
    if (i >= 40) for (let k = 0; k < n; k += 2) clear = Math.min(clear, d(a, atoms[k]), d(b, atoms[k])); }
  check(ab > 24, `the two DNA arms come within ${ab.toFixed(1)} Å of each other (a helix is 20 Å across)`);
  check(self > 24, `a DNA arm comes within ${self.toFixed(1)} Å of itself`);
  check(clear > 24, `a DNA arm runs within ${clear.toFixed(1)} Å of the complex`);
  check(d(pt(A, 0), M.tails.near.o) < 1e-9 && d(pt(B, 0), M.tails.far.o) < 1e-9, "an arm doesn't start where the crystal's DNA ends");
}

(async () => {
  const { fails, ok: check } = checks();
  try { modelChecks(check); } catch (e) { fails.push(`the model: ${e.stack}`); }
  const D = "window.vaultGraph._debug", S = `${D}.scenes().cas9`, A = `${S}.api`, q = s => `document.querySelector(${JSON.stringify(s)})`;
  const tab = await openPage({ html: env.pageWith(`guideScan: async g => { const s = VGScience.guideSurvey(g); for (const [p, t] of window.__guideNotes) s.add(p, t); return s.done(); },`) });
  const esc = async () => { await tab.ev(`${q(".vg-root")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(250); };
  const frame = async () => { await tab.ev(`${D}.drawNow()`); await sleep(30); };
  const shot = async name => { if (!SHOTS) return; await frame(); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  const clickAt = async (x, y) => {
    await tab.ev(`window.__at = null; if (!window.__listening) { window.__listening = true; ${q(".vg-cv")}.addEventListener("pointermove", e => { window.__at = [e.offsetX, e.offsetY]; }, true); }`);
    let sx = x + 200, sy = y - 60;   // from above: the buttons sit near the canvas's lower edge
    for (let i = 0; i < 12; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sx, y: sy, button: "none" }); await sleep(30);
      const at = await tab.ev("window.__at"); if (!at) { sx += 7; continue; } sx += (x - at[0]) * 0.9; sy += (y - at[1]) * 0.9; }
    for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: sx, y: sy, button: "left", clickCount: 1 });
    await sleep(250);
  };
  const status = () => tab.ev(`${q(".vg-status")}.textContent`);
  const scan = async seq => { await tab.ev(`${D}.openLens("guide")`); await sleep(300);
    await tab.ev(`(() => { const f = document.querySelector(".vg-guide"); f.querySelector('[data-guide="seq"]').value = ${JSON.stringify(seq)}; f.querySelector('[data-guide="mismatches"]').value = "1"; f.requestSubmit(); })()`); await sleep(500); };
  const button = () => tab.ev(`(() => { const cv = ${q(".vg-cv")}; return [cv.clientWidth / 2, cv.clientHeight - (${q(".vg-root")}.classList.contains("is-compact") ? 26 : 58)]; })()`);
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    check((await tab.ev(`${D}.allViews()`)).some(v => v.key === "cas9" && v.menu === "see"), "Cas9 isn't in the view menu");
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.setView("cas9")`); await sleep(1900);
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`); await esc(); await frame();
    // ---- no guide yet: the model is there, every note is a base pair, and the next step is offered
    const plain = await tab.ev(`${D}.nodes.filter(n => !n.ghost && !n.person && !n.moc).length`);
    let L = await tab.ev(`(() => { const L = ${A}.layout(); return { all: L.all.length, placed: L.pos.size, sites: L.sites.length, site: L.site, flank: L.flankIds.length, near: L.nearIds.length, far: L.farIds.length }; })()`);
    check(L.all > 20 && L.all >= plain * 0.9, `${L.all} notes on the strand of ${plain} in the graph`);
    check(L.placed === L.all && L.flank + L.near + L.far === L.all, `${L.placed} of ${L.all} notes have a base pair`);
    check(L.site === null && /no guide/.test(await status()), `with no guide the status says: ${await status()}`);
    check(await tab.ev(`${D}.st.three`) === true, "the scene didn't open in 3D");
    const gl = await tab.ev(`${D}.gl.info()`), drew = await tab.ev(`${A}.drew()`), atoms = await tab.ev(`${A}.parts().n`);
    check(gl && drew && drew.gl === true, `the model isn't drawn by WebGL: ${JSON.stringify(gl)}`);
    check(drew.atoms > atoms * 0.9, `${drew.atoms} spheres drawn for a model of ${atoms} atoms`);
    check(drew.pairs > 0, "no base pair of the arms is drawn");
    // the three colours of the model are on screen: white protein, orange RNA, blue DNA
    const seen = await tab.ev(`(() => { const out = { white: 0, orange: 0, blue: 0, dark: 0 }; for (let i = 1; i < 14; i++) for (let j = 1; j < 14; j++) { const [r, g, b] = ${D}.gl.pixelAt(i / 14, j / 14);
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (r > 45 && hi - lo < hi * 0.18 + 12) out.white++; else if (r > 110 && r > b * 2 && r > g * 1.5) out.orange++; else if (b > 70 && b > r * 1.4) out.blue++; else if (r + g + b < 90) out.dark++; } return out; })()`);
    check(seen.white > 8 && seen.blue > 0 && seen.dark > 10, `the picture isn't a white protein on blue DNA against the dark: ${JSON.stringify(seen)}`);
    await shot("no-guide");
    const [bx, by] = await button(); await clickAt(bx, by);
    check(await tab.ev(`!!document.querySelector(".vg-guide")`), "the Open Guide scan button didn't open Guide scan");
    // ---- a scan: every ninth note says the guide's word, two say nearly it
    const ids = await tab.ev(`(() => { const ids = ${A}.layout().all.map(n => n.id); window.__guideNotes = ids.map((id, i) => [id, i % 9 === 4 ? "the fleet word" : i === 7 || i === 30 ? "a fleat" : "nothing"]); return ids; })()`);
    const want = ids.filter((_, i) => i % 9 === 4);
    await scan("fleet"); await tab.ev(`${D}.closeLens()`); await sleep(200); await frame(); await frame();
    L = await tab.ev(`(() => { const L = ${A}.layout(); return { sites: L.sites.map(n => n.id), site: L.site, near: [...L.hits].filter(h => h[1] === "near").length, held: L.where.get(L.site), pos: L.pos.get(L.site) }; })()`);
    check(JSON.stringify(L.sites) === JSON.stringify(want), `the sites are ${L.sites.length} notes, not the ${want.length} that say the word`);
    check(L.site === want[0] && L.held === "held" && L.pos.every(v => v === 0), `Cas9 isn't on the first match: ${L.site}`);
    check(L.near === 2, `${L.near} look-alikes, not 2`);
    let st = await status(); check(st.includes("fleet") && st.includes(`exact in ${want.length} notes`) && /look-alikes in 2/.test(st), `the status line: ${st}`);
    check(await tab.ev(`!!${D}.P.get(${JSON.stringify(want[0])})`), "the note Cas9 holds can't be clicked");
    await shot("site");
    // ---- a real click on a gold base pair selects its note and moves the enzyme there; Escape comes back to the same turn
    await tab.ev(`${A}.still()`);
    const target = await tab.ev(`(() => { const cv = ${q(".vg-cv")}, r = cv.getBoundingClientRect(), L = ${A}.layout(); for (const n of L.sites) { if (n.id === L.site || L.where.get(n.id) === "flank") continue; const p = ${A}.at(n.id);
      if (p && p.x > 30 && p.y > 80 && p.x < cv.clientWidth - 30 && p.y < cv.clientHeight - 110 && document.elementFromPoint(r.left + p.x, r.top + p.y) === cv) return { id: n.id, x: p.x, y: p.y }; } return null; })()`);
    check(target, "no gold base pair of the arms is on screen to click");
    if (target) {
      const yaw0 = await tab.ev(`${A}.yaw()`);
      await clickAt(target.x, target.y); await frame();
      check(await tab.ev(`${D}.st.selected`) === target.id, `a click selected ${await tab.ev(`${D}.st.selected`)}, not the base pair under the pointer ${target.id}`);
      check(await tab.ev(`${A}.layout().site`) === target.id, "a click on a gold base pair didn't move Cas9 to it");
      await shot("clicked"); await esc(); await frame();
      check(await tab.ev(`${D}.st.selected`) == null && await tab.ev(`${D}.st.view`) === "cas9" && Math.abs(await tab.ev(`${A}.yaw()`) - yaw0) < 1e-9, "Escape didn't come back to the same view and turn");
      check(await tab.ev(`${A}.layout().site`) === target.id, "Escape moved Cas9 off the site");
    }
    // ---- stepping: the next site, round to the first; the today strip offers the same step
    const at0 = await tab.ev(`${A}.layout().site`); await tab.ev(`${A}.step(1)`); await frame();
    const at1 = await tab.ev(`${A}.layout().site`); check(at1 === want[(want.indexOf(at0) + 1) % want.length], "Next site didn't go to the next match");
    await tab.ev(`${A}.step(-1)`); await frame(); check(await tab.ev(`${A}.layout().site`) === at0, "Previous site didn't come back");
    const today = await tab.ev(`(() => { const t = ${S}.today(); return t && { text: t.text, label: t.label }; })()`);
    check(today && /site \d+ of/.test(today.text) && today.label === "Next site", `the today strip: ${JSON.stringify(today)}`);
    // the button under the model names the site and opens it
    await tab.ev(`${A}.still()`); const [nx, ny] = await button(); await clickAt(nx, ny);
    check(await tab.ev(`${D}.st.selected`) === at0, "the site's button didn't open its note"); await esc(); await frame();
    // ---- a drag turns the model
    const yaw1 = await tab.ev(`${A}.yaw()`), cvr = await tab.ev(`(() => { const r = ${q(".vg-cv")}.getBoundingClientRect(); return [r.left + 60, r.top + r.height * 0.3]; })()`);
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cvr[0], y: cvr[1], button: "none" });
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cvr[0], y: cvr[1], button: "left", clickCount: 1 });
    for (let i = 1; i <= 6; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cvr[0] + i * 25, y: cvr[1], button: "left", buttons: 1 }); await sleep(20); }
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cvr[0] + 150, y: cvr[1], button: "left", clickCount: 1 }); await sleep(120);
    check(Math.abs(await tab.ev(`${A}.yaw()`) - yaw1) > 0.05, "a drag didn't turn the model"); await tab.ev(`${A}.still()`); await shot("turned");
    // ---- a guide that matches nothing: said, with the way back to Guide scan
    await scan("zzqqxx"); await tab.ev(`${D}.closeLens()`); await sleep(200); await frame(); await frame();
    st = await status(); check(/no match/.test(st) && await tab.ev(`${A}.layout().site`) === null, `a guide with no match: ${st}`);
    const [ex, ey] = await button(); await clickAt(ex, ey); check(await tab.ev(`!!document.querySelector(".vg-guide")`), "with no match, the button didn't open Guide scan");
    await tab.ev(`${D}.closeLens()`); await sleep(150);
    // ---- laid flat it still draws, without WebGL
    await tab.ev(`${q('[data-dim="2d"]')}.click()`); await sleep(900); await frame();
    const flat = await tab.ev(`${A}.drew()`); check(flat && flat.gl === false && flat.atoms > atoms * 0.5, `flat, the model isn't painted: ${JSON.stringify(flat)}`); await shot("flat");
    await tab.ev(`${q('[data-dim="3d"]')}.click()`); await sleep(900); await frame();
    check((await tab.ev(`${A}.drew()`)).gl === true, "standing it up again didn't bring WebGL back");
    // ---- the matte finish is asked for, not the default: a sphere drawn as before keeps its highlight
    const gloss = await tab.ev(`${D}.gl.shadeCheck()`), matte = await tab.ev(`${D}.gl.shadeCheck(1)`);
    check(gloss && matte && gloss.spec > matte.spec + 15, `matte should take the highlight off, and only when asked: ${JSON.stringify({ gloss, matte })}`);
    // ---- a frame is quick enough to turn by hand
    await tab.ev(`${D}.setView("cas9")`); await sleep(300); await frame();
    const ms = []; for (let i = 0; i < 5; i++) ms.push(await tab.ev(`${D}.drawNow()`)); ms.sort((a, b) => a - b);
    console.log(`  a frame of the model: ${ms[2].toFixed(1)} ms (software WebGL)`); check(ms[2] < 120, `a frame takes ${ms[2].toFixed(0)} ms`);
    // another scene after it is flat again
    await tab.ev(`${D}.setView("subway")`); await sleep(1500);
    check(await tab.ev(`${D}.st.three`) === false, "the scene opened after it stayed in 3D");
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(String(e.stack || e)); }
  await tab.close();
  finish(fails, "Cas9: the model's tables and arms, atoms as lit spheres in three colours, a base pair a note, clicks, Escape, stepping, the empty states, flat, matte only when asked", "cas9");
})();
