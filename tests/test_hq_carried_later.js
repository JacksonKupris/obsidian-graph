#!/usr/bin/env node
// A carried-over row can be put off: when the host can mark items (api.hqMark), every carried row on Today carries Later, as every other
// Today row does. The persona round saw rows with only Open because the bare test page has no hqMark, so this mounts with one, and
// also checks the opposite: without hqMark no row shows a Later that would do nothing.
const { sleep, checks, finish, openPage, tools } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const rows = () => tab.ev(`(() => { const r = [...document.querySelectorAll('.vg-hq-item[data-key^="carried|"]')]; return { n: r.length, later: r.filter(x => [...x.querySelectorAll("button")].some(b => b.innerText.trim() === "Later")).length }; })()`);
    const mount = hq => tab.ev(`(() => { window.__marks = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: ${hq ? "{ hqMark: async (k, v) => { window.__marks.push([k, v]); } }" : "{}"} }); window.vaultHQ.setScreen("today"); })()`).then(() => sleep(300));
    await mount(false);
    const none = await rows(); check(none.n > 0, "the sample has carried rows on Today (" + none.n + ")"); check(none.later === 0, "without hqMark no row offers a Later that would do nothing");
    await mount(true);
    const on = await rows(); check(on.n > 0 && on.later === on.n, "with hqMark every carried row offers Later (" + on.later + " of " + on.n + ")");
    await tab.ev(`(() => { const b = [...document.querySelectorAll('.vg-hq-item[data-key^="carried|"] button')].find(x => x.innerText.trim() === "Later"); b.click(); })()`); await sleep(250);
    const marks = await tab.ev(`window.__marks`);
    check(marks.length >= 1 && marks[0][1] === "later" && /^carried\|/.test(marks[0][0]), "Later on a carried row marks that row: " + JSON.stringify(marks));
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "carried-over rows can be put off whenever the host can mark them", "carried later");
})();
