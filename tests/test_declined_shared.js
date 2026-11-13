#!/usr/bin/env node
// A declined Slime mould link goes through the plugin's dismissals (opts.dismissPair), not this device's localStorage, so it is
// written to the vault, reaches every device and stays declined after the view is mounted again.
//   node tests/test_declined_shared.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const data = env.topicMapsOnly(env.data()), { fails, ok } = checks(), D = "window.vaultGraph._debug";
  let tab = null;
  try {
    tab = await openPage({ html: env.pageWith(`dismissPair: async (a, b, kind) => { (window.__dis = window.__dis || []).push({ a, b, kind }); }, dismissedPairs: () => window.__dis || [],`, data) });
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const calm = async () => { await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.drawNow()`); await sleep(60); };
    const press = text => tab.ev(`(() => { const b = [...document.querySelectorAll(".vg-lib button")].find(x => x.textContent.trim() === ${JSON.stringify(text)} && x.offsetParent); if (b) b.click(); return !!b; })()`);
    const firstRow = () => tab.ev(`(() => { const b = [...document.querySelectorAll(".vg-lib button")].find(x => x.textContent.trim() === "Add link" && x.offsetParent); const r = b && [...document.querySelectorAll(".vg-lib .vgv-insights > div")].find(x => x.contains(b)); return r ? r.firstChild.textContent : null; })()`);
    const simulate = async () => { await tab.ev(`${D}.setView("slime")`); await sleep(1900); await calm(); const went = await press("Simulate"); await sleep(2500); return went; };
    ok(await simulate(), "Slime mould has a Simulate button");
    const before = await firstRow();
    ok(!!before, "Simulate offers a link");
    ok(await press("Decline"), "with a Decline button"); await sleep(400);
    const dis = await tab.ev(`window.__dis || []`);
    ok(dis.length === 1 && dis[0].kind === "slime", `the decline went to the plugin's dismissals: ${JSON.stringify(dis)}`);
    ok((await tab.ev(`JSON.parse(localStorage.getItem("vg-declined-links") || "[]").length`)) === 0, "and nothing is kept on this device alone");
    await tab.ev(`${D}.setView("2d")`); await sleep(600);
    ok(await simulate(), "Simulate is there again after a remount");
    const after = await firstRow();
    ok(after !== before, `the declined link is not offered again: ${JSON.stringify(after)}`);
  } catch (e) { fails.push(e.stack || String(e)); }
  if (tab) await tab.close();
  finish(fails, "a declined Slime mould link is shared through the plugin's dismissals", "a declined Slime mould link is not shared");
})();
