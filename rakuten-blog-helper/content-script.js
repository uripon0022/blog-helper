(function () {
  const OVERLAY_ID = "rbh-transfer-overlay";

  const SITE_PROFILE = {
    titleSelectors: [
      'textarea[name*="title" i]',
      'input[name*="title" i]',
      'textarea[id*="title" i]',
      'input[id*="title" i]',
      'input[type="text"]'
    ],
    bodySelectors: [
      'textarea[name*="body" i]',
      'textarea[name*="text" i]',
      'textarea[id*="body" i]',
      'textarea[id*="text" i]',
      '[contenteditable="true"]',
      ".ql-editor",
      ".editor",
      ".editable"
    ],
    categorySelectors: [
      'select[name*="category" i]',
      'select[id*="category" i]'
    ],
    themeSelectors: [
      'select[name*="theme" i]',
      'select[id*="theme" i]'
    ]
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RBH_FILL_ARTICLE") {
      return false;
    }

    handleFill(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        sendResponse({
          ok: true,
          result: {
            status: "error",
            errors: [error.message]
          }
        });
      });

    return true;
  });

  async function handleFill(payload) {
    const article = payload?.article;
    if (!article) {
      throw new Error("転送対象の記事データがありません。");
    }

    const docs = collectDocuments(document);
    const result = {
      status: "filled",
      errors: [],
      warnings: [],
      info: []
    };

    const titleTarget = findField(docs, SITE_PROFILE.titleSelectors);
    const bodyTarget = findField(docs, SITE_PROFILE.bodySelectors);

    if (!titleTarget) {
      result.errors.push("タイトル入力欄が見つかりませんでした。");
    }
    if (!bodyTarget) {
      result.errors.push("本文入力欄が見つかりませんでした。");
    }

    if (result.errors.length > 0) {
      result.status = "error";
      showOverlay(article, result);
      return result;
    }

    setFieldValue(titleTarget, article.title || "");
    setFieldValue(bodyTarget, article.composedBody || "");
    result.info.push("タイトルと本文を入力しました。");

    if (article.category) {
      const categoryTarget = findField(docs, SITE_PROFILE.categorySelectors);
      if (categoryTarget && applySelectByText(categoryTarget, article.category)) {
        result.info.push("カテゴリを選択しました。");
      } else {
        result.warnings.push("カテゴリは自動選択できなかったため、手動確認が必要です。");
      }
    }

    if (article.theme) {
      const themeTarget = findField(docs, SITE_PROFILE.themeSelectors);
      if (themeTarget && applySelectByText(themeTarget, article.theme)) {
        result.info.push("テーマを選択しました。");
      } else {
        result.warnings.push("テーマは自動選択できなかったため、手動確認が必要です。");
      }
    }

    if (payload.transferMode === "draft") {
      const draftButton = findDraftButton(docs);
      if (draftButton) {
        draftButton.click();
        result.status = "draft-attempted";
        result.info.push("下書き保存ボタンのクリックを試行しました。");
      } else {
        result.status = "filled";
        result.warnings.push("下書き保存ボタンが見つからなかったため、入力完了で停止しました。");
      }
    } else {
      result.info.push("保存直前で停止する設定のため、自動保存は行っていません。");
    }

    showOverlay(article, result);
    return result;
  }

  function collectDocuments(rootDocument) {
    const docs = [rootDocument];
    const queue = [rootDocument];

    while (queue.length > 0) {
      const current = queue.shift();
      const frames = Array.from(current.querySelectorAll("iframe"));
      for (const frame of frames) {
        try {
          if (frame.contentDocument) {
            docs.push(frame.contentDocument);
            queue.push(frame.contentDocument);
          }
        } catch (error) {
          // Ignore cross-origin frames.
        }
      }
    }

    return docs;
  }

  function findField(docs, selectors) {
    for (const doc of docs) {
      for (const selector of selectors) {
        const element = doc.querySelector(selector);
        if (element && isVisible(element)) {
          return element;
        }
      }
    }
    return null;
  }

  function setFieldValue(element, value) {
    if (!element) {
      return;
    }

    const tagName = element.tagName.toLowerCase();
    const isEditable = element.getAttribute("contenteditable") === "true";

    if (tagName === "input" || tagName === "textarea") {
      element.focus();
      element.value = value;
      dispatchStandardEvents(element);
      return;
    }

    if (isEditable || element.classList.contains("ql-editor")) {
      element.focus();
      element.textContent = value;
      dispatchStandardEvents(element);
    }
  }

  function dispatchStandardEvents(element) {
    ["input", "change", "keyup", "blur"].forEach((eventName) => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
  }

  function applySelectByText(select, desiredText) {
    if (!(select instanceof HTMLSelectElement)) {
      return false;
    }

    const normalizedDesired = normalizeText(desiredText);
    const option = Array.from(select.options).find((candidate) => {
      return normalizeText(candidate.textContent) === normalizedDesired;
    });

    if (!option) {
      return false;
    }

    select.value = option.value;
    dispatchStandardEvents(select);
    return true;
  }

  function findDraftButton(docs) {
    const preferredLabels = ["下書き保存", "下書き"];
    for (const doc of docs) {
      const candidates = Array.from(
        doc.querySelectorAll('button, input[type="button"], input[type="submit"], a')
      );
      for (const label of preferredLabels) {
        const button = candidates.find((candidate) => {
          const text = getElementText(candidate);
          return text.includes(label);
        });
        if (button && isVisible(button)) {
          return button;
        }
      }
    }
    return null;
  }

  function getElementText(element) {
    const value = element.value || "";
    const text = element.textContent || "";
    return normalizeText(`${value} ${text}`);
  }

  function normalizeText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function showOverlay(article, result) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      existing.remove();
    }

    const wrapper = document.createElement("section");
    wrapper.id = OVERLAY_ID;
    wrapper.style.position = "fixed";
    wrapper.style.right = "16px";
    wrapper.style.bottom = "16px";
    wrapper.style.zIndex = "2147483647";
    wrapper.style.width = "360px";
    wrapper.style.maxWidth = "calc(100vw - 32px)";
    wrapper.style.padding = "16px";
    wrapper.style.borderRadius = "18px";
    wrapper.style.boxShadow = "0 20px 50px rgba(0, 0, 0, 0.2)";
    wrapper.style.background = "#fffdf8";
    wrapper.style.color = "#2d2a26";
    wrapper.style.fontFamily = '"Hiragino Sans", "Yu Gothic", sans-serif';
    wrapper.style.lineHeight = "1.55";

    const tone =
      result.status === "error"
        ? "#b7381f"
        : result.status === "draft-attempted"
          ? "#236b34"
          : "#9a5c00";

    wrapper.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <div style="font-weight:700;font-size:15px;color:${tone};">楽天ブログ投稿ヘルパー</div>
          <div style="margin-top:4px;font-size:13px;">${escapeHtml(article.title || "無題の記事")}</div>
        </div>
        <button type="button" style="border:0;background:transparent;font-size:18px;cursor:pointer;color:#6b6257;">×</button>
      </div>
      <div style="margin-top:10px;font-size:12px;color:#6b6257;">状態: ${escapeHtml(mapStatus(result.status))}</div>
      ${renderList("エラー", result.errors, "#b7381f")}
      ${renderList("注意", result.warnings, "#9a5c00")}
      ${renderList("完了", result.info, "#236b34")}
      <div style="margin-top:12px;font-size:12px;color:#6b6257;">
        うまく入力できない場合は、楽天ブログの画面仕様変更やログイン状態を確認してください。
      </div>
    `;

    wrapper.querySelector("button").addEventListener("click", () => wrapper.remove());
    document.body.appendChild(wrapper);
  }

  function renderList(label, items, color) {
    if (!items || items.length === 0) {
      return "";
    }

    const children = items
      .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
      .join("");

    return `
      <div style="margin-top:12px;">
        <div style="font-weight:700;font-size:13px;color:${color};">${escapeHtml(label)}</div>
        <ul style="padding-left:18px;margin:6px 0 0;font-size:13px;">${children}</ul>
      </div>
    `;
  }

  function mapStatus(status) {
    const labels = {
      error: "入力失敗",
      filled: "入力完了",
      "draft-attempted": "下書き保存を試行"
    };
    return labels[status] || status;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
