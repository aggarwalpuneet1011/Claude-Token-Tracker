# Claude Usage Tracker

A Chrome extension that shows a live usage bar at the top of claude.ai — no API keys, no backend, no guessing. It reads Anthropic's own server-computed usage numbers from inside your signed-in claude.ai tab, so the bar reflects usage from every surface: chat, sessions, desktop, mobile and Claude Code.

## What it shows

A slim fixed bar pinned to the top of every claude.ai page:

```
5H ████████░░░░░░░░░░░░ 25%  |  7D ██░░░░░░░░░░░░░░░░░░░░ 3%  |  03:42:18
```

- **5h bar** — your current session utilization (resets every 5 hours)
- **7d bar** — your weekly utilization (resets every 7 days)
- **Countdown** — live timer to your next session reset
- **Spike warning** — if session usage jumps by more than 10 points between two readings, the 5h bar pulses red with a ⚠ icon for 6 seconds
- **Stale guard** — a reading whose window has already reset shows `—` instead of the old number
- **Click the toolbar icon** to hide/show the bar

## How it works

The bar reads `/api/organizations/{org}/usage`, the same endpoint claude.ai's own Settings > Usage page uses. It is polled on page load, every 60 seconds while the tab is visible, and right after a chat completion finishes. Because it is the server's own counter, it includes usage from every surface (chat, sessions, desktop, mobile, Claude Code).

Claude.ai also sends a `message_limit` Server-Sent Event on classic chat turns. The extension still intercepts it as an instant-update trigger. A stored reading whose reset time has passed is shown as `—` until fresh data arrives.

- `content/overlay.js` — runs in the isolated world at `document_idle`. Injects the fixed bar, polls the usage endpoint, and sends each reading to the background service worker as a `USAGE_SNAPSHOT`. It finds your organisation from the `lastActiveOrg` cookie and falls back to `/api/organizations`. Renders from `chrome.storage.onChanged`, so every open claude.ai tab updates together.
- `content/interceptor.js` — runs in the page's MAIN world at `document_start`, overrides `window.fetch`, watches for requests to the chat completion endpoint. Uses a `TransformStream` to buffer the SSE response as it passes through to claude.ai, then parses `message_limit` events in `flush()` once the stream closes. This now acts as a trigger for an immediate refresh.
- `content/bridge.js` — runs in the isolated world, relays parsed data to the background service worker via `chrome.runtime.sendMessage`.
- `background.js` — service worker that persists state in `chrome.storage.local`, keeps the toolbar badge countdown current via `chrome.alarms`, and sends `TOGGLE_OVERLAY` to the active tab when the toolbar icon is clicked.

All data stays local in your browser via `chrome.storage.local`. Nothing is sent anywhere except to Claude.ai itself (which it already would be).

## Install (unpacked, for personal use)

1. Download/unzip this folder, or `git clone` the repo.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Open or refresh [claude.ai](https://claude.ai) — the bar appears immediately.
6. The bars fill with your real usage numbers within a few seconds. No message needed.

After pulling an update, click the reload icon on the extension's card in `chrome://extensions`, then refresh claude.ai.

## Known limitations

- **No raw token counts.** Claude.ai's web app doesn't expose `input_tokens`/`output_tokens` to the frontend — only the utilization percentage. This is an Anthropic API constraint, not something this extension can work around.
- **Needs an open claude.ai tab.** The bar refreshes only while a claude.ai tab is open and visible.
- **Undocumented endpoint.** `/usage` is internal to claude.ai and may change without notice.
- **Built against claude.ai's current web app.** The SSE event shape and URL pattern may need updates if Anthropic changes its internal API routes.

## Project structure

```
manifest.json            MV3 manifest (v1.2.0)
background.js            Service worker: persisted state, badge, alarms, toggle handler
content/interceptor.js   MAIN-world script: hooks fetch(), extracts message_limit SSE data (refresh trigger)
content/bridge.js        Isolated-world script: relays message_limit events to background
content/overlay.js       Isolated-world script: top bar UI, polls the usage endpoint
icons/                   Extension icons
scripts/gen_icons.py     One-off script used to generate icons/*.png
popup/                   Vestigial (popup removed in v1.1.0; kept for reference)
```

## Changelog

- **1.2.0** — Fixed the bar showing a frozen percentage from an old session. Usage now comes from claude.ai's usage endpoint (all surfaces, polled every 60 seconds), and expired readings are blanked.
- **1.1.0** — Replaced the popup with the fixed top bar and added the spike warning.
