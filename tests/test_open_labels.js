#!/usr/bin/env node
// A Today/Triage item whose only action is opening a note says what it opens ("Open the note"), not a bare "Open".
// One shared answer, VGActions.todayOpens(item), tells every surface the main button only opens; none compares to a label.
const fs = require("fs"), path = require("path");
const { checks, finish, openPage } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const { fails, ok: check } = checks();
  try {
    const r = await tab.ev(`(() => { const A = typeof VGActions === "undefined" ? null : VGActions; if (!A) return null;
      return ["inbox", "approval", "job"].map(k => ({ kind: k, label: A.todayLabel({ kind: k }), opens: typeof A.todayOpens === "function" ? A.todayOpens({ kind: k }) : null })); })()`);
    check(r, "VGActions must be on the page");
    for (const x of r || []) {
      check(x.label && !/^open$/i.test(x.label), `${x.kind}: the button says "${x.label}"`);
      check(x.opens === true, `${x.kind}: VGActions.todayOpens should be true (got ${x.opens})`);
    }
    for (const f of ["src/hq/00-core.js", "src/plugin/10-views.js"]) {
      const s = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      check(!/todayLabel\([a-z0-9]*\) === "Open"/.test(s), `${f} compares the label to "Open"; use VGActions.todayOpens`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "open-only items say what they open, from one shared rule", "open labels");
})();
