// PST Content Script

let isTraining = false;

// 1. Listen for messages from side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_TRAINING") {
    isTraining = true;
    document.body.style.cursor = "crosshair";
    
    // Add visual overlay on hover
    document.addEventListener("mouseover", highlightElement, true);
    document.addEventListener("mouseout", removeHighlight, true);
    document.addEventListener("click", captureClick, true);
  }

  if (msg.action === "SCAN_INVENTORY") {
    const data = scrapeInventory();
    chrome.runtime.sendMessage({ action: "INVENTORY_SCANNED", data: data });
  }
});

// 2. Training Logic
let currentHighlight = null;

function highlightElement(e) {
  if (!isTraining) return;
  if (currentHighlight) currentHighlight.style.outline = "";
  currentHighlight = e.target;
  currentHighlight.style.outline = "2px solid #00d4aa";
  currentHighlight.style.outlineOffset = "2px";
}

function removeHighlight(e) {
  if (!isTraining) return;
  if (currentHighlight) currentHighlight.style.outline = "";
}

function captureClick(e) {
  if (!isTraining) return;
  e.preventDefault();
  e.stopPropagation();

  isTraining = false;
  document.body.style.cursor = "default";
  
  document.removeEventListener("mouseover", highlightElement, true);
  document.removeEventListener("mouseout", removeHighlight, true);
  document.removeEventListener("click", captureClick, true);

  if (currentHighlight) currentHighlight.style.outline = "";

  const selector = generateSelector(e.target);
  chrome.runtime.sendMessage({ action: "TRAINING_COMPLETE", selector: selector });
}

// Very basic unique selector generator
function generateSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const classes = el.className.split(" ").filter(c => c).join(".");
    if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
  }
  return el.tagName.toLowerCase();
}

// 3. Scraping Logic
function scrapeInventory() {
  const tables = document.querySelectorAll("table");
  let targetTable = null;
  let maxRows = 0;

  // Find the largest table
  tables.forEach(t => {
    const rows = t.querySelectorAll("tr");
    if (rows.length > maxRows) {
      maxRows = rows.length;
      targetTable = t;
    }
  });

  if (!targetTable) return [["No table found", "", "", ""]];

  const results = [];
  const rows = targetTable.querySelectorAll("tr");
  
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll("td, th")).map(c => c.innerText.trim());
    if (cells.length > 0) results.push(cells);
  });

  return results;
}

// 4. Listen for network events from injected script
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  
  if (event.data.type && event.data.type === "PST_NETWORK_INTERCEPT") {
    const payload = event.data.payload;
    // VERY simple heuristic: if it contains words like 'sale', 'checkout', 'price', or 'total'
    const payloadStr = JSON.stringify(payload).toLowerCase();
    
    // In a real app we'd parse the actual API structure.
    // For this mock sale, if we detect an array or object, we parse it into our table format.
    // Let's assume we capture an array of items or single item.
    let items = [];
    
    // Attempt to extract items (mock extraction)
    if (Array.isArray(payload)) {
      items = payload.map(i => ({ name: i.name || i.id || "Item", qty: i.qty || i.quantity || 1, price: i.price || i.amount || 0 }));
    } else if (payload.items) {
      items = payload.items.map(i => ({ name: i.name || i.id || "Item", qty: i.qty || i.quantity || 1, price: i.price || i.amount || 0 }));
    } else {
      // Just mock it if we can't parse it for the demo
      items = [{ name: "Mock Sale Item", qty: 1, price: payload.total || payload.amount || "N/A" }];
    }

    chrome.runtime.sendMessage({ action: "SALE_DETECTED", data: { items } });
  }
});
