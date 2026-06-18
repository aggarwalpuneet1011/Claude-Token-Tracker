// Runs in the page's MAIN world (has access to window.fetch as the page sees it).
// Watches Claude.ai's chat completion requests and pulls the "message_limit"
// SSE event out of the response stream. Claude.ai's internal completion API
// doesn't expose raw token counts (that's only in the public Messages API),
// but it does send Anthropic's own server-computed usage percentage and
// exact reset time for the 5h session window and 7d weekly window on every
// turn. We hand that off to bridge.js via window.postMessage (the only way
// to cross from MAIN world back to the extension's isolated-world content
// script).
(function () {
  const SOURCE = "claude-usage-tracker";
  const originalFetch = window.fetch;

  const COMPLETION_URL_RE = /\/api\/.*chat_conversations.*(completion|retry_completion)/i;

  function parseLimitEvents(text) {
    // Normalize CRLF/CR line endings — HTTP servers send \r\n, and without
    // this the block split on /\n\n+/ fails because \r\n\r\n doesn't match.
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const limits = [];
    for (const block of text.split(/\n\n+/)) {
      let isLimitEvent = false;
      let dataLine = null;
      for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event:") && trimmed.slice(6).trim() === "message_limit") {
          isLimitEvent = true;
        }
        if (trimmed.startsWith("data:")) dataLine = trimmed.slice(5).trim();
      }
      if (!isLimitEvent || !dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine);
        if (parsed && parsed.message_limit) limits.push(parsed.message_limit);
      } catch (_) {
        // partial/non-JSON SSE line, ignore
      }
    }
    return limits;
  }

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
      if (COMPLETION_URL_RE.test(url)) {
        response
          .clone()
          .text()
          .then((text) => {
            const limits = parseLimitEvents(text);
            if (limits.length) {
              window.postMessage(
                { source: SOURCE, type: "message_limit", payload: limits[limits.length - 1], url },
                "*"
              );
            }
          })
          .catch(() => {});
      }
    } catch (_) {
      // never let our instrumentation break the page's own request
    }
    return response;
  };
})();
