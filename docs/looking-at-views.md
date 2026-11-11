# Looking at the views in Obsidian

A view can pass its tests and still look wrong on a real vault: too small, cut off, edge-on, or with labels lying over each other. This runbook checks the views in the running Obsidian and saves a screenshot of each. Use it after any change to a view, the camera, the frame or the library pin.

## The one command

```
npm run look                          every library view
npm run look -- "Load paths" "Cas9"   only these (the names in the view picker)
npm run look -- --out some/folder     where the screenshots go (default ./look-shots)
```

It prints one line per view (`ok` or `FAIL`, labels placed, canvas width) and saves `<view-name>.png`. **Open the screenshots and read them.** `ok` means the view drew and every label was placed; it does not mean it looks right.

## Before you run it

1. Obsidian is running with this vault open, and its command line is on (Settings > General > Advanced).
2. The build you want to look at is installed: `node scripts/deploy.js --no-tests --plugin` (it stays until the next release replaces it).
3. The command is `obsidian` on the PATH. On Windows set `OBSIDIAN_CLI` to the `Obsidian.com` next to `Obsidian.exe` if it is not on the PATH (the script also tries `D:\Obsidian\Obsidian.com`).

No Python and nothing outside this repository is needed. Without Obsidian running, use the headless tests instead: `npm test` here, and `node tests/test_real_data.js` in the graphs library (every view with the vault's own data at desktop and phone size).

## What each failure means

| Line | Meaning | Next step |
|---|---|---|
| `Could not run the Obsidian command line` | the CLI is off or not found | turn it on, or set `OBSIDIAN_CLI` |
| `The Vault Graph view is not open` | no Vault Graph tab | run the command "Vault Graph: open" in Obsidian |
| `FAIL <view>: no view called that` | the name is not in the picker | use the exact name shown in the picker |
| `FAIL <view>` with `unplaced` above 0 | labels exist that were never positioned | the frame's `place()` did not run: check the console (Ctrl+Shift+I) |
| `FAIL <view>` with `canvas 0px` | the view did not mount | check the console; a first view right after a plugin reload can need one more run |

## Why it runs the frames itself

An Obsidian window driven from the command line counts as hidden, so the browser never fires animation frames and a view stays half drawn. The script runs frames on a timer and throws away the first screenshot (a hidden window hands back the paint before the latest). If you photograph the window some other way, expect the view before the one you asked for.

## Phone size

The script checks the desktop window. The phone is checked by the headless tests at 360 px wide; check it on the device after a release of anything that changes the layout.
