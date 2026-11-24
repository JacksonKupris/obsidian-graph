// shared.js - small helpers every part of the plugin uses, one copy of each. Nothing here knows about a vault, a rule or
// the screen. The build puts it first. It's a function so a worker can be handed its source: the engine and the science run
// in workers, which can't see the rest of the bundle. tests/test_shared.js fails when a second copy of one of these appears.
const VGSharedMake = () => {
  const HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  // text for inside HTML or an attribute, whichever quote the attribute uses. Nothing (null or undefined) is an empty string.
  const escapeHtml = s => (s == null ? "" : String(s)).replace(/[&<>"']/g, c => HTML[c]);
  // text to match literally inside a new RegExp. Not "-": with the u flag an escaped - outside a class is an error.
  const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

  // a note's name from its path, and the last part of any path
  const baseOf = p => String(p == null ? "" : p).split("/").pop();
  const nameOf = p => baseOf(p).replace(/\.md$/i, "");
  const plural = (n, word, words) => `${n} ${n === 1 ? word : words || word + "s"}`;
  // why two topics are a gap, in words (one rule for the bar, the sidebar, the matrix and the reports). "only" when the links really are fewer than
  // the co-mentions; a pair with no co-mentions is there for its shared tags and says so, never "only".
  // what ranks a gap, said once: the analysis orders gaps by how unusually often two topics are named together (and shared tags), less when they already link
  const GAP_RANK = "Ranked by how unusually often the topics are named together, less when they already link; the daily-note count alone doesn't set the order.";
  const gapWhy = g => g.comentions ? `named together in ${plural(g.comentions, "daily note")}, ${g.links === 0 ? "no links between them yet" : (g.links < g.comentions ? "only " : "") + plural(g.links, "link")}` : `related by shared tags, ${plural(g.links, "link")}`;
  // note text with each [[link|alias]] as its alias and each [[link]] as its name, and without its frontmatter
  const plainLinks = s => String(s).replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  const stripFrontmatter = s => String(s).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // Days are "YYYY-MM-DD" text. Noon, so a clock change or time zone can't move a date to the day next to it. noon is
  // local, for showing a date; utcNoon is the same instant on every device, for counting days.
  // colour palettes for Vault HQ: [key, name]. "obsidian" follows the vault's own theme (the select reads "Obsidian"); the others carry their colours in tokens.css.
  const PALETTES = [["obsidian", "Obsidian"], ["midnight", "Midnight"], ["paper", "Paper"], ["forest", "Forest"], ["dusk", "Dusk"], ["custom", "Custom"]];
  // the one place a remembered choice becomes a theme on a root (HQ and the graph): a value from a newer build falls back to following Obsidian
  // Custom: four colours the person picks (page, panel, text, accent) held in the one remembered value "custom:#page,#panel,#text,#accent";
  // every other colour is derived from them here, so the editor, HQ, the graph and the whole-Obsidian setting all read one rule
  // eight colours: the four that set the look, then the four that carry meaning (good, warning, error, link)
  const CUSTOM_NAMES = ["Page", "Panel", "Text", "Accent", "Good", "Warning", "Error", "Link"];
  const CUSTOM_DEFAULT = ["#100f0f", "#1c1b1a", "#cecdc3", "#da702c", "#87c06a", "#e0b43a", "#f2776b", "#6aa8ee"];
  // a saved value may list only the first four (older saves); the rest come from the defaults
  const customOf = key => { const m = /^custom:(#[0-9a-f]{6}(?:,#[0-9a-f]{6}){3}|#[0-9a-f]{6}(?:,#[0-9a-f]{6}){7})$/i.exec(String(key)); return m ? m[1].toLowerCase().split(",").concat(CUSTOM_DEFAULT.slice(m[1].split(",").length)) : String(key) === "custom" ? CUSTOM_DEFAULT.slice() : null; };
  const customKey = cols => "custom:" + cols.join(",");
  const hexOf = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const blend = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)); };
  const customVars = ([bg, panel, text, accent, good, warn, bad, link]) => ({ "--background-primary": bg, "--background-secondary": panel, "--background-modifier-border": blend(panel, text, 0.2), "--background-modifier-hover": blend(panel, text, 0.1),
    "--text-normal": text, "--text-muted": blend(text, bg, 0.25), "--text-faint": blend(text, bg, 0.45), "--interactive-accent": accent,
    "--text-on-accent": contrast("#ffffff", accent) >= contrast("#000000", accent) ? "#ffffff" : "#000000", "--text-accent": inkOn(accent, bg),
    "--color-green": good, "--color-yellow": warn, "--color-red": bad, "--text-error": bad, "--color-blue": link });
  // the pairings that must be readable (WCAG AA, 4.5:1); the editor lists them and will not save a custom theme that fails one
  const customChecks = cols => { const v = customVars(cols), pair = (what, a, b) => { const ratio = contrast(a, b); return { what, ratio, ok: ratio >= 4.5 }; };
    return [pair("Text on the page", v["--text-normal"], cols[0]), pair("Text on a panel", v["--text-normal"], cols[1]), pair("Muted text on a panel", v["--text-muted"], cols[1]), pair("Button text on the accent", v["--text-on-accent"], v["--interactive-accent"]),
      ...[4, 5, 6, 7].map(i => pair(CUSTOM_NAMES[i] + " colour on the page", cols[i], cols[0]))]; };
  // A suggested set of eight colours, the way a palette generator picks them: one hue sets the page and panel tint, a harmony (complementary,
  // analogous, triad or split-complementary) gives the accent and the link colour their hues, and the status colours keep their meaning
  // (green, amber, red) at the same saturation. The same seed gives the same set; dark says whether the page is dark. Every set passes customChecks.
  const hsl = (h, s, l) => { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return hexOf([f(0), f(8), f(4)].map(v => v * 255)); };
  const seeded = seed => { let a = (Number(seed) || 1) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const HARMONIES = [[180, 150], [30, -30], [120, 240], [150, 210]];   // [accent offset, link offset] in degrees from the page hue
  function suggestPalette(seed, dark = true) {
    const rnd = seeded(seed), h = rnd() * 360, [da, dl] = HARMONIES[Math.floor(rnd() * HARMONIES.length)], sat = 0.55 + rnd() * 0.3, tint = 0.1 + rnd() * 0.15;
    const bgL = dark ? 0.07 + rnd() * 0.04 : 0.95 + rnd() * 0.03, step = dark ? 0.05 : -0.04, mid = dark ? 0.62 : 0.4, wrap = d => (h + d + 360) % 360;
    // the accent and the link keep clear of the status hues (green 135, amber 42, red 4) and of each other, so a button never reads as a warning
    const STATUS_HUES = [135, 42, 4], gap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    const clear = (x, others) => { const all = [...STATUS_HUES, ...others]; let best = x, bestGap = -1;   // the nearest hue that keeps 50 degrees from all of them, else the one furthest from them
      for (let off = 0; off <= 180; off += 5) for (const c of off ? [(x + off) % 360, (x - off + 360) % 360] : [x]) { const g = Math.min(...all.map(s => gap(c, s))); if (g >= 50) return c; if (g > bestGap) { best = c; bestGap = g; } } return best; };
    const ha = clear(wrap(da), []), hl = clear(wrap(dl), [ha]);
    const page = hsl(h, tint, bgL), panel = hsl(h, tint, bgL + step), at = dark ? 0.9 : 0.12;
    const cols = [page, panel, hsl(h, 0.12, at), hsl(ha, sat, mid), hsl(135, sat * 0.8, mid), hsl(42, sat, mid), hsl(4, sat, mid), hsl(hl, sat, mid + (dark ? 0.14 : -0.14))];
    for (let i = 4; i < 8; i++) cols[i] = inkOn(cols[i], page);   // status and link colours stay readable on the page
    for (let n = 0; n < 10 && customChecks(cols).some(c => !c.ok); n++) cols[2] = blend(cols[2], dark ? "#ffffff" : "#000000", 0.3);   // text that falls short moves toward full contrast
    return cols;
  }
  // the eight editable colours as the page shows them now (a preset theme's own), as hex; null where the page can't say
  const VAR_OF = ["--background-primary", "--background-secondary", "--text-normal", "--interactive-accent", "--color-green", "--color-yellow", "--color-red", "--color-blue"];
  function liveColours(el) {
    const s = getComputedStyle(el), c = document.createElement("canvas").getContext("2d"); if (!c) return null;
    const out = VAR_OF.map(v => { c.fillStyle = "#000000"; c.fillStyle = s.getPropertyValue(v).trim() || "#000000"; return c.fillStyle; });
    return out.every(h => /^#[0-9a-f]{6}$/.test(h)) ? out : null; }
  const paletteOf = key => { const c = customOf(key); return c ? customKey(c) : PALETTES.some(p => p[0] === key) ? key : "obsidian"; };
  // a menu entry for a theme is on when it is the current one ("custom" stands for any custom colours); choosing "custom" while custom is on keeps the saved colours
  const paletteIs = (current, k) => current === k || (k === "custom" && !!customOf(current));
  const paletteChoice = (current, k) => k === "custom" && customOf(current) ? current : k;
  const applyPalette = (el, key) => { const p = paletteOf(key), c = customOf(p);
    for (const k of Object.keys(customVars(CUSTOM_DEFAULT))) el.style.removeProperty(k);
    if (c) { el.dataset.vgPalette = "custom"; for (const [k, v] of Object.entries(customVars(c))) el.style.setProperty(k, v); } else if (p === "obsidian") delete el.dataset.vgPalette; else el.dataset.vgPalette = p;
    return p; };
  const DAY_MS = 864e5;
  const noon = day => new Date(day + "T12:00:00");
  const utcNoon = day => Date.parse(day + "T12:00:00Z");
  const shiftDay = (day, n) => new Date(utcNoon(day) + n * DAY_MS).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
  // "Nov 4", in the reader's language. Words that aren't a date come back as they are.
  const shortDate = d => { if (!d) return ""; const x = noon(d); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  const pad2 = n => String(n).padStart(2, "0");

  const canUseWorker = () => typeof Worker === "function" && typeof Blob === "function" && typeof URL === "function" && !!URL.createObjectURL;
  // One message to a new worker and one answer back. makers is { name: function } and each is defined by its source, with
  // the helpers here first; `listen` is the worker's onmessage, as source.
  function inWorker(makers, listen, message) {
    return new Promise((resolve, reject) => {
      const source = [`const VGSharedMake = ${VGSharedMake.toString()};\nconst VGShared = VGSharedMake();`, ...Object.entries(makers).map(([name, make]) => `const ${name} = ${make.toString()};`), `onmessage = ${listen};`].join("\n");
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" })), w = new Worker(url), end = () => { w.terminate(); URL.revokeObjectURL(url); };
      w.onmessage = e => { end(); resolve(e.data); }; w.onerror = e => { end(); reject(new Error(e.message || "worker failed")); };
      w.postMessage(message);
    });
  }
  // Slow work off the main thread, or here when a worker can't start. stats.via says which, so a test can tell.
  async function offThread({ makers, listen, message, here, label, stats }) {
    if (canUseWorker()) {
      try { const r = await inWorker(makers, listen, message); stats.via = "worker"; return r; }
      catch (e) { console.warn(`Vault Graph: ${label} running on the main thread:`, e.message); } }
    stats.via = "here"; return here();
  }
  // Is a note inside a scope { folder } or { tag }: in the folder, or carrying the tag or one under it. No scope: every note.
  const scopeOf = s => ({ folder: String((s && s.folder) || "").trim().replace(/^\/+|\/+$/g, ""), tag: String((s && s.tag) || "").trim().replace(/^#/, "").toLowerCase(), path: String((s && s.path) || "").trim() });
  const scopeHas = (scope, path, tags) => { const { folder, tag, path: only } = scopeOf(scope);   // path: exactly one note
    return (!only || path === only) && (!folder || path.startsWith(folder + "/")) && (!tag || (tags || []).map(t => String(t).replace(/^#/, "").toLowerCase()).some(t => t === tag || t.startsWith(tag + "/"))); };
  // text colour on a background: a topic's colour moved toward black or white only as far as it takes to read (WCAG 4.5:1); other values pass through
  const rgbOf = c => { c = String(c || "").trim(); let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c); if (m) { const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join("") : m[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(c); if (m) return [+m[1], +m[2], +m[3]].map(v => v * 255);
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c); return m ? [+m[1], +m[2], +m[3]] : null; };
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const x = rgbOf(a), y = rgbOf(b); if (!x || !y) return 21; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
  const hex2 = v => Math.round(v).toString(16).padStart(2, "0");
  const inkOn = (colour, bg, min = 4.5) => { const c = rgbOf(colour), b = rgbOf(bg); if (!c || !b || contrast(colour, bg) >= min) return colour;
    const to = lum(b) > 0.4 ? 0 : 255;   // toward black on a light page, white on a dark one
    for (let t = 0.05; t <= 1.0001; t += 0.05) { const out = "#" + c.map(v => hex2(v + (to - v) * t)).join(""); if (contrast(out, bg) >= min) return out; }
    return to ? "#ffffff" : "#000000"; };
  return { liveColours, suggestPalette, GAP_RANK, PALETTES, CUSTOM_NAMES, CUSTOM_DEFAULT, customOf, customKey, customVars, customChecks, paletteIs, paletteChoice, paletteOf, applyPalette, inkOn, contrast, scopeOf, scopeHas, escapeHtml, escapeRegex, baseOf, nameOf, plural, gapWhy, plainLinks, stripFrontmatter, DAY_MS, noon, utcNoon, shiftDay, daysBetween, pad2, shortDate, canUseWorker, inWorker, offThread };
};
const VGShared = VGSharedMake();
