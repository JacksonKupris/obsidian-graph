#!/usr/bin/env node
// Persona rerun of Home (0.6.191), round E: the latest-run card says which part is the machine and which is the project, so a project called "Vault" isn't read as a place.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);
    await sleep(500);
    const sub = await tab.ev(`(() => { const c = [...document.querySelectorAll(".vg-hq-feedcard")].find(x => /Latest agent run/.test(x.textContent)); return c ? c.innerText : ""; })()`);
    check(!!sub, "Home shows no latest-run card to check");
    check(/Office PC · Project: [A-Za-z]/.test(sub), `the card should label the project (got "${sub.replace(/\n/g, " | ")}")`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the latest-run card labels machine and project", "home runlog labels");
})();
