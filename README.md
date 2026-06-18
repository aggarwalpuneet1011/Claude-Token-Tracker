# Claude Usage Tracker

A Chrome extension that shows a live usage bar at the top of claude.ai — no API keys, no backend, no guessing. It reads Anthropic's own server-computed numbers directly from the browser on every conversation turn.

## What it shows

A slim fixed bar pinned to the top of every claude.ai page:

```
5H ████████░░░░░░░░░░░░ 25%  |  7D ██░░░░░░░░░░░░░░░░░░░░ 3%  |  03:42:18
```

- **5h bar** — your current session utilization (resets every 5 hours)
- **7d bar** — your weekly utilization (resets every 7 days)
- **Countdown** — live timer to your next session reset
- **Spike warning** — if a single message consumes more than 10% of your session, the 5h bar pulses red with a ⚠ icon for 6 seconds
- **Click the toolbar icon** to hide/show the bar

## How it works

Claude.ai sends a `message_limit` Server-Sent Event on every conversation turn. That event carries Anthropic's own server-computed utilization percentages and exact reset timestamps for both windows. The extension intercepts that event and surfaces the data in the overlay bar.

- `content/interceptor.js` — runs in the page's MAIN world at `document_start`, overrides `window.fetch`, watches for requests to the chat completion endpoint. Uses a `TransformStream` to buffer the SSE response as it passes through to claude.ai, then parses `message_limit` events in `flush()` once the stream closes.
- `content/bridge.js` — runs in the isolated world, relays parsed data to the background service worker via `chrome.runtime.sendMessage`.
- `background.js` — service worker that persists state in `chrome.storage.local`, keeps the toolbar badge countdown current via `chrome.alarms`, and sends `TOGGLE_OVERLAY` to the active tab when the toolbar icon is clicked.
- `content/overlay.js` — runs in the isolated world at `document_idle`, injects the fixed bar into the page and listens to `chrome.storage.onChanged` for live updates. No polling — updates fire immediately when background writes new state.

All data stays local in your browser via `chrome.storage.local`. Nothing is sent anywhere except to Claude.ai itself (which it already would be).

## Install (unpacked, for personal use)

1. Download/unzip this folder, or `git clone` the repo.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Open or refresh [claude.ai](https://claude.ai) — the bar appears immediately.
6. Send a message and the bars fill with your real usage numbers.

## Known limitations

- **No raw token counts.** Claude.ai's web app doesn't expose `input_tokens`/`output_tokens` to the frontend — only the utilization percentage. This is an Anthropic API constraint, not something this extension can work around.
- **Only tracks live usage.** The extension only sees usage that happens while it's loaded and claude.ai is open in a tab. It has no access to Anthropic's backend counters.
- **Built against claude.ai's current web app.** The SSE event shape and URL pattern may need updates if Anthropic changes its internal API routes.

## Project structure

```
manifest.json            MV3 manifest (v1.1.0)
background.js            Service worker: persisted state, badge, alarms, toggle handler
content/interceptor.js   MAIN-world script: hooks fetch(), extracts message_limit SSE data
content/bridge.js        Isolated-world script: relays message_limit events to background
content/overlay.js       Isolated-world script: injects and manages the top bar UI
icons/                   Extension icons
scripts/gen_icons.py     One-off script used to generate icons/*.png
popup/                   Vestigial (popup removed in v1.1.0; kept for reference)
```
