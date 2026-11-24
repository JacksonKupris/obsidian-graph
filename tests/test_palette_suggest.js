#!/usr/bin/env node
// The colour editor's Suggest button: one press fills all eight colours with a harmonious set (a harmony from a hue: complementary, analogous,
// triad or split-complementary), dark or light to match the page. Every suggestion passes the editor's own readability rules (VGShared.customChecks),
// so Save never ends up greyed out by a suggestion. Asked for by Jackson 2026-11-24.
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    const S = new Function(`${fs.readFileSync(path.join(build.ROOT, "src/shared.js"), "utf8")}; return VGShared;`)();
    check(typeof S.suggestPalette === "function", "VGShared.suggestPalette exists (the check can't pass without it)");
    if (typeof S.suggestPalette === "function") {
      let bad = 0, firstBad = "", accents = new Set(), same = true;
      for (const dark of [true, false]) for (let seed = 1; seed <= 400; seed++) {
        const cols = S.suggestPalette(seed, dark);
        if (cols.length !== 8 || !cols.every(c => /^#[0-9a-f]{6}$/.test(c))) { bad++; firstBad ||= `seed ${seed} gave ${JSON.stringify(cols)}`; continue; }
        const failed = S.customChecks(cols).filter(c => !c.ok);
        if (failed.length) { bad++; firstBad ||= `seed ${seed} ${dark ? "dark" : "light"} fails ${failed.map(f => f.what + " " + f.ratio.toFixed(1)).join(", ")}`; }
        const lightPage = S.contrast(cols[0], "#000000") > S.contrast(cols[0], "#ffffff");
        if (lightPage === dark) { bad++; firstBad ||= `seed ${seed} asked for ${dark ? "dark" : "light"} but the page is ${lightPage ? "light" : "dark"}`; }
        const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), far = (a, b) => Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]));
        const hue = c => { const [r, g, b] = rgb(c).map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
        const alike = (a, b) => { const dh = Math.abs(hue(a) - hue(b)); return far(a, b) < 55 && Math.min(dh, 360 - dh) < 30; };   // close in colour and in hue: dark colours sit close in RGB, so a clear hue difference counts
        for (const [i, j, what] of [[3, 4, "accent and good"], [3, 5, "accent and warning"], [3, 6, "accent and error"], [7, 4, "link and good"], [7, 5, "link and warning"], [7, 6, "link and error"], [3, 7, "accent and link"]])
          if (alike(cols[i], cols[j])) { bad++; firstBad ||= `seed ${seed} ${dark ? "dark" : "light"}: ${what} look the same (${cols[i]} ${cols[j]})`; }
        accents.add(cols[3]);
        if (JSON.stringify(cols) !== JSON.stringify(S.suggestPalette(seed, dark))) same = false;
      }
      check(bad === 0, `800 suggestions all valid, readable, the right brightness, and the accent and link not blurring into the status colours; first problem: ${firstBad}`);
      check(accents.size > 150, "suggestions differ: " + accents.size + " distinct accents in 800");
      check(same, "the same seed gives the same colours");
      check(S.customOf(S.customKey(S.suggestPalette(7, true))) !== null, "a suggestion round-trips through the saved value");
    }
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {}, palette: ${JSON.stringify(S.customKey(S.CUSTOM_DEFAULT))}, onPalette: () => {} }); window.vaultHQ.setScreen("today"); })()`); await sleep(300);
    await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(300);
    check(await tab.ev(`!!document.querySelector("[data-colour-suggest]")`), "the editor has a Suggest button");
    const read = () => tab.ev(`[...document.querySelectorAll("[data-colour]")].map(x => x.value).join(",")`);
    const seen = new Set([await read()]);
    for (let i = 0; i < 5; i++) {
      await tab.ev(`document.querySelector("[data-colour-suggest]").click()`); await sleep(150);
      seen.add(await read());
      check(await tab.ev(`!document.querySelector("[data-colour-save]").disabled`), "Save stays available after a suggestion (press " + (i + 1) + ")");
      check(await tab.ev(`document.querySelectorAll(".vg-hq-colourchecks .is-bad").length === 0`), "no failing line after a suggestion (press " + (i + 1) + ")");
    }
    check(seen.size >= 5, "each press gives a different set: " + seen.size + " distinct in 6");
    const box = await tab.ev(`(() => { const b = document.querySelector("[data-colour-suggest]").getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right }; })()`);
    check(box.h >= 24 && box.right <= 390, "the Suggest button is tappable and on the phone screen: " + JSON.stringify(box));
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close(); finish(fails, "Suggest fills a readable, harmonious set of eight colours");
})();
