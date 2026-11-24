#!/usr/bin/env node
// The phone's menu tray opens under the slim bar and closes again: the same button closes it, a tap on the content closes it, and moving
// to another screen closes it. It used to stay open across screens and cover 500px of the page (real Obsidian on a phone, round 4).
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    const screen = s => tools(tab, { wait: 150 }).screen(s);
    const shown = () => tab.ev(`(() => { const t = document.querySelector(".vg-hq-tray"); return !!t && getComputedStyle(t).display !== "none"; })()`);
    const shut = () => tab.ev(`document.querySelector(".vg-hq").classList.remove("tray-open")`);
    const press = async sel => { await tab.ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(150); };
    await screen("today");
    await press('[data-tray="menu"]');
    check(await shown(), "the menu button opens the tray");
    await press('[data-tray="menu"]');
    check(!await shown(), "the menu button closes it again"); await shut();
    await press('[data-tray="search"]');
    check(await shown(), "the search button opens the tray");
    await press('[data-tray="search"]');
    check(!await shown(), "the search button closes it again, not only the keyboard"); await shut();
    await press('[data-tray="menu"]');
    await press(".vg-hq-main");
    check(!await shown(), "a tap on the content closes the tray"); await shut();
    await press('[data-tray="menu"]');
    await press('.vg-hq-dockbtn[data-go="projects"]');
    check(!await shown(), "moving to another screen closes the tray");
    check(await tab.ev(`!!document.querySelector('.vg-hq-dockbtn[data-go="projects"].is-on')`), "and the screen did change");
    await press('[data-tray="menu"]');
    check(await tab.ev(`document.querySelector('[data-tray="menu"]').getAttribute("aria-expanded")`) === "true", "an open tray says so (aria-expanded)");
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "the phone tray opens, closes on the same button, on a tap outside and on a screen change", "hq phone tray");
})();
