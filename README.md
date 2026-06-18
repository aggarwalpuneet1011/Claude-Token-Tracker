# Claude Usage Tracker

A Chrome extension that tracks your token usage on [claude.ai](https://claude.ai) for the
current usage-limit session, and shows a live countdown until that limit resets.

## How it works

- A content script running in the page (`content/interceptor.js`) watches `fetch` calls
  Claude.ai makes to its chat-completion endpoint and reads the `usage` (input/output
  token counts) that Anthropic's API streams back with every response.
- Another content script (`content/bridge.js`) watches the page for the "your limit
  resets at/in ..." notice Claude.ai shows you when you're close to or have hit your
  usage limit, and parses out the actual reset time.
- If no such notice has appeared yet, the extension **estimates** a reset time as
  5 hours after your first tracked message in the session (Claude's standard rolling
  usage window for Pro/Max). This estimate is replaced the moment Claude's own notice
  appears, and you can also set the reset time manually from the popup.
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

- Click the extension icon to see: tokens used this session (input/output/total),
  number of messages, and a live countdown to your next reset.
- The toolbar badge shows a compact countdown (e.g. `3h`, `45m`).
- **Set reset time manually** lets you correct the countdown if Claude's banner wording
  changes or wasn't detected.
- **Reset session data** clears the tracked counters (useful if you know your limit
  already reset).

## Known limitations

- Token counts come from Anthropic's own per-request `usage` data, but each turn's
  `input_tokens` reflects the *full conversation context* sent for that turn (Claude
  resends history each turn) — this matches what counts against your usage limit, but
  isn't the same as "tokens in this one message."
- The reset-time detection relies on matching the wording of Claude's own limit notice.
  If Anthropic changes that copy, detection may miss it until you hit the limit again —
  use the manual override as a fallback.
- This only tracks usage that happens while the extension is loaded and claude.ai is
  open in a tab; it has no access to Anthropic's backend usage counters.
- Built and tested against claude.ai's current web app; selectors/URL patterns may need
  updates if Anthropic changes its API routes.

## Project structure

```
manifest.json            MV3 manifest
background.js            Service worker: persisted state, badge, alarms
content/interceptor.js   MAIN-world script: hooks fetch(), extracts token usage
content/bridge.js        Isolated-world script: relays usage + scrapes reset banner
popup/                   Toolbar popup UI
icons/                   Generated extension icons
scripts/gen_icons.py     One-off script used to generate icons/*.png
```
