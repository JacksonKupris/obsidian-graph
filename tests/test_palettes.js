#!/usr/bin/env node
// Colour palettes for Vault HQ: one list (VGShared.PALETTES), one CSS block per palette that sets the colours it needs, every pairing readable
// (AA 4.5:1), and the HQ control that picks one saves it through onPalette and puts it on the root.
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const read = f => fs.readFileSync(path.join(build.ROOT, f), "utf8");
(async () => {
  let tab;
  try {
    const S = new Function(`${read("src/shared.js")}; return VGShared;`)();
    const list = S.PALETTES || [];
    check(list.length >= 5 && list[0][0] === "obsidian", `PALETTES should start with "obsidian" (follow the vault's theme) and offer at least four of its own: ${JSON.stringify(list)}`);
    const css = read("src/tokens.css") + read("src/hq.css");
    const need = ["--background-primary", "--background-secondary", "--background-modifier-border", "--text-normal", "--text-muted", "--text-faint", "--interactive-accent", "--text-on-accent", "--text-accent"];
    for (const [key] of list.slice(1).filter(p => p[0] !== "custom")) {   // custom is built from four colours in shared.js, checked in test_palette_editor
      const m = css.match(new RegExp(`\\.vg-hq\\[data-vg-palette="${key}"\\][^{]*\\{([^}]*)\\}`));
      if (!m) { check(false, `no CSS block for palette ${key}`); continue; }
      const v = {}; for (const [, k, val] of m[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) v[k] = val;
      for (const k of need) check(v[k], `${key} doesn't set ${k}`);
      if (need.every(k => v[k])) {
        const pair = (a, b, min, what) => { const c = S.contrast(v[a], v[b]); check(c >= min, `${key}: ${what} is ${c.toFixed(2)}:1, needs ${min}`); };
        pair("--text-normal", "--background-primary", 7, "text on the page");
        pair("--text-muted", "--background-primary", 4.5, "muted text on the page");
        pair("--text-muted", "--background-secondary", 4.5, "muted text on a panel");
        pair("--text-accent", "--background-primary", 4.5, "accent text on the page");
        // a light page is a calm one: near-white glares after a dark theme (round 4: Paper at #faf6ee was "offensively bright")
        const light = S.contrast(v["--background-primary"], "#000000") > S.contrast(v["--background-primary"], "#ffffff");
        if (light) check(S.contrast(v["--background-primary"], "#ffffff") >= 1.25, `${key}: the page is ${S.contrast(v["--background-primary"], "#ffffff").toFixed(2)}:1 against white, needs 1.25 or more so it does not glare`);
        pair("--text-on-accent", "--interactive-accent", 4.5, "text on an accent button");
      }
    }
    tab = await openPage({ html: env.hqPage("") });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const mount = pal => tab.ev(`(() => { window.__saved = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {}, palette: ${JSON.stringify(pal)}, onPalette: p => window.__saved.push(p) }); window.vaultHQ.setScreen("today"); })()`).then(() => sleep(250));
    await mount("midnight");
    check(await tab.ev(`document.querySelector(".vg-hq").dataset.vgPalette`) === "midnight", "a remembered palette is on the HQ root");
    await mount("not-a-palette");
    check(await tab.ev(`document.querySelector(".vg-hq").dataset.vgPalette || "obsidian"`) === "obsidian", "an unknown palette falls back to following Obsidian");
    const opts = await tab.ev(`[...document.querySelectorAll("select[data-palette] option")].map(o => o.value)`);
    check(JSON.stringify(opts) === JSON.stringify(list.map(p => p[0])), `the Theme control offers every palette once: ${JSON.stringify(opts)}`);
    await tab.ev(`(() => { const s = document.querySelector("select[data-palette]"); s.value = "forest"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(250);
    check(await tab.ev(`document.querySelector(".vg-hq").dataset.vgPalette`) === "forest", "picking a palette puts it on the root");
    check(JSON.stringify(await tab.ev(`window.__saved`)) === JSON.stringify(["forest"]), "picking a palette saves it once through onPalette");
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "HQ palettes are one list, readable, and saved through one path", "palettes");
})();
