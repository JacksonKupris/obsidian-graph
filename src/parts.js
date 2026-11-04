// parts.js - the interface's shared pieces, the same in the graph and in Vault HQ: a card, a row of cards with what's behind them,
// a section with a count, a show more, a how-to-read note and a long list that shows its first few. Each returns HTML; styles are
// in parts.css. tests/test_parts.js fails if a view writes its own again.
//   VGParts.cards([{ value, label, hint, open, tone }])   open: the key of what's behind the card (see wire). A card with a hint
//                                                         opens that; one with neither isn't a button, so it doesn't look clickable.
//   VGParts.section({ title, count, body }) · VGParts.more({ label, count, body, open }) · VGParts.howTo(text)
//   VGParts.row({ title, sub, open: path }) · VGParts.list(rowsHtml, { first, word })
//   VGParts.wire(root, { details: { key: () => ({ title, body }) }, openNote(path, event) })   once per root; call again to change them
const VGParts = (() => {
  const esc = VGShared.escapeHtml;
  function card({ value, label, hint, open, tone }) {
    const inner = `<b>${esc(value)}</b><span>${esc(label)}</span>`, cls = `ds-card${tone ? ` is-${esc(tone)}` : ""}`;
    if (!open && !hint) return `<div class="${cls}">${inner}</div>`;
    return `<button class="${cls}" data-card="${esc(open || "")}" data-card-label="${esc(label)}"${hint ? ` data-card-hint="${esc(hint)}"` : ""} aria-expanded="false">${inner}</button>`;
  }
  const cards = (items, o = {}) => `<div class="ds-cards${o.small ? " is-small" : ""}">${items.map(card).join("")}</div>`;
  const count = n => (n == null ? "" : ` <span class="ds-count">${esc(n)}</span>`);
  const section = ({ title, count: n, body }) => `<section class="ds-section"><h4>${esc(title)}${count(n)}</h4>${body}</section>`;
  const more = ({ label, count: n, body, open }) => `<details class="ds-more"${open ? " open" : ""}><summary>${esc(label)}${count(n)}</summary><div class="ds-more-body">${body}</div></details>`;
  const howTo = text => more({ label: "How to read this", body: `<p>${text}</p>` });
  const row = ({ title, sub, open }) => {
    const inner = `<span>${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}`;
    return open ? `<button class="ds-row" data-part-open="${esc(open)}">${inner}</button>` : `<div class="ds-row">${inner}</div>`;
  };
  // the first few, and the rest behind a show more. Nothing is left out.
  const list = (rows, { first = 5, word = "more" } = {}) => `<div class="ds-rows">${rows.slice(0, first).join("")}</div>${rows.length > first ? more({ label: `Show ${rows.length - first} ${word}`, body: `<div class="ds-rows">${rows.slice(first).join("")}</div>` }) : ""}`;

  // what's behind a card opens right under its row, one at a time; pressing the card again or the close button closes it
  function closeDetail(grid) {
    const open = grid.nextElementSibling;
    if (open && open.classList.contains("ds-detail")) open.remove();
    grid.querySelectorAll('[aria-expanded="true"]').forEach(c => c.setAttribute("aria-expanded", "false"));
  }
  function openDetail(btn, details) {
    const grid = btn.closest(".ds-cards"), was = btn.getAttribute("aria-expanded") === "true"; closeDetail(grid); if (was) return;
    const key = btn.dataset.card, got = key && details[key] ? details[key]() : {}, hint = btn.dataset.cardHint;
    const panel = document.createElement("div"); panel.className = "ds-detail"; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", got.title || btn.dataset.cardLabel);
    panel.innerHTML = `<div class="ds-detail-head"><b>${esc(got.title || btn.dataset.cardLabel)}</b><button class="ds-detail-close" aria-label="Close">✕</button></div>${hint ? `<p>${esc(hint)}</p>` : ""}${got.body || ""}`;
    grid.after(panel); btn.setAttribute("aria-expanded", "true");
  }
  function wire(root, o = {}) {
    root.__dsParts = o;
    if (root.__dsWired) return; root.__dsWired = true;
    root.addEventListener("click", e => {
      const P = root.__dsParts, go = e.target.closest("[data-part-open]");
      if (go) { e.stopPropagation(); if (P.openNote) P.openNote(go.dataset.partOpen, e); return; }
      const shut = e.target.closest(".ds-detail-close");
      if (shut) { const panel = shut.closest(".ds-detail"), grid = panel.previousElementSibling; if (grid) closeDetail(grid); const was = grid && grid.querySelector("[data-card]"); if (was) was.focus(); return; }
      const c = e.target.closest("[data-card]"); if (c) openDetail(c, P.details || {});
    });
  }
  return { cards, section, more, howTo, row, list, wire };
})();
