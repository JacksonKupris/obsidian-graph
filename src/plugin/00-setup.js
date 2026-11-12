// plugin/*.js - Obsidian plugin shell for the Vault Graph, in parts the build joins in name order, the plugin class across several.
// Bundled with the rules, engine and view into main.js by `npm run build` (build.js); releases ship it (RELEASING.md).
// Edit here, never a generated main.js.
const { Plugin, ItemView, MarkdownView, Notice, PluginSettingTab, Setting, Platform, TFile, normalizePath, MarkdownRenderChild, parseYaml, moment, editorInfoField } = require("obsidian");

// One way to look up a note, read its frontmatter and read a JSON file. fileIn gives a note or null, whatever else is at the path.
const fileIn = (vault, p) => { const f = vault.getAbstractFileByPath(normalizePath(p)); return f instanceof TFile ? f : null; };
const fmIn = (cache, file) => (cache.getFileCache(file) || {}).frontmatter;
const VIEW_TYPE = "vault-graph";
const LOCAL_TYPE = "vault-graph-local";
const HQ_TYPE = "vault-graph-hq";   // Vault HQ: the vault's home screen (src/hq.js)
// every view that draws the one live state: each redraws when it changes (publish) and when the rules change
const STATE_VIEWS = () => [VIEW_TYPE, LOCAL_TYPE, HQ_TYPE];
const MARKER = "%% vault-graph:generated";   // regenerated notes keep everything above this line
const DEFAULTS = {
  dataPath: VGRules.files.data,               // written by the analysis
  dismissedPath: VGRules.files.dismissed,
  sharedPath: VGRules.files.shared,           // cosmos + saved views + review state, synced with the vault
  rulesPath: `${VGRules.folders.scripts}/vault_graph_rules.json`,   // this vault's rules (the analysis reads it too)
};
const BUILT_RULES = VGRules.RULES;   // the defaults this build carries; loadRules layers the vault's over them
// The rules the settings tab shows and edits: [path in the rules file, name, what it is]. Everything else stays in the file.
const RULE_FIELDS = [
  [["folders", "inbox"], "Inbox folder", "Where new notes and maps go"],
  [["folders", "daily"], "Daily notes folder", "Journals and standups (the top folder)"],
  [["folders", "people"], "People folder", "One note per person"],
  [["folders", "archive"], "Archive folder", "Where Archive moves a note (it keeps its folder inside)"],
  [["folders", "reports"], "Reports folder", "Self-tests and other reports"],
  [["stale_days"], "Days until stale", "A note not edited for this long asks whether it's still current"],
];
// Always live: links, tasks, tags, maps, new and deleted notes merge in at once (liveMerge); the slower parts
// (topics, gaps, influence) are re-analysed in the background after this many seconds without an edit (desktop).
// Not a setting any more: there is no "refresh" step for you to remember.
const ANALYSE_AFTER_IDLE = 30;
// and no more often than this. Each run rewrites about 1 MB that Sync keeps a version of, and Sync's limit counts those versions:
// a run after every pause in editing filled 1 GB. The time comes from the synced file, so every PC shares it.
const ANALYSE_EVERY_MS = 3 * 3600 * 1000;
// unless notes were added or removed since the last run: then this soon
const ANALYSE_NEW_NOTES_MS = 10 * 60 * 1000;

// Obsidian mobile's floating navigation bar sits over the bottom of the view: tell the renderer how much
// to lift its bottom controls (dock, toasts, sheets) so nothing hides behind it.
function watchMobileNavbar(view) {
  if (!Platform.isMobile) return;
  const update = () => {
    const nav = document.querySelector(".mobile-navbar"), r = nav && nav.getClientRects().length ? nav.getBoundingClientRect() : null;
    // never more than the bar is tall: pulling the pane down for Obsidian's actions moves it below the bar for a
    // moment, which measured as a huge overlap and left the dock stuck halfway up the screen
    const overlap = r ? Math.min(r.height, Math.max(0, view.contentEl.getBoundingClientRect().bottom - r.top)) : 0;
    // on the pane, not the graph's root: a remount (live refresh, re-render) makes a new root, which inherits it.
    // Set on the root, it was lost until the next resize and the bottom controls sat under Obsidian's bar.
    view.contentEl.style.setProperty("--vg-bottom", Math.round(overlap + (overlap ? 8 : 0)) + "px");
  };
  const ro = new ResizeObserver(update);
  ro.observe(view.contentEl);
  view.register(() => ro.disconnect());
  // measured again once a swipe settles (the pull-down gesture moves the pane without resizing it)
  const settle = () => { setTimeout(update, 50); setTimeout(update, 450); };
  ["touchend", "touchcancel"].forEach(ev => view.registerDomEvent(document, ev, settle, { passive: true }));
  setTimeout(update, 300); setTimeout(update, 1500);
}

// Right after Obsidian starts its link index is still being built. Merging then saw no links at all, so every
// note looked unlinked and was hidden (2D showed only people; replay found no dated notes). Merge once it's built.
function linksReady(app) {
  const mc = app.metadataCache;
  if (mc.initialized && !mc.inProgressTaskCount && Object.keys(mc.resolvedLinks || {}).length) return Promise.resolve();
  return new Promise(done => { const ref = mc.on("resolved", () => { mc.offref(ref); done(); }); setTimeout(done, 20000); });
}

// Bring an open graph up to date with the vault, keeping the camera and selection.
async function refreshLive(view, force) {
  if (!view.handle) return view.render();
  // Link changes (a link added here, in the sidebar or in a note) patch the open graph in place: layout, orbits,
  // selection and camera stay put, so every view updates as you work. Only notes arriving or leaving remount it.
  if (view.handle.applyLive) {
    const data = await view.plugin.graphData();
    if (data && view.handle && view.handle.applyLive(structuredClone(data))) { view.plugin.dirty = false; return; }
  }
  const busy = view.app.workspace.activeLeaf === view.leaf && Date.now() - (view.lastInput || 0) < 5000;
  if (busy && !force) { clearTimeout(view.liveRetry); view.liveRetry = setTimeout(() => refreshLive(view), 5000); return; }
  const vp = view.handle.viewport ? view.handle.viewport() : null;
  await view.render();
  if (vp && view.handle && view.handle.restoreViewport) view.handle.restoreViewport(vp);
}
function trackInput(view) {   // pointer, wheel and keys in the pane count as "using it"
  const mark = () => { view.lastInput = Date.now(); };
  ["pointerdown", "wheel", "keydown"].forEach(ev => view.registerDomEvent(view.contentEl, ev, mark, { passive: true }));
}

