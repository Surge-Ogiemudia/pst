// PST Network Watcher
// Injected into the MAIN page context to override fetch and XHR

(function() {
  if (window.__pstNetworkInjected) return;
  window.__pstNetworkInjected = true;

  console.log("[PST] Network Watcher injected into main page context.");

  // 1. Override Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
    const reqInit = args[1] || {};
    const method = (reqInit.method || 'GET').toUpperCase();
    
    let reqBody = null;
    try {
      if (reqInit.body && typeof reqInit.body === 'string') {
        reqBody = JSON.parse(reqInit.body);
      }
    } catch(e) {}

    const response = await originalFetch.apply(this, args);
    
    // Check response JSON
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      response.clone().json().then(resData => {
        window.postMessage({ type: "PST_NETWORK_INTERCEPT", method, url, reqBody, payload: resData }, "*");
      }).catch(err => {
        if (method === 'POST') {
           window.postMessage({ type: "PST_NETWORK_INTERCEPT", method, url, reqBody, payload: { success: true } }, "*");
        }
      });
    } else if (method === 'POST') {
       window.postMessage({ type: "PST_NETWORK_INTERCEPT", method, url, reqBody, payload: { success: true } }, "*");
    }
    
    return response;
  };

  // 2. Override XHR
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._pstMethod = method.toUpperCase();
    this._pstUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    let reqBody = null;
    try {
      if (args[0] && typeof args[0] === 'string') {
        reqBody = JSON.parse(args[0]);
      }
    } catch(e) {}

    this.addEventListener("load", function() {
      const contentType = this.getResponseHeader("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: "PST_NETWORK_INTERCEPT", method: this._pstMethod, url: this._pstUrl, reqBody, payload: data }, "*");
        } catch (e) {
          if (this._pstMethod === 'POST') window.postMessage({ type: "PST_NETWORK_INTERCEPT", method: this._pstMethod, url: this._pstUrl, reqBody, payload: { success: true } }, "*");
        }
      } else if (this._pstMethod === 'POST') {
        window.postMessage({ type: "PST_NETWORK_INTERCEPT", method: this._pstMethod, url: this._pstUrl, reqBody, payload: { success: true } }, "*");
      }
    });
    originalXHRSend.apply(this, args);
  };
})();
