// PST Content Script
// Runs in every page. Detects if this is a known PMS web interface.

const PMS_SIGNATURES = [
  { name: 'VirtualRx',  selectors: ['#vrx-main', '.virtualrx-header', '[data-vrx]'] },
  { name: 'MedPro',     selectors: ['#medpro-app', '.medpro-nav', '[data-medpro]'] },
  { name: 'HealthTrac', selectors: ['#ht-root', '.healthtrac-logo', '[data-ht]'] },
  { name: 'Galen',      selectors: ['#galen-app', '.galenrx-header'] },
  { name: 'Bewell',     selectors: ['#bewell-root', '.bewell-sidebar'] },
];

function detectPMSPage() {
  for (const pms of PMS_SIGNATURES) {
    for (const sel of pms.selectors) {
      if (document.querySelector(sel)) {
        return pms.name;
      }
    }
  }

  // Fallback: check page title and URL for pharmacy keywords
  const hints = ['pharmacy', 'dispensary', 'rx', 'prescri', 'drug', 'medic'];
  const haystack = (document.title + window.location.href).toLowerCase();
  if (hints.some(h => haystack.includes(h))) {
    return 'Unknown PMS (web)';
  }

  return null;
}

const detected = detectPMSPage();
if (detected) {
  chrome.runtime.sendMessage({ type: 'PMS_PAGE_DETECTED', pms: detected, url: window.location.href });
}
