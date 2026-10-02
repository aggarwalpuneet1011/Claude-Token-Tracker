// Runs in the extension's isolated world on claude.ai.
// Injects a slim fixed bar at the top of the viewport showing:
//   • 5h session utilization progress bar
//   • 7d weekly utilization progress bar
//   • Live countdown to next session reset
// State comes from chrome.storage.local (written by background.js). This script
// also polls Claude.ai's own usage endpoint so the bar stays correct for usage
// from any surface, and blanks a reading whose window has already reset.
// Clicking the extension icon toggles visibility.
// If session usage jumps >10% in a single message, the session bar pulses red.

(function () {
  "use strict";

  const BAR_ID = "cut-overlay-bar";
  const STORAGE_KEY = "usageState";
  const SPIKE_THRESHOLD = 0.10; // 10 percentage points
  const POLL_MS = 60 * 1000; // how often to refresh from the usage endpoint
  const FRESH_MS = 45 * 1000; // skip a poll if another tab refreshed this recently

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
      transition: width 0.6s ease, background 0.3s ease;
    }
    #${BAR_ID} .cut-fill-session { background: #D97757; }
    #${BAR_ID} .cut-fill-weekly  { background: #6B9CE8; }

    /* Warning state: bar turns red and pulses, pct turns red, icon appears */
    #${BAR_ID} .cut-fill-session.cut-spike { background: #FF3B30; animation: cut-pulse 0.7s ease-in-out 4; }
    #${BAR_ID} .cut-pct.cut-spike          { color: #FF3B30 !important; }
    #${BAR_ID} .cut-spike-icon             { display: none; color: #FF3B30; font-size: 13px; flex-shrink: 0; }
    #${BAR_ID} .cut-spike-icon.cut-spike   { display: inline; }

    @keyframes cut-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.35; }
    }

    #${BAR_ID} .cut-pct {
      font-variant-numeric: tabular-nums;
      min-width: 30px;
      text-align: right;
      color: rgba(255, 255, 255, 0.8);
      flex-shrink: 0;
      transition: color 0.3s ease;
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
    <span class="cut-spike-icon" id="cut-spike-icon">⚠</span>

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

  // ── Warning (spike detection) ─────────────────────────────────────────────

  let warningTimer = null;

  function triggerSpike() {
    const sFill = document.getElementById("cut-s-fill");
    const sPct = document.getElementById("cut-s-pct");
    const icon = document.getElementById("cut-spike-icon");
    if (!sFill) return;

    // Force animation restart by removing and re-adding the class
    sFill.classList.remove("cut-spike");
    sPct.classList.remove("cut-spike");
    icon.classList.remove("cut-spike");
    void sFill.offsetWidth; // reflow to restart animation
    sFill.classList.add("cut-spike");
    sPct.classList.add("cut-spike");
    icon.classList.add("cut-spike");

    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => {
      sFill.classList.remove("cut-spike");
      sPct.classList.remove("cut-spike");
      icon.classList.remove("cut-spike");
    }, 6000);
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
    if (!sFill) return;

    const sPct = document.getElementById("cut-s-pct");
    const wFill = document.getElementById("cut-w-fill");
    const wPct = document.getElementById("cut-w-pct");
    const cd = document.getElementById("cut-cd");

    // A reading whose reset time has passed belongs to a finished window.
    // Show "—" instead of repainting it until fresh data arrives.
    const session = liveWindow(state && state.session);
    const weekly = liveWindow(state && state.weekly);

    const sUtil = session ? (session.utilization || 0) : 0;
    const wUtil = weekly ? (weekly.utilization || 0) : 0;

    sFill.style.width = Math.min(100, sUtil * 100) + "%";
    sPct.textContent = session ? pct(sUtil) : "—";

    wFill.style.width = Math.min(100, wUtil * 100) + "%";
    wPct.textContent = weekly ? pct(wUtil) : "—";

    const resetAt = session && session.resetAt;
    cd.textContent = resetAt ? formatCountdown(resetAt - Date.now()) : "--:--:--";
  }

  function liveWindow(win) {
    if (!win) return null;
    if (win.resetAt && win.resetAt <= Date.now()) return null;
    return win;
  }

  function applyState(state) {
    // Spike detection: session utilization jumped >10pp since last update.
    // An expired previous reading is not a valid baseline.
    const prevSession = liveWindow(currentState && currentState.session);
    const nextSession = liveWindow(state && state.session);
    const prevUtil = prevSession ? (prevSession.utilization || 0) : null;
    const newUtil = nextSession ? (nextSession.utilization || 0) : null;

    if (prevUtil !== null && newUtil !== null && (newUtil - prevUtil) >= SPIKE_THRESHOLD) {
      // Render new state first so the bar position is updated, then warn
      currentState = state;
      render();
      triggerSpike();
    } else {
      currentState = state;
      render();
    }

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

  // ── Live usage polling ────────────────────────────────────────────────────
  // /api/organizations/{org}/usage is what claude.ai's own Settings > Usage
  // page reads. It returns percentages on a 0..100 scale and ISO reset times.

  let orgId = null;
  let pollInFlight = false;
  let pollHandle = null;

  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function cookieOrgId() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function fetchUsageFor(id) {
    if (!id) return null;
    const res = await fetch(`/api/organizations/${encodeURIComponent(id)}/usage`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" && "five_hour" in body ? body : null;
  }

  async function fetchUsage() {
    const tried = new Set();
    for (const id of [orgId, cookieOrgId()]) {
      if (!id || tried.has(id)) continue;
      tried.add(id);
      const body = await fetchUsageFor(id);
      if (body) {
        orgId = id;
        return body;
      }
    }
    // Fall back to the org list and take the first org that exposes usage.
    const res = await fetch("/api/organizations", { credentials: "include" });
    if (!res.ok) return null;
    const orgs = await res.json();
    for (const org of Array.isArray(orgs) ? orgs : []) {
      if (!org || !org.uuid || tried.has(org.uuid)) continue;
      tried.add(org.uuid);
      const body = await fetchUsageFor(org.uuid);
      if (body) {
        orgId = org.uuid;
        return body;
      }
    }
    return null;
  }

  function normalizeWindow(win) {
    // A null window means nothing has been used in it yet.
    if (!win || typeof win.utilization !== "number") return { utilization: 0, resetAt: null };
    const t = win.resets_at ? new Date(win.resets_at).getTime() : NaN;
    return { utilization: win.utilization / 100, resetAt: isNaN(t) ? null : t };
  }

  async function pollUsage(force) {
    if (!extensionAlive()) {
      clearInterval(pollHandle);
      return;
    }
    if (pollInFlight) return;
    if (!force) {
      if (document.hidden) return;
      const fresh =
        currentState &&
        currentState.source === "usage_api" &&
        currentState.updatedAt &&
        Date.now() - currentState.updatedAt < FRESH_MS;
      if (fresh) return;
    }
    pollInFlight = true;
    try {
      const body = await fetchUsage();
      if (!body) return;
      chrome.runtime.sendMessage({
        type: "USAGE_SNAPSHOT",
        payload: {
          session: normalizeWindow(body.five_hour),
          weekly: normalizeWindow(body.seven_day),
        },
      });
    } catch (_) {
      // signed out, offline, or endpoint changed: keep whatever we have
    } finally {
      pollInFlight = false;
    }
  }

  pollUsage(true);
  pollHandle = setInterval(() => pollUsage(false), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollUsage(false);
  });

  // A completion just finished in this tab (relayed by interceptor.js):
  // refresh right away so the bar and spike warning react without waiting.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "claude-usage-tracker" || data.type !== "message_limit") return;
    setTimeout(() => pollUsage(true), 1500);
  });

  // ── Toggle (extension icon click → background sends TOGGLE_OVERLAY) ───────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_OVERLAY") {
      bar.classList.toggle("cut-hidden");
    }
  });
})();
