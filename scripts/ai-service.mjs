import { runMockAiTask } from "../src/domain/mock-ai-provider.js";
import { validateAiTaskRequest, validateAiTaskResponse } from "../src/domain/ai-contract.js";

const minuteWindow = 60_000;
const dayWindow = 86_400_000;

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function citationUrls(payload) {
  const urls = new Set();
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type === "url_citation" && typeof annotation.url === "string") urls.add(annotation.url);
      }
    }
  }
  return urls;
}

function urlsInText(value) {
  return new Set(String(value || "").match(/https?:\/\/[^\s<>'"，。；]+/gi) || []);
}

function normalizeUnderstandResult(result, request, payload) {
  if (request.taskType !== "understand_input") return result;
  const cited = citationUrls(payload);
  const provided = urlsInText(`${request.input.rawInput} ${request.input.supplement}`);
  const sources = (result.sources || []).map((source) => ({
    ...source,
    status: provided.has(source.url) ? "user_provided" : cited.has(source.url) ? "found" : "unavailable",
  }));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const facts = (result.facts || []).map((fact) => {
    if (fact.status !== "source_supported") return fact;
    const supported = fact.evidenceSourceIds?.length
      && fact.evidenceSourceIds.every((id) => sourceById.get(id)?.status === "found");
    return supported ? fact : { ...fact, status: "needs_verification" };
  });
  return { ...result, sources, facts };
}

function resultSchema(request) {
  if (request.taskType === "understand_input") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["inputType", "summary", "intent", "facts", "sources", "topics", "questions", "mode"],
      properties: {
        inputType: { type: "string", enum: ["idea", "url", "mixed"] },
        summary: { type: "string", minLength: 1, maxLength: 240 },
        intent: { type: "string", minLength: 1, maxLength: 100 },
        facts: {
          type: "array", minItems: 1, maxItems: 8,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "label", "claim", "status", "evidenceSourceIds"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              label: { type: "string", minLength: 1, maxLength: 80 },
              claim: { type: "string", minLength: 1, maxLength: 300 },
              status: { type: "string", enum: ["input_claim", "source_supported", "needs_verification", "blocked"] },
              evidenceSourceIds: { type: "array", items: { type: "string" }, maxItems: 5 },
            },
          },
        },
        sources: {
          type: "array", maxItems: 5,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "title", "url", "status"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 160 },
              url: { type: "string", minLength: 8, maxLength: 1000 },
              status: { type: "string", enum: ["user_provided", "found", "unavailable"] },
            },
          },
        },
        topics: {
          type: "array", minItems: 3, maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "title", "angle", "badge", "recommendation", "freshness", "saveValue", "evergreen", "pain", "reason", "evidenceIds"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 80 },
              angle: { type: "string", minLength: 1, maxLength: 180 },
              badge: { type: "string", minLength: 1, maxLength: 30 },
              recommendation: { type: "integer", minimum: 0, maximum: 100 },
              freshness: { type: "integer", minimum: 0, maximum: 100 },
              saveValue: { type: "integer", minimum: 0, maximum: 100 },
              evergreen: { type: "integer", minimum: 0, maximum: 100 },
              pain: { type: "integer", minimum: 0, maximum: 100 },
              reason: { type: "string", minLength: 1, maxLength: 180 },
              evidenceIds: { type: "array", items: { type: "string" }, maxItems: 5 },
            },
          },
        },
        questions: { type: "array", items: { type: "string", minLength: 1, maxLength: 180 }, maxItems: 4 },
        mode: { type: "string", enum: ["matched", "fallback"] },
      },
    };
  }
  if (request.taskType === "extract_source") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["sourceId", "url", "title", "author", "publishedAt", "excerpt", "status", "failureReason"],
      properties: {
        sourceId: { type: "string", const: request.input.sourceId },
        url: { type: "string", const: request.input.url },
        title: { type: "string", maxLength: 160 },
        author: { type: "string", maxLength: 100 },
        publishedAt: { type: "string", maxLength: 40 },
        excerpt: { type: "string", maxLength: 1200 },
        status: { type: "string", enum: ["extracted", "failed"] },
        failureReason: { type: "string", maxLength: 240 },
      },
    };
  }
  if (request.taskType === "build_research_brief") {
    return {
      type: "object", additionalProperties: false,
      required: ["topicId", "summary", "whyWorth", "whyNow", "viewpoints", "disputes", "questions", "recommendedViewpointId", "mode"],
      properties: {
        topicId: { type: "string", const: request.input.topic.id },
        summary: { type: "string", minLength: 1, maxLength: 300 },
        whyWorth: { type: "string", minLength: 1, maxLength: 360 },
        whyNow: { type: "string", minLength: 1, maxLength: 260 },
        viewpoints: {
          type: "array", minItems: 3, maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "title", "summary", "fit", "risk", "recommended", "factIds", "sourceIds"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 100 },
              title: { type: "string", minLength: 1, maxLength: 80 },
              summary: { type: "string", minLength: 1, maxLength: 220 },
              fit: { type: "string", minLength: 1, maxLength: 180 },
              risk: { type: "string", minLength: 1, maxLength: 180 },
              recommended: { type: "boolean" },
              factIds: { type: "array", items: { type: "string", enum: request.allowedFactIds }, maxItems: 8 },
              sourceIds: { type: "array", items: { type: "string", enum: request.allowedSourceIds }, maxItems: 5 },
            },
          },
        },
        disputes: {
          type: "array", maxItems: 5,
          items: {
            type: "object", additionalProperties: false,
            required: ["claim", "status", "guidance"],
            properties: {
              claim: { type: "string", minLength: 1, maxLength: 280 },
              status: { type: "string", enum: ["needs_verification", "blocked"] },
              guidance: { type: "string", minLength: 1, maxLength: 220 },
            },
          },
        },
        questions: { type: "array", items: { type: "string", minLength: 1, maxLength: 180 }, maxItems: 4 },
        recommendedViewpointId: { type: "string", minLength: 1, maxLength: 100 },
        mode: { type: "string", enum: ["matched", "fallback"] },
      },
    };
  }
  if (request.taskType === "generate_outline") {
    return {
      type: "object", additionalProperties: false,
      required: ["topicId", "viewpointId", "title", "pages", "mode"],
      properties: {
        topicId: { type: "string", const: request.input.topic.id },
        viewpointId: { type: "string", const: request.input.viewpoint.id },
        title: { type: "string", minLength: 1, maxLength: 120 },
        pages: {
          type: "array", minItems: 7, maxItems: 7,
          items: {
            type: "object", additionalProperties: false,
            required: ["pageNo", "role", "kicker", "title", "summary", "keyPoints", "factIds", "assetNeeds"],
            properties: {
              pageNo: { type: "integer", minimum: 1, maximum: 7 },
              role: { type: "string", enum: ["cover", "problem", "framework", "detail", "mistake", "summary"] },
              kicker: { type: "string", minLength: 1, maxLength: 50 },
              title: { type: "string", minLength: 1, maxLength: 90 },
              summary: { type: "string", minLength: 1, maxLength: 260 },
              keyPoints: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 120 } },
              factIds: { type: "array", maxItems: 8, items: { type: "string", enum: request.allowedFactIds } },
              assetNeeds: { type: "array", maxItems: 5, items: { type: "string", minLength: 1, maxLength: 100 } },
            },
          },
        },
        mode: { type: "string", enum: ["matched", "fallback"] },
      },
    };
  }
  if (request.taskType === "rewrite_fields") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["pageId", "changes", "summary", "mode"],
      properties: {
        pageId: { type: "string", const: request.input.pageId },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: request.input.fields.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "value"],
            properties: {
              path: { type: "string", enum: request.input.fields.map((field) => field.path) },
              value: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
        summary: { type: "string", minLength: 1, maxLength: 180 },
        mode: { type: "string", enum: ["matched", "fallback"] },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["body", "summary", "mode"],
    properties: {
      body: { type: "string", minLength: 40, maxLength: 1200 },
      summary: { type: "string", minLength: 1, maxLength: 180 },
      mode: { type: "string", enum: ["matched", "fallback"] },
    },
  };
}

function modelInput(request) {
  const common = "你是金铲铲小红书图文编辑。只改写用户允许的文字，不新增精确数字、胜率、登场率、上分承诺、个人实测或未经输入支持的事实。不要照抄修改指令。";
  if (request.taskType === "understand_input") {
    return `你是金铲铲小红书选题研究助手。把用户的一句话、公开网页链接或补充说明整理成事实边界和 3 个候选选题。收藏价值权重最高。必须区分用户主张、来源支持、待核验和禁止使用；不要声称已经读取未实际检索到的网页；不要生成未经来源支持的版本强度、胜率、登场率、爆料或个人实测。资料不足时把问题放进 questions。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "extract_source") {
    return `你是公开网页来源整理助手。请尝试打开指定 URL，只提取公开可见的标题、作者、发布日期和一段忠实摘要。找不到作者或日期时返回空字符串；无法读取正文、页面要求登录或无法确认内容时，status 必须为 failed，并说明 failureReason。不得根据网址、搜索摘要或常识猜正文。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "build_research_brief") {
    return `你是金铲铲小红书内容研究助手。基于已选候选题与现有事实边界，解释为什么值得做，并给出正好 3 个有明显差异的内容观点。只能引用 allowedFactIds 和 allowedSourceIds 对应的项目；不得把用户提供但未检索到的链接当成已确认来源；争议与未知项必须单独列出。资料不足时优先给通用方法和待补问题，不新增版本强度、数据、爆料或个人实测。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "generate_outline") {
    return `你是金铲铲小红书七页图文策划。围绕已确认观点生成正好 7 页大纲：第 1 页封面，第 2 页问题，第 3 页框架，第 4-5 页展开，第 6 页误区或替代，第 7 页总结。每页给 2-4 个要点和素材需求。只引用白名单事实 ID；没有事实支持时写判断方法或待补素材，不得虚构版本结论、精确数据、个人实测和结果承诺。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "rewrite_fields") {
    const safeInput = {
      pageId: request.input.pageId,
      suggestion: request.input.suggestion,
      fields: request.input.fields,
    };
    return `${common}\n只返回有实际变化的字段。不得改装备名、配方、图标、页面顺序或主要观点。\n任务输入：${JSON.stringify(safeInput)}`;
  }
  return `${common}\n正文保持朋友安利型、手机短段落和轻量 emoji；资料不足时使用资料整理口吻。\n任务输入：${JSON.stringify(request.input)}`;
}

export function createAiService({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  const model = String(env.OPENAI_MODEL || "gpt-5.4-mini").trim();
  const minuteLimit = Number(env.AI_REQUESTS_PER_MINUTE || 6);
  const dayLimit = Number(env.AI_REQUESTS_PER_DAY || 30);
  const usage = new Map();

  function status() {
    return {
      mode: apiKey ? "live" : "demo",
      provider: apiKey ? "openai" : "mock",
      model: apiKey ? model : "deterministic-demo-v1",
      limits: { perMinute: minuteLimit, perDay: dayLimit },
      message: apiKey ? "在线 AI 已连接；所有结果都会经过结构检查。" : "未配置 API Key，当前使用免费演示模式。",
    };
  }

  function consume(clientId) {
    const now = Date.now();
    const record = usage.get(clientId) || [];
    const recentDay = record.filter((timestamp) => now - timestamp < dayWindow);
    const recentMinute = recentDay.filter((timestamp) => now - timestamp < minuteWindow);
    if (recentMinute.length >= minuteLimit) throw Object.assign(new Error("操作太频繁，请稍后再试；旧内容没有变化。"), { statusCode: 429 });
    if (recentDay.length >= dayLimit) throw Object.assign(new Error("今天的在线 AI 体验次数已用完；仍可切换演示模式继续编辑和导出。"), { statusCode: 429 });
    recentDay.push(now);
    usage.set(clientId, recentDay);
  }

  async function callOpenAi(request) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const requestBody = {
          model,
          instructions: "输出必须严格匹配 JSON Schema。",
          input: modelInput(request),
          reasoning: { effort: "low" },
          max_output_tokens: new Set(["understand_input", "build_research_brief", "generate_outline"]).has(request.taskType) ? 3000 : 1800,
          store: false,
          text: { format: { type: "json_schema", name: request.taskType, strict: true, schema: resultSchema(request) } },
        };
        const needsWebSearch = request.taskType === "extract_source"
          || (request.taskType === "understand_input"
            && (/https?:\/\//i.test(`${request.input.rawInput} ${request.input.supplement}`)
              || /当前|今日|热点|版本|最新/.test(`${request.input.rawInput} ${request.input.supplement}`)));
        if (needsWebSearch) {
          requestBody.tools = [{ type: "web_search_preview", search_context_size: "low" }];
          requestBody.tool_choice = "auto";
        }
        const apiResponse = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = await apiResponse.json();
        if (!apiResponse.ok) throw new Error(payload?.error?.message || "OpenAI 请求失败");
        const result = normalizeUnderstandResult(JSON.parse(extractOutputText(payload)), request, payload);
        const response = {
          taskId: request.taskId,
          schemaVersion: 1,
          provider: "openai",
          model,
          result,
          warnings: request.taskType === "understand_input" && result.sources.some((source) => source.status === "unavailable")
            ? ["部分来源未出现在检索引用中，已降级为不可用。"]
            : [],
          usedSourceIds: request.taskType === "build_research_brief"
            ? [...new Set(result.viewpoints.flatMap((item) => item.sourceIds))]
            : request.taskType === "extract_source" && result.status === "extracted"
              ? [request.input.sourceId]
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
      } catch (error) {
        lastError = error;
      }
    }
    throw Object.assign(new Error(`在线 AI 连续两次未通过检查：${lastError?.message || "未知错误"}；旧内容已保留。`), { statusCode: 502 });
  }

  async function run(rawRequest, { clientId = "local", page } = {}) {
    const checked = validateAiTaskRequest(rawRequest);
    if (!checked.success) throw Object.assign(new Error(checked.issues.join("；")), { statusCode: 400 });
    if (!apiKey) return runMockAiTask(rawRequest, { page: page || rawRequest.input?.page });
    consume(clientId);
    return callOpenAi(rawRequest);
  }

  return { run, status };
}
