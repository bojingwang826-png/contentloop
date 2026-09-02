import { ensureDistinctPageCopy } from "./state.js";

const AI_TASK_TYPES = new Set(["understand_input", "extract_source", "build_research_brief", "generate_outline", "rewrite_fields", "generate_publish_copy"]);
const editableProperties = new Set(["detail", "cue", "example"]);

function createTaskId(prefix = "ai") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function redactSensitiveUrlParams(value) {
  return String(value || "").replace(/https?:\/\/[^\s<>'"，。；]+/gi, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|key|auth|signature|secret|code/i.test(key)) url.searchParams.set(key, "REDACTED");
      }
      return url.toString();
    } catch {
      return rawUrl;
    }
  });
}

export function createUnderstandInputRequest(rawInput, supplement = "", taskId = createTaskId("understand")) {
  return {
    taskId,
    taskType: "understand_input",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      rawInput: redactSensitiveUrlParams(String(rawInput || "").trim()).slice(0, 5000),
      supplement: redactSensitiveUrlParams(String(supplement || "").trim()).slice(0, 2000),
      game: "金铲铲之战",
      audience: "会照阵容抄作业、但不擅长变阵的新手玩家",
      goal: "生成 5 个明显不同、可做成小红书图文的候选选题，收藏价值权重最高",
      factBoundary: "不得把用户提供的链接视为已读取；未经来源支持的版本强度、胜率、登场率和爆料必须标记待核验或禁止使用。",
    },
    allowedSourceIds: [],
    allowedFactIds: [],
    allowedAssetIds: [],
  };
}

export function createSourceExtractionRequest(source, taskId = createTaskId("source")) {
  return {
    taskId,
    taskType: "extract_source",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      sourceId: String(source?.id || "").trim(),
      url: redactSensitiveUrlParams(String(source?.url || "").trim()).slice(0, 1000),
      factBoundary: "只提取公开可见的标题、作者、发布日期和内容摘要；无法访问时必须返回 failed，不得根据网址猜测正文。",
    },
    allowedSourceIds: source?.id ? [source.id] : [],
    allowedFactIds: [],
    allowedAssetIds: [],
  };
}

function getPageValue(page, path) {
  if (["title", "subtitle", "kicker"].includes(path)) return page[path];
  const match = path.match(/^items\.(\d+)\.(detail|cue|example)$/);
  if (!match) return undefined;
  return page.blocks?.[0]?.items?.[Number(match[1])]?.[match[2]];
}

export function editableFieldsForPage(page) {
  const preserved = new Set(Array.isArray(page?.preservedFields) ? page.preservedFields : []);
  const fields = [];
  const add = (path, label) => {
    const value = getPageValue(page, path);
    if (!preserved.has(path) && typeof value === "string") fields.push({ path, label, value });
  };
  add("title", "主标题");
  add("subtitle", "补充说明");
  const items = page?.blocks?.[0]?.items || [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const subject = item.name || `第 ${index + 1} 条`;
    for (const property of editableProperties) {
      if (!(property in item)) continue;
      const labels = { detail: "适用场景", cue: "选择判断", example: "实战提醒" };
      add(`items.${index}.${property}`, `${subject} · ${labels[property]}`);
    }
  });
  return fields;
}

export function createRewriteFieldsRequest(page, suggestion, taskId = createTaskId("rewrite")) {
  return {
    taskId,
    taskType: "rewrite_fields",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      pageId: page.id,
      suggestion: String(suggestion || "").trim(),
      fields: editableFieldsForPage(page),
      page: structuredClone(page),
      contentPolicy: "每个小节必须根据自己的标题、装备、功能或场景单独总结；同页不得复用相同句式，仅替换名词也视为重复。适用场景、选择判断和实战提醒要分别给出具体条件，不得输出万能套话。",
    },
    allowedSourceIds: [],
    allowedFactIds: [],
    allowedAssetIds: [],
  };
}

export function createPublishCopyRequest(currentBody, suggestion, taskId = createTaskId("publish")) {
  return {
    taskId,
    taskType: "generate_publish_copy",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      currentBody: String(currentBody || ""),
      suggestion: String(suggestion || "").trim(),
      factBoundary: "不得新增胜率、登场率、上分结果、个人实测或未经输入支持的精确数字。",
    },
    allowedSourceIds: [],
    allowedFactIds: [],
    allowedAssetIds: [],
  };
}

export function createResearchBriefRequest(topic, analysis, taskId = createTaskId("research")) {
  const facts = Array.isArray(analysis?.facts) ? structuredClone(analysis.facts) : [];
  const sources = Array.isArray(analysis?.sources) ? structuredClone(analysis.sources) : [];
  return {
    taskId,
    taskType: "build_research_brief",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      topic: structuredClone(topic),
      intent: String(analysis?.intent || ""),
      summary: String(analysis?.summary || ""),
      facts,
      sources,
      goal: "解释为什么值得做，给出 3 个可选择的内容观点，并把事实、争议和未知项分开。",
      factBoundary: "只能引用白名单事实与来源；不得补写未经支持的版本强度、胜率、登场率、个人实测或爆料。",
    },
    allowedSourceIds: sources.map((item) => item.id),
    allowedFactIds: facts.map((item) => item.id),
    allowedAssetIds: [],
  };
}

export function createOutlineRequest(topic, research, viewpointId, taskId = createTaskId("outline")) {
  const viewpoint = research?.viewpoints?.find((item) => item.id === viewpointId);
  const allowedFactIds = [...new Set((research?.viewpoints || []).flatMap((item) => item.factIds || []))];
  const allowedSourceIds = [...new Set((research?.viewpoints || []).flatMap((item) => item.sourceIds || []))];
  return {
    taskId,
    taskType: "generate_outline",
    schemaVersion: 1,
    locale: "zh-CN",
    input: {
      topic: structuredClone(topic),
      researchSummary: String(research?.summary || ""),
      whyWorth: String(research?.whyWorth || ""),
      viewpoint: structuredClone(viewpoint || null),
      disputes: structuredClone(research?.disputes || []),
      goal: "生成一套适合小红书图文的七页内容大纲，先确认结构，不直接生成最终图片。",
      factBoundary: "页面只能引用白名单事实；缺少事实时写方法、判断框架或待补素材，不得编造结论。",
      visualPolicy: "assetNeeds 只描述真正有助于理解本页的素材；纯文字已经足够时返回空数组。装备知识优先官方清晰图标，站位、运营、复盘和避坑等内容描述对应场景，不要求每页配图，也不要反复指定同一种图。",
    },
    allowedSourceIds,
    allowedFactIds,
    allowedAssetIds: [],
  };
}

export function validateAiTaskRequest(request) {
  const issues = [];
  if (!request || typeof request !== "object") return { success: false, issues: ["AI 请求必须是对象"] };
  if (typeof request.taskId !== "string" || !request.taskId.trim()) issues.push("缺少 taskId");
  if (!AI_TASK_TYPES.has(request.taskType)) issues.push("不支持的 AI 任务类型");
  if (request.schemaVersion !== 1) issues.push("AI Schema 版本不匹配");
  if (request.locale !== "zh-CN") issues.push("当前仅支持 zh-CN");
  for (const key of ["allowedSourceIds", "allowedFactIds", "allowedAssetIds"]) {
    if (!Array.isArray(request[key])) issues.push(`${key} 必须是数组`);
  }
  if (!request.input || typeof request.input !== "object") issues.push("缺少 AI 任务输入");
  if (request.taskType === "understand_input") {
    if (typeof request.input?.rawInput !== "string" || request.input.rawInput.trim().length < 2) issues.push("请至少输入两个字或一个网页链接");
    if (request.input?.rawInput?.length > 5000 || request.input?.supplement?.length > 2000) issues.push("输入内容过长");
  }
  if (request.taskType === "extract_source") {
    if (typeof request.input?.sourceId !== "string" || !request.input.sourceId.trim()) issues.push("缺少来源 ID");
    if (typeof request.input?.url !== "string" || !/^https?:\/\//i.test(request.input.url)) issues.push("来源链接无效");
    if (!request.allowedSourceIds.includes(request.input?.sourceId)) issues.push("来源未进入白名单");
  }
  if (request.taskType === "rewrite_fields") {
    if (typeof request.input?.pageId !== "string") issues.push("缺少 pageId");
    if (typeof request.input?.suggestion !== "string" || !request.input.suggestion.trim()) issues.push("缺少修改建议");
    if (!Array.isArray(request.input?.fields) || !request.input.fields.length) issues.push("没有可修改字段");
  }
  if (request.taskType === "generate_publish_copy") {
    if (typeof request.input?.currentBody !== "string") issues.push("缺少当前正文");
    if (typeof request.input?.suggestion !== "string" || !request.input.suggestion.trim()) issues.push("缺少正文修改建议");
  }
  if (request.taskType === "build_research_brief") {
    if (!request.input?.topic || typeof request.input.topic.id !== "string") issues.push("缺少候选选题");
    if (!Array.isArray(request.input?.facts) || !request.input.facts.length) issues.push("研究卡至少需要一条事实边界");
    if (!Array.isArray(request.input?.sources)) issues.push("研究卡来源必须是数组");
  }
  if (request.taskType === "generate_outline") {
    if (!request.input?.topic || typeof request.input.topic.id !== "string") issues.push("缺少大纲选题");
    if (!request.input?.viewpoint || typeof request.input.viewpoint.id !== "string") issues.push("请先选择观点");
  }
  return issues.length ? { success: false, issues } : { success: true, data: request };
}

function idsStayAllowed(used, allowed) {
  const whitelist = new Set(allowed);
  return Array.isArray(used) && used.every((id) => whitelist.has(id));
}

export function validateAiTaskResponse(response, request) {
  const issues = [];
  if (!response || typeof response !== "object") return { success: false, issues: ["AI 响应必须是对象"] };
  if (response.taskId !== request.taskId) issues.push("AI 响应 taskId 不匹配");
  if (response.schemaVersion !== 1) issues.push("AI 响应 Schema 版本不匹配");
  for (const key of ["warnings", "unknowns", "usedSourceIds", "usedFactIds", "usedAssetIds"]) {
    if (!Array.isArray(response[key])) issues.push(`${key} 必须是数组`);
  }
  if (!idsStayAllowed(response.usedSourceIds, request.allowedSourceIds)) issues.push("AI 使用了未允许的来源 ID");
  if (!idsStayAllowed(response.usedFactIds, request.allowedFactIds)) issues.push("AI 使用了未允许的事实 ID");
  if (!idsStayAllowed(response.usedAssetIds, request.allowedAssetIds)) issues.push("AI 使用了未允许的素材 ID");

  if (request.taskType === "understand_input") {
    const result = response.result || {};
    if (!new Set(["idea", "url", "mixed"]).has(result.inputType)) issues.push("输入类型无效");
    if (typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 240) issues.push("输入摘要无效");
    if (typeof result.intent !== "string" || !result.intent.trim() || result.intent.length > 100) issues.push("创作意图无效");
    if (!new Set(["matched", "fallback"]).has(result.mode)) issues.push("输入理解模式无效");
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const sourceIds = new Set();
    for (const source of sources) {
      if (typeof source?.id !== "string" || !source.id.trim() || sourceIds.has(source.id)) issues.push("来源 ID 缺失或重复");
      sourceIds.add(source?.id);
      if (typeof source?.title !== "string" || !source.title.trim()) issues.push("来源标题无效");
      if (typeof source?.url !== "string" || !/^https?:\/\//i.test(source.url)) issues.push("来源链接无效");
      if (!new Set(["user_provided", "found", "unavailable"]).has(source?.status)) issues.push("来源状态无效");
    }
    const facts = Array.isArray(result.facts) ? result.facts : [];
    const factIds = new Set();
    if (!facts.length) issues.push("至少需要一条事实边界");
    for (const fact of facts) {
      if (typeof fact?.id !== "string" || !fact.id.trim() || factIds.has(fact.id)) issues.push("事实 ID 缺失或重复");
      factIds.add(fact?.id);
      if (typeof fact?.label !== "string" || !fact.label.trim() || typeof fact?.claim !== "string" || !fact.claim.trim()) issues.push("事实内容无效");
      if (!new Set(["input_claim", "source_supported", "needs_verification", "blocked"]).has(fact?.status)) issues.push("事实状态无效");
      if (!Array.isArray(fact?.evidenceSourceIds) || fact.evidenceSourceIds.some((id) => !sourceIds.has(id))) issues.push("事实引用了不存在的来源");
    }
    const topics = Array.isArray(result.topics) ? result.topics : [];
    const topicIds = new Set();
    if (topics.length !== 5) issues.push("必须返回 5 个候选选题");
    for (const topic of topics) {
      if (typeof topic?.id !== "string" || !topic.id.trim() || topicIds.has(topic.id)) issues.push("选题 ID 缺失或重复");
      topicIds.add(topic?.id);
      for (const key of ["title", "angle", "badge", "reason"]) {
        if (typeof topic?.[key] !== "string" || !topic[key].trim()) issues.push(`选题 ${key} 无效`);
      }
      for (const key of ["recommendation", "freshness", "saveValue", "evergreen", "pain"]) {
        if (!Number.isFinite(topic?.[key]) || topic[key] < 0 || topic[key] > 100) issues.push(`选题 ${key} 评分无效`);
      }
      if (!Array.isArray(topic?.evidenceIds) || topic.evidenceIds.some((id) => !factIds.has(id))) issues.push("选题引用了不存在的事实");
    }
    if (!Array.isArray(result.questions) || result.questions.length > 4 || result.questions.some((item) => typeof item !== "string" || !item.trim())) issues.push("待补充问题无效");
  }

  if (request.taskType === "extract_source") {
    const result = response.result || {};
    if (result.sourceId !== request.input.sourceId) issues.push("来源提取 ID 不匹配");
    if (result.url !== request.input.url) issues.push("来源提取链接不匹配");
    if (!new Set(["extracted", "failed"]).has(result.status)) issues.push("来源提取状态无效");
    for (const key of ["title", "author", "publishedAt", "excerpt", "failureReason"]) {
      if (typeof result[key] !== "string") issues.push(`来源字段 ${key} 无效`);
    }
    if (result.status === "extracted") {
      if (!result.title.trim()) issues.push("来源标题为空");
      if (result.excerpt.trim().length < 20) issues.push("来源摘要过短");
    }
    if (result.status === "failed" && !result.failureReason.trim()) issues.push("来源失败原因为空");
  }

  if (request.taskType === "rewrite_fields") {
    const allowedPaths = new Set(request.input.fields.map((field) => field.path));
    if (response.result?.pageId !== request.input.pageId) issues.push("AI 返回了错误的页面 ID");
    if (!Array.isArray(response.result?.changes) || !response.result.changes.length) {
      issues.push("AI 没有返回可应用的字段变化");
    } else {
      const seen = new Set();
      for (const change of response.result.changes) {
        if (!allowedPaths.has(change?.path)) issues.push(`AI 试图修改未允许字段：${change?.path || "未知"}`);
        if (seen.has(change?.path)) issues.push(`AI 重复返回字段：${change.path}`);
        seen.add(change?.path);
        if (typeof change?.value !== "string" || !change.value.trim() || change.value.length > 500) {
          issues.push(`字段 ${change?.path || "未知"} 内容无效`);
        }
      }
    }
    if (typeof response.result?.summary !== "string" || !response.result.summary.trim()) issues.push("缺少 AI 理解摘要");
  }

  if (request.taskType === "generate_publish_copy") {
    const body = response.result?.body;
    if (typeof body !== "string" || body.trim().length < 40 || body.length > 1200) issues.push("AI 正文长度不符合要求");
    if (typeof response.result?.summary !== "string" || !response.result.summary.trim()) issues.push("缺少正文修改摘要");
  }
  if (request.taskType === "build_research_brief") {
    const result = response.result || {};
    if (result.topicId !== request.input.topic.id) issues.push("研究卡选题 ID 不匹配");
    for (const key of ["summary", "whyWorth", "whyNow"]) {
      if (typeof result[key] !== "string" || !result[key].trim()) issues.push(`研究卡 ${key} 无效`);
    }
    if (!new Set(["matched", "fallback"]).has(result.mode)) issues.push("研究卡生成模式无效");
    const viewpoints = Array.isArray(result.viewpoints) ? result.viewpoints : [];
    const viewpointIds = new Set();
    if (viewpoints.length !== 3) issues.push("研究卡必须返回 3 个观点");
    for (const viewpoint of viewpoints) {
      if (typeof viewpoint?.id !== "string" || !viewpoint.id.trim() || viewpointIds.has(viewpoint.id)) issues.push("观点 ID 缺失或重复");
      viewpointIds.add(viewpoint?.id);
      for (const key of ["title", "summary", "fit", "risk"]) {
        if (typeof viewpoint?.[key] !== "string" || !viewpoint[key].trim()) issues.push(`观点 ${key} 无效`);
      }
      if (typeof viewpoint?.recommended !== "boolean") issues.push("观点推荐状态无效");
      if (!Array.isArray(viewpoint?.factIds) || viewpoint.factIds.some((id) => !request.allowedFactIds.includes(id))) issues.push("观点引用了未允许的事实");
      if (!Array.isArray(viewpoint?.sourceIds) || viewpoint.sourceIds.some((id) => !request.allowedSourceIds.includes(id))) issues.push("观点引用了未允许的来源");
    }
    if (!viewpointIds.has(result.recommendedViewpointId)) issues.push("推荐观点不存在");
    if (viewpoints.filter((item) => item.recommended).length !== 1) issues.push("必须且只能推荐一个观点");
    if (!Array.isArray(result.disputes) || result.disputes.some((item) => typeof item?.claim !== "string" || !new Set(["needs_verification", "blocked"]).has(item?.status) || typeof item?.guidance !== "string")) issues.push("争议项无效");
    if (!Array.isArray(result.questions) || result.questions.some((item) => typeof item !== "string" || !item.trim())) issues.push("研究待补问题无效");
  }
  if (request.taskType === "generate_outline") {
    const result = response.result || {};
    if (result.topicId !== request.input.topic.id) issues.push("大纲选题 ID 不匹配");
    if (result.viewpointId !== request.input.viewpoint.id) issues.push("大纲观点 ID 不匹配");
    if (typeof result.title !== "string" || !result.title.trim()) issues.push("大纲标题无效");
    if (!new Set(["matched", "fallback"]).has(result.mode)) issues.push("大纲生成模式无效");
    const pages = Array.isArray(result.pages) ? result.pages : [];
    if (pages.length !== 7) issues.push("大纲必须正好包含 7 页");
    const roles = new Set(["cover", "problem", "framework", "detail", "mistake", "summary"]);
    pages.forEach((page, index) => {
      if (page?.pageNo !== index + 1) issues.push("大纲页码必须从 1 到 7 连续排列");
      if (!roles.has(page?.role)) issues.push("大纲页面角色无效");
      for (const key of ["kicker", "title", "summary"]) {
        if (typeof page?.[key] !== "string" || !page[key].trim()) issues.push(`第 ${index + 1} 页 ${key} 无效`);
      }
      if (!Array.isArray(page?.keyPoints) || page.keyPoints.length < 2 || page.keyPoints.length > 4 || page.keyPoints.some((item) => typeof item !== "string" || !item.trim())) issues.push(`第 ${index + 1} 页要点数量无效`);
      if (!Array.isArray(page?.factIds) || page.factIds.some((id) => !request.allowedFactIds.includes(id))) issues.push("大纲引用了未允许的事实");
      if (!Array.isArray(page?.assetNeeds) || page.assetNeeds.some((item) => typeof item !== "string" || !item.trim())) issues.push("大纲素材需求无效");
    });
  }
  return issues.length ? { success: false, issues } : { success: true, data: response };
}

function setPageValue(page, path, value) {
  if (["title", "subtitle", "kicker"].includes(path)) {
    page[path] = value;
    return;
  }
  const match = path.match(/^items\.(\d+)\.(detail|cue|example)$/);
  if (!match) return;
  const item = page.blocks?.[0]?.items?.[Number(match[1])];
  if (item && typeof item === "object") item[match[2]] = value;
}

export function applyRewriteFieldsResponse(pages, request, response) {
  const validation = validateAiTaskResponse(response, request);
  if (!validation.success) throw new Error(validation.issues.join("；"));
  return pages.map((page) => {
    if (page.id !== request.input.pageId || page.locked) return page;
    let next = structuredClone(page);
    for (const change of response.result.changes) setPageValue(next, change.path, change.value);
    next = ensureDistinctPageCopy(next);
    next.rewriteCount = (page.rewriteCount || 0) + 1;
    next.rewriteMode = response.result.mode || "matched";
    next.rewriteSummary = response.result.summary;
    return next;
  });
}
