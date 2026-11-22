#!/usr/bin/env node
// An empty list inside a lens is never a bare "None.": on a vault the analysis found nothing in, every section of every lens
// that says "None." or "No ..." names what it means and offers a button for the next step, in the same section. Sweeps every
// lens from the page's own view list, so a lens added later is held to it too. (test_empty_next.js covers a whole lens that is empty.)
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data();
  for (const k of Object.keys(data)) if (Array.isArray(data[k]) && !["nodes", "links", "clusters", "notes"].includes(k)) data[k] = [];
  data.timeline = null; data.changes = {};
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const keys = await tab.ev(`window.vaultGraph._debug.allViews().filter(v => /^lens:/.test(v.key)).map(v => v.key)`);
    check(keys.length > 20, "the sweep must find the lenses: " + keys.length);
    let seen = 0;
    for (const k of keys) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(k)})`); await sleep(300);
      const r = await tab.ev(`(() => { const l = document.querySelector(".vg-lens:not([hidden])"); if (!l) return null;
        const empties = [...l.querySelectorAll(".vg-empty, .vg-lens-note")].filter(e => /^(None\\.|No |Nothing)/.test(e.textContent.trim()));
        return { n: empties.length, dead: empties.filter(e => !(e.closest(".vg-sec, section, .vg-card") || l).querySelector(".vg-empty-next button")).map(e => e.textContent.trim().slice(0, 50)) }; })()`);
      if (!r) continue;
      seen += r.n;
      check(!r.dead.length, `${k}: an empty list with no next step: ${JSON.stringify(r.dead)}`);
    }
    check(seen > 0, "the sweep must meet at least one empty list, or it checks nothing");
  } finally { await tab.close(); }
  finish(fails, "Every empty list in every lens offers a next step");
})();
