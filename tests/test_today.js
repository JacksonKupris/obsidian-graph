#!/usr/bin/env node
// The Today list in the graph page: today's three and Next up in the Insights card and the game panel (the same rows),
// a pick's button makes the right write and ticks the pick off, Skip replaces a pick with the next item.
// The page gets recording stand-ins for the plugin's writes.
//   node tests/test_today.js [--vault [dir]]        exit 0 = pass
const cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const rec = k => `async (...a) => { (window.__calls = window.__calls || []).push(["${k}", ...a]); return true; }`;
  const stubs = ["linkNotes", "addToMap", "stampReviewed", "writeNote", "createMap", "dismissPair"].map(k => `${k}: ${rec(k)},`).join(" ");
  const tab = await cdp.open({ html: env.pageWith(stubs), port: 9340 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], ev = e => tab.ev(e);
  const keys = sel => ev(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel + " [data-tkey]")})].map(r => r.dataset.tkey))`).then(JSON.parse);
  const picksDone = () => ev(`JSON.stringify(window.vaultGraph._debug.cos().daily.quests.map(q => [q.key, !!q.done]))`).then(JSON.parse);
  try {
    await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(2500);
    const card = await keys(".vg-review"), picks = await picksDone();
    if (picks.length !== 3) fails.push(`${picks.length} picks, want 3`);
    if (JSON.stringify(card.slice(0, 3)) !== JSON.stringify(picks.map(p => p[0]))) fails.push("the card doesn't start with today's three");
    if (card.length <= 3) fails.push("no Next up rows");
    // the first pick whose action needs no confirmation dialog in this page (add to map), else any: do it
    const target = await ev(`(() => { const rows = [...document.querySelectorAll(".vg-review [data-tkey]")].slice(0, 3);
      const r = rows.find(r => r.dataset.tkey.startsWith("map|")) || rows[0]; const b = r.querySelector("[data-tdo]"); if (!b) return null; b.click(); return r.dataset.tkey; })()`);
    await sleep(500);
    await ev(`(() => { const box = document.querySelector(".vg-confirm, [role=dialog]"); if (!box) return; const ok = [...box.querySelectorAll("button")].find(b => !/cancel/i.test(b.textContent)); if (ok) ok.click(); })()`);
    await sleep(1500);
    const calls = JSON.parse(await ev("JSON.stringify(window.__calls || [])"));
    if (!target) fails.push("the first pick has no action button");
    else {
      const kind = target.split("|")[0], want = { map: "addToMap", link: "linkNotes", write: "writeNote", chart: "createMap", hub: "stampReviewed" }[kind];
      if (want && !calls.some(c => c[0] === want)) fails.push(`doing ${target} called ${JSON.stringify(calls.map(c => c[0]))}, want ${want}`);
      if (kind === "map" && !(await picksDone()).some(([k, d]) => k === target && d)) fails.push("the pick wasn't ticked off after adding it to its map");
    }
    // Skip on an open pick: it leaves today's three and the next item takes its place
    const open = (await picksDone()).find(([, d]) => !d);
    if (open) {
      await ev(`(() => { const r = [...document.querySelectorAll(".vg-review [data-tkey]")].find(r => r.dataset.tkey === ${JSON.stringify(open[0])}); r.querySelector("[data-tskip]").click(); })()`); await sleep(400);
      const after = await picksDone();
      if (after.some(([k]) => k === open[0])) fails.push("a skipped pick stayed in today's three");
      if (after.length !== 3) fails.push(`after a skip: ${after.length} picks, want 3`);
    }
    // the game panel draws the same rows
    await ev(`document.querySelector(".vg-gamebtn").click()`); await sleep(600);
    const panel = await keys(".vg-missions"), card2 = await keys(".vg-review");
    if (JSON.stringify(panel.slice(0, 3)) !== JSON.stringify(card2.slice(0, 3))) fails.push("the game panel's three differ from the card's");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - " + fails.join("; ") : "ok - Today: three picks and Next up, actions write and tick off, Skip replaces");
  process.exit(fails.length ? 1 : 0);
})();
