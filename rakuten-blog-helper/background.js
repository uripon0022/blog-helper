const TRANSFER_KEY = "rbh-pending-transfer";
const APP_STATE_KEY = "rbh-app-state";
const DEFAULT_EDITOR_URL = "https://plaza.rakuten.co.jp/";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RBH_OPEN_APP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("app.html") }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "RBH_START_TRANSFER") {
    startTransfer(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function startTransfer(payload) {
  const targetUrl =
    payload?.editorUrl?.trim() ||
    payload?.settings?.rakutenEditorUrl?.trim() ||
    DEFAULT_EDITOR_URL;

  await chrome.storage.local.set({
    [TRANSFER_KEY]: {
      article: payload.article,
      transferMode: payload.transferMode,
      startedAt: new Date().toISOString()
    }
  });

  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  if (typeof tab.id !== "number") {
    throw new Error("投稿画面タブを開けませんでした。");
  }

  await waitForTabLoad(tab.id);
  const response = await sendTransferMessage(tab.id, {
    type: "RBH_FILL_ARTICLE",
    payload: {
      article: payload.article,
      transferMode: payload.transferMode
    }
  });

  if (response?.ok) {
    await chrome.storage.local.set({
      [APP_STATE_KEY]: {
        lastTransferResult: response.result,
        lastTransferAt: new Date().toISOString()
      }
    });
  }

  return {
    tabId: tab.id,
    url: targetUrl,
    pageResult: response?.result || null
  };
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("投稿画面の読み込み待機がタイムアウトしました。"));
    }, 30000);

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (info.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendTransferMessage(tabId, message) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await sleep(700);
    }
  }
  throw new Error(lastError?.message || "投稿画面へのメッセージ送信に失敗しました。");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
