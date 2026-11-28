#!/usr/bin/env node
// A map row in the sidebar lights up the notes its map is missing and opens the map's note in one gesture, so one Escape undoes both:
// it used to close the note and leave the graph dimmed with the "N not in the map" pill, needing a second Escape.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    const esc = async () => { await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(250); };
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`); await esc();   // ends the tour
    check(await tab.ev(`!!document.querySelector(".vg-maprow")`), "the sidebar must offer a map row, or this test reads nothing");
    await tab.ev(`document.querySelector(".vg-maprow").click()`); await sleep(400);
    check(await tab.ev(`!!${V}.st.highlight && !!${V}.st.selected`), "the map row must light up notes and open the map");
    await esc();
    check(await tab.ev(`${V}.st.selected === null && !${V}.st.highlight`), "one Escape must close the note and clear the light-up: " + await tab.ev(`JSON.stringify([${V}.st.selected, !!${V}.st.highlight])`));
    // a light-up made on its own (no note opened with it) still takes its own Escape
    await tab.ev(`${V}.select(${JSON.stringify(env.data().nodes.find(n => !n.ghost && !n.person && !n.moc && !n.hub).id)})`); await sleep(150);
    await esc(); check(await tab.ev(`${V}.st.selected === null`), "a plainly opened note closes on one Escape");
  } finally { await tab.close(); }
  finish(fails, "Escape undoes a map row's light-up and its note together");
})();
