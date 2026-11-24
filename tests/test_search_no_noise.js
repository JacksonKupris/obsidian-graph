#!/usr/bin/env node
// A word that is in no note's name or folder lists no notes. The search also reads the folder path, and matched a word's letters
// scattered across it ("stale" in "…/Rental App/API Design"), so unrelated notes filled the list as if they were results (found by
// the returning persona). A word that is in the folder name still finds the notes in that folder.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data();
  const folderWord = (data.nodes.find(n => n.folder && /[A-Za-z]{5,}/.test(n.folder.split("/").pop())) || {}).folder;
  const inFolder = folderWord ? folderWord.split("/").pop().toLowerCase().match(/[a-z]{5,}/)[0] : null;
  check(!!inFolder, "the sample data needs a note in a folder with a word of five letters");
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000), "the graph must mount");
    const search = async q => { await tab.ev(`(() => { const b = document.querySelector(".vg-searchbtn"); if (b) b.click(); })()`); await sleep(200);
      return tab.ev(`(() => { const i = document.querySelector(".vg-pq"); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event("input", { bubbles: true }));
        return [...document.querySelectorAll(".vg-palette-list .vg-pitem:not([data-create])")].map(e => e.textContent.trim().slice(0, 40)); })()`); };
    const none = await search("stale");
    check(none.length === 0, `"stale" is in no note or folder name and must list no notes (got ${JSON.stringify(none)})`);
    await tab.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(200);
    const some = await search(inFolder);
    check(some.length > 0, `"${inFolder}" is a folder name and must still find its notes (got ${some.length})`);
  } finally { await tab.close(); }
  finish(fails, "search lists no unrelated notes", "search no noise");
})();
