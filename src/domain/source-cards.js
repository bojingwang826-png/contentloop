const usableStatuses = new Set(["extracted", "manual"]);

function compact(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeStructuredSource(value) {
  const structured = value && typeof value === "object" ? value : {};
  return {
    contentType: compact(structured.contentType, 24) || "general",
    game: compact(structured.game, 60),
    version: compact(structured.version, 24),
    items: (Array.isArray(structured.items) ? structured.items : []).map((item) => compact(item, 40)).filter(Boolean).slice(0, 16),
    recipes: (Array.isArray(structured.recipes) ? structured.recipes : []).map((recipe) => ({
      ingredients: (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).map((item) => compact(item, 24)).filter(Boolean).slice(0, 2),
      result: compact(recipe?.result, 40),
    })).filter((recipe) => recipe.ingredients.length === 2 && recipe.result).slice(0, 12),
    lineupNames: (Array.isArray(structured.lineupNames) ? structured.lineupNames : []).map((item) => compact(item, 60)).filter(Boolean).slice(0, 6),
    keywords: (Array.isArray(structured.keywords) ? structured.keywords : []).map((item) => compact(item, 40)).filter(Boolean).slice(0, 8),
    confidence: new Set(["high", "medium", "low"]).has(structured.confidence) ? structured.confidence : "low",
  };
}

export function sourceDomain(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return "未知站点";
  }
}

export function sourceIndependenceKey(value) {
  const hostname = sourceDomain(value);
  if (hostname === "未知站点") return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const chinaSuffix = new Set(["com.cn", "net.cn", "org.cn", "gov.cn"]);
  const tail = parts.slice(-2).join(".");
  return chinaSuffix.has(tail) ? parts.slice(-3).join(".") : tail;
}

export function normalizeSourceCard(source, index = 0) {
  const legacyStatus = source?.status || "user_provided";
  const extractionStatus = source?.extractionStatus
    || (legacyStatus === "found" ? "extracted" : legacyStatus === "unavailable" ? "failed" : "pending");
  const url = compact(source?.url, 1000);
  return {
    id: compact(source?.id, 80) || `source-${index + 1}`,
    title: compact(source?.title, 160) || `公开网页来源 ${index + 1}`,
    url,
    status: legacyStatus,
    domain: sourceDomain(url),
    author: compact(source?.author, 100),
    publishedAt: compact(source?.publishedAt, 40),
    excerpt: compact(source?.excerpt || source?.manualText, 1200),
    structured: normalizeStructuredSource(source?.structured),
    retrievalMethod: new Set(["direct", "reader", "manual", "network", "user_reference", "private_reference"]).has(source?.retrievalMethod) ? source.retrievalMethod : "",
    publicDisplay: source?.publicDisplay !== false,
    extractionStatus,
    failureReason: compact(source?.failureReason, 240),
    // Automatic extraction remains pending until the user confirms what was read.
    confirmed: usableStatuses.has(extractionStatus)
      && compact(source?.excerpt).length >= 20
      && (extractionStatus === "manual" || source?.confirmed === true),
  };
}

export function normalizeSourceCards(sources) {
  return (Array.isArray(sources) ? sources : []).map(normalizeSourceCard);
}

export function sourceCanBeConfirmed(source) {
  return usableStatuses.has(source?.extractionStatus) && compact(source?.excerpt).length >= 20 && source?.confirmed === true;
}

export function sourceReadinessSummary(sources) {
  const normalized = normalizeSourceCards(sources);
  const usable = normalized.filter(sourceCanBeConfirmed);
  return {
    usableCount: usable.length,
    pendingCount: normalized.filter((source) => source.extractionStatus === "pending").length,
    failedCount: normalized.filter((source) => source.extractionStatus === "failed").length,
    ready: usable.length > 0,
  };
}

export function updateSourceCard(sources, sourceId, patch) {
  const definedPatch = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined));
  return normalizeSourceCards(sources).map((source) => source.id === sourceId
    ? normalizeSourceCard({ ...source, ...definedPatch, id: source.id, url: source.url })
    : source);
}

export function applySourceExtraction(sources, sourceId, result) {
  const extracted = result?.status === "extracted";
  return updateSourceCard(sources, sourceId, {
    title: extracted ? result.title : undefined,
    author: extracted ? result.author : "",
    publishedAt: extracted ? result.publishedAt : "",
    excerpt: extracted ? result.excerpt : "",
    structured: extracted ? result.structured : {},
    retrievalMethod: extracted ? result.retrievalMethod : "",
    extractionStatus: extracted ? "extracted" : "failed",
    failureReason: extracted ? "" : result?.failureReason || "网页内容暂时无法公开读取",
    confirmed: false,
    status: extracted ? "found" : "unavailable",
  });
}

export function confirmExtractedSource(sources, sourceId) {
  const source = normalizeSourceCards(sources).find((item) => item.id === sourceId);
  if (!source || source.extractionStatus !== "extracted" || source.excerpt.length < 20) return normalizeSourceCards(sources);
  return updateSourceCard(sources, sourceId, { confirmed: true, status: "found" });
}

export function saveManualSource(sources, sourceId) {
  return updateSourceCard(sources, sourceId, {
    extractionStatus: "manual",
    retrievalMethod: "manual",
    failureReason: "",
    confirmed: true,
    status: "user_provided",
  });
}
