#!/usr/bin/env node
// A Threads group's number says what it counts ("45 open") and adds up: the tasks on the page plus what "Show N more" holds equal it.
// Three persona runs read the bare "45" as unexplained and as not matching the rows (folded "worded alike" groups hide some rows).
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tools(tab, { wait: 150 }).screen("threads"); await sleep(200);
    const secs = await tab.ev(`[...document.querySelectorAll(".vg-hq-sec")].filter(s => s.querySelector("h3 span")).map(s => { const more = s.querySelector("[data-page]"); return { badge: s.querySelector("h3 span").innerText.trim(), tasks: s.querySelectorAll(".vg-hq-item").length, more: more ? Number((more.innerText.match(/(\\d+)/) || [])[1]) : 0 }; })`);
    check(secs.length > 0, "Threads has groups (" + secs.length + ")");
    secs.forEach(s => {
      const m = s.badge.match(/^(\d+) open$/);
      check(m, 'the group number names its unit ("' + s.badge + '")');
      if (m) check(s.tasks + s.more === Number(m[1]), "rows on the page + Show more = the number (" + s.tasks + " + " + s.more + " vs " + m[1] + ")");
    });
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "a Threads group's number says what it counts and adds up", "threads count label");
})();
