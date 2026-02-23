// ========================================
// Background Service Worker
// ========================================
// webRequest API で各AIサービスのレスポンス完了を検出し、
// タブが非アクティブなら通知を表示する。
// リクエスト/レスポンスの中身には一切アクセスしない。

// --- サービス定義 ---
const SERVICES = [
  {
    name: "Claude",
    urlPatterns: ["https://claude.ai/*"],
    // completionエンドポイントへのPOSTを検出
    matchRequest: (url, method) =>
      method === "POST" && url.includes("completion"),
  },
  {
    name: "ChatGPT",
    urlPatterns: ["https://chatgpt.com/*"],
    // conversation エンドポイントへのPOSTを検出
    matchRequest: (url, method) =>
      method === "POST" &&
      (url.includes("/backend-api/conversation") ||
        url.includes("/backend-conversation")),
  },
  {
    name: "Gemini",
    urlPatterns: ["https://gemini.google.com/*"],
    // Gemini の streaming generate エンドポイントを検出
    matchRequest: (url, method) =>
      method === "POST" &&
      (url.includes("StreamGenerate") ||
        url.includes("generate") ||
        url.includes("assistant.lamda")),
  },
];

// 全サービスのURLパターン
const ALL_URL_PATTERNS = SERVICES.flatMap((s) => s.urlPatterns);

// リクエストからサービスを特定
function detectService(url, method) {
  for (const service of SERVICES) {
    if (service.matchRequest(url, method)) {
      return service.name;
    }
  }
  return null;
}

// 進行中のリクエストを追跡
// key: requestId, value: { tabId, startTime, serviceName }
const pendingRequests = new Map();

// 通知IDとタブIDの紐付け
// key: notificationId, value: tabId
const notificationTabMap = new Map();

// --- リクエスト開始を検出 ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const serviceName = detectService(details.url, details.method);
    if (serviceName) {
      console.log(
        `[AI Notifier] [${serviceName}] リクエスト開始: ${details.requestId} (tab: ${details.tabId})`
      );
      pendingRequests.set(details.requestId, {
        tabId: details.tabId,
        startTime: Date.now(),
        serviceName,
      });
    }
  },
  { urls: ALL_URL_PATTERNS }
);

// --- リクエスト完了を検出 ---
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;

    pendingRequests.delete(details.requestId);
    const elapsed = Date.now() - pending.startTime;
    console.log(
      `[AI Notifier] [${pending.serviceName}] リクエスト完了: ${details.requestId} (${elapsed}ms)`
    );

    // 短すぎるリクエストは無視
    if (elapsed < 1000) {
      console.log("[AI Notifier] 短時間リクエストのためスキップ");
      return;
    }

    checkTabAndNotify(pending.tabId, pending.serviceName);
  },
  { urls: ALL_URL_PATTERNS }
);

// --- リクエストエラー時のクリーンアップ ---
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    pendingRequests.delete(details.requestId);
  },
  { urls: ALL_URL_PATTERNS }
);

// --- タブの状態を確認して通知 ---
async function checkTabAndNotify(tabId, serviceName) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (tab.active) {
      const window = await chrome.windows.get(tab.windowId);
      if (window.focused) {
        console.log(`[AI Notifier] [${serviceName}] タブがアクティブ → 通知スキップ`);
        return;
      }
    }

    console.log(`[AI Notifier] [${serviceName}] タブ非アクティブ → 通知送信`);
    const notificationId = `ai-response-${Date.now()}`;

    notificationTabMap.set(notificationId, tabId);

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icon128.png",
      title: `${serviceName} responded`,
      message: "新しい回答が届いています。クリックして確認しましょう。",
      priority: 2,
    });
  } catch (e) {
    console.log(`[AI Notifier] タブ状態確認エラー: ${e.message}`);
  }
}

// --- 通知クリックで元のタブにフォーカス ---
chrome.notifications.onClicked.addListener((notificationId) => {
  const tabId = notificationTabMap.get(notificationId);
  notificationTabMap.delete(notificationId);

  if (tabId != null) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log("[AI Notifier] 元のタブが見つかりません");
        return;
      }
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });
  }

  chrome.notifications.clear(notificationId);
});

// --- 古いデータのクリーンアップ（5分以上経過） ---
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of pendingRequests) {
    if (now - data.startTime > 5 * 60 * 1000) {
      pendingRequests.delete(id);
    }
  }
  for (const [notifId] of notificationTabMap) {
    const match = notifId.match(/ai-response-(\d+)/);
    if (match && now - parseInt(match[1]) > 5 * 60 * 1000) {
      notificationTabMap.delete(notifId);
    }
  }
}, 60 * 1000);

console.log("[AI Notifier] Background service worker 起動 ✅");
