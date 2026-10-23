/**
 * WhatsApp Web Content Script (v1.2.0)
 * Fixes:
 * 1. Prevents 2x duplicate SMS sending via versioned WA_CONTENT_ACTION_V3 listener cleanup, activeRunId lock, and processedMap per-row guard.
 * 2. Fixes 2/5 failed contacts on chats with existing Drafts by selecting inside the inner <p> node and replacing in-place via execCommand('insertText').
 * 3. Strictly validates search matches (never clicks an unrelated validRows[0]) and falls back cleanly to Name or Direct Phone URL.
 */

(() => {
  // Remove any previous listener if content.js was re-injected in the same tab
  if (window.__WA_V3_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__WA_V3_LISTENER__);
    } catch (_) {}
  }

  const SELECTORS = {
    clearSearchButtons: [
      '#side button[aria-label="Cancel search"]',
      '#side button[aria-label="Clear search"]',
      '#side span[data-icon="x-alt"]'
    ],
    backSearchButtons: [
      '#side button[aria-label="Back"]',
      '#side span[data-icon="back"]'
    ],
    searchInputs: [
      '#side div[contenteditable="true"][data-tab="3"]',
      'div[contenteditable="true"][aria-label="Search input textbox"]',
      'div[contenteditable="true"][title="Search input textbox"]',
      'div[contenteditable="true"][aria-label="Search"]',
      'div[contenteditable="true"][data-lexical-editor="true"][data-tab="3"]',
      '#side div[contenteditable="true"]'
    ],
    searchResults: [
      '#pane-side div[role="listitem"]',
      '#pane-side div[role="row"]',
      'div[aria-label="Search results."] div[role="listitem"]',
      'div[aria-label="Chat list"] div[role="listitem"]'
    ],
    messageInputs: [
      '#main footer div[contenteditable="true"][data-tab="10"]',
      '#main footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"][data-lexical-editor="true"]',
      '#main footer div[contenteditable="true"]'
    ],
    sendButtons: [
      '#main footer button[aria-label="Send"]',
      '#main footer div[role="button"][aria-label="Send"]',
      '#main footer span[data-icon="send"]',
      '#main footer span[data-icon="wds-ic-send-filled"]',
      '#main footer [data-testid="compose-btn-send"]',
      '#main footer [data-testid="send"]'
    ]
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function queryFirst(selectorList, root = document) {
    for (const sel of selectorList) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function waitForSelector(selectorList, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = queryFirst(selectorList);
      if (found) return found;
      await sleep(200);
    }
    return null;
  }

  function realClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, rect.width / 2);
    const clientY = rect.top + Math.max(2, rect.height / 2);
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function getCleanText(el) {
    if (!el) return '';
    return String(el.innerText || el.textContent || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  /**
   * Focus a Lexical contenteditable and select all text inside its inner <p> (without selecting the <p> tag itself)
   * so existing drafts are overwritten cleanly in-place without breaking Lexical's DOM tree.
   */
  async function selectAllInsideLexical(el) {
    if (!el) return;
    realClick(el);
    el.focus();
    await sleep(80);

    const existing = getCleanText(el);
    if (!existing) {
      try {
        const targetNode = el.querySelector('p') || el;
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetNode);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      return;
    }

    // Select all inside the paragraph node and delete existing draft text safely
    try {
      const targetNode = el.querySelector('p') || el;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(targetNode);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      document.execCommand('selectAll', false, null);
    }
    await sleep(50);
    document.execCommand('delete', false, null);
    await sleep(80);
  }

  /**
   * Type text ONCE into a WhatsApp Web Lexical editor.
   * Uses synchronous document.execCommand('insertText') primary path and only falls back if editor is still empty.
   */
  async function typeIntoLexical(selectorList, text, allowMultiline = false) {
    let el = queryFirst(selectorList);
    if (!el) return false;
    const cleanTarget = String(text || '').trim();
    if (!cleanTarget) return false;

    await selectAllInsideLexical(el);

    // Re-query in case clearing a draft caused React to re-render the inner node
    el = queryFirst(selectorList) || el;
    el.focus();
    await sleep(60);

    // Primary Stage: document.execCommand('insertText')
    const lines = allowMultiline ? String(text).split(/\r?\n/) : [cleanTarget];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0) {
        document.execCommand('insertText', false, line);
      }
      if (allowMultiline && i < lines.length - 1) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true
          })
        );
        await sleep(50);
      }
    }

    await sleep(220);
    el = queryFirst(selectorList) || el;

    // Fallback Stage: ONLY if editor is still completely empty
    if (!getCleanText(el)) {
      try {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', allowMultiline ? String(text) : cleanTarget);
        const pasteEvt = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        el.dispatchEvent(pasteEvt);
        await sleep(250);
      } catch (_) {}
    }

    el = queryFirst(selectorList) || el;
    return getCleanText(el).length > 0;
  }

  function pressEnter(el) {
    if (!el) return;
    el.focus();
    ['keydown', 'keypress', 'keyup'].forEach(eventType => {
      el.dispatchEvent(
        new KeyboardEvent(eventType, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );
    });
  }

  function interpolate(template, row) {
    const lowerMap = {};
    Object.keys(row || {}).forEach(k => {
      lowerMap[k.toLowerCase().trim()] = row[k];
    });
    return String(template || '')
      .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, key) => {
        const k = key.toLowerCase().trim();
        return lowerMap[k] !== undefined ? lowerMap[k] : m;
      })
      .replace(/\{\s*([^{}]+?)\s*\}/g, (m, key) => {
        const k = key.toLowerCase().trim();
        return lowerMap[k] !== undefined ? lowerMap[k] : m;
      });
  }

  function formatPhoneWithCountryCode(raw, countryCode = '880') {
    let digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    const cc = String(countryCode || '').replace(/[^\d]/g, '');
    if (!cc) return digits;

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }
    if (digits.startsWith(cc)) {
      return digits;
    }
    if (digits.startsWith('0')) {
      return cc + digits.slice(1);
    }
    if (digits.length >= 9 && digits.length <= 10) {
      return cc + digits;
    }
    return digits;
  }

  /**
   * Clear any text in the search box without unmounting the search input
   */
  async function clearSearchBoxText() {
    const xBtn = queryFirst(SELECTORS.clearSearchButtons);
    if (xBtn) {
      const clickable = xBtn.closest('button, [role="button"]') || xBtn;
      realClick(clickable);
      await sleep(300);
    }
    const searchBox = queryFirst(SELECTORS.searchInputs);
    if (searchBox && getCleanText(searchBox)) {
      await selectAllInsideLexical(searchBox);
      await sleep(150);
    }
  }

  async function closeSearchDrawerIfOpen() {
    await clearSearchBoxText();
    const backBtn = queryFirst(SELECTORS.backSearchButtons);
    if (backBtn) {
      const clickable = backBtn.closest('button, [role="button"]') || backBtn;
      realClick(clickable);
      await sleep(300);
    }
  }

  async function waitForModalToResolve(timeoutMs = 9000) {
    const start = Date.now();
    await sleep(450);
    while (Date.now() - start < timeoutMs) {
      const modal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
      if (!modal) return true;

      const modalText = (modal.innerText || '').toLowerCase();
      if (
        modalText.includes('invalid') ||
        modalText.includes("isn't on whatsapp") ||
        modalText.includes('not on whatsapp') ||
        modalText.includes('no results')
      ) {
        const okBtn = modal.querySelector('button, div[role="button"]');
        if (okBtn) realClick(okBtn);
        await sleep(300);
        return false;
      }
      await sleep(250);
    }
    return true;
  }

  /**
   * Step 2 & Step 3: Search contact in WhatsApp Web search bar and open the matched chat.
   * Returns true ONLY if a matching contact was found and opened.
   */
  async function searchAndOpenChat(queryText) {
    if (!queryText) return false;

    await clearSearchBoxText();

    const searchBox = await waitForSelector(SELECTORS.searchInputs, 8000);
    if (!searchBox) return false;

    const typed = await typeIntoLexical(SELECTORS.searchInputs, queryText, false);
    if (!typed) return false;

    // Wait for WhatsApp Web to filter results in #pane-side
    await sleep(1500);

    const paneSide = document.querySelector('#pane-side');
    if (paneSide) {
      const paneText = (paneSide.innerText || '').toLowerCase();
      if (
        paneText.includes('no results found') ||
        paneText.includes('no chats, contacts or messages found')
      ) {
        await closeSearchDrawerIfOpen();
        return false;
      }
    }

    // Method A: Press Enter directly in searchBox (WhatsApp Web's native shortcut to open the top matched search result)
    const activeSearchBox = queryFirst(SELECTORS.searchInputs) || searchBox;
    pressEnter(activeSearchBox);
    await sleep(1100);

    // When Enter opens a matched contact in WhatsApp Web, WhatsApp automatically clears the search input!
    const currentSearchBox = queryFirst(SELECTORS.searchInputs);
    if (!currentSearchBox || !getCleanText(currentSearchBox)) {
      const msgBox = await waitForSelector(SELECTORS.messageInputs, 5000);
      await sleep(500);
      return Boolean(msgBox);
    }

    // Method B: If searchBox still has text, look for a STRICTLY matching row in #pane-side (never click an unmatched row!)
    const queryLower = queryText.toLowerCase().trim();
    const queryDigits = queryText.replace(/[^\d]/g, '');

    for (const sel of SELECTORS.searchResults) {
      const rows = Array.from(document.querySelectorAll(sel));
      const matchedRow = rows.find(row => {
        const txt = (row.innerText || '').trim();
        if (!txt) return false;
        if (/^(chats|contacts|contacts on whatsapp|other contacts|messages|no results)/i.test(txt) && txt.split('\n').length === 1) {
          return false;
        }
        if (row.getBoundingClientRect().height <= 28) return false;
        const rLower = txt.toLowerCase();
        const rDigits = txt.replace(/[^\d]/g, '');
        return rLower.includes(queryLower) || (queryDigits.length >= 6 && rDigits.includes(queryDigits.slice(-8)));
      });

      if (matchedRow) {
        const targetCell = matchedRow.querySelector('div[role="gridcell"]') || matchedRow.firstElementChild || matchedRow;
        realClick(targetCell);
        await sleep(1200);
        await closeSearchDrawerIfOpen();
        const msgBox = await waitForSelector(SELECTORS.messageInputs, 5000);
        await sleep(500);
        return Boolean(msgBox);
      }
    }

    await closeSearchDrawerIfOpen();
    return false;
  }

  /**
   * Direct Phone Chat Navigation (works for any phone number, saved or unsaved)
   */
  async function openChatByDirectPhone(phoneStr, countryCode = '880') {
    const cleanPhone = formatPhoneWithCountryCode(phoneStr, countryCode);
    if (!cleanPhone || cleanPhone.length < 7) return false;

    await closeSearchDrawerIfOpen();

    const a = document.createElement('a');
    a.href = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();

    await sleep(1300);
    const modalOk = await waitForModalToResolve(9000);
    if (!modalOk) {
      return false;
    }

    const msgBox = await waitForSelector(SELECTORS.messageInputs, 7000);
    await sleep(600);
    return Boolean(msgBox);
  }

  /**
   * Step 4 & Step 5: Type customized message ONCE and click Send ONCE
   */
  async function typeAndSendMessage(customMessage) {
    let msgBox = await waitForSelector(SELECTORS.messageInputs, 7000);
    if (!msgBox) {
      throw new Error('Chat message input box not found.');
    }

    await sleep(400);

    // Step 4: Type customized message into #main footer composer (overwriting any existing Draft cleanly)
    const typedOk = await typeIntoLexical(SELECTORS.messageInputs, customMessage, true);
    msgBox = queryFirst(SELECTORS.messageInputs);

    if (!typedOk || !getCleanText(msgBox)) {
      throw new Error('Could not type message into WhatsApp chat box.');
    }

    // Wait for Send icon button to activate
    await sleep(650);

    // Step 5: Send ONCE, then wait 1000ms and verify the composer cleared
    for (let attempt = 0; attempt < 2; attempt++) {
      msgBox = queryFirst(SELECTORS.messageInputs);
      if (!getCleanText(msgBox)) {
        return true;
      }

      const sendTarget = queryFirst(SELECTORS.sendButtons);
      if (sendTarget && attempt === 0) {
        const btn = sendTarget.closest('button, div[role="button"]') || sendTarget;
        realClick(btn);
      } else {
        pressEnter(msgBox);
      }

      await sleep(1000);
      msgBox = queryFirst(SELECTORS.messageInputs);
      if (!getCleanText(msgBox)) {
        return true;
      }
    }

    throw new Error('Message was typed, but WhatsApp did not send it.');
  }

  async function updateCampaignState(patch, logText = null, logLevel = 'info') {
    const data = await chrome.storage.local.get('waBulkState');
    const st = (data && data.waBulkState) ? data.waBulkState : {};
    Object.assign(st, patch);
    if (logText) {
      st.logs = st.logs || [];
      st.logs.push({
        time: new Date().toLocaleTimeString(),
        text: logText,
        level: logLevel
      });
    }
    await chrome.storage.local.set({ waBulkState: st });
    updateFloatingPill(st);
    return st;
  }

  function makePillDraggable(pill) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    pill.addEventListener('mousedown', (e) => {
      if (e.target && e.target.id === 'wa-bulk-pill-close') return;
      isDragging = true;
      pill.style.cursor = 'grabbing';
      const rect = pill.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;

      // Switch from bottom/right anchoring to explicit left/top positioning
      pill.style.bottom = 'auto';
      pill.style.right = 'auto';
      pill.style.left = `${initialLeft}px`;
      pill.style.top = `${initialTop}px`;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const rect = pill.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const newLeft = Math.min(maxLeft, Math.max(8, initialLeft + dx));
      const newTop = Math.min(maxTop, Math.max(8, initialTop + dy));
      pill.style.left = `${newLeft}px`;
      pill.style.top = `${newTop}px`;
      window.__WA_PILL_POS__ = { left: newLeft, top: newTop };
    });

    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      pill.style.cursor = 'grab';
    });
  }

  function updateFloatingPill(st) {
    let pill = document.getElementById('wa-bulk-floating-pill');
    if (!st || st.campaignStatus === 'idle') {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'wa-bulk-floating-pill';
      const savedPos = window.__WA_PILL_POS__;
      pill.style.cssText = [
        'position:fixed',
        savedPos ? `left:${savedPos.left}px` : 'right:24px',
        savedPos ? `top:${savedPos.top}px` : 'bottom:72px',
        'z-index:999999',
        'background:#075e54',
        'color:#fff',
        'padding:9px 13px',
        'border-radius:10px',
        'font-family:system-ui,sans-serif',
        'font-size:12px',
        'box-shadow:0 4px 14px rgba(0,0,0,0.28)',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'cursor:grab',
        'user-select:none',
        'max-width:calc(100vw - 32px)',
        'white-space:nowrap'
      ].join(';');
      pill.title = 'Drag with mouse to move';

      const textSpan = document.createElement('span');
      textSpan.id = 'wa-bulk-pill-text';
      pill.appendChild(textSpan);

      const closeBtn = document.createElement('button');
      closeBtn.id = 'wa-bulk-pill-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Hide status bar';
      closeBtn.style.cssText = [
        'background:rgba(255,255,255,0.18)',
        'border:none',
        'color:#fff',
        'width:18px',
        'height:18px',
        'border-radius:50%',
        'font-size:13px',
        'line-height:1',
        'cursor:pointer',
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'margin-left:4px'
      ].join(';');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pill.remove();
      });
      pill.appendChild(closeBtn);

      document.body.appendChild(pill);
      makePillDraggable(pill);
    }
    const total = (st.rows || []).length;
    const done = (st.sentCount || 0) + (st.failedCount || 0);
    const labelEl = pill.querySelector('#wa-bulk-pill-text') || pill;
    labelEl.textContent = `⠿ WA Bulk Sender: ${st.campaignStatus.toUpperCase()} (${done}/${total} | Sent: ${st.sentCount || 0}, Failed: ${st.failedCount || 0})`;
  }

  /**
   * Step 6: Single-instance locked loop across all contacts
   */
  async function runBulkLoop(expectedRunId) {
    if (window.__WA_LOOP_LOCK__) return;
    window.__WA_LOOP_LOCK__ = true;
    window.__WA_ACTIVE_RUN_ID__ = expectedRunId;

    try {
      // Wait for WhatsApp Web's main sidebar to be ready (in case tab just reloaded)
      await waitForSelector(SELECTORS.searchInputs, 15000);
      await sleep(500);

      while (true) {
        const data = await chrome.storage.local.get('waBulkState');
        const st = data ? data.waBulkState : null;
        if (!st || st.campaignStatus !== 'running') {
          break;
        }
        if (expectedRunId && st.runId && st.runId !== expectedRunId) {
          break;
        }

        const rows = st.rows || [];
        const idx = st.currentIndex || 0;
        if (idx >= rows.length) {
          await updateCampaignState(
            { campaignStatus: 'completed' },
            `All ${rows.length} contacts processed (Sent: ${st.sentCount}, Failed: ${st.failedCount}).`,
            'ok'
          );
          break;
        }

        // Per-contact atomic guard so row[idx] can NEVER be processed twice
        const processedMap = st.processedMap || {};
        if (processedMap[idx]) {
          await updateCampaignState({ currentIndex: idx + 1 });
          continue;
        }
        processedMap[idx] = true;
        await updateCampaignState({ processedMap });

        const row = rows[idx];
        const primaryTarget = String(row[st.searchCol] || '').trim();
        const fallbackTarget = st.fallbackCol ? String(row[st.fallbackCol] || '').trim() : '';
        const displayLabel = primaryTarget || fallbackTarget || `Row #${idx + 1}`;
        const customSms = interpolate(st.template, row);
        const countryCode = st.countryCode !== undefined ? st.countryCode : '880';

        try {
          let chatOpened = false;
          const mode = st.searchMode || 'auto';
          const primaryDigits = primaryTarget.replace(/[^\d]/g, '');
          const fallbackDigits = fallbackTarget.replace(/[^\d]/g, '');
          const phoneCandidate = primaryDigits.length >= 7 ? primaryTarget : (fallbackDigits.length >= 7 ? fallbackTarget : '');

          if (mode === 'direct_phone') {
            chatOpened = await openChatByDirectPhone(phoneCandidate || primaryTarget || fallbackTarget, countryCode);
          } else {
            // Try searching in Search Bar first
            if (primaryTarget) {
              chatOpened = await searchAndOpenChat(primaryTarget);
            }
            if (!chatOpened && fallbackTarget) {
              chatOpened = await searchAndOpenChat(fallbackTarget);
            }
            // If not opened via search bar and mode is 'auto', open directly via phone number link
            if (!chatOpened && mode === 'auto' && phoneCandidate) {
              chatOpened = await openChatByDirectPhone(phoneCandidate, countryCode);
            }
          }

          if (!chatOpened) {
            throw new Error(`Could not open chat for "${displayLabel}"`);
          }

          await typeAndSendMessage(customSms);

          const latestData = await chrome.storage.local.get('waBulkState');
          const latestSt = (latestData && latestData.waBulkState) || st;
          await updateCampaignState(
            {
              currentIndex: idx + 1,
              sentCount: (latestSt.sentCount || 0) + 1
            },
            `[${idx + 1}/${rows.length}] Sent to ${displayLabel}`,
            'ok'
          );
        } catch (contactErr) {
          const latestData = await chrome.storage.local.get('waBulkState');
          const latestSt = (latestData && latestData.waBulkState) || st;
          await updateCampaignState(
            {
              currentIndex: idx + 1,
              failedCount: (latestSt.failedCount || 0) + 1
            },
            `[${idx + 1}/${rows.length}] Failed for ${displayLabel}: ${contactErr.message}`,
            'err'
          );
        }

        const nextIdx = idx + 1;
        if (nextIdx < rows.length) {
          const minMs = Math.max(2000, (st.minDelay || 4) * 1000);
          const maxMs = Math.max(minMs, (st.maxDelay || 7) * 1000);
          const waitMs = Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
          await sleep(waitMs);
        }
      }
    } finally {
      window.__WA_LOOP_LOCK__ = false;
    }
  }

  window.__WA_V3_LISTENER__ = (msg, sender, sendResponse) => {
    if (msg && msg.type === 'WA_CONTENT_ACTION_V3') {
      if (msg.action === 'START' || msg.action === 'RESUME') {
        runBulkLoop(msg.runId || '');
      }
      sendResponse({ ok: true });
      return false;
    }
  };

  chrome.runtime.onMessage.addListener(window.__WA_V3_LISTENER__);

  // Auto-resume if tab was reloaded by background.js at the start of a running campaign
  chrome.storage.local.get('waBulkState').then((data) => {
    const st = data && data.waBulkState;
    if (st && st.campaignStatus === 'running' && (st.currentIndex || 0) === 0 && Object.keys(st.processedMap || {}).length === 0) {
      runBulkLoop(st.runId || '');
    }
  }).catch(() => {});
})();
