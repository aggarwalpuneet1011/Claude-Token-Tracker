// Runs in the extension's isolated world: relays usage events from
// interceptor.js (MAIN world) to the background service worker, and
// watches the page for Claude's own "limit reached, resets at/in ..."
// banner so we can use Anthropic's own server-computed reset time
// instead of guessing.
(function () {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "claude-usage-tracker" || data.type !== "usage") return;
    chrome.runtime.sendMessage({ type: "USAGE_UPDATE", payload: data.payload });
  });

  const RESET_REGEX = /reset[s]?\s+(?:at|in)\s+([^.\n]{1,60})/i;

  function parseResetFragment(fragment) {
    const atMatch = fragment.match(/at\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
    if (atMatch) {
      const now = new Date();
      const parsed = new Date(`${now.toDateString()} ${atMatch[1]}`);
      if (!isNaN(parsed.getTime())) {
        if (parsed.getTime() < now.getTime()) parsed.setDate(parsed.getDate() + 1);
        return parsed.getTime();
      }
    }
    const inMatch = fragment.match(/in\s+(?:(\d+)\s*h(?:our)?s?)?\s*(?:(\d+)\s*m(?:in(?:ute)?)?s?)?/i);
    if (inMatch && (inMatch[1] || inMatch[2])) {
      const hours = parseInt(inMatch[1] || "0", 10);
      const minutes = parseInt(inMatch[2] || "0", 10);
      if (hours || minutes) return Date.now() + (hours * 60 + minutes) * 60000;
    }
    return null;
  }

  let lastScannedText = "";
  function scanForResetBanner() {
    const text = document.body ? document.body.innerText : "";
    if (!text || text === lastScannedText) return;
    lastScannedText = text;
    const match = text.match(RESET_REGEX);
    if (!match) return;
    const resetAt = parseResetFragment(match[0]);
    if (resetAt) {
      chrome.runtime.sendMessage({ type: "RESET_BANNER", payload: { resetAt, rawText: match[0] } });
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanForResetBanner();
    }, 2000);
  }

  function start() {
    if (!document.body) {
      requestAnimationFrame(start);
      return;
    }
    scanForResetBanner();
    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  start();
})();
