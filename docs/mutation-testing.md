# Mutation testing

Checks that the tests can fail. It breaks a source file one small way at a time (a `+` becomes `-`, an `if` never fires, a number moves by one) and runs the file's behaviour tests. A break no test notices is a **survivor**: a spot a test doesn't guard.

## Run it
    npm run mutate -- src/shared.js            all changes in that file
    npm run mutate -- src/rules.js --limit 60  an even spread of 60 (the same ones each run)
    npm run mutate -- src/engine.js --lines 100-180
    npm run mutate -- src/shared.js --tests test_shared   override which tests run
The report is `.out/mutation/<file>.md`: the score, which test caught how many, then each survivor with its line.

## By hand
Edit one spot in a copy of the repo, run the tests named for the file in `config/mutation.json` (`node tests/<name>.js`), and see whether any fails. The runner does exactly this in a temp folder, so your files are never touched.

## Reading a result
- **Before anything**, the tests must pass unchanged; otherwise the run stops (a score would mean nothing).
- A change that makes a test hang counts as caught.
- Survivor you can reach from a test: write the failing test first, then rerun.
- Survivor that is not a real change (an *equivalent* mutant, e.g. `"T12:00:00Z"` to `""` where UTC midnight gives the same date, or `!d` where an empty string takes the same path anyway): note it, no test.
- Survivor in code that only runs in a browser (the worker plumbing in `shared.js`): covered by the browser checks, not by node tests.
- `config/mutation.json` lists only behaviour tests. A test that reads source text (the guards in `test_shared.js`) would catch changes for the wrong reason; leave those out of the list for a file where it matters.
- Slow tests (`test_words`, 22 s) are left out; a run is about (changes x the listed tests' time) / 2.

## Works offline
Yes. Needs `npm ci` once (for `acorn`).
