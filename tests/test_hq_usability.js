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
          api:{openNote:p=>window.__calls.push(["open",p]),searchNotes:async q=>[{path:"Reference.md",heading:"Cross-screen source",line:4,score:9,why:["content match"],snippet:"A matching note body."}],
            setNoteStatus:async(...a)=>window.__calls.push(["status",...a]),hqMark:async()=>{}},
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
      await tab.ev(`(() => {const style=document.createElement("style");style.textContent="select {height:30px;font-size:11px;background-image:none;padding:0 8px;box-shadow:0 1px 3px black;}";document.head.appendChild(style);})()`);
      assert(await tab.ev(`[...document.querySelectorAll(".vg-hq-select")].every(s => {
        const c=getComputedStyle(s), r=s.getBoundingClientRect();
        return r.height >= 44 && parseFloat(c.fontSize) >= 14 && parseFloat(c.paddingRight) >= 36 &&
          c.backgroundImage.includes("gradient") && c.boxShadow === "none" && r.right <= innerWidth;
      })`), "dropdowns override cramped host styles with readable text, arrow space and touch height");
      assert(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq-global-search"),"::placeholder").opacity === "1"`),
        "search placeholders retain readable opacity");
      await tab.ev(`window.__selectProjectFilter("kind","Story");window.vaultHQ.update(null,null)`);
      assert.equal(await tab.ev(`document.querySelector('[data-project-filter="kind"]').value`), "Story");
      assert.equal(await tab.ev(`document.activeElement.dataset.projectFilter`), "kind", "keyboard focus survives rerender");
      assert.equal(await tab.ev(`document.querySelectorAll(".vg-hq-proj").length`), 1);
      await tab.ev(`window.__selectProjectFilter("kind","Scope");window.__selectProjectFilter("status","other");window.__selectProjectFilter("system","project/server");window.vaultHQ.update(null,null);`);
      assert.equal(await tab.ev(`!!document.querySelector('[data-proj="Child.md"]')`),false,"the active project filters exclude the project result");
      await tab.ev(`document.querySelector("[data-compact]").click();window.vaultHQ.update(null,null);`);
      assert(await tab.ev(`!!document.querySelector(".vg-hq-grid.is-compact")`));
      for (const query of ["prnt cons", "balances roll", "balnces"]) {
        await tab.ev(`(() => {const s=document.querySelector(".vg-hq-global-search");s.focus();s.value=${JSON.stringify(query)};s.dispatchEvent(new Event("input",{bubbles:true}));window.vaultHQ.update(null,null);})()`);
        assert(await tab.waitFor(`document.querySelectorAll(".vg-hq-search-proj").length === 1 ? 1 : 0`,5000),`global project search: ${query}`);
        assert.equal(await tab.ev(`document.querySelector(".vg-hq-search-proj").dataset.proj`),"Child.md",`global results ignore Projects filters: ${query}`);
        assert.equal(await tab.ev(`document.activeElement.classList.contains("vg-hq-global-search")`),true,"global search focus survives rerender");
      }
      assert(await tab.ev(`!!document.querySelector(".vg-hq-search-hit")`), "recall results explain the content match");
      assert(await tab.waitFor(`document.querySelector(".vg-hq-note-hit") ? 1 : 0`,5000),"whole-vault note results are included");
      assert(await tab.ev(`document.querySelector(".vg-hq-note-hit").textContent.includes("Reference.md")`));
      await tab.ev(`document.querySelector(".vg-hq-note-hit [data-open]").click()`);
      assert(await tab.ev(`window.__calls.some(c=>c[0]==="open"&&c[1]==="Reference.md")`),"note results preserve their source-open action");
      await tab.ev(`window.vaultHQ.setScreen("needs")`);
      assert.equal(await tab.ev(`document.querySelector(".vg-hq-global-search").value`),"balnces","search remains visible across HQ screens");
      await tab.ev(`window.vaultHQ.setScreen("sweep")`);
      assert.equal(await tab.ev(`document.querySelector(".vg-hq-global-search").value`),"balnces","search remains visible in subviews");
      await tab.ev(`document.querySelector("[data-clear-global]").click()`);
      assert.equal(await tab.ev(`window.vaultHQ.screen()`),"sweep","clearing search returns to the current subview");
      await tab.ev(`window.vaultHQ.setScreen("projects")`);
      assert.deepEqual(await tab.ev(`[...document.querySelectorAll(".vg-hq-project-filters select")].map(s=>s.value)`),["Scope","project/server","other"],"global search preserves Projects filters");
      await tab.ev(`window.__selectProjectFilter("kind","all");window.__selectProjectFilter("system","all");window.__selectProjectFilter("status","all")`);
      await tab.ev(`document.querySelector(".vg-hq-proj").click()`);
      assert(await tab.ev(`document.querySelector(".vg-hq-drawer").textContent.includes("Parent: Parent.md")`));
      assert(await tab.ev(`document.querySelector(".vg-hq-drawer").textContent.includes("Source heading: Acceptance")`));
      const point = await tab.ev(`(() => {const r=document.querySelector(".vg-hq-chips [data-go=needs]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await tab.send("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1});
      await tab.send("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1});
      assert.equal(await tab.ev("window.vaultHQ.screen()"), "needs", "drawer must not block header navigation");
      assert(await tab.ev(`!!document.querySelector('[data-act="reviewed"]')`));
      assert(!await tab.ev(`!!document.querySelector('[data-key="review|Review.md"] [data-act="rows"]')`), "review-only item cannot apply rows");
      await tab.ev(`window.__calls = [];document.querySelector('[data-act="reviewed"]').click()`);
      await tab.waitFor(`window.__calls.length ? 1 : 0`, 5000);
      assert.deepEqual(await tab.ev("window.__calls"), [["status","Review.md","reviewed"]]);
      await tab.ev(`(() => {window.vaultHQ.setScreen("projects");window.__selectProjectFilter("status","other")})()`);
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
  console.log("ok - actionable Today, HQ-wide search/filter persistence, drawer navigation, safe review and duplicate triage");
})().catch(error => {console.error(error);process.exitCode=1;});
