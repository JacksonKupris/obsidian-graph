#!/usr/bin/env node
// When Projects shows only some projects, its opening line names the filter that hides the rest ("Showing 1 of 4 projects: In progress").
// Two persona runs read "Showing 1 of 4" with no reason and had to find the chip that was switched on.
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tools(tab, { wait: 150 }).screen("projects"); await sleep(200);
    const s = await tab.ev(`({ lede: (document.querySelector(".vg-hq-lede") || {}).innerText || "", on: [...document.querySelectorAll('.vg-hq-filters[aria-label="Project status"] .vg-hq-filter.is-on')].map(b => b.firstChild.textContent.trim()) })`);
    check(/Showing \d+ of \d+ projects/.test(s.lede), "the sample shows part of the list, so this can fail (" + s.lede.slice(0, 80) + ")");
    check(s.on.length === 1 && s.on[0] !== "All", "one status chip is on (" + s.on + ")");
    check(s.on.length && s.lede.includes(s.on[0]), 'the line names the filter "' + s.on[0] + '": ' + s.lede.slice(0, 90));
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "Projects names the filter that hides projects", "projects lede");
})();
