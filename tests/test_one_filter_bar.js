#!/usr/bin/env node
// One filter bar: Needs you and Projects filter by status with the same pill bar (a labelled group of buttons, each with its count),
// not a pill bar on one screen and a dropdown on the other.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  const show = screen => tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(screen)}); })()`).then(() => sleep(250));
  const bar = label => tab.ev(`(() => { const g = document.querySelector('.vg-hq-filters[aria-label=${JSON.stringify(label)}]'); return g ? [...g.querySelectorAll("button.vg-hq-filter")].map(b => b.textContent.trim()) : null; })()`);
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await show("needs");
    const needs = await bar("Filter Needs you");
    check(needs && needs.length > 3 && needs.every(t => /\d$/.test(t)), `Needs you pill bar with counts: ${JSON.stringify(needs)}`);
    await show("projects");
    const projects = await bar("Project status");
    check(projects && projects.length === 6 && projects.every(t => /\d$/.test(t)), `Projects status should be a pill bar with counts: ${JSON.stringify(projects)}`);
    check(/^All\b/.test(needs[0]) && /^All\b/.test(projects[0]), `"All" comes first on both bars: ${needs[0]} / ${projects[0]}`);
    check(await tab.ev(`!document.querySelector('select[data-project-filter="status"]')`), "Projects status should not also be a dropdown");
    check(await tab.ev(`!![...document.querySelectorAll('.vg-hq-filters[aria-label="Project status"] button')].find(b => b.getAttribute("aria-pressed") === "true")`), "the active status pill is marked pressed");
    await tab.ev(`[...document.querySelectorAll('.vg-hq-filters[aria-label="Project status"] button')].find(b => /^All/.test(b.textContent)).click()`); await sleep(200);
    check(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`) === 4, "All pill shows the 4 sample projects");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Needs you and Projects filter with the same pill bar", "one filter bar");
})();
