document.addEventListener("DOMContentLoaded", () => {
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");

  const btnTrainPage = document.getElementById("btnTrainPage");
  const btnScanInventory = document.getElementById("btnScanInventory");
  const btnConfirmInventory = document.getElementById("btnConfirmInventory");
  const btnConfirmSale = document.getElementById("btnConfirmSale");

  const trainingAlert = document.getElementById("trainingAlert");
  const s1Btns = document.getElementById("s1-btns");
  const s1ConfirmBtns = document.getElementById("s1-confirm-btns");
  
  const inventoryTable = document.getElementById("inventoryTable");
  const inventoryBody = document.getElementById("inventoryBody");

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
    
    // Tell content script to scrape the largest table
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "SCAN_INVENTORY" });
    });
  });

  // Handle messages from content script/network watcher
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "TRAINING_COMPLETE") {
      trainingAlert.className = "alert alert-success";
      trainingAlert.innerText = `Saved! Selector: ${msg.selector}`;
      btnTrainPage.innerText = "Pagination Trained";
    }

    if (msg.action === "INVENTORY_SCANNED") {
      btnScanInventory.innerText = "Scan Current Page";
      s1Btns.style.display = "none";
      trainingAlert.style.display = "none";
      
      // Populate Table Preview
      inventoryBody.innerHTML = "";
      msg.data.slice(0, 3).forEach(row => {
        inventoryBody.innerHTML += `<tr>
          <td>${row[0] || '-'}</td>
          <td>${row[1] || '-'}</td>
          <td>${row[2] || '-'}</td>
          <td>${row[3] || '-'}</td>
        </tr>`;
      });
      if (msg.data.length > 3) {
        inventoryBody.innerHTML += `<tr><td colspan="4" style="text-align:center; color:var(--muted)">... and ${msg.data.length - 3} more rows</td></tr>`;
      }
      
      inventoryTable.style.display = "table";
      s1ConfirmBtns.style.display = "flex";
    }

    if (msg.action === "SALE_DETECTED" && step2.classList.contains("active")) {
      listeningAlert.style.display = "none";
      saleSuccessAlert.style.display = "block";
      
      saleBody.innerHTML = "";
      msg.data.items.forEach(item => {
        saleBody.innerHTML += `<tr>
          <td>${item.name || item.id}</td>
          <td>${item.qty}</td>
          <td>${item.price}</td>
        </tr>`;
      });

      saleTable.style.display = "table";
      s2ConfirmBtns.style.display = "flex";
    }
  });

  // Step 1 -> Step 2
  btnConfirmInventory.addEventListener("click", () => {
    step1.classList.remove("active");
    step1.classList.add("completed");
    step2.classList.add("active");
    
    // Inject the network watcher into the page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["network.js"],
        world: "MAIN"
      });
    });
  });

  // Step 2 -> Step 3
  btnConfirmSale.addEventListener("click", () => {
    step2.classList.remove("active");
    step2.classList.add("completed");
    step3.classList.add("active");
    
    // Save everything to storage
    chrome.storage.local.set({ setupComplete: true });
    
    setTimeout(() => {
      window.close(); // self close
    }, 3000);
  });
});
