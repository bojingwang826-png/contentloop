import test from "node:test";
import assert from "node:assert/strict";
import { sampleProject } from "../src/data/sample-project.js";
import {
  applyRewriteFieldsResponse,
  createOutlineRequest,
  createPublishCopyRequest,
  createResearchBriefRequest,
  createRewriteFieldsRequest,
  createSourceExtractionRequest,
  createUnderstandInputRequest,
  validateAiTaskResponse,
} from "../src/domain/ai-contract.js";
import { runMockAiTask } from "../src/domain/mock-ai-provider.js";
import { clearAiAccessCode, runAiTask, setAiAccessCode } from "../src/services/ai-client.js";
import { createAiService } from "../scripts/ai-service.mjs";
import worker from "../worker/index.js";

function pageFixture() {
  const page = structuredClone(sampleProject.pages[2]);
  page.preservedFields = ["title", "items.0.detail"];
  page.manualOrder = [];
  return page;
}

test("输入理解请求会隐藏链接中的敏感参数", () => {
  const request = createUnderstandInputRequest("看看 https://example.com/post?token=secret&topic=tft", "面向新手", "understand-safe");
  assert.equal(request.taskType, "understand_input");
  assert.equal(request.input.rawInput.includes("secret"), false);
  assert.match(request.input.rawInput, /REDACTED/);
  assert.equal(request.input.supplement, "面向新手");
});

test("演示输入理解返回五个候选并把链接标为待核验", () => {
  const request = createUnderstandInputRequest("想做装备合成教程 https://example.com/tft", "", "understand-mock");
  const response = runMockAiTask(request);
  assert.equal(response.result.topics.length, 5);
  assert.equal(response.result.sources[0].status, "user_provided");
  assert.equal(response.result.facts.some((fact) => fact.status === "needs_verification"), true);
  assert.equal(response.result.topics.every((topic) => topic.evidenceIds.includes("fact-user-intent")), true);
});

test("演示来源提取明确失败并保留手动补充入口", () => {
  const request = createSourceExtractionRequest({ id: "source-demo", url: "https://example.com/post" }, "source-demo-task");
  const response = runMockAiTask(request);
  assert.equal(response.result.status, "failed");
  assert.match(response.result.failureReason, /手动|粘贴/);
});

test("在线来源提取启用网页检索并使用独立结构", async () => {
  const request = createSourceExtractionRequest({ id: "source-live", url: "https://example.com/post" }, "source-live-task");
  const result = {
    sourceId: "source-live",
    url: "https://example.com/post",
    title: "公开攻略标题",
    author: "公开作者",
    publishedAt: "2026-08-20",
    excerpt: "这是一段超过二十个字、可供用户核对的公开网页内容摘要。",
    status: "extracted",
    failureReason: "",
  };
  let sentBody;
  let sentUrl;
  let sentHeaders;
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (url, options) => {
      sentUrl = url;
      sentHeaders = options.headers;
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
    },
  });
  const response = await service.run(request, { clientId: "source-live-user" });
  assert.equal(sentUrl, "https://api.deepseek.com/responses");
  assert.equal(sentHeaders.authorization, "Bearer test-key");
  assert.equal(sentBody.tools[0].type, "web_search");
  assert.equal(sentBody.text.format.name, "extract_source");
  assert.equal("strict" in sentBody.text.format, false);
  assert.deepEqual(response.usedSourceIds, ["source-live"]);
  assert.equal(response.provider, "deepseek");
});

test("输入理解会拒绝越界评分和不存在的事实引用", () => {
  const request = createUnderstandInputRequest("金铲铲新手装备", "", "understand-invalid");
  const response = runMockAiTask(request);
  response.result.topics[0].recommendation = 101;
  response.result.topics[1].evidenceIds = ["fact-missing"];
  const checked = validateAiTaskResponse(response, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /评分无效/);
  assert.match(checked.issues.join("；"), /不存在的事实/);
});

test("在线输入理解启用网页检索并保持结构化输出", async () => {
  const request = createUnderstandInputRequest("装备教程 https://example.com/tft", "", "understand-live");
  const demo = runMockAiTask(request);
  let sentBody;
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(demo.result) }) };
    },
  });
  const response = await service.run(request, { clientId: "understand-user" });
  assert.equal(sentBody.tools[0].type, "web_search");
  assert.equal(sentBody.text.format.type, "json_schema");
  assert.equal(response.result.topics.length, 5);
});

test("纯灵感输入不会无故启用付费网页检索", async () => {
  const request = createUnderstandInputRequest("想做金铲铲新手装备教程", "", "understand-no-search");
  const demo = runMockAiTask(request);
  let sentBody;
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(demo.result) }) };
    },
  });
  await service.run(request, { clientId: "idea-only-user" });
  assert.equal("tools" in sentBody, false);
});

test("候选选题可以生成三个观点且只沿用白名单事实", () => {
  const understandRequest = createUnderstandInputRequest("想做金铲铲新手装备合成教程", "", "research-source");
  const analysis = runMockAiTask(understandRequest).result;
  const request = createResearchBriefRequest(analysis.topics[0], analysis, "research-mock");
  const response = runMockAiTask(request);
  assert.equal(response.result.viewpoints.length, 3);
  assert.equal(response.result.viewpoints.filter((item) => item.recommended).length, 1);
  assert.equal(response.usedFactIds.every((id) => request.allowedFactIds.includes(id)), true);
  assert.equal(response.result.disputes.some((item) => item.status === "needs_verification"), true);
});

test("研究卡引用不存在事实时会被整次拒绝", () => {
  const analysis = runMockAiTask(createUnderstandInputRequest("装备给谁", "", "research-invalid-source")).result;
  const request = createResearchBriefRequest(analysis.topics[0], analysis, "research-invalid");
  const response = runMockAiTask(request);
  response.result.viewpoints[0].factIds.push("fact-invented");
  const checked = validateAiTaskResponse(response, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /未允许的事实/);
});

test("确认观点后生成连续七页大纲", () => {
  const analysis = runMockAiTask(createUnderstandInputRequest("装备合成表看不懂", "", "outline-source")).result;
  const research = runMockAiTask(createResearchBriefRequest(analysis.topics[0], analysis, "outline-research")).result;
  const request = createOutlineRequest(analysis.topics[0], research, research.recommendedViewpointId, "outline-mock");
  const response = runMockAiTask(request);
  assert.deepEqual(response.result.pages.map((page) => page.pageNo), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(response.result.pages.every((page) => page.keyPoints.length >= 2), true);
  assert.equal(response.usedFactIds.every((id) => request.allowedFactIds.includes(id)), true);
});

test("动态研究和大纲使用严格结构化输出但不会重复联网检索", async () => {
  const analysis = runMockAiTask(createUnderstandInputRequest("装备合成教程", "", "structured-source")).result;
  const researchRequest = createResearchBriefRequest(analysis.topics[0], analysis, "structured-research");
  const researchResult = runMockAiTask(researchRequest).result;
  const outlineRequest = createOutlineRequest(analysis.topics[0], researchResult, researchResult.recommendedViewpointId, "structured-outline");
  const sent = [];
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      const result = body.text.format.name === "build_research_brief" ? researchResult : runMockAiTask(outlineRequest).result;
      return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
    },
  });
  await service.run(researchRequest, { clientId: "structured-user" });
  await service.run(outlineRequest, { clientId: "structured-user" });
  assert.equal(sent.every((body) => body.text.format.type === "json_schema"), true);
  assert.equal(sent.every((body) => !("tools" in body)), true);
  assert.equal(sent[1].text.format.schema.properties.pages.minItems, 7);
});

test("字段重写请求只暴露允许修改且未保留的文字", () => {
  const request = createRewriteFieldsRequest(pageFixture(), "更像朋友安利", "rewrite-test");
  const paths = request.input.fields.map((field) => field.path);
  assert.equal(paths.includes("title"), false);
  assert.equal(paths.includes("items.0.detail"), false);
  assert.equal(paths.some((path) => /name|recipe|tag/.test(path)), false);
  assert.equal(paths.includes("subtitle"), true);
  assert.match(request.input.contentPolicy, /不得复用相同句式|具体条件/u);
});

test("大纲重写把手改标题和重写要求作为最高优先级意图交给在线模型", async () => {
  const page = pageFixture();
  page.preservedFields = [];
  page.title = "茂凯的技能参数与实战用法";
  const request = createRewriteFieldsRequest(page, "整页改成讲技能范围、控制时间和适合站位", "outline-intent", {
    surface: "outline",
    currentTitle: page.title,
    originalTitle: "为什么新手容易卡住",
    titleWasEdited: true,
    userEditedFields: ["title"],
  });
  const rewriteAngles = [
    "先解释技能范围覆盖哪一格，提醒主坦站角落时别把控制打空",
    "再说明控制持续时间如何影响启动，适合顶在敌方主输出同侧",
    "最后补充残局换位方法，遇到切后阵容就往主 C 一侧回收",
  ];
  const result = {
    pageId: page.id,
    changes: request.input.mustChangePaths.map((path, index) => ({
      path,
      value: path.match(/^items\.(\d+)\./u)
        ? rewriteAngles[Number(path.match(/^items\.(\d+)\./u)[1]) % rewriteAngles.length]
        : `${request.input.fields.find((field) => field.path === path).label}：围绕茂凯技能重新讲解第 ${index + 1} 项`,
    })),
    summary: "理解为整页改讲重装战士技能，并已重写所有旧正文",
    mode: "matched",
  };
  let sentBody;
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
    },
  });
  await service.run(request, { clientId: "outline-intent-user" });
  assert.equal(request.input.intentContext.titleWasEdited, true);
  assert.deepEqual(request.input.intentContext.userEditedFields, ["title"]);
  assert.match(sentBody.input, /茂凯的技能参数与实战用法/u);
  assert.match(sentBody.input, /优先级最高|不能恢复成旧标题/u);
  assert.match(sentBody.input, /技能范围、控制时间和适合站位/u);
});

test("整页删除重写要求会强制页签、说明和全部正文实际变化", () => {
  const page = pageFixture();
  page.preservedFields = [];
  page.title = "重装战士英雄的技能";
  const request = createRewriteFieldsRequest(page, "本页全部内容删除，只写重装战士英雄的技能", "full-page-rewrite", {
    surface: "outline",
    currentTitle: page.title,
    originalTitle: "朋友安利型",
    titleWasEdited: true,
    userEditedFields: ["title"],
  });
  assert.equal(request.input.rewriteScope, "full_page");
  assert.equal(request.input.mustChangePaths.includes("title"), false);
  assert.equal(request.input.mustChangePaths.includes("kicker"), true);
  assert.equal(request.input.mustChangePaths.includes("subtitle"), true);
  assert.equal(request.input.mustChangePaths.some((path) => path.startsWith("items.")), true);

  const unchanged = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "openai",
    model: "test",
    result: {
      pageId: page.id,
      changes: request.input.mustChangePaths.map((path) => ({
        path,
        value: request.input.fields.find((field) => field.path === path).value,
      })),
      summary: "声称整页重写",
      mode: "matched",
    },
    warnings: [], unknowns: [], usedSourceIds: [], usedFactIds: [], usedAssetIds: [],
  };
  const checked = validateAiTaskResponse(unchanged, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /没有实际变化/u);
});

test("在线 AI 返回完全重复的小节会被拒绝", () => {
  const page = structuredClone(sampleProject.pages[2]);
  page.preservedFields = [];
  const request = createRewriteFieldsRequest(page, "分别总结每件装备", "rewrite-distinct");
  const changes = request.input.fields
    .filter((field) => /items\.\d+\.(detail|cue)/u.test(field.path))
    .map((field) => ({ path: field.path, value: field.path.endsWith("detail") ? "先看英雄是否需要这个功能。" : "先看阵容缺什么再做。" }));
  const response = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "openai",
    model: "test",
    result: { pageId: page.id, changes, summary: "逐项整理", mode: "matched" },
    warnings: [], unknowns: [], usedSourceIds: [], usedFactIds: [], usedAssetIds: [],
  };
  const checked = validateAiTaskResponse(response, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /句式雷同/u);
});

test("在线 AI 返回仅替换英雄名的雷同段落会被拒绝并要求重试", () => {
  const page = structuredClone(sampleProject.pages[2]);
  page.preservedFields = [];
  page.blocks[0].items = [
    { name: "黛安娜", detail: "旧介绍一", example: "旧提醒一" },
    { name: "赫卡里姆", detail: "旧介绍二", example: "旧提醒二" },
  ];
  const request = createRewriteFieldsRequest(page, "整页重写，分别介绍英雄技能", "rewrite-similar");
  const response = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "deepseek",
    model: "test",
    result: {
      pageId: page.id,
      changes: request.input.fields.map((field) => ({
        path: field.path,
        value: field.path === "kicker" ? "英雄技能"
          : field.path === "title" ? "重装战士技能介绍"
            : field.path === "subtitle" ? "逐个看技能与站位"
              : field.path.includes("items.0") ? "黛安娜主要任务是接住第一波伤害并给后排争取启动时间。"
                : "赫卡里姆主要任务是接住第一波伤害并给后排争取启动时间。",
      })),
      summary: "逐个介绍英雄",
      mode: "matched",
    },
    warnings: [], unknowns: [], usedSourceIds: [], usedFactIds: [], usedAssetIds: [],
  };
  const checked = validateAiTaskResponse(response, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /句式雷同/u);
});

test("AI 重写结果中的转义换行不会进入页面正文", () => {
  const page = pageFixture();
  page.preservedFields = [];
  const request = createRewriteFieldsRequest(page, "改写第一段", "rewrite-escape");
  const response = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "deepseek",
    model: "test",
    result: {
      pageId: page.id,
      changes: [{ path: "subtitle", value: "技能介绍\\n\\n结合站位判断```" }],
      summary: "清理并改写说明",
      mode: "matched",
    },
    warnings: [], unknowns: [], usedSourceIds: [], usedFactIds: [], usedAssetIds: [],
  };
  const next = applyRewriteFieldsResponse([page], request, response)[0];
  assert.equal(next.subtitle, "技能介绍 结合站位判断");
});

test("英雄技能重写会启用网页检索并在重复响应后带原因重试", async () => {
  const page = structuredClone(sampleProject.pages[2]);
  page.preservedFields = [];
  const request = createRewriteFieldsRequest(page, "分别介绍本赛季英雄技能", "rewrite-search");
  const sent = [];
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      const changes = request.input.fields.map((field, index) => ({ path: field.path, value: `${field.value}（技能资料核对项 ${index + 1}）` }));
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ pageId: page.id, changes, summary: "按要求重写", mode: "matched" }) }) };
    },
  });
  await service.run(request, { clientId: "rewrite-search-user" });
  assert.equal(sent[0].tools[0].type, "web_search");
});

test("演示 provider 使用统一信封并继续保护装备事实", () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "更详细一点", "rewrite-mock");
  const response = runMockAiTask(request, { page });
  const next = applyRewriteFieldsResponse([page], request, response)[0];
  assert.equal(next.title, page.title);
  assert.equal(next.blocks[0].items[0].name, page.blocks[0].items[0].name);
  assert.equal(next.blocks[0].items[0].recipe, page.blocks[0].items[0].recipe);
  assert.equal(next.blocks[0].items[0].detail, page.blocks[0].items[0].detail);
  assert.notEqual(next.subtitle, page.subtitle);
});

test("越过字段白名单的模型响应会被整次拒绝", () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "改得更详细", "rewrite-invalid");
  const response = {
    taskId: request.taskId,
    schemaVersion: 1,
    provider: "openai",
    model: "test",
    result: { pageId: page.id, changes: [{ path: "items.0.recipe", value: "错误配方" }], summary: "尝试越界", mode: "matched" },
    warnings: [], unknowns: [], usedSourceIds: [], usedFactIds: [], usedAssetIds: [],
  };
  const checked = validateAiTaskResponse(response, request);
  assert.equal(checked.success, false);
  assert.match(checked.issues.join("；"), /未允许字段/);
});

test("静态托管没有 AI 接口时不会把演示规则冒充成真实重写", async () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "提醒新手误区", "rewrite-static");
  await assert.rejects(
    () => runAiTask(request, { page }, async () => ({ status: 404 })),
    /尚未连接在线 AI|真实重写/u,
  );
});

test("浏览器只在 AI 请求头中发送本次会话访问码", async () => {
  const request = createPublishCopyRequest(sampleProject.exportCopy.body, "更自然一点", "access-header");
  const result = runMockAiTask(request);
  let sentOptions;
  setAiAccessCode("session-code-123");
  try {
    await runAiTask(request, {}, async (_url, options) => {
      sentOptions = options;
      return { ok: true, status: 200, json: async () => result };
    });
  } finally {
    clearAiAccessCode();
  }
  assert.equal(sentOptions.headers["x-ai-access-code"], "session-code-123");
  assert.equal(sentOptions.body.includes("session-code-123"), false);
});

test("线上 Worker 在调用付费模型前校验 AI 访问码", async () => {
  const env = { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test", AI_ACCESS_CODE: "right-code" };
  const statusResponse = await worker.fetch(new Request("https://example.com/api/ai/status"), env);
  const status = await statusResponse.json();
  assert.equal(status.mode, "live");
  assert.equal(status.accessRequired, true);

  const denied = await worker.fetch(new Request("https://example.com/api/ai/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-access-code": "wrong-code" },
    body: JSON.stringify({ taskType: "rewrite_fields" }),
  }), env);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, "AI_ACCESS_DENIED");
});

test("未配置 API Key 时服务端拒绝伪装成 AI 的字段重写", async () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "更口语一点", "rewrite-server-mock");
  const service = createAiService({ env: {} });
  assert.equal(service.status().mode, "demo");
  await assert.rejects(() => service.run(request, { clientId: "test", page }), /不能把规则改写冒充成真实 AI/u);
});

test("在线模型连续两次返回无效结构时保留旧稿并报错", async () => {
  const request = createPublishCopyRequest(sampleProject.exportCopy.body, "更有网感", "publish-invalid");
  let calls = 0;
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-test" },
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: "不是 JSON" }] }] }) };
    },
  });
  await assert.rejects(() => service.run(request, { clientId: "test" }), /连续两次未通过检查/);
  assert.equal(calls, 2);
});

test("演示模式不消耗在线额度", async () => {
  const request = createPublishCopyRequest(sampleProject.exportCopy.body, "精简一点", "publish-limit");
  const service = createAiService({ env: { AI_REQUESTS_PER_MINUTE: "1", AI_REQUESTS_PER_DAY: "2" } });
  await service.run(request, { clientId: "same-user" });
  const response = await service.run({ ...request, taskId: "publish-limit-2" }, { clientId: "same-user" });
  assert.equal(response.provider, "mock");
});

test("在线模式按访客限制调用频率", async () => {
  const request = createPublishCopyRequest(sampleProject.exportCopy.body, "精简一点", "publish-live-limit");
  const result = { body: sampleProject.exportCopy.body, summary: "已精简", mode: "matched" };
  const service = createAiService({
    env: { DEEPSEEK_API_KEY: "test-key", AI_REQUESTS_PER_MINUTE: "1", AI_REQUESTS_PER_DAY: "2" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(result) }) }),
  });
  await service.run(request, { clientId: "same-live-user" });
  await assert.rejects(
    () => service.run({ ...request, taskId: "publish-live-limit-2" }, { clientId: "same-live-user" }),
    /操作太频繁/,
  );
});
