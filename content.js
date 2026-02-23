// ========================================
// Content Script (ISOLATED world)
// ========================================
// 通知権限のリクエストのみ担当。
// データへのアクセスやDOMの監視は一切行わない。

(() => {
  "use strict";

  if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      console.log(`[AI Notifier] 通知権限: ${perm}`);
    });
  }

  console.log("[AI Notifier] content.js loaded ✅");
})();
