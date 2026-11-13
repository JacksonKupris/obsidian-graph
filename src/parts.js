// parts.js - the interface's shared pieces, the same in the graph and in Vault HQ: a card, a row of cards with what's behind them,
// a section with a count, a show more, a how-to-read note and a long list that shows its first few. Each returns HTML; styles are
// in parts.css. tests/test_parts.js fails if a view writes its own again.
//   VGParts.cards([{ value, label, sub, hint, open, tone }])   open: the key of what's behind the card (see wire). A card with a hint
//                                                         opens that; one with neither isn't a button, so it doesn't look clickable.
//   VGParts.section({ title, count, hint, body }) · VGParts.more({ label, count, body, open }) · VGParts.howTo(text)    hint: one short line, as HTML
//   VGParts.heading(title, count): a heading alone, for a list that isn't a section (a menu)
//   VGParts.row({ title, sub, open: path }) · VGParts.list(rowsHtml, { first, word })
//   VGParts.wire(root, { details, openNote(path, event), onOpen(panel) })   details: { key: () => ({ title, body }) }, or a function returning
//                                                         that. onOpen wires a panel's rows. Once per root; call again to change them.
const VGParts = (() => {
  const esc = VGShared.escapeHtml;
  function card({ value, label, sub, hint, open, tone, data, title }) {
    const inner = `<b>${esc(value)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}`, cls = `ds-card${tone ? ` is-${esc(tone)}` : ""}`;
    // data: what the view does with the press itself (data-stat="all"), with no panel
    if (data) return `<button class="${cls}"${Object.entries(data).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join("")}${title ? ` title="${esc(title)}"` : ""}>${inner}</button>`;
    if (!open && !hint) return `<div class="${cls}">${inner}</div>`;
    return `<button class="${cls}" data-card="${esc(open || "")}" data-card-label="${esc(label)}"${hint ? ` data-card-hint="${esc(hint)}"` : ""} aria-expanded="false">${inner}</button>`;
  }
  const cards = (items, o = {}) => `<div class="ds-cards${o.small ? " is-small" : ""}">${items.map(card).join("")}</div>`;
  const count = n => (n == null ? "" : ` <span class="ds-count">${esc(n)}</span>`);
  const heading = (title, n) => `<h4 class="ds-heading">${esc(title)}${count(n)}</h4>`;
  const section = ({ title, count: n, hint, body }) => `<section class="ds-section"><h4>${esc(title)}${count(n)}</h4>${hint ? `<p class="ds-hint">${hint}</p>` : ""}${body}</section>`;
  const more = ({ label, head, count: n, body, open, cls }) => `<details class="ds-more${cls ? ` ${esc(cls)}` : ""}"${open ? " open" : ""}><summary>${head || esc(label)}${count(n)}</summary><div class="ds-more-body">${body}</div></details>`;
  const howTo = text => more({ label: "How to read this", body: `<p>${text}</p>` });
  const row = ({ title, sub, open }) => {
    const inner = `<span>${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}`;
    return open ? `<button class="ds-row" data-part-open="${esc(open)}">${inner}</button>` : `<div class="ds-row">${inner}</div>`;
  };
  // the first few, and the rest behind a show more. Nothing is left out.
  const list = (rows, { first = 5, word = "more", cls } = {}) => { const box = `ds-rows${cls ? ` ${esc(cls)}` : ""}`; return `<div class="${box}">${rows.slice(0, first).join("")}</div>${rows.length > first ? more({ label: `Show ${rows.length - first} ${word}`, body: `<div class="${box}">${rows.slice(first).join("")}</div>` }) : ""}`; };

  // a redraw (after an action, or new data) leaves what was open open. Known by its words and not its numbers: a count changes as you work.
  const words = t => t.replace(/\d+/g, "#");
  const moreKey = d => { const s = d.closest(".ds-section"), h = s && s.querySelector("h4"), m = d.querySelector("summary"); return words(`${h ? h.textContent : ""}|${m ? m.textContent : ""}`); };
  const opened = root => ({ cards: [...root.querySelectorAll('[data-card][aria-expanded="true"]')].map(c => words(c.dataset.cardLabel)), mores: [...root.querySelectorAll("details.ds-more[open]")].map(moreKey) });
  function reopen(root, was) {
    if (!was) return;
    root.querySelectorAll("[data-card]").forEach(c => { if (was.cards.includes(words(c.dataset.cardLabel))) c.click(); });
    root.querySelectorAll("details.ds-more").forEach(d => { if (was.mores.includes(moreKey(d))) d.open = true; });
  }

  // what's behind a card opens right under its row, one at a time; pressing the card again or the close button closes it
  function closeDetail(grid) {
    const open = grid.nextElementSibling;
    if (open && open.classList.contains("ds-detail")) open.remove();
    grid.querySelectorAll('[aria-expanded="true"]').forEach(c => c.setAttribute("aria-expanded", "false"));
  }
  function openDetail(btn, details) {
    const grid = btn.closest(".ds-cards"), was = btn.getAttribute("aria-expanded") === "true"; closeDetail(grid); if (was) return;
    const known = typeof details === "function" ? details() : details, key = btn.dataset.card, got = key && known[key] ? known[key]() : {}, hint = btn.dataset.cardHint;
    const panel = document.createElement("div"); panel.className = "ds-detail"; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", got.title || btn.dataset.cardLabel);
    panel.innerHTML = `<div class="ds-detail-head"><b>${esc(got.title || btn.dataset.cardLabel)}</b><button class="ds-detail-close" aria-label="Close">✕</button></div>${hint ? `<p>${esc(hint)}</p>` : ""}${got.body || ""}`;
    grid.after(panel); btn.setAttribute("aria-expanded", "true");
    return panel;
  }
  function wire(root, o = {}) {
    root.__dsParts = o;
    if (root.__dsWired) return; root.__dsWired = true;
    root.addEventListener("click", e => {
      const P = root.__dsParts, go = e.target.closest("[data-part-open]");
      if (go) { e.stopPropagation(); if (P.openNote) P.openNote(go.dataset.partOpen, e); return; }
      const shut = e.target.closest(".ds-detail-close");
      if (shut) { const panel = shut.closest(".ds-detail"), grid = panel.previousElementSibling; if (grid) closeDetail(grid); const was = grid && grid.querySelector("[data-card]"); if (was) was.focus(); return; }
      const c = e.target.closest("[data-card]"); if (!c) return;
      const panel = openDetail(c, P.details || {}); if (panel && P.onOpen) P.onOpen(panel);
    });
    // Escape closes the open card's panel first and puts focus back on the card; with none open it passes through to the view
    root.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      const open = root.querySelector('.ds-detail'); if (!open) return;
      const grid = open.previousElementSibling, was = grid && grid.querySelector('[aria-expanded="true"]');
      e.stopPropagation(); e.preventDefault(); if (grid) closeDetail(grid); if (was) was.focus();
    }, true);
  }
  // The one next-step control: the header chip (label shown) or a Go button inside a card. Every surface builds it here, so a second kind of "Next" can't appear.
  const nextButton = ({ label = "", chip = false } = {}) => chip
    ? `<button class="vg-hq-nextchip" data-nextstep title="${esc(label)}"><span class="vg-hq-nextdot" aria-hidden="true"></span><small>Next</small><b>${esc(label)}</b></button>`
    : `<button class="vg-hq-btn" data-nextstep>Go</button>`;
  // The one list item, for menu tiles and sidebar rows: a lead (icon, dot), a title, an optional tag (the science field), a middle (a bar) and a sub line.
  // title, mid, sub and lead are HTML the caller has already escaped; the tag is plain text.
  const item = ({ cls = "", attrs = "", lead = "", title = "", tag = "", mid = "", sub = "" } = {}) =>
    `<button class="vg-item${cls ? " " + cls : ""}"${attrs ? " " + attrs : ""}>${lead}<span class="vg-item-main">${title}${tag ? `<em class="vg-item-tag">${esc(tag)}</em>` : ""}${mid}${sub ? `<span class="vg-item-sub">${sub}</span>` : ""}</span></button>`;
  return { cards, heading, section, more, howTo, row, list, wire, opened, reopen, nextButton, item };
})();
