const mainContentEl = document.getElementById("mainContent");
const notOnClaudeEl = document.getElementById("notOnClaude");
const countdownEl = document.getElementById("countdown");
const countdownLabelEl = document.getElementById("countdownLabel");
const resetSourceEl = document.getElementById("resetSource");
const sessionPercentEl = document.getElementById("sessionPercent");
const weeklyPercentEl = document.getElementById("weeklyPercent");
const messageCountEl = document.getElementById("messageCount");
const statusEl = document.getElementById("status");
const toggleManualBtn = document.getElementById("toggleManual");
const manualForm = document.getElementById("manualForm");
const manualTimeInput = document.getElementById("manualTime");
const saveManualBtn = document.getElementById("saveManual");
const resetSessionBtn = document.getElementById("resetSession");

let currentState = null;
let tickHandle = null;

function pct(fraction) {
  if (fraction == null) return "—";
  return `${Math.round(fraction * 100)}%`;
}

function formatCountdown(ms) {
  if (ms == null || ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function render() {
  if (!currentState) return;
  const { session, weekly, resolved, messageCount } = currentState;

  sessionPercentEl.textContent = session ? pct(session.utilization) : "—";
  weeklyPercentEl.textContent = weekly ? pct(weekly.utilization) : "—";
  messageCountEl.textContent = (messageCount || 0).toLocaleString();
  statusEl.textContent = resolved ? resolved.status : "—";

  const resetAt = session && session.resetAt;
  if (resetAt) {
    countdownEl.textContent = formatCountdown(resetAt - Date.now());
    const resetDate = new Date(resetAt);
    countdownLabelEl.textContent = `until session resets (~${resetDate.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })})`;
    resetSourceEl.textContent = "from Claude's own usage data";
  } else {
    countdownEl.textContent = "--:--:--";
    countdownLabelEl.textContent = "no active session yet — send a message on claude.ai";
    resetSourceEl.textContent = "";
  }
}

async function refresh() {
  currentState = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  render();
}

toggleManualBtn.addEventListener("click", () => {
  manualForm.classList.toggle("hidden");
});

saveManualBtn.addEventListener("click", async () => {
  const value = manualTimeInput.value; // "HH:MM"
  if (!value) return;
  const [h, m] = value.split(":").map(Number);
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (resetDate.getTime() < now.getTime()) resetDate.setDate(resetDate.getDate() + 1);
  await chrome.runtime.sendMessage({
    type: "SET_MANUAL_RESET",
    payload: { resetAt: resetDate.getTime() },
  });
  manualForm.classList.add("hidden");
  await refresh();
});

resetSessionBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
  await refresh();
});

async function isOnClaudeAi() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return false;
    return new URL(tab.url).hostname === "claude.ai";
  } catch (_) {
    return false;
  }
}

async function init() {
  const onClaude = await isOnClaudeAi();
  mainContentEl.classList.toggle("hidden", !onClaude);
  notOnClaudeEl.classList.toggle("hidden", onClaude);
  if (!onClaude) return;
  await refresh();
  tickHandle = setInterval(render, 1000);
}

init();
window.addEventListener("unload", () => clearInterval(tickHandle));
