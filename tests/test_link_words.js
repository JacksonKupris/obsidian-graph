#!/usr/bin/env node
// The words for unlinked notes mean one thing each on every surface: orphan = nothing links in, dead end = links nowhere,
// island = no links at all. The Blind spots lens used to call "links out, nothing links in" a dead end, the opposite of the Health overlays.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const text = async k => { await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(k)})`); await sleep(400); return tab.ev(`document.querySelector(".vg-lens:not([hidden])").innerText`); };
    const blind = await text("lens:blind");
    check(/Unlinked notes/i.test(blind) && /Named, not linked/i.test(blind), "Blind spots must list both link problems under the shared names (so this test reads the right lens)");
    // one name each, on every surface: the old names must not come back
    const every = await tab.ev(`window.vaultGraph._debug.allViews().map(v => v.key)`);
    for (const k of every.filter(k => k.startsWith("lens:"))) { const t = await text(k).catch(() => ""); check(!/\bIslands\b|never linked/i.test(t), `view ${k} still uses an old name for unlinked or named notes`); }
    await tab.ev(`window.vaultGraph._debug.openView("2d")`);
    const home = await tab.ev(`document.querySelector(".vg-root").innerText`); check(!/never linked/i.test(home), "the home panel must not say never linked");
    check(!/Dead ends/i.test(blind), "Blind spots calls a note nothing links to a dead end; on Health a dead end is a note that links nowhere");
    const stale = await text("lens:stale");
    check(!/^\s*(3 · )?Unconnected/im.test(stale), "the Stale lens's Unconnected counts only stale notes and must say so");
  } finally { await tab.close(); }
  finish(fails, "orphan, dead end and island mean the same on the Health overlays and in the lenses");
})();
