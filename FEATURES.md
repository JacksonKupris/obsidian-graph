# Features

What Vault Graph already does, and where. Read this before adding anything: extend the feature that owns a job instead of adding a second one. When two features do one job, merge them. Keep it to one line each.

## The jobs, and who owns each

| Job | Owner | Where |
|---|---|---|
| What to do next | Today list (`VGRules.todayList`), one next step (`hqNextStep`) | `src/rules.js`, `src/actions.js` |
| Change a note, with Undo | The plugin's write actions (`WRITE_ACTIONS`), run through `VGActions.run` | `src/plugin.js`, `src/actions.js` |
| Open tasks from earlier days | Sweep (by day, by heading, one at a time, Move) | `src/hq/60-sweep.js` |
| Going through a list one by one | `walkHtml` | `src/hq/30-work.js` |
| A game of the same tasks | Triage Run | `src/scenes/triage.js` |
| Are things getting better | Vitals, with a daily sample in shared state | `VGScience.vitals`, `src/hq/20-home.js` |
| The day's end | Wrap up; `VGRules.forStandup` decides what stays out | `src/hq/10-shared.js` |
| A week back | Weekly review | `src/hq/25-cockpit.js` |
| The tasks as a queue | Flow lens (Little's law) | `src/view/62-science.js` |
| How long tasks last | Task survival lens | `src/view/62-science.js` |
| Which old note to review | Knowledge debt lens (`VGScience.debtRanks`) | `src/view/62-science.js` |
| What to do with every old note | Stale triage lens | `src/view/60-lenses.js` |
| Which way notes lean, and notes with no way up | Hierarchy lens (`VGRules.wayUp`, `twoWayPairs`), and `adopt` on Today | `src/view/62-science.js`, `src/rules.js` |
| What counts as reliance | `VGRules.writtenLinks`, from `generated_link_sections` | `src/rules.js` |
| If a note is wrong | Blast radius lens | `src/view/62-science.js` |
| What holds the vault together | Single points of failure lens | `src/view/62-science.js` |
| Likely duplicate notes | Duplicates lens | `src/view/60-lenses.js` |
| Notes named but not linked, islands | Blind spots lens | `src/view/60-lenses.js` |
| Notes to write | Write these next lens, `write` on Today | `src/view/60-lenses.js` |
| What a map lists and misses | Map tree lens, `map` on Today | `src/view/60-lenses.js` |
| Where folders and topics disagree | Folders vs topics lens | `src/view/60-lenses.js` |
| Work on a project | HQ Projects (cards, board, drawer) | `src/hq/40-projects.js` |
| Who open work is about | HQ People | `src/hq/20-home.js` |
| Time spent | Focus sessions | `src/hq/35-session.js` |
| What got done when | Calendar | `src/hq/27-calendar.js` |
| Find anything | Search and the palette | `src/hq/50-search.js`, `src/hq/65-palette.js` |
| Say what a note knows | From your notes (rail), Peek | `src/hq/10-shared.js`, `src/hq/45-peek.js` |
| Long jobs without blocking | A worker from `VGScienceMake` | `src/science.js` |
| The notes as pictures | Scenes and map views | `src/scenes/`, `src/view/` |

## Known overlaps still to merge

- Project board lens and HQ Projects: the lens only reads Context notes.
- People lens and HQ People: the lens is a who-by-topic table, HQ is who's in open work.
- Important but stale lens, Stale triage lens and Knowledge debt lens rank old notes three ways.
