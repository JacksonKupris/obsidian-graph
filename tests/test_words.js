#!/usr/bin/env node
// One word for each thing, on every screen a person reads: topic (never cluster), map (never MOC), view (never lens). The page is opened
// and walked: both sidebar tabs, every picker tab, every view that opens beside the graph, a note and a map in the inspector, search and
// the Upkeep panel. Text, tooltips, placeholders and names a screen reader says all count. The source is read too, for what only shows
// after an action (toasts, notices, dialogs).
//   node tests/test_words.js [--vault [dir]]        exit 0 = pass
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const OLD = "\\b(clusters?|unclustered|mocs?|lens(es)?)\\b";

// ---- the source: a word in a sentence, inside a string. Keys ("cluster", data-tab="clusters") and code stay as they are.
{ const SRC = path.join(__dirname, "..", "src"), walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
  const inSentence = /["'`>][^"'`<>]*(\bMOCs?\b(?! Alignment)|[A-Za-z,:] [Cc]lusters?\b(?!:)|(?<![-\w])[Cc]lusters? [a-zA-Z]+[^"'`<>:{]*["'`<])/;
  // engine.js writes the reports, which other tools read back by their headings: those stay until the reports are looked at on their own
  const skip = new Set(["engine.js"]);
  let scanned = 0;
  for (const f of walk(SRC)) { if (skip.has(path.basename(f))) continue; scanned++;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => { const code = line.replace(/\/\/ .*$/, "").replace(/\/\*.*?\*\//g, "");
      if (inSentence.test(code)) fails.push(`${path.relative(SRC, f)}:${i + 1} says the old word: ${code.trim().slice(0, 110)}`); }); }
  check(scanned > 30, `only ${scanned} source files read`);
  const hit = "toast(`Created a MOC`)"; check(inSentence.test(hit), "the source check can't find a sentence with the old word"); }

const SCAN = `(names => { const old = new RegExp(${JSON.stringify(OLD)}, "i"), root = document.querySelector(".vg-root"), out = [];
  const clean = s => { let t = String(s || ""); names.forEach(n => { t = t.split(n).join(" "); }); return t; };
  const seen = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const add = (e, what, s) => { const t = clean(s); if (old.test(t)) out.push(what + ": " + t.trim().slice(0, 90)); };
  root.querySelectorAll("*").forEach(e => { if (e.closest(".vg-sr, svg") ) return;
    ["title", "placeholder", "aria-label"].forEach(a => { if (e.hasAttribute(a)) add(e, a, e.getAttribute(a)); });
    if (seen(e)) for (const n of e.childNodes) if (n.nodeType === 3) add(e, e.tagName + "." + String(e.className).split(" ")[0], n.textContent); });
  return { hits: out, size: root.querySelectorAll("*").length }; })`;

(async () => {
  const tab = await openPage({ html: env.pageWith(["writeNote", "createMap"].map(k => `${k}: async () => true,`).join(" ")) });
  const D = "window.vaultGraph._debug", ev = e => tab.ev(e), hits = new Set();
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    // what notes and topics are called is the vault's own words, not ours
    const names = await ev(`JSON.stringify([...new Set([...${D}.nodes.map(n => n.name), ...${D}.nodes.map(n => n.id), ...${D}.clusters().flatMap(c => [c.name, c.label, c.keywords, ...(c.core || [])])].filter(Boolean))].sort((a, b) => b.length - a.length))`);
    const scan = async where => { const r = JSON.parse(await ev(`JSON.stringify(${SCAN}(${names}))`)); check(r.size > 50, `${where}: nothing to read`); r.hits.forEach(h => hits.add(`${where} · ${h}`)); };
    await ev(`document.querySelectorAll(".vg-tour").forEach(x => x.remove())`);
    await scan("the graph");
    await ev(`document.querySelector('.vg-tab[data-tab="clusters"]').click()`); await sleep(200);
    check(await ev(`document.querySelector('.vg-tab[data-tab="clusters"]').textContent.trim()`) === "Topics", "the tab should say Topics");
    await scan("Topics"); await ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`);
    await ev(`document.querySelector(".vg-gamebtn").click()`); await sleep(300); await scan("Upkeep"); await ev(`document.querySelector(".vg-gamebtn").click()`);
    for (const t of ["views", "style", "health"]) { await ev(`(() => { const p = document.querySelector(".vg-picker"); if (p.hidden) document.querySelector(".vg-pickbtn").click(); document.querySelector('.vg-picker-tab[data-tab="${t}"]').click(); })()`); await sleep(200); await scan(`picker ${t}`); }
    await ev(`document.querySelector(".vg-picker-x").click()`);
    for (const pick of ["!n.ghost && !n.person && !n.moc", "n.moc"]) {
      const id = await ev(`(() => { const n = ${D}.nodes.filter(n => ${pick})[0]; if (n) window.vaultGraph.focusNote(n.id); return n ? n.id : null; })()`);
      check(id, `no note for ${pick}`); await sleep(500); await scan(pick === "n.moc" ? "a map's panel" : "a note's panel"); }
    await ev(`document.querySelector(".vg-searchbtn").click()`); await sleep(150);
    await ev(`(() => { const i = document.querySelector(".vg-pq"); i.value = "a"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300); await scan("search");
    await ev(`document.querySelector(".vg-pq").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    const lenses = JSON.parse(await ev(`JSON.stringify(${D}.lenses())`)); check(lenses.length > 15, `${lenses.length} lenses`);
    for (const k of lenses) { await ev(`${D}.openLens(${JSON.stringify(k)})`); await tab.waitFor(`document.querySelector(".vg-lens-body") && !/^Loading/.test(document.querySelector(".vg-lens-body").textContent) ? 1 : 0`, 15000); await sleep(60); await scan(`view ${k}`); }
    // the check can fail: plant the old word and it has to find it
    await ev(`document.querySelector(".vg-lens-body").insertAdjacentHTML("beforeend", "<p>2 clusters</p>")`);
    const planted = JSON.parse(await ev(`JSON.stringify(${SCAN}(${names}))`)); check(planted.hits.some(h => /2 clusters/.test(h)), "the page check didn't find a planted old word");
  } catch (e) { fails.push(e.message); }
  hits.forEach(h => fails.push(h));
  await tab.close();
  finish(fails, "One word each: topic, map, view, on every screen");
})();
