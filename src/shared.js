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
  const gapWhy = g => g.comentions ? `named together in ${plural(g.comentions, "daily note")}, ${g.links === 0 ? "no links between them yet" : (g.links < g.comentions ? "only " : "") + plural(g.links, "link")}` : `related by shared tags, ${plural(g.links, "link")}`;
  // note text with each [[link|alias]] as its alias and each [[link]] as its name, and without its frontmatter
  const plainLinks = s => String(s).replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  const stripFrontmatter = s => String(s).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // Days are "YYYY-MM-DD" text. Noon, so a clock change or time zone can't move a date to the day next to it. noon is
  // local, for showing a date; utcNoon is the same instant on every device, for counting days.
  // colour palettes for Vault HQ: [key, name]. "obsidian" follows the vault's own theme (the select reads "Obsidian"); the others carry their colours in tokens.css.
  const PALETTES = [["obsidian", "Obsidian"], ["midnight", "Midnight"], ["paper", "Paper"], ["forest", "Forest"], ["dusk", "Dusk"]];
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
  return { PALETTES, inkOn, contrast, scopeOf, scopeHas, escapeHtml, escapeRegex, baseOf, nameOf, plural, gapWhy, plainLinks, stripFrontmatter, DAY_MS, noon, utcNoon, shiftDay, daysBetween, pad2, shortDate, canUseWorker, inWorker, offThread };
};
const VGShared = VGSharedMake();
