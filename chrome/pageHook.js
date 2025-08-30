(function () {
  const POST_TYPE = "QA_ERROR_NOTIFIER_EVENT";

  function send(evt) {
    try {
      window.postMessage({ __qaen: true, type: POST_TYPE, payload: evt }, "*");
    } catch (_) {}
  }

  // Enhanced window.onerror handler with better cross-origin detection
  window.addEventListener("error", function (e) {
    const msg = e.message || "Script error";
    const src = e.filename || (e.target && e.target.src) || location.href;
    const line = e.lineno;
    const col = e.colno;
    const stack = e.error && e.error.stack;
    
    // Additional check for cross-origin errors with limited information
    const isCrossOrigin = src && src !== location.href && 
                         (new URL(src, location.href).origin !== location.origin);
    
    // Skip sending only if it's a cross-origin error with NO useful information at all
    if (isCrossOrigin && msg === "Script error" && !stack && !line && !col) {
      return;
    }
    
    send({ level: "error", kind: "window.onerror", msg, src, line, col, stack });
  }, true);

  // unhandledrejection
  window.addEventListener("unhandledrejection", function (e) {
    let msg = "Unhandled promise rejection";
    let stack;
    try {
      if (e.reason) {
        if (typeof e.reason === "string") msg = e.reason;
        else if (e.reason.message) msg = e.reason.message;
        if (e.reason.stack) stack = e.reason.stack;
      }
    } catch (_) {}
    send({ level: "error", kind: "unhandledrejection", msg, stack });
  }, true);

  // Wrappers for console.error / console.warn
  const wrap = (level) => {
    const orig = console[level];
    console[level] = function (...args) {
      try {
        const msg = args.map(a => {
          if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ""}`;
        try { return typeof a === "object" ? JSON.stringify(a) : String(a); }
          catch { return String(a); }
        }).join(" ");
        send({ level, kind: "console", msg });
      } catch (_) {}
      return orig.apply(this, args);
    };
  };
  wrap("error");
  wrap("warn");
})();
