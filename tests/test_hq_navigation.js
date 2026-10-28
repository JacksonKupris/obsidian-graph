#!/usr/bin/env node
// Real pointer clicks, including nested labels/icons: each shortcut must reach a distinct screen.
const assert = require("assert"), cdp = require("./cdp"), env = require("./env");

(async () => {
  for (const mobile of [false, true]) {
    const tab = await cdp.open({ html: env.hqPage(""), port: 9352, mobile });
    if (!tab) throw new Error("Navigation regression requires Chrome");
    try {
      assert(await tab.waitFor("window.vaultHQ ? 1 : 0", 20000), "HQ did not mount");
      await tab.ev(`window.__navigationErrors = []; addEventListener("error", e => window.__navigationErrors.push(e.message))`);
      for (const from of ["home", "needs", "projects", "automations"]) {
        for (const to of ["needs", "projects", "automations"]) {
          await tab.ev(`window.vaultHQ.setScreen(${JSON.stringify(from)})`);
          const point = await tab.ev(`(() => {
            const b = document.querySelector('.vg-hq-chips [data-go="${to}"]');
            if (!b) return null;
            const r = (b.querySelector("b") || b).getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()`);
          assert(point, `${from}: no ${to} shortcut`);
          await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
          await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
          assert.strictEqual(await tab.ev("window.vaultHQ.screen()"), to, `${mobile ? "phone" : "desktop"}: ${from} -> ${to}`);
          assert.strictEqual(await tab.ev("document.querySelector('.vg-hq-crumb').textContent.trim()"),
            `Vault HQ / ${to === "needs" ? "Needs you" : to === "projects" ? "Projects" : "Automations"}`);
          await tab.ev("window.vaultHQ.update(null, null)");
          assert.strictEqual(await tab.ev("window.vaultHQ.screen()"), to, "live data refresh lost navigation");
        }
      }
      await tab.ev(`window.vaultHQ.setScreen("automations")`);
      assert.strictEqual(await tab.ev("document.querySelectorAll('.vg-hq-main .vg-hq-item').length"),
        env.rules.hq.automations.length, "Automations must show healthy and failed jobs alike");
      const needsTarget = await tab.ev(`document.querySelector('.vg-hq-chips [data-go="needs"]').dataset.go`);
      assert.strictEqual(needsTarget, "needs");
      assert.deepStrictEqual(await tab.ev("window.__navigationErrors"), []);
      assert.strictEqual(await tab.ev("document.documentElement.scrollWidth > innerWidth + 1"), false, "navigation overflow");
      await tab.ev(`window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { screen: "automations" })`);
      assert.strictEqual(await tab.ev("window.vaultHQ.screen()"), "automations", "remembered Automations screen was lost on remount");
    } finally { await tab.close(); }
  }
  console.log("ok - desktop/phone real clicks between Needs you, Projects and all Automations survive refresh");
})().catch(error => { console.error(error); process.exitCode = 1; });
