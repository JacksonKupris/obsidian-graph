#!/usr/bin/env node
// Populate from the vault proposes stars and planets from real maps, Context notes and project tags, leaves out what the sky
// already has, adds only what is ticked, and can be undone. The Links switch hides the lines between linked notes.
//   node tests/test_cosmos_seed.js        exit 0 = pass
const { openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.page() });
  if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) { console.log("FAIL - cosmos seed: the page did not mount"); process.exit(1); }
  const r = JSON.parse(await tab.ev(`(async () => { const D = window.vaultGraph._debug, S = D.saved, out = {}, wait = ms => new Promise(r => setTimeout(r, ms)), $ = s => document.querySelector(s);
    D.setView("cosmos"); await wait(400);
    out.button = !!$(".vg-seedbtn"); out.linksSwitch = $('.vg-autobtn[data-auto="links"]') ? $('.vg-autobtn[data-auto="links"]').getAttribute("aria-pressed") : "missing";
    const start = S.bodies().length;
    $(".vg-seedbtn").click(); await wait(200);
    const rows = [...document.querySelectorAll('input[data-seed]')].filter(c => c.dataset.seed !== "go");
    out.previewRows = rows.length; out.previewAddsNothing = S.bodies().length === start;
    if (rows.length) { rows.slice(1).forEach(c => { c.checked = false; }); $('[data-seed="go"]').click(); await wait(400); }
    out.added = S.bodies().length - start; out.oneTicked = rows.length ? out.added === 1 : "none proposed";
    out.captured = rows.length ? Object.values(S.captured()).every(n => n >= 0) : true;
    $(".vg-seedbtn").click(); await wait(200);
    out.again = [...document.querySelectorAll('input[data-seed]')].filter(c => c.dataset.seed !== "go").length;
    out.noDuplicate = out.again === Math.max(0, rows.length - 1);
    $('[data-seed="cancel"]').click();
    $('.vg-autobtn[data-auto="links"]').click(); await wait(100); out.linksOff = S.auto().links === false; out.linksPressed = $('.vg-autobtn[data-auto="links"]').getAttribute("aria-pressed");
    $('.vg-autobtn[data-auto="links"]').click(); await wait(100); out.linksBack = S.auto().links === true;
    return JSON.stringify(out); })()`));
  await tab.close();
  const bad = [];
  if (!r.button) bad.push("no Populate button");
  if (r.linksSwitch !== "true") bad.push(`Links switch: ${r.linksSwitch}`);
  if (!(r.previewRows > 0)) bad.push("nothing proposed from the sample vault, so accept and undo went untested");
  if (!r.previewAddsNothing) bad.push("the preview changed the sky");
  if (r.oneTicked !== true) bad.push(`ticking one added ${r.added}`);
  if (!r.captured) bad.push("a new body captured a negative count");
  if (!r.noDuplicate) bad.push(`running it again proposed ${r.again}, want ${Math.max(0, r.previewRows - 1)}`);
  if (!r.linksOff || r.linksPressed !== "false") bad.push("the Links switch didn't turn the lines off");
  if (!r.linksBack) bad.push("the Links switch didn't turn them back on");
  console.log(bad.length ? "FAIL - cosmos seed:\n  " + bad.join("\n  ") + "\n  " + JSON.stringify(r) : "ok - cosmos seed: a preview, only ticked bodies added, no repeats; the Links switch toggles");
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.log("FAIL - cosmos seed: " + e.message); process.exit(1); });
