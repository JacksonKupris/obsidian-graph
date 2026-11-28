#!/usr/bin/env node
// Keep takes a note out of a black hole's review queue; it says so, offers Undo, and the panel can put kept notes back
// (returning persona, 2026-11-25: Keep was a one-way skip that survived reload with no message).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const { fails, ok: check } = checks();
  const queue = () => tab.ev(`[...document.querySelectorAll(".vg-bh-row [data-bhk]")].map(b => b.dataset.bhk)`);
  const click = sel => tab.ev(`(() => { const b = document.querySelector('${sel}'); if (b) b.click(); return !!b; })()`);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`${D}.openView("cosmos")`); await sleep(1500);
    check(await tab.ev(`${D}.openBody("blackhole")`), "the first visit places a black hole"); await sleep(400);
    const before = await queue();
    check(before.length > 0, "the sample has stale notes to review (the test can't fail without them)");
    await click(".vg-bh-row [data-bhk]"); await sleep(400);
    check((await queue()).length === before.length - 1, "Keep takes the note out of the queue");
    check(await tab.ev(`/Kept .+ out of review/.test((document.querySelector(".vg-toasts") || {}).textContent || "")`), "Keep says what it did");
    check(await click(".vg-toast-undo"), "Keep offers Undo"); await sleep(400);
    check((await queue()).join() === before.join(), "Undo puts the note back in the queue");
    await click(".vg-bh-row [data-bhk]"); await sleep(400);
    await tab.ev(`document.querySelector(".vg-toasts").innerHTML = ""`);
    check(await tab.ev(`/1 kept out of review/.test(document.querySelector(".vg-inspector").textContent)`), "the panel counts the kept notes");
    check(await click(".vg-inspector [data-b=unkeep]"), "the panel can put them back"); await sleep(400);
    check((await queue()).join() === before.join(), "Put back returns every kept note");
    check(!await tab.ev(`!!document.querySelector(".vg-inspector [data-b=unkeep]")`), "with nothing kept the button is gone");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Keep can be undone", "cosmos keep");
})();
