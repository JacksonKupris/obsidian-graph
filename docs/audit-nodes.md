# Node-click audit runbook

Clicks real notes in every view in a real (headed) Chrome window and checks that each click selects the note, shows the same actions as the 2d view, offers a next note, and that Escape goes back. No agent is needed to run it.

## The one command
- Sample vault: `npm run audit:nodes`
- Your own vault: `npm run audit:nodes:vault` (uses `local.json` "vault", or pass `--vault <dir>` to `node tests/audit_nodes.js`)

Prerequisites: Node 20+, Chrome or Chromium installed, a desktop session (a window opens). `VG_HEADED=0` runs it without a window (CI, servers).

## What it writes (in `.out/`)
- `node-audit.md` / `node-audit-real.md`: the full report, one row per view.
- `*.json`: the scores, kept so the next run can compare.
- `*.diff.md`: exists only when a check got worse than the last run (a regression). `--gate` (on in the npm scripts) also exits 1 then.

Reading it: no `.diff.md` and exit 0 means nothing got worse; nothing else needs reading.

## By hand (no npm)
`node tests/audit_nodes.js --per 3 --gate` from the repository root. `--view slime` limits it to one view, `--mobile` uses a phone-sized window, `--per all` clicks every clickable note.

## Failures
- `FAIL - N checks got worse`: open the `.diff.md`; each line is `view check: before -> after`. Fix the shared cause (the inspector, `select`, the view stack), not the one view.
- `no Chrome`: install Chrome, or set `CHROME` to its path.
- Everything scores 0: the page failed to load; run `npm test` first.

## Offline
Works fully offline; nothing is downloaded.

## Scheduling (no tokens spent)
- Windows: `schtasks /Create /TN "VaultGraphNodeAudit" /SC DAILY /ST 12:30 /TR "cmd /c cd /d <repo> && npm run audit:nodes:vault"`
- Mac/Linux cron: `30 12 * * * cd <repo> && npm run audit:nodes:vault`
The task needs a logged-in desktop session to show the window. Check `.out/node-audit-real.diff.md` afterwards; start an agent session only if it exists.
