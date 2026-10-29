#!/usr/bin/env node
const assert = require("assert"), cdp = require("./cdp"), env = require("./env");

(async () => {
  for (const mobile of [false, true]) {
    const tab = await cdp.open({html: env.hqPage(""), port: 9353, mobile});
    if (!tab) throw new Error("HQ usability regression requires Chrome");
    tab.ev = async expression => {
      const { result } = await tab.send("Runtime.evaluate", {expression, awaitPromise:true, returnByValue:true});
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    try {
      assert(await tab.waitFor("window.vaultHQ ? 1 : 0", 20000));
      await tab.ev(`(() => {
        DATA.hq.projects = [
          {path:"Child.md", name:"Child", title:"Print Consumption", summary:"Roll balances", kind:"Story", status:"in-progress", group:"active", systems:["project/odoo"], parents:["Parent.md"], related:["Other.md"], tasks:[{line:5,text:"Check roll",title:"Check roll",section:"Acceptance"}]},
          {path:"Missing.md", name:"Missing", title:"Needs a status", kind:"Scope", status:"", group:"other", systems:["project/server"],tasks:[]},
          {path:"Ancient.md", name:"Ancient", title:"Ancient approval", kind:"Scope", status:"waiting", group:"waiting", updated:"2020-01-01", tasks:[]}
        ];
        DATA.hq.journals = [{path:VGRules.folders.daily+"/2026/10-October/Journal/2026-10-28.md", date:"2026-10-28",tasks:[{line:1,text:"Current action",mark:" "}]}];
        DATA.hq.standups = [];
        DATA.hq.reviews = [{path:"Review.md",name:"Backlog Reconciliation test",title:"Review",status:"pending",reviewOnly:true}];
        window.__calls = [];
        window.vaultHQ.destroy();
        window.vaultHQ = mountVaultHQ(document.getElementById("hq"),DATA,{
          api:{openNote:p=>window.__calls.push(["open",p]),setNoteStatus:async(...a)=>window.__calls.push(["status",...a]),hqMark:async()=>{}},
          ask:async()=>true,now:new Date("2026-10-28T12:00:00")
        });
        window.vaultHQ.setScreen("today");
      })()`);
      assert(await tab.ev(`document.querySelector(".vg-hq-next").textContent.includes("Current action")`), "today action must outrank approval");
      await tab.ev(`window.vaultHQ.setScreen("projects");window.__selectProjectFilter=(key,value)=>{const s=document.querySelector('[data-project-filter="'+key+'"]');s.value=value;s.focus();s.dispatchEvent(new Event("change",{bubbles:true}));};`);
      assert.deepEqual(await tab.ev(`[...document.querySelectorAll(".vg-hq-project-filters select")].map(s=>[s.getAttribute("aria-label"),s.value])`),
        [["Kind","all"],["System","all"],["Project status","active"]], "labeled native dropdowns retain defaults");
      assert.equal(await tab.ev(`document.querySelector('[data-project-filter="kind"] option[value="all"]').textContent`), "All kinds (3)");
      assert.equal(await tab.ev(`document.querySelector('[data-project-filter="status"] option[value="active"]').textContent`), "In progress (1)");
      await tab.ev(`window.__selectProjectFilter("kind","Story");window.vaultHQ.update(null,null)`);
      assert.equal(await tab.ev(`document.querySelector('[data-project-filter="kind"]').value`), "Story");
      assert.equal(await tab.ev(`document.activeElement.dataset.projectFilter`), "kind", "keyboard focus survives rerender");
      assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`), 1);
      await tab.ev(`window.__selectProjectFilter("kind","all");window.__selectProjectFilter("status","all");const s=document.querySelector("input[type=search]");s.value="roll balances";s.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[data-compact]").click();window.vaultHQ.update(null,null);`);
      assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`), 1);
      assert.equal(await tab.ev(`document.querySelector("input[type=search]").value`), "roll balances");
      assert(await tab.ev(`!!document.querySelector(".vg-hq-grid.is-compact")`));
      for (const query of ["prnt cons", "balances roll", "balnces"]) {
        await tab.ev(`(() => {const s=document.querySelector("input[type=search]");s.value=${JSON.stringify(query)};s.dispatchEvent(new Event("input",{bubbles:true}));window.vaultHQ.update(null,null);})()`);
        assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`),1,`graph-style search: ${query}`);
        assert.equal(await tab.ev(`document.querySelector(".vg-hq-proj").dataset.proj`),"Child.md");
      }
      assert(await tab.ev(`!!document.querySelector(".vg-hq-search-hit")`), "recall results explain the content match");
      await tab.ev(`document.querySelector(".vg-hq-proj").click()`);
      assert(await tab.ev(`document.querySelector(".vg-hq-drawer").textContent.includes("Parent: Parent.md")`));
      assert(await tab.ev(`document.querySelector(".vg-hq-drawer").textContent.includes("Source heading: Acceptance")`));
      const point = await tab.ev(`(() => {const r=document.querySelector(".vg-hq-chips [data-go=needs]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await tab.send("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1});
      await tab.send("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1});
      assert.equal(await tab.ev("window.vaultHQ.screen()"), "needs", "drawer must not block header navigation");
      assert(await tab.ev(`!!document.querySelector('[data-act="reviewed"]')`));
      assert(!await tab.ev(`!!document.querySelector('[data-key="review|Review.md"] [data-act="rows"]')`), "review-only item cannot apply rows");
      await tab.ev(`document.querySelector('[data-act="reviewed"]').click()`);
      await tab.waitFor(`window.__calls.length ? 1 : 0`, 5000);
      assert.deepEqual(await tab.ev("window.__calls"), [["status","Review.md","reviewed"]]);
      await tab.ev(`(() => {window.vaultHQ.setScreen("projects");document.querySelector("[data-clearsearch]")?.click();const s=document.querySelector("input[type=search]");s.value="";s.dispatchEvent(new Event("input",{bubbles:true}));window.__selectProjectFilter("status","other")})()`);
      assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`), 1, "unclassified record visible");
      await tab.ev(`window.__selectProjectFilter("system","project/odoo");window.vaultHQ.update(null,null)`);
      assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`), 0, "system filter survives refresh");
      assert.deepEqual(await tab.ev(`[...document.querySelectorAll(".vg-hq-project-filters select")].map(s=>s.value)`), ["all","project/odoo","other"]);
      assert.equal(await tab.ev(`document.querySelector('[data-project-filter="status"] option[value="all"]').textContent`), "All (1)", "status counts follow kind and system");
      await tab.ev(`document.querySelector("[data-clearsearch]").click()`);
      assert.deepEqual(await tab.ev(`[...document.querySelectorAll(".vg-hq-project-filters select")].map(s=>s.value)`), ["all","all","all"], "clear restores all filter groups");
      await tab.ev(`DATA.hq.journals=[{path:VGRules.folders.daily+"/2026/10-October/Journal/2026-10-26.md",date:"2026-10-26",tasks:[{line:1,text:"Repeat task",mark:" "}]},{path:VGRules.folders.daily+"/2026/10-October/Journal/2026-10-27.md",date:"2026-10-27",tasks:[{line:2,text:"Repeat task",mark:" "}]}];window.vaultHQ.update(null,null);window.vaultHQ.setScreen("sweep")`);
      assert(await tab.ev(`!!document.querySelector(".vg-hq-duplicates")`));
      assert.equal(await tab.ev(`document.querySelectorAll("[data-one=x]").length`), 2, "duplicate grouping preserves independent actions");
      assert(!await tab.ev("document.documentElement.scrollWidth > innerWidth+1"), "phone must not overflow");
    } finally {await tab.close();}
  }
  console.log("ok - actionable Today, project search/filter persistence, drawer navigation, safe review and duplicate triage");
})().catch(error => {console.error(error);process.exitCode=1;});
