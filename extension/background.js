// PST Background Service Worker
// Handles connector health checks and opens the side panel on click

const CONNECTOR_URL = 'http://127.0.0.1:3002';
let connectorStatus = 'unknown'; // 'connected' | 'disconnected' | 'unknown'

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// =============================================
// CDP Network Watcher (same as the Powershell version)
// =============================================
let debuggedTabId = null;
const pendingRequests = {}; // requestId -> {url, method, postData}

async function attachDebugger(tabId) {
  if (debuggedTabId === tabId) return; // Already attached
  if (debuggedTabId !== null) {
    try { await chrome.debugger.detach({ tabId: debuggedTabId }); } catch(e) {}
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    debuggedTabId = tabId;
    console.log("[PST] CDP Debugger attached to tab", tabId);
  } catch(e) {
    console.error("[PST] Failed to attach debugger:", e.message);
  }
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;

  if (method === "Network.requestWillBeSent") {
    pendingRequests[params.requestId] = {
      url: params.request.url,
      reqMethod: params.request.method,
      postData: params.request.postData || null
    };
  }

  if (method === "Network.responseReceived") {
    const req = pendingRequests[params.requestId];
    if (!req) return;
    const reqMethod = req.reqMethod.toUpperCase();
    if (reqMethod !== 'POST' && reqMethod !== 'PUT') return;

    const url = req.url.toLowerCase();
    const looksLikeSale = 
      url.includes('sale') || url.includes('checkout') || url.includes('order') || 
      url.includes('invoice') || url.includes('cart') || url.includes('pos') ||
      url.includes('payment') || url.includes('bill') || url.includes('receipt');
    
    let postData = null;
    try { postData = req.postData ? JSON.parse(req.postData) : null; } catch(e) {}

    // Also check if post data looks like a sale
    const postStr = (req.postData || '').toLowerCase();
    const looksLikeDataSale = postStr.includes('qty') || postStr.includes('quantity') || 
      postStr.includes('price') || postStr.includes('amount') || postStr.includes('product');

    if (!looksLikeSale && !looksLikeDataSale) return;
    
    // Get the response body using CDP
    try {
      const result = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId: params.requestId });
      let responseBody = null;
      try { responseBody = JSON.parse(result.body); } catch(e) { responseBody = result.body; }

      // Forward to content script as SALE_DETECTED
      chrome.tabs.sendMessage(tabId, {
        action: "CDP_SALE_DETECTED",
        data: {
          url: req.url,
          method: reqMethod,
          reqBody: postData,
          payload: responseBody
        }
      });
    } catch(e) {
      // Response body not available (e.g. redirect)
    }
    delete pendingRequests[params.requestId];
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === debuggedTabId) debuggedTabId = null;
});

// Attach debugger when a tab is activated
chrome.tabs.onActivated.addListener(async (info) => {
  await attachDebugger(info.tabId);
});

// Reattach if a tab is updated/reloaded
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === debuggedTabId) {
    debuggedTabId = null;
    await attachDebugger(tabId);
  }
});


// Poll the local connector every 10 seconds to check if it's alive
async function checkConnector() {
  try {
    const res = await fetch(`${CONNECTOR_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      connectorStatus = 'connected';
      
      // Store status and PMS info for the side panel to read
      chrome.storage.local.set({
        connectorStatus: 'connected',
        connectorVersion: data.version,
        detectedPMS: data.pms || null,
        lastChecked: Date.now()
      });

      // Update the badge to a green dot
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setBadgeBackgroundColor({ color: '#00d4aa' });
    }
  } catch {
    connectorStatus = 'disconnected';
    chrome.storage.local.set({ connectorStatus: 'disconnected', lastChecked: Date.now() });

    // Red badge when connector is not running
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
  }
}

// Run immediately and then every 10 seconds
checkConnector();
setInterval(checkConnector, 10000);

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get(['connectorStatus', 'detectedPMS', 'connectorVersion'], sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'SCAN_PMS') {
    fetch(`${CONNECTOR_URL}/scan`)
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'EXTRACT_DATA') {
    fetch(`${CONNECTOR_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pms: message.pms, db_path: message.dbPath || '' })
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
