// === GLOBAL DEDUPE (background, cross-tab) ===
let dedupeWindowSecGlobal = 10;
chrome.storage.sync.get({ dedupeWindowSecGlobal: 10 }, v => {
  const n = Number(v.dedupeWindowSecGlobal);
  if (!Number.isNaN(n) && n >= 0) dedupeWindowSecGlobal = n;
});

const globalDedupe = new Map(); // signature -> timestamp(ms)
function shouldSuppressGlobal(sig) {
  if (!sig || dedupeWindowSecGlobal <= 0) return false;
  const now = Date.now();
  const last = globalDedupe.get(sig) || 0;
  if (globalDedupe.size > 2000) {
    const cutoff = now - dedupeWindowSecGlobal * 1000 - 1000;
    for (const [k, t] of globalDedupe) if (t < cutoff) globalDedupe.delete(k);
  }
  if (now - last < dedupeWindowSecGlobal * 1000) return true;
  globalDedupe.set(sig, now);
  return false;
}

// === Map notificationId -> tabId ===
const notifToTab = new Map();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "QAEN_NOTIFY") {
    if (shouldSuppressGlobal(msg.signature)) return;

    const title = msg.title || "JS Error";
    const body = (msg.body || "").slice(0, 4000);
    const ctx = msg.url || (sender && sender.url) || "";

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png", // place 128x128 icon or change the path
      title,
      message: body,
      contextMessage: ctx ? safeHost(ctx) : "",
      priority: 2
    }, (notificationId) => {
      if (sender && sender.tab && sender.tab.id != null) {
        notifToTab.set(notificationId, { tabId: sender.tab.id });
      }
    });
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const rec = notifToTab.get(notificationId);
  notifToTab.delete(notificationId);
  if (!rec) return;

  try {
    const tab = await chrome.tabs.get(rec.tabId);
    await chrome.tabs.update(rec.tabId, { active: true });
    if (tab && tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {}

  // Ask content script to open DevTools (via debugger;)
  try {
    await chrome.tabs.sendMessage(rec.tabId, { type: "QAEN_OPEN_DEVTOOLS" });
  } catch {}
});

function safeHost(u) {
  try { return new URL(u).host; } catch { return ""; }
}
