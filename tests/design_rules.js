// Design rulebook: measurable rules the best product sites share (Linear, Stripe, Vercel, GitHub, Notion, Apple, Shopify, Figma
// and similar). Written from well-known practice, not scraped live: each rule names the pattern it comes from. A rule is a
// function run inside the page that returns the offending elements; the test fails when any are found. Add a rule here and
// every page that test_design.js opens is held to it.
const label = `(e => (typeof e.className === "string" && e.className) || e.tagName)`;
module.exports = [
  { id: "no-sideways-scroll", from: "every responsive site", max: 0, js: `document.documentElement.scrollWidth > innerWidth + 1 ? ["page"] : []` },
  { id: "touch-target", from: "Apple HIG and Material: big enough to hit", max: 0, js: `(min => [...document.querySelectorAll("button, select, a[href], input:not([type=hidden])")].filter(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width && s.visibility !== "hidden" && r.height < min && r.width < min; }).map(${label}).slice(0, 8))(innerWidth < 600 ? 28 : 20)` },
  { id: "readable-text", from: "Stripe and GitHub: nothing under 11px", max: 0, js: `[...document.querySelectorAll("body *")].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 11).map(${label}).slice(0, 8)` },
  { id: "named-controls", from: "WCAG 4.1.2: every control has a name", max: 0, js: `[...document.querySelectorAll("button, select, input:not([type=hidden])")].filter(e => e.getBoundingClientRect().width && !(e.getAttribute("aria-label") || e.title || e.textContent.trim() || (e.labels && e.labels.length))).map(${label}).slice(0, 8)` },
  // from the lists' shared advice (Linear, Stripe, Vercel, Notion write-ups): a small, tight type scale and designed empty states
  { id: "tight-type-scale", from: "Linear, Stripe and Vercel keep to a few text sizes", max: 0, js: `(() => { const s = new Set([...document.querySelectorAll(".vg-hq *")].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width).map(e => Math.round(parseFloat(getComputedStyle(e).fontSize)))); return s.size > 10 ? ["" + s.size + " sizes: " + [...s].sort((a, b) => a - b).join(",")] : []; })()` },
  { id: "empty-state-has-next-step", from: "Notion and Linear design their empty states", max: 0, js: `[...document.querySelectorAll(".vg-hq-empty")].filter(e => !e.querySelector("button, a[href]")).map(${label})` },
  { id: "text-contrast", from: "WCAG AA, which Linear and Vercel hold themselves to (floor 3:1 here, 4.5 is the goal)", max: 0, js: `(() => {
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
      const rgb = s => { const m = s.match(/[0-9.]+/g); if (!m) return null; const n = m.map(Number); return s.startsWith("color(srgb") ? [n[0] * 255, n[1] * 255, n[2] * 255, ...(n.length > 3 ? [n[3]] : [])] : n; };   // color-mix() comes back as color(srgb, values 0 to 1)
      const bg = e => { for (let x = e; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c && (c.length < 4 || c[3] > .5)) return c.slice(0, 3); } return [255, 255, 255]; };
      return [...document.querySelectorAll("body *")].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2) && e.getBoundingClientRect().width).filter(e => { const f = rgb(getComputedStyle(e).color); if (!f || (f.length > 3 && f[3] < .9)) return false; const a = lum(f.slice(0, 3)), b = lum(bg(e)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 3; }).map(${label}).slice(0, 8); })()` },
];
