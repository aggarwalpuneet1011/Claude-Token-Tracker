// Service worker: owns the persisted usage state, reacts to events relayed
// from content/bridge.js, and keeps the toolbar badge / countdown current.

const STORAGE_KEY = "usageState";
const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000; // Claude's usage limit window is 5 hours

const DEFAULT_STATE = {
  sessionStart: null,
  resetAt: null,
  resetSource: null, // "banner" | "manual" | "estimated"
  totals: { inputTokens: 0, outputTokens: 0, messageCount: 0 },
};

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || { ...DEFAULT_STATE };
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function freshSession(now) {
  return {
    sessionStart: now,
    resetAt: null,
    resetSource: "estimated",
    totals: { inputTokens: 0, outputTokens: 0, messageCount: 0 },
  };
}

async function maybeRollSession(state) {
  const now = Date.now();
  const expired = state.resetAt ? now >= state.resetAt : false;
  const staleEstimate =
    !state.resetAt && state.sessionStart && now - state.sessionStart >= SESSION_WINDOW_MS;
  if (!state.sessionStart || expired || staleEstimate) {
    return freshSession(now);
  }
  return state;
}

async function handleUsageUpdate(payload) {
  let state = await getState();
  state = await maybeRollSession(state);
  if (!state.sessionStart) state.sessionStart = Date.now();
  if (!state.resetAt) {
    state.resetAt = state.sessionStart + SESSION_WINDOW_MS;
    state.resetSource = state.resetSource || "estimated";
  }
  state.totals.inputTokens += payload.input_tokens || 0;
  state.totals.outputTokens += payload.output_tokens || 0;
  state.totals.messageCount += 1;
  await setState(state);
  await updateBadge(state);
}

async function handleResetBanner(payload) {
  let state = await getState();
  state = await maybeRollSession(state);
  if (!state.sessionStart) state.sessionStart = Date.now();
  state.resetAt = payload.resetAt;
  state.resetSource = "banner";
  await setState(state);
  await updateBadge(state);
}

async function handleManualReset(resetAt) {
  let state = await getState();
  if (!state.sessionStart) state.sessionStart = Date.now();
  state.resetAt = resetAt;
  state.resetSource = "manual";
  await setState(state);
  await updateBadge(state);
}

async function handleClearSession() {
  const state = freshSession(Date.now());
  state.sessionStart = null;
  state.resetAt = null;
  state.resetSource = null;
  await setState(state);
  await updateBadge(state);
}

function formatBadge(ms) {
  if (ms <= 0) return "";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return `${hours}h`;
  return `${minutes}m`;
}

async function updateBadge(stateArg) {
  const state = stateArg || (await maybeRollSession(await getState()));
  if (!state.resetAt) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const remaining = state.resetAt - Date.now();
  chrome.action.setBadgeText({ text: formatBadge(remaining) });
  chrome.action.setBadgeBackgroundColor({ color: "#D97757" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "USAGE_UPDATE":
        await handleUsageUpdate(message.payload);
        break;
      case "RESET_BANNER":
        await handleResetBanner(message.payload);
        break;
      case "SET_MANUAL_RESET":
        await handleManualReset(message.payload.resetAt);
        break;
      case "CLEAR_SESSION":
        await handleClearSession();
        break;
      case "GET_STATE": {
        const state = await maybeRollSession(await getState());
        await setState(state);
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
  const state = await maybeRollSession(await getState());
  await setState(state);
  await updateBadge(state);
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
