// Background service worker

interface ExtensionState {
  enabled: boolean;
  antiClipping: boolean;
}

const DEFAULT_STATE: ExtensionState = {
  enabled: true,
  antiClipping: true,
};

// Initialize state on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get("state");
  if (!data.state) {
    await chrome.storage.local.set({ state: DEFAULT_STATE });
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NN_GET_STATE") {
    chrome.storage.local.get("state").then((data) => {
      sendResponse({ state: data.state ?? DEFAULT_STATE });
    });
    return true;
  }

  if (message.type === "NN_SET_STATE") {
    const newState = message.state as ExtensionState;
    chrome.storage.local.set({ state: newState }).then(() => {
      // Broadcast to all YouTube tabs
      chrome.tabs.query({ url: "*://*.youtube.com/*" }).then((tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "NN_SET_STATE",
              state: newState,
            }).catch(() => { /* tab may not have content script */ });
          }
        }
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "NN_GET_STATS") {
    // Forward to the active YouTube tab
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (tab?.id && tab.url?.includes("youtube.com")) {
        chrome.tabs.sendMessage(tab.id, { type: "NN_GET_STATS" })
          .then((response) => {
            sendResponse(response);
          })
          .catch(() => {
            sendResponse({ stats: null, state: null });
          });
      } else {
        sendResponse({ stats: null, state: null });
      }
    });
    return true;
  }

  if (message.type === "NN_STATS_UPDATE") {
    // Cache latest stats (from content script periodic updates)
    chrome.storage.session?.set?.({
      latestStats: message.stats,
      latestState: message.state,
    });
    return false;
  }

  return false;
});
