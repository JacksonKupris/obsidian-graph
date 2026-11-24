#!/usr/bin/env node
// The colour editor: a "Custom" theme the person builds from four colours (page, panel, text, accent). One remembered value
// ("custom:#page,#panel,#text,#accent") travels through the same onPalette path as the built-in themes. The editor shows each
// readable pairing (WCAG AA, 4.5:1) live, will not save one that fails, resets to the defaults, and fits a phone.
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
(async () => {
  let tab;
  try {
    const S = new Function(`${fs.readFileSync(path.join(build.ROOT, "src/shared.js"), "utf8")}; return VGShared;`)();
    check(S.PALETTES.some(p => p[0] === "custom"), "PALETTES offers Custom");
    const key = S.customKey(["#101010", "#202020", "#eeeeee", "#ff8800"].concat(S.CUSTOM_DEFAULT.slice(4)));
    check(S.CUSTOM_DEFAULT.length === 8, "a custom theme has eight colours: page, panel, text, accent, good, warning, error, link");
    check(S.customOf("custom:#101010,#202020,#eeeeee,#ff8800").length === 8 && S.customOf("custom:#101010,#202020,#eeeeee,#ff8800")[0] === "#101010", "an older four-colour value still works, with the default status colours");
    check(S.customVars(S.customOf(key))["--color-red"] === S.CUSTOM_DEFAULT[6] && S.customVars(S.customOf(key))["--text-error"] === S.CUSTOM_DEFAULT[6], "error colour drives red and error text");
    check(S.customChecks(["#101010", "#202020", "#eeeeee", "#ff8800", "#111111", "#222222", "#333333", "#444444"]).filter(c => !c.ok).length >= 4, "dark status colours on a dark page fail their checks");
    check(S.paletteOf(key) === key, "a custom value is kept as it is: " + S.paletteOf(key));
    check(S.paletteOf("custom:#zzzzzz,#1,#2,#3") === "obsidian", "a malformed custom value falls back to following Obsidian");
    check(S.customChecks(S.CUSTOM_DEFAULT).every(c => c.ok), "the default custom colours pass every check");
    check(S.customChecks(["#888888", "#8a8a8a", "#808080", "#ff8800"]).some(c => !c.ok), "grey on grey fails a check");
    tab = await openPage({ html: env.hqPage(""), mobile: true });
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await tab.ev(`(() => { window.__saved = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {}, palette: ${JSON.stringify(key)}, onPalette: p => window.__saved.push(p) }); window.vaultHQ.setScreen("today"); })()`);
    await sleep(300);
    check(await tab.ev(`document.querySelector("select[data-palette]").value`) === "custom", "the Theme control shows Custom when a custom theme is on");
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq")).getPropertyValue("--background-primary").trim()`) === "#101010", "the custom page colour is on the HQ root");
    check(await tab.ev(`!!document.querySelector("[data-editcolors]")`), "there is an Edit colours button");
    await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(200);
    const box = await tab.ev(`(() => { const b = document.querySelector(".vg-hq-colours"); if (!b) return null; const r = b.getBoundingClientRect(); return { inputs: b.querySelectorAll("input[type=color]").length, fits: r.left >= 0 && r.right <= innerWidth, rows: b.querySelectorAll(".vg-hq-colourchecks li").length, save: !b.querySelector("[data-colour-save]").disabled }; })()`);
    check(box, "the editor opens");
    if (box) {
      check(box.inputs === 8, "eight colour inputs (" + box.inputs + ")");
      check(box.fits, "the editor fits inside 390px");
      check(box.rows >= 8 && box.save, "it lists the readable pairings and Save is on for passing colours");
    }
    const setColour = (i, v) => tab.ev(`(() => { const x = document.querySelector('[data-colour="${i}"]'); x.value = ${JSON.stringify(v)}; x.dispatchEvent(new Event("input", { bubbles: true })); })()`).then(() => sleep(100));
    await setColour(2, "#111111");
    check(await tab.ev(`document.querySelector("[data-colour-save]").disabled`), "text almost the colour of the page turns Save off");
    check(await tab.ev(`document.querySelectorAll(".vg-hq-colourchecks li.is-bad").length`) > 0, "and marks the failing pairing");
    await tab.ev(`document.querySelector("[data-colour-save]").click()`); await sleep(100);
    check(JSON.stringify(await tab.ev(`window.__saved`)) === "[]", "a failing combination is not saved");
    await tab.ev(`document.querySelector("[data-colour-reset]").click()`); await sleep(100);
    check(await tab.ev(`document.querySelector('[data-colour="0"]').value`) === "#100f0f", "Reset to default puts the default colours back");
    await setColour(0, "#102030"); await setColour(1, "#1a2c3e"); await setColour(2, "#f0f4f8"); await setColour(3, "#ffb454");
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq")).getPropertyValue("--background-primary").trim()`) === "#102030", "the colours preview live");
    await tab.ev(`document.querySelector("[data-colour-save]").click()`); await sleep(150);
    const saved = await tab.ev(`window.__saved`);
    check(saved.length === 1 && saved[0] === "custom:#102030,#1a2c3e,#f0f4f8,#ffb454," + S.CUSTOM_DEFAULT.slice(4).join(","), "Save sends one custom value through onPalette: " + JSON.stringify(saved));
    check(!await tab.ev(`!!document.querySelector(".vg-hq-colours")`), "the editor closes after saving");
    await tab.ev(`document.querySelector("[data-editcolors]").click()`); await sleep(150);
    await setColour(0, "#ffffff");
    await tab.ev(`document.querySelector(".vg-hq-colours").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(150);
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq")).getPropertyValue("--background-primary").trim()`) === "#102030", "Escape puts the saved colours back");
  } catch (e) { fails.push("crashed: " + e.message); }
  if (tab) await tab.close();
  finish(fails, "the colour editor builds a readable custom theme and saves it through one path", "palette editor");
})();
