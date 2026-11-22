#!/usr/bin/env node
// Every pressable control shows it is pressed, and a disabled one does not look clickable (persona round 3, design-motion-feel).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const r = await ev(`(() => {
      const rules = []; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) rules.push(r.selectorText || ""); } catch (e) {} }
      const press = rules.filter(t => /:active/.test(t) && /vg-root|vg-btn|ds-|vg-tab|button/.test(t));
      const dis = [...document.querySelectorAll(".vg-root button:disabled")].map(b => getComputedStyle(b).cursor);
      return { press: press.length, dis, pressSel: press.slice(0, 6) };
    })()`);
    check(r.press >= 1, "there should be a shared :active rule for buttons, cards and rows (found " + r.press + ")");
    check(r.dis.length > 0, "the page has a disabled button to check (Undo or Previous)");
    check(r.dis.every(c => c !== "pointer"), "disabled buttons must not show the pointer cursor (got " + [...new Set(r.dis)] + ")");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Pressed and disabled states");
})();
