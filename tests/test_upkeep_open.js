#!/usr/bin/env node
// Home's Vault upkeep rows: each can open the note it is about, and "Add to map" still lists it on its map and takes the row off.
// Found 2026-11-24: a row said "Add X to Rental App" with no way to look at X first.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.__calls = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: { addToMap: async (m, ids) => { window.__calls.push(["addToMap", m, ids]); }, openNote: p => window.__calls.push(["openNote", p]), version: "x" }, palette: "obsidian", onPalette: () => {} }); window.vaultHQ.setScreen("home"); })()`);
    await sleep(500);
    const sec = `[...document.querySelectorAll(".vg-hq-sec")].find(x => /Vault upkeep/.test(x.querySelector("h3").textContent))`;
    const rows = await tab.ev(`(() => { const s = ${sec}; return s ? [...s.querySelectorAll(".vg-hq-item")].map(r => ({ key: r.dataset.key, acts: [...r.querySelectorAll("button")].map(b => b.dataset.act) })) : null; })()`);
    check(rows && rows.length > 0, "Home has Vault upkeep rows (the check can't pass without them)");
    for (const r of rows || []) {
      check(r.acts.includes("main"), "a row can list the note on its map: " + r.key);
      check(r.acts.includes("open"), "a row can open the note it is about: " + r.key + " has " + r.acts.join(","));
    }
    await tab.ev(`${sec}.querySelector('[data-act="open"]').click()`); await sleep(300);
    const calls = await tab.ev(`window.__calls`);
    const first = (rows || [])[0] && rows[0].key.split("|")[2];
    check(calls.some(c => c[0] === "openNote" && c[1] === first), "Open opens the note, not the map: " + JSON.stringify(calls) + " wanted " + first);
    await tab.ev(`${sec}.querySelector('[data-act="main"]').click()`); await sleep(400);
    check((await tab.ev(`window.__calls`)).some(c => c[0] === "addToMap"), "Add to map still goes through the shared action");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "upkeep rows open their note and add it to its map");
})();
