// Runs in the extension's isolated world: relays message_limit events from
// interceptor.js (MAIN world) to the background service worker.
(function () {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "claude-usage-tracker" || data.type !== "message_limit") return;
    chrome.runtime.sendMessage({ type: "MESSAGE_LIMIT_UPDATE", payload: data.payload });
  });
})();
