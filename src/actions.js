// vault_graph_actions.js - the actions a note offers, defined once for every surface: the graph's inspector (a side
// panel, or a bottom sheet in narrow panes), the local pane and the suggestions sidebar. Each surface
// renders VGActions.forNote(...) with VGActions.render(...), so a button that exists in one place exists in all of
// them, with the same label, confirmation and result. The build puts this after vault_graph_rules.js.
//
// A surface passes a context `c`:
//   c.api          the plugin's viewActions (openNote, linkNotes, moveNote, setNoteTasks, stampReviewed, addToMap,
//                  addReference...). An action whose method is missing (the standalone page) isn't offered.
//   c.data         the live state (graphData) the note came from: maps, quality thresholds
//   c.ask(title, text, ok)        confirm; resolves true/false. Text is plain.
//   c.pick(placeholder, filter)   choose a note; resolves its path or null. filter(path) narrows the list.
//   c.done(message, undo)         the action worked: show it, log it (XP in the graph). undo, when given, is a function
//                                 the message offers as an Undo button (the plugin recorded what the action changed)
//   c.fail(message)               it didn't
//   c.focus(id)   optional: show the note in the graph      c.path(id)  optional: shortest path from it
//   c.copy(id)    optional: copy its [[link]]                 c.extra     optional: surface-only actions (same shape)
//   c.icon(el, name)              put icon `name` (see ICONS) at the start of button el
// Writes go through c.api, which is the plugin's WRITE_ACTIONS: each publishes the new state to every surface.
const VGActions = (() => {
  const nameOf = VGShared.nameOf;
  const folderOf = id => (String(id).includes("/") ? String(id).slice(0, String(id).lastIndexOf("/")) : "");
  // Archived notes keep their folder under the archive folder (vault_graph_rules.json folders), so links keep working
  const archive = () => VGRules.folders.archive;   // read when used: the vault's rules arrive after this loads
  const archiveFolder = id => (archive() + "/" + folderOf(id)).replace(/\/$/, "");
  const isArchived = id => id.startsWith(archive() + "/");
  const plural = VGShared.plural;
  const mapOf = (c, n) => (c.data && n.cluster != null ? VGRules.mapForCluster(c.data.mocs || [], n.cluster) : null);
  // where references live (Link Conventions): a note the graph treats as a map (a system's map, a MOC), or a hub or
  // index by name
  const isHolder = (p, c) => ((c && c.data && c.data.mocs) || []).some(m => m.id === p) || /(moc|hub|index)$/i.test(nameOf(p));

  // In display order. `when` decides if the note gets it; `ask` (optional) is the confirmation; `run` does it and
  // returns the message for c.done. group: "main" first, then "fix" (what the note needs), then "end" (closing it out).
  const ACTIONS = [
    { key: "open", group: "main", icon: "open", primary: true, label: () => "Open", title: () => "Open the note (Ctrl-click: new tab)",
      when: (n, c) => !!c.api.openNote && !n.ghost,
      run: (n, c, e) => { c.api.openNote(n.id, !!(e && (e.ctrlKey || e.metaKey))); } },
    { key: "focus", group: "main", icon: "target", label: () => "Focus", title: () => "Show it and its links in the graph",
      when: (n, c) => !!c.focus, run: (n, c) => { c.focus(n.id); } },
    { key: "path", group: "main", icon: "link", label: () => "Path to…", title: () => "Shortest chain of links to another note",
      when: (n, c) => !!c.path && !n.ghost, run: (n, c) => { c.path(n.id); } },
    { key: "link", group: "main", icon: "link", label: () => "Link to…", title: n => `Add a link between ${n.name} and another note`,
      when: (n, c) => !!c.api.linkNotes && !!c.pick && !n.ghost,
      run: async (n, c) => {
        const to = await c.pick(`Link ${n.name} to…`, p => p !== n.id);
        if (!to) return null;
        await c.api.linkNotes(n.id, to, "linked by hand");
        return `Linked ${n.name} ↔ ${nameOf(to)}`;
      } },
    { key: "map", group: "fix", icon: "plus", label: () => "Add to map", title: (n, c) => `List it in ${mapOf(c, n).title}, its topic's map`,
      when: (n, c) => { const m = mapOf(c, n); return !!c.api.addToMap && !!m && !n.moc && !n.person && !n.ghost && !VGRules.onMap(m, n.id); },
      run: async (n, c) => { const m = mapOf(c, n); await c.api.addToMap(m.id, [n.id]); return `Added ${n.name} to ${m.title}`; } },
    { key: "current", group: "fix", icon: "reviewed", label: () => "Still current", title: n => `Its text hasn't changed in ${n.age} days. Stamps reviewed: today, so it stops counting as stale`,
      when: (n, c) => !!c.api.stampReviewed && VGRules.isStale(n, ((c.data || {}).quality || {}).stale_days),
      ask: n => ["Still current?", `${n.name}'s text hasn't changed in ${n.age} days. Mark it reviewed today? This stamps reviewed: in its frontmatter; nothing else changes.`, "Still current"],
      run: async (n, c) => { await c.api.stampReviewed(n.id); return `Reviewed ${n.name}`; } },
    { key: "mentions", group: "fix", icon: "link", label: () => "Link mentions", title: () => "Turn the first plain mention in each daily note into a link",
      when: (n, c) => !!c.api.linkMentions && ((c.data || {}).said_unlinked || []).some(([id]) => id === n.id),
      run: async (n, c) => {
        const files = await c.api.linkMentions(n.id, true);
        if (!files.length) return "No plain mentions left to link";
        if (!await c.ask("Link the mentions", `Turn the first plain mention of ${n.name} into a link in ${plural(files.length, "daily note")}?`, "Link them")) return null;
        const done = await c.api.linkMentions(n.id, false);
        return `Linked ${n.name} in ${plural(done.length, "daily note")}`;
      } },
    { key: "reference", group: "fix", icon: "file", label: () => "Add reference", title: () => "Point it at the map or hub that holds its links",
      when: (n, c) => n.refs === false && !!c.api.addReference && !!c.pick && !n.ghost,
      run: async (n, c) => {
        const holder = await c.pick("Reference holder (a map, hub or index)…", p => isHolder(p, c));
        if (!holder) return null;
        await c.api.addReference(n.id, holder);
        return `Added ${nameOf(holder)} as a reference of ${n.name}`;
      } },
    { key: "complete", group: "end", icon: "tasks", label: n => `Complete ${plural(n.tasks, "task")}`, title: () => "Check off every open task and mark the note done",
      when: (n, c) => n.tasks > 0 && !!c.api.setNoteTasks,
      ask: n => ["Complete every task", `Complete all ${plural(n.tasks, "open task")} in ${n.name} and mark the note done?`, "Complete"],
      run: async (n, c) => { const k = await c.api.setNoteTasks(n.id, "x"); return k ? `Completed ${plural(k, "task")} in ${n.name}` : `No open tasks found in ${n.name}`; } },
    { key: "cancel", group: "end", icon: "close", label: () => "Cancel tasks", title: () => "Cancel every open task and mark the note cancelled",
      when: (n, c) => n.tasks > 0 && !!c.api.setNoteTasks,
      ask: n => ["Cancel every task", `Cancel all ${plural(n.tasks, "open task")} in ${n.name} and mark the note cancelled?`, "Cancel tasks"],
      run: async (n, c) => { const k = await c.api.setNoteTasks(n.id, "-"); return k ? `Cancelled ${plural(k, "task")} in ${n.name}` : `No open tasks found in ${n.name}`; } },
    { key: "archive", group: "end", icon: "folder", label: () => "Archive", title: n => `Move to ${archiveFolder(n.id)}/ (links keep working)`,
      when: (n, c) => !!c.api.moveNote && !n.ghost && !n.person && !isArchived(n.id),
      ask: n => ["Archive note", `Move ${n.id} to ${archiveFolder(n.id)}/? Links keep working; it leaves the topic graph. Nothing is deleted.`, "Archive"],
      run: async (n, c) => { await c.api.moveNote(n.id, archiveFolder(n.id)); return `Archived ${n.name}`; } },
    { key: "copy", group: "end", icon: "copy", label: () => "", title: () => "Copy [[link]]",
      when: (n, c) => !!c.copy, run: (n, c) => { c.copy(n.id); } },
  ];
  const BY_KEY = Object.fromEntries(ACTIONS.map(a => [a.key, a]));

  // minor: true marks a problem that is only a gap to fill (no references, a short note). The note is not flagged across the
  // views for it alone: attention() leaves those out, the inspector still lists them.
  // What a note needs, each paired with the action that fixes it, so a surface shows the problem and its fix together
  // (the inspector's "Needs attention"). test(n, c): the problem is there, whatever this surface can do about it;
  // text(n, c): the problem as a fact; fix: an ACTIONS key, offered when that action can run here.
  const PROBLEMS = [
    { key: "unmapped", ring: "#38bdf8", label: "not on its map", fix: "map", test: (n, c) => { const m = mapOf(c, n); return !!m && !VGRules.onMap(m, n.id); },
      text: (n, c) => `Not listed in ${mapOf(c, n).title}, its topic's map` },
    { key: "stale", ring: "#eab308", label: "stale", fix: "current", test: (n, c) => VGRules.isStale(n, ((c.data || {}).quality || {}).stale_days), text: n => `Unchanged for ${n.age} days` },
    { key: "unlinked-mentions", ring: "#a78bfa", label: "named, not linked", fix: "mentions", test: (n, c) => ((c.data || {}).said_unlinked || []).some(([id]) => id === n.id),
      text: (n, c) => { const hit = ((c.data || {}).said_unlinked || []).find(([id]) => id === n.id); return `Named in ${plural(hit[1], "daily note")}, never linked`; } },
    { key: "orphan", ring: "#e879f9", label: "nothing links here", fix: "link", test: n => n.inlinks === 0, text: () => "Nothing links here" },
    { key: "deadend", ring: "#fb923c", label: "links nowhere", fix: "link", test: n => n.outlinks === 0, text: () => "Links to no other note" },
    { key: "refs", ring: "#94a3b8", label: "no references", minor: true, fix: "reference", test: n => n.refs === false, text: () => "No references" },
    { key: "broken", ring: "#ef4444", label: "broken link", fix: "open", test: n => n.broken > 0, text: n => plural(n.broken, "broken link") },
    { key: "stub", ring: "#94a3b8", label: "short note", minor: true, fix: "open", test: (n, c) => n.words != null && n.words < (((c.data || {}).quality || {}).stub_words || 0), text: n => `${plural(n.words, "word")} so far` },
  ];
  // Each problem has one look in every view: its ring colour and its legend label. A note with two problems gets a ring split in two colours.
  const reasonLook = key => { const p = PROBLEMS.find(x => x.key === key); return p ? { color: p.ring, label: p.label } : { color: "#94a3b8", label: key }; };
  // [{ key, text, fix: action | null }] for a note, in PROBLEMS order (maps, people and unwritten notes have none)
  function problems(n, c) {
    if (!n || n.ghost || n.person || n.moc) return [];
    return PROBLEMS.filter(p => p.test(n, c)).map(p => ({ key: p.key, minor: !!p.minor, text: p.text(n, c), fix: BY_KEY[p.fix].when(n, c) ? BY_KEY[p.fix] : null }));
  }

  // The problems that make a note stand out in every view: all but the minor ones.
  const attention = (n, c) => problems(n, c).filter(p => !p.minor);

  // The actions this note offers on this surface: the shared ones, then the surface's own (c.extra), in group order.
  // o.skip: groups to leave out (the inspector shows the "fix" ones beside their problems instead)
  function forNote(n, c, only, o) {
    if (!n) return [];
    const skip = (o && o.skip) || [];
    const list = ACTIONS.filter(a => (!only || only.includes(a.key)) && !skip.includes(a.group) && a.when(n, c));
    const extra = (c.extra || []).filter(a => (!only || only.includes(a.key)) && !skip.includes(a.group || "main") && (!a.when || a.when(n, c)));
    const order = { main: 0, fix: 1, end: 2 };
    return [...list, ...extra].sort((a, b) => (order[a.group || "main"] - order[b.group || "main"]));
  }

  // Run one action: confirm if it asks, then do it and report. Resolves true when it ran. When the plugin recorded
  // a change for it (api.lastUndo moved on), the report carries an Undo for exactly that change.
  async function run(a, n, c, e, again) {
    if (typeof a === "string") a = BY_KEY[a];
    if (!a) return false;
    if (a.ask && !again) { const [t, text, ok] = a.ask(n, c); if (!await c.ask(t, text, ok)) return false; }
    const mark = c.api.lastUndo ? c.api.lastUndo() : 0;
    try {
      const msg = await a.run(n, c, e);
      // the Undo puts back what the plugin recorded for it, and runs the action's own undo (a mark in the shared file)
      if (msg) { const id = c.api.lastUndo ? c.api.lastUndo() : 0, rec = id && id !== mark && c.api.undo ? id : 0; if (rec && c.api.labelUndo) c.api.labelUndo(rec, msg);
        const at = n && (n.key || n.path || n.id || (n.ids || [])[0]) ? { key: n.key || "", path: n.path || n.id || (n.ids || [])[0] || "" } : null;
        const entry = rec || a.undo ? { msg, at, undo: () => undo(rec, msg, c, a.undo && (() => a.undo(n, c))), redo: () => run(a, n, c, e, true) } : null;
        if (entry) history.record(entry, !!again);
        c.done(msg, entry ? () => history.undoEntry(entry) : null); }
      return msg !== null;
    }
    catch (err) { c.fail(`${a.label(n, c) || a.title(n, c)} didn't work: ${(err && err.message) || err}`); return false; }
  }
  // One Today item (VGRules.todayList) done: the same confirmation, write and report from the graph view, its game
  // panel and the sidebar. Messages start with the verb the graph's XP counts (Linked, Added, Reviewed...).
  const TODAY = {
    link: { label: "Link", when: c => !!c.api.linkNotes,
      ask: it => ["Link these notes", `Link ${it.names[0]} ↔ ${it.names[1]}? The link goes in ${nameOf(it.from)}'s Related section (the staler note).`, "Link"],
      run: async (it, c) => { await c.api.linkNotes(it.from, it.to, it.why || "suggested by Vault Graph"); return `Linked ${it.names[0]} ↔ ${it.names[1]}`; } },
    map: { label: "Add to map", when: c => !!c.api.addToMap,
      run: async (it, c) => (await c.api.addToMap(it.m, [it.id])) === false ? `Already in ${it.mapTitle}` : `Added ${it.name} to ${it.mapTitle}` },
    write: { label: "Create note", when: c => !!c.api.writeNote,
      ask: it => ["Create note", `Create “${it.name}” in ${VGRules.folders.inbox}? ${plural(it.refs.length, "note")} already link to it.`, "Create"],
      run: async (it, c) => { const path = `${VGRules.folders.inbox}/${VGRules.safeName(it.name)}.md`;
        await c.api.writeNote(path, `---\ncreated: ${VGRules.today()}\n---\n# ${it.name}\n\n${VGRules.createdFromLine(it.refs.slice(0, 5).map(nameOf))}\n\n`, { mode: "create", open: true });
        return `Added ${it.name} to ${VGRules.folders.inbox}`; } },
    hub: { label: "Still current", when: c => !!c.api.stampReviewed,
      ask: it => ["Still current?", `Mark ${it.name} reviewed today? This stamps reviewed: in its frontmatter; nothing else changes.`, "Still current"],
      run: async (it, c) => { await c.api.stampReviewed(it.id); return `Reviewed ${it.name}`; } },
    chart: { label: "Create map", when: c => !!c.api.createMap,
      ask: it => ["Give the topic a map", `Create a map for ${it.name} in ${VGRules.folders.inbox}, listing its notes best connected first?`, "Create map"],
      run: async (it, c) => { await c.api.createMap(it.c); return `Map note for ${it.name}`; } },
    rename: { label: "Rename", when: c => !!c.api.renameMap,
      ask: it => ["Rename the map", `Rename ${it.from} Hub to ${it.name} Hub? Links to it follow; its list of notes is made again.`, "Rename"],
      run: async (it, c) => { await c.api.renameMap(it.m, it.c); return `Renamed ${it.from} Hub to ${it.name} Hub`; } },
    adopt: { label: "Link to…", when: c => !!c.api.linkNotes && !!c.pick,
      run: async (it, c, e) => { if (it.up && c.api.setParents) { await c.api.setParents([{ path: it.id, hub: it.up }]); return `Linked ${it.name} up to ${it.up}`; } return BY_KEY.link.run({ id: it.id, name: it.name }, c, e); } },
    // HQ items (VGRules.hqItems): work from the vault's own notes
    task: { label: "Done", when: c => !!c.api.setTaskStatus, run: (it, c) => doneWork(it, c) },
    carried: { label: "Done", when: c => !!c.api.setTaskStatus, run: (it, c) => doneWork(it, c) },
    backlog: { label: "Done", when: c => !!c.api.setTaskStatus, run: (it, c) => doneTask(it, c) },
    // a plan item has no checkbox: Done marks it in the shared file and adds it to today's standup
    plan: { label: "Done", when: c => !!c.api.hqMark, undo: (it, c) => c.api.hqMark(it.key, null),
      run: async (it, c) => { await c.api.hqMark(it.key, "done"); const logged = c.api.logWork ? await c.api.logWork(it.text) : false;
        return `Done: ${short(it.title)}${logged ? ", added to today's standup" : ""}`; } },
    inbox: { label: "Open", when: c => !!c.api.openNote, run: (it, c) => { c.api.openNote(it.path); return null; } },
    approval: { label: "Open", when: c => !!c.api.openNote, run: (it, c) => { c.api.openNote(it.path); return null; } },
    report: { label: "Open source report", when: c => !!c.api.openNote, run: (it, c) => { c.api.openNote(it.path); return null; } },
    job: { label: "Open", when: c => !!c.api.openNote, run: (it, c) => { c.api.openNote(it.path); return null; } },   // the automations note
    review: { label: "Accept", when: c => !!c.api.setNoteStatus,
      ask: it => ["Accept the draft", `Accept “${it.title}”? This sets its status to accepted. Applying what it describes stays with you.`, "Accept"],
      run: async (it, c) => { await c.api.setNoteStatus(it.path, "accepted"); return `Accepted ${it.title}`; } },
  };
  const short = t => (String(t).length > 60 ? String(t).slice(0, 59) + "…" : String(t));
  async function doneTask(it, c) { await c.api.setTaskStatus(it.path, it.line, it.text, "x"); return `Done: ${short(it.title)}`; }
  // work done today: checked off in its journal and added to today's standup (one write, one Undo)
  async function doneWork(it, c) {
    if (!c.api.completeTask) return doneTask(it, c);
    const logged = await c.api.completeTask(it.path, it.line, it.text);
    return `Done: ${short(it.title)}${logged ? ", added to today's standup" : ""}`;
  }
  const todayWhen = (it, c) => it.reviewOnly ? !!c.api.openNote : !!TODAY[it.kind] && TODAY[it.kind].when(c);
  const todayLabel = it => it.reviewOnly ? "Open for review" : it.kind === "adopt" && it.up ? "Add parent" : (TODAY[it.kind] || {}).label || "";
  function runToday(it, c, e) {
    if (it.reviewOnly) { c.api.openNote(it.path); return Promise.resolve(false); }
    const t = TODAY[it.kind]; if (!t || !t.when(c)) return Promise.resolve(false);
    return run({ label: () => t.label, title: () => it.title, ask: t.ask && (() => t.ask(it)), run: (_, cc, ee) => t.run(it, cc, ee), undo: t.undo }, it, c, e);
  }
  // The other things an HQ item offers besides its main action, the same on every surface: Later (gone for today),
  // Reject a draft (with the reason), Delegate a task to an agent, Open its note. Each is one write through c.api.
  const TODAY_MORE = [
    { key: "reviewed", label: "Mark reviewed", title: "Record the review only; do not apply recommendations",
      when: (it, c) => !!it.reviewOnly && !!c.api.setNoteStatus,
      ask: it => ["Mark report reviewed", `Mark “${it.title}” reviewed? This does not apply its recommendations or complete source tasks.`, "Mark reviewed"],
      run: async (it, c) => { await c.api.setNoteStatus(it.path, "reviewed"); return `Reviewed: ${short(it.title)}`; } },
    { key: "rows", label: "Review rows", title: "Tick or skip each row here", when: (it, c) => it.kind === "report" && !!c.showRows,
      run: (it, c) => { c.showRows(it.path); return null; } },
    { key: "file", label: "File", title: "Move it to its folder", when: (it, c) => it.kind === "inbox" && !!c.api.moveNote && !!c.chooseFolder,
      run: async (it, c) => { const to = await c.chooseFolder(it); if (!to) return null; await c.api.moveNote(it.path, to); return `Filed in ${to}`; } },
    { key: "later", label: "Later", title: "Not today: it comes back tomorrow", when: (it, c) => !!VGRules.TODAY_GROUP[it.kind] && !!c.api.hqMark,
      run: async (it, c) => { await c.api.hqMark(it.key, "later"); return `Later: ${short(it.title)}`; },
      undo: (it, c) => c.api.hqMark(it.key, null) },
    { key: "nextweek", label: "Next week", title: "Not this week: it comes back next Monday", quiet: true, when: (it, c) => !!VGRules.TODAY_GROUP[it.kind] && it.group === "today" && !!c.api.hqMark,
      run: async (it, c) => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); await c.api.hqMark(it.key, `until:${VGRules.localDay(d)}`); return `Next week: ${short(it.title)}`; },
      undo: (it, c) => c.api.hqMark(it.key, null) },
    { key: "snooze", label: "Pick a day", title: "Bring it back on a day you name", quiet: true, when: (it, c) => !!VGRules.TODAY_GROUP[it.kind] && it.group === "today" && !!c.api.hqMark && !!c.input,
      run: async (it, c) => {
        const said = await c.input("Bring it back on…", `When should “${it.title}” come back?`, "friday, dec 3, 2 weeks", "Snooze");
        if (!said || !said.trim()) return null;
        const to = VGRules.parseDay(said);
        if (!to) throw new Error(`“${said.trim()}” isn't a day after today`);
        await c.api.hqMark(it.key, `until:${to}`);
        return `Back ${VGShared.noon(to).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${short(it.title)}`; },
      undo: (it, c) => c.api.hqMark(it.key, null) },
    { key: "reject", label: "Reject", title: "Reject the draft, with the reason", when: (it, c) => it.kind === "review" && !it.reviewOnly && !!c.api.setNoteStatus,
      run: async (it, c) => {
        const why = c.input ? await c.input("Reject the draft", `Why reject “${it.title}”? The reason goes in the draft.`, "Reason") : (await c.ask("Reject the draft", `Reject “${it.title}”?`, "Reject")) ? "" : null;
        if (why === null) return null;
        await c.api.setNoteStatus(it.path, "rejected", why); return `Rejected ${it.title}`; } },
    { key: "delegate", label: "Delegate", title: () => `Hand it to ${VGRules.HQ.delegate_to}: a draft comes back for review`,
      when: (it, c) => (it.kind === "task" || it.kind === "carried") && !it.delegated && !!c.api.setTaskField && !!VGRules.HQ.delegate_field,
      ask: it => ["Delegate the task", `Mark “${it.title}” for ${VGRules.HQ.delegate_to}? Its draft comes back for review; nothing is applied until you accept it.`, "Delegate"],
      run: async (it, c) => { await c.api.setTaskField(it.path, it.line, it.text, VGRules.HQ.delegate_field, VGRules.HQ.delegate_to); return `Delegated: ${short(it.title)}`; } },
    { key: "open", label: "Open", title: "Open the note it's in", when: (it, c) => !!it.path && !!c.api.openNote && !["approval", "report", "job"].includes(it.kind),
      run: (it, c) => { c.api.openNote(it.path); return null; } },
  ];
  const todayMore = (it, c) => TODAY_MORE.filter(m => m.when(it, c));
  // Several tasks at once (the carried-over sweep): done or cancelled in their own notes, one Undo for all. Done here
  // is not today's work (it was finished some time ago), so nothing goes in the standup.
  function runBatch(items, status, c, from) {
    const rows = items.flatMap(VGRules.taskRowsOf);
    return run({ label: () => (status === "x" ? "Done" : "Cancel"), title: () => from || "",
      run: async () => { const n = await c.api.setTasksStatus(rows, status); return `${status === "x" ? "Done" : "Cancelled"}: ${plural(n, "task")}${from ? ` from ${from}` : ""}`; } }, null, c);
  }
  // Tasks into a project's note, with their subtasks: added there and cancelled where they were, as one action with one Undo
  function runMove(items, to, title, c) {
    return run({ label: () => "Move", title: () => `to ${title}`,
      run: async () => { const n = await c.api.moveTasks(items, to); return `Moved ${plural(n, "task")} to ${title}`; } }, null, c);
  }
  // One report row (VGRules.reportRows) ticked to apply ("x") or skipped ("-") in the report itself; the gardener applies
  // the ticked rows and remembers the skipped ones
  function runRow(row, mark, c) {
    const words = short(VGRules.plainRow(row.text));
    return run({ label: () => (mark === "x" ? "Tick" : "Skip"), title: () => words,
      run: async () => { await c.api.setTaskStatus(row.path, row.line, row.text, mark); return `${mark === "x" ? "Ticked" : "Skipped"}: ${words}`; } }, row, c);
  }
  // Run one of them: the same confirm, report and Undo as every action. Later has no note change to undo, so its Undo
  // takes the mark back.
  function runMore(m, it, c, e) {
    if (typeof m === "string") m = TODAY_MORE.find(x => x.key === m);
    if (!m) return Promise.resolve(false);
    const title = typeof m.title === "function" ? m.title(it) : m.title;
    return run({ label: () => m.label, title: () => title, ask: m.ask && (() => m.ask(it)), run: (_, cc, ee) => m.run(it, cc, ee), undo: m.undo }, it, c, e);
  }
  async function undo(id, msg, c, also) {
    try { if (id) await c.api.undo(id); if (also) await also(); c.done(`Undone: ${msg}`); return true; }
    catch (err) { c.fail(`Couldn't undo: ${(err && err.message) || err}`); return false; }
  }
  // The one history every surface reads: each decision that changed something is recorded with how to reverse it and
  // how to do it again. The Undo on a report, and the Previous, Undo and Redo buttons, all go through here, so they
  // agree. A new decision clears Redo (the usual rule). Session-long, newest last, capped.
  // Previous changes nothing: it steps back through the decisions, newest first, and hands the surface what each was
  // made on ({ key, path, msg }) to show again. Any new decision, Undo or Redo starts it from the newest again.
  const history = (() => {
    const past = [], future = [], subs = new Set(), CAP = 50; let back = 0;
    const seen = () => past.filter(x => x.at), target = () => { const s = seen(); return s.length ? s[s.length - 1 - (back % s.length)] : null; };
    const fire = () => subs.forEach(f => { try { f(); } catch (e) { /* a surface that is gone */ } });
    const state = () => { const t = target(); return { past: past.map(x => x.msg), future: future.map(x => x.msg), canUndo: past.length > 0, canRedo: future.length > 0, canPrevious: !!t, previous: t ? t.msg : "" }; };
    function previous() { const t = target(); if (!t) return null; back++; fire(); return { ...t.at, msg: t.msg }; }
    // the one wiring for the three buttons (VGParts.historyButtons): `el` is the pressed button, `show` opens what Previous hands back
    function press(el, show) {
      if (!el || el.disabled) return false;
      if (el.hasAttribute("data-hundo")) undoLast(); else if (el.hasAttribute("data-hredo")) redoLast();
      else if (el.hasAttribute("data-hprev")) { const at = previous(); if (at && show) show(at); } else return false;
      return true;
    }
    function record(entry, keepFuture) { back = 0; past.push(entry); if (!keepFuture) future.length = 0; if (past.length > CAP) past.shift(); fire(); }
    async function undoEntry(entry) {
      const i = past.indexOf(entry); if (i < 0) return false;
      const ok = await entry.undo(); if (!ok) return false;
      const j = past.indexOf(entry); if (j >= 0) past.splice(j, 1); future.push(entry); back = 0; fire(); return true;
    }
    const undoLast = async () => (past.length ? undoEntry(past[past.length - 1]) : false);
    async function redoLast() {
      const entry = future[future.length - 1]; if (!entry) return false;
      future.pop(); const ok = await entry.redo();
      if (!ok) { future.push(entry); fire(); } return ok;
    }
    const reset = () => { past.length = 0; future.length = 0; back = 0; fire(); };
    return { state, record, undoEntry, undoLast, redoLast, previous, press, reset, subscribe: f => { subs.add(f); return () => subs.delete(f); } };
  })();

  // Buttons for `list` into `box` (plain DOM: works in Obsidian and on the standalone page).
  // cls: { btn, primary, ghost } class names for this surface's buttons; fullLabels: no icon-only buttons (menus).
  function render(box, list, n, c, cls) {
    list.forEach(a => {
      const b = document.createElement("button"), label = a.label(n, c) || (cls.fullLabels && a.title ? a.title(n, c) : "");   // menus spell out icon-only buttons
      b.className = [cls.btn, a.primary ? cls.primary : "", a.group === "end" && a.key !== "copy" ? cls.ghost || "" : ""].filter(Boolean).join(" ");
      b.dataset.act = a.key;
      b.title = a.title ? a.title(n, c) : label;
      if (!label) b.setAttribute("aria-label", b.title);
      if (c.icon && a.icon) c.icon(b, a.icon);
      if (label) b.appendChild(document.createTextNode(label));
      b.onclick = async e => {
        e.stopPropagation();
        b.disabled = true;
        try { await run(a, n, c, e); } finally { if (b.isConnected) b.disabled = false; }
      };
      box.appendChild(b);
    });
    return box;
  }

  return { history, ACTIONS, PROBLEMS, reasonLook, forNote, problems, attention, run, render, archiveFolder, isArchived, nameOf, TODAY, todayWhen, todayLabel, runToday, TODAY_MORE, todayMore, runMore, runBatch, runMove, runRow };
})();
