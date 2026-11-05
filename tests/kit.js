// kit.js - what the tests share, so each one holds only what it checks.
//   const { sleep, checks, finish, openPage, tools } = require("./kit")
//   sleep(ms)
//   const { fails, check, ok, that } = checks()   check(name, got, want) compares as JSON; ok(pass, what) and that(what, pass, detail) want pass true
//   finish(fails, "what passed", "what failed")   prints the result and exits: 1 when anything failed
//   const tab = await openPage({ html, mobile })   a page on a free port (tests/cdp.js). Without Chrome the test says it was skipped and ends
//   const { click, screen, shot } = tools(tab, { wait, shots })   click a selector, go to an HQ screen and wait, screenshot into a folder when shots is set
const fs = require("fs"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function checks() {
  const fails = [];
  return { fails,
    ok: (pass, what) => { if (!pass) fails.push(what); },
    check: (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); },
    that: (what, pass, detail) => { if (!pass) fails.push(what + (detail ? `\n      ${detail}` : "")); } };
}
function finish(fails, passed, failed) {
  console.log(fails.length ? `FAIL - ${failed ? failed + ":" : ""}\n  ${fails.join("\n  ")}` : `ok - ${passed}`);
  process.exit(fails.length ? 1 : 0);
}
async function openPage(o) {
  const tab = await require("./cdp").open(o);   // here, not at the top: cdp.js uses sleep from this file
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  return tab;
}
function tools(tab, o = {}) {
  return {
    click: sel => tab.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`),
    screen: async s => { await tab.ev(`window.vaultHQ.setScreen(${JSON.stringify(s)})`); await sleep(o.wait === undefined ? 100 : o.wait); },
    shot: async name => { if (!o.shots) return; fs.mkdirSync(o.shots, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(o.shots, `${name}.png`), Buffer.from(r.result.data, "base64")); },
  };
}
const lumOf = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// in the page: everything showing that a person reads or presses, with what it's named and how it reads
const a11yAudit = (rootSel, srSel) => `(() => {
  const col = s => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = s; c.fillRect; const d = document.createElement("canvas"); d.width = d.height = 1; const x = d.getContext("2d"); x.fillStyle = s; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; };
  const over = (top, under) => { const a = top[3] / 255; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)); };
  const behind = e => { const stack = []; for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.backgroundImage !== "none") return null; const b = col(c.backgroundColor); if (b[3]) { stack.push(b); if (b[3] === 255) break; } } let out = [255, 255, 255]; stack.reverse().forEach(b => { out = over(b, out); }); return out; };
  const seen = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && +c.opacity > 0.05; };
  const root = document.querySelector(${JSON.stringify(rootSel)}), noName = [], low = [], ids = {}, small = [];
  root.querySelectorAll("button, input, select, a[href], [role=button]").forEach(e => { if (!seen(e) || e.disabled) return; const named = (e.getAttribute("aria-label") || e.textContent || e.title || "").trim() || (e.labels && e.labels.length) || (e.getAttribute("aria-labelledby")); if (!named) noName.push(e.outerHTML.slice(0, 90)); const r = e.getBoundingClientRect(); const inSentence = [...e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (Math.min(r.width, r.height) < 24 && e.type !== "checkbox" && !inSentence) small.push(e.parentElement.className + " > " + ((e.getAttribute("aria-label") || e.textContent || e.className) + "").trim().slice(0, 24) + " " + Math.round(r.width) + "x" + Math.round(r.height)); });
  root.querySelectorAll("[id]").forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  root.querySelectorAll("*").forEach(e => { if (!seen(e) || e.closest("svg") || e.closest(${JSON.stringify(srSel)}) || e.disabled) return; const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) return; const c = getComputedStyle(e), bg = behind(e); if (!bg) return; let o = 1; for (let n = e; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; const fg = over([...col(c.color).slice(0, 3), col(c.color)[3] * o], bg); low.push([e.parentElement.className.split(" ")[0] + " > " + e.tagName + "." + String(e.className).split(" ")[0], e.textContent.trim().slice(0, 28), fg, bg, parseFloat(c.fontSize), +c.fontWeight]); });
  return { noName, small, dup: Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k), text: low, h1: root.querySelectorAll("h1").length };
})()`;
// the values vault-design.css gives Obsidian: contrast is judged on these, since a button's ink on its accent belongs to the theme
const FLEXOKI = { light: { "--background-primary": "#FFFCF0", "--background-secondary": "#F2F0E5", "--background-modifier-border": "#E6E4D9", "--text-normal": "#100F0F", "--text-muted": "#6F6E69", "--text-faint": "#878580", "--interactive-accent": "#BC5215", "--text-on-accent": "#FFFCF0", "--text-accent": "#BC5215" }, dark: { "--background-primary": "#100F0F", "--background-secondary": "#1C1B1A", "--background-modifier-border": "#282726", "--text-normal": "#CECDC3", "--text-muted": "#878580", "--text-faint": "#6F6E69", "--interactive-accent": "#DA702C", "--text-on-accent": "#100F0F", "--text-accent": "#F9AE77" } };

module.exports = { sleep, checks, finish, openPage, tools, a11yAudit, contrast, FLEXOKI };
