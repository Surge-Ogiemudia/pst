// PST Content Script

let isTraining = false;
let isScraping = false;
let stopRequested = false;

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
    if (isScraping) return; // Prevent double scanning
    startAutoScrape(msg.paginationSelector);
  }

  if (msg.action === "STOP_SCANNING") {
    stopRequested = true;
  }
});

async function startAutoScrape(paginationSelector) {
  isScraping = true;
  stopRequested = false;
  
  let aggregatedRows = [];
  let headers = [];
  let currentPage = 1;
  let lastRowHash = "";

  while (!stopRequested) {
    chrome.runtime.sendMessage({ action: "SCRAPE_PROGRESS", page: currentPage, totalItems: aggregatedRows.length });
    
    const data = scrapeInventory();
    if (currentPage === 1) headers = data.headers;
    
    // Check if the current page actually returned new data
    if (data.rows.length === 0) break;
    
    // Create a hash of the first row to detect infinite loops
    const currentRowHash = data.rows[0].join("|");
    if (currentRowHash === lastRowHash && currentPage > 1) {
      break; // The page didn't actually change!
    }
    lastRowHash = currentRowHash;
    
    aggregatedRows = aggregatedRows.concat(data.rows);

    if (!paginationSelector) break; // Single page scan

    const nextBtn = document.querySelector(paginationSelector);
    if (!nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('disabled')) {
      break;
    }

    nextBtn.click();
    await new Promise(r => setTimeout(r, 2000)); // Wait 2s for network/DOM update
    currentPage++;

    if (currentPage > 50) break; // Hard limit safety
  }

  isScraping = false;
  chrome.runtime.sendMessage({ action: "INVENTORY_SCANNED", data: { headers: headers, rows: aggregatedRows } });
}

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
  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += `#${el.id}`;
      path.unshift(selector);
      break;
    } else {
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() === selector) nth++;
      }
      if (nth != 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(" > ");
}

// 3. Scraping Logic
function scrapeInventory() {
  const tables = document.querySelectorAll("table");
  let targetTable = null;
  let maxRows = 0;

  tables.forEach(t => {
    const rows = t.querySelectorAll("tr");
    if (rows.length > maxRows) {
      maxRows = rows.length;
      targetTable = t;
    }
  });

  if (!targetTable) return { headers: [], rows: [] };

  let headers = [];
  const headerRow = targetTable.querySelector("thead tr") || targetTable.querySelector("tr");
  if (headerRow) {
    headers = Array.from(headerRow.querySelectorAll("th, td")).map(c => c.innerText.trim().replace(/\n/g, ' '));
  }

  const results = [];
  const rows = targetTable.querySelectorAll("tbody tr, tr");
  
  rows.forEach(row => {
    // Skip the header row if we are looping all trs
    if (row === headerRow) return;
    
    const cells = Array.from(row.querySelectorAll("td")).map(c => c.innerText.trim().replace(/\n/g, ' | ').replace(/\s+/g, ' '));
    if (cells.length > 0) results.push(cells);
  });

  return { headers: headers, rows: results };
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
