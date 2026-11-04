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
  // note text with each [[link|alias]] as its alias and each [[link]] as its name, and without its frontmatter
  const plainLinks = s => String(s).replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  const stripFrontmatter = s => String(s).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // Days are "YYYY-MM-DD" text. Noon, so a clock change or time zone can't move a date to the day next to it. noon is
  // local, for showing a date; utcNoon is the same instant on every device, for counting days.
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
  return { escapeHtml, escapeRegex, baseOf, nameOf, plural, plainLinks, stripFrontmatter, DAY_MS, noon, utcNoon, shiftDay, daysBetween, pad2, shortDate, canUseWorker, inWorker, offThread };
};
const VGShared = VGSharedMake();
