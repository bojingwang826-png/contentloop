import { rewritePage, rewritePublishBody } from "./state.js";
import { validateAiTaskRequest, validateAiTaskResponse } from "./ai-contract.js";
import { analyzeInputDemo, buildResearchBriefDemo, generateOutlineDemo } from "./input-analysis.js";

function fieldValue(page, path) {
  if (["title", "subtitle", "kicker"].includes(path)) return page[path];
  const match = path.match(/^items\.(\d+)\.(detail|cue|example)$/);
  return match ? page.blocks?.[0]?.items?.[Number(match[1])]?.[match[2]] : undefined;
}

export function runMockAiTask(request, context = {}) {
  const parsed = validateAiTaskRequest(request);
  if (!parsed.success) throw new Error(parsed.issues.join("；"));
  let result;
  if (request.taskType === "understand_input") {
    result = analyzeInputDemo(request.input.rawInput, request.input.supplement);
  } else if (request.taskType === "extract_source") {
    result = {
      sourceId: request.input.sourceId,
      url: request.input.url,
      title: "",
      author: "",
      publishedAt: "",
      excerpt: "",
      status: "failed",
      failureReason: "演示模式没有联网读取网页，请在来源卡中粘贴公开正文片段。",
    };
  } else if (request.taskType === "build_research_brief") {
    result = buildResearchBriefDemo(request.input.topic, request.input);
  } else if (request.taskType === "generate_outline") {
    result = generateOutlineDemo(request.input.topic, { ...request.input, viewpoints: [request.input.viewpoint] }, request.input.viewpoint.id);
  } else if (request.taskType === "rewrite_fields") {
    const page = context.page;
    if (!page || page.id !== request.input.pageId) throw new Error("演示模式缺少当前页面");
    const rewritten = rewritePage([structuredClone(page)], page.id, request.input.suggestion)[0];
    const changes = request.input.fields
      .map((field) => ({ path: field.path, value: fieldValue(rewritten, field.path) }))
      .filter((change) => typeof change.value === "string" && change.value !== fieldValue(page, change.path));
    result = {
      pageId: page.id,
      changes,
      summary: rewritten.rewriteSummary || "已按演示规则完成字段重写",
      mode: rewritten.rewriteMode || "fallback",
    };
  } else if (request.taskType === "generate_publish_copy") {
    result = rewritePublishBody(request.input.currentBody, request.input.suggestion);
  } else {
    throw new Error("演示模式不支持该 AI 任务");
  }
  const response = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "mock",
    model: "deterministic-demo-v1",
    result,
    warnings: ["当前使用演示模式，未调用在线模型。"],
    usedSourceIds: request.taskType === "build_research_brief"
      ? [...new Set(result.viewpoints.flatMap((item) => item.sourceIds))]
      : [],
    usedFactIds: request.taskType === "build_research_brief"
      ? [...new Set(result.viewpoints.flatMap((item) => item.factIds))]
      : request.taskType === "generate_outline"
        ? [...new Set(result.pages.flatMap((item) => item.factIds))]
        : [],
    usedAssetIds: [],
    unknowns: new Set(["understand_input", "build_research_brief"]).has(request.taskType) ? result.questions : [],
  };
  const checked = validateAiTaskResponse(response, request);
  if (!checked.success) throw new Error(checked.issues.join("；"));
  return response;
}
