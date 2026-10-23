/**
 * Manifest V3 Background Service Worker (v1.2.0)
 * Coordinates commands between Popup/SidePanel and the active WhatsApp Web tab.
 * Automatically cleans up any stale v1.0/v1.1 content scripts to prevent duplicate sending.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_SIDE_PANEL') {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {});
        }
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'WA_BULK_COMMAND') {
    handleBulkCommand(msg.action, msg.runId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve();
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.status === 'complete') {
          clearInterval(timer);
          resolve();
        }
      } catch (_) {
        clearInterval(timer);
        resolve();
      }
    }, 400);
  });
}

async function handleBulkCommand(action, runId) {
  let tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs || tabs.length === 0) {
    await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
    return {
      ok: false,
      error: 'Opened web.whatsapp.com in a new tab. Wait for chats to load, then click Start again.'
    };
  }

  const targetTab = tabs[0];
  await chrome.tabs.update(targetTab.id, { active: true });

  // Check if legacy v1.0 or v1.1 content scripts are still resident in memory on this tab
  try {
    const checkResults = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => Boolean(window.__WA_BULK_CUSTOM_SENDER_LOADED__ || window.__WA_BULK_CUSTOM_SENDER_V2__)
    });
    const hasLegacyScript = checkResults && checkResults[0] && checkResults[0].result;
    if (hasLegacyScript) {
      // Reload tab once to wipe legacy listeners and corrupted Lexical DOM nodes from v1.0
      await chrome.tabs.reload(targetTab.id);
      await waitForTabComplete(targetTab.id, 20000);
      await new Promise(r => setTimeout(r, 4000));
    }
  } catch (_) {}

  // Send versioned V3 action message; inject content.js if not yet loaded
  try {
    await chrome.tabs.sendMessage(targetTab.id, { type: 'WA_CONTENT_ACTION_V3', action, runId });
    return { ok: true };
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 400));
    await chrome.tabs.sendMessage(targetTab.id, { type: 'WA_CONTENT_ACTION_V3', action, runId });
    return { ok: true };
  }
}
