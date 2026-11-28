#!/usr/bin/env node
// Populate proposes only what the sky doesn't hold yet, each proposal on its own readable row at phone width, and placing
// another black hole never makes a second "Stale" one (bewildered, returning and phone personas, 2026-11-25).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("mobile: true,", env.data()), mobile: true });
  const { fails, ok: check } = checks();
  try {
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`${D}.openView("cosmos")`); await sleep(1500);
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); document.querySelector(".vg-seedbtn").click()`); await sleep(500);
    const a = JSON.parse(await tab.ev(`(() => { const S = ${D}.saved, notes = ${JSON.stringify(env.data().nodes.map(n => ({ id: n.id, name: n.name })))};
      const maps = ${JSON.stringify((env.data().mocs || []).map(m => [m.id, m.members || []]))}, held = new Set(); S.bodies().filter(b => b.type === "star").forEach(b => { held.add(b.target); (new Map(maps).get(b.target) || []).forEach(id => held.add(id)); });
      const rows = [...document.querySelectorAll(".vg-inspector input[data-seed]")].map(i => i.closest("label")).map(l => { const r = l.getBoundingClientRect(), box = l.querySelector("input").getBoundingClientRect(), name = l.querySelector("b").getBoundingClientRect();
        return { name: l.querySelector("b").textContent, top: r.top, bottom: r.bottom, h: r.height, w: r.width, sameLine: name.top < box.bottom && name.bottom > box.top, inside: name.right <= innerWidth }; });
      return JSON.stringify({ rows, covered: rows.filter(r => notes.some(n => n.name === r.name && held.has(n.id))).map(r => r.name), held: held.size }); })()`));
    check(a.held > 0, "the sky starts with stars that hold notes");
    check(a.rows.length > 0, "something is proposed (the row checks can't fail without it)");
    const subject = n => n.replace(/ - Context$| Context$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const stars = JSON.parse(await tab.ev(`JSON.stringify(${D}.saved.bodies().filter(b => b.type === "star").map(b => b.target))`)).map(id => subject((env.data().nodes.find(n => n.id === id) || {}).name || ""));
    const said = a.rows.map(r => subject(r.name));
    check(!said.some(s => stars.includes(s)), "no proposal repeats a subject that already has a star: " + said.join(", ") + " / sky: " + stars.join(", "));
    check(new Set(said).size === said.length, "one proposal per subject: " + said.join(", "));
    check(!a.covered.length, "nothing already in a star's map is proposed: " + a.covered.join(", "));
    a.rows.forEach((r, i) => {
      check(r.h >= 40 && r.w > 280 && r.sameLine && r.inside, "a proposal is one readable, tappable row: " + JSON.stringify(r));
      if (i) check(r.top >= a.rows[i - 1].bottom - 0.5, `rows ${i - 1} and ${i} don't overlap`);
    });
    await tab.ev(`document.querySelector('[data-seed="cancel"]').click()`);
    const holes = () => tab.ev(`JSON.stringify(${D}.saved.bodies().filter(b => b.type === "blackhole").map(b => b.target))`).then(JSON.parse);
    const before = await holes();
    check(before.includes("stale"), "the first visit places a Stale black hole: " + before);
    for (let i = 0; i < 8; i++) { await tab.ev(`${D}.placeBody("blackhole", 120 + ${i} * 20, 300)`); await sleep(100); }
    const after = await holes();
    check(after.length > before.length, "another black hole can still be placed: " + after);
    check(new Set(after).size === after.length, "no two black holes collect the same thing: " + after);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Populate proposes only new things on readable rows, and black holes don't repeat", "cosmos no duplicates");
})();
