/**
 * Popup & SidePanel Controller for WA Bulk Custom Sender (v1.2.0)
 */

const state = {
  headers: [],
  rows: [],
  fileName: '',
  searchCol: '',
  fallbackCol: '',
  template: 'Hello {{name}}, hope you are doing well!',
  searchMode: 'auto',
  countryCode: '880',
  minDelay: 4,
  maxDelay: 7,
  campaignStatus: 'idle', // idle | running | paused | completed | stopped
  runId: '',
  processedMap: {},
  currentIndex: 0,
  sentCount: 0,
  failedCount: 0,
  logs: []
};

const els = {
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  fileLabel: document.getElementById('fileLabel'),
  fileSummary: document.getElementById('fileSummary'),
  contactCountBadge: document.getElementById('contactCountBadge'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  searchColSelect: document.getElementById('searchColSelect'),
  fallbackColSelect: document.getElementById('fallbackColSelect'),
  placeholderBar: document.getElementById('placeholderBar'),
  messageTemplate: document.getElementById('messageTemplate'),
  messagePreview: document.getElementById('messagePreview'),
  searchModeSelect: document.getElementById('searchModeSelect'),
  countryCodeInput: document.getElementById('countryCodeInput'),
  minDelayInput: document.getElementById('minDelayInput'),
  maxDelayInput: document.getElementById('maxDelayInput'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusLabel: document.getElementById('statusLabel'),
  progressCounter: document.getElementById('progressCounter'),
  progressFill: document.getElementById('progressFill'),
  sentCount: document.getElementById('sentCount'),
  failedCount: document.getElementById('failedCount'),
  exportLogBtn: document.getElementById('exportLogBtn'),
  logContainer: document.getElementById('logContainer'),
  openSidePanelBtn: document.getElementById('openSidePanelBtn')
};

function interpolateMessage(template, row) {
  if (!row) return template;
  const lowerMap = {};
  Object.keys(row).forEach(k => {
    lowerMap[k.toLowerCase().trim()] = row[k];
  });

  return template
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
      const k = key.toLowerCase().trim();
      return lowerMap[k] !== undefined ? lowerMap[k] : match;
    })
    .replace(/\{\s*([^{}]+?)\s*\}/g, (match, key) => {
      const k = key.toLowerCase().trim();
      return lowerMap[k] !== undefined ? lowerMap[k] : match;
    });
}

function guessColumns(headers) {
  const phoneRegex = /phone|number|mobile|whatsapp|contact|cell|tel/i;
  const nameRegex = /name|customer|client|person|full_name/i;

  let primary = headers.find(h => phoneRegex.test(h)) || headers.find(h => nameRegex.test(h)) || headers[0] || '';
  let fallback = headers.find(h => h !== primary && (nameRegex.test(h) || phoneRegex.test(h))) || '';
  return { primary, fallback };
}

function renderColumnsAndPlaceholders() {
  if (state.headers.length === 0 || state.rows.length === 0) {
    els.fileSummary.classList.add('hidden');
    els.fileLabel.textContent = 'Click or drop Excel (.xlsx) / CSV file';
    els.placeholderBar.innerHTML = '<span class="placeholder-hint">Upload a file to click &amp; insert column placeholders</span>';
    els.messagePreview.textContent = 'Upload a file to preview customized message...';
    els.startBtn.disabled = true;
    return;
  }

  els.fileSummary.classList.remove('hidden');
  els.fileLabel.textContent = state.fileName || 'Contacts Loaded';
  els.contactCountBadge.textContent = `${state.rows.length} contacts loaded`;
  els.startBtn.disabled = false;

  els.searchColSelect.innerHTML = '';
  els.fallbackColSelect.innerHTML = '<option value="">(None)</option>';

  state.headers.forEach(h => {
    const opt1 = document.createElement('option');
    opt1.value = h;
    opt1.textContent = h;
    els.searchColSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = h;
    opt2.textContent = h;
    els.fallbackColSelect.appendChild(opt2);
  });

  if (!state.searchCol || !state.headers.includes(state.searchCol)) {
    const guessed = guessColumns(state.headers);
    state.searchCol = guessed.primary;
    state.fallbackCol = guessed.fallback;
  }

  els.searchColSelect.value = state.searchCol;
  els.fallbackColSelect.value = state.fallbackCol || '';

  els.placeholderBar.innerHTML = '';
  state.headers.forEach(h => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `{{${h}}}`;
    chip.title = `Insert {{${h}}} into message`;
    chip.addEventListener('click', () => {
      insertAtCursor(els.messageTemplate, `{{${h}}}`);
      state.template = els.messageTemplate.value;
      updatePreview();
      saveStateToStorage();
    });
    els.placeholderBar.appendChild(chip);
  });

  updatePreview();
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const val = textarea.value;
  textarea.value = val.slice(0, start) + text + val.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

function updatePreview() {
  if (state.rows.length === 0) {
    els.messagePreview.textContent = 'Upload a file to preview customized message...';
    return;
  }
  const sampleRow = state.rows[0];
  els.messagePreview.textContent = interpolateMessage(els.messageTemplate.value, sampleRow);
}

function renderStatusUI() {
  const total = state.rows.length;
  const done = state.sentCount + state.failedCount;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  els.progressCounter.textContent = `${done} / ${total}`;
  els.progressFill.style.width = `${pct}%`;
  els.sentCount.textContent = String(state.sentCount);
  els.failedCount.textContent = String(state.failedCount);

  if (state.logs && state.logs.length > 0) {
    els.exportLogBtn.classList.remove('hidden');
  } else {
    els.exportLogBtn.classList.add('hidden');
  }

  const isRunning = state.campaignStatus === 'running';
  const isPaused = state.campaignStatus === 'paused';

  els.startBtn.classList.toggle('hidden', isRunning || isPaused);
  els.pauseBtn.classList.toggle('hidden', !isRunning);
  els.resumeBtn.classList.toggle('hidden', !isPaused);
  els.stopBtn.classList.toggle('hidden', !(isRunning || isPaused));

  if (state.campaignStatus === 'running') {
    els.statusLabel.textContent = `Sending (${Math.min(state.currentIndex + 1, total)} of ${total})...`;
  } else if (state.campaignStatus === 'paused') {
    els.statusLabel.textContent = 'Paused — Click Resume to continue';
  } else if (state.campaignStatus === 'completed') {
    els.statusLabel.textContent = `Completed! Sent ${state.sentCount} of ${total}`;
  } else if (state.campaignStatus === 'stopped') {
    els.statusLabel.textContent = 'Campaign stopped by user';
  }

  els.logContainer.innerHTML = '';
  (state.logs || []).slice(-60).forEach(entry => {
    const div = document.createElement('div');
    div.className = `log-item ${entry.level || ''}`;
    div.textContent = `[${entry.time}] ${entry.text}`;
    els.logContainer.appendChild(div);
  });
  els.logContainer.scrollTop = els.logContainer.scrollHeight;
}

async function handleFileUpload(file) {
  if (!file) return;
  try {
    els.statusLabel.textContent = `Parsing ${file.name}...`;
    const parsed = await FileParser.parseFile(file);
    if (!parsed.headers.length || !parsed.rows.length) {
      els.statusLabel.textContent = 'Error: File has no valid header/data rows.';
      return;
    }
    state.headers = parsed.headers;
    state.rows = parsed.rows;
    state.fileName = file.name;
    const guessed = guessColumns(parsed.headers);
    state.searchCol = guessed.primary;
    state.fallbackCol = guessed.fallback;
    state.campaignStatus = 'idle';
    state.runId = '';
    state.processedMap = {};
    state.currentIndex = 0;
    state.sentCount = 0;
    state.failedCount = 0;
    state.logs = [{
      time: new Date().toLocaleTimeString(),
      text: `Loaded ${parsed.rows.length} contacts from ${file.name} (Columns: ${parsed.headers.join(', ')})`,
      level: 'ok'
    }];

    await saveStateToStorage();
    renderColumnsAndPlaceholders();
    renderStatusUI();
  } catch (err) {
    els.statusLabel.textContent = `Parse error: ${err.message}`;
  }
}

async function saveStateToStorage() {
  state.template = els.messageTemplate.value;
  state.searchCol = els.searchColSelect.value || state.searchCol;
  state.fallbackCol = els.fallbackColSelect.value || '';
  state.searchMode = els.searchModeSelect.value;
  state.countryCode = (els.countryCodeInput.value || '').replace(/[^\d]/g, '');
  state.minDelay = Math.max(2, parseInt(els.minDelayInput.value || '4', 10));
  state.maxDelay = Math.max(state.minDelay, parseInt(els.maxDelayInput.value || '7', 10));
  await chrome.storage.local.set({ waBulkState: state });
}

async function loadStateFromStorage() {
  const data = await chrome.storage.local.get('waBulkState');
  if (data && data.waBulkState) {
    Object.assign(state, data.waBulkState);
    els.messageTemplate.value = state.template || 'Hello {{name}}, hope you are doing well!';
    els.searchModeSelect.value = state.searchMode || 'auto';
    els.countryCodeInput.value = state.countryCode !== undefined ? state.countryCode : '880';
    els.minDelayInput.value = state.minDelay || 4;
    els.maxDelayInput.value = state.maxDelay || 7;
  }
  renderColumnsAndPlaceholders();
  renderStatusUI();
}

async function sendCommandToWhatsApp(action) {
  await saveStateToStorage();
  chrome.runtime.sendMessage({ type: 'WA_BULK_COMMAND', action, runId: state.runId }, (resp) => {
    if (chrome.runtime.lastError) {
      els.statusLabel.textContent = 'Error communicating with background worker.';
      return;
    }
    if (resp && !resp.ok) {
      els.statusLabel.textContent = resp.error || 'Please open https://web.whatsapp.com first!';
    }
  });
}

els.fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFileUpload(e.target.files[0]);
  }
});

els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
});

els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

els.clearDataBtn.addEventListener('click', async () => {
  state.headers = [];
  state.rows = [];
  state.fileName = '';
  state.campaignStatus = 'idle';
  state.runId = '';
  state.processedMap = {};
  state.currentIndex = 0;
  state.sentCount = 0;
  state.failedCount = 0;
  state.logs = [];
  els.fileInput.value = '';
  await saveStateToStorage();
  renderColumnsAndPlaceholders();
  renderStatusUI();
});

els.searchColSelect.addEventListener('change', saveStateToStorage);
els.fallbackColSelect.addEventListener('change', saveStateToStorage);
els.searchModeSelect.addEventListener('change', saveStateToStorage);
els.countryCodeInput.addEventListener('change', saveStateToStorage);
els.minDelayInput.addEventListener('change', saveStateToStorage);
els.maxDelayInput.addEventListener('change', saveStateToStorage);

els.messageTemplate.addEventListener('input', () => {
  updatePreview();
  saveStateToStorage();
});

els.startBtn.addEventListener('click', async () => {
  if (!state.rows.length) return;
  state.campaignStatus = 'running';
  state.runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  state.processedMap = {};
  state.currentIndex = 0;
  state.sentCount = 0;
  state.failedCount = 0;
  await sendCommandToWhatsApp('START');
  renderStatusUI();
});

els.pauseBtn.addEventListener('click', async () => {
  state.campaignStatus = 'paused';
  await sendCommandToWhatsApp('PAUSE');
  renderStatusUI();
});

els.resumeBtn.addEventListener('click', async () => {
  state.campaignStatus = 'running';
  if (!state.runId) {
    state.runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
  await sendCommandToWhatsApp('RESUME');
  renderStatusUI();
});

els.stopBtn.addEventListener('click', async () => {
  state.campaignStatus = 'stopped';
  state.runId = '';
  await sendCommandToWhatsApp('STOP');
  renderStatusUI();
});

els.exportLogBtn.addEventListener('click', () => {
  const csvLines = ['Time,Status,Details'];
  (state.logs || []).forEach(l => {
    const safeText = String(l.text || '').replace(/"/g, '""');
    csvLines.push(`"${l.time}","${l.level || 'info'}","${safeText}"`);
  });
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp_bulk_report_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

els.openSidePanelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.waBulkState && changes.waBulkState.newValue) {
    Object.assign(state, changes.waBulkState.newValue);
    renderStatusUI();
  }
});

loadStateFromStorage();
