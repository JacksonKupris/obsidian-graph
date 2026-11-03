# Features

What Vault Graph already does, and where. "Lens" and "scene" below are code words: a person sees one kind of thing, a view (see ARCHITECTURE.md). Read this before adding anything: extend the feature that owns a job instead of adding a second one. When two features do one job, merge them. Keep it to one line each.

## The jobs, and who owns each

| Job | Owner | Where |
|---|---|---|
| What to do next | Today list (`VGRules.todayList`), one next step (`hqNextStep`) | `src/rules.js`, `src/actions.js` |
| Whether a plan item is already done | `planDoneWords`, `hqPlanDone` (by the words, across standups) | `src/rules.js` |
| A todo's done date, however it's ticked | `VGRules.taskLine`, `taskEdit`; the editor's ticks through `registerDoneDates` | `src/rules.js`, `src/plugin.js` |
| Change a note, with Undo | The plugin's write actions (`WRITE_ACTIONS`), run through `VGActions.run` | `src/plugin.js`, `src/actions.js` |
| Open tasks from earlier days | Sweep (by day, by heading, one at a time, Move) | `src/hq/60-sweep.js` |
| Going through a list one by one | `walkHtml` | `src/hq/30-work.js` |
| A game of the same tasks | Triage Run | `src/scenes/triage.js` |
| Are things getting better | Vitals, with a daily sample in shared state | `VGScience.vitals`, `src/hq/20-home.js` |
| The day's end | Wrap up; `VGRules.forStandup` decides what stays out | `src/hq/10-shared.js` |
| A week back | Weekly review | `src/hq/25-cockpit.js` |
| The tasks as a queue, what's unusually old, and where the pile is | Flow lens (Little's law, aging WIP, location quotient) | `src/view/62-science.js` |
| Is this week really different | Control chart lens (Shewhart XmR) | `src/view/62-science.js` |
| Focused or spread | Attention lens (Hill numbers) | `src/view/62-science.js` |
| Notes out of step with what you run | Version drift lens (the rules file's `drift`); `ref_lint.py` owns URL rules in the vault | `src/plugin.js`, `src/view/62-science.js` |
| How long tasks last | Task survival lens | `src/view/62-science.js` |
| Old notes: which first, what to do with each | Stale notes lens (`VGScience.debtRanks`); Vitals and Weekly review read the same list | `src/view/60-lenses.js`, `src/view/62-science.js` |
| Which way notes lean, and notes with no way up | Hierarchy lens (`VGRules.wayUp`, `twoWayPairs`), and `adopt` on Today | `src/view/62-science.js`, `src/rules.js` |
| What counts as reliance | `VGRules.writtenLinks`, from `generated_link_sections` | `src/rules.js` |
| If a note is wrong | Blast radius lens | `src/view/62-science.js` |
| What holds the vault together | Single points of failure lens, with the k-core | `src/view/62-science.js` |
| Likely duplicate notes | Duplicates lens | `src/view/60-lenses.js` |
| Notes named but not linked, islands | Blind spots lens | `src/view/60-lenses.js` |
| Notes to write, and how many are unnamed (Chao1) | Write these next lens, `write` on Today | `src/view/60-lenses.js` |
| What a map lists and misses | Map tree lens, `map` on Today | `src/view/60-lenses.js` |
| Where folders and topics disagree | Folders vs topics lens | `src/view/60-lenses.js` |
| Work on a project | HQ Projects (cards, board, drawer) | `src/hq/40-projects.js` |
| Who open work is about | HQ People | `src/hq/20-home.js` |
| Time spent | Focus sessions | `src/hq/35-session.js` |
| What got done when | Calendar | `src/hq/27-calendar.js` |
| Find anything | Search and the palette | `src/hq/50-search.js`, `src/hq/65-palette.js` |
| Say what a note knows | From your notes (rail), Peek | `src/hq/10-shared.js`, `src/hq/45-peek.js` |
| What changed in an update | `VGRules.NEWS`, shown on Home until Got it | `src/rules.js`, `src/hq/20-home.js` |
| Undo after the message has gone | Recent changes | `src/hq/60-sweep.js`, `src/plugin.js` |
| Sync's limit | `syncStorage`, on Automations and in Vitals | `src/plugin.js`, `src/hq/20-home.js` |
| Long jobs without blocking | A worker from `VGScienceMake` | `src/science.js` |
| The notes as pictures | Scenes and map views | `src/scenes/`, `src/view/` |

## Known overlaps

None known. Context notes (lens) and People by topic (lens) keep their own jobs: Context notes aren't HQ's projects, and who works on which topic isn't who's in open work.
