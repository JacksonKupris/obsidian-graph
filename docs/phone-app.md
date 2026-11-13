# Phone app

The graph page as an app on a phone: home-screen icon, full screen, and the last copy still opens with no network.

## One command
    node scripts/phone_app.js --vault <vault folder>     # leave out --vault to use the sample vault
It writes `.out/phone/`. Then serve that folder over https and open the address on the phone.

## By hand
1. Build: the command above. Needs only Node.
2. Serve the folder (personal devices only, tailnet only):
   - `python <vault>/_System/claude-rules/improve/phone_preview.py .out/phone --port 8765`
   - `tailscale serve --bg --https=443 http://127.0.0.1:8765`
3. On the phone, open the `https://<this PC>.<tailnet>.ts.net/` address, then the browser menu, "Install app" or "Add to Home screen".
4. Stop: `tailscale serve --https=443 off`, and stop the python server.

## When it fails
- "no graph data": open the vault in Obsidian once so the plugin writes its data, or build from the sample.
- No install option on the phone: the address is http, not https. Install needs https.
- Phone can't load the page: Tailscale signed out on the phone or PC asleep.
- "Serve is not enabled": turn on Serve and HTTPS for the tailnet in the Tailscale admin page.
- Old data after a rebuild: open the app once with a network; it keeps the copy it last loaded.

## Offline
The page and icons are kept on the phone. With no network it opens the last copy.

## Live updates (the server)
    node scripts/phone_server.js --vault <vault folder> [--port 8765] [--log <file>]
It serves the app and watches the vault. After a change (a note saved, the graph file rewritten) it reads the vault again and tells every open app, which takes the new data in place; it reloads only when notes were added or removed. A note caught half-written keeps the last good data. The app's errors and opens are written to `--log`. Use it instead of the build command and `phone_preview.py`; expose it with `tailscale serve --bg --https=443 http://127.0.0.1:8765`. Without the server (plain files) the app shows the data it was built with.
A phone that was locked or had the app in the background misses the announcement: when the app is opened, unlocked or comes back to the front it asks the server for the newest data and takes it the same way. Chrome pauses a page while the screen is off, so nothing reaches it until then.
