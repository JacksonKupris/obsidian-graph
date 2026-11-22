# Persona testing

Made-up users work through the real graph page and report where they were blocked, confused or misled. It tests the views for people other than their builder.

## Run it
1. Build once: `node fixtures/make_sample.js --analyse`, then `node build.js page --data fixtures/sample-graph.json --out .out/sample-page.html`. For a real vault: `node build.js page --data <vault>/<rules.files.data> --rules <vault>/<rules file> --out .out/real-page.html` (local.json names the vault).
2. Each persona opens its own copy of the page in real Chrome (Playwright with `channel: "chrome"`, `file://` address), at its screen size. The standalone page has no Obsidian behind it: buttons that write to notes are stand-ins, so check that the button is there, says what it will do and gives feedback, not that a file changed.
3. Don't read `src/` to learn the page. If it can't be worked out from the screen, that is a finding. `window.vaultGraph._debug` (views, lenses, setView) may be used only to jump to a view, never to skip a step a person would take.
4. Change no files in the repo. Screenshots and notes go in `.out/persona/<name>/`. Read the screenshots you take.
5. Report in one shape: could I do it (done / with trouble / blocked) · findings, most serious first (tried, expected, happened, how bad, suggested fix, which view and size) · misleading numbers or hints (anything a person would believe that is wrong) · what worked well.

## What every persona checks
- Each stat, card, bar and node opens its detail on click; Back and Escape return to the exact previous screen.
- Each view has a legend, a one-line explanation and a hint with an action; nothing overlaps or is cut off.
- Interface text states facts, with no reassurance clauses.
- After a result or an empty state, there is a next step.

## Personas
`.claude/agents/persona-*.md`: first-timer, phone user, power user at scale, keyboard and screen-reader user, careful skeptic, new vault owner.

## Design personas
Four personas look at the work as designers rather than as users: `persona-design-hierarchy` (what the eye sees first, spacing, alignment, consistency), `persona-design-type-color` (type scale, contrast, colour meaning, both themes), `persona-design-motion-feel` (feedback, transitions, states, stacking) and `persona-design-first-impression` (does it look finished and its own). They measure with getComputedStyle and screenshots rather than opinion, so each finding can become a test (a contrast ratio, a size scale, a count of variants, an alignment tolerance). Run them with the user personas before a release that changes what people see.
