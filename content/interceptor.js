// Runs in the page's MAIN world (has access to window.fetch as the page sees it).
// Watches Claude.ai's chat completion requests and pulls token usage numbers
// out of the streamed response, then hands them off to bridge.js via
// window.postMessage (the only way to cross from MAIN world back to the
// extension's isolated-world content script).
(function () {
  const SOURCE = "claude-usage-tracker";
  const originalFetch = window.fetch;

  // Anthropic's streaming format sends "data: {...}" lines, each a JSON
  // object that may carry a "usage" field (message_start / message_delta),
  // or usage nested under "message". We don't hard-code Claude.ai's exact
  // internal route shape since it can change; instead we scan any response
  // from a URL that looks like a conversation/completion call for usage-
  // shaped JSON, which is resilient to minor API differences.
  function collectUsage(obj, out) {
    if (!obj || typeof obj !== "object") return;
    if (
      obj.usage &&
      (typeof obj.usage.input_tokens === "number" ||
        typeof obj.usage.output_tokens === "number")
    ) {
      out.push(obj.usage);
    }
    if (obj.message && obj.message.usage) out.push(obj.message.usage);
  }

  function parseUsageFromText(text) {
    const usages = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        collectUsage(JSON.parse(jsonStr), usages);
      } catch (_) {
        // partial/non-JSON SSE line, ignore
      }
    }
    if (usages.length === 0) {
      try {
        collectUsage(JSON.parse(text), usages);
      } catch (_) {
        // not a single JSON blob either, nothing to extract
      }
    }
    return usages;
  }

  function mergeUsages(usages) {
    let input = 0,
      output = 0,
      cacheCreate = 0,
      cacheRead = 0;
    for (const u of usages) {
      input = Math.max(input, u.input_tokens || 0);
      output = Math.max(output, u.output_tokens || 0);
      cacheCreate = Math.max(cacheCreate, u.cache_creation_input_tokens || 0);
      cacheRead = Math.max(cacheRead, u.cache_read_input_tokens || 0);
    }
    return {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
    };
  }

  const COMPLETION_URL_RE = /\/api\/.*chat_conversations.*(completion|retry_completion)/i;

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
            const usages = parseUsageFromText(text);
            if (usages.length) {
              window.postMessage(
                { source: SOURCE, type: "usage", payload: mergeUsages(usages), url },
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
