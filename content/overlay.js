// Runs in the extension's isolated world on claude.ai.
// Injects a slim fixed bar at the top of the viewport showing:
//   • 5h session utilization progress bar
//   • 7d weekly utilization progress bar
//   • Live countdown to next session reset
// State comes from chrome.storage.local (written by background.js on every
// message_limit event). Clicking the extension icon toggles visibility.

(function () {
  "use strict";

  const BAR_ID = "cut-overlay-bar";
  const STORAGE_KEY = "usageState";

  // ── Styles ────────────────────────────────────────────────────────────────

  const css = `
    #${BAR_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 34px;
      background: rgba(12, 12, 15, 0.93);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 12px;
      z-index: 2147483647;
      font-family: ui-monospace, "SF Mono", "Fira Code", monospace;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      box-sizing: border-box;
      user-select: none;
    }
    #${BAR_ID}.cut-hidden {
      display: none !important;
    }
    #${BAR_ID} .cut-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #${BAR_ID} .cut-track {
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.09);
      overflow: hidden;
      flex: 1;
      min-width: 60px;
      max-width: 160px;
    }
    #${BAR_ID} .cut-fill {
      height: 100%;
      border-radius: 2px;
      width: 0%;
      transition: width 0.6s ease;
    }
    #${BAR_ID} .cut-fill-session { background: #D97757; }
    #${BAR_ID} .cut-fill-weekly  { background: #6B9CE8; }
    #${BAR_ID} .cut-pct {
      font-variant-numeric: tabular-nums;
      min-width: 30px;
      text-align: right;
      color: rgba(255, 255, 255, 0.8);
      flex-shrink: 0;
    }
    #${BAR_ID} .cut-sep {
      width: 1px;
      height: 14px;
      background: rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
    }
    #${BAR_ID} .cut-countdown {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: rgba(255, 255, 255, 0.8);
      flex-shrink: 0;
    }
    #${BAR_ID} .cut-hint {
      margin-left: auto;
      font-size: 9px;
      color: rgba(255, 255, 255, 0.2);
      white-space: nowrap;
    }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  // ── Markup ────────────────────────────────────────────────────────────────

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.innerHTML = `
    <span class="cut-label">5h</span>
    <div class="cut-track">
      <div class="cut-fill cut-fill-session" id="cut-s-fill"></div>
    </div>
    <span class="cut-pct" id="cut-s-pct">—</span>

    <div class="cut-sep"></div>

    <span class="cut-label">7d</span>
    <div class="cut-track">
      <div class="cut-fill cut-fill-weekly" id="cut-w-fill"></div>
    </div>
    <span class="cut-pct" id="cut-w-pct">—</span>

    <div class="cut-sep"></div>

    <span class="cut-countdown" id="cut-cd">--:--:--</span>
    <span class="cut-hint">click icon to hide</span>
  `;

  function mount() {
    if (!document.body || document.getElementById(BAR_ID)) return;
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  let currentState = null;
  let tickHandle = null;

  function pct(fraction) {
    if (fraction == null) return "—";
    return Math.round(fraction * 100) + "%";
  }

  function formatCountdown(ms) {
    if (!ms || ms <= 0) return "--:--:--";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function render() {
    const state = currentState;
    const sFill = document.getElementById("cut-s-fill");
    if (!sFill) return; // bar not yet mounted

    const sPct = document.getElementById("cut-s-pct");
    const wFill = document.getElementById("cut-w-fill");
    const wPct = document.getElementById("cut-w-pct");
    const cd = document.getElementById("cut-cd");

    const session = state && state.session;
    const weekly = state && state.weekly;

    const sUtil = session ? (session.utilization || 0) : 0;
    const wUtil = weekly ? (weekly.utilization || 0) : 0;

    sFill.style.width = Math.min(100, sUtil * 100) + "%";
    sPct.textContent = session ? pct(sUtil) : "—";

    wFill.style.width = Math.min(100, wUtil * 100) + "%";
    wPct.textContent = weekly ? pct(wUtil) : "—";

    const resetAt = session && session.resetAt;
    cd.textContent = resetAt ? formatCountdown(resetAt - Date.now()) : "--:--:--";
  }

  function applyState(state) {
    currentState = state;
    render();
    if (!tickHandle) {
      tickHandle = setInterval(render, 1000);
    }
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (result[STORAGE_KEY]) applyState(result[STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      applyState(changes[STORAGE_KEY].newValue);
    }
  });

  // ── Toggle (extension icon click → background sends TOGGLE_OVERLAY) ───────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_OVERLAY") {
      bar.classList.toggle("cut-hidden");
    }
  });
})();
