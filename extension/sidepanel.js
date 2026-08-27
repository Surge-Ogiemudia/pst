// PST Side Panel Logic
// Bridges the AI chat (Vercel) with the local connector (port 3002)

const PST_API = 'https://pst-murex-chi.vercel.app/api/chat';
const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('input');
const sendBtn    = document.getElementById('sendBtn');
const statusBar  = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const headerDot        = document.getElementById('headerDot');
const headerStatusText = document.getElementById('headerStatusText');
const connectorBanner  = document.getElementById('connectorBanner');
const connectorBannerText = document.getElementById('connectorBannerText');

const history = [];

const SYSTEM_PROMPT = `You are PST Assistant — the onboarding AI agent for PST (Pharmacy Stack Terminal Connector). 
Your job is to help pharmacy staff connect their existing PMS (Pharmacy Management Software) to the Pharmacy Stack ecosystem.

You must:
1. First ask which PMS software they use (give options: VirtualRx, MedPro, HealthTrac, Galen, Bewell, or Other).
2. Based on their answer, explain that you are now configuring the connector for their specific software.
3. Tell them their inventory is being synced and ask them to confirm one sample product looks correct.
4. Once they confirm, tell them setup is complete and they are now live on Pharmacy Stack.
5. After setup, answer any pharmacy-related questions they have about their data.

Be warm, concise, and non-technical. Never use jargon. Use short sentences.
When giving PMS options, put them on a new line each prefixed with a bullet.
If they say something is wrong, apologize and ask them to clarify what PMS they actually use.
Always end your first message by listing PMS options.`;

// ── STATUS HELPERS ──────────────────────────────────────────────
function setStatus(text) {
  if (text) { statusBar.style.display = 'flex'; statusText.textContent = text; }
  else statusBar.style.display = 'none';
}

function setConnectorBanner(status, pms) {
  connectorBanner.classList.remove('hidden', 'connected', 'disconnected');
  if (status === 'connected') {
    connectorBanner.classList.add('connected');
    connectorBannerText.textContent = pms
      ? `✓ Connector running · Detected: ${pms.name}`
      : '✓ Desktop Connector is running';
    headerDot.className = 'status-dot online';
    headerStatusText.textContent = 'Online — Ready to set up';
  } else {
    connectorBanner.classList.add('disconnected');
    connectorBannerText.textContent = '⚠ Desktop Connector not running — download it at pst-murex-chi.vercel.app';
    headerDot.className = 'status-dot offline';
    headerStatusText.textContent = 'Connector offline';
  }
}

// ── MESSAGE RENDERING ────────────────────────────────────────────
function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function addMessage(role, content, chips = []) {
  const row = document.createElement('div');
  row.className = `msg-row ${role === 'user' ? 'user' : 'ai'}`;

  if (role === 'ai') {
    const av = document.createElement('div');
    av.className = 'msg-avatar'; av.textContent = 'P';
    row.appendChild(av);
  }

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  bubble.innerHTML = content
    .replace(/\n/g, '<br/>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  if (chips.length > 0) {
    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    chips.forEach(label => {
      const chip = document.createElement('div');
      chip.className = 'chip'; chip.textContent = label;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        setTimeout(() => sendMessage(label), 250);
      });
      chipRow.appendChild(chip);
    });
    bubble.appendChild(chipRow);
  }

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollBottom();
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'typing-indicator'; row.id = 'typingRow';
  const av = document.createElement('div');
  av.className = 'msg-avatar'; av.textContent = 'P';
  const tb = document.createElement('div'); tb.className = 'typing-bubble';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div'); d.className = 'typing-dot'; tb.appendChild(d);
  }
  row.appendChild(av); row.appendChild(tb);
  messagesEl.appendChild(row); scrollBottom();
}

function hideTyping() { const el = document.getElementById('typingRow'); if (el) el.remove(); }

function parseChips(text) {
  const lines = text.split('\n');
  const chips = [], cleanLines = [];
  lines.forEach(line => {
    const t = line.trim();
    if (t.startsWith('•') || t.startsWith('-') || t.startsWith('*')) {
      const chip = t.replace(/^[•\-*]\s*/, '').trim();
      if (chip) chips.push(chip);
    } else { cleanLines.push(line); }
  });
  return { text: cleanLines.join('\n').trim(), chips };
}

// ── SEND MESSAGE ─────────────────────────────────────────────────
async function sendMessage(text) {
  const msg = text || inputEl.value.trim();
  if (!msg) return;
  inputEl.value = ''; inputEl.style.height = 'auto';
  addMessage('user', msg);
  history.push({ role: 'user', content: msg });

  showTyping(); sendBtn.disabled = true;
  setStatus('PST Assistant is thinking...');

  try {
    const res = await fetch(PST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, systemPrompt: SYSTEM_PROMPT })
    });
    const data = await res.json();
    hideTyping(); setStatus(null);

    const aiText = data.reply || "Sorry, I couldn't process that.";
    const { text: cleanText, chips } = parseChips(aiText);
    history.push({ role: 'model', content: aiText });
    addMessage('ai', cleanText, chips);

    // If the AI confirmed a PMS, tell the connector to extract data
    if (aiText.toLowerCase().includes('sync') || aiText.toLowerCase().includes('configur')) {
      setStatus('Syncing your inventory with the connector...');
      triggerExtraction();
    }
  } catch {
    hideTyping(); setStatus(null);
    addMessage('ai', "I'm having trouble connecting. Please check your internet connection.");
  }

  sendBtn.disabled = false;
}

// ── CONNECTOR TRIGGER ────────────────────────────────────────────
function triggerExtraction() {
  chrome.runtime.sendMessage({ type: 'SCAN_PMS' }, (res) => {
    if (res?.success && res.data?.detected) {
      const pmsName = res.data.pms.name;
      chrome.runtime.sendMessage({ type: 'EXTRACT_DATA', pms: pmsName }, (extractRes) => {
        if (extractRes?.success) {
          const count = extractRes.data.total;
          setStatus(null);
          addMessage('ai', `✓ Done! I found **${count} products** in your ${pmsName} database. They're now synced to Pharmacy Stack.`);
        } else {
          setStatus(null);
        }
      });
    } else {
      setStatus(null);
    }
  });
}

// ── INIT ─────────────────────────────────────────────────────────
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 90) + 'px';
});
sendBtn.addEventListener('click', () => sendMessage());

// Check connector status on load
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  setConnectorBanner(res?.connectorStatus || 'disconnected', res?.detectedPMS);
});

// Boot the AI greeting
window.addEventListener('load', async () => {
  showTyping(); setStatus('Connecting to PST Assistant...');
  try {
    const res = await fetch(PST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: [], systemPrompt: SYSTEM_PROMPT, boot: true })
    });
    const data = await res.json();
    hideTyping(); setStatus(null);
    const { text: cleanText, chips } = parseChips(data.reply || '');
    history.push({ role: 'user', content: 'Start the onboarding. Greet the pharmacist warmly and ask which PMS software they use. List the options as bullet points prefixed with •' });
    history.push({ role: 'model', content: data.reply });
    addMessage('ai', cleanText, chips);
  } catch {
    hideTyping(); setStatus(null);
    addMessage('ai', "Hi! I'm your PST setup assistant. Which pharmacy software are you currently using?", [
      'VirtualRx', 'MedPro', 'HealthTrac', 'Galen', 'Bewell', 'Other'
    ]);
  }
});
