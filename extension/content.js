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

// =============================================
// Universal Sale Data Parser
// =============================================
function parseSaleData(reqBody, payload) {
  // Strategy 1: Find a JSON array of line items anywhere in the response
  const jsonItems = findItemsArray(payload) || findItemsArray(reqBody);
  if (jsonItems && jsonItems.length > 0) {
    return { items: jsonItems, source: 'json' };
  }

  // Strategy 2: Find an HTML string anywhere in the response and parse its table
  const htmlItems = findHtmlTableItems(payload) || findHtmlTableItems(reqBody);
  if (htmlItems && htmlItems.length > 0) {
    return { items: htmlItems, source: 'html' };
  }

  return { items: [], source: 'unknown' };
}

// Recursively search an object for all arrays that look like line items and return the best one
function findItemsArray(rootObj) {
  const candidates = [];
  
  function search(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 15) return;
    
    if (Array.isArray(obj)) {
      if (obj.length > 0 && typeof obj[0] === 'object') {
        const score = scoreLineItemArray(obj);
        if (score > 0) candidates.push({ array: obj, score });
      }
    } else {
      for (const key of Object.keys(obj)) {
        search(obj[key], depth + 1);
      }
    }
  }
  
  search(rootObj);
  
  if (candidates.length === 0) return null;
  
  // Sort by score descending and return the best match
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].array.map(normalizeItem);
}

const NAME_KEYS   = ['name','product','product_name','item','item_name','description','drug','medicine'];
const QTY_KEYS    = ['qty','quantity','units','count','amount_qty','quantity_sold'];
const PRICE_KEYS  = ['price','unit_price','rate','cost','selling_price','retail_price','subtotal','sub_total','amount','total'];

function scoreLineItemArray(arr) {
  // Sample up to 3 items in the array to determine its quality
  const sample = arr.slice(0, 3);
  let totalScore = 0;
  
  for (const obj of sample) {
    if (!obj || typeof obj !== 'object') continue;
    const keys = Object.keys(obj).map(k => k.toLowerCase());
    const hasName  = NAME_KEYS.some(k  => keys.some(key => key.includes(k)));
    const hasQty   = QTY_KEYS.some(k   => keys.some(key => key.includes(k)));
    const hasPrice = PRICE_KEYS.some(k => keys.some(key => key.includes(k)));
    
    let score = 0;
    if (hasName) score += 2;
    if (hasQty) score += 1;
    if (hasPrice) score += 1;
    
    // Penalty if name is just an ID (if we can detect it)
    if (hasName && !hasPrice && !hasQty) score -= 1;
    
    if (score >= 2) totalScore += score;
  }
  return totalScore;
}

function normalizeItem(obj) {
  const keys = Object.keys(obj);
  const findVal = (candidates, preferNumber = false) => {
    let fallback = undefined;
    
    // Check exact matches first, then substring matches
    for (const exact of [true, false]) {
      for (const c of candidates) {
        const match = keys.find(k => exact ? k.toLowerCase() === c : k.toLowerCase().includes(c));
        if (match !== undefined && obj[match] !== null && obj[match] !== undefined) {
          const val = obj[match];
          
          if (preferNumber) {
            const strVal = String(val).replace(/[^0-9.-]+/g, "");
            if (strVal === "") continue; // Reject pure strings like "retail"
            
            const numVal = parseFloat(strVal);
            if (!isNaN(numVal)) {
              if (numVal > 0) return val; // Found a non-zero number, perfect match!
              if (fallback === undefined) fallback = val; // Save 0 as a fallback
            }
          } else {
            if (String(val).trim() !== "") return val;
          }
        }
      }
    }
    return fallback !== undefined ? fallback : '-';
  };
  return {
    name:  findVal(NAME_KEYS, false),
    qty:   findVal(QTY_KEYS, true),
    price: findVal(PRICE_KEYS, true)
  };
}

// Find any HTML string in the object and extract its largest table
function findHtmlTableItems(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string' && obj.includes('<table')) {
    return extractTableFromHtml(obj);
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const result = findHtmlTableItems(obj[key], depth + 1);
      if (result) return result;
    }
  }
  return null;
}

function extractTableFromHtml(htmlStr) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    if (!tables.length) return null;
    
    // Pick the largest table
    const table = tables.reduce((a, b) => 
      b.querySelectorAll('tr').length > a.querySelectorAll('tr').length ? b : a
    );
    
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText || th.textContent).map(h => h.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr, tr')).map(tr => {
      return Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || td.textContent).trim().replace(/\s+/g, ' '));
    }).filter(r => r.length > 1);
    
    if (!rows.length) return null;
    
    // Map rows using detected headers
    return rows.map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || '-'; });
      const normalized = normalizeItem(obj);
      // If normalizeItem couldn't match, just use positional
      if (normalized.name === '-' && normalized.qty === '-') {
        return { name: row[0] || '-', qty: row[1] || '-', price: row[2] || '-' };
      }
      return normalized;
    });
  } catch(e) {
    return null;
  }
}

async function startAutoScrape(paginationSelector) {
  isScraping = true;
  stopRequested = false;
  
  let aggregatedRows = [];
  let headers = [];
  let currentPage = 1;
  let lastRowHash = "";

  try {
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

    let nextBtn = null;
    try {
      nextBtn = document.querySelector(paginationSelector.selector);
    } catch(e) {
      console.warn("PST: Invalid primary selector, falling back.", e);
    }
    
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
    while (waited < 10000 && !stopRequested) {
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
  } catch (e) {
    console.error("PST Auto Scrape Error:", e);
  } finally {
    isScraping = false;
    chrome.runtime.sendMessage({ action: "INVENTORY_SCANNED", data: { headers: headers, rows: aggregatedRows } });
  }
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
  // Strategy A: HTML <table> based layout
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

  if (targetTable && maxRows > 1) {
    let headers = [];
    const headerRow = targetTable.querySelector("thead tr") || targetTable.querySelector("tr");
    if (headerRow) {
      headers = Array.from(headerRow.querySelectorAll("th, td")).map(c => c.innerText.trim().replace(/\n/g, ' '));
    }
    const results = [];
    const rows = targetTable.querySelectorAll("tbody tr, tr");
    rows.forEach(row => {
      if (row === headerRow) return;
      const cells = Array.from(row.querySelectorAll("td")).map(c => c.innerText.trim().replace(/\n/g, ' | ').replace(/\s+/g, ' '));
      if (cells.length > 0) results.push(cells);
    });
    if (results.length > 0) return { headers, rows: results };
  }

  // Strategy B: Card/grid layout (no table found — look for repeated product card pattern)
  // Find groups of sibling elements that repeat with similar structure
  const candidates = Array.from(document.querySelectorAll('[class*="product"], [class*="item"], [class*="card"], [class*="catalog"], [class*="grid"]'));
  
  // Pick the container with the most direct children that look like cards
  let bestContainer = null;
  let bestCount = 0;
  candidates.forEach(el => {
    const children = Array.from(el.children);
    if (children.length > bestCount && children.length > 2) {
      bestCount = children.length;
      bestContainer = el;
    }
  });

  if (bestContainer && bestCount > 2) {
    const results = [];
    Array.from(bestContainer.children).forEach(card => {
      const text = card.innerText || card.textContent || '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length >= 1) results.push(lines);
    });
    if (results.length > 0) {
      return { headers: ['Product Info'], rows: results };
    }
  }

  return { headers: [], rows: [] };
}

// 4. Listen for network events from injected script

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  
  if (event.data.type && event.data.type === "PST_NETWORK_INTERCEPT") {
    const payload = event.data.payload;
    const reqBody = event.data.reqBody || {};
    const method = event.data.method || 'GET';
    const url = (event.data.url || '').toLowerCase();
    
    if (method !== 'POST' && method !== 'PUT') return;

    const strPayload = JSON.stringify(payload || {}).toLowerCase();
    const strReq = JSON.stringify(reqBody || {}).toLowerCase();
    
    const looksLikeSale = 
      url.includes('sale') || url.includes('checkout') || url.includes('order') || 
      url.includes('invoice') || url.includes('cart') || url.includes('pos') ||
      url.includes('payment') || url.includes('bill') || url.includes('receipt') ||
      strPayload.includes('receipt') || strPayload.includes('invoice') ||
      strReq.includes('qty') || strReq.includes('quantity') ||
      strReq.includes('price') || strReq.includes('amount');

    if (!looksLikeSale) return;

    const parsed = parseSaleData(reqBody, payload);
    
    chrome.runtime.sendMessage({ 
      action: "SALE_DETECTED", 
      data: { 
        url: event.data.url,
        method: method,
        reqBody: reqBody,
        payload: payload,
        parsed: parsed
      } 
    });
  }
});

