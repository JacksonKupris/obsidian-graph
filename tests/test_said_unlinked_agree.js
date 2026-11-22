#!/usr/bin/env node
// "Named in daily notes, never linked" is one list: the Insights card and the Blind spots lens show the same notes, not 20 and 12.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data(), want = (data.said_unlinked || []).length;
  check(want > 12, "the sample must name more than 12 notes, or this test can't tell the two lists apart: " + want);
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); window.vaultGraph._debug.openView("lens:blind")`); await sleep(400);
    const got = await tab.ev(`(() => { const t = document.querySelector(".vg-lens:not([hidden])").innerText; const m = /Named, never linked\\s*\\n?\\s*(\\d+)/i.exec(t); return m ? +m[1] : -1; })()`);
    check(got === want, `the Blind spots lens counts ${got} named-never-linked notes; the data (and the Insights card) has ${want}`);
  } finally { await tab.close(); }
  finish(fails, "Insights and Blind spots list the same named-never-linked notes");
})();
