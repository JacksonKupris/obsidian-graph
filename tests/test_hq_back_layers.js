#!/usr/bin/env node
// One Back. A project opened in its drawer, or a note in the preview, is a layer on top of the screen: the Back button and Escape close that layer first and only
// then leave the screen. Back used to skip the preview and jump to the screen before it (found on a phone, where Back is a button).
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    const screen = s => tools(tab, { wait: 150 }).screen(s);
    const click = async sel => { const ok = await tab.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`); await sleep(200); return ok; };
    const on = () => tab.ev(`(document.querySelector(".vg-hq-dockbtn.is-on") || {}).dataset ? document.querySelector(".vg-hq-dockbtn.is-on").dataset.go : null`);
    const peeking = () => tab.ev(`!!document.querySelector(".vg-hq-drawer")`);
    await screen("today");
    await screen("projects");
    const opener = await tab.ev(`(() => { const e = document.querySelector("[data-proj]"); return e ? e.dataset.proj : null; })()`);
    check(opener, "Projects needs a project to open (the sample data should have one)");
    if (opener) {
      await click("[data-proj]");
      await tab.waitFor(`document.querySelector(".vg-hq-drawer") ? 1 : 0`, 5000);
      check(await peeking(), "a project opens over the screen");
      check(await tab.ev(`!!document.querySelector("[data-back]")`), "Back is offered while a project is open");
      await click("[data-back]");
      check(!await peeking(), "Back closes the project first");
      check(await on() === "projects", `and stays on Projects (on: ${await on()})`);
      await click("[data-back]");
      check(await on() === "today", `a second Back goes to the screen before (on: ${await on()})`);
    }
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "Back closes a preview before it leaves the screen", "hq back layers");
})();
