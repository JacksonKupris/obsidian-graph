#!/usr/bin/env node
// The design rulebook (tests/design_rules.js) run against Vault HQ in each layout at phone, tablet and desktop widths.
// test_design.js checks the source (tokens); this checks what the page really draws.
//   node tests/test_design_rules.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env"), RULES = require("./design_rules");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    check(RULES.length >= 7, "the rulebook shrank to " + RULES.length + " rules");
    for (const layout of ["queue", "bench", "day", "inbox", "board", "brief", "focus", "threads", "people", "digest", "matrix", "timeline", "cards", "table", "agenda"]) for (const [w, mobile] of [[390, true], [820, false], [1500, false]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { layout: ${JSON.stringify(layout)}, api: {} }); window.vaultHQ.setScreen("today"); })()`); await sleep(150);
      check(await tab.ev(`document.querySelectorAll(".vg-hq button").length > 3`), `${layout} at ${w}px drew nothing to check`);   // a rule over an empty page passes for nothing
      for (const r of RULES) { const bad = await tab.ev(r.js); if (bad.length > r.max) check(false, `${r.id} (${r.from}) at ${layout} ${w}px: ${bad.join(", ")}`); }
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "design rules: overflow, targets, text size, names, contrast and empty states across every layout and three widths", "design rules");
})();
