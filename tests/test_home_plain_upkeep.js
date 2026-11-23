#!/usr/bin/env node
// Persona rerun of Home (0.6.191): the upkeep reason is plain words a colleague can check, and the Needs you dock button
// carries its count in its name instead of a bare number.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);
    await sleep(400);
    const text = await tab.ev(`document.querySelector(".vg-hq").innerText`);
    check(!/by links through it|lists notes about|isn't listed/.test(text), "an upkeep reason reads as machinery");
    check(/Add .+ to .+/.test(text), "Home has upkeep rows to check");
    const dock = await tab.ev(`(() => { const b = document.querySelector('.vg-hq-dockbtn[data-go="needs"]'); const s = b && b.querySelector(".vg-hq-badge"); return b && s ? { label: b.getAttribute("aria-label"), count: s.textContent.trim(), hidden: s.getAttribute("aria-hidden") } : null; })()`);
    check(!!dock, "the Needs you dock button shows a count badge");
    if (dock) {
      check(new RegExp(dock.count).test(dock.label), `the dock button's name should carry the count ${dock.count}: "${dock.label}"`);
      check(dock.hidden === "true", "the badge number is hidden from screen readers, since the button's name already says it");
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "upkeep reasons are plain and the dock count has a name", "home plain upkeep");
})();
