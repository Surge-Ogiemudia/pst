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
    startAutoScrape(msg.paginationData);
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
    const data = scrapeInventory();
    if (currentPage === 1) headers = data.headers;
    
    // Check if the current page actually returned new data
    if (data.rows.length === 0) break;
    
    // Create a hash of the first 5 rows to detect if the table actually changed
    const currentRowHash = data.rows.slice(0, 5).map(r => r.join("|")).join("||");
    if (currentRowHash === lastRowHash && currentPage > 1) {
      break; // The page didn't actually change!
    }
    lastRowHash = currentRowHash;
    
    aggregatedRows = aggregatedRows.concat(data.rows);

    // Now that we have scraped this page, update the UI
    chrome.runtime.sendMessage({ action: "SCRAPE_PROGRESS", page: currentPage, totalItems: aggregatedRows.length });

    if (!paginationSelector) break; // Single page scan

    let nextBtn = document.querySelector(paginationSelector.selector);
    
    // Fallback: If strict selector fails, try to find it by exact class or text
    if (!nextBtn) {
      const allLinks = Array.from(document.querySelectorAll("a, button"));
      if (paginationSelector.selectorClass) {
        nextBtn = allLinks.find(el => el.className === paginationSelector.selectorClass);
      }
      if (!nextBtn && paginationSelector.selectorText) {
        nextBtn = allLinks.find(el => el.innerText && el.innerText.trim() === paginationSelector.selectorText);
      }
    }

    if (!nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('disabled')) {
      break;
    }

    nextBtn.click();
    
    // Dynamically wait for the table to change (up to 10 seconds)
    let waited = 0;
    let tableChanged = false;
    while (waited < 10000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      
      const checkData = scrapeInventory();
      if (checkData.rows.length > 0) {
        const checkHash = checkData.rows.slice(0, 5).map(r => r.join("|")).join("||");
        if (checkHash !== currentRowHash) {
          tableChanged = true;
          break;
        }
      }
    }

    if (!tableChanged) {
      break; // Page didn't change after 10 seconds, must be the end.
    }

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
  const selectorText = e.target.innerText ? e.target.innerText.trim() : "";
  const selectorClass = e.target.className && typeof e.target.className === 'string' ? e.target.className : "";
  
  chrome.runtime.sendMessage({ 
    action: "TRAINING_COMPLETE", 
    selector: selector,
    selectorText: selectorText,
    selectorClass: selectorClass
  });
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
    const reqBody = event.data.reqBody || {};
    const method = event.data.method || 'GET';
    const url = (event.data.url || '').toLowerCase();
    
    // We only care about POST or PUT requests for sales
    if (method !== 'POST' && method !== 'PUT') return;

    let items = [];
    
    if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object') {
      items = payload;
    } else if (payload && Array.isArray(payload.items)) {
      items = payload.items;
    } else if (Array.isArray(reqBody) && reqBody.length > 0 && typeof reqBody[0] === 'object') {
      items = reqBody;
    } else if (reqBody && Array.isArray(reqBody.items)) {
      items = reqBody.items;
    }

    const strPayload = JSON.stringify(payload || {}).toLowerCase();
    const strReq = JSON.stringify(reqBody || {}).toLowerCase();
    
    // Heuristic: Does this request look like a sale/cart/checkout?
    const looksLikeSale = 
      url.includes('sale') || url.includes('checkout') || url.includes('order') || url.includes('invoice') || url.includes('cart') || url.includes('pos') ||
      (strPayload.includes('qty') || strPayload.includes('quantity')) ||
      (strReq.includes('qty') || strReq.includes('quantity')) ||
      (strReq.includes('price') || strReq.includes('amount') || strReq.includes('total'));

    if (!looksLikeSale && items.length === 0) {
      return; // Ignore this POST request, it's probably analytics or a heartbeat
    }

    if (items.length > 0) {
      items = items.map(i => ({ name: i.name || i.id || "Item", qty: i.qty || i.quantity || 1, price: i.price || i.amount || 0 }));
    } else {
      // We know it looks like a sale, but we couldn't parse the array. Mock it.
      items = [{ name: "Mock Sale Item", qty: 1, price: (payload && (payload.total || payload.amount)) || (reqBody && (reqBody.total || reqBody.amount)) || "N/A" }];
    }

    chrome.runtime.sendMessage({ action: "SALE_DETECTED", data: { items } });
  }
});
