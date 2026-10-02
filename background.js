// Service worker: owns the persisted usage state, reacts to events relayed
// from content/bridge.js, and keeps the toolbar badge / countdown current.
// Primary source: Claude.ai's own /api/organizations/{org}/usage endpoint,
// polled by content/overlay.js (USAGE_SNAPSHOT). It reflects usage from every
// surface (chat, sessions, desktop, mobile, Claude Code).
// Secondary source: the "message_limit" SSE event on classic chat completions,
// which gives an instant update and drives the message counter.

const STORAGE_KEY = "usageState";

const DEFAULT_STATE = {
  messageCount: 0,
  updatedAt: null,
  session: null, // { utilization, resetAt, status } — 5h window
  weekly: null, // { utilization, resetAt, status } — 7d window
  resolved: null, // { percent, resetAt, status, group } — the binding limit
};

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || { ...DEFAULT_STATE };
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function toMsFromUnix(seconds) {
  return typeof seconds === "number" ? seconds * 1000 : null;
}

function toMsFromIso(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

async function handleMessageLimitUpdate(limit) {
  const state = await getState();
  const windows = limit.windows || {};
  const fiveH = windows["5h"];
  const sevenD = windows["7d"];
  const resolvedLimit = limit.resolved && limit.resolved.limit;

  const newSession = fiveH
    ? { utilization: fiveH.utilization, resetAt: toMsFromUnix(fiveH.resets_at), status: fiveH.status }
    : state.session;
  const newWeekly = sevenD
    ? { utilization: sevenD.utilization, resetAt: toMsFromUnix(sevenD.resets_at), status: sevenD.status }
    : state.weekly;
  const newResolved = resolvedLimit
    ? {
        percent: resolvedLimit.percent,
        resetAt: toMsFromIso(resolvedLimit.resets_at),
        status: resolvedLimit.severity || (limit.resolved && limit.resolved.status),
        group: resolvedLimit.group,
      }
    : state.resolved;

  const isNewWindow = isDifferentWindow(state.session && state.session.resetAt, newSession && newSession.resetAt);

  state.messageCount = isNewWindow ? 1 : (state.messageCount || 0) + 1;
  state.session = newSession;
  state.weekly = newWeekly;
  state.resolved = newResolved;
  state.updatedAt = Date.now();
  state.source = "message_limit";

  await setState(state);
  await updateBadge(state);
}

// The two sources report the same reset time with sub-second differences, so
// compare with a tolerance instead of strict equality.
function isDifferentWindow(prevResetAt, nextResetAt) {
  if (!prevResetAt || !nextResetAt) return false;
  return Math.abs(prevResetAt - nextResetAt) > 60 * 1000;
}

// Snapshot from the usage endpoint, already normalised by overlay.js:
// { session: { utilization (0..1), resetAt (ms|null) }, weekly: {...} }
async function handleUsageSnapshot(snap) {
  if (!snap || !snap.session || !snap.weekly) return;
  const state = await getState();
  if (isDifferentWindow(state.session && state.session.resetAt, snap.session.resetAt)) {
    state.messageCount = 0;
  }
  state.session = { ...snap.session, status: (state.session && state.session.status) || null };
  state.weekly = { ...snap.weekly, status: (state.weekly && state.weekly.status) || null };
  state.updatedAt = Date.now();
  state.source = "usage_api";
  await setState(state);
  await updateBadge(state);
}

async function handleManualReset(resetAt) {
  const state = await getState();
  state.session = { ...(state.session || {}), resetAt };
  await setState(state);
  await updateBadge(state);
}

async function handleClearSession() {
  const state = { ...DEFAULT_STATE };
  await setState(state);
  await updateBadge(state);
}

function formatBadge(ms) {
  if (ms == null || ms <= 0) return "";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return `${hours}h`;
  return `${minutes}m`;
}

async function updateBadge(stateArg) {
  const state = stateArg || (await getState());
  const resetAt = state.session && state.session.resetAt;
  if (!resetAt) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: formatBadge(resetAt - Date.now()) });
  chrome.action.setBadgeBackgroundColor({ color: "#D97757" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "MESSAGE_LIMIT_UPDATE":
        await handleMessageLimitUpdate(message.payload);
        break;
      case "USAGE_SNAPSHOT":
        await handleUsageSnapshot(message.payload);
        break;
      case "SET_MANUAL_RESET":
        await handleManualReset(message.payload.resetAt);
        break;
      case "CLEAR_SESSION":
        await handleClearSession();
        break;
      case "GET_STATE": {
        const state = await getState();
        sendResponse(state);
        return;
      }
    }
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.alarms.create("tick", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  await updateBadge(await getState());
});

chrome.runtime.onInstalled.addListener(async () => updateBadge(await getState()));
chrome.runtime.onStartup.addListener(async () => updateBadge(await getState()));

// Clicking the toolbar icon toggles the overlay bar on the active claude.ai tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith("https://claude.ai/")) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
});
