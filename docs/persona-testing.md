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
`.claude/agents/persona-*.md`: first-timer, phone user, power user at scale, keyboard and screen-reader user, careful skeptic, new vault owner, information architect (`persona-architect`: names, grouping, one way to do each thing), three sense-making personas that run on every view: the bewildered newcomer (`persona-bewildered`: what is this screen, why is this item here, what do I do), the person back after a week (`persona-returning`: is it worth my time, what first, does the count ever shrink) and the explainer (`persona-explainer`: can I say it plainly, where did it come from, can I check it) and vault administrator (`persona-admin`: bulk work, trusted numbers, undo, upgrades).

## Coverage
`node scripts/persona_plan.js` reads the page's own view list (scenes, lenses, views) and writes who looks at which view to `.out/persona-plan.md`. Every view goes to the phone and keyboard personas, plus others by kind, so a view added later is covered without editing a list. `tests/test_persona_plan.js` fails if a view has fewer than three personas or a named persona has no agent file. `tests/audit_views.js` runs the same list mechanically.

## Hunting (no AI, no cost)
`npm run hunt` runs random walks with fresh seeds over every view, then the sweeps that visit every view (tap sizes, persona assignment). It also runs weekly in CI (`.github/workflows/hunt.yml`), and `npm run queue` prints when it last ran and how it ended. A failure prints its seed: replay it with `node tests/test_monkey.js --seed N`, pin what it found as a plain failing test, then fix the shared cause. When a miss is found any other way (a persona, a person), ask which sweep should have caught it and add that sweep.

## Whole-plugin and release personas
`persona-integration` follows one note, number or action across every view, panel and sidebar and reports where the pieces disagree or lose state. `persona-release` installs, upgrades and rolls back from a GitHub release on a clean computer and ends with a ranked list of how the release path could improve. Run both before a release, with the user personas.

`persona-coherence` looks at a group of screens side by side (the HQ screens, or the graph views and their panels) and asks whether they feel like one app: seams in layout and controls, ideas that appear on several screens, split vocabulary, and what could be merged. It runs once per group, not once per view, so it is not in `persona_plan.js`'s per-view lists; run it on the HQ group and the graph group each round, and again after a merge it proposed.

## Design personas
Four personas look at the work as designers rather than as users: `persona-design-hierarchy` (what the eye sees first, spacing, alignment, consistency), `persona-design-type-color` (type scale, contrast, colour meaning, both themes), `persona-design-motion-feel` (feedback, transitions, states, stacking) and `persona-design-first-impression` (does it look finished and its own). They measure with getComputedStyle and screenshots rather than opinion, so each finding can become a test (a contrast ratio, a size scale, a count of variants, an alignment tolerance). Run them with the user personas before a release that changes what people see.
