#!/usr/bin/env node
// Suggested colours cover the whole colour wheel, and a colour the person picks becomes the base of a harmonious set.
// Asked for by Jackson 2026-11-24: Suggest only cycled through pink, purple and cyan; it should take any colour and find the others.
//   node tests/test_palette_any_hue.js        exit 0 = pass
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const hueOf = c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
(async () => {
  let tab;
  try {
    const S = new Function(`${fs.readFileSync(path.join(build.ROOT, "src/shared.js"), "utf8")}; return VGShared;`)();
    const bins = new Set(), pageBins = new Set();
    for (let seed = 1; seed <= 600; seed++) { const c = S.suggestPalette(seed, true); bins.add(Math.floor(hueOf(c[3]) / 30)); bins.add(Math.floor(hueOf(c[7]) / 30)); }
    check(bins.size >= 8, `accent and link hues spread round the wheel (${bins.size} of 12 thirty-degree bands in 600 suggestions)`);
    // a chosen base colour: the page tint takes its hue, and every set still reads well
    let off = 0, bad = "";
    for (let h = 0; h < 360; h += 15) for (const dark of [true, false]) {
      const base = S.suggestPalette(5, dark, h), pageH = hueOf(base[0]), d = Math.abs(pageH - h), dh = Math.min(d, 360 - d);
      const sat = base[0].slice(1, 3) === base[0].slice(3, 5) && base[0].slice(3, 5) === base[0].slice(5, 7);   // a tint this faint can read as grey; the hue is only checked on a coloured page
      if (!sat && dh > 12) { off++; bad ||= `hue ${h} gave a page of hue ${Math.round(pageH)}`; }
      const failed = S.customChecks(base).filter(c => !c.ok); if (failed.length) { off++; bad ||= `hue ${h} ${dark ? "dark" : "light"} fails ${failed[0].what}`; }
    }
    check(off === 0, "a chosen hue sets the page tint and the set stays readable: " + bad);
    check(JSON.stringify(S.suggestPalette(5, true, 200)) !== JSON.stringify(S.suggestPalette(5, true, 20)), "a different chosen hue gives a different set");
    tab = await openPage({ html: env.hqPage(""), mobile: false });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(300);
    check(await tab.ev(`!!document.querySelector("[data-colour-base]")`), "the editor has a colour to start from (the test can't pass without it)");
    const read = () => tab.ev(`[...document.querySelectorAll("[data-colour]")].map(x => x.value).join(",")`);
    const before = await read();
    await tab.ev(`(() => { const i = document.querySelector("[data-colour-base]"); i.value = "#e11d48"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
    const after = await read();
    check(after !== before, "choosing a colour fills the eight colours");
    const pageHue = hueOf(after.split(",")[0]), d = Math.abs(pageHue - hueOf("#e11d48"));
    check(Math.min(d, 360 - d) < 15, "the page tint follows the chosen colour's hue: " + Math.round(pageHue));
    check(await tab.ev(`!document.querySelector("[data-colour-save]").disabled && document.querySelectorAll(".vg-hq-colourchecks .is-bad").length === 0`), "Save stays available after choosing a colour");
    // pressing Suggest after choosing keeps the chosen colour as the base and picks a different harmony
    await tab.ev(`document.querySelector("[data-colour-suggest]").click()`); await sleep(150);
    const again = await read(), pH = hueOf(again.split(",")[0]), d2 = Math.abs(pH - hueOf("#e11d48"));
    check(Math.min(d2, 360 - d2) < 15 && again !== after, "Suggest after choosing keeps the base hue and tries another harmony: " + Math.round(pH));
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close(); finish(fails, "colours start from any hue");
})();
