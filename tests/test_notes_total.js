#!/usr/bin/env node
// The status pill and the canvas label count the notes drawn. While unlinked notes are hidden that is fewer than the notes in the
// topics, so they say "49 of 51 notes" (the same total the Insights tiles add up to), and plain "51 notes" once nothing is hidden.
// A persona read "49 notes" next to topic sizes that add up to 51 and could not tell which was true.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const data = env.data(), V = "window.vaultGraph._debug";
  const notes = (data.nodes || []).filter(n => !n.person && !n.ghost && !n.moc), total = notes.length, unlinked = notes.filter(n => n.isolated).length;
  check(unlinked > 0, "the sample data needs unlinked notes for this test");
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
    const read = () => tab.ev(`JSON.stringify({ status: document.querySelector(".vg-status").textContent, label: document.querySelector("[id^=vg-cv-label]").textContent })`).then(JSON.parse);
    let r = await read();
    const want = `${total - unlinked} of ${total} notes`;
    check(r.status.includes(want), `with ${unlinked} unlinked notes hidden the status says "${want}" (got "${r.status}")`);
    check(r.label.includes(want), `and so does the canvas label (got "${r.label}")`);
    await tab.ev(`(() => { const b = document.querySelector(".vg-isolated"); if (b) b.click(); })()`); await sleep(600);
    r = await read();
    check(!/ of \d+ notes/.test(r.status) && r.status.includes(`${total} notes`), `with them shown the status says "${total} notes" (got "${r.status}")`);
  } finally { await tab.close(); }
  finish(fails, "the status pill says how many of all the notes are drawn", "notes total");
})();
