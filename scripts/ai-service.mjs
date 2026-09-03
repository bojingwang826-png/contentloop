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

function parseStructuredOutput(value) {
  const text = String(value || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("DeepSeek 没有返回可解析的内容");

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`DeepSeek 返回的内容不是合法 JSON：${lastError?.message || "无法解析"}`);
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
          type: "array", minItems: 5, maxItems: 5,
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
          minItems: request.input.rewriteScope === "full_page" ? Math.max(1, request.input.mustChangePaths?.length || 0) : 1,
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
    return `你是金铲铲小红书全主题选题研究助手。用户可以提出任何与金铲铲相关的主题，包括新赛季阵容、英雄棋子、羁绊转职、装备、强化符文、运营经济、搜牌升级、站位对位、版本更新、玩法机制、新手教程、避坑、资讯解读、赛事讨论或冷门自定义问题。必须紧扣用户原话；如果提供了已读取的网页正文，要借鉴原文的核心对象、结构和信息点生成正好 5 个明显不同的候选方向，分别承担核心解释、条件对比、避坑、实战落地和克制应变，不能退回固定模板。收藏价值权重最高。区分用户主张、来源支持、待核验和禁止使用；不要声称已经读取未实际检索到的网页；不要生成未经来源支持的版本强度、胜率、登场率、爆料或个人实测。资料不足时给通用判断框架，并把真正影响创作的问题放进 questions。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "extract_source") {
    return `你是公开网页来源整理助手。请尝试打开指定 URL，只提取公开可见的标题、作者、发布日期和一段忠实摘要。找不到作者或日期时返回空字符串；无法读取正文、页面要求登录或无法确认内容时，status 必须为 failed，并说明 failureReason。不得根据网址、搜索摘要或常识猜正文。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "build_research_brief") {
    return `你是金铲铲小红书内容研究助手。基于已选候选题与现有事实边界，解释为什么值得做，并给出正好 3 个有明显差异的内容观点。只能引用 allowedFactIds 和 allowedSourceIds 对应的项目；不得把用户提供但未检索到的链接当成已确认来源；争议与未知项必须单独列出。资料不足时优先给通用方法和待补问题，不新增版本强度、数据、爆料或个人实测。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "generate_outline") {
    return `你是金铲铲小红书全主题七页图文策划。先判断选题属于阵容、英雄、羁绊、装备、强化符文、运营、站位、版本、机制、教程、资讯或其他自定义主题，再围绕已确认观点生成正好 7 页大纲。第 1 页封面；第 2-6 页必须根据当前主题设计不同任务，不能机械套用装备或阵容模板，也不能重复段落；第 7 页总结。每页给 2-4 个具体要点和与本页文字匹配的素材需求。若输入含已确认网页内容，应沿用原文核心对象和可核验信息，但要重新组织表达而不是照抄。只引用白名单事实 ID；没有事实支持时写判断方法或待补素材，不得虚构版本结论、精确数据、个人实测和结果承诺。\n任务输入：${JSON.stringify(request.input)}`;
  }
  if (request.taskType === "rewrite_fields") {
    const safeInput = {
      pageId: request.input.pageId,
      suggestion: request.input.suggestion,
      fields: request.input.fields,
      intentContext: request.input.intentContext,
      rewriteScope: request.input.rewriteScope,
      mustChangePaths: request.input.mustChangePaths,
      instructionPriority: request.input.instructionPriority,
      contentPolicy: request.input.contentPolicy,
    };
    return `${common}
这是一次真实的当前页重写，不是关键词替换，也不是按钮演示。先用一句话理解用户的最终修改意图，再重写需要变化的全部文字字段。
执行优先级：
1. 用户刚刚手动修改的当前标题和字段代表新的创作方向，优先级最高，绝不能恢复成旧标题或旧主题；如果 titleWasEdited=true，默认保留这个标题作为内容锚点，只有用户明确要求优化标题时才可改写标题。
2. suggestion 是用户此刻的具体要求。要结合当前标题理解，不得只把 suggestion 原样塞进正文。
3. fields 中的旧文字只是待改素材。若与新标题冲突，应整段重写；若用户要求整页换方向，所有相关字段都要一起更新。
4. outline 场景要让页面说明和每条页面要点共同服务于新标题；editor 场景要让标题、补充说明及每个小节形成同一条叙事线。
5. rewriteScope=full_page 时是整页推翻重写：必须返回 mustChangePaths 中的每个字段，而且每个值都要与原字段明显不同。手动改过的标题是新主题锚点，不要把旧正文换几个名词继续使用。
6. 同一页的每个英雄或小节必须分别写：对象是谁、它独有的作用或条件是什么、读者下一步怎么做。禁止复制同一句话后只替换英雄名；禁止重复相同开头、相同论证顺序或相同结尾。
7. 如果是成员/英雄介绍页，逐条利用 fields 和 page 中已有的英雄名、费用、羁绊、技能、站位与职责；让每个英雄承担不同信息重点。资料中没有的精确技能或数值不能猜，但可以明确提醒需要联网核验。
8. 输出前逐对比较所有 items.*.detail、items.*.cue 和 items.*.example；任意两段结构相似都要重写其中一段。四个小节应分别采用例如“技能作用、承伤/输出职责、站位调整、上场条件”等不同切面。
只返回有实际变化的字段。不得改装备名、配方、图标、页面顺序或未经支持的游戏事实。summary 必须具体说明你理解了什么意图、改了哪些方向。
任务输入：${JSON.stringify(safeInput)}`;
  }
  return `${common}\n正文保持朋友安利型、手机短段落和轻量 emoji；资料不足时使用资料整理口吻。\n任务输入：${JSON.stringify(request.input)}`;
}

export function createAiService({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const apiKey = String(env.DEEPSEEK_API_KEY || "").trim();
  const model = String(env.DEEPSEEK_MODEL || "deepseek-v4-flash").trim();
  const minuteLimit = Number(env.AI_REQUESTS_PER_MINUTE || 6);
  const dayLimit = Number(env.AI_REQUESTS_PER_DAY || 30);
  const usage = new Map();

  function status() {
    return {
      mode: apiKey ? "live" : "demo",
      provider: apiKey ? "deepseek" : "mock",
      model: apiKey ? model : "deterministic-demo-v1",
      limits: { perMinute: minuteLimit, perDay: dayLimit },
      message: apiKey ? "DeepSeek 在线模型已连接；所有结果都会经过结构检查。" : "未配置 DeepSeek API Key，当前使用免费演示模式。",
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
          instructions: "输出必须严格匹配 JSON Schema。只返回一个 JSON 对象，不要使用 Markdown 代码块，不要添加解释、前言或结尾。",
          input: `${modelInput(request)}${attempt > 0 && lastError ? `\n上一次输出因以下问题被拒绝：${lastError.message}。这次必须逐项修正，只输出合法 JSON 对象，不要再次返回相同结构。` : ""}`,
          reasoning: { effort: "none" },
          max_output_tokens: new Set(["understand_input", "build_research_brief", "generate_outline"]).has(request.taskType) ? 3000 : 1800,
          text: { format: { type: "json_schema", name: request.taskType, schema: resultSchema(request) } },
        };
        const needsWebSearch = request.taskType === "extract_source"
          || (request.taskType === "understand_input"
            && (/https?:\/\//i.test(`${request.input.rawInput} ${request.input.supplement}`)
              || /当前|今日|热点|版本|最新/.test(`${request.input.rawInput} ${request.input.supplement}`)))
          || (request.taskType === "rewrite_fields"
            && /技能|英雄|羁绊|阵容|新赛季|本赛季|当前版本|数值/u.test(`${request.input.suggestion} ${request.input.intentContext?.currentTitle || ""}`));
        if (needsWebSearch) {
          requestBody.tools = [{ type: "web_search" }];
          requestBody.tool_choice = "auto";
        }
        const apiResponse = await fetchImpl("https://api.deepseek.com/responses", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = await apiResponse.json();
        if (!apiResponse.ok) throw new Error(payload?.error?.message || "DeepSeek 请求失败");
        const result = normalizeUnderstandResult(parseStructuredOutput(extractOutputText(payload)), request, payload);
        const response = {
          taskId: request.taskId,
          schemaVersion: 1,
          provider: "deepseek",
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
    if (!apiKey && rawRequest.taskType === "rewrite_fields") {
      throw Object.assign(new Error("在线 AI 尚未配置，不能把规则改写冒充成真实 AI。原内容已保留。"), { statusCode: 503 });
    }
    if (!apiKey) return runMockAiTask(rawRequest, { page: page || rawRequest.input?.page });
    consume(clientId);
    return callOpenAi(rawRequest);
  }

  return { run, status };
}
