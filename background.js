// ========================================
// Background Service Worker
// ========================================
// webRequest API でClaude APIレスポンス完了を検出し、
// タブが非アクティブなら通知を表示する。
// リクエスト/レスポンスの中身には一切アクセスしない。

// 進行中のストリーミングリクエストを追跡
// key: requestId, value: { tabId, startTime }
const pendingRequests = new Map();

// 通知IDとタブIDの紐付け
// key: notificationId, value: tabId
const notificationTabMap = new Map();

// --- completion リクエストの開始を検出 ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method === "POST" && details.url.includes("completion")) {
      console.log(`[Claude Notifier] リクエスト開始: ${details.requestId} (tab: ${details.tabId})`);
      pendingRequests.set(details.requestId, {
        tabId: details.tabId,
        startTime: Date.now(),
      });
    }
  },
  { urls: ["https://claude.ai/*"] }
);

// --- completion リクエストの完了を検出 ---
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;

    pendingRequests.delete(details.requestId);
    const elapsed = Date.now() - pending.startTime;
    console.log(
      `[Claude Notifier] リクエスト完了: ${details.requestId} (${elapsed}ms, tab: ${pending.tabId})`
    );

    // 短すぎるリクエストは無視（API応答ではなくメタデータ等の可能性）
    if (elapsed < 1000) {
      console.log("[Claude Notifier] 短時間リクエストのためスキップ");
      return;
    }

    checkTabAndNotify(pending.tabId);
  },
  { urls: ["https://claude.ai/*"] }
);

// --- リクエストエラー時のクリーンアップ ---
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    pendingRequests.delete(details.requestId);
  },
  { urls: ["https://claude.ai/*"] }
);

// --- タブの状態を確認して通知 ---
async function checkTabAndNotify(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const isActive = tab.active;

    if (isActive) {
      const window = await chrome.windows.get(tab.windowId);
      if (window.focused) {
        console.log("[Claude Notifier] タブがアクティブ → 通知スキップ");
        return;
      }
    }

    console.log(`[Claude Notifier] タブ非アクティブ → 通知送信 (tab: ${tabId})`);
    const notificationId = "claude-response-" + Date.now();

    // 通知IDとタブIDを紐付けて保存
    notificationTabMap.set(notificationId, tabId);

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Claude responded",
      message: "新しい回答が届いています。クリックして確認しましょう。",
      priority: 2,
    });
  } catch (e) {
    console.log(`[Claude Notifier] タブ状態確認エラー: ${e.message}`);
  }
}

// --- 通知クリックで元のタブにフォーカス ---
chrome.notifications.onClicked.addListener((notificationId) => {
  const tabId = notificationTabMap.get(notificationId);
  notificationTabMap.delete(notificationId);

  if (tabId != null) {
    // 記録されたタブIDに直接フォーカス
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        // タブが閉じられていた場合はフォールバック
        console.log("[Claude Notifier] 元のタブが見つかりません。Claudeタブを検索します。");
        focusFirstClaudeTab();
        return;
      }
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });
  } else {
    // 紐付けが見つからない場合はフォールバック
    focusFirstClaudeTab();
  }

  chrome.notifications.clear(notificationId);
});

// フォールバック: 最初に見つかったClaudeタブにフォーカス
function focusFirstClaudeTab() {
  chrome.tabs.query({ url: "https://claude.ai/*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  });
}

// --- 古いデータのクリーンアップ（5分以上経過） ---
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of pendingRequests) {
    if (now - data.startTime > 5 * 60 * 1000) {
      pendingRequests.delete(id);
    }
  }
  // 古い通知マッピングもクリーンアップ
  // notificationIdにタイムスタンプが含まれるので判定可能
  for (const [notifId] of notificationTabMap) {
    const match = notifId.match(/claude-response-(\d+)/);
    if (match && now - parseInt(match[1]) > 5 * 60 * 1000) {
      notificationTabMap.delete(notifId);
    }
  }
}, 60 * 1000);

console.log("[Claude Notifier] Background service worker 起動 ✅");
