# Claude Usage Tracker

A Chrome extension that tracks your Claude.ai usage-limit session and shows a live
countdown until it resets, using Anthropic's own server-computed numbers — no guessing.

## How it works

- A content script running in the page (`content/interceptor.js`) watches `fetch` calls
  Claude.ai makes to its chat-completion endpoint and reads the `message_limit` SSE
  event that comes back with every response. Claude.ai's internal API doesn't expose
  raw token counts (that's only in the public Messages API used by API/Console users),
  but it does send the exact 5-hour session utilization, the 7-day weekly utilization,
  and their precise reset timestamps.
- Another content script (`content/bridge.js`) relays that event to the background
  service worker.
- The background worker (`background.js`) persists running totals (message count, %
  used, reset times) and keeps the toolbar badge countdown current.
- The popup only shows the usage panel when the active tab is on claude.ai; otherwise
  it shows a short "open claude.ai" message. Tracking itself keeps running in the
  background regardless of which tab you're looking at, as long as claude.ai tabs are
  making requests.
- All of this happens locally in your browser via `chrome.storage.local` — no data is
  sent anywhere except to Claude.ai itself (which it already would be).

## Install (unpacked, for personal use)

1. Download/unzip this folder, or `git clone` the repo.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Open or refresh [claude.ai](https://claude.ai) and send a message — the toolbar
   badge and popup will start tracking.

## Using it

- Click the extension icon while on claude.ai to see: % of your 5h session limit used,
  % of your 7-day weekly limit used, number of messages tracked, current status, and a
  live countdown to your next session reset.
- On any other site, the popup just shows a prompt to open claude.ai.
- The toolbar badge shows a compact countdown (e.g. `3h`, `45m`).
- **Set reset time manually** lets you override the countdown if needed.
- **Reset session data** clears the tracked counters.

## Known limitations

- No raw token counts — Claude.ai's web app doesn't expose `input_tokens`/`output_tokens`
  to the frontend, only the percentage of your limit used. This is an Anthropic API
  limitation, not something this extension can work around.
- This only tracks usage that happens while the extension is loaded and claude.ai is
  open in a tab; it has no access to Anthropic's backend usage counters outside of what
  the page itself receives.
- Built and tested against claude.ai's current web app; the SSE event shape/URL pattern
  may need updates if Anthropic changes its API routes.

## Project structure

```
manifest.json            MV3 manifest
background.js            Service worker: persisted state, badge, alarms
content/interceptor.js   MAIN-world script: hooks fetch(), extracts message_limit data
content/bridge.js        Isolated-world script: relays message_limit events
popup/                   Toolbar popup UI (hidden unless active tab is claude.ai)
icons/                   Generated extension icons
scripts/gen_icons.py     One-off script used to generate icons/*.png
```
