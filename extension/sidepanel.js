document.addEventListener("DOMContentLoaded", () => {
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");

  const btnTrainPage = document.getElementById("btnTrainPage");
  const btnScanInventory = document.getElementById("btnScanInventory");
  const btnStopScanning = document.getElementById("btnStopScanning");
  const btnConfirmInventory = document.getElementById("btnConfirmInventory");
  const btnConfirmSale = document.getElementById("btnConfirmSale");

  const trainingAlert = document.getElementById("trainingAlert");
  const s1Btns = document.getElementById("s1-btns");
  const s1ConfirmBtns = document.getElementById("s1-confirm-btns");
  
  const inventoryHead = document.getElementById("inventoryHead");
  const inventoryTable = document.getElementById("inventoryTable");
  const inventoryBody = document.getElementById("inventoryBody");

  const btnMapColumns = document.getElementById("btnMapColumns");
  const mappingUI = document.getElementById("mappingUI");
  const btnApplyMapping = document.getElementById("btnApplyMapping");
  const mapSelects = document.querySelectorAll(".map-select");
  
  let rawHeaders = [];
  let rawRows = [];
  let savedPaginationData = null;

  const saleTable = document.getElementById("saleTable");
  const saleBody = document.getElementById("saleBody");
  const listeningAlert = document.getElementById("listeningAlert");
  const saleSuccessAlert = document.getElementById("saleSuccessAlert");
  const s2ConfirmBtns = document.getElementById("s2-confirm-btns");

  // Step 1: Train Pagination
  btnTrainPage.addEventListener("click", () => {
    trainingAlert.style.display = "block";
    btnTrainPage.innerText = "Training...";
    btnTrainPage.disabled = true;

    // Send message to content script to enter "training mode"
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "START_TRAINING" });
    });
  });

  // Step 1: Scan Inventory
  btnScanInventory.addEventListener("click", () => {
    btnScanInventory.innerText = "Scanning...";
    btnScanInventory.style.display = "none";
    btnStopScanning.style.display = "inline-flex";
    
    // Tell content script to scrape the largest table and loop pagination
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "SCAN_INVENTORY", paginationData: savedPaginationData });
    });
  });

  btnStopScanning.addEventListener("click", () => {
    if (!confirm("Are you sure you want to stop scanning? The data collected so far will be saved.")) {
      return;
    }
    btnStopScanning.innerText = "Stopping...";
    
    // Send STOP request to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "STOP_SCANNING" });
    });

    // Fallback: If the content script was destroyed (e.g. by a full page reload),
    // it will never reply with INVENTORY_SCANNED. We forcefully reset the UI after 2s.
    setTimeout(() => {
      if (btnStopScanning.style.display !== "none") {
        console.warn("PST: Content script did not respond to STOP. Force resetting UI.");
        btnScanInventory.innerText = "Scan Current Page";
        btnScanInventory.style.display = "inline-flex";
        btnStopScanning.style.display = "none";
        s1Btns.style.display = "block"; // Restore the train pagination button
      }
    }, 2000);
  });

  // Handle messages from content script/network watcher
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "TRAINING_COMPLETE") {
      trainingAlert.className = "alert alert-success";
      trainingAlert.innerText = `Saved! Selector: ${msg.selector}`;
      btnTrainPage.innerText = "Pagination Trained";
      savedPaginationData = {
        selector: msg.selector,
        selectorText: msg.selectorText,
        selectorClass: msg.selectorClass
      };
    }

    if (msg.action === "SCRAPE_PROGRESS") {
      btnStopScanning.innerText = `Stop (Page ${msg.page} | ${msg.totalItems} items)`;
    }

    if (msg.action === "INVENTORY_SCANNED") {
      // If we already received data from another frame, and this frame is empty, ignore it
      if (rawRows && rawRows.length > 0 && (!msg.data.rows || msg.data.rows.length === 0)) {
        return;
      }
      
      btnScanInventory.innerText = "Scan Current Page";
      btnScanInventory.style.display = "inline-flex";
      btnStopScanning.style.display = "none";
      s1Btns.style.display = "none";
      trainingAlert.style.display = "none";
      
      rawHeaders = msg.data.headers || [];
      rawRows = msg.data.rows || [];

      renderInventoryPreview();
      
      s1ConfirmBtns.style.display = "flex";
    }

    if (msg.action === "SALE_DETECTED") {
      const listeningAlert = document.getElementById("listeningAlert");
      if (listeningAlert) listeningAlert.style.display = "none";
      
      const feed = document.getElementById("networkFeed");
      
      const card = document.createElement("div");
      card.style.background = "var(--surface)";
      card.style.border = "1px solid var(--border)";
      card.style.padding = "10px";
      card.style.borderRadius = "6px";
      card.style.fontSize = "12px";

      const parsed = msg.data.parsed || { items: [], source: 'unknown' };
      let endpointName = (msg.data.url || '').split('?')[0].split('/').pop();
      if (!endpointName || endpointName.length < 2) endpointName = "Endpoint";

      let innerHtml = `<p style="font-weight:600; margin-bottom:8px; color:var(--accent); word-break:break-all;">${msg.data.method} /${endpointName}</p>`;

      if (parsed.items.length > 0) {
        const badge = parsed.source === 'json' ? '🟢 JSON' : '🟡 HTML Receipt';
        innerHtml += `<p style="color:var(--muted); font-size:11px; margin-bottom:6px;">Detected via ${badge}</p>`;
        innerHtml += `<table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:11px;">`;
        innerHtml += `<tr style="color:var(--muted);"><th style="text-align:left; padding:4px;">Item</th><th style="text-align:right; padding:4px;">Qty</th><th style="text-align:right; padding:4px;">Price</th></tr>`;
        parsed.items.forEach(item => {
          innerHtml += `<tr style="border-top:1px solid var(--border);"><td style="padding:4px;">${item.name}</td><td style="text-align:right; padding:4px;">${item.qty}</td><td style="text-align:right; padding:4px;">${item.price}</td></tr>`;
        });
        innerHtml += `</table>`;
        innerHtml += `<button class="btn btn-primary btn-select-sale" style="width:100%; padding:6px;">✅ This is my receipt!</button>`;
      } else {
        const rawJson = JSON.stringify({ request: msg.data.reqBody, response: msg.data.payload }, null, 2);
        innerHtml += `<pre style="background:#000; color:#00ff00; padding:8px; border-radius:4px; max-height:80px; overflow:auto; margin-bottom:8px; font-family:monospace; font-size:10px;">${rawJson.substring(0, 600)}${rawJson.length > 600 ? '...' : ''}</pre>`;
        innerHtml += `<p style="color:var(--muted); font-size:11px; margin-bottom:8px;">Could not auto-detect items. Is this your sale?</p>`;
        innerHtml += `<button class="btn btn-secondary btn-select-sale" style="width:100%; padding:6px;">This is the final receipt!</button>`;
      }

      card.innerHTML = innerHtml;

      card.querySelector(".btn-select-sale").addEventListener("click", () => {
         step2.classList.remove("active");
         step2.classList.add("completed");
         step3.classList.add("active");
         
         // Mark setup as complete so background worker starts intercepting silently
         chrome.storage.local.set({ setupComplete: true });
         
         // Add sale to local backup queue and trigger sync
         chrome.storage.local.get({ unsyncedSales: [] }, (data) => {
           const newSale = {
             items: parsed.items,
             source: parsed.source,
             timestamp: Date.now()
           };
           chrome.storage.local.set({ unsyncedSales: [...data.unsyncedSales, newSale] }, () => {
             chrome.runtime.sendMessage({ action: 'TRIGGER_SYNC' });
           });
         });
         
         setTimeout(() => {
           window.close(); // self close
         }, 3000);
      });

      feed.prepend(card);
    }
  });

  // Step 1 -> Step 2
  btnConfirmInventory.addEventListener("click", () => {
    step1.classList.remove("active");
    step1.classList.add("completed");
    step2.classList.add("active");
    
    // Save inventory to local backup queue and trigger sync
    chrome.storage.local.set({ unsyncedInventory: rawRows }, () => {
      chrome.runtime.sendMessage({ action: 'TRIGGER_SYNC' });
    });
  });

  // Column Mapping Logic
  btnMapColumns.addEventListener("click", () => {
    mappingUI.style.display = "block";
    btnMapColumns.style.display = "none";

    let optionsHTML = '<option value="-1">-- Ignore --</option>';
    rawHeaders.forEach((h, i) => {
      optionsHTML += `<option value="${i}">Col ${i + 1}: ${h || 'Unknown'}</option>`;
    });
    
    // If headers are missing, create generic ones
    if (rawHeaders.length === 0 && rawRows.length > 0) {
      optionsHTML = '<option value="-1">-- Ignore --</option>';
      rawRows[0].forEach((_, i) => {
        optionsHTML += `<option value="${i}">Column ${i + 1}</option>`;
      });
    }

    mapSelects.forEach(select => {
      select.innerHTML = optionsHTML;
    });
  });

  btnApplyMapping.addEventListener("click", () => {
    mappingUI.style.display = "none";
    btnMapColumns.style.display = "inline-flex";
    
    const mapId = parseInt(document.getElementById("mapId").value);
    const mapName = parseInt(document.getElementById("mapName").value);
    const mapQty = parseInt(document.getElementById("mapQty").value);
    const mapPrice = parseInt(document.getElementById("mapPrice").value);

    // Overwrite rawRows with the newly mapped data so the backend receives it correctly
    rawRows = rawRows.map(row => {
      // Create a standard array format that the backend expects: [ID, Name, Qty, Price]
      return [
        (mapId >= 0 && row[mapId]) ? row[mapId] : '-',
        (mapName >= 0 && row[mapName]) ? row[mapName] : '-',
        (mapQty >= 0 && row[mapQty]) ? row[mapQty] : 0,
        (mapPrice >= 0 && row[mapPrice]) ? row[mapPrice] : 0
      ];
    }).filter(row => {
      // Filter out rows that are entirely empty or just dashed out (like header rows)
      return !(row[0] === '-' && row[1] === '-' && row[2] === 0 && row[3] === 0);
    });

    // Re-render table with mapped data
    inventoryHead.innerHTML = "<tr><th>S/N</th><th>Name</th><th>Qty</th><th>Price</th></tr>";
    inventoryBody.innerHTML = "";
    
    rawRows.slice(0, 3).forEach(row => {
      inventoryBody.innerHTML += `<tr>
        <td>${row[0]}</td>
        <td>${row[1]}</td>
        <td>${row[2]}</td>
        <td>${row[3]}</td>
      </tr>`;
    });
    
    if (rawRows.length > 3) {
      inventoryBody.innerHTML += `<tr><td colspan="4" style="text-align:center; color:var(--muted)">... and ${rawRows.length - 3} more rows</td></tr>`;
    }
  });

  function renderInventoryPreview() {
    inventoryHead.innerHTML = "<tr><th>S/N</th><th>Name</th><th>Qty</th><th>Price</th></tr>";
    if (rawHeaders && rawHeaders.length > 0) {
      inventoryHead.innerHTML = "<tr>" + rawHeaders.slice(0,4).map(h => `<th>${h}</th>`).join("") + "</tr>";
    }

    inventoryBody.innerHTML = "";
    rawRows.slice(0, 3).forEach(row => {
      inventoryBody.innerHTML += "<tr>" + row.slice(0,4).map(c => `<td>${c || '-'}</td>`).join("") + "</tr>";
    });
    
    if (rawRows.length > 3) {
      inventoryBody.innerHTML += `<tr><td colspan="4" style="text-align:center; color:var(--muted)">... and ${rawRows.length - 3} more rows</td></tr>`;
    }
    inventoryTable.style.display = "table";
  }

  // Redundant confirm button fallback
  btnConfirmSale.addEventListener("click", () => {
    step2.classList.remove("active");
    step2.classList.add("completed");
    step3.classList.add("active");
    
    chrome.storage.local.set({ setupComplete: true });
    
    setTimeout(() => {
      window.close();
    }, 3000);
  });
});
