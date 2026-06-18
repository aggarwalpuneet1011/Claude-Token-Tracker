// Service worker: owns the persisted usage state, reacts to events relayed
// from content/bridge.js, and keeps the toolbar badge / countdown current.
// Usage data comes straight from Claude.ai's own "message_limit" SSE event,
// which carries the server-computed 5h/7d utilization and exact reset
// timestamps — no estimation needed.

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

  const isNewWindow =
    state.session && newSession && newSession.resetAt && state.session.resetAt !== newSession.resetAt;

  state.messageCount = isNewWindow ? 1 : (state.messageCount || 0) + 1;
  state.session = newSession;
  state.weekly = newWeekly;
  state.resolved = newResolved;
  state.updatedAt = Date.now();

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
