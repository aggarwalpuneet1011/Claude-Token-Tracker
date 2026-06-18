const countdownEl = document.getElementById("countdown");
const countdownLabelEl = document.getElementById("countdownLabel");
const resetSourceEl = document.getElementById("resetSource");
const inputTokensEl = document.getElementById("inputTokens");
const outputTokensEl = document.getElementById("outputTokens");
const totalTokensEl = document.getElementById("totalTokens");
const messageCountEl = document.getElementById("messageCount");
const toggleManualBtn = document.getElementById("toggleManual");
const manualForm = document.getElementById("manualForm");
const manualTimeInput = document.getElementById("manualTime");
const saveManualBtn = document.getElementById("saveManual");
const resetSessionBtn = document.getElementById("resetSession");

let currentState = null;
let tickHandle = null;

const SOURCE_LABEL = {
  banner: "from Claude's own limit notice",
  manual: "set manually",
  estimated: "estimated — assumes a 5h window from your first message",
};

function fmt(n) {
  return n.toLocaleString();
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function render() {
  if (!currentState) return;
  const { totals, resetAt, resetSource } = currentState;
  inputTokensEl.textContent = fmt(totals.inputTokens);
  outputTokensEl.textContent = fmt(totals.outputTokens);
  totalTokensEl.textContent = fmt(totals.inputTokens + totals.outputTokens);
  messageCountEl.textContent = fmt(totals.messageCount);

  if (resetAt) {
    const remaining = resetAt - Date.now();
    countdownEl.textContent = formatCountdown(remaining);
    const resetDate = new Date(resetAt);
    countdownLabelEl.textContent = `until reset (~${resetDate.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })})`;
    resetSourceEl.textContent = SOURCE_LABEL[resetSource] || "";
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

refresh();
tickHandle = setInterval(render, 1000);
window.addEventListener("unload", () => clearInterval(tickHandle));
