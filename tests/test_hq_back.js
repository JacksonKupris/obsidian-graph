#!/usr/bin/env node
// Back in Vault HQ: a button and Escape return to the screen you came from, from any depth, and a screen reached from
// another (Sweep, Focus...) goes back to the one it belongs to. And "Link to…" has a note picker in HQ (without one
// the action was hidden from the home page).
const { openPage } = require("./kit");
const assert = require("assert"), env = require("./env");

(async () => {
  for (const mobile of [false, true]) {
    const tab = await openPage({ html: env.hqPage(""), mobile });
    const where = mobile ? "phone" : "desktop";
    try {
      assert(await tab.waitFor("window.vaultHQ ? 1 : 0", 20000), "HQ did not mount");
      const has = () => tab.ev(`!!document.querySelector(".vg-hq-top [data-back]")`);
      const click = async () => { const pt = await tab.ev(`(() => { const r = document.querySelector(".vg-hq-top [data-back]").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", ...pt, button: "left", clickCount: 1 });
        await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...pt, button: "left", clickCount: 1 }); };
      const screen = () => tab.ev("window.vaultHQ.screen()");
      await tab.ev(`window.vaultHQ.setScreen("home")`);
      assert.strictEqual(await has(), false, `${where}: Back shown on the first screen`);
      await tab.ev(`window.vaultHQ.setScreen("needs"); window.vaultHQ.setScreen("projects"); window.vaultHQ.setScreen("calendar")`);
      assert.strictEqual(await has(), true, `${where}: no Back button after moving`);
      await click(); assert.strictEqual(await screen(), "projects", `${where}: Back went to the wrong screen`);
      await tab.ev(`window.vaultHQ.update(null, null)`);
      assert.strictEqual(await screen(), "projects", `${where}: a refresh lost the place`);
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      assert.strictEqual(await screen(), "needs", `${where}: Escape didn't go back`);
      await click(); assert.strictEqual(await screen(), "home", `${where}: second Back`);
      assert.strictEqual(await has(), false, `${where}: Back shown back at the start`);
      // a screen that belongs to another one goes back to it even with nothing behind it
      await tab.ev(`window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { screen: "automations" })`);
      assert.strictEqual(await has(), true, `${where}: Automations has no way back`);
      await click(); assert.strictEqual(await screen(), "needs", `${where}: Automations went somewhere other than Needs you`);
      // the note picker: it lists notes, takes a typed filter, and resolves the chosen note's path
      const total = await tab.ev("DATA.nodes.filter(n => !n.ghost).length");
      assert(total > 0, "the page has no notes to pick from");
      await tab.ev(`window.__picked = undefined; (window.vaultHQ.pickNote("Link to…").then(v => { window.__picked = v; }), 0)`);
      assert(await tab.waitFor(`document.querySelectorAll(".vg-hq-dialog [data-to]").length`, 5000), `${where}: the picker listed no notes`);
      await tab.ev(`document.querySelector(".vg-hq-dialog [data-to]").click()`);
      assert(await tab.waitFor(`window.__picked !== undefined ? 1 : 0`, 5000), `${where}: the picker never resolved`);
      const got = await tab.ev("window.__picked");
      assert(typeof got === "string" && (await tab.ev(`DATA.nodes.some(n => n.id === ${JSON.stringify(got)})`)), `${where}: the picker gave ${got}, not a note`);
      await tab.ev(`window.__picked = undefined; (window.vaultHQ.pickNote("Link to…").then(v => { window.__picked = v; }), 0)`);
      await tab.waitFor(`document.querySelector(".vg-hq-dialog") ? 1 : 0`, 5000);
      await tab.ev(`document.querySelector(".vg-hq-dialog [data-no]").click()`);
      assert(await tab.waitFor(`window.__picked === null ? 1 : 0`, 5000), `${where}: Cancel should give null`);
    } finally { await tab.close(); }
  }
  console.log("ok - HQ Back (button and Escape, desktop and phone) and the note picker");
})().catch(error => { console.error(error); process.exitCode = 1; });
