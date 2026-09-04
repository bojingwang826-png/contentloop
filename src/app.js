import { sampleProject } from "./data/sample-project.js";
import { parseProject } from "./domain/schema.js";
import {
  checkpointHistory,
  deleteSavedVersion,
  dismissDeletedSavedVersion,
  emptyHistory,
  normalizeHistory,
  normalizeVersionLabel,
  redoHistory,
  renameSavedVersion,
  restoreDeletedSavedVersion,
  restoreHistoryVersion,
  saveHistoryVersion,
  undoHistory,
} from "./domain/history.js";
import {
  analyzeRewriteImpact,
  analyzeViewpointImpact,
  applyViewpointImpact,
  ensureDistinctPageCopy,
  hasManualOrder,
  isFieldPreserved,
  moveEquipmentItem,
  normalizeManualOrder,
  normalizePreservedFields,
  normalizeRoute,
  normalizeViewpointConflicts,
  restoreEquipmentOrder,
  togglePreservedField,
  updateOutlinePage,
  updatePage,
  validateOutlinePageDraft,
  resolveOutlineRewriteInstruction,
} from "./domain/state.js";
import {
  buildPageRenderModel,
  getIconSource,
  pageExportFilename,
} from "./domain/page-render.js";
import { renderPageToCanvas, renderPageToPngWithAudit } from "./domain/canvas-renderer.js";
import { enrichOutlineWithGameData, materializeDynamicProject } from "./domain/dynamic-pages.js";
import { createZipBlob } from "./domain/zip.js";
import {
  applyRewriteFieldsResponse,
  createOutlineRequest,
  createPublishCopyRequest,
  createResearchBriefRequest,
  createRewriteFieldsRequest,
  createUnderstandInputRequest,
} from "./domain/ai-contract.js";
import {
  applySourceExtraction,
  confirmExtractedSource,
  normalizeSourceCards,
  saveManualSource,
  sourceReadinessSummary,
  updateSourceCard,
} from "./domain/source-cards.js";
import { refreshAnalysisWithParsedSources } from "./domain/input-analysis.js";
import {
  createConfirmedScreenshotRecord,
  deriveScreenshotResult,
  screenshotCategoryOptions,
  screenshotInputContext,
} from "./domain/screenshot-ocr.js";
import { clearAiAccessCode, getAiRuntimeStatus, researchGameTopic, runAiTask, setAiAccessCode } from "./services/ai-client.js";
import { extractPublicSource } from "./services/source-client.js";
import { createLowResolutionPreview, recognizeScreenshot } from "./services/screenshot-ocr-client.js";

const project = parseProject(sampleProject);
const storageKey = "game-note-studio-phase-a-v2";

const defaultState = {
  accountName: "铲友研究所",
  sourceInput: "",
  inputSupplement: "",
  inputAnalysis: null,
  inputAnalysisError: "",
  inputSelectedCandidateId: "",
  inputAnalysisProvider: "",
  sourceBusyId: "",
  sourceTaskMessage: "",
  screenshotCapture: {
    status: "idle",
    fileName: "",
    title: "",
    preview: "",
    text: "",
    category: "",
    ocrConfidence: 0,
    progress: 0,
    error: "",
  },
  confirmedScreenshots: [],
  customProject: null,
  contentSource: "sample",
  selectedTopicId: project.topics[0].id,
  viewpointId: project.viewpoints[0].id,
  pendingViewpointId: "",
  viewpointImpact: [],
  viewpointDecisions: {},
  viewpointImpactFingerprint: "",
  viewpointConflicts: [],
  outlineConfirmed: false,
  outlineEditingPageNo: 0,
  outlineEditorDraft: null,
  outlineOriginalDraft: null,
  outlineEditError: "",
  outlineRewriteSuggestion: "换一种更自然、更具体的表达，保留本页重点",
  pages: project.pages.map((page) => ({ ...page, preservedFields: [], manualOrder: [] })),
  currentPageId: project.pages[0].id,
  history: emptyHistory(),
  versionFilter: "all",
  versionSaveOpen: false,
  versionSaveName: "",
  versionRenameId: "",
  versionRenameValue: "",
  versionDeleteId: "",
  rewriteSuggestion: "讲得再详细一点，提醒新手常见误区",
  documentRewriteSuggestion: "整篇更像朋友安利，补充新手判断",
  rewriteImpact: [],
  rewriteImpactSuggestion: "",
  rewriteImpactFingerprint: "",
  rewriteSelectedPageIds: [],
  publishBody: project.exportCopy.body,
  publishBodyPreserved: false,
  publishBodySuggestion: "更有小红书网感，带一点 emoji",
  publishBodyRewriteSummary: "",
  publishBodyRewriteMode: "",
  aiStatus: {
    mode: "checking",
    provider: "",
    model: "",
    message: "正在确认 AI 运行模式…",
  },
  aiBusy: false,
  aiTaskMessage: "",
  exportBusy: false,
  exportCurrent: 0,
  exportTotal: 0,
  exportMessage: "",
  toast: "",
};

let state = loadState();
let aiAccessCodeDraft = "";
let aiAccessCodeSet = false;
try {
  const savedAccessCode = sessionStorage.getItem("chanyou-ai-access-code") || "";
  if (savedAccessCode) {
    setAiAccessCode(savedAccessCode);
    aiAccessCodeSet = true;
  }
} catch {
  // Session storage can be unavailable in strict privacy modes; the in-memory code still works.
}
let exportArtifacts = {
  fingerprint: "",
  pages: [],
  failures: [],
  zipUrl: "",
  zipSize: 0,
};
const app = document.querySelector("#app");

function exportFingerprint(pages = state.pages, accountName = state.accountName) {
  return JSON.stringify({ pages, accountName });
}

function clearExportArtifacts() {
  exportArtifacts.pages.forEach((item) => URL.revokeObjectURL(item.url));
  if (exportArtifacts.zipUrl) URL.revokeObjectURL(exportArtifacts.zipUrl);
  exportArtifacts = { fingerprint: "", pages: [], failures: [], zipUrl: "", zipSize: 0 };
}

window.addEventListener("beforeunload", clearExportArtifacts);

function upgradeDynamicPageLayout(stored) {
  const storedPages = Array.isArray(stored?.pages) ? stored.pages : [];
  if (stored?.contentSource !== "dynamic" || !stored.customProject?.outline) return storedPages;
  if (storedPages.length === 7 && storedPages.every((page) => page.layoutVersion >= 8)) return storedPages;
  try {
    const fresh = materializeDynamicProject(stored.customProject).pages;
    return fresh.map((freshPage, index) => {
      const oldPage = storedPages[index];
      if (!oldPage) return freshPage;
      const shared = {
        title: oldPage.title || freshPage.title,
        subtitle: oldPage.subtitle || freshPage.subtitle,
        baseSubtitle: oldPage.baseSubtitle || freshPage.baseSubtitle,
        locked: Boolean(oldPage.locked),
        preservedFields: normalizePreservedFields(oldPage),
        manualOrder: normalizeManualOrder(oldPage),
      };
      if (oldPage.locked) {
        return { ...freshPage, ...shared, blocks: oldPage.blocks || freshPage.blocks };
      }
      return { ...freshPage, ...shared };
    });
  } catch {
    return storedPages;
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!stored) return structuredClone(defaultState);
    const upgradedPages = upgradeDynamicPageLayout(stored);
    return {
      ...structuredClone(defaultState),
      ...stored,
      contentSource: stored.contentSource === "dynamic" && stored.customProject ? "dynamic" : "sample",
      pages: (upgradedPages.length === 7
        ? upgradedPages
        : structuredClone(project.pages))
        .map((page) => ({
          ...ensureDistinctPageCopy(page),
          preservedFields: normalizePreservedFields(page),
          manualOrder: normalizeManualOrder(page),
        })),
      history: normalizeHistory(stored.history),
      versionFilter: "all",
      versionSaveOpen: false,
      versionSaveName: "",
      versionRenameId: "",
      versionRenameValue: "",
      versionDeleteId: "",
      viewpointConflicts: normalizeViewpointConflicts(stored.viewpointConflicts),
      pendingViewpointId: "",
      viewpointImpact: [],
      viewpointDecisions: {},
      viewpointImpactFingerprint: "",
      rewriteImpact: [],
      rewriteImpactSuggestion: "",
      rewriteImpactFingerprint: "",
      rewriteSelectedPageIds: [],
      inputSupplement: "",
      inputAnalysis: null,
      inputAnalysisError: "",
      inputSelectedCandidateId: "",
      inputAnalysisProvider: "",
      screenshotCapture: stored.screenshotCapture?.text || stored.screenshotCapture?.preview
        ? { ...structuredClone(defaultState.screenshotCapture), ...stored.screenshotCapture, status: "ready", progress: 100 }
        : structuredClone(defaultState.screenshotCapture),
      confirmedScreenshots: Array.isArray(stored.confirmedScreenshots) ? stored.confirmedScreenshots.slice(-12) : [],
      aiStatus: structuredClone(defaultState.aiStatus),
      aiBusy: false,
      aiTaskMessage: "",
      exportBusy: false,
      exportCurrent: 0,
      exportTotal: 0,
      exportMessage: "",
      toast: "",
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  const {
    toast,
    rewriteImpact,
    rewriteImpactSuggestion,
    rewriteImpactFingerprint,
    rewriteSelectedPageIds,
    pendingViewpointId,
    viewpointImpact,
    viewpointDecisions,
    viewpointImpactFingerprint,
    versionFilter,
    versionSaveOpen,
    versionSaveName,
    versionRenameId,
    versionRenameValue,
    versionDeleteId,
    inputSupplement,
    inputAnalysis,
    inputAnalysisError,
    inputSelectedCandidateId,
    inputAnalysisProvider,
    aiStatus,
    aiBusy,
    aiTaskMessage,
    exportBusy,
    exportCurrent,
    exportTotal,
    exportMessage,
    ...persisted
  } = state;
  localStorage.setItem(storageKey, JSON.stringify(persisted));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name, label = "") {
  const paths = {
    arrow: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.8 6.2L4 9m16 6-2.8 2.8A7 7 0 0 1 5.5 15"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5Z"/><path d="M4 6.5v13"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    undo: '<path d="m9 14-4-4 4-4"/><path d="M5 10h8a6 6 0 0 1 6 6v2"/>',
    redo: '<path d="m15 14 4-4-4-4"/><path d="M19 10h-8a6 6 0 0 0-6 6v2"/>',
    save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/>',
    arrowUp: '<path d="m18 15-6-6-6 6"/>',
    arrowDown: '<path d="m6 9 6 6 6-6"/>',
    sort: '<path d="M8 6h12"/><path d="M8 12h9"/><path d="M8 18h6"/><path d="m3 8 2-2 2 2"/><path d="M5 6v12"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    shield: '<path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6Z"/><path d="m9 12 2 2 4-4"/>',
    warning: '<path d="M12 3 2.5 20h19Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>${label ? `<span>${escapeHtml(label)}</span>` : ""}`;
}

const steps = [
  { id: "home", label: "选题", hint: "发现值得写的内容" },
  { id: "research", label: "研究", hint: "判断观点与证据" },
  { id: "outline", label: "大纲", hint: "确认七页任务" },
  { id: "editor", label: "编辑", hint: "逐页修改与锁定" },
  { id: "export", label: "导出", hint: "整理发布文案" },
];

function currentRoute() {
  return normalizeRoute(location.hash);
}

function shell(route, content) {
  const activeIndex = steps.findIndex((step) => step.id === route);
  return `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#/home" aria-label="返回铲友创作台首页">
          <span class="brand-mark" aria-hidden="true"></span>
          <span><strong>铲友创作台</strong><small>游戏图文知识库与创作工作台</small></span>
        </a>
        <div class="topbar-meta">
          <span class="demo-badge">匿名样例</span>
          ${renderAiStatusBadge()}
          <span class="kb-state">${icon("database")}知识库稍后接入</span>
        </div>
      </header>
      <nav class="step-nav" aria-label="创作步骤">
        ${steps.map((step, index) => `
          <a class="step-link ${step.id === route ? "is-active" : ""} ${index < activeIndex ? "is-done" : ""}" href="#/${step.id}" ${step.id === route ? 'aria-current="step"' : ""}>
            <span class="step-index">${index < activeIndex ? icon("check") : index + 1}</span>
            <span><strong>${step.label}</strong><small>${step.hint}</small></span>
          </a>
        `).join("")}
      </nav>
      <main id="main-content" class="main-content" tabindex="-1">
        ${content}
      </main>
      ${state.toast ? `<div class="toast" role="status" aria-live="polite">${icon("check")}${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
}

function renderAiStatusBadge() {
  const mode = state.aiStatus?.mode || "checking";
  const label = mode === "live" ? (state.aiStatus?.accessRequired ? "在线 AI · 已保护" : "在线 AI") : mode === "demo" ? "演示 AI" : "检查 AI";
  const detail = mode === "live"
    ? `${state.aiStatus.model} · 结构化输出`
    : mode === "demo"
      ? "不消耗在线额度"
      : "正在连接";
  return `<span class="ai-runtime-badge is-${escapeHtml(mode)}" title="${escapeHtml(state.aiStatus?.message || detail)}">${icon(mode === "live" ? "check" : "shield")}<span><strong>${label}</strong><small>${escapeHtml(detail)}</small></span></span>`;
}

function renderAiModeInline() {
  const live = state.aiStatus?.mode === "live";
  const protectedAi = live && state.aiStatus?.accessRequired;
  return `<div class="ai-mode-inline ${live ? "is-live" : "is-demo"} ${protectedAi ? "has-access-control" : ""}" role="status">
    <div class="ai-mode-summary">${icon(live ? "check" : "shield")}<span><strong>${live ? `在线模型 · ${escapeHtml(state.aiStatus.model)}` : state.aiStatus?.mode === "demo" ? "演示模式" : "AI 连接待确认"}</strong><small>${live ? "返回内容会先通过字段白名单和结构检查" : state.aiStatus?.mode === "demo" ? "使用确定性规则，不产生 API 费用" : "暂未确认服务状态；发起请求失败时会保留原稿并提示"}</small></span></div>
    ${protectedAi ? `<div class="ai-access-control"><label for="ai-access-code">AI 访问码</label><input id="ai-access-code" type="password" data-field="aiAccessCode" value="" placeholder="${aiAccessCodeSet ? "本次会话已解锁" : "输入后解锁真实 AI"}" autocomplete="off" /><button class="button secondary" type="button" data-action="save-ai-access-code" ${!aiAccessCodeDraft.trim() ? "disabled" : ""}>${aiAccessCodeSet ? "更新访问码" : "解锁 AI"}</button>${aiAccessCodeSet ? `<button class="link-button" type="button" data-action="clear-ai-access-code">清除</button>` : ""}</div>` : ""}
  </div>`;
}

function pageHeader(eyebrow, title, description, side = "") {
  return `<section class="page-heading">
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>
    ${side}
  </section>`;
}

function scoreRow(label, value) {
  return `<div class="score-row"><span>${escapeHtml(label)}</span><div class="score-track" aria-label="${escapeHtml(label)} ${value} 分"><i style="--score:${value}%"></i></div><strong>${value}</strong></div>`;
}

function renderSourceGate(sources) {
  const readiness = sourceReadinessSummary(sources);
  const tone = readiness.ready ? "success" : "warning";
  const awaitingReview = sources.filter((source) => source.extractionStatus === "extracted" && !source.confirmed).length;
  const title = readiness.ready ? `已确认 ${readiness.usableCount} 个来源` : awaitingReview ? `${awaitingReview} 个识别结果待确认` : "正在等待网页解析";
  const detail = readiness.ready
    ? "已用于候选选题和研究卡；单个网站即可使用，不需要补第二个来源。"
    : awaitingReview
      ? "先核对系统读到的版本、装备和配方，再确认用于选题。"
    : readiness.failedCount
      ? "自动解析失败时，可粘贴公开正文片段并直接使用。"
      : "任意一个公开网页识别完成并经你确认后，就会参与分析。";
  return `<div class="source-gate is-${tone}" role="status">${icon(readiness.ready ? "check" : "search")}<span><strong>${title}</strong><small>${detail}</small></span></div>`;
}

function renderSourceInsights(source) {
  if (source.extractionStatus !== "extracted") return "";
  const structured = source.structured || {};
  const typeLabels = { equipment: "装备资料", lineup: "阵容攻略", augment: "强化符文", mechanic: "玩法机制", patch: "版本更新", guide: "新手教程", general: "通用内容" };
  const confidenceLabels = { high: "识别信息较完整", medium: "识别到部分信息", low: "只识别到基础正文" };
  const chips = [
    typeLabels[structured.contentType] || typeLabels.general,
    structured.game,
    structured.version ? `版本 ${structured.version}` : "",
    structured.items?.length ? `${structured.items.length} 个装备名` : "",
    structured.recipes?.length ? `${structured.recipes.length} 条配方` : "",
  ].filter(Boolean);
  const recipes = (structured.recipes || []).slice(0, 4);
  const retrievalLabel = source.retrievalMethod === "reader" ? "站点限制直接读取，已自动使用兼容阅读器" : "网页正文由本地服务直接读取";
  return `<section class="source-insights" aria-label="系统识别结果">
    <div class="source-insights-heading"><div>${icon("search")}<span><strong>系统识别结果</strong><small>${escapeHtml(confidenceLabels[structured.confidence] || confidenceLabels.low)}</small></span></div><span class="status-pill ${source.confirmed ? "success" : "warning"}">${source.confirmed ? "已确认使用" : "待你确认"}</span></div>
    <div class="source-insight-chips">${chips.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    <p class="source-retrieval-note">${icon(source.retrievalMethod === "reader" ? "refresh" : "check")}<span>${escapeHtml(retrievalLabel)}</span></p>
    ${structured.items?.length ? `<p><b>装备：</b>${escapeHtml(structured.items.slice(0, 10).join("、"))}</p>` : ""}
    ${recipes.length ? `<div class="source-recipe-preview"><b>识别到的配方</b><ul>${recipes.map((recipe) => `<li>${escapeHtml(recipe.ingredients.join(" ＋ "))} ＝ ${escapeHtml(recipe.result)}</li>`).join("")}</ul></div>` : ""}
    ${structured.lineupNames?.length ? `<p><b>阵容／羁绊：</b>${escapeHtml(structured.lineupNames.join("；"))}</p>` : ""}
    ${structured.keywords?.length ? `<p><b>关键词：</b>${escapeHtml(structured.keywords.join("、"))}</p>` : ""}
    <small class="source-review-hint">系统只整理网页公开内容，不把识别结果自动当成当前版本事实；确认前可以直接修改下面的标题、日期和正文摘要。</small>
  </section>`;
}

function renderSourceCard(source) {
  const statuses = {
    pending: ["正在解析", "warning", "正在读取网页公开内容"],
    extracted: source.confirmed
      ? ["已确认使用", "success", "网页内容已参与候选选题和研究卡"]
      : ["识别完成，待确认", "warning", "请先核对系统识别结果，再用于候选选题"],
    manual: ["手动补充，可直接使用", "success", "你补充的公开片段已参与分析"],
    failed: ["自动解析失败", "danger", source.failureReason || "网页暂时无法公开读取"],
  };
  const [label, tone, detail] = statuses[source.extractionStatus] || statuses.pending;
  const busy = state.sourceBusyId === source.id;
  const publicLink = source.publicDisplay !== false && /(?:^|\.)(?:jcc\.qq\.com|qq\.com|leagueoflegends\.com|riotgames\.com|communitydragon\.org)$/i.test(source.domain || "");
  return `<article class="source-card ${source.confirmed ? "is-confirmed" : ""}">
    <div class="source-card-heading"><div><span class="source-domain">${publicLink ? escapeHtml(source.domain) : "非官方参考 · 链接不公开展示"}</span>${publicLink ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : `<strong>${escapeHtml(source.title || "用户提供的参考资料")}</strong>`}</div><span class="status-pill ${tone}">${label}</span></div>
    <p class="source-status-detail ${source.extractionStatus === "failed" ? "is-error" : ""}">${escapeHtml(detail)}</p>
    ${renderSourceInsights(source)}
    <div class="source-meta-grid"><label>标题<input data-field="sourceTitle" data-id="${escapeHtml(source.id)}" value="${escapeHtml(source.title)}" /></label><label>作者（可空）<input data-field="sourceAuthor" data-id="${escapeHtml(source.id)}" value="${escapeHtml(source.author)}" placeholder="未找到可留空" /></label><label>发布日期（可空）<input data-field="sourcePublishedAt" data-id="${escapeHtml(source.id)}" value="${escapeHtml(source.publishedAt)}" placeholder="例如 2026-08-20" /></label></div>
    <label class="source-excerpt-label">公开正文片段或摘要<textarea rows="4" data-field="sourceExcerpt" data-id="${escapeHtml(source.id)}" placeholder="提取失败时，把网页中最关键的一段粘贴到这里；至少 20 个字">${escapeHtml(source.excerpt)}</textarea></label>
    <div class="source-card-actions"><button class="button ghost" type="button" data-action="extract-source" data-id="${escapeHtml(source.id)}" ${state.aiBusy || busy ? "disabled" : ""}>${icon("search")}${busy ? "正在解析网页…" : "重新解析网页"}</button>${source.extractionStatus === "extracted" && !source.confirmed ? `<button class="button primary" type="button" data-action="confirm-extracted-source" data-id="${escapeHtml(source.id)}">${icon("check")}确认识别结果并用于选题</button>` : ""}<button class="button secondary" type="button" data-action="save-manual-source" data-id="${escapeHtml(source.id)}" ${source.excerpt.trim().length < 20 ? "disabled" : ""}>${icon("check")}保存手动修改并使用</button></div>
  </article>`;
}

function renderInputAnalysis() {
  const analysis = state.inputAnalysis;
  if (!analysis && !state.inputAnalysisError) return "";
  if (!analysis) {
    return `<section class="panel input-analysis-panel is-error" aria-labelledby="input-analysis-title">
      <div class="analysis-heading"><div>${icon("warning")}<span><p class="eyebrow">没有改动你的输入</p><h2 id="input-analysis-title">这次没能完成分析</h2><small>${escapeHtml(state.inputAnalysisError)}</small></span></div><span class="status-pill warning">可手动补充</span></div>
      <div class="analysis-supplement"><label for="input-supplement">补充一两句关键信息</label><textarea id="input-supplement" rows="3" data-field="inputSupplement" placeholder="例如：链接主要讲装备改动，我想做给新手收藏的教程">${escapeHtml(state.inputSupplement)}</textarea><button class="button primary" type="button" data-action="analyze-source-input" ${state.aiBusy || !state.sourceInput.trim() ? "disabled" : ""}>${icon("refresh")}带补充重新分析</button></div>
    </section>`;
  }
  const factLabels = {
    input_claim: ["用户输入", "neutral"],
    source_supported: ["来源支持", "success"],
    needs_verification: ["待核验", "warning"],
    blocked: ["禁止使用", "danger"],
  };
  analysis.sources = normalizeSourceCards(analysis.sources);
  const visibleSources = analysis.sources.filter((source) => source.publicDisplay !== false && source.retrievalMethod !== "private_reference");
  const selected = analysis.topics.find((item) => item.id === state.inputSelectedCandidateId) || analysis.topics[0];
  const selectedPending = Boolean(selected?.pending);
  return `<section class="panel input-analysis-panel" aria-labelledby="input-analysis-title">
    <div class="analysis-heading"><div>${icon("search")}<span><p class="eyebrow">AI 输入理解</p><h2 id="input-analysis-title">${escapeHtml(analysis.intent)}</h2><small>${escapeHtml(analysis.summary)}</small>${analysis.liveResearch ? `<span class="live-research-meta">${escapeHtml(analysis.liveResearch.season)} · 数据版本 ${escapeHtml(analysis.liveResearch.patch)} · 已联网核对</span>` : ""}</span></div><span class="status-pill ${analysis.liveResearch || ["deepseek", "openai"].includes(state.inputAnalysisProvider) ? "success" : "neutral"}">${analysis.liveResearch ? "赛季实时资料" : ["deepseek", "openai"].includes(state.inputAnalysisProvider) ? "在线检索" : "演示分析"}</span></div>
    <div class="analysis-boundary-grid">
      <div><h3>事实边界</h3><div class="analysis-fact-list">${analysis.facts.map((fact) => { const [label, tone] = factLabels[fact.status] || ["待核验", "warning"]; return `<article><span class="status-pill ${tone}">${label}</span><strong>${escapeHtml(fact.label)}</strong><p>${escapeHtml(fact.claim)}</p></article>`; }).join("")}</div></div>
      <div class="analysis-source-area"><div class="source-area-title"><h3>来源关系</h3>${visibleSources.length ? renderSourceGate(visibleSources) : ""}</div>${visibleSources.length ? `<div class="source-card-list">${visibleSources.map(renderSourceCard).join("")}</div>` : `<p class="analysis-empty">这里只展示官方资料。非官方网页只用于当前内容分析，不会把链接写进项目页面。</p>`}</div>
    </div>
    <div class="section-title analysis-topic-heading"><div><p class="eyebrow">根据输入生成</p><h2>5 个差异化候选选题</h2></div><span class="sort-note">当前赛季 · 收藏价值优先</span></div>
    <div class="topic-grid analysis-topic-grid">${analysis.topics.map((topic, index) => `<button class="topic-card ${topic.id === selected.id ? "is-selected" : ""}" type="button" data-action="select-input-candidate" data-id="${escapeHtml(topic.id)}" aria-pressed="${topic.id === selected.id}"><span class="topic-number">0${index + 1}</span><span class="topic-badge">${escapeHtml(topic.badge)}</span><strong>${escapeHtml(topic.title)}</strong>${topic.entities?.length ? `<span class="topic-entity-count">本题对应 ${topic.entities.length} 名真实英雄</span><span class="topic-entities" aria-label="题目涉及的英雄">${topic.entities.slice(0, 4).map((entity) => `<span class="topic-entity"><img src="${escapeHtml(entity.imageUrl)}" alt="${escapeHtml(entity.alt || `${entity.name}英雄头像`)}" width="42" height="42" loading="lazy" referrerpolicy="no-referrer" /><small>${escapeHtml(entity.name)}</small></span>`).join("")}${topic.entities.length > 4 ? `<span class="topic-entity topic-entity-more"><b>+${topic.entities.length - 4}</b><small>其余成员</small></span>` : ""}</span>` : ""}<span class="topic-angle">${escapeHtml(topic.angle)}</span><span class="topic-score"><b>${topic.recommendation}</b><small>综合推荐</small></span></button>`).join("")}</div>
    <div class="analysis-selected-topic"><div><p class="eyebrow">当前选中的候选方向</p><h3>${escapeHtml(selected.title)}</h3><p>${escapeHtml(selected.reason)}</p><small>${selectedPending ? "先等待网页识别完成并确认正文，确认后这里会自动换成依据原文生成的新选题。" : "点击后才会建立正式创作项目；研究卡会继续沿用上面的事实与来源边界。"}</small><button class="button primary" type="button" data-action="start-dynamic-research" ${state.aiBusy || selectedPending ? "disabled" : ""}>${icon("search")}${selectedPending ? "先确认网页识别结果" : state.aiBusy && state.aiTaskMessage.includes("研究") ? escapeHtml(state.aiTaskMessage) : "用这个方向生成研究卡"}</button></div><div class="score-list">${scoreRow("搜索需求", selected.freshness)}${scoreRow("收藏价值", selected.saveValue)}${scoreRow("长期有效", selected.evergreen)}${scoreRow("新手痛点", selected.pain)}</div></div>
    ${analysis.questions.length ? `<div class="analysis-questions"><strong>还缺什么</strong><ul>${analysis.questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
    <div class="analysis-supplement"><label for="input-supplement">补充说明后再分析</label><textarea id="input-supplement" rows="3" data-field="inputSupplement" placeholder="例如：重点给完全不懂装备的新手；不要写版本强度">${escapeHtml(state.inputSupplement)}</textarea><button class="button secondary" type="button" data-action="analyze-source-input" ${state.aiBusy || !state.sourceInput.trim() ? "disabled" : ""}>${icon("refresh")}带补充重新分析</button></div>
  </section>`;
}

function renderScreenshotInsights(capture) {
  const derived = deriveScreenshotResult(capture.text, capture.category);
  const metricLabels = { views: "浏览", likes: "点赞", saves: "收藏", comments: "评论", followers: "涨粉" };
  const metrics = Object.entries(derived.metrics);
  const commentCount = Object.values(derived.commentGroups).reduce((total, items) => total + items.length, 0);
  return `<div class="ocr-insight-grid" aria-live="polite">
    <article><small>系统判断</small><strong>${escapeHtml(derived.categoryLabel)}</strong><span>${escapeHtml(derived.route)}</span></article>
    <article><small>识别质量</small><strong>${capture.ocrConfidence ? `${capture.ocrConfidence}%` : "待手动核对"}</strong><span>${derived.confidence === "high" ? "分类把握较高" : "建议检查分类和正文"}</span></article>
    <article><small>结构化结果</small><strong>${metrics.length + derived.equipment.length + commentCount} 项</strong><span>${metrics.length ? metrics.map(([key, value]) => `${metricLabels[key]} ${value}`).join(" · ") : derived.equipment.length ? derived.equipment.join(" · ") : commentCount ? `${commentCount} 条评论线索` : "可直接编辑识别正文"}</span></article>
  </div>`;
}

function renderScreenshotOcr() {
  const capture = state.screenshotCapture;
  const processing = capture.status === "processing";
  const editable = ["ready", "failed"].includes(capture.status);
  const recent = state.confirmedScreenshots.slice(-3).reverse();
  return `<section class="panel screenshot-ocr-panel" aria-labelledby="screenshot-ocr-title">
    <div class="section-title"><div><p class="eyebrow">截图识别</p><h2 id="screenshot-ocr-title">上传截图，确认后再使用</h2></div><span class="status-pill ${processing ? "warning" : capture.status === "ready" ? "success" : "neutral"}">${processing ? `识别中 ${capture.progress}%` : capture.status === "ready" ? "待确认" : "本地 OCR"}</span></div>
    <div class="ocr-workspace">
      <div class="ocr-upload-column">
        <label class="ocr-dropzone ${capture.preview ? "has-preview" : ""}" for="screenshot-file">
          ${capture.preview ? `<img src="${escapeHtml(capture.preview)}" alt="待确认截图低清预览" />` : `${icon("search")}<strong>选择一张截图</strong><span>支持 PNG、JPG、WebP，单张不超过 12 MB</span>`}
          <input class="sr-only" id="screenshot-file" type="file" accept="image/png,image/jpeg,image/webp" data-field="screenshotFile" ${processing ? "disabled" : ""} />
        </label>
        <p class="helper-text">文字在当前设备识别；原始高清图不写入本地草稿，仅保留低清预览和你确认后的结果。</p>
        ${processing ? `<div class="ocr-progress" role="progressbar" aria-label="截图文字识别进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${capture.progress}"><span style="width:${capture.progress}%"></span></div>` : ""}
        ${capture.error ? `<div class="ocr-error" role="alert">${icon("warning")}<span><strong>自动识别没有完成</strong><small>${escapeHtml(capture.error)}。你仍可在右侧手动输入后确认使用。</small></span></div>` : ""}
      </div>
      <div class="ocr-review-column">
        ${editable ? `<div class="ocr-review-heading"><div><p class="eyebrow">系统识别到这些内容</p><h3>请检查并修改</h3></div><button class="button ghost compact-button" type="button" data-action="clear-screenshot">重新选择</button></div>
          <div class="ocr-meta-grid">
            <label>截图标题<input data-field="screenshotTitle" value="${escapeHtml(capture.title)}" maxlength="80" placeholder="例如：8 月 24 日发布数据" /></label>
            <label>内容类型<select data-field="screenshotCategory">${screenshotCategoryOptions.map((item) => `<option value="${item.value}" ${capture.category === item.value ? "selected" : ""}>${escapeHtml(item.label)} · ${escapeHtml(item.route)}</option>`).join("")}</select></label>
          </div>
          <label for="screenshot-text">识别正文</label>
          <textarea id="screenshot-text" data-field="screenshotText" rows="8" placeholder="自动识别失败时，可把截图中的关键文字手动输入这里">${escapeHtml(capture.text)}</textarea>
          ${capture.text.trim() ? renderScreenshotInsights(capture) : `<p class="ocr-empty-result">还没有识别到文字。可以手动输入至少 4 个字，再确认使用。</p>`}
          <button class="button primary full" type="button" data-action="confirm-screenshot" ${capture.text.trim().length < 4 ? "disabled" : ""}>${icon("check")}确认识别结果并继续分析</button>`
          : `<div class="ocr-placeholder"><span>${icon("shield")}</span><strong>AI 先识别，你再确认</strong><p>游戏资料会进入候选选题；发布数据进入待复盘记录；评论会提炼问题、反对意见和新选题。</p></div>`}
      </div>
    </div>
    ${recent.length ? `<div class="ocr-recent"><strong>最近确认的截图</strong><div>${recent.map((record) => `<article>${record.preview ? `<img src="${escapeHtml(record.preview)}" alt="" />` : ""}<span><b>${escapeHtml(record.title)}</b><small>${escapeHtml(record.categoryLabel)} · ${escapeHtml(record.route)}</small></span></article>`).join("")}</div></div>` : ""}
  </section>`;
}

function renderHome() {
  const selected = project.topics.find((topic) => topic.id === state.selectedTopicId) || project.topics[0];
  const inputActionLabel = state.aiBusy && state.aiTaskMessage.includes("输入") ? state.aiTaskMessage : state.inputAnalysis ? "重新分析我的输入" : "分析我的输入";
  return shell("home", `
    ${pageHeader("今日创作建议", "不知道发什么？先从值得收藏的题开始", "输入一句灵感或公开网页链接，系统先整理事实边界，再按搜索需求、收藏价值、长期有效性和新手痛点生成候选方向。", `<div class="sample-date"><span>样例日期</span><strong>${project.sampleDate}</strong></div>`)}
    ${renderVersionHistory()}
    <section class="hero-grid">
      <div class="panel input-panel">
        <div class="section-title"><div><p class="eyebrow">统一输入</p><h2>给工具一点线索</h2></div><span class="status-pill success">AI 已接入</span></div>
        <label for="account-name">发布账号名</label>
        <input id="account-name" data-field="accountName" value="${escapeHtml(state.accountName)}" autocomplete="off" />
        <label for="source-input">粘贴链接、文案或灵感</label>
        <textarea id="source-input" rows="4" data-field="sourceInput" placeholder="例如：我想做新赛季阵容推荐；也可以粘贴一个公开网页链接，让系统借鉴正文创作">${escapeHtml(state.sourceInput)}</textarea>
        <div class="theme-suggestions" aria-label="金铲铲主题示例">
          <span>试试这些主题</span>
          ${["新赛季阵容推荐", "强化符文怎么选", "运营与搜牌节奏", "羁绊转职解析", "英雄主 C 攻略", "站位与对位技巧", "版本更新解读", "新手避坑指南"].map((item) => `<button type="button" data-action="use-theme-example" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
        </div>
        <p class="helper-text">支持任意金铲铲相关主题。粘贴公开网页后会读取正文；确认识别结果后，候选选题、观点和七页内容都会围绕原文重新生成。</p>
        ${renderAiModeInline()}
        <button class="button primary full" type="button" data-action="analyze-source-input" ${state.aiBusy || !state.sourceInput.trim() ? "disabled" : ""} aria-busy="${state.aiBusy}">${icon("search")}${escapeHtml(inputActionLabel)}</button>
      </div>
      <aside class="panel ranking-panel">
        <div class="section-title"><div><p class="eyebrow">当前版本热门阵容榜</p><h2>榜单位置预演</h2></div><span class="status-pill warning">非实时</span></div>
        <p class="panel-note">这里只验证信息结构，不提供当前版本强度结论。</p>
        <ol class="ranking-list">
          ${project.demoLineups.map((item) => `<li><span class="rank">${item.rank}</span><div><strong>${item.name}</strong><small>${item.delta}</small></div><span>${item.status}</span></li>`).join("")}
        </ol>
      </aside>
    </section>
    ${renderScreenshotOcr()}
    ${renderInputAnalysis()}
    <section class="section-block" aria-labelledby="topic-title">
      <div class="section-title"><div><p class="eyebrow">没有输入时的样例选题</p><h2 id="topic-title">示例推荐顺序</h2></div><span class="sort-note">输入任意主题可替换</span></div>
      <div class="topic-grid">
        ${project.topics.map((topic, index) => `
          <button class="topic-card ${topic.id === state.selectedTopicId ? "is-selected" : ""}" type="button" data-action="select-topic" data-id="${topic.id}" aria-pressed="${topic.id === state.selectedTopicId}">
            <span class="topic-number">0${index + 1}</span>
            <span class="topic-badge">${escapeHtml(topic.badge)}</span>
            <strong>${escapeHtml(topic.title)}</strong>
            <span class="topic-angle">${escapeHtml(topic.angle)}</span>
            <span class="topic-score"><b>${topic.recommendation}</b><small>综合推荐</small></span>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="panel selected-topic">
      <div class="selected-copy"><p class="eyebrow">已选题目</p><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.angle)}</p></div>
      <div class="score-list">
        ${scoreRow("搜索需求", selected.freshness)}
        ${scoreRow("收藏价值", selected.saveValue)}
        ${scoreRow("长期有效", selected.evergreen)}
        ${scoreRow("新手痛点", selected.pain)}
      </div>
      <button class="button primary" type="button" data-action="start-research">开始研究 ${icon("arrow")}</button>
    </section>
  `);
}

function evidenceCard(item) {
  const labels = { green: "可用", yellow: "待核验", red: "禁止进入生成" };
  return `<article class="evidence-card status-${item.status}">
    <div class="evidence-head"><span class="status-dot" aria-hidden="true"></span><strong>${escapeHtml(item.label)}</strong><span>${labels[item.status]}</span></div>
    <p>${escapeHtml(item.claim)}</p>
    <details><summary>查看来源说明</summary><div><b>来源：</b>${escapeHtml(item.source)}<br/><b>备注：</b>${escapeHtml(item.note)}</div></details>
  </article>`;
}

function viewpointFingerprint(targetId = state.pendingViewpointId) {
  return JSON.stringify({
    pages: state.pages,
    currentViewpointId: state.viewpointId,
    targetId,
    conflicts: state.viewpointConflicts,
  });
}

function renderViewpointConflictAlert() {
  if (!state.viewpointConflicts.length) return "";
  return `<section class="viewpoint-conflict-alert" role="alert" aria-labelledby="viewpoint-conflict-title">
    <div>${icon("warning")}<span><strong id="viewpoint-conflict-title">${state.viewpointConflicts.length} 页与当前观点直接冲突</strong><small>冲突处理完成前，正式导出会被阻止；结构化草稿仍可下载检查。</small></span></div>
    <ul>${state.viewpointConflicts.map((item) => `<li><b>第 ${item.pageNo} 页</b><span>${escapeHtml(item.title)}：${escapeHtml(item.reason)}</span></li>`).join("")}</ul>
    <div><button class="button secondary" type="button" data-action="review-current-viewpoint">重新检查并处理</button><a class="button ghost link-button" href="#/editor">去编辑页解锁</a></div>
  </section>`;
}

function renderViewpointImpact() {
  if (!state.pendingViewpointId || !state.viewpointImpact.length) return "";
  const target = project.viewpoints.find((item) => item.id === state.pendingViewpointId);
  if (!target) return "";
  const impactIsCurrent = state.viewpointImpactFingerprint === viewpointFingerprint();
  const counts = state.viewpointImpact.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, { aligned: 0, rewrite: 0, conflict: 0 });
  const rewriteCount = state.viewpointImpact.filter((item) => (
    item.canRewrite
    && (item.status === "conflict" || state.viewpointDecisions[item.pageId] === "rewrite")
  )).length;
  const keepCount = state.viewpointImpact.filter((item) => (
    item.status === "aligned" || state.viewpointDecisions[item.pageId] === "keep"
  )).length;
  const lockedConflictCount = state.viewpointImpact.filter((item) => item.status === "conflict" && item.locked).length;
  const statusLabel = { aligned: "可以保留", rewrite: "建议重写", conflict: "直接冲突" };
  const statusIcon = { aligned: "check", rewrite: "refresh", conflict: "warning" };
  const resolving = state.pendingViewpointId === state.viewpointId;

  return `<section class="viewpoint-impact-panel" aria-labelledby="viewpoint-impact-title">
    <div class="viewpoint-impact-heading">
      <div>${icon("eye")}<span><p class="eyebrow">${resolving ? "处理当前观点" : "切换前预览"}</p><h2 id="viewpoint-impact-title">${escapeHtml(target.title)}</h2><small>${escapeHtml(target.summary)}</small></span></div>
      <span class="status-pill ${lockedConflictCount ? "danger" : "neutral"}">${lockedConflictCount ? `${lockedConflictCount} 个锁定冲突` : "尚未修改草稿"}</span>
    </div>
    <div class="viewpoint-impact-summary" aria-label="观点影响汇总">
      <span>${icon("check")}<b>${counts.aligned}</b> 页一致</span>
      <span>${icon("refresh")}<b>${counts.rewrite}</b> 页建议重写</span>
      <span class="has-conflict">${icon("warning")}<b>${counts.conflict}</b> 页直接冲突</span>
      <em>${impactIsCurrent ? "分析结果为最新" : "页面已变化，请重新检查"}</em>
    </div>
    <div class="viewpoint-impact-list" role="list" aria-label="七页观点影响清单">
      ${state.viewpointImpact.map((item) => {
        const decision = state.viewpointDecisions[item.pageId] || "keep";
        return `<article class="viewpoint-impact-row is-${item.status}" role="listitem">
          <span class="viewpoint-impact-page">0${item.pageNo}</span>
          <div class="viewpoint-impact-copy"><div><strong>${escapeHtml(item.title)}</strong><span class="viewpoint-impact-status is-${item.status}">${icon(statusIcon[item.status])}${statusLabel[item.status]}</span></div><p>${escapeHtml(item.reason)}</p>${item.fields.length ? `<small>可能变化：${escapeHtml(item.fields.join("、"))}</small>` : ""}${item.protectedFieldLabels.length ? `<em>保护：${escapeHtml(item.protectedFieldLabels.join("、"))}</em>` : ""}</div>
          <div class="viewpoint-decision" aria-label="第 ${item.pageNo} 页处理方式">
            ${item.status === "aligned"
              ? `<span class="decision-fixed">${icon("check")}保留原页</span>`
              : item.status === "conflict"
                ? `<span class="decision-fixed is-conflict">${icon(item.locked ? "lock" : "refresh")}${item.locked ? "锁定，暂无法重写" : "必须按新观点重写"}</span>`
                : `<label><input type="radio" name="viewpoint-decision-${escapeHtml(item.pageId)}" data-field="viewpointDecision" data-id="${escapeHtml(item.pageId)}" value="keep" ${decision === "keep" ? "checked" : ""}/>保留原页</label><label><input type="radio" name="viewpoint-decision-${escapeHtml(item.pageId)}" data-field="viewpointDecision" data-id="${escapeHtml(item.pageId)}" value="rewrite" ${decision === "rewrite" ? "checked" : ""} ${item.canRewrite ? "" : "disabled"}/>按新观点重写</label>`}
          </div>
        </article>`;
      }).join("")}
    </div>
    ${lockedConflictCount ? `<p class="viewpoint-block-note" role="status">${icon("warning")}锁定冲突不会被静默覆盖。你可以先确认切换，但正式导出会保持阻塞，直到解锁并重写这些页面。</p>` : ""}
    <div class="viewpoint-impact-actions"><button class="button ghost" type="button" data-action="cancel-viewpoint-impact">取消</button><button class="button primary" type="button" data-action="confirm-viewpoint-impact" ${impactIsCurrent ? "" : "disabled"}>${icon("check")}${resolving ? "确认处理" : "确认切换"} · 重写 ${rewriteCount} 页／保留 ${keepCount} 页</button></div>
  </section>`;
}

function renderResearch() {
  if (state.customProject?.research) return renderDynamicResearch();
  const topic = project.topics.find((item) => item.id === state.selectedTopicId) || project.topics[0];
  const selected = project.viewpoints.find((item) => item.id === state.viewpointId) || project.viewpoints[0];
  return shell("research", `
    ${pageHeader("为什么值得做", topic.title, "收藏价值和新手痛点都很强；内容长期有效，具体赛季数值发布前仍需核对页面日期。", `<span class="recommend-score"><b>${topic.recommendation}</b><small>综合推荐</small></span>`)}
    ${renderVersionHistory()}
    ${renderViewpointConflictAlert()}
    <section class="research-summary panel">
      <div><span class="mini-label">差异空间</span><h2>不让新手背表，而是教会判断顺序</h2><p>大多数合成图只解决“是什么”，这篇继续解释“给谁、为什么、没有时怎么替”。</p></div>
      <div><span class="mini-label">系统建议</span><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.fit)}</p></div>
    </section>
    <section class="section-block" aria-labelledby="viewpoint-title">
      <div class="section-title"><div><p class="eyebrow">选择站位</p><h2 id="viewpoint-title">同一题可以有 3 种讲法</h2></div><span class="sort-note">切换后再生成大纲</span></div>
      <div class="viewpoint-grid">
        ${project.viewpoints.map((viewpoint) => `
          <button class="viewpoint-card ${viewpoint.id === state.viewpointId ? "is-selected" : ""}" type="button" data-action="select-viewpoint" data-id="${viewpoint.id}" aria-pressed="${viewpoint.id === state.viewpointId}">
            <span>${viewpoint.recommended ? "系统推荐" : "备选观点"}</span>
            <strong>${escapeHtml(viewpoint.title)}</strong>
            <p>${escapeHtml(viewpoint.summary)}</p>
            <small>${escapeHtml(viewpoint.fit)}</small>
          </button>
        `).join("")}
      </div>
      ${renderViewpointImpact()}
    </section>
    <section class="section-block" aria-labelledby="evidence-title">
      <div class="section-title"><div><p class="eyebrow">证据检查</p><h2 id="evidence-title">事实、决定和未知项分开看</h2></div><a class="text-link" href="#/home">返回换题</a></div>
      <div class="evidence-grid">${project.evidence.map(evidenceCard).join("")}</div>
    </section>
    <div class="bottom-action"><div><strong>当前观点：${escapeHtml(selected.title)}</strong><span>主要观点确认后，不会被整体重写静默改变。</span></div><button class="button primary" type="button" data-action="build-outline">按这个观点生成七页大纲 ${icon("arrow")}</button></div>
  `);
}

function renderDynamicResearch() {
  const custom = state.customProject;
  const research = custom.research;
  const selected = research.viewpoints.find((item) => item.id === custom.viewpointId) || research.viewpoints[0];
  const factTone = { input_claim: "neutral", source_supported: "success", needs_verification: "warning", blocked: "danger" };
  const factLabel = { input_claim: "来自你的输入", source_supported: "来源支持", needs_verification: "待核验", blocked: "禁止使用" };
  return shell("research", `
    ${pageHeader("动态研究卡", custom.topic.title, research.summary, `<span class="recommend-score"><b>${custom.topic.recommendation}</b><small>综合推荐</small></span>`)}
    ${renderVersionHistory()}
    <section class="research-summary panel dynamic-research-summary">
      <div><span class="mini-label">为什么值得做</span><h2>${escapeHtml(research.whyWorth)}</h2><p>${escapeHtml(research.whyNow)}</p></div>
      <div><span class="mini-label">当前选中观点</span><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.fit)}</p></div>
    </section>
    <section class="section-block" aria-labelledby="dynamic-viewpoint-title">
      <div class="section-title"><div><p class="eyebrow">先选择站位</p><h2 id="dynamic-viewpoint-title">同一题的 3 种讲法</h2></div><span class="sort-note">选择后才生成七页大纲</span></div>
      <div class="viewpoint-grid dynamic-viewpoint-grid">${research.viewpoints.map((viewpoint) => `<button class="viewpoint-card ${viewpoint.id === selected.id ? "is-selected" : ""}" type="button" data-action="select-dynamic-viewpoint" data-id="${escapeHtml(viewpoint.id)}" aria-pressed="${viewpoint.id === selected.id}"><span>${viewpoint.recommended ? "系统推荐" : "备选观点"}</span><strong>${escapeHtml(viewpoint.title)}</strong><p>${escapeHtml(viewpoint.summary)}</p><small>${escapeHtml(viewpoint.fit)}</small><em>${icon("warning")}风险：${escapeHtml(viewpoint.risk)}</em></button>`).join("")}</div>
    </section>
    <section class="section-block" aria-labelledby="dynamic-evidence-title">
      <div class="section-title"><div><p class="eyebrow">证据检查</p><h2 id="dynamic-evidence-title">事实、来源和未知项分开看</h2></div><a class="text-link" href="#/home">返回换题</a></div>
      <div class="dynamic-boundary-grid">
        <div class="panel"><h3>沿用的事实边界</h3><div class="analysis-fact-list">${custom.facts.map((fact) => `<article><span class="status-pill ${factTone[fact.status] || "warning"}">${factLabel[fact.status] || "待核验"}</span><strong>${escapeHtml(fact.label)}</strong><p>${escapeHtml(fact.claim)}</p></article>`).join("")}</div></div>
        <div class="panel"><h3>争议与缺口</h3><div class="dynamic-dispute-list">${research.disputes.map((item) => `<article class="is-${escapeHtml(item.status)}"><span class="status-pill ${item.status === "blocked" ? "danger" : "warning"}">${item.status === "blocked" ? "禁止使用" : "待核验"}</span><strong>${escapeHtml(item.claim)}</strong><p>${escapeHtml(item.guidance)}</p></article>`).join("")}</div>${research.questions.length ? `<h3>生成前还可补充</h3><ul>${research.questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</div>
      </div>
    </section>
    <div class="bottom-action"><div><strong>当前观点：${escapeHtml(selected.title)}</strong><span>大纲只能引用当前研究卡中的事实；待核验内容会保留为素材缺口。</span></div><button class="button primary" type="button" data-action="build-dynamic-outline" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy && state.aiTaskMessage.includes("大纲") ? escapeHtml(state.aiTaskMessage) : `确认观点并生成七页大纲 ${icon("arrow")}`}</button></div>
  `);
}

function pageStatus(page) {
  return page.locked
    ? `<span class="status-pill success">${icon("lock")}已锁定</span>`
    : `<span class="status-pill neutral">可编辑</span>`;
}

function beginOutlineEdit(page, dynamic = false) {
  state.outlineEditingPageNo = page.pageNo;
  state.outlineEditorDraft = {
    kicker: page.kicker || "",
    title: page.title || "",
    summary: dynamic ? (page.summary || "") : (page.subtitle || page.purpose || ""),
    keyPointsText: dynamic ? (page.keyPoints || []).join("\n") : (page.blocks?.[0]?.items || []).map((item) => typeof item === "string" ? item : item.detail || "").join("\n"),
  };
  state.outlineOriginalDraft = structuredClone(state.outlineEditorDraft);
  state.outlineEditError = "";
  state.outlineRewriteSuggestion = "";
}

function outlineDraftAsEditablePage(pageNo, draft) {
  const keyPoints = String(draft?.keyPointsText || "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  return {
    id: `outline-draft-${pageNo}`,
    pageNo,
    kicker: draft?.kicker || "",
    title: draft?.title || "",
    subtitle: draft?.summary || "",
    locked: false,
    preservedFields: [],
    blocks: [{
      kind: "steps",
      items: keyPoints.map((detail, index) => ({ name: `页面要点 ${index + 1}`, detail })),
    }],
  };
}

async function rewriteOutlineDraftWithAi() {
  const pageNo = state.outlineEditingPageNo;
  const draft = state.outlineEditorDraft;
  if (!pageNo || !draft || state.aiBusy) return;
  const suggestion = resolveOutlineRewriteInstruction(draft, state.outlineOriginalDraft, state.outlineRewriteSuggestion);
  const editablePage = outlineDraftAsEditablePage(pageNo, draft);
  const original = state.outlineOriginalDraft || draft;
  const userEditedFields = [
    draft.kicker !== original.kicker ? "kicker" : "",
    draft.title !== original.title ? "title" : "",
    draft.summary !== original.summary ? "subtitle" : "",
    draft.keyPointsText !== original.keyPointsText ? "keyPoints" : "",
  ].filter(Boolean);
  const request = createRewriteFieldsRequest(editablePage, suggestion, undefined, {
    surface: "outline",
    currentTitle: draft.title,
    originalTitle: original.title,
    titleWasEdited: draft.title !== original.title,
    userEditedFields,
  });
  state.aiBusy = true;
  state.aiTaskMessage = `正在重写第 ${pageNo} 页大纲…`;
  render();
  try {
    const response = await runAiTask(request, { page: editablePage });
    const rewritten = applyRewriteFieldsResponse([editablePage], request, response)[0];
    state.outlineEditorDraft = {
      kicker: rewritten.kicker,
      title: rewritten.title,
      summary: rewritten.subtitle,
      keyPointsText: (rewritten.blocks?.[0]?.items || []).map((item) => item.detail).filter(Boolean).join("\n"),
    };
    state.outlineRewriteSuggestion = "";
    state.aiBusy = false;
    state.aiTaskMessage = "";
    render();
    showToast(`${aiProviderName(response)} 已重写第 ${pageNo} 页大纲，请确认后保存`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    render();
    showToast(error instanceof Error ? error.message : "AI 重写失败，原大纲内容已保留");
  }
}

function outlineEditForm(page, dynamic = false) {
  if (state.outlineEditingPageNo !== page.pageNo || !state.outlineEditorDraft) return "";
  const draft = state.outlineEditorDraft;
  const roleLabels = { cover: "封面", problem: "问题", framework: "框架", detail: "展开", mistake: "误区／替代", summary: "总结" };
  return `<form class="outline-edit-form" data-outline-page="${page.pageNo}" aria-label="编辑第 ${page.pageNo} 页大纲">
    <div class="outline-edit-heading"><div><strong>编辑第 ${page.pageNo} 页</strong><span>保存后会直接带入第四步排版</span></div>${dynamic ? `<span class="status-pill neutral">${escapeHtml(roleLabels[page.role] || page.role)}</span>` : ""}</div>
    ${state.outlineEditError ? `<p class="outline-edit-error" role="alert">${escapeHtml(state.outlineEditError)}</p>` : ""}
    <div class="outline-edit-grid">
      <label>页签<span>页面上方的小标题</span><input data-field="outlineKicker" value="${escapeHtml(draft.kicker)}" maxlength="28" autocomplete="off" /></label>
      <label class="outline-title-field">页面标题<span>这一页最重要的一句话</span><textarea data-field="outlineTitle" rows="2" maxlength="64">${escapeHtml(draft.title)}</textarea></label>
      <label class="outline-wide-field">页面说明<span>说明这一页要解决什么问题</span><textarea data-field="outlineSummary" rows="2" maxlength="120">${escapeHtml(draft.summary)}</textarea></label>
      ${dynamic ? `<label class="outline-wide-field">页面要点<span>每行一条，保留 2～4 条</span><textarea data-field="outlineKeyPoints" rows="4" maxlength="320">${escapeHtml(draft.keyPointsText)}</textarea></label>` : ""}
    </div>
    <div class="outline-ai-rewrite">
      <div><strong>${icon("refresh")}AI 重写这页</strong><span>${state.aiStatus?.mode === "live" ? "会读取你刚改的标题和修改要求，只重写当前页" : "需要连接在线 AI 后才会执行，不再使用演示改写"}</span></div>
      <label class="sr-only" for="outline-rewrite-${page.pageNo}">第 ${page.pageNo} 页 AI 重写意见</label>
      <textarea id="outline-rewrite-${page.pageNo}" rows="2" data-field="outlineRewriteSuggestion" placeholder="可选：补充修改意见；留空时按你刚改的标题、说明和要点重写">${escapeHtml(state.outlineRewriteSuggestion)}</textarea>
      <button class="button secondary" type="button" data-action="rewrite-outline-page" ${state.aiBusy ? "disabled" : ""} aria-busy="${state.aiBusy}">${icon("refresh")}${state.aiBusy ? escapeHtml(state.aiTaskMessage || "AI 正在处理…") : "AI 重写当前页"}</button>
      ${renderAiModeInline()}
    </div>
    <div class="outline-edit-actions"><button class="button ghost" type="button" data-action="cancel-outline-edit">取消</button><button class="button primary" type="submit">保存这一页</button></div>
  </form>`;
}

function outlineEditButton(page) {
  const editing = state.outlineEditingPageNo === page.pageNo;
  return `<button class="outline-edit-button ${editing ? "is-active" : ""}" type="button" data-action="edit-outline-page" data-page-no="${page.pageNo}" aria-expanded="${editing}" aria-label="编辑第 ${page.pageNo} 页大纲">${icon(editing ? "check" : "edit", editing ? "编辑中" : "编辑本页")}</button>`;
}

function renderOutline() {
  if (state.customProject?.outline) return renderDynamicOutline();
  return shell("outline", `
    ${pageHeader("七页内容大纲", "先确认每页讲什么，再进入排版", "首页给完整合成树，后面按功能解释 12 件常用成装，最后用 4 步口诀收束。")}
    ${renderVersionHistory()}
    <section class="outline-list" aria-label="七页内容顺序">
      ${state.pages.map((page) => `<article class="outline-card ${state.outlineEditingPageNo === page.pageNo ? "is-editing" : ""}">
        <div class="page-no"><span>PAGE</span><strong>0${page.pageNo}</strong></div>
        <div class="outline-copy"><p>${escapeHtml(page.kicker)}</p><h2>${escapeHtml(page.title)}</h2><span>${escapeHtml(page.purpose)}</span></div>
        ${outlineEditButton(page)}
        ${outlineEditForm(page)}
      </article>`).join("")}
    </section>
    <aside class="info-callout"><strong>这版大纲为什么这样排？</strong><p>先给地图，再讲常用装备，最后交付可迁移的判断方法。用户不需要背完，也能在对局里逐步查。</p></aside>
    <div class="bottom-action"><div><strong>${state.outlineConfirmed ? "大纲已确认" : "确认后进入逐页编辑"}</strong><span>编辑器会在 AI 重写前自动保存版本，也可以手动存档和恢复。</span></div><button class="button primary" type="button" data-action="confirm-outline">${state.outlineConfirmed ? icon("check", "继续编辑") : icon("edit", "确认大纲并排版")}</button></div>
  `);
}

function renderDynamicOutline() {
  const custom = state.customProject;
  const outline = custom.outline;
  const viewpoint = custom.research.viewpoints.find((item) => item.id === custom.viewpointId) || custom.research.viewpoints[0];
  const roleLabels = { cover: "封面", problem: "问题", framework: "框架", detail: "展开", mistake: "误区/替代", summary: "总结" };
  return shell("outline", `
    ${pageHeader("动态七页大纲", outline.title, `已按“${viewpoint.title}”组织内容；先确认每页讲什么，再进入动态页面生成。`)}
    ${renderVersionHistory()}
    <section class="outline-list dynamic-outline-list" aria-label="动态七页内容顺序">${outline.pages.map((page) => `<article class="outline-card dynamic-outline-card ${state.outlineEditingPageNo === page.pageNo ? "is-editing" : ""}"><div class="page-no"><span>PAGE</span><strong>0${page.pageNo}</strong></div><div class="outline-copy"><p>${escapeHtml(page.kicker)} · ${escapeHtml(roleLabels[page.role] || page.role)}</p><h2>${escapeHtml(page.title)}</h2><span>${escapeHtml(page.summary)}</span><ul>${page.keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><div class="outline-meta"><span>${icon("database")}事实引用 ${page.factIds.length} 条</span><span>${icon("book")}素材：${escapeHtml(page.assetNeeds.join("、") || "待补")}</span></div></div>${outlineEditButton(page)}${outlineEditForm(page, true)}</article>`).join("")}</section>
    <aside class="info-callout"><strong>事实边界仍然有效</strong><p>页面中的“事实引用”只来自研究卡白名单；没有来源支撑的版本强度、数据和英雄例子不会被自动补成结论。</p></aside>
    <div class="bottom-action"><div><strong>${custom.outlineConfirmed && state.contentSource === "dynamic" ? "七页已生成，可继续编辑" : "确认后生成正式七页草稿"}</strong><span>${custom.outlineConfirmed && state.contentSource === "dynamic" ? "系统会优先为每页匹配官方素材或原创概念图；只有图片会干扰阅读时才保留纯文字排版。" : "系统会把研究卡和大纲安全转换为七页内容，不会补写没有来源的版本强度或数据。"}</span></div><button class="button primary" type="button" data-action="${custom.outlineConfirmed && state.contentSource === "dynamic" ? "open-dynamic-editor" : "confirm-dynamic-outline"}">${custom.outlineConfirmed && state.contentSource === "dynamic" ? icon("arrow", "进入逐页编辑") : icon("save", "确认并生成可编辑七页")}</button></div>
  `);
}

function itemToken(name, index = 0, displaySize = 48) {
  const source = getIconSource(name);
  if (!source) {
    const short = name.replace(/[之的]/g, "").slice(0, 2);
    return `<span class="item-token tone-${(index % 4) + 1}" aria-label="${escapeHtml(name)}"><b>${escapeHtml(short)}</b></span>`;
  }
  const style = `width:${displaySize}px;height:${displaySize}px`;
  return `<span class="item-token game-item-icon" style="${style}"><img src="${source}" alt="${escapeHtml(name)}装备图标" width="128" height="128" loading="eager" decoding="async" draggable="false"></span>`;
}

function previewPage(page) {
  const model = buildPageRenderModel(page, state.accountName, state.pages.length);
  return `<div class="final-render-preview" data-preview-page-id="${escapeHtml(page.id)}">
    <canvas class="final-render-preview-canvas" width="1080" height="1440" role="img" aria-label="第 ${model.pageNo} 页最终成图预览，与导出 PNG 一致"></canvas>
    <div class="final-render-preview-status" data-preview-status role="status" aria-live="polite">
      <span class="preview-loading-ring" aria-hidden="true"></span>
      <span><strong>正在同步最终成图</strong><small>使用与下载 PNG 相同的 1080 × 1440 排版</small></span>
    </div>
    <p class="sr-only">这是第 ${model.pageNo} 页的最终成图预览，画面比例为手机图文常用的 3 比 4。</p>
  </div>`;
}

let editorPreviewTimer = 0;
let editorPreviewRequest = 0;

function scheduleEditorFinalPreview(page, delay = 80) {
  window.clearTimeout(editorPreviewTimer);
  const requestId = ++editorPreviewRequest;
  const expectedPageId = page?.id || "";
  const pageSnapshot = structuredClone(page);
  const accountName = state.accountName;
  editorPreviewTimer = window.setTimeout(async () => {
    try {
      const rendered = await renderPageToCanvas(pageSnapshot, accountName);
      if (requestId !== editorPreviewRequest || currentRoute() !== "editor") return;
      const target = document.querySelector(".final-render-preview-canvas");
      const frame = target?.closest(".final-render-preview");
      if (!target || frame?.dataset.previewPageId !== expectedPageId) return;
      target.width = rendered.width;
      target.height = rendered.height;
      target.style.aspectRatio = `${rendered.width} / ${rendered.height}`;
      frame.style.aspectRatio = `${rendered.width} / ${rendered.height}`;
      const context = target.getContext("2d", { alpha: false });
      context.drawImage(rendered, 0, 0);
      target.classList.add("is-ready");
      frame.classList.add("is-ready");
      const status = frame.querySelector("[data-preview-status]");
      if (status) status.innerHTML = `<span class="preview-ready-mark">${icon("check")}</span><span><strong>预览已与最终成图同步</strong><small>第四步所见即第五步所得</small></span>`;
    } catch (error) {
      if (requestId !== editorPreviewRequest) return;
      const frame = document.querySelector(`.final-render-preview[data-preview-page-id="${CSS.escape(expectedPageId)}"]`);
      if (!frame) return;
      frame.classList.add("has-error");
      const status = frame.querySelector("[data-preview-status]");
      if (status) status.innerHTML = `<span class="preview-error-mark">!</span><span><strong>预览暂时没有生成</strong><small>${escapeHtml(error?.message || "请稍后重新选择这一页")}</small></span>`;
    }
  }, delay);
}

function preserveFieldLabel(page, inputId, label, fieldKey) {
  const preserved = isFieldPreserved(page, fieldKey);
  const actionLabel = preserved ? `取消保留${label}` : `保留${label}`;
  return `<div class="field-label-row">
    <label for="${escapeHtml(inputId)}">${escapeHtml(label)}</label>
    <button class="preserve-field-button ${preserved ? "is-preserved" : ""}" type="button" data-action="toggle-field-preserve" data-field-key="${escapeHtml(fieldKey)}" aria-label="${escapeHtml(actionLabel)}" aria-pressed="${preserved}" ${page.locked ? "disabled" : ""}>${preserved ? icon("lock", "已保留") : icon("unlock", "保留")}</button>
  </div>`;
}

function renderDetailEditor(page) {
  const block = page.blocks[0];
  const disabled = page.locked ? "disabled" : "";
  if (block.kind === "equipment") {
    const manuallyOrdered = hasManualOrder(page);
    return `<details class="detail-editor" open>
      <summary>装备讲解（${block.items.length} 条）</summary>
      <div class="manual-order-bar ${manuallyOrdered ? "is-manual" : ""}" role="status">
        ${icon("sort")}
        <span><strong>${manuallyOrdered ? "人工顺序已保护" : "当前使用系统顺序"}</strong><small>${manuallyOrdered ? "AI 重写只改文字，不会重新排列装备卡" : "需要调整时，可用每张卡片上的上移和下移"}</small></span>
        ${manuallyOrdered ? `<button class="button ghost compact-button" type="button" data-action="reset-equipment-order" ${disabled}>恢复系统顺序</button>` : ""}
      </div>
      <div class="detail-editor-list">${block.items.map((item, index) => `
        <fieldset>
          <legend>${itemToken(item.name, index, 34)}<span>${escapeHtml(item.name)}</span></legend>
          <div class="item-order-actions" aria-label="调整 ${escapeHtml(item.name)} 的顺序">
            <span>第 ${index + 1} 张</span>
            <button class="order-button" type="button" data-action="move-equipment-item" data-index="${index}" data-direction="up" aria-label="上移 ${escapeHtml(item.name)}" ${page.locked || index === 0 ? "disabled" : ""}>${icon("arrowUp", "上移")}</button>
            <button class="order-button" type="button" data-action="move-equipment-item" data-index="${index}" data-direction="down" aria-label="下移 ${escapeHtml(item.name)}" ${page.locked || index === block.items.length - 1 ? "disabled" : ""}>${icon("arrowDown", "下移")}</button>
          </div>
          ${preserveFieldLabel(page, `item-detail-${index}`, "适用场景", `items.${index}.detail`)}
          <textarea id="item-detail-${index}" rows="3" data-field="itemDetail" data-index="${index}" ${disabled}>${escapeHtml(item.detail)}</textarea>
          ${preserveFieldLabel(page, `item-cue-${index}`, "选择判断", `items.${index}.cue`)}
          <textarea id="item-cue-${index}" rows="3" data-field="itemCue" data-index="${index}" ${disabled}>${escapeHtml(item.cue)}</textarea>
        </fieldset>
      `).join("")}</div>
    </details>`;
  }
  if (block.kind === "steps") {
    return `<details class="detail-editor" open>
      <summary>页面要点（${block.items.length} 条）</summary>
      <div class="detail-editor-list">${block.items.map((item, index) => {
        const step = typeof item === "string" ? { name: item, detail: "", example: "" } : item;
        return `<fieldset>
          <legend>${step.iconName ? itemToken(step.iconName, index, 34) : ""}<span>0${index + 1} · ${escapeHtml(step.name)}</span></legend>
          ${preserveFieldLabel(page, `step-detail-${index}`, "怎么判断", `items.${index}.detail`)}
          <textarea id="step-detail-${index}" rows="3" data-field="stepDetail" data-index="${index}" ${disabled}>${escapeHtml(step.detail)}</textarea>
          ${preserveFieldLabel(page, `step-example-${index}`, "实战提醒", `items.${index}.example`)}
          <textarea id="step-example-${index}" rows="2" data-field="stepExample" data-index="${index}" ${disabled}>${escapeHtml(step.example)}</textarea>
        </fieldset>`;
      }).join("")}</div>
    </details>`;
  }
  return "";
}

function formatVersionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function suggestedVersionName() {
  const route = currentRoute();
  const stepLabel = steps.find((step) => step.id === route)?.label || "当前步骤";
  if (route !== "editor") return `${stepLabel}阶段存档`;
  const pageNo = state.pages.find((page) => page.id === state.currentPageId)?.pageNo || 1;
  return `第 ${pageNo} 页编辑存档`;
}

function renderVersionHistory() {
  const history = normalizeHistory(state.history);
  const versions = [
    ...history.saved.map((version) => ({ ...version, saved: true })),
    ...history.past.map((version) => ({ ...version, saved: false })),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const latest = versions[0];
  const latestDeleted = history.deletedSaved.at(-1);
  const routeOf = (version) => version.workflow?.route || "editor";
  const locationLabel = (version) => {
    const route = routeOf(version);
    const step = steps.find((item) => item.id === route)?.label || "编辑";
    if (route !== "editor") return step;
    const page = version.pages.find((item) => item.id === version.currentPageId) || version.pages[0];
    return `${step} · 第 ${page?.pageNo || 1} 页`;
  };
  const filtered = state.versionFilter === "all"
    ? versions
    : versions.filter((version) => routeOf(version) === state.versionFilter);
  const option = (value, label) => `<option value="${value}" ${state.versionFilter === value ? "selected" : ""}>${label}</option>`;
  const saveForm = state.versionSaveOpen ? `<div class="version-name-form" role="group" aria-labelledby="save-version-title">
    <label id="save-version-title" for="version-save-name">给这次存档起个名字</label>
    <input id="version-save-name" data-field="versionSaveName" maxlength="40" value="${escapeHtml(state.versionSaveName)}" autocomplete="off" />
    <small>建议写清用途，例如“封面定稿”或“面试演示版”。最多 40 个字。</small>
    <div><button class="button ghost compact-button" type="button" data-action="cancel-save-version">取消</button><button class="button primary compact-button" type="button" data-action="confirm-save-version" ${state.versionSaveName.trim() ? "" : "disabled"}>${icon("save", "确认保存")}</button></div>
  </div>` : "";
  return `<section class="version-panel" aria-labelledby="version-title">
    <div class="version-summary">
      <div>${icon("history")}<span><strong id="version-title">全流程版本保护</strong><small>${latest ? `最近保存：${escapeHtml(latest.label)} · ${locationLabel(latest)} · ${formatVersionTime(latest.createdAt)}` : "五个步骤共用历史记录，AI 重写前自动保存"}</small></span></div>
      <div class="version-actions" aria-label="版本快捷操作">
        <button class="button ghost compact-button" type="button" data-action="undo-version" ${history.past.length ? "" : "disabled"}>${icon("undo", "撤销")}</button>
        <button class="button ghost compact-button" type="button" data-action="redo-version" ${history.future.length ? "" : "disabled"}>${icon("redo", "重做")}</button>
        <button class="button secondary compact-button" type="button" data-action="open-save-version">${icon("save", "命名保存")}</button>
      </div>
    </div>
    ${saveForm}
    <details class="version-history" ${versions.length ? "" : "data-empty"} ${state.versionRenameId || state.versionDeleteId || state.versionFilter !== "all" || latestDeleted ? "open" : ""}>
      <summary>${icon("history")}查看历史版本（${versions.length}）</summary>
      ${versions.length ? `<div class="version-manager-toolbar"><label for="version-filter">按创作步骤筛选</label><select id="version-filter" data-field="versionFilter">${option("all", `全部步骤（${versions.length}）`)}${steps.map((step) => option(step.id, step.label)).join("")}</select><small>${history.saved.length} 个命名存档 · ${history.past.length} 个自动版本</small></div>
      ${latestDeleted ? `<div class="version-delete-undo" role="status">${icon("trash")}<span>刚删除“${escapeHtml(latestDeleted.label)}”</span><button class="button ghost compact-button" type="button" data-action="undo-delete-version" data-version-id="${escapeHtml(latestDeleted.id)}">撤销删除</button><button class="button ghost compact-button" type="button" data-action="dismiss-delete-version" data-version-id="${escapeHtml(latestDeleted.id)}">不再提示</button></div>` : ""}
      ${filtered.length ? `<ol class="version-list">${filtered.map((version) => {
        const lockedCount = version.pages.filter((item) => item.locked).length;
        const renaming = version.saved && state.versionRenameId === version.id;
        const deleting = version.saved && state.versionDeleteId === version.id;
        return `<li class="${version.saved ? "is-saved" : "is-auto"}">
          <div class="version-copy"><strong>${version.saved ? `<span class="saved-version-label">命名存档</span>` : `<span class="auto-version-label">自动版本</span>`}${escapeHtml(version.label)}</strong><span>${formatVersionTime(version.createdAt)} · ${locationLabel(version)} · ${lockedCount} 页已锁</span></div>
          <div class="version-row-actions"><button class="button ghost compact-button" type="button" data-action="restore-version" data-version-id="${escapeHtml(version.id)}" aria-label="恢复 ${escapeHtml(version.label)}">恢复</button>${version.saved ? `<button class="button ghost compact-button" type="button" data-action="open-rename-version" data-version-id="${escapeHtml(version.id)}" aria-label="改名 ${escapeHtml(version.label)}">改名</button><button class="button danger-ghost compact-button" type="button" data-action="open-delete-version" data-version-id="${escapeHtml(version.id)}" aria-label="删除 ${escapeHtml(version.label)}">${icon("trash", "删除")}</button>` : ""}</div>
          ${renaming ? `<div class="version-inline-form" role="group" aria-label="给 ${escapeHtml(version.label)} 改名"><label for="rename-${escapeHtml(version.id)}">新的存档名称</label><input id="rename-${escapeHtml(version.id)}" data-field="versionRenameValue" maxlength="40" value="${escapeHtml(state.versionRenameValue)}" autocomplete="off"/><div><button class="button ghost compact-button" type="button" data-action="cancel-rename-version">取消</button><button class="button primary compact-button" type="button" data-action="confirm-rename-version" data-version-id="${escapeHtml(version.id)}" ${state.versionRenameValue.trim() ? "" : "disabled"}>保存名称</button></div></div>` : ""}
          ${deleting ? `<div class="version-delete-confirm" role="alert"><span><strong>确定删除这个命名存档？</strong><small>只会移除存档入口，不会删除当前草稿；删除后仍可撤销。</small></span><div><button class="button ghost compact-button" type="button" data-action="cancel-delete-version">取消</button><button class="button danger compact-button" type="button" data-action="confirm-delete-version" data-version-id="${escapeHtml(version.id)}">确认删除</button></div></div>` : ""}
        </li>`;
      }).join("")}</ol>` : `<p class="version-empty">这个步骤还没有历史版本，可以换一个筛选条件查看。</p>`}` : `<p class="version-empty">还没有历史版本。你可以先点击“命名保存”，或让 AI 修改一次页面。</p>`}
    </details>
  </section>`;
}

function applyHistoryResult(result) {
  if (!result.changed) return false;
  clearRewriteImpact();
  clearViewpointImpact();
  state.history = result.history;
  if (result.workflow) {
    const restored = structuredClone(result.workflow);
    const fields = [
      "accountName",
      "sourceInput",
      "customProject",
      "contentSource",
      "selectedTopicId",
      "viewpointId",
      "viewpointConflicts",
      "outlineConfirmed",
      "pages",
      "currentPageId",
      "publishBody",
      "publishBodyPreserved",
    ];
    fields.forEach((field) => {
      if (field in restored) state[field] = restored[field];
    });
    if (restored.route && restored.route !== currentRoute()) location.hash = `#/${restored.route}`;
  } else {
    state.pages = result.pages;
    state.currentPageId = result.currentPageId;
  }
  saveState();
  return true;
}

function workflowSnapshot(route = currentRoute()) {
  return structuredClone({
    route,
    accountName: state.accountName,
    sourceInput: state.sourceInput,
    customProject: state.customProject,
    contentSource: state.contentSource,
    selectedTopicId: state.selectedTopicId,
    viewpointId: state.viewpointId,
    viewpointConflicts: state.viewpointConflicts,
    outlineConfirmed: state.outlineConfirmed,
    pages: state.pages,
    currentPageId: state.currentPageId,
    publishBody: state.publishBody,
    publishBodyPreserved: state.publishBodyPreserved,
  });
}

function checkpoint(label, snapshot = workflowSnapshot()) {
  state.history = checkpointHistory(
    state.history,
    snapshot.pages,
    snapshot.currentPageId,
    label,
    { workflow: snapshot },
  );
}

function clearRewriteImpact() {
  state.rewriteImpact = [];
  state.rewriteImpactSuggestion = "";
  state.rewriteImpactFingerprint = "";
  state.rewriteSelectedPageIds = [];
}

function clearViewpointImpact() {
  state.pendingViewpointId = "";
  state.viewpointImpact = [];
  state.viewpointDecisions = {};
  state.viewpointImpactFingerprint = "";
}

function openViewpointImpact(targetId) {
  const target = project.viewpoints.find((item) => item.id === targetId);
  if (!target) return false;
  state.pendingViewpointId = targetId;
  state.viewpointImpact = analyzeViewpointImpact(
    state.pages,
    state.viewpointId,
    targetId,
    state.viewpointConflicts,
  );
  state.viewpointDecisions = Object.fromEntries(
    state.viewpointImpact.map((item) => [item.pageId, item.status === "rewrite" ? "rewrite" : "keep"]),
  );
  state.viewpointImpactFingerprint = viewpointFingerprint(targetId);
  return true;
}

function renderDocumentRewritePanel() {
  const suggestionReady = Boolean(state.documentRewriteSuggestion.trim());
  const impacts = state.rewriteImpact;
  const affected = impacts.filter((item) => item.status === "affected");
  const protectedCount = impacts.filter((item) => item.status === "protected").length;
  const selected = new Set(state.rewriteSelectedPageIds);
  const selectedCount = affected.filter((item) => selected.has(item.pageId)).length;
  const currentFingerprint = JSON.stringify(state.pages);
  const impactIsCurrent = Boolean(impacts.length)
    && state.rewriteImpactSuggestion === state.documentRewriteSuggestion.trim()
    && state.rewriteImpactFingerprint === currentFingerprint;
  const statusLabel = { affected: "会修改", protected: "已保护", unchanged: "不受影响" };
  const statusIcon = { affected: "refresh", protected: "shield", unchanged: "check" };

  return `<section class="document-rewrite-panel" aria-labelledby="document-rewrite-title">
    <div class="document-rewrite-heading">
      <div>${icon("eye")}<span><strong id="document-rewrite-title">整篇智能修改</strong><small>先看影响范围，再决定哪些页要改</small></span></div>
      <span class="status-pill neutral">只读预览，不直接修改</span>
    </div>
    <div class="document-rewrite-controls">
      <label for="document-rewrite-suggestion">给 AI 一句整篇修改意见</label>
      <textarea id="document-rewrite-suggestion" rows="3" data-field="documentRewriteSuggestion" aria-describedby="document-rewrite-help" placeholder="例如：整篇更像朋友安利，补充新手判断">${escapeHtml(state.documentRewriteSuggestion)}</textarea>
      <p class="helper-text" id="document-rewrite-help">系统会模拟分析每页变化；锁定页、保留字段和人工装备顺序不会被覆盖。</p>
      <button class="button secondary" type="button" data-action="analyze-document-rewrite" ${suggestionReady && !state.aiBusy ? "" : "disabled"}>${icon("eye")}<span data-impact-analyze-label>${impacts.length ? "重新分析影响范围" : "预览影响范围"}</span></button>
    </div>
    ${impacts.length ? `<div class="impact-preview ${impactIsCurrent ? "" : "is-stale"}" aria-live="polite">
      <div class="impact-summary">
        <div><strong>${affected.length} 页可能变化</strong><span>${protectedCount} 页受整页锁定保护 · 已选择 ${selectedCount} 页</span></div>
        ${impactIsCurrent
          ? `<span class="impact-current">${icon("check")}分析结果为最新</span>`
          : `<span class="impact-stale">${icon("warning")}内容已变化，请重新分析</span>`}
      </div>
      <div class="impact-page-list" role="list" aria-label="整篇修改影响范围">
        ${impacts.map((item) => {
          const canSelect = item.status === "affected" && impactIsCurrent;
          const changed = item.changedFieldLabels.slice(0, 4);
          const extraCount = Math.max(0, item.changedFieldLabels.length - changed.length);
          const changeText = changed.length
            ? `${changed.join("、")}${extraCount ? `等 ${item.changedFieldLabels.length} 个字段` : ""}`
            : item.reason;
          const protectionText = item.protectedFieldLabels.length
            ? `保护：${item.protectedFieldLabels.join("、")}`
            : "未设置额外保护";
          return `<label class="impact-page is-${item.status}" role="listitem">
            <input type="checkbox" data-field="impactPage" data-id="${escapeHtml(item.pageId)}" ${selected.has(item.pageId) ? "checked" : ""} ${canSelect ? "" : "disabled"} aria-label="选择第 ${item.pageNo} 页进行整篇修改"/>
            <span class="impact-page-no">0${item.pageNo}</span>
            <span class="impact-page-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(changeText)}</small><em>${escapeHtml(protectionText)}</em></span>
            <span class="impact-status is-${item.status}">${icon(statusIcon[item.status])}${statusLabel[item.status]}</span>
          </label>`;
        }).join("")}
      </div>
      <div class="impact-actions">
        <button class="button ghost" type="button" data-action="cancel-document-rewrite">取消预览</button>
        <button class="button primary" type="button" data-action="confirm-document-rewrite" ${impactIsCurrent && selectedCount && !state.aiBusy ? "" : "disabled"} aria-busy="${state.aiBusy}">${icon("refresh")}${state.aiBusy ? escapeHtml(state.aiTaskMessage || "AI 正在处理…") : `确认修改所选 ${selectedCount} 页`}</button>
      </div>
    </div>` : ""}
  </section>`;
}

function renderEditor() {
  const current = state.pages.find((page) => page.id === state.currentPageId) || state.pages[0];
  const currentModel = buildPageRenderModel(current, state.accountName, state.pages.length);
  const usesOfficialAssets = currentModel.type === "tree"
    || currentModel.type === "equipment"
    || currentModel.heroIcons?.length
    || currentModel.heroEntities?.length
    || currentModel.items.some((item) => item?.iconName || item?.imageUrl);
  const visualStatus = currentModel.visual
    ? { label: `配图：${currentModel.visual.label}`, detail: currentModel.visual.reason, tone: "success" }
    : usesOfficialAssets
      ? { label: "官方素材＋文字", detail: currentModel.contentKind === "equipment" ? "本页使用清晰官方装备图标辅助说明。" : "本页使用当前赛季英雄头像，并按主题组织名单或站位。", tone: "success" }
      : { label: "本页以文字为主", detail: "文字已经能完整表达信息，因此不强行添加配图。", tone: "neutral" };
  const preservedCount = normalizePreservedFields(current).length;
  const rewriteDisabled = current.locked || !state.rewriteSuggestion.trim() || state.aiBusy;
  const rewriteHelp = current.locked
    ? "当前页已锁定。点击上方“解锁这一页”，再输入修改建议。"
    : `建议只作为修改指令，不会原样写进成品图。${preservedCount ? `当前有 ${preservedCount} 个字段已保留，AI 会自动跳过。` : "满意的字段可点“保留”，AI 重写时不会覆盖。"}`;
  const rewriteButtonLabel = current.locked
    ? "当前页已锁定，先解锁后修改"
    : state.rewriteSuggestion.trim()
      ? state.aiBusy ? (state.aiTaskMessage || "AI 正在处理…") : "按建议智能修改当前页"
      : "请先输入修改建议";
  return shell("editor", `
    ${pageHeader("图文编辑器", "七页内容逐页编辑，满意的先锁住", "全流程版本保护已接入；AI 修改前自动存档，确认内容后可在导出页下载高清 PNG 或七页 ZIP。", `<span class="autosave-state">${icon("check")}草稿与版本保存在本机</span>`)}
    ${renderVersionHistory()}
    ${renderDocumentRewritePanel()}
    <section class="editor-layout">
      <aside class="page-rail" aria-label="页面列表">
        <div class="rail-title"><strong>页面</strong><span>${state.pages.filter((page) => page.locked).length} 页已锁</span></div>
        ${state.pages.map((page) => `<button class="page-thumb ${page.id === current.id ? "is-selected" : ""}" type="button" data-action="select-page" data-id="${page.id}" aria-pressed="${page.id === current.id}"><span>0${page.pageNo}</span><strong>${escapeHtml(page.title)}</strong>${page.locked ? icon("lock") : ""}</button>`).join("")}
      </aside>
      <section class="canvas-panel" aria-label="当前页面实时预览">
        <div class="canvas-toolbar"><span>手机预览 <small class="sticky-preview-hint">· 长文自动加高</small></span><span class="status-pill ${visualStatus.tone}" title="${escapeHtml(visualStatus.detail)}">${escapeHtml(visualStatus.label)}</span></div>
        ${previewPage(current)}
      </section>
      <aside class="inspector">
        <div class="section-title compact"><div><p class="eyebrow">第 ${current.pageNo} 页</p><h2>内容设置</h2></div>${pageStatus(current)}</div>
        <p class="helper-text"><strong>图文策略：</strong>${escapeHtml(visualStatus.detail)}</p>
        <div class="preservation-summary ${preservedCount ? "has-preserved" : ""}" role="status">${icon(preservedCount ? "lock" : "unlock")}<span><strong>${preservedCount ? `${preservedCount} 个字段已保留` : "还没有保留字段"}</strong><small>${preservedCount ? "AI 修改本页时会自动跳过这些内容" : "保留满意内容，不必锁住整页"}</small></span></div>
        ${preserveFieldLabel(current, "page-title", "主标题", "title")}
        <textarea id="page-title" rows="3" data-field="pageTitle" ${current.locked ? "disabled" : ""}>${escapeHtml(current.title)}</textarea>
        ${preserveFieldLabel(current, "page-subtitle", "补充说明", "subtitle")}
        <textarea id="page-subtitle" rows="3" data-field="pageSubtitle" ${current.locked ? "disabled" : ""}>${escapeHtml(current.subtitle)}</textarea>
        ${renderDetailEditor(current)}
        <button class="button ${current.locked ? "secondary" : "ghost"} full" type="button" data-action="toggle-lock">${current.locked ? icon("unlock", "解锁这一页") : icon("lock", "锁定这一页")}</button>
        <hr/>
        <label for="rewrite-suggestion">给 AI 一句修改意见</label>
        <textarea id="rewrite-suggestion" rows="3" data-field="rewriteSuggestion" aria-describedby="rewrite-help" placeholder="例如：讲详细一点，强调新手最容易踩的坑" ${current.locked ? "disabled" : ""}>${escapeHtml(state.rewriteSuggestion)}</textarea>
        <p class="helper-text" id="rewrite-help">${rewriteHelp}</p>
        ${renderAiModeInline()}
        ${current.rewriteSummary ? `<div class="ai-understood ${current.rewriteMode === "fallback" ? "is-fallback" : ""}" role="status"><strong>${current.rewriteMode === "fallback" ? "已按通用方向处理" : "AI 已理解"}</strong><span>${escapeHtml(current.rewriteSummary)}</span></div>` : ""}
        <button class="button secondary full" type="button" data-action="rewrite-page" ${rewriteDisabled ? "disabled" : ""} aria-busy="${state.aiBusy}">${icon("refresh")}<span data-rewrite-label>${rewriteButtonLabel}</span></button>
        <a class="button primary full link-button" href="#/export">进入导出检查 ${icon("arrow")}</a>
      </aside>
    </section>
  `);
}

function activeExportCopy() {
  if (state.contentSource === "dynamic" && state.customProject?.exportCopy) {
    return state.customProject.exportCopy;
  }
  return project.exportCopy;
}

function renderExport() {
  const exportCopy = activeExportCopy();
  const selectedTitle = exportCopy.titles[0];
  const exportIssues = project.evidence.filter((item) => item.status !== "green");
  const exportIssueCount = exportIssues.length + state.viewpointConflicts.length;
  const hasViewpointBlock = state.viewpointConflicts.length > 0;
  const currentPage = state.pages.find((page) => page.id === state.currentPageId) || state.pages[0];
  const exportDisabled = hasViewpointBlock || state.exportBusy;
  const exportProgress = state.exportBusy
    ? `${state.exportMessage || "正在生成高清图片"}${state.exportTotal ? ` · ${state.exportCurrent}/${state.exportTotal}` : ""}`
    : "导出尺寸 1080 × 1440；生成前会等待本页所需的官方图标和内容配图加载完成。";
  const artifacts = exportArtifacts.fingerprint === exportFingerprint() ? exportArtifacts : null;
  const qualityWarnings = artifacts?.pages.filter((item) => item.audit?.status === "warning") || [];
  const exportFailures = artifacts?.failures || [];
  const hasArtifactIssues = qualityWarnings.length > 0 || exportFailures.length > 0;
  const generatedCount = artifacts?.pages.length || 0;
  const bodySuggestionReady = Boolean(state.publishBodySuggestion.trim());
  const bodyRewriteLabel = state.publishBodyPreserved
    ? "正文已保留，取消后才能重写"
    : bodySuggestionReady
      ? state.aiBusy ? (state.aiTaskMessage || "AI 正在处理…") : "按建议重新生成正文"
      : "请先输入正文修改建议";
  return shell("export", `
    ${pageHeader("导出与沉淀", "一套内容，生成可直接发布的 3:4 图片", "当前页可单独下载 PNG，也可以一次打包七页 ZIP；预览和高清成图共用同一套页面内容模型。")}
    ${renderVersionHistory()}
    <section class="export-grid">
      <div class="panel export-copy">
        <div class="section-title"><div><p class="eyebrow">标题候选</p><h2>选择最适合本篇的切入</h2></div><span class="status-pill neutral">3 个方向</span></div>
        <div class="title-options">${exportCopy.titles.map((title, index) => `<div><span>0${index + 1}</span><strong>${escapeHtml(title)}</strong><button class="icon-button" type="button" data-action="copy-text" data-value="${escapeHtml(title)}" aria-label="复制标题 ${index + 1}">${icon("copy")}</button></div>`).join("")}</div>
        <div class="field-label-row body-preserve-row">
          <label for="publish-body">小红书正文</label>
          <button class="preserve-field-button ${state.publishBodyPreserved ? "is-preserved" : ""}" type="button" data-action="toggle-publish-body-preserve" aria-label="${state.publishBodyPreserved ? "取消保留小红书正文" : "保留小红书正文"}" aria-pressed="${state.publishBodyPreserved}">${state.publishBodyPreserved ? icon("lock", "已保留") : icon("unlock", "保留")}</button>
        </div>
        <textarea id="publish-body" rows="14" data-field="publishBody" aria-describedby="publish-body-help">${escapeHtml(state.publishBody)}</textarea>
        <div class="body-meta" id="publish-body-help"><span>${icon(state.publishBodyPreserved ? "lock" : "check")}${state.publishBodyPreserved ? "正文已保留，AI 不会覆盖" : "正文修改自动保存"}</span><span data-body-count>${state.publishBody.length} 字符</span></div>
        <button class="button secondary" type="button" data-action="copy-publish-body">${icon("copy")}复制正文</button>
        <section class="copy-rewriter" aria-labelledby="body-rewrite-title">
          <div><p class="eyebrow">正文重写</p><h3 id="body-rewrite-title">给 AI 一句修改建议</h3></div>
          <label class="sr-only" for="publish-body-suggestion">正文修改建议</label>
          <textarea id="publish-body-suggestion" rows="3" data-field="publishBodySuggestion" aria-describedby="publish-body-suggestion-help" placeholder="例如：更像游戏搭子，开头更抓人，少一点 emoji" ${state.publishBodyPreserved ? "disabled" : ""}>${escapeHtml(state.publishBodySuggestion)}</textarea>
          <p class="helper-text" id="publish-body-suggestion-help">${state.publishBodyPreserved ? "正文已保留。需要 AI 重写时，请先取消保留。" : "建议只作为编辑指令，不会原样写进正文。可以说“更有网感”“更详细”“精简一点”“少点 emoji”或“把 A 改成 B”。"}</p>
          ${renderAiModeInline()}
          ${state.publishBodyRewriteSummary ? `<div class="ai-understood ${state.publishBodyRewriteMode === "fallback" ? "is-fallback" : ""}" role="status"><strong>${state.publishBodyRewriteMode === "fallback" ? "已按通用方向处理" : "AI 已理解"}</strong><span>${escapeHtml(state.publishBodyRewriteSummary)}</span></div>` : ""}
          <button class="button secondary full" type="button" data-action="rewrite-publish-body" ${bodySuggestionReady && !state.publishBodyPreserved && !state.aiBusy ? "" : "disabled"} aria-busy="${state.aiBusy}">${icon("refresh")}<span data-body-rewrite-label>${bodyRewriteLabel}</span></button>
        </section>
        <div class="tag-list">${exportCopy.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <aside class="panel export-check">
        <div class="section-title"><div><p class="eyebrow">正式导出检查</p><h2>还有 ${exportIssueCount} 类问题</h2></div><span class="status-pill ${hasViewpointBlock ? "danger" : "warning"}">${hasViewpointBlock ? "观点冲突阻塞" : "带标识预览"}</span></div>
        <ul class="check-list">
          <li class="pass">${icon("check")}七页结构完整，页码连续</li>
          <li class="pass">${icon("check")}账号名和系列名已填写</li>
          <li class="warn"><span class="status-dot"></span>具体赛季数值发布前仍需核对更新时间</li>
          <li class="block"><span class="status-dot"></span>当前版本强度数据未接入，已禁止生成相关结论</li>
          ${state.viewpointConflicts.map((item) => `<li class="block">${icon("warning")}第 ${item.pageNo} 页与当前观点冲突：${escapeHtml(item.reason)} <a href="#/research">返回研究页处理</a></li>`).join("")}
        </ul>
        <section class="export-preview-card" aria-labelledby="export-page-title">
          <div><span class="eyebrow">当前导出页</span><strong id="export-page-title">第 ${currentPage.pageNo} 页 · ${escapeHtml(currentPage.title)}</strong></div>
          <div class="export-page-picker" aria-label="选择单页导出页面">${state.pages.map((page) => `<button type="button" data-action="select-page" data-id="${escapeHtml(page.id)}" aria-label="选择第 ${page.pageNo} 页" aria-pressed="${page.id === currentPage.id}" class="${page.id === currentPage.id ? "is-current" : ""}">${page.pageNo}</button>`).join("")}</div>
        </section>
        <div class="export-progress ${state.exportBusy ? "is-active" : ""}" role="status" aria-live="polite">
          <span>${state.exportBusy ? icon("refresh") : icon("check")}</span>
          <p>${escapeHtml(exportProgress)}</p>
        </div>
        <button class="button primary full" type="button" data-action="download-current-png" ${exportDisabled ? "disabled" : ""}>${icon("download")}生成当前第 ${currentPage.pageNo} 页 PNG</button>
        <button class="button secondary full" type="button" data-action="download-all-zip" ${exportDisabled ? "disabled" : ""}>${icon("download")}生成七页 ZIP 发布包</button>
        <button class="button ghost full" type="button" data-action="download-draft">${icon("download")}下载结构化草稿</button>
        ${artifacts && (artifacts.pages.length || artifacts.failures.length) ? `<section class="export-result ${hasArtifactIssues ? "has-issues" : ""}" aria-labelledby="export-result-title">
          <div class="export-result-heading"><span>${icon(hasArtifactIssues ? "warning" : "check")}</span><div><strong id="export-result-title">${hasArtifactIssues ? "导出质检发现需要处理的页面" : "图片已生成并通过质检"}</strong><small>${hasArtifactIssues ? `已生成 ${generatedCount} 页；${qualityWarnings.length} 页文字需调整，${exportFailures.length} 页生成失败` : artifacts.pages.length === 7 ? "七页标题、正文、图标和安全区检查均通过" : `第 ${artifacts.pages[0].pageNo} 页已通过自动检查`}</small></div></div>
          ${qualityWarnings.length ? `<div class="export-quality-issues" role="status" aria-label="文字溢出检查结果">
            ${qualityWarnings.map((item) => `<article><div><strong>第 ${item.pageNo} 页文字可能被截断</strong><small>${item.audit.issues.map((issue) => escapeHtml(issue.message)).join("；")}</small></div><button class="button ghost compact-button" type="button" data-action="open-export-page" data-id="${escapeHtml(item.pageId)}">返回编辑</button></article>`).join("")}
          </div>` : ""}
          ${exportFailures.length ? `<div class="export-failures" role="alert" aria-label="生成失败页面">
            ${exportFailures.map((item) => `<article><div><strong>${item.pageId === "zip" ? "ZIP 打包失败" : `第 ${item.pageNo} 页生成失败`}</strong><small>${escapeHtml(item.message)}</small></div><button class="button secondary compact-button" type="button" data-action="${item.pageId === "zip" ? "download-all-zip" : "retry-export-page"}" data-id="${escapeHtml(item.pageId)}" ${state.exportBusy ? "disabled" : ""}>${icon("refresh")}${item.pageId === "zip" ? "重新打包" : "单独重试"}</button></article>`).join("")}
          </div>` : ""}
          ${artifacts.pages.length ? `<div class="export-thumbnails ${artifacts.pages.length === 1 ? "single" : ""}">${artifacts.pages.map((item) => `<figure class="${item.audit?.status === "warning" ? "quality-warning" : "quality-pass"}">
             <a class="export-image-open" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" aria-label="放大查看第 ${item.pageNo} 页生成结果"><img src="${escapeHtml(item.url)}" alt="第 ${item.pageNo} 页生成结果" width="1080" height="1440"></a>
             <figcaption><span>第 ${item.pageNo} 页 · ${Math.max(1, Math.round(item.size / 1024))} KB</span><b class="quality-label">${item.audit?.status === "warning" ? "需调整文字" : "质检通过"}</b><a href="${escapeHtml(item.url)}" download="${escapeHtml(item.name)}">下载 PNG</a></figcaption>
           </figure>`).join("")}</div>` : ""}
           ${artifacts.zipUrl ? `<a class="button primary full link-button" href="${escapeHtml(artifacts.zipUrl)}" download="铲友装备课01-七页发布包.zip">${icon("download")}下载已检查的七页 ZIP · ${Math.max(1, Math.round(artifacts.zipSize / 1024))} KB</a>` : ""}
         </section>` : ""}
        <p class="helper-text">${hasViewpointBlock ? "结构化草稿仍可下载检查，但 PNG 和 ZIP 必须先处理观点冲突。" : "黄色待核验项不会阻止成图，但正文会保留资料整理口吻；若涉及当前赛季数值，发布前请核对页面日期。"}</p>
      </aside>
    </section>
    <section class="panel knowledge-writeback">
      <div>${icon("book")}<span><strong>准备写回知识库</strong><small>选题、最终文案、来源关系和修改偏好将分区保存；临时草稿不污染正式事实库。</small></span></div>
      <span class="status-pill neutral">Phase F 接入</span>
    </section>
    <div class="bottom-action"><div><strong>${escapeHtml(selectedTitle)}</strong><span>当前推荐标题 · 收藏价值型</span></div><a class="button ghost link-button" href="#/editor">返回编辑</a></div>
  `);
}

function render() {
  const route = currentRoute();
  const renderers = { home: renderHome, research: renderResearch, outline: renderOutline, editor: renderEditor, export: renderExport };
  app.innerHTML = renderers[route]();
  document.title = `${steps.find((step) => step.id === route)?.label || "首页"} · 铲友创作台`;
  if (route === "editor") {
    const current = state.pages.find((page) => page.id === state.currentPageId) || state.pages[0];
    scheduleEditorFinalPreview(current);
  } else {
    window.clearTimeout(editorPreviewTimer);
    editorPreviewRequest += 1;
  }
}

function navigate(route) {
  location.hash = `#/${route}`;
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 3200);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast("已复制到剪贴板");
}

async function readScreenshot(file) {
  if (!file || state.screenshotCapture.status === "processing") return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    showToast("请选择 PNG、JPG 或 WebP 图片");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showToast("单张截图请不要超过 12 MB");
    return;
  }
  state.screenshotCapture = {
    ...structuredClone(defaultState.screenshotCapture),
    status: "processing",
    fileName: file.name,
    title: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
    progress: 1,
  };
  render();
  try {
    state.screenshotCapture.preview = await createLowResolutionPreview(file);
    render();
    const result = await recognizeScreenshot(file, ({ progress }) => {
      state.screenshotCapture.progress = Math.max(state.screenshotCapture.progress, progress || 1);
      const bar = document.querySelector(".ocr-progress");
      const fill = bar?.querySelector("span");
      if (bar) bar.setAttribute("aria-valuenow", String(state.screenshotCapture.progress));
      if (fill) fill.style.width = `${state.screenshotCapture.progress}%`;
      const badge = document.querySelector(".screenshot-ocr-panel .section-title .status-pill");
      if (badge) badge.textContent = `识别中 ${state.screenshotCapture.progress}%`;
    });
    const derived = deriveScreenshotResult(result.text);
    state.screenshotCapture = {
      ...state.screenshotCapture,
      status: "ready",
      text: result.text.trim(),
      category: derived.category,
      ocrConfidence: result.confidence,
      progress: 100,
      error: result.text.trim() ? "" : "没有检测到可读文字",
    };
    saveState();
    render();
    showToast(result.text.trim() ? "截图识别完成，请检查文字和内容类型" : "没有识别到文字，可手动输入后继续");
  } catch (error) {
    state.screenshotCapture = {
      ...state.screenshotCapture,
      status: "failed",
      category: state.screenshotCapture.category || "game_knowledge",
      progress: 0,
      error: error instanceof Error ? error.message : "本地 OCR 运行失败",
    };
    saveState();
    render();
  }
}

function clearScreenshotCapture() {
  state.screenshotCapture = structuredClone(defaultState.screenshotCapture);
  saveState();
  render();
  requestAnimationFrame(() => document.querySelector("#screenshot-file")?.focus());
}

async function confirmScreenshotCapture() {
  const capture = state.screenshotCapture;
  if (capture.text.trim().length < 4 || capture.status === "processing") {
    showToast("请先确认至少 4 个字的识别正文");
    document.querySelector("#screenshot-text")?.focus();
    return;
  }
  const record = createConfirmedScreenshotRecord(capture);
  state.confirmedScreenshots = [...state.confirmedScreenshots, record].slice(-12);
  // 每次确认截图都以当前截图作为新分析输入，避免旧网址或旧截图继续污染候选主题。
  state.sourceInput = screenshotInputContext(record);
  state.inputSupplement = "";
  state.inputAnalysis = null;
  state.inputAnalysisError = "";
  state.inputSelectedCandidateId = "";
  state.inputAnalysisProvider = "";
  state.screenshotCapture = structuredClone(defaultState.screenshotCapture);
  saveState();
  render();
  showToast(`已确认：${record.categoryLabel}，${record.route}`);
  await analyzeSourceInputWithAi();
}

function downloadDraft() {
  const exportCopy = activeExportCopy();
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: "anonymous-demo",
    accountName: state.accountName,
    sourceInput: state.sourceInput,
    inputAnalysis: state.inputAnalysis,
    inputSelectedCandidateId: state.inputSelectedCandidateId,
    contentSource: state.contentSource,
    customProject: state.customProject,
    topicId: state.contentSource === "dynamic" ? state.customProject?.topic?.id : state.selectedTopicId,
    viewpointId: state.contentSource === "dynamic" ? state.customProject?.viewpointId : state.viewpointId,
    viewpointConflicts: state.viewpointConflicts,
    pages: state.pages,
    copy: { ...exportCopy, body: state.publishBody, preserved: state.publishBodyPreserved },
    verification: project.evidence,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "铲友装备课01-结构化草稿.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("结构化草稿已开始下载");
}

function startExport(message, total) {
  clearExportArtifacts();
  state.exportBusy = true;
  state.exportCurrent = 0;
  state.exportTotal = total;
  state.exportMessage = message;
  render();
}

function updateExportProgress(current, message = state.exportMessage) {
  state.exportCurrent = current;
  state.exportMessage = message;
  render();
}

function finishExport() {
  state.exportBusy = false;
  state.exportCurrent = 0;
  state.exportTotal = 0;
  state.exportMessage = "";
}

function exportIsBlocked() {
  if (state.viewpointConflicts.length) {
    showToast("请先处理观点冲突，再导出正式图片");
    return true;
  }
  if (state.exportBusy) return true;
  return false;
}

function pageFailure(page, error) {
  return {
    pageId: page.id,
    pageNo: page.pageNo,
    message: error instanceof Error ? error.message : "图片生成失败，请单独重试",
  };
}

function pageArtifact(page, result) {
  return {
    pageId: page.id,
    pageNo: page.pageNo,
    name: pageExportFilename(page),
    size: result.blob.size,
    blob: result.blob,
    audit: result.audit,
    url: URL.createObjectURL(result.blob),
  };
}

async function createCheckedZipFromArtifacts(items) {
  const entries = [];
  for (const item of [...items].sort((a, b) => a.pageNo - b.pageNo)) {
    entries.push({ name: item.name, data: new Uint8Array(await item.blob.arrayBuffer()) });
  }
  const zip = createZipBlob(entries);
  if (zip.size < entries.reduce((total, entry) => total + entry.data.length, 0)) {
    throw new Error("ZIP 发布包内容不完整，请重新生成。");
  }
  return zip;
}

function canBuildCheckedZip(items, failures) {
  return items.length === 7
    && failures.length === 0
    && items.every((item) => item.audit?.status === "pass");
}

async function downloadCurrentPagePng() {
  if (exportIsBlocked()) return;
  const page = structuredClone(state.pages.find((item) => item.id === state.currentPageId) || state.pages[0]);
  const accountName = state.accountName;
  const fingerprint = exportFingerprint(state.pages, accountName);
  startExport(`正在生成第 ${page.pageNo} 页`, 1);
  updateExportProgress(1);
  try {
    const result = await renderPageToPngWithAudit(page, accountName);
    exportArtifacts = {
      fingerprint,
      pages: [pageArtifact(page, result)],
      failures: [],
      zipUrl: "",
      zipSize: 0,
    };
    finishExport();
    showToast(result.audit.status === "warning"
      ? `第 ${page.pageNo} 页已生成，但检测到文字可能被截断`
      : `第 ${page.pageNo} 页已通过质检，请预览后下载`);
  } catch (error) {
    exportArtifacts = {
      fingerprint,
      pages: [],
      failures: [pageFailure(page, error)],
      zipUrl: "",
      zipSize: 0,
    };
    finishExport();
    showToast(`第 ${page.pageNo} 页生成失败，可在结果卡片中单独重试`);
  }
}

async function downloadAllPagesZip() {
  if (exportIsBlocked()) return;
  const pages = structuredClone(state.pages).sort((a, b) => a.pageNo - b.pageNo);
  const accountName = state.accountName;
  const fingerprint = exportFingerprint(state.pages, accountName);
  startExport("正在生成七页发布包", pages.length);
  const pageArtifacts = [];
  const failures = [];
  for (let index = 0; index < pages.length; index += 1) {
    updateExportProgress(index + 1, `正在生成并检查第 ${pages[index].pageNo} 页`);
    try {
      const result = await renderPageToPngWithAudit(pages[index], accountName);
      pageArtifacts.push(pageArtifact(pages[index], result));
    } catch (error) {
      failures.push(pageFailure(pages[index], error));
    }
  }

  let zipUrl = "";
  let zipSize = 0;
  try {
    if (canBuildCheckedZip(pageArtifacts, failures)) {
      updateExportProgress(pages.length, "正在打包七页图片");
      const zip = await createCheckedZipFromArtifacts(pageArtifacts);
      zipUrl = URL.createObjectURL(zip);
      zipSize = zip.size;
    }
    exportArtifacts = {
      fingerprint,
      pages: pageArtifacts.sort((a, b) => a.pageNo - b.pageNo),
      failures,
      zipUrl,
      zipSize,
    };
    finishExport();
    const warningCount = pageArtifacts.filter((item) => item.audit.status === "warning").length;
    if (failures.length) showToast(`${pageArtifacts.length} 页已生成，${failures.length} 页失败，可单独重试`);
    else if (warningCount) showToast(`七页已生成，${warningCount} 页文字需要调整后再打包`);
    else showToast("七页均通过质检，请预览后下载 ZIP");
  } catch (error) {
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    exportArtifacts = {
      fingerprint,
      pages: pageArtifacts.sort((a, b) => a.pageNo - b.pageNo),
      failures: [...failures, { pageId: "zip", pageNo: 0, message: error instanceof Error ? error.message : "ZIP 打包失败" }],
      zipUrl: "",
      zipSize: 0,
    };
    finishExport();
    showToast(error instanceof Error ? error.message : "七页发布包生成失败，请重试");
  }
}

async function retryExportPage(pageId) {
  if (exportIsBlocked()) return;
  const page = structuredClone(state.pages.find((item) => item.id === pageId));
  if (!page) return;
  const fingerprint = exportFingerprint();
  const current = exportArtifacts.fingerprint === fingerprint
    ? exportArtifacts
    : { fingerprint, pages: [], failures: [], zipUrl: "", zipSize: 0 };
  if (current.zipUrl) URL.revokeObjectURL(current.zipUrl);
  state.exportBusy = true;
  state.exportCurrent = 1;
  state.exportTotal = 1;
  state.exportMessage = `正在单独重试第 ${page.pageNo} 页`;
  render();
  try {
    const result = await renderPageToPngWithAudit(page, state.accountName);
    const existingPageArtifact = current.pages.find((item) => item.pageId === page.id);
    if (existingPageArtifact) URL.revokeObjectURL(existingPageArtifact.url);
    current.pages = [...current.pages.filter((item) => item.pageId !== page.id), pageArtifact(page, result)]
      .sort((a, b) => a.pageNo - b.pageNo);
    current.failures = current.failures.filter((item) => item.pageId !== page.id && item.pageId !== "zip");
    current.zipUrl = "";
    current.zipSize = 0;
    if (canBuildCheckedZip(current.pages, current.failures)) {
      const zip = await createCheckedZipFromArtifacts(current.pages);
      current.zipUrl = URL.createObjectURL(zip);
      current.zipSize = zip.size;
    }
    exportArtifacts = current;
    finishExport();
    showToast(result.audit.status === "pass"
      ? `第 ${page.pageNo} 页重试成功并通过质检`
      : `第 ${page.pageNo} 页重试成功，但文字仍需调整`);
  } catch (error) {
    current.failures = [
      ...current.failures.filter((item) => item.pageId !== page.id && item.pageId !== "zip"),
      pageFailure(page, error),
    ].sort((a, b) => a.pageNo - b.pageNo);
    current.zipUrl = "";
    current.zipSize = 0;
    exportArtifacts = current;
    finishExport();
    showToast(`第 ${page.pageNo} 页仍未通过：${error instanceof Error ? error.message : "请重试"}`);
  }
}

function aiProviderName(response) {
  return response.provider === "deepseek" ? `DeepSeek · ${response.model}` : response.provider === "openai" ? `在线 AI · ${response.model}` : "演示 AI";
}

async function analyzeSourceInputWithAi() {
  const rawInput = state.sourceInput.trim();
  if (!rawInput || state.aiBusy) return;
  const request = createUnderstandInputRequest(rawInput, state.inputSupplement);
  state.aiBusy = true;
  state.aiTaskMessage = "正在理解输入并生成候选选题…";
  state.inputAnalysisError = "";
  render();
  try {
    const [response, gameResearch] = await Promise.all([
      runAiTask(request),
      researchGameTopic(rawInput, state.inputSupplement).catch(() => null),
    ]);
    const topics = gameResearch?.topics?.length === 5 ? gameResearch.topics : response.result.topics;
    const facts = [...(gameResearch?.facts || []), ...response.result.facts]
      .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);
    const mergedSources = [...response.result.sources, ...(gameResearch?.sources || [])]
      .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);
    state.inputAnalysis = {
      ...response.result,
      topics,
      facts,
      sources: normalizeSourceCards(mergedSources),
      summary: gameResearch ? `${response.result.summary} 已结合${gameResearch.season}真实英雄、羁绊和官方素材生成候选。` : response.result.summary,
      liveResearch: gameResearch ? { season: gameResearch.season, patch: gameResearch.patch, updatedAt: gameResearch.updatedAt, warning: gameResearch.warning } : null,
    };
    state.inputSelectedCandidateId = topics[0]?.id || "";
    state.inputAnalysisProvider = gameResearch ? "live-game-data" : response.provider;
    state.inputAnalysisError = "";
    state.aiBusy = false;
    state.aiTaskMessage = "";
    render();
    const pendingSources = state.inputAnalysis.sources.filter((source) => source.extractionStatus === "pending" && rawInput.includes(source.url));
    let parsedCount = 0;
    for (const source of pendingSources) {
      state.sourceBusyId = source.id;
      state.sourceTaskMessage = "正在读取你提供的网站…";
      render();
      try {
        const result = await extractPublicSource(source);
        state.inputAnalysis.sources = applySourceExtraction(state.inputAnalysis.sources, source.id, result);
        if (result.status === "extracted") parsedCount += 1;
      } catch (error) {
        state.inputAnalysis.sources = applySourceExtraction(state.inputAnalysis.sources, source.id, {
          status: "failed",
          failureReason: error instanceof Error ? error.message : "网页解析失败，请手动补充公开正文片段",
        });
      }
    }
    state.sourceBusyId = "";
    state.sourceTaskMessage = "";
    saveState();
    render();
    showToast(parsedCount
      ? `已识别 ${parsedCount} 个网站，请核对识别结果后确认用于选题`
      : `${aiProviderName(response)} 已生成候选选题；网页读不到时可手动补充`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    state.inputAnalysisError = error instanceof Error ? error.message : "输入分析失败，请补充关键信息后重试";
    render();
    showToast(state.inputAnalysisError);
  }
}

async function refreshConfirmedSourceWithLiveData(sourceId, manual = false) {
  const source = state.inputAnalysis?.sources?.find((item) => item.id === sourceId);
  if (!source || source.excerpt.trim().length < 20) return;
  state.inputAnalysis.sources = manual
    ? saveManualSource(state.inputAnalysis.sources, sourceId)
    : confirmExtractedSource(state.inputAnalysis.sources, sourceId);
  state.inputAnalysis = refreshAnalysisWithParsedSources(state.inputAnalysis, state.sourceInput, state.inputSupplement);
  state.inputSelectedCandidateId = state.inputAnalysis.topics[0]?.id || "";
  state.aiBusy = true;
  state.aiTaskMessage = "正在按网页主题核对当前赛季资料…";
  render();
  try {
    const live = await researchGameTopic(`${source.title} ${source.excerpt}`, state.inputSupplement);
    state.inputAnalysis.topics = live.topics;
    state.inputAnalysis.facts = [...live.facts, ...state.inputAnalysis.facts]
      .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);
    state.inputAnalysis.sources = normalizeSourceCards([...state.inputAnalysis.sources, ...live.sources]
      .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index));
    state.inputAnalysis.liveResearch = { season: live.season, patch: live.patch, updatedAt: live.updatedAt, warning: live.warning };
    state.inputAnalysis.summary = `${state.inputAnalysis.summary} 已把原文主题与${live.season}真实赛季资料结合。`;
    state.inputSelectedCandidateId = live.topics[0]?.id || "";
    state.inputAnalysisProvider = "live-game-data";
  } catch {
    // Keep the source-derived candidates when live season data is temporarily unavailable.
  }
  state.aiBusy = false;
  state.aiTaskMessage = "";
  saveState();
  render();
  showToast(manual ? "手动内容已用于选题，并补充了当前赛季英雄与素材" : "网页已用于选题，并补充了当前赛季英雄与素材");
}

async function extractSourceFromWeb(sourceId) {
  const source = state.inputAnalysis?.sources?.find((item) => item.id === sourceId);
  if (!source || state.aiBusy || state.sourceBusyId) return;
  state.sourceBusyId = sourceId;
  state.sourceTaskMessage = "正在解析公开网页…";
  render();
  try {
    const result = await extractPublicSource(source);
    state.inputAnalysis.sources = applySourceExtraction(state.inputAnalysis.sources, sourceId, result);
    state.sourceBusyId = "";
    state.sourceTaskMessage = "";
    saveState();
    render();
    showToast(result.status === "extracted"
      ? "网页识别完成，请核对版本、装备和配方后确认使用"
      : result.failureReason);
  } catch (error) {
    state.inputAnalysis.sources = applySourceExtraction(state.inputAnalysis.sources, sourceId, {
      status: "failed",
      failureReason: error instanceof Error ? error.message : "网页提取失败，请手动补充正文片段",
    });
    state.sourceBusyId = "";
    state.sourceTaskMessage = "";
    saveState();
    render();
    showToast("没有覆盖旧内容，可以直接在来源卡中手动补充");
  }
}

async function buildDynamicResearchWithAi() {
  const analysis = state.inputAnalysis;
  const topic = analysis?.topics?.find((item) => item.id === state.inputSelectedCandidateId);
  if (!analysis || !topic || topic.pending || state.aiBusy) return;
  const request = createResearchBriefRequest(topic, analysis);
  state.aiBusy = true;
  state.aiTaskMessage = "正在生成研究卡…";
  render();
  try {
    const response = await runAiTask(request);
    checkpoint(`建立动态选题前 · ${topic.title}`);
    state.customProject = {
      topic: structuredClone(topic),
      facts: structuredClone(analysis.facts),
      sources: structuredClone(analysis.sources),
      research: response.result,
      viewpointId: response.result.recommendedViewpointId,
      outline: null,
      outlineConfirmed: false,
      researchProvider: response.provider,
      outlineProvider: "",
    };
    state.aiBusy = false;
    state.aiTaskMessage = "";
    saveState();
    navigate("research");
    showToast(`${aiProviderName(response)} 已建立研究卡，先选择你想采用的观点`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    showToast(error instanceof Error ? error.message : "研究卡生成失败，候选选题仍已保留");
  }
}

async function buildDynamicOutlineWithAi() {
  const custom = state.customProject;
  if (!custom?.research || !custom.viewpointId || state.aiBusy) return;
  const request = createOutlineRequest(custom.topic, custom.research, custom.viewpointId);
  state.aiBusy = true;
  state.aiTaskMessage = "正在生成七页大纲…";
  render();
  try {
    const response = await runAiTask(request);
    checkpoint(`生成动态七页大纲前 · ${custom.topic.title}`);
    state.customProject = {
      ...custom,
      outline: enrichOutlineWithGameData(response.result, custom.topic),
      outlineConfirmed: false,
      outlineProvider: response.provider,
    };
    state.aiBusy = false;
    state.aiTaskMessage = "";
    saveState();
    navigate("outline");
    showToast(`${aiProviderName(response)} 已生成七页大纲，事实引用已通过白名单检查`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    showToast(error instanceof Error ? error.message : "大纲生成失败，研究卡和观点均已保留");
  }
}

async function rewriteCurrentPageWithAi() {
  const current = state.pages.find((page) => page.id === state.currentPageId);
  const suggestion = state.rewriteSuggestion.trim();
  if (!current || current.locked || !suggestion || state.aiBusy) return;
  const request = createRewriteFieldsRequest(current, suggestion, undefined, {
    surface: "editor",
    currentTitle: current.title,
    originalTitle: current.baseTitle || current.title,
    titleWasEdited: Boolean(current.baseTitle && current.title !== current.baseTitle),
    userEditedFields: current.baseTitle && current.title !== current.baseTitle ? ["title"] : [],
  });
  state.aiBusy = true;
  state.aiTaskMessage = `正在修改第 ${current.pageNo} 页…`;
  render();
  try {
    const response = await runAiTask(request, { page: current });
    const nextPages = applyRewriteFieldsResponse(state.pages, request, response);
    checkpoint(`AI 重写前 · 第 ${current.pageNo} 页`);
    state.pages = nextPages;
    state.rewriteSuggestion = "";
    state.aiBusy = false;
    state.aiTaskMessage = "";
    saveState();
    showToast(`${aiProviderName(response)} 已完成：${response.result.summary}`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    showToast(error instanceof Error ? error.message : "AI 修改失败，旧内容已保留");
  }
}

async function rewriteSelectedPagesWithAi(suggestion, selectedIds) {
  if (state.aiBusy) return;
  const originalPages = state.pages;
  let nextPages = structuredClone(state.pages);
  const responses = [];
  state.aiBusy = true;
  state.aiTaskMessage = `正在修改 0/${selectedIds.length} 页…`;
  render();
  try {
    for (const [index, pageId] of selectedIds.entries()) {
      const page = nextPages.find((item) => item.id === pageId);
      if (!page || page.locked) continue;
      state.aiTaskMessage = `正在修改 ${index + 1}/${selectedIds.length} 页…`;
      render();
      const request = createRewriteFieldsRequest(page, suggestion);
      const response = await runAiTask(request, { page });
      nextPages = applyRewriteFieldsResponse(nextPages, request, response);
      responses.push(response);
    }
    checkpoint(`整篇 AI 重写前 · ${selectedIds.length} 页`);
    state.pages = nextPages;
    state.documentRewriteSuggestion = "";
    clearRewriteImpact();
    state.aiBusy = false;
    state.aiTaskMessage = "";
    saveState();
    const provider = responses.some((item) => ["deepseek", "openai"].includes(item.provider)) ? "在线 AI" : "演示 AI";
    showToast(`${provider} 已完成整篇修改：更新 ${responses.length} 页，可一次撤销`);
  } catch (error) {
    state.pages = originalPages;
    state.aiBusy = false;
    state.aiTaskMessage = "";
    showToast(error instanceof Error ? error.message : "整篇修改失败，所有旧内容均已保留");
  }
}

async function rewritePublishBodyWithAi() {
  const suggestion = state.publishBodySuggestion.trim();
  if (!suggestion || state.publishBodyPreserved || state.aiBusy) return;
  const request = createPublishCopyRequest(state.publishBody, suggestion);
  state.aiBusy = true;
  state.aiTaskMessage = "正在重写小红书正文…";
  render();
  try {
    const response = await runAiTask(request);
    checkpoint("AI 重写小红书正文前");
    state.publishBody = response.result.body;
    state.publishBodyRewriteMode = response.result.mode || "matched";
    state.publishBodyRewriteSummary = response.result.summary;
    state.publishBodySuggestion = "";
    state.aiBusy = false;
    state.aiTaskMessage = "";
    saveState();
    showToast(`${aiProviderName(response)} 已重新生成正文：${response.result.summary}`);
  } catch (error) {
    state.aiBusy = false;
    state.aiTaskMessage = "";
    showToast(error instanceof Error ? error.message : "正文生成失败，旧内容已保留");
  }
}

async function refreshAiRuntimeStatus() {
  state.aiStatus = await getAiRuntimeStatus();
  render();
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id, value, versionId, fieldKey, index, direction } = target.dataset;

  const aiActions = new Set(["analyze-source-input", "start-dynamic-research", "build-dynamic-outline", "rewrite-outline-page", "rewrite-page", "confirm-document-rewrite", "rewrite-publish-body"]);
  if (aiActions.has(action)) {
    if (state.aiBusy) { showToast("AI 正在处理当前请求，请等待完成，不必重复点击。"); return; }
    // Read the visible value too: password autofill does not always emit input.
    const latestCode = (document.querySelector('[data-field="aiAccessCode"]')?.value || aiAccessCodeDraft).trim();
    if (latestCode) {
      setAiAccessCode(latestCode);
      aiAccessCodeSet = true;
      aiAccessCodeDraft = "";
      try { sessionStorage.setItem("chanyou-ai-access-code", latestCode); } catch { /* Memory remains available. */ }
    }
    if (state.aiStatus?.accessRequired && !aiAccessCodeSet) {
      showToast("请先输入 AI 访问码，再点击生成。");
      document.querySelector('[data-field="aiAccessCode"]')?.focus();
      return;
    }
  }

  if (action === "save-ai-access-code") {
    const code = aiAccessCodeDraft.trim();
    if (!code) {
      showToast("请先输入 AI 访问码");
      document.querySelector('[data-field="aiAccessCode"]')?.focus();
      return;
    }
    setAiAccessCode(code);
    aiAccessCodeSet = true;
    aiAccessCodeDraft = "";
    try { sessionStorage.setItem("chanyou-ai-access-code", code); } catch { /* Keep it in memory. */ }
    render();
    showToast("访问码已保存，将在下一次 AI 请求时验证。");
    return;
  }
  if (action === "clear-ai-access-code") {
    clearAiAccessCode();
    aiAccessCodeSet = false;
    aiAccessCodeDraft = "";
    try { sessionStorage.removeItem("chanyou-ai-access-code"); } catch { /* Already cleared in memory. */ }
    render();
    showToast("AI 访问码已从本次会话清除");
    return;
  }

  if (action === "analyze-source-input") {
    if (!state.sourceInput.trim()) {
      showToast("请先输入一句灵感或一个公开网页链接");
      document.querySelector("#source-input")?.focus();
      return;
    }
    void analyzeSourceInputWithAi();
  }
  if (action === "use-theme-example") {
    state.sourceInput = value || "";
    state.inputAnalysis = null;
    state.inputAnalysisError = "";
    saveState();
    render();
    document.querySelector("#source-input")?.focus();
    showToast("主题已填入，点击“分析我的输入”生成候选选题。");
  }
  if (action === "clear-screenshot") clearScreenshotCapture();
  if (action === "confirm-screenshot") void confirmScreenshotCapture();
  if (action === "select-input-candidate") {
    state.inputSelectedCandidateId = id;
    render();
  }
  if (action === "extract-source") void extractSourceFromWeb(id);
  if (action === "confirm-extracted-source") {
    const source = state.inputAnalysis?.sources?.find((item) => item.id === id);
    if (!source || source.extractionStatus !== "extracted" || source.excerpt.trim().length < 20) {
      showToast("识别结果不完整，请重新解析或手动补充正文");
      return;
    }
    void refreshConfirmedSourceWithLiveData(id, false);
  }
  if (action === "save-manual-source") {
    const source = state.inputAnalysis?.sources?.find((item) => item.id === id);
    if (!source || source.excerpt.trim().length < 20) {
      showToast("请先粘贴至少 20 个字的公开正文片段或摘要");
      document.querySelector(`[data-field="sourceExcerpt"][data-id="${CSS.escape(id || "")}"]`)?.focus();
      return;
    }
    void refreshConfirmedSourceWithLiveData(id, true);
  }
  if (action === "start-dynamic-research") void buildDynamicResearchWithAi();

  if (action === "analyze-document-rewrite") {
    const suggestion = state.documentRewriteSuggestion.trim();
    if (!suggestion) {
      showToast("请先输入一句整篇修改建议");
      document.querySelector("#document-rewrite-suggestion")?.focus();
      return;
    }
    state.rewriteImpact = analyzeRewriteImpact(state.pages, suggestion);
    state.rewriteImpactSuggestion = suggestion;
    state.rewriteImpactFingerprint = JSON.stringify(state.pages);
    state.rewriteSelectedPageIds = state.rewriteImpact
      .filter((item) => item.status === "affected")
      .map((item) => item.pageId);
    render();
  }
  if (action === "cancel-document-rewrite") {
    clearRewriteImpact();
    render();
  }
  if (action === "confirm-document-rewrite") {
    const suggestion = state.documentRewriteSuggestion.trim();
    const impactIsCurrent = state.rewriteImpact.length
      && state.rewriteImpactSuggestion === suggestion
      && state.rewriteImpactFingerprint === JSON.stringify(state.pages);
    if (!impactIsCurrent) {
      showToast("页面内容已经变化，请重新预览影响范围");
      return;
    }
    const affectedIds = new Set(
      state.rewriteImpact.filter((item) => item.status === "affected").map((item) => item.pageId),
    );
    const selectedIds = state.rewriteSelectedPageIds.filter((pageId) => affectedIds.has(pageId));
    if (!selectedIds.length) {
      showToast("请至少选择一页需要修改的内容");
      return;
    }
    void rewriteSelectedPagesWithAi(suggestion, selectedIds);
  }
  if (action === "cancel-viewpoint-impact") {
    clearViewpointImpact();
    render();
  }
  if (action === "review-current-viewpoint") {
    if (!openViewpointImpact(state.viewpointId)) return;
    render();
    requestAnimationFrame(() => document.querySelector(".viewpoint-impact-panel")?.scrollIntoView({ block: "start" }));
  }
  if (action === "confirm-viewpoint-impact") {
    if (!state.pendingViewpointId || state.viewpointImpactFingerprint !== viewpointFingerprint()) {
      showToast("页面内容已经变化，请重新检查观点影响");
      return;
    }
    const target = project.viewpoints.find((item) => item.id === state.pendingViewpointId);
    if (!target) return;
    const resolving = state.pendingViewpointId === state.viewpointId;
    checkpoint(resolving ? "处理观点冲突前" : `切换观点前 · ${target.title}`);
    const result = applyViewpointImpact(
      state.pages,
      state.pendingViewpointId,
      state.viewpointDecisions,
      state.viewpointImpact,
    );
    const rewrittenCount = result.pages.filter((page, index) => page !== state.pages[index]).length;
    state.pages = result.pages;
    state.viewpointId = state.pendingViewpointId;
    state.viewpointConflicts = result.conflicts;
    clearViewpointImpact();
    saveState();
    showToast(result.conflicts.length
      ? `观点已切换并重写 ${rewrittenCount} 页；仍有 ${result.conflicts.length} 个锁定冲突阻止正式导出`
      : `${resolving ? "观点冲突已处理" : "观点切换完成"}：已重写 ${rewrittenCount} 页`);
  }

  if (action === "select-topic") {
    if (state.selectedTopicId === id) return;
    checkpoint("更换选题前");
    state.customProject = null;
    state.selectedTopicId = id;
    saveState();
    render();
  }
  if (action === "start-research") {
    if (state.contentSource === "dynamic") {
      checkpoint("切回固定装备教程前");
      state.pages = structuredClone(project.pages).map((page) => ({ ...page, preservedFields: [], manualOrder: [] }));
      state.currentPageId = state.pages[0].id;
      state.contentSource = "sample";
      state.publishBody = project.exportCopy.body;
      state.publishBodyPreserved = false;
      state.publishBodyRewriteSummary = "";
      state.publishBodyRewriteMode = "";
      state.viewpointConflicts = [];
      state.outlineConfirmed = false;
      clearExportArtifacts();
    }
    state.customProject = null;
    saveState();
    navigate("research");
  }
  if (action === "select-dynamic-viewpoint") {
    const custom = state.customProject;
    if (!custom?.research?.viewpoints.some((item) => item.id === id) || custom.viewpointId === id) return;
    checkpoint("切换动态观点前");
    state.customProject = { ...custom, viewpointId: id, outline: null, outlineConfirmed: false };
    saveState();
    render();
  }
  if (action === "build-dynamic-outline") void buildDynamicOutlineWithAi();
  if (action === "edit-outline-page") {
    const targetPageNo = Number(target.dataset.pageNo);
    const dynamic = Boolean(state.customProject?.outline);
    const page = dynamic
      ? state.customProject.outline.pages.find((item) => item.pageNo === targetPageNo)
      : state.pages.find((item) => item.pageNo === targetPageNo);
    if (!page) return;
    beginOutlineEdit(page, dynamic);
    render();
    requestAnimationFrame(() => document.querySelector(`[data-outline-page="${targetPageNo}"] input`)?.focus());
  }
  if (action === "cancel-outline-edit") {
    state.outlineEditingPageNo = 0;
    state.outlineEditorDraft = null;
    state.outlineOriginalDraft = null;
    state.outlineEditError = "";
    saveState();
    render();
  }
  if (action === "rewrite-outline-page") {
    void rewriteOutlineDraftWithAi();
  }
  if (action === "confirm-dynamic-outline") {
    if (!state.customProject?.outline) return;
    if (state.customProject.outlineConfirmed && state.contentSource === "dynamic") {
      navigate("editor");
      return;
    }
    try {
      const materialized = materializeDynamicProject(state.customProject);
      checkpoint("动态大纲进入逐页编辑前");
      state.pages = state.contentSource === "dynamic" && state.customProject.editorGeneratedAt
        ? state.pages : materialized.pages;
      state.currentPageId = materialized.currentPageId;
      state.contentSource = "dynamic";
      state.customProject = {
        ...state.customProject,
        outlineConfirmed: true,
        editorGeneratedAt: new Date().toISOString(),
        exportCopy: materialized.exportCopy,
      };
      state.publishBody = materialized.exportCopy.body;
      state.publishBodyPreserved = false;
      state.publishBodyRewriteSummary = "";
      state.publishBodyRewriteMode = "";
      state.viewpointConflicts = [];
      state.outlineConfirmed = true;
      clearRewriteImpact();
      clearExportArtifacts();
      saveState();
      navigate("editor");
      showToast("动态七页已生成：可以逐页编辑、锁定、按建议改写并高清导出");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "动态七页生成失败，请返回研究页检查内容");
    }
  }
  if (action === "open-dynamic-editor") navigate("editor");
  if (action === "select-viewpoint") {
    if (state.viewpointId === id && !state.viewpointConflicts.length) return;
    if (!openViewpointImpact(id)) return;
    render();
    requestAnimationFrame(() => document.querySelector(".viewpoint-impact-panel")?.scrollIntoView({ block: "nearest" }));
  }
  if (action === "build-outline") navigate("outline");
  if (action === "confirm-outline") {
    if (!state.outlineConfirmed) checkpoint("确认大纲前");
    state.contentSource = "sample";
    state.outlineConfirmed = true;
    saveState();
    navigate("editor");
  }
  if (action === "select-page") {
    state.currentPageId = id;
    saveState();
    render();
  }
  if (action === "move-equipment-item") {
    const current = state.pages.find((page) => page.id === state.currentPageId);
    const item = current?.blocks?.find((block) => block.kind === "equipment")?.items?.[Number(index)];
    if (!current || !item || current.locked) {
      showToast("当前页已锁定，请先解锁再调整顺序");
      return;
    }
    checkpoint(`调整第 ${current.pageNo} 页装备顺序前`);
    state.pages = moveEquipmentItem(state.pages, current.id, Number(index), direction);
    saveState();
    showToast(`${item.name} 已${direction === "up" ? "上移" : "下移"}，人工顺序已保护`);
  }
  if (action === "reset-equipment-order") {
    const current = state.pages.find((page) => page.id === state.currentPageId);
    const reference = project.pages.find((page) => page.id === state.currentPageId);
    if (!current || !reference || current.locked) {
      showToast("当前页已锁定，请先解锁再恢复顺序");
      return;
    }
    const names = reference.blocks.find((block) => block.kind === "equipment")?.items.map((item) => item.name) || [];
    checkpoint(`恢复第 ${current.pageNo} 页系统顺序前`);
    state.pages = restoreEquipmentOrder(state.pages, current.id, names);
    saveState();
    showToast("已恢复系统顺序，后续可继续手动调整");
  }
  if (action === "toggle-field-preserve") {
    const current = state.pages.find((page) => page.id === state.currentPageId);
    if (!current || current.locked) {
      showToast("当前页已锁定，请先解锁再调整保留字段");
      return;
    }
    const wasPreserved = isFieldPreserved(current, fieldKey);
    checkpoint(`${wasPreserved ? "取消保留" : "保留"}字段前 · 第 ${current.pageNo} 页`);
    state.pages = togglePreservedField(state.pages, current.id, fieldKey);
    saveState();
    showToast(wasPreserved ? "已取消保留，AI 可以修改这个字段" : "字段已保留，AI 重写不会覆盖");
  }
  if (action === "toggle-lock") {
    const current = state.pages.find((page) => page.id === state.currentPageId);
    checkpoint(`${current.locked ? "解锁" : "锁定"}第 ${current.pageNo} 页前`);
    state.pages = updatePage(state.pages, current.id, { locked: !current.locked });
    saveState();
    showToast(current.locked ? "页面已解锁" : "页面已锁定，重写不会覆盖它");
  }
  if (action === "toggle-publish-body-preserve") {
    checkpoint(`${state.publishBodyPreserved ? "取消保留" : "保留"}小红书正文前`);
    state.publishBodyPreserved = !state.publishBodyPreserved;
    saveState();
    showToast(state.publishBodyPreserved ? "正文已保留，AI 重写不会覆盖" : "已取消保留，可以继续让 AI 重写正文");
  }
  if (action === "open-save-version") {
    state.versionSaveOpen = true;
    state.versionSaveName = suggestedVersionName();
    state.versionRenameId = "";
    state.versionDeleteId = "";
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector("#version-save-name");
      input?.focus();
      input?.select();
    });
  }
  if (action === "cancel-save-version") {
    state.versionSaveOpen = false;
    state.versionSaveName = "";
    render();
  }
  if (action === "confirm-save-version") {
    const label = normalizeVersionLabel(state.versionSaveName, "");
    if (!label) {
      showToast("请先填写存档名称");
      document.querySelector("#version-save-name")?.focus();
      return;
    }
    const route = currentRoute();
    const stepLabel = steps.find((step) => step.id === route)?.label || "当前步骤";
    const snapshot = workflowSnapshot(route);
    state.history = saveHistoryVersion(
      state.history,
      snapshot.pages,
      snapshot.currentPageId,
      label,
      { workflow: snapshot },
    );
    state.versionSaveOpen = false;
    state.versionSaveName = "";
    saveState();
    render();
    showToast(`“${label}”已保存，包含${stepLabel}及整套创作状态`);
  }
  if (action === "open-rename-version") {
    const version = normalizeHistory(state.history).saved.find((item) => item.id === versionId);
    if (!version) return;
    state.versionRenameId = versionId;
    state.versionRenameValue = version.label;
    state.versionDeleteId = "";
    state.versionSaveOpen = false;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-field="versionRenameValue"]`);
      input?.focus();
      input?.select();
    });
  }
  if (action === "cancel-rename-version") {
    state.versionRenameId = "";
    state.versionRenameValue = "";
    render();
  }
  if (action === "confirm-rename-version") {
    const nextLabel = normalizeVersionLabel(state.versionRenameValue, "");
    if (!nextLabel) {
      showToast("存档名称不能为空");
      return;
    }
    state.history = renameSavedVersion(state.history, versionId, nextLabel);
    state.versionRenameId = "";
    state.versionRenameValue = "";
    saveState();
    render();
    showToast(`存档已改名为“${nextLabel}”`);
  }
  if (action === "open-delete-version") {
    state.versionDeleteId = versionId;
    state.versionRenameId = "";
    state.versionRenameValue = "";
    state.versionSaveOpen = false;
    render();
  }
  if (action === "cancel-delete-version") {
    state.versionDeleteId = "";
    render();
  }
  if (action === "confirm-delete-version") {
    const version = normalizeHistory(state.history).saved.find((item) => item.id === versionId);
    if (!version) {
      showToast("这个命名存档已不存在");
      return;
    }
    state.history = deleteSavedVersion(state.history, versionId);
    state.versionDeleteId = "";
    saveState();
    render();
    showToast(`已删除“${version.label}”，需要时可撤销删除`);
  }
  if (action === "undo-delete-version") {
    const deleted = normalizeHistory(state.history).deletedSaved.find((item) => item.id === versionId);
    state.history = restoreDeletedSavedVersion(state.history, versionId);
    saveState();
    render();
    showToast(deleted ? `已恢复“${deleted.label}”` : "没有可恢复的命名存档");
  }
  if (action === "dismiss-delete-version") {
    state.history = dismissDeletedSavedVersion(state.history, versionId);
    saveState();
    render();
  }
  if (action === "undo-version") {
    const result = undoHistory(
      state.history,
      state.pages,
      state.currentPageId,
      { workflow: workflowSnapshot() },
    );
    if (!applyHistoryResult(result)) {
      showToast("暂时没有可以撤销的版本");
      return;
    }
    showToast(`已撤销并恢复：${result.restored.label}`);
  }
  if (action === "redo-version") {
    const result = redoHistory(
      state.history,
      state.pages,
      state.currentPageId,
      { workflow: workflowSnapshot() },
    );
    if (!applyHistoryResult(result)) {
      showToast("暂时没有可以重做的版本");
      return;
    }
    showToast("已重做刚才撤销的版本");
  }
  if (action === "restore-version") {
    const result = restoreHistoryVersion(
      state.history,
      state.pages,
      state.currentPageId,
      versionId,
      { workflow: workflowSnapshot() },
    );
    if (!applyHistoryResult(result)) {
      showToast("这个历史版本已不可用，请刷新后重试");
      return;
    }
    showToast(`已恢复：${result.restored.label}`);
  }
  if (action === "rewrite-page") {
    const current = state.pages.find((page) => page.id === state.currentPageId);
    if (current?.locked) {
      showToast("当前页已锁定，请先解锁再修改");
      return;
    }
    if (!state.rewriteSuggestion.trim()) {
      showToast("请先输入一句修改建议");
      document.querySelector("#rewrite-suggestion")?.focus();
      return;
    }
    void rewriteCurrentPageWithAi();
  }
  if (action === "rewrite-publish-body") {
    if (state.publishBodyPreserved) {
      showToast("正文已保留，请先取消保留再让 AI 重写");
      return;
    }
    if (!state.publishBodySuggestion.trim()) {
      showToast("请先输入一句正文修改建议");
      document.querySelector("#publish-body-suggestion")?.focus();
      return;
    }
    void rewritePublishBodyWithAi();
  }
  if (action === "copy-publish-body") copyText(state.publishBody);
  if (action === "copy-text") copyText(value || "");
  if (action === "download-draft") downloadDraft();
  if (action === "download-current-png") void downloadCurrentPagePng();
  if (action === "download-all-zip") void downloadAllPagesZip();
  if (action === "retry-export-page") void retryExportPage(id);
  if (action === "open-export-page") {
    state.currentPageId = id;
    saveState();
    window.location.hash = "#/editor";
  }
});

const versionedFields = new Set([
  "accountName",
  "sourceInput",
  "publishBody",
  "pageTitle",
  "pageSubtitle",
  "itemDetail",
  "itemCue",
  "stepDetail",
  "stepExample",
]);
let fieldEditBaseline = null;

function fieldVersionKey(target) {
  return [
    currentRoute(),
    state.currentPageId,
    target.dataset.field,
    target.dataset.index || "",
  ].join(":");
}

function fieldVersionLabel(field) {
  const labels = {
    accountName: "修改账号名前",
    sourceInput: "修改输入素材前",
    publishBody: "手动修改小红书正文前",
    pageTitle: "修改页面标题前",
    pageSubtitle: "修改页面说明前",
    itemDetail: "修改装备适用场景前",
    itemCue: "修改装备选择判断前",
    stepDetail: "修改口诀判断前",
    stepExample: "修改实战提醒前",
  };
  return labels[field] || "手动修改内容前";
}

app.addEventListener("focusin", (event) => {
  const field = event.target.dataset.field;
  if (!versionedFields.has(field)) return;
  fieldEditBaseline = {
    key: fieldVersionKey(event.target),
    field,
    snapshot: workflowSnapshot(),
  };
});

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  if (field === "aiAccessCode") {
    aiAccessCodeDraft = event.target.value;
    const button = event.target.closest(".ai-access-control")?.querySelector('[data-action="save-ai-access-code"]');
    if (button) button.disabled = !aiAccessCodeDraft.trim();
    return;
  }
  if (field === "accountName") {
    state.accountName = event.target.value;
  }
  if (field === "sourceInput") {
    state.sourceInput = event.target.value;
    state.inputAnalysis = null;
    state.inputAnalysisError = "";
    state.inputSelectedCandidateId = "";
    state.inputAnalysisProvider = "";
    const button = document.querySelector('[data-action="analyze-source-input"]');
    if (button) button.disabled = state.aiBusy || !state.sourceInput.trim();
  }
  if (field === "screenshotTitle") state.screenshotCapture.title = event.target.value;
  if (field === "screenshotText") {
    state.screenshotCapture.text = event.target.value;
    const button = document.querySelector('[data-action="confirm-screenshot"]');
    if (button) button.disabled = state.screenshotCapture.text.trim().length < 4;
  }
  if (field === "inputSupplement") state.inputSupplement = event.target.value;
  if (["outlineKicker", "outlineTitle", "outlineSummary", "outlineKeyPoints"].includes(field)) {
    if (!state.outlineEditorDraft) return;
    const property = {
      outlineKicker: "kicker",
      outlineTitle: "title",
      outlineSummary: "summary",
      outlineKeyPoints: "keyPointsText",
    }[field];
    state.outlineEditorDraft[property] = event.target.value;
    state.outlineEditError = "";
  }
  if (field === "outlineRewriteSuggestion") {
    state.outlineRewriteSuggestion = event.target.value;
    const button = document.querySelector('[data-action="rewrite-outline-page"]');
    if (button) button.disabled = state.aiBusy;
  }
  if (["sourceTitle", "sourceAuthor", "sourcePublishedAt", "sourceExcerpt"].includes(field)) {
    const property = {
      sourceTitle: "title",
      sourceAuthor: "author",
      sourcePublishedAt: "publishedAt",
      sourceExcerpt: "excerpt",
    }[field];
    state.inputAnalysis.sources = updateSourceCard(state.inputAnalysis.sources, event.target.dataset.id, {
      [property]: event.target.value,
      confirmed: false,
    });
    if (field === "sourceExcerpt") {
      const card = event.target.closest(".source-card");
      const saveButton = card?.querySelector('[data-action="save-manual-source"]');
      if (saveButton) saveButton.disabled = event.target.value.trim().length < 20;
      const confirmButton = card?.querySelector('[data-action="toggle-source-confirmation"]');
      if (confirmButton) confirmButton.disabled = true;
    }
  }
  if (field === "versionSaveName") {
    state.versionSaveName = event.target.value;
    const button = document.querySelector('[data-action="confirm-save-version"]');
    if (button) button.disabled = !state.versionSaveName.trim();
  }
  if (field === "versionRenameValue") {
    state.versionRenameValue = event.target.value;
    const button = document.querySelector('[data-action="confirm-rename-version"]');
    if (button) button.disabled = !state.versionRenameValue.trim();
  }
  if (field === "documentRewriteSuggestion") {
    state.documentRewriteSuggestion = event.target.value;
    clearRewriteImpact();
    document.querySelector(".impact-preview")?.remove();
    const analyzeButton = document.querySelector('[data-action="analyze-document-rewrite"]');
    if (analyzeButton) analyzeButton.disabled = !state.documentRewriteSuggestion.trim();
    const analyzeLabel = document.querySelector("[data-impact-analyze-label]");
    if (analyzeLabel) analyzeLabel.textContent = "预览影响范围";
  }
  if (field === "rewriteSuggestion") {
    state.rewriteSuggestion = event.target.value;
    const rewriteButton = document.querySelector('[data-action="rewrite-page"]');
    const current = state.pages.find((page) => page.id === state.currentPageId);
    const hasSuggestion = Boolean(state.rewriteSuggestion.trim());
    if (hasSuggestion && current?.rewriteSummary) {
      state.pages = updatePage(state.pages, current.id, { rewriteSummary: "", rewriteMode: "" });
      document.querySelector(".ai-understood")?.remove();
    }
    if (rewriteButton) rewriteButton.disabled = Boolean(current?.locked) || !hasSuggestion;
    const label = document.querySelector("[data-rewrite-label]");
    if (label) label.textContent = current?.locked
      ? "当前页已锁定，先解锁后修改"
      : hasSuggestion
        ? "按建议智能修改当前页"
        : "请先输入修改建议";
  }
  if (field === "publishBody") {
    state.publishBody = event.target.value;
    state.publishBodyRewriteSummary = "";
    state.publishBodyRewriteMode = "";
    const count = document.querySelector("[data-body-count]");
    if (count) count.textContent = `${state.publishBody.length} 字符`;
    document.querySelector(".copy-rewriter .ai-understood")?.remove();
  }
  if (field === "publishBodySuggestion") {
    state.publishBodySuggestion = event.target.value;
    const ready = Boolean(state.publishBodySuggestion.trim());
    const button = document.querySelector('[data-action="rewrite-publish-body"]');
    const label = document.querySelector("[data-body-rewrite-label]");
    if (button) button.disabled = state.publishBodyPreserved || !ready;
    if (label) label.textContent = state.publishBodyPreserved
      ? "正文已保留，取消后才能重写"
      : ready
        ? "按建议重新生成正文"
        : "请先输入正文修改建议";
    if (ready && state.publishBodyRewriteSummary) {
      state.publishBodyRewriteSummary = "";
      state.publishBodyRewriteMode = "";
      document.querySelector(".copy-rewriter .ai-understood")?.remove();
    }
  }
  if (field === "pageTitle") {
    state.pages = updatePage(state.pages, state.currentPageId, { title: event.target.value });
  }
  if (field === "pageSubtitle") {
    state.pages = updatePage(state.pages, state.currentPageId, { subtitle: event.target.value });
  }
  if (["itemDetail", "itemCue", "stepDetail", "stepExample"].includes(field)) {
    const itemIndex = Number(event.target.dataset.index);
    const current = state.pages.find((page) => page.id === state.currentPageId);
    const pageCopy = structuredClone(current);
    const item = pageCopy.blocks[0]?.items?.[itemIndex];
    if (item && typeof item === "object") {
      const property = {
        itemDetail: "detail",
        itemCue: "cue",
        stepDetail: "detail",
        stepExample: "example",
      }[field];
      item[property] = event.target.value;
      state.pages = updatePage(state.pages, state.currentPageId, { blocks: pageCopy.blocks });
    }
  }
  if (["accountName", "pageTitle", "pageSubtitle", "itemDetail", "itemCue", "stepDetail", "stepExample"].includes(field)) {
    const current = state.pages.find((page) => page.id === state.currentPageId) || state.pages[0];
    scheduleEditorFinalPreview(current, 140);
  }
  saveState();
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest(".outline-edit-form");
  if (!form) return;
  event.preventDefault();
  const pageNo = Number(form.dataset.outlinePage);
  const dynamic = Boolean(state.customProject?.outline);
  const result = validateOutlinePageDraft(state.outlineEditorDraft, { requireKeyPoints: dynamic });
  if (!result.ok) {
    state.outlineEditError = result.error;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-field="${result.field}"]`)?.focus());
    return;
  }

  const currentEditorPage = state.contentSource === "dynamic" && state.pages.find((page) => page.pageNo === pageNo);
  if (dynamic && currentEditorPage && (currentEditorPage.locked || currentEditorPage.preservedFields?.length)) {
    state.outlineEditError = "这一页在第四步已锁定或保留了字段，请先解除保护，再保存大纲修改。";
    render();
    return;
  }
  checkpoint(`修改第 ${pageNo} 页大纲前`);
  const { kicker, title, summary, keyPoints } = result.value;
  if (dynamic) {
    state.customProject = {
      ...state.customProject,
      outline: {
        ...state.customProject.outline,
        pages: updateOutlinePage(state.customProject.outline.pages, pageNo, {
          kicker,
          title,
          summary,
          keyPoints,
          contentEdited: true,
        }),
      },
      outlineConfirmed: false,
    };
    state.outlineConfirmed = false;
    if (state.contentSource === "dynamic") {
      const freshPage = materializeDynamicProject(state.customProject).pages.find((page) => page.pageNo === pageNo);
      state.pages = state.pages.map((page) => page.pageNo === pageNo ? freshPage : page);
    }
  } else {
    const originalPage = state.pages.find((page) => page.pageNo === pageNo);
    state.pages = updateOutlinePage(state.pages, pageNo, {
      kicker,
      title,
      purpose: summary,
      subtitle: summary,
      baseSubtitle: summary,
      blocks: originalPage.blocks.map((block, index) => index === 0 && keyPoints.length ? {
        ...block,
        items: keyPoints.map((detail, itemIndex) => typeof block.items[itemIndex] === "string" ? detail : { ...block.items[itemIndex], detail }),
      } : block),
    });
    state.outlineConfirmed = false;
  }
  state.outlineEditingPageNo = 0;
  state.outlineEditorDraft = null;
  state.outlineOriginalDraft = null;
  state.outlineEditError = "";
  clearExportArtifacts();
  saveState();
  render();
  showToast(`第 ${pageNo} 页大纲已保存，第四步会使用新内容`);
});

app.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  if (field === "screenshotFile") {
    const [file] = event.target.files || [];
    void readScreenshot(file);
    return;
  }
  if (field === "screenshotCategory") {
    state.screenshotCapture.category = event.target.value;
    saveState();
    render();
    return;
  }
  if (field === "screenshotText") {
    saveState();
    render();
    return;
  }
  if (field === "versionFilter") {
    state.versionFilter = event.target.value;
    state.versionRenameId = "";
    state.versionRenameValue = "";
    state.versionDeleteId = "";
    render();
    return;
  }
  if (field === "viewpointDecision") {
    state.viewpointDecisions = {
      ...state.viewpointDecisions,
      [event.target.dataset.id]: event.target.value,
    };
    render();
    return;
  }
  if (field === "impactPage") {
    const selected = new Set(state.rewriteSelectedPageIds);
    if (event.target.checked) selected.add(event.target.dataset.id);
    else selected.delete(event.target.dataset.id);
    state.rewriteSelectedPageIds = [...selected];
    render();
    return;
  }
  if (
    fieldEditBaseline
    && fieldEditBaseline.key === fieldVersionKey(event.target)
    && JSON.stringify(fieldEditBaseline.snapshot) !== JSON.stringify(workflowSnapshot())
  ) {
    checkpoint(fieldVersionLabel(fieldEditBaseline.field), fieldEditBaseline.snapshot);
    saveState();
  }
  fieldEditBaseline = null;
  if (["pageTitle", "pageSubtitle", "accountName", "sourceInput", "publishBody", "itemDetail", "itemCue", "stepDetail", "stepExample"].includes(field)) render();
});

window.addEventListener("hashchange", () => {
  render();
  requestAnimationFrame(() => document.querySelector("#main-content")?.focus({ preventScroll: true }));
});

if (!location.hash) location.hash = "#/home";
render();
void refreshAiRuntimeStatus();
