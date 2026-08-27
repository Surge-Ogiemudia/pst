// PST Background Service Worker
// Handles connector health checks and opens the side panel on click

const CONNECTOR_URL = 'http://127.0.0.1:3002';
let connectorStatus = 'unknown'; // 'connected' | 'disconnected' | 'unknown'

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
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
