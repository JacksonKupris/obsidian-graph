  // ---- Peek: read a note without leaving HQ, in the drawer projects use. Open the note from there when you want more.
  let peek = null;
  const peekButton = (path, label, cls = "vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost") => api.readNote ? `<button class="${cls}" data-peek="${esc(path)}">${esc(label)}</button>` : api.openNote ? `<button class="${cls}" data-open="${esc(path)}">${esc(label)}</button>` : "";
  async function peekOpen(path) {
    peek = { path, blocks: null, cut: false, failed: false }; render();
    try { const out = VGRules.notePreview(await api.readNote(path)); if (peek && peek.path === path) { Object.assign(peek, out); render(); const x = el.querySelector(".vg-hq-peek .vg-hq-x"); if (x) x.focus(); } }
    catch (e) { if (peek && peek.path === path) { peek.failed = true; render(); } }
  }
  function peekHtml() {
    if (!peek) return "";
    const block = b => (b.kind === "h" ? `<h${Math.min(6, b.level + 2)} class="vg-hq-peek-h">${esc(b.text)}</h${Math.min(6, b.level + 2)}>` : b.kind === "code" ? `<pre><code>${esc(b.text)}</code></pre>` : b.kind === "li" ? `<p class="vg-hq-peek-li${b.deep ? " is-deep" : ""}${b.done ? " is-done" : ""}">${b.task ? (b.done ? "☑ " : "☐ ") : "• "}${esc(b.text)}</p>` : `<p>${esc(b.text)}</p>`);
    const body = peek.failed ? `<p class="vg-hq-lede">That note isn't there any more.</p>` : !peek.blocks ? `<p class="vg-hq-lede">Reading…</p>` : peek.blocks.length ? peek.blocks.map(block).join("") : `<p class="vg-hq-lede">This note is empty.</p>`;
    return `<div class="vg-hq-scrim" data-peekclose></div><aside class="vg-hq-drawer vg-hq-peek" role="dialog" aria-modal="false" aria-label="${esc(nameOf(peek.path))}" tabindex="-1"><button class="vg-hq-x" data-peekclose aria-label="Close the preview">${icon("close")}</button>
      <h2>${esc(nameOf(peek.path))}</h2><small>${esc(peek.path)}</small>${api.openNote ? `<div class="vg-hq-row"><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-primary" data-open="${esc(peek.path)}">Open the note</button></div>` : ""}
      <div class="vg-hq-peek-body">${body}</div>${peek.cut ? '<p class="vg-hq-lede">The rest is in the note.</p>' : ""}</aside>`;
  }

