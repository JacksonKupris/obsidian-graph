#!/usr/bin/env node
// An opt-in setting puts the chosen colour theme on all of Obsidian, not only the plugin's own screens.
// Off by default. When on, the theme goes on <body> through the one shared applyPalette, choosing a theme moves it,
// switching off or unloading restores Obsidian's own colours, and the CSS has a body rule for every non-Obsidian theme.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), stub = require("./plugin_stub"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
const read = f => fs.readFileSync(path.join(build.ROOT, f), "utf8");
try {
  const { Plugin } = stub.load(env.rules);
  const S = new Function(`${read("src/shared.js")}; return VGShared;`)();
  const css = read("src/tokens.css");
  for (const [key] of S.PALETTES.slice(1).filter(p => p[0] !== "custom")) check(new RegExp(`body\\[data-vg-palette="${key}"\\]`).test(css), `the ${key} theme has no CSS for <body>`);
  const P = Plugin.prototype;
  check(typeof P.syncAppTheme === "function" && typeof P.setPalette === "function", "the plugin has syncAppTheme and setPalette");
  if (typeof P.syncAppTheme === "function") {
    const props = {}; global.document = { body: { dataset: {}, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } } } };
    const mk = s => { const p = Object.create(P); p.settings = s; p.saveSettings = async () => { p.saved = (p.saved || 0) + 1; }; return p; };
    const now = () => global.document.body.dataset.vgPalette || "obsidian";
    let p = mk({ hqPalette: "paper" });
    p.syncAppTheme(); check(now() === "obsidian", "off by default: the theme stays inside the plugin's screens");
    p = mk({ hqPalette: "paper", themeObsidian: true });
    p.syncAppTheme(); check(now() === "paper", "on: the chosen theme goes on <body>");
    p.setPalette("forest"); check(now() === "forest" && p.settings.hqPalette === "forest" && p.saved === 1, "choosing a theme moves it on <body> and saves once");
    p.setPalette("forest"); check(p.saved === 1, "choosing the same theme again saves nothing");
    p.settings.themeObsidian = false; p.syncAppTheme(); check(now() === "obsidian", "switching off restores Obsidian's colours");
    p.settings.themeObsidian = true; p.settings.hqPalette = "obsidian"; p.syncAppTheme(); check(now() === "obsidian", "the Obsidian theme adds nothing to <body>");
    p.setPalette("custom:#102030,#1a2c3e,#f0f4f8,#ffb454"); check(now() === "custom" && props["--background-primary"] === "#102030", "a custom theme puts its colours on <body>");
    p.setPalette("forest"); check(now() === "forest" && !props["--background-primary"], "leaving a custom theme removes its colours from <body>");
    p.settings.hqPalette = "dusk"; p.syncAppTheme(); p.onunload(); check(now() === "obsidian", "unloading the plugin restores Obsidian's colours");
  }
} catch (e) { fails.push("crashed: " + e.message); }
finish(fails, "the theme can apply to all of Obsidian, opt in", "theme all obsidian");
