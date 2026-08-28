// PST Network Watcher
// Injected into the MAIN page context to override fetch and XHR

(function() {
  if (window.__pstNetworkInjected) return;
  window.__pstNetworkInjected = true;

  console.log("[PST] Network Watcher injected into main page context.");

  // 1. Override Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // We only care about JSON responses for sales
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      // Clone the response so we don't break the actual application
      response.clone().json().then(data => {
        // Broadcast the JSON payload out to the content script
        window.postMessage({ type: "PST_NETWORK_INTERCEPT", payload: data, url: args[0] }, "*");
      }).catch(err => {}); // ignore parse errors
    }
    return response;
  };

  // 2. Override XHR
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", function() {
      const contentType = this.getResponseHeader("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: "PST_NETWORK_INTERCEPT", payload: data, url: this.responseURL }, "*");
        } catch (e) {}
      }
    });
    originalXHRSend.apply(this, args);
  };
})();
