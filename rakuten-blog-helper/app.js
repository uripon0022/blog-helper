const STORAGE_KEY = "rbh-db";
const APP_STATE_KEY = "rbh-app-state";
const ARTICLE_STATUSES = ["作成中", "未転送", "転送済み", "公開済み", "修正予定"];

const formFields = {
  title: document.getElementById("article-title"),
  body: document.getElementById("article-body"),
  category: document.getElementById("article-category"),
  theme: document.getElementById("article-theme"),
  scheduledAt: document.getElementById("article-scheduled-at"),
  status: document.getElementById("article-status"),
  prRequired: document.getElementById("article-pr-required"),
  prText: document.getElementById("article-pr-text"),
  introText: document.getElementById("article-intro-text"),
  outroText: document.getElementById("article-outro-text"),
  affiliateLink: document.getElementById("article-affiliate-link"),
  productName: document.getElementById("article-product-name"),
  memo: document.getElementById("article-memo"),
  summary: document.getElementById("article-summary"),
  searchDescription: document.getElementById("article-search-description"),
  snsDescription: document.getElementById("article-sns-description")
};

const templateFields = {
  name: document.getElementById("template-name"),
  defaultCategory: document.getElementById("template-default-category"),
  defaultTheme: document.getElementById("template-default-theme"),
  prText: document.getElementById("template-pr-text"),
  introText: document.getElementById("template-intro-text"),
  headingTemplate: document.getElementById("template-heading-template"),
  outroText: document.getElementById("template-outro-text"),
  fixedLink: document.getElementById("template-fixed-link"),
  note: document.getElementById("template-note")
};

const ui = {
  articleList: document.getElementById("article-list"),
  templateList: document.getElementById("template-list"),
  preview: document.getElementById("preview"),
  validationList: document.getElementById("validation-list"),
  transferLog: document.getElementById("transfer-log"),
  saveIndicator: document.getElementById("save-indicator"),
  articleStatusFilter: document.getElementById("article-status-filter"),
  settingsEditorUrl: document.getElementById("settings-editor-url"),
  settingsTransferMode: document.getElementById("settings-transfer-mode")
};

const state = {
  db: null,
  selectedArticleId: null,
  selectedTemplateId: null,
  dirty: false
};

bootstrap().catch((error) => {
  console.error(error);
  ui.transferLog.textContent = `初期化に失敗しました: ${error.message}`;
});

async function bootstrap() {
  populateStatusOptions();
  bindEvents();

  state.db = await loadDb();
  state.selectedArticleId = state.db.activeArticleId || state.db.articles[0]?.id || null;
  state.selectedTemplateId = state.db.templates[0]?.id || null;

  if (!state.selectedArticleId) {
    const article = createArticle();
    state.db.articles.unshift(article);
    state.selectedArticleId = article.id;
    state.db.activeArticleId = article.id;
    await persistDb();
  }

  renderAll();
  await renderLastTransferLog();
}

function populateStatusOptions() {
  formFields.status.innerHTML = ARTICLE_STATUSES.map(
    (status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`
  ).join("");

  ui.articleStatusFilter.innerHTML += ARTICLE_STATUSES.map(
    (status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`
  ).join("");
}

function bindEvents() {
  document.getElementById("new-article-button").addEventListener("click", onNewArticle);
  document.getElementById("save-article-button").addEventListener("click", onSaveArticle);
  document.getElementById("duplicate-article-button").addEventListener("click", onDuplicateArticle);
  document.getElementById("delete-article-button").addEventListener("click", onDeleteArticle);
  document.getElementById("transfer-button").addEventListener("click", onTransfer);
  document.getElementById("new-template-button").addEventListener("click", onNewTemplate);
  document.getElementById("save-template-button").addEventListener("click", onSaveTemplate);
  document.getElementById("apply-template-button").addEventListener("click", onApplyTemplate);
  document.getElementById("delete-template-button").addEventListener("click", onDeleteTemplate);
  document.getElementById("save-settings-button").addEventListener("click", onSaveSettings);
  document.getElementById("export-button").addEventListener("click", onExport);
  document.getElementById("import-input").addEventListener("change", onImport);
  ui.articleStatusFilter.addEventListener("change", renderArticleList);

  const markDirty = () => {
    state.dirty = true;
    updateSaveIndicator();
    renderPreviewAndValidation();
  };

  Object.values(formFields).forEach((field) => {
    field.addEventListener("input", markDirty);
    field.addEventListener("change", markDirty);
  });

  Object.values(templateFields).forEach((field) => {
    field.addEventListener("input", renderPreviewAndValidation);
    field.addEventListener("change", renderPreviewAndValidation);
  });
}

async function onNewArticle() {
  await saveCurrentArticleIfDirty();
  const article = createArticle();
  state.db.articles.unshift(article);
  state.selectedArticleId = article.id;
  state.db.activeArticleId = article.id;
  state.dirty = false;
  await persistDb();
  renderAll();
}

async function onSaveArticle() {
  upsertCurrentArticle();
  await persistDb();
  state.dirty = false;
  updateSaveIndicator("保存済み");
  renderAll();
}

async function onDuplicateArticle() {
  const current = getCurrentArticleDraft();
  if (!current) {
    return;
  }
  const clone = {
    ...current,
    id: createId("article"),
    title: current.title ? `${current.title}（複製）` : "無題の記事（複製）",
    status: "作成中",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTransferredAt: "",
    lastPublishedAt: ""
  };
  state.db.articles.unshift(clone);
  state.selectedArticleId = clone.id;
  state.db.activeArticleId = clone.id;
  state.dirty = false;
  await persistDb();
  renderAll();
}

async function onDeleteArticle() {
  const current = getCurrentArticle();
  if (!current) {
    return;
  }
  const confirmed = window.confirm(`「${current.title || "無題の記事"}」を削除しますか？`);
  if (!confirmed) {
    return;
  }
  state.db.articles = state.db.articles.filter((article) => article.id !== current.id);
  if (state.db.articles.length === 0) {
    const article = createArticle();
    state.db.articles.push(article);
  }
  state.selectedArticleId = state.db.articles[0].id;
  state.db.activeArticleId = state.selectedArticleId;
  state.dirty = false;
  await persistDb();
  renderAll();
}

async function onTransfer() {
  const article = getCurrentArticleDraft();
  if (!article) {
    return;
  }

  const checks = buildValidation(article);
  const hardWarnings = checks.filter((item) => item.level !== "info");
  if (hardWarnings.length > 0) {
    const confirmed = window.confirm(
      "転送前チェックで警告があります。このまま転送してもよいですか？"
    );
    if (!confirmed) {
      return;
    }
  }

  article.status = "転送済み";
  article.lastTransferredAt = new Date().toISOString();
  article.updatedAt = new Date().toISOString();
  article.composedBody = composeArticleBody(article);

  upsertArticle(article);
  await persistDb();
  renderAll();

  const payload = {
    article,
    editorUrl: state.db.settings.rakutenEditorUrl,
    transferMode: state.db.settings.transferMode,
    settings: state.db.settings
  };

  const response = await chrome.runtime.sendMessage({
    type: "RBH_START_TRANSFER",
    payload
  });

  if (!response?.ok) {
    ui.transferLog.innerHTML = renderLogCard(
      "転送エラー",
      response?.error || "楽天ブログへの転送開始に失敗しました。"
    );
    return;
  }

  const pageResult = response.result?.pageResult;
  if (pageResult?.status === "error") {
    ui.transferLog.innerHTML = renderLogCard(
      "入力失敗",
      pageResult.errors.join(" / ")
    );
  } else {
    const message = pageResult
      ? summarizePageResult(pageResult)
      : "投稿画面を開きました。画面右下のヘルパー通知を確認してください。";
    ui.transferLog.innerHTML = renderLogCard("転送開始", message);
  }
}

function onNewTemplate() {
  state.selectedTemplateId = null;
  writeTemplateToForm(createTemplate());
}

async function onSaveTemplate() {
  const template = getTemplateDraft();
  if (!template.name.trim()) {
    window.alert("テンプレート名を入力してください。");
    return;
  }

  const index = state.db.templates.findIndex((item) => item.id === template.id);
  if (index >= 0) {
    state.db.templates[index] = template;
  } else {
    state.db.templates.unshift(template);
  }

  state.selectedTemplateId = template.id;
  await persistDb();
  renderTemplateList();
}

async function onApplyTemplate() {
  const template = getCurrentTemplate();
  if (!template) {
    window.alert("反映するテンプレートを選択してください。");
    return;
  }

  const current = getCurrentArticleDraft();
  if (!current) {
    return;
  }

  const nextArticle = {
    ...current,
    category: current.category || template.defaultCategory,
    theme: current.theme || template.defaultTheme,
    prRequired: Boolean(template.prText),
    prText: current.prText || template.prText,
    introText: current.introText || template.introText,
    outroText: current.outroText || template.outroText,
    affiliateLink: current.affiliateLink || template.fixedLink,
    body: mergeTemplateBody(current.body, template.headingTemplate, template.note),
    updatedAt: new Date().toISOString()
  };

  writeArticleToForm(nextArticle);
  state.dirty = true;
  updateSaveIndicator("テンプレート反映");
  renderPreviewAndValidation();
}

async function onDeleteTemplate() {
  const template = getCurrentTemplate();
  if (!template) {
    return;
  }
  const confirmed = window.confirm(`テンプレート「${template.name}」を削除しますか？`);
  if (!confirmed) {
    return;
  }

  state.db.templates = state.db.templates.filter((item) => item.id !== template.id);
  state.selectedTemplateId = state.db.templates[0]?.id || null;
  await persistDb();
  renderTemplateList();
  writeTemplateToForm(getCurrentTemplate() || createTemplate());
}

async function onSaveSettings() {
  state.db.settings.rakutenEditorUrl = ui.settingsEditorUrl.value.trim();
  state.db.settings.transferMode = ui.settingsTransferMode.value;
  await persistDb();
  ui.transferLog.innerHTML = renderLogCard("設定保存", "転送設定を保存しました。");
}

async function onExport() {
  await saveCurrentArticleIfDirty();
  const json = JSON.stringify(state.db, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `rakuten-blog-helper-backup-${formatDateForFile(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  ui.transferLog.innerHTML = renderLogCard(
    "バックアップ作成",
    "JSONバックアップを書き出しました。安全な場所に保管してください。"
  );
}

async function onImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    window.alert("JSONの読み込みに失敗しました。");
    return;
  }

  const confirmed = window.confirm(
    "現在の保存内容を上書きして復元します。続けますか？"
  );
  if (!confirmed) {
    return;
  }

  state.db = normalizeDb(parsed);
  state.selectedArticleId = state.db.activeArticleId || state.db.articles[0]?.id || null;
  state.selectedTemplateId = state.db.templates[0]?.id || null;
  state.dirty = false;
  await persistDb();
  renderAll();
  ui.transferLog.innerHTML = renderLogCard(
    "バックアップ復元",
    "JSONバックアップから復元しました。"
  );
  event.target.value = "";
}

async function saveCurrentArticleIfDirty() {
  if (!state.dirty) {
    return;
  }
  upsertCurrentArticle();
  await persistDb();
  state.dirty = false;
  updateSaveIndicator();
}

function upsertCurrentArticle() {
  const draft = getCurrentArticleDraft();
  if (!draft) {
    return;
  }
  upsertArticle(draft);
}

function upsertArticle(article) {
  const index = state.db.articles.findIndex((item) => item.id === article.id);
  if (index >= 0) {
    state.db.articles[index] = article;
  } else {
    state.db.articles.unshift(article);
  }
  state.selectedArticleId = article.id;
  state.db.activeArticleId = article.id;
}

function renderAll() {
  renderArticleList();
  renderTemplateList();
  renderSettings();
  writeArticleToForm(getCurrentArticle());
  writeTemplateToForm(getCurrentTemplate() || createTemplate());
  renderPreviewAndValidation();
  updateSaveIndicator();
}

function renderArticleList() {
  const filterValue = ui.articleStatusFilter.value;
  const items = state.db.articles.filter((article) => {
    return !filterValue || article.status === filterValue;
  });

  if (items.length === 0) {
    ui.articleList.innerHTML = `<div class="empty-state">条件に合う記事がありません。</div>`;
    return;
  }

  ui.articleList.innerHTML = items.map((article) => {
    const activeClass = article.id === state.selectedArticleId ? "active" : "";
    return `
      <button class="list-item ${activeClass}" data-article-id="${escapeHtml(article.id)}" type="button">
        <p class="list-item-title">${escapeHtml(article.title || "無題の記事")}</p>
        <div class="list-item-meta">${escapeHtml(formatRelative(article.updatedAt))}</div>
        <div class="status-badge">${escapeHtml(article.status || "作成中")}</div>
      </button>
    `;
  }).join("");

  ui.articleList.querySelectorAll("[data-article-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveCurrentArticleIfDirty();
      state.selectedArticleId = button.dataset.articleId;
      state.db.activeArticleId = state.selectedArticleId;
      state.dirty = false;
      await persistDb();
      renderAll();
    });
  });
}

function renderTemplateList() {
  if (state.db.templates.length === 0) {
    ui.templateList.innerHTML = `<div class="empty-state">テンプレートがまだありません。</div>`;
    return;
  }

  ui.templateList.innerHTML = state.db.templates.map((template) => {
    const activeClass = template.id === state.selectedTemplateId ? "active" : "";
    return `
      <button class="list-item ${activeClass}" data-template-id="${escapeHtml(template.id)}" type="button">
        <p class="list-item-title">${escapeHtml(template.name)}</p>
        <div class="list-item-meta">${escapeHtml(template.defaultCategory || "カテゴリ未設定")}</div>
      </button>
    `;
  }).join("");

  ui.templateList.querySelectorAll("[data-template-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTemplateId = button.dataset.templateId;
      renderTemplateList();
      writeTemplateToForm(getCurrentTemplate());
    });
  });
}

function renderSettings() {
  ui.settingsEditorUrl.value = state.db.settings.rakutenEditorUrl || "";
  ui.settingsTransferMode.value = state.db.settings.transferMode || "draft";
}

function renderPreviewAndValidation() {
  const article = getCurrentArticleDraft();
  if (!article) {
    return;
  }

  const checks = buildValidation(article);
  ui.validationList.innerHTML = checks.map((item) => {
    return `
      <article class="validation-item" data-level="${escapeHtml(item.level)}">
        <p class="validation-item-title">${escapeHtml(item.title)}</p>
        <p class="validation-item-text">${escapeHtml(item.text)}</p>
      </article>
    `;
  }).join("");

  ui.preview.innerHTML = renderPreview(article);
}

async function renderLastTransferLog() {
  const result = await chrome.storage.local.get(APP_STATE_KEY);
  const last = result[APP_STATE_KEY];
  if (!last?.lastTransferResult) {
    ui.transferLog.textContent = "まだ転送していません。";
    return;
  }

  ui.transferLog.innerHTML = renderLogCard(
    `前回の転送: ${formatRelative(last.lastTransferAt)}`,
    summarizePageResult(last.lastTransferResult)
  );
}

function renderPreview(article) {
  const title = article.title || "無題の記事";
  const content = composeArticleBody(article);
  const sections = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));

  const body = sections.map((line) => {
    if (line.startsWith("# ")) {
      return `<h2>${escapeHtml(line.replace(/^# /, ""))}</h2>`;
    }
    if (line.startsWith("## ")) {
      return `<h2>${escapeHtml(line.replace(/^## /, ""))}</h2>`;
    }
    if (!line) {
      return "<p>&nbsp;</p>";
    }
    return `<p>${linkify(escapeHtml(line))}</p>`;
  }).join("");

  const chips = [];
  if (article.prRequired && article.prText) {
    chips.push(`<span class="preview-chip">${escapeHtml(article.prText)}</span>`);
  }
  if (article.category) {
    chips.push(`<span class="preview-chip">${escapeHtml(article.category)}</span>`);
  }
  if (article.theme) {
    chips.push(`<span class="preview-chip">${escapeHtml(article.theme)}</span>`);
  }

  return `
    ${chips.join(" ")}
    <h1>${escapeHtml(title)}</h1>
    ${body || '<p class="empty-state">本文を入力するとここにプレビューが表示されます。</p>'}
  `;
}

function buildValidation(article) {
  const warnings = [];
  const composedBody = composeArticleBody(article);

  if (!article.title.trim()) {
    warnings.push({
      level: "error",
      title: "タイトル未入力",
      text: "記事タイトルが空欄です。"
    });
  } else {
    warnings.push({
      level: "info",
      title: "タイトルOK",
      text: `現在のタイトル: ${article.title}`
    });
  }

  if (!article.body.trim()) {
    warnings.push({
      level: "error",
      title: "本文未入力",
      text: "記事本文が空欄です。"
    });
  } else {
    warnings.push({
      level: "info",
      title: "本文OK",
      text: `${article.body.length}文字の本文が入力されています。`
    });
  }

  if (article.prRequired && !article.prText.trim()) {
    warnings.push({
      level: "warning",
      title: "PR表記不足",
      text: "PR表記を自動挿入する設定ですが、PR表記文が空欄です。"
    });
  }

  if (article.prRequired && article.prText.trim() && !composedBody.includes(article.prText.trim())) {
    warnings.push({
      level: "warning",
      title: "PR表記が本文に見当たりません",
      text: "転送時には自動挿入しますが、最終表示を楽天ブログ側で確認してください。"
    });
  }

  if (!article.affiliateLink.trim()) {
    warnings.push({
      level: "warning",
      title: "アフィリエイトリンク未入力",
      text: "必要な記事であれば楽天アフィリエイトリンクを設定してください。"
    });
  }

  if (!article.category.trim()) {
    warnings.push({
      level: "warning",
      title: "カテゴリ未選択",
      text: "カテゴリが未設定です。楽天ブログ側で手動設定になる可能性があります。"
    });
  }

  if (!article.theme.trim()) {
    warnings.push({
      level: "warning",
      title: "テーマ未選択",
      text: "テーマが未設定です。楽天ブログ側で手動設定になる可能性があります。"
    });
  }

  if (/\{\{.+?\}\}/.test(composedBody)) {
    warnings.push({
      level: "warning",
      title: "未置換テンプレート文字あり",
      text: "本文内に {{placeholder}} 形式の文字列が残っています。"
    });
  }

  if (warnings.length === 0) {
    warnings.push({
      level: "info",
      title: "チェック完了",
      text: "現在は警告がありません。"
    });
  }

  return warnings;
}

function writeArticleToForm(article) {
  const source = article || createArticle();
  formFields.title.value = source.title || "";
  formFields.body.value = source.body || "";
  formFields.category.value = source.category || "";
  formFields.theme.value = source.theme || "";
  formFields.scheduledAt.value = source.scheduledAt || "";
  formFields.status.value = source.status || "作成中";
  formFields.prRequired.checked = Boolean(source.prRequired);
  formFields.prText.value = source.prText || "";
  formFields.introText.value = source.introText || "";
  formFields.outroText.value = source.outroText || "";
  formFields.affiliateLink.value = source.affiliateLink || "";
  formFields.productName.value = source.productName || "";
  formFields.memo.value = source.memo || "";
  formFields.summary.value = source.summary || "";
  formFields.searchDescription.value = source.searchDescription || "";
  formFields.snsDescription.value = source.snsDescription || "";
}

function writeTemplateToForm(template) {
  const source = template || createTemplate();
  templateFields.name.value = source.name || "";
  templateFields.defaultCategory.value = source.defaultCategory || "";
  templateFields.defaultTheme.value = source.defaultTheme || "";
  templateFields.prText.value = source.prText || "";
  templateFields.introText.value = source.introText || "";
  templateFields.headingTemplate.value = source.headingTemplate || "";
  templateFields.outroText.value = source.outroText || "";
  templateFields.fixedLink.value = source.fixedLink || "";
  templateFields.note.value = source.note || "";
}

function getCurrentArticle() {
  return state.db.articles.find((article) => article.id === state.selectedArticleId) || null;
}

function getCurrentArticleDraft() {
  const current = getCurrentArticle() || createArticle();
  return {
    ...current,
    title: formFields.title.value,
    body: formFields.body.value,
    category: formFields.category.value,
    theme: formFields.theme.value,
    scheduledAt: formFields.scheduledAt.value,
    status: formFields.status.value,
    prRequired: formFields.prRequired.checked,
    prText: formFields.prText.value,
    introText: formFields.introText.value,
    outroText: formFields.outroText.value,
    affiliateLink: formFields.affiliateLink.value,
    productName: formFields.productName.value,
    memo: formFields.memo.value,
    summary: formFields.summary.value,
    searchDescription: formFields.searchDescription.value,
    snsDescription: formFields.snsDescription.value,
    updatedAt: new Date().toISOString()
  };
}

function getCurrentTemplate() {
  return state.db.templates.find((template) => template.id === state.selectedTemplateId) || null;
}

function getTemplateDraft() {
  const current = getCurrentTemplate() || createTemplate();
  return {
    ...current,
    name: templateFields.name.value,
    defaultCategory: templateFields.defaultCategory.value,
    defaultTheme: templateFields.defaultTheme.value,
    prText: templateFields.prText.value,
    introText: templateFields.introText.value,
    headingTemplate: templateFields.headingTemplate.value,
    outroText: templateFields.outroText.value,
    fixedLink: templateFields.fixedLink.value,
    note: templateFields.note.value,
    updatedAt: new Date().toISOString()
  };
}

function createArticle() {
  const now = new Date().toISOString();
  return {
    id: createId("article"),
    title: "",
    body: "",
    category: "",
    theme: "",
    scheduledAt: "",
    status: "作成中",
    prRequired: false,
    prText: "※この記事にはPRが含まれます。",
    introText: "",
    outroText: "",
    affiliateLink: "",
    productName: "",
    memo: "",
    summary: "",
    searchDescription: "",
    snsDescription: "",
    createdAt: now,
    updatedAt: now,
    lastTransferredAt: "",
    lastPublishedAt: ""
  };
}

function createTemplate() {
  const now = new Date().toISOString();
  return {
    id: createId("template"),
    name: "",
    defaultCategory: "",
    defaultTheme: "",
    prText: "※この記事にはPRが含まれます。",
    introText: "",
    headingTemplate: "",
    outroText: "",
    fixedLink: "",
    note: "",
    createdAt: now,
    updatedAt: now
  };
}

function composeArticleBody(article) {
  const segments = [];
  if (article.prRequired && article.prText.trim()) {
    segments.push(article.prText.trim());
  }
  if (article.summary.trim()) {
    segments.push(article.summary.trim());
  }
  if (article.introText.trim()) {
    segments.push(article.introText.trim());
  }
  if (article.body.trim()) {
    segments.push(article.body.trim());
  }
  if (article.affiliateLink.trim()) {
    const productLabel = article.productName.trim() || "関連リンク";
    segments.push(`${productLabel}\n${article.affiliateLink.trim()}`);
  }
  if (article.outroText.trim()) {
    segments.push(article.outroText.trim());
  }
  return segments.filter(Boolean).join("\n\n");
}

function mergeTemplateBody(currentBody, headingTemplate, note) {
  const parts = [];
  if (headingTemplate.trim()) {
    parts.push(headingTemplate.trim());
  }
  if (currentBody.trim()) {
    parts.push(currentBody.trim());
  }
  if (note.trim()) {
    parts.push(note.trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

function summarizePageResult(result) {
  const messages = [];
  if (result.info?.length) {
    messages.push(result.info.join(" "));
  }
  if (result.warnings?.length) {
    messages.push(`注意: ${result.warnings.join(" ")}`);
  }
  if (result.errors?.length) {
    messages.push(`エラー: ${result.errors.join(" ")}`);
  }
  return messages.join(" ") || "投稿画面を開きました。";
}

function renderLogCard(title, text) {
  return `
    <article class="log-card">
      <p class="validation-item-title">${escapeHtml(title)}</p>
      <p class="validation-item-text">${escapeHtml(text)}</p>
    </article>
  `;
}

function updateSaveIndicator(label) {
  if (label) {
    ui.saveIndicator.textContent = label;
    return;
  }
  ui.saveIndicator.textContent = state.dirty ? "未保存" : "保存済み";
}

async function loadDb() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeDb(result[STORAGE_KEY]);
}

async function persistDb() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: state.db
  });
}

function normalizeDb(input) {
  const db = input || {};
  return {
    version: 1,
    articles: Array.isArray(db.articles) && db.articles.length > 0
      ? db.articles.map((article) => ({ ...createArticle(), ...article }))
      : [],
    templates: Array.isArray(db.templates)
      ? db.templates.map((template) => ({ ...createTemplate(), ...template }))
      : [],
    settings: {
      rakutenEditorUrl: db.settings?.rakutenEditorUrl || "",
      transferMode: db.settings?.transferMode || "draft"
    },
    activeArticleId: db.activeArticleId || ""
  };
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatRelative(iso) {
  if (!iso) {
    return "日時未設定";
  }
  const date = new Date(iso);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDateForFile(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

function linkify(text) {
  return text.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
