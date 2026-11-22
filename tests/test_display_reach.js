#!/usr/bin/env node
// Display (styles, size, colour, layers) can be reached at every width. On a phone the Display select is folded into the "⋯" select;
// moving between a phone and a computer width rebuilds it either way (the label read "…" on a computer after a phone visit).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    const read = () => tab.ev(`(() => { const vis = e => !!e && !!e.offsetParent && e.getBoundingClientRect().width > 0, d = document.querySelector(".vg-displaysel"), t = document.querySelector(".vg-toolsel");
      return { displayShown: vis(d), toolLabel: t.options[0].textContent, toolHasDisplay: [...t.options].some(o => o.value === "panel:style"), toolShown: vis(t), toolW: Math.round(t.getBoundingClientRect().width), toolH: Math.round(t.getBoundingClientRect().height) }; })()`);
    for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true], [1280, 800, false], [600, 800, false]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(700);
      const r = await read(), tag = `${w}px${mobile ? " phone" : ""}`;
      check(r.displayShown || (r.toolShown && r.toolHasDisplay), `${tag}: Display can't be reached (display select shown ${r.displayShown}, tools select shown ${r.toolShown}, holds Display ${r.toolHasDisplay})`);
      if (w < 760) check(r.toolHasDisplay, `${tag}: the ⋯ select must hold the Display entries`);
      else if (r.displayShown) check(r.toolLabel === "Tools" && !r.toolHasDisplay, `${tag}: the Display select is shown, so Tools must say "Tools" and not repeat Display: label "${r.toolLabel}", holds Display ${r.toolHasDisplay}`);
    }
  } finally { await tab.close(); }
  finish(fails, "Display is reachable at phone and computer widths, and the Tools select follows the width");
})();
