#!/usr/bin/env node
// The Upkeep list in the graph page: one button, one panel, today's three and Next up. A pick's button makes the right write and
// ticks the pick off, Skip replaces a pick with the next item, and the button's count follows.
// The page gets recording stand-ins for the plugin's writes.
//   node tests/test_today.js [--vault [dir]]        exit 0 = pass
const { sleep, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const rec = k => `async (...a) => { (window.__calls = window.__calls || []).push(["${k}", ...a]); return true; }`;
  const stubs = ["linkNotes", "addToMap", "stampReviewed", "writeNote", "createMap", "dismissPair"].map(k => `${k}: ${rec(k)},`).join(" ");
  const tab = await openPage({ html: env.pageWith(stubs) });
  const fails = [], ev = e => tab.ev(e);
  const keys = sel => ev(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel + " [data-tkey]")})].map(r => r.dataset.tkey))`).then(JSON.parse);
  const picksDone = () => ev(`JSON.stringify(window.vaultGraph._debug.cos().daily.quests.map(q => [q.key, !!q.done]))`).then(JSON.parse);
  try {
    await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(2500);
    await ev(`document.querySelectorAll(".vg-tour").forEach(x => x.remove())`);
    if (await ev(`document.querySelector(".vg-side").textContent.includes("Today's three")`)) fails.push("the sidebar lists the picks too");
    for (const gone of [".vg-reviewbtn", ".vg-review"]) if (await ev(`!!document.querySelector(${JSON.stringify(gone)})`)) fails.push(`${gone} is back: the panel is the one way in`);
    const count = () => ev(`(() => { const c = document.querySelector(".vg-gamecount"); return c.hidden ? 0 : +c.textContent; })()`);
    await ev(`document.querySelector(".vg-gamebtn").click()`); await sleep(600);
    if (!await ev(`document.querySelector(".vg-root").classList.contains("show-missions")`)) fails.push("the Upkeep button didn't open the panel");
    if (await ev(`document.querySelector(".vg-missions").classList.contains("is-collapsed")`)) fails.push("the Upkeep button opened the panel folded");
    const card = await keys(".vg-missions"), picks = await picksDone();
    if (await count() !== picks.filter(p => !p[1]).length) fails.push(`the button says ${await count()}, want ${picks.filter(p => !p[1]).length}`);
    if (picks.length !== 3) fails.push(`${picks.length} picks, want 3`);
    if (JSON.stringify(card.slice(0, 3)) !== JSON.stringify(picks.map(p => p[0]))) fails.push("the card doesn't start with today's three");
    if (card.length <= 3) fails.push("no Next up rows");
    // the first pick whose action needs no confirmation dialog in this page (add to map), else any: do it
    const target = await ev(`(() => { const rows = [...document.querySelectorAll(".vg-missions [data-tkey]")].slice(0, 3);
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
      await ev(`(() => { const r = [...document.querySelectorAll(".vg-missions [data-tkey]")].find(r => r.dataset.tkey === ${JSON.stringify(open[0])}); r.querySelector("[data-tskip]").click(); })()`); await sleep(400);
      const after = await picksDone();
      if (after.some(([k]) => k === open[0])) fails.push("a skipped pick stayed in today's three");
      if (after.length !== 3) fails.push(`after a skip: ${after.length} picks, want 3`);
    }
    if (await count() !== (await picksDone()).filter(p => !p[1]).length) fails.push("the button's count didn't follow the panel");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Upkeep: one button and panel, three picks and Next up, actions write and tick off, Skip replaces");
})();
