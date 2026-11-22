#!/usr/bin/env node
// A page built without journals (no Obsidian, no task history) says so, instead of "needs journals with at least a few tasks",
// which reads as if the vault had no tasks (persona round 3: the same page listed open tasks in Stale notes).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const v of ["survival", "flow"]) {
      await ev(`${D}.openView("lens:${v}")`); await sleep(1200);
      const t = await ev(`(document.querySelector(".vg-lens") || {}).innerText || ""`);
      check(/no journal tasks in this page/i.test(t), `${v}: a page with no journals should say so (${t.slice(0, 120).replace(/\n/g, " | ")})`);
      check(!/at least a few tasks/.test(t), `${v}: should not blame the vault for a missing source`);
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Task views say when the page has no journals");
})();
