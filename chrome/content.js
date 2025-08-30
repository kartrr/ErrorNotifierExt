// === Inject pageHook.js into the page context ===
(function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("pageHook.js");
  s.async = false;
  (document.documentElement || document.head || document.body).appendChild(s);
  s.onload = () => s.remove();
})();

// === Settings (loaded from storage) ===
let dedupeWindowSec = 10;             // tab-level deduplication
let noisyFilters = ["ResizeObserver loop limit exceeded"]; // example of noisy messages

chrome.storage.sync.get(
  { dedupeWindowSec: 10, noisyFilters },
  v => {
    const n = Number(v.dedupeWindowSec);
    if (!Number.isNaN(n) && n >= 0) dedupeWindowSec = n;
    if (Array.isArray(v.noisyFilters)) noisyFilters = v.noisyFilters.map(String);
  }
);

// === Toast UI ===
const TOAST_CONTAINER_ID = "__qaen_toasts__";
function ensureContainer() {
  let el = document.getElementById(TOAST_CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = TOAST_CONTAINER_ID;
    Object.assign(el.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: 2147483647,
      maxWidth: "420px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      pointerEvents: "none"
    });
    document.documentElement.appendChild(el);
  }
  return el;
}

function showToast({ title = "JS Error", body = "", level = "error" }) {
  const c = ensureContainer();
  const item = document.createElement("div");
  Object.assign(item.style, {
    background: level === "warn" ? "rgba(255,200,0,0.95)" : "rgba(255,64,64,0.95)",
    color: "#fff",
    borderRadius: "10px",
    padding: "10px 12px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: "13px",
    pointerEvents: "auto",
    cursor: "pointer",
  });
  item.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${title}</div>
                    <div style="white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto">${body}</div>`;
  item.addEventListener("click", () => c.removeChild(item));
  c.appendChild(item);
  requestAnimationFrame(() => {
    item.style.opacity = "1";
    item.style.transition = "opacity .3s";
  });
  setTimeout(() => { item.style.opacity = "0"; }, 5000);
  setTimeout(() => { try { c.removeChild(item); } catch {} }, 5400);
}

// === Per-tab deduplication ===
const dedupeCache = new Map(); // signature -> timestamp(ms)

function makeSignature(p) {
  const parts = [
    p.level || "error",
    p.kind || "",
    p.msg || "",
    p.stack || "",
    p.src || "",
    String(p.line || ""),
    String(p.col || "")
  ];
  return parts.join("§");
}

function shouldSuppress(sig) {
  if (dedupeWindowSec <= 0) return false;
  const now = Date.now();
  const last = dedupeCache.get(sig) || 0;
  if (dedupeCache.size > 200) {
    const cutoff = now - dedupeWindowSec * 1000 - 1000;
    for (const [k, t] of dedupeCache) if (t < cutoff) dedupeCache.delete(k);
  }
  if (now - last < dedupeWindowSec * 1000) return true;
  dedupeCache.set(sig, now);
  return false;
}

// === Helpers ===
function isCrossOrigin(u) {
  try { return new URL(u, location.href).origin !== location.origin; }
  catch { return false; }
}

// Enhanced detection of cross-origin "Script error" noise
function isBareCrossOriginScriptError(p) {
  const msg = p.msg || "";
  const looksScriptError = msg === "Script error" || msg === "Script error." || msg.includes("Script error");
  const noStack = !p.stack || p.stack.trim() === "";
  const noPos = !(p.line > 0) && !(p.col > 0);
  const cross = p.src && isCrossOrigin(p.src);
  
  // Additional checks for GitHub and common CDN patterns
  const isGitHubHovercard = p.src && p.src.includes("hovercards");
  const isCommonCDN = p.src && (
    p.src.includes("cdn.jsdelivr.net") ||
    p.src.includes("unpkg.com") ||
    p.src.includes("cdnjs.cloudflare.com") ||
    p.src.includes("ajax.googleapis.com")
  );
  
  // Only suppress if it's a generic "Script error" with no useful information
  return (p.kind === "window.onerror") && 
         looksScriptError && 
         noStack && 
         noPos && 
         (cross || isGitHubHovercard || isCommonCDN);
}

// Additional filter for common false positives - more conservative approach
function isLikelyFalsePositive(p) {
  const msg = p.msg || "";
  const src = p.src || "";
  
  // Only filter GitHub hovercards and citation widgets
  if (src.includes("hovercards") || src.includes("citation")) {
    // But only if it's a generic "Script error" without useful details
    return msg === "Script error" || msg === "Script error.";
  }
  
  // Common CDN errors that are usually not actionable - only generic ones
  if (src.includes("cdn.") && (msg === "Script error" || msg === "Script error.")) {
    return true;
  }
  
  // Social media widgets and embeds - only generic errors
  if ((src.includes("platform.twitter.com") || 
       src.includes("connect.facebook.net") ||
       src.includes("apis.google.com")) && 
      (msg === "Script error" || msg === "Script error.")) {
    return true;
  }
  
  return false;
}

// === Incoming events from pageHook ===
window.addEventListener("message", (e) => {
  const data = e.data;
  if (!data || !data.__qaen || data.type !== "QA_ERROR_NOTIFIER_EVENT") return;
  const p = data.payload || {};

  const body = [
    p.msg || "",
    p.src ? `\nsrc: ${p.src}` : "",
    (p.line || p.col) ? `\nline: ${p.line || "-"}, col: ${p.col || "-"}` : "",
    p.stack ? `\n\n${p.stack}` : ""
  ].join("");

  // Noise filters by substrings
  if (noisyFilters.some(n => n && body.includes(n))) return;

  // 🔇 Suppress only cross-domain "silent" Script errors
  if (isBareCrossOriginScriptError(p)) return;

  const sig = makeSignature(p);
  if (shouldSuppress(sig)) return; // tab-level deduplication

  // toast
  showToast({
    title: `> Error Notifier: ${p.msg || p.kind || "JS Error"}`,
    body,
    level: p.level || "error"
  });

  // To service worker — only errors (warnings without system notifications)
  if ((p.level || "error") === "error") {
    chrome.runtime.sendMessage({
      type: "QAEN_NOTIFY",
      url: location.href,
      title: p.msg || p.kind || "JS Error",
      body,
      signature: sig
    }).catch(() => {});
  }
}, false);
