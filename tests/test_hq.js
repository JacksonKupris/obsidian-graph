#!/usr/bin/env node
// Vault HQ in a browser: every screen draws from the one Today list with no errors; each kind of item's buttons make
// the right write (Done, Later with Undo, Delegate, Accept, Reject with a reason, Open); every button on every screen
// can be clicked; an empty vault, a vault with no HQ notes and a phone-width pane have no dead ends and no sideways
// scroll. The page gets recording stand-ins for the plugin's actions.
//   node tests/test_hq.js [--vault [dir]]        exit 0 = pass
const cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rec = k => `${k}: async (...a) => { (window.__calls = window.__calls || []).push(["${k}", ...a]); return true; },`;
const OPTS = `api: { ${["setTaskStatus", "completeTask", "logWork", "setTasksStatus", "setTaskField", "setNoteStatus", "setProjectStatus", "hqMark", "openNote", "openDaily"].map(rec).join(" ")} },
  ask: async (...a) => { (window.__asked = window.__asked || []).push(a); return true; }, input: async () => "Not what we need", openGraph: () => { (window.__calls = window.__calls || []).push(["openGraph"]); },
  __errs: (addEventListener("error", e => (window.__errs = window.__errs || []).push(e.message)), addEventListener("unhandledrejection", e => (window.__errs = window.__errs || []).push(String(e.reason))), 0),`;

async function page(html, o = {}) {
  const tab = await cdp.open({ html, port: 9350, mobile: o.mobile });
  if (!tab) return null;
  await tab.waitFor("window.vaultHQ ? 1 : 0", 20000);
  return tab;
}
(async () => {
  const fails = [];
  const tab = await page(env.hqPage(OPTS));
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const ev = e => tab.ev(e), calls = async () => JSON.parse(await ev("JSON.stringify(window.__calls || [])"));
  const errs = async () => JSON.parse(await ev("JSON.stringify(window.__errs || [])"));
  const screen = async s => { await ev(`window.vaultHQ.setScreen(${JSON.stringify(s)})`); await sleep(150); };
  const items = () => ev("JSON.stringify(window.vaultHQ.items().map(i => [i.key, i.kind, i.group]))").then(JSON.parse);
  // click a button on an item's row (or anywhere when no key): resolves what it clicked
  const click = (sel, key) => ev(`(() => { const rows = ${key ? `[...document.querySelectorAll(".vg-hq-item")].filter(r => r.dataset.key === ${JSON.stringify(key)})` : "[document]"};
    const b = rows.map(r => r.querySelector(${JSON.stringify(sel)})).find(Boolean); if (!b) return null; b.click(); return b.textContent.trim(); })()`);
  try {
    const all = await items(), kinds = new Set(all.map(i => i[1])), H = env.rules.hq || {};
    // every screen draws
    for (const s of ["home", "today", "needs", "projects"]) {
      await screen(s);
      const n = await ev(`document.querySelectorAll(".vg-hq-main button").length`);
      if (!n) fails.push(`${s}: nothing to click`);
      if (await ev(`document.querySelector(".vg-hq-dockbtn.is-on").dataset.go`) !== s) fails.push(`${s}: the dock doesn't show it`);
    }
    if (!env.VAULT) {   // the sample vault has one of each kind
      ["task", "plan", "carried", "approval", "review", "job", "backlog", "report"].forEach(k => { if (!kinds.has(k)) fails.push(`no ${k} item on the sample vault`); });
      await screen("home");
      if (await ev(`document.querySelectorAll(".vg-hq-feedcard").length`) < 5) fails.push("the feed has fewer than 5 cards");
      // Today: Done on a task checks it off in its journal; Later marks it for the day, with an Undo that takes it back
      await screen("today");
      const task = all.find(i => i[1] === "task"), carried = all.filter(i => i[1] === "carried"), plan = all.find(i => i[1] === "plan");
      await ev("window.__calls = []");
      await click('[data-act="main"]', task[0]); await sleep(300);
      let c = await calls();
      if (!(c[0] && c[0][0] === "completeTask" && c[0][1] === task[0].split("|")[1])) fails.push(`Done on a task called ${JSON.stringify(c[0])}, want completeTask (journal + standup)`);
      if ((await items()).some(i => i[0] === task[0])) fails.push("a task done is still listed");
      await ev("window.__calls = []");
      await click('[data-act="later"]', carried[0][0]); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "hqMark" && c[0][1] === carried[0][0] && c[0][2] === "later")) fails.push(`Later called ${JSON.stringify(c[0])}`);
      await click("[data-undo]"); await sleep(300);
      c = await calls();
      if (!(c[1] && c[1][0] === "hqMark" && c[1][2] === null)) fails.push(`Undo after Later called ${JSON.stringify(c[1])}`);
      await ev("window.__calls = []");
      await click('[data-act="delegate"]', carried[1][0]); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "setTaskField" && c[0][4] === H.delegate_field && c[0][5] === H.delegate_to)) fails.push(`Delegate called ${JSON.stringify(c[0])}`);
      await ev("window.__calls = []");
      await click('[data-act="main"]', plan[0]); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "hqMark" && c[0][2] === "done" && c[1] && c[1][0] === "logWork")) fails.push(`Done on a plan item called ${JSON.stringify(c.slice(0, 2))}, want hqMark done + logWork`);
      await click("[data-undo]"); await sleep(300);
      c = await calls();
      if (!c.some(x => x[0] === "hqMark" && x[1] === plan[0] && x[2] === null)) fails.push("Undo after a plan item's Done doesn't take the mark back");
      // the sweep: the oldest day first; Done all sends that day's tasks in one batch (no standup line); Keep writes nothing
      await ev("window.vaultHQ.update(null, null)"); await screen("today");
      await click('[data-go="sweep"]'); await sleep(200);
      if (await ev("window.vaultHQ.screen()") !== "sweep") fails.push("Today has no way into the sweep");
      const days = await ev(`[...document.querySelectorAll(".vg-hq-sweep")].map(s => s.dataset.day)`);
      if (JSON.stringify(days) !== JSON.stringify([...days].sort())) fails.push("the sweep isn't oldest first");
      const oldest = all.filter(i => i[1] === "carried" && i[0].includes(`/${days[0]}.md|`)).length;
      await ev("window.__calls = []");
      await ev(`document.querySelector('[data-batch="x"][data-day="${days[0]}"]').click()`); await sleep(300);
      c = await calls();
      if (!(c.length === 1 && c[0][0] === "setTasksStatus" && c[0][1].length === oldest && c[0][2] === "x")) fails.push(`Done all on ${days[0]} called ${JSON.stringify(c.map(x => [x[0], (x[1] || []).length, x[2]]))}, want one setTasksStatus of ${oldest}`);
      await ev("window.__calls = []");
      await ev(`document.querySelector('[data-batch="keep"]').click()`); await sleep(150);
      if ((await calls()).length) fails.push("Keep all wrote something");
      if (await ev(`[...document.querySelectorAll(".vg-hq-sweep")].length`) !== days.length - 2) fails.push("a swept day is still on the sweep");
      // report rows: Review rows opens them; Tick and Skip write the row in the report
      await ev("window.vaultHQ.update(null, null)"); await screen("needs");
      const report = all.find(i => i[1] === "report");
      await click('[data-act="rows"]', report[0]); await sleep(200);
      if (await ev("window.vaultHQ.screen()") !== "rows") fails.push("Review rows doesn't open the rows");
      const nrows = await ev(`document.querySelectorAll("[data-row]").length / 2`);
      await ev("window.__calls = []");
      await ev(`document.querySelector('[data-row="x"]').click()`); await sleep(300);
      await ev(`document.querySelector('[data-row="-"]').click()`); await sleep(300);
      c = await calls();
      const path = report[0].split("|")[1];
      if (!(c.length === 2 && c[0][0] === "setTaskStatus" && c[0][1] === path && c[0][4] === "x" && c[1][4] === "-")) fails.push(`Tick then Skip called ${JSON.stringify(c)}`);
      if (await ev(`document.querySelectorAll("[data-row]").length / 2`) !== nrows - 2) fails.push("ticked rows are still listed");
      // Needs you: Accept and Reject a draft, Open an approval
      await screen("needs");
      const review = all.find(i => i[1] === "review"), approval = all.find(i => i[1] === "approval");
      await ev("window.__calls = []");
      await click('[data-act="reject"]', review[0]); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "setNoteStatus" && c[0][2] === "rejected" && c[0][3] === "Not what we need")) fails.push(`Reject called ${JSON.stringify(c[0])}`);
      await ev("window.vaultHQ.update(null, null)"); await sleep(100);   // the host's redraw brings it back (the stand-in changed nothing)
      await ev("window.__calls = []");
      await click('[data-act="main"]', review[0]); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "setNoteStatus" && c[0][2] === "accepted")) fails.push(`Accept called ${JSON.stringify(c[0])}`);
      await ev("window.__calls = []");
      await click('[data-act="main"]', approval[0]); await sleep(200);
      c = await calls();
      if (!(c[0] && c[0][0] === "openNote")) fails.push(`Open on an approval called ${JSON.stringify(c[0])}`);
      // Projects: a card opens its drawer, with its decision; Escape closes it
      await screen("projects");
      await ev(`document.querySelector('[data-filter="all"]').click()`); await sleep(100);
      if (await ev(`document.querySelectorAll(".vg-hq-proj").length`) !== 4) fails.push("All doesn't show the 4 sample projects");
      await ev(`[...document.querySelectorAll(".vg-hq-proj")].find(b => /Card Deposits/.test(b.textContent)).click()`); await sleep(150);
      if (!await ev(`!!document.querySelector(".vg-hq-drawer") && /Card Reader/.test(document.querySelector(".vg-hq-drawer").textContent)`)) fails.push("the project drawer doesn't show its decision");
      // its status chips set the status, and the card shows it at once
      await ev("window.__calls = []");
      await ev(`document.querySelector('.vg-hq-drawer [data-setstatus="testing"]').click()`); await sleep(300);
      c = await calls();
      if (!(c[0] && c[0][0] === "setProjectStatus" && /RA_Deposits/.test(c[0][1]) && c[0][2] === "testing")) fails.push(`Set status called ${JSON.stringify(c[0])}`);
      if (!await ev(`/testing/.test([...document.querySelectorAll(".vg-hq-proj")].find(b => /Card Deposits/.test(b.textContent)).textContent)`)) fails.push("the card doesn't show the new status");
      if (!await ev(`!!document.querySelector('.vg-hq-drawer [data-setstatus="testing"][aria-pressed="true"]')`)) fails.push("the drawer doesn't mark the new status");
      // a closing status with open tasks asks first, then ticks them in the same write
      await ev(`Object.assign(DATA.hq.projects.find(p => /RA_Deposits/.test(p.path)), { open: 2, openTasks: ["Wire the reader", "Test refunds"] }); window.vaultHQ.update(null, null)`); await sleep(150);
      await ev("window.__calls = []; window.__asked = []");
      await ev(`document.querySelector('.vg-hq-drawer [data-setstatus="complete"]').click()`); await sleep(300);
      c = await calls();
      const asked = await ev("JSON.stringify(window.__asked)").then(JSON.parse);
      if (!(asked.length === 1 && /2 open tasks will be ticked: Wire the reader; Test refunds/.test(asked[0][1]))) fails.push(`Complete with open tasks asked ${JSON.stringify(asked)}`);
      if (!(c[0] && c[0][0] === "setProjectStatus" && c[0][2] === "complete" && c[0][3] === true)) fails.push(`Complete with open tasks called ${JSON.stringify(c[0])}`);
      await ev("window.__calls = []; window.__asked = []");
      await ev(`document.querySelector('.vg-hq-drawer [data-setstatus="planned"]').click()`); await sleep(300);
      if (await ev("window.__asked.length") !== 0) fails.push("a status that doesn't close the project asks");
      await ev(`document.querySelector(".vg-hq-drawer").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(100);
      if (await ev(`!!document.querySelector(".vg-hq-drawer")`)) fails.push("Escape doesn't close the drawer");
    }
    // every button on every screen can be clicked (dialogs answer themselves; the screen is reset after each)
    await ev("window.vaultHQ.update(null, null)");
    for (const s of ["home", "today", "needs", "projects", "sweep", "rows"]) {
      await screen(s);
      const n = await ev(`document.querySelectorAll(".vg-hq-main button, .vg-hq-strip button").length`);
      for (let i = 0; i < n; i++) {
        await ev(`(() => { const b = document.querySelectorAll(".vg-hq-main button, .vg-hq-strip button")[${i}]; if (b && !b.disabled) b.click(); })()`); await sleep(40);
        await ev(`window.vaultHQ.update(null, null); window.vaultHQ.setScreen(${JSON.stringify(s)})`);
      }
    }
    const e = await errs(); if (e.length) fails.push(`page errors: ${e.slice(0, 3).join(" | ")}`);
  } catch (err) { fails.push(err.message); }
  await tab.close();

  // no dead ends: an empty vault, and a vault with notes but no HQ notes; and at phone width, no sideways scroll
  for (const [name, o, mobile] of [["an empty vault", { hq: null, data: { nodes: [], links: [], clusters: [] } }, false], ["no HQ notes", { hq: null }, false], ["a phone", {}, true]]) {
    const t = await page(env.hqPage(OPTS, o), { mobile });
    try {
      for (const s of ["home", "today", "needs", "projects", "sweep", "rows"]) {
        await t.ev(`window.vaultHQ.setScreen(${JSON.stringify(s)})`); await sleep(120);
        if (!await t.ev(`document.querySelectorAll(".vg-hq-main button").length`)) fails.push(`${name}, ${s}: nothing to click`);
        if (o.hq === null && s !== "home" && !await t.ev(`!!document.querySelector(".vg-hq-empty button")`)) fails.push(`${name}, ${s}: an empty screen with no next step`);
        if (mobile && await t.ev(`document.querySelector(".vg-hq-main").scrollWidth > document.querySelector(".vg-hq-main").clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1`)) fails.push(`${name}, ${s}: scrolls sideways`);
        // card-like buttons (projects, tiles, chips) keep their text inside them, under Obsidian's button rules
        const out = await t.ev(`[...document.querySelectorAll(".vg-hq-proj, .vg-hq-tile, .vg-hq-chip")].filter(c => c.offsetParent).flatMap(c => { const r = c.getBoundingClientRect();
          return [...c.querySelectorAll("b, .vg-hq-sum")].filter(x => { const q = x.getBoundingClientRect(); return q.height === 0 || q.left < r.left - 1 || q.right > r.right + 1 || q.top < r.top - 1 || q.bottom > r.bottom + 1; }).map(x => x.textContent.slice(0, 30)); })`);
        if (out.length) fails.push(`${name}, ${s}: text outside its card: ${out.slice(0, 3).join(" | ")}`);
      }
      const e = JSON.parse(await t.ev("JSON.stringify(window.__errs || [])")); if (e.length) fails.push(`${name}: ${e[0]}`);
    } catch (err) { fails.push(`${name}: ${err.message}`); }
    await t.close();
  }
  console.log(fails.length ? "FAIL - " + fails.join("\n  ") : "ok - Vault HQ: every screen (with the sweep and report rows), each kind's buttons write, every button clicks, no dead ends, phone width");
  process.exit(fails.length ? 1 : 0);
})();
