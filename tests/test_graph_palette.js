#!/usr/bin/env node
// Graph views follow the same colour themes as Vault HQ: one list (VGShared.PALETTES), the same CSS blocks, one remembered choice.
// The graph's Display menu offers each theme once, choosing one puts it on the graph root and saves it once through onPalette,
// and a remembered or unknown value behaves the way it does in HQ (unknown follows Obsidian).
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const read = f => fs.readFileSync(path.join(build.ROOT, f), "utf8");
(async () => {
  let tab;
  try {
    const S = new Function(`${read("src/shared.js")}; return VGShared;`)();
    const css = read("src/tokens.css");
    for (const [key] of S.PALETTES.slice(1).filter(p => p[0] !== "custom")) check(new RegExp(`\\.vg-root\\[data-vg-palette="${key}"\\]`).test(css), `the ${key} theme has no CSS for the graph root (.vg-root)`);
    const D = "window.vaultGraph._debug";
    tab = await openPage({ html: env.pageWith(`palette: "midnight", onPalette: p => { (window.__saved = window.__saved || []).push(p); },`, env.data()) });
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const now = () => tab.ev(`document.querySelector(".vg-root").dataset.vgPalette || "obsidian"`);
    check(await now() === "midnight", "a remembered theme is on the graph root");
    const offered = await tab.ev(`JSON.stringify([...document.querySelectorAll(".vg-displaysel option")].filter(o => o.value.startsWith("palette:")).map(o => o.value.slice(8)))`);
    check(offered === JSON.stringify(S.PALETTES.map(p => p[0])), `the Display menu should offer each theme once (got ${offered})`);
    await tab.ev(`(() => { const s = document.querySelector(".vg-displaysel"); s.value = "palette:forest"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(300);
    check(await now() === "forest", "choosing a theme puts it on the graph root");
    check(JSON.stringify(await tab.ev(`window.__saved`)) === JSON.stringify(["forest"]), "choosing a theme saves it once through onPalette");
    await tab.close();
    tab = await openPage({ html: env.pageWith(`palette: "not-a-theme",`, env.data()) });
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount (unknown theme)");
    check(await now() === "obsidian", "an unknown theme follows Obsidian");
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "graph views follow the shared colour themes", "graph palette");
})();
