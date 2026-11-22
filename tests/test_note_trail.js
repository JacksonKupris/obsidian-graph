#!/usr/bin/env node
// Going from note to note and back: Escape (and a phone's back gesture) steps back through the notes opened in the inspector,
// one at a time, then closes it. It used to close the inspector from any depth and forget where you had been.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph";
  try {
    check(await tab.waitFor(`${V} && ${V}._debug ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(200);   // ends the tour, which removing its elements does not
    const ids = env.data().nodes.filter(n => !n.ghost && !n.person && !n.moc && !n.hub).slice(0, 3).map(n => n.id);
    check(ids.length === 3, "the page must offer three notes to walk through: " + ids.length);
    for (const id of ids) { await tab.ev(`${V}._debug.select(${JSON.stringify(id)})`); await sleep(150); }
    const sel = () => tab.ev(`${V}._debug.st.selected`);
    const esc = async () => { await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(200); };
    check(await sel() === ids[2], "the third note should be open");
    await esc(); check(await sel() === ids[1], "Escape should step back to the second note, got " + await sel());
    await esc(); check(await sel() === ids[0], "Escape should step back to the first note, got " + await sel());
    await esc(); check(await sel() === null, "the last Escape should close the inspector, got " + await sel());
    await esc(); check(await sel() === null, "another Escape stays closed");
    // opening a note afresh starts a new trail: nothing left over from the first walk
    await tab.ev(`${V}._debug.select(${JSON.stringify(ids[1])})`); await sleep(150); await esc();
    check(await sel() === null, "a fresh note closes on the first Escape, got " + await sel());
  } finally { await tab.close(); }
  finish(fails, "Escape walks back through the notes opened, then closes the inspector");
})();
