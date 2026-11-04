// shared.js - small helpers every part of the plugin uses, one copy of each. Nothing here knows about a vault, a rule or
// the screen. The build puts it first. It's a function so a worker can be handed its source: the engine and the science run
// in workers, which can't see the rest of the bundle. tests/test_shared.js fails when a second copy of one of these appears.
const VGSharedMake = () => {
  const HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  // text for inside HTML or an attribute, whichever quote the attribute uses. Nothing (null or undefined) is an empty string.
  const escapeHtml = s => (s == null ? "" : String(s)).replace(/[&<>"']/g, c => HTML[c]);
  // text to match literally inside a new RegExp. Not "-": with the u flag an escaped - outside a class is an error.
  const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

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
  return { escapeHtml, escapeRegex, canUseWorker, inWorker, offThread };
};
const VGShared = VGSharedMake();
