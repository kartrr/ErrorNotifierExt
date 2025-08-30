# QA Error Notifier

A simple Chrome extension that helps QA engineers and developers always be notified about JavaScript errors without keeping DevTools open.

Whenever an error happens on a page, you get a toast popup inside the site and a system notification in Chrome.

# Features

🔔 Automatic notifications for:
  - window.onerror (runtime JS errors)
  - unhandledrejection (unhandled Promise rejections)
  - console.error and console.warn

🪟 Toast popups inside the page (top-right corner).

💻 System notifications in Chrome, so you notice errors even if DevTools are closed.

♻️ Deduplication – no spam from the same error repeating (configurable time window).

👆 Click a notification → focuses the tab and automatically opens DevTools.

🧹 Noise filtering – ignores known noisy errors like "ResizeObserver loop limit exceeded" or blank "Script error" from cross-origin scripts.
