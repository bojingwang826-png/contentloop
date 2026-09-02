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
import { runAiTask } from "../src/services/ai-client.js";
import { createAiService } from "../scripts/ai-service.mjs";

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
  const service = createAiService({
    env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-test" },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
    },
  });
  const response = await service.run(request, { clientId: "source-live-user" });
  assert.equal(sentBody.tools[0].type, "web_search_preview");
  assert.equal(sentBody.text.format.name, "extract_source");
  assert.deepEqual(response.usedSourceIds, ["source-live"]);
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
    env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-test" },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(demo.result) }) };
    },
  });
  const response = await service.run(request, { clientId: "understand-user" });
  assert.equal(sentBody.tools[0].type, "web_search_preview");
  assert.equal(sentBody.text.format.type, "json_schema");
  assert.equal(response.result.topics.length, 5);
});

test("纯灵感输入不会无故启用付费网页检索", async () => {
  const request = createUnderstandInputRequest("想做金铲铲新手装备教程", "", "understand-no-search");
  const demo = runMockAiTask(request);
  let sentBody;
  const service = createAiService({
    env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-test" },
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
    env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-test" },
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

test("在线 AI 返回重复小节时会在应用前自动差异化", () => {
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
  const next = applyRewriteFieldsResponse([page], request, response)[0];
  const items = next.blocks[0].items;

  assert.equal(new Set(items.map((item) => item.detail)).size, items.length);
  assert.equal(new Set(items.map((item) => item.cue)).size, items.length);
  assert.match(items[1].detail + items[1].cue, /高血量|前排/u);
  assert.match(items[2].detail + items[2].cue, /破甲|护甲/u);
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

test("静态托管没有 AI 接口时自动回退演示 provider", async () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "提醒新手误区", "rewrite-static");
  const response = await runAiTask(request, { page }, async () => ({ status: 404 }));
  assert.equal(response.provider, "mock");
  assert.equal(response.taskId, request.taskId);
});

test("未配置 API Key 时服务端返回可用演示模式", async () => {
  const page = pageFixture();
  const request = createRewriteFieldsRequest(page, "更口语一点", "rewrite-server-mock");
  const service = createAiService({ env: {} });
  assert.equal(service.status().mode, "demo");
  const response = await service.run(request, { clientId: "test", page });
  assert.equal(response.provider, "mock");
});

test("在线模型连续两次返回无效结构时保留旧稿并报错", async () => {
  const request = createPublishCopyRequest(sampleProject.exportCopy.body, "更有网感", "publish-invalid");
  let calls = 0;
  const service = createAiService({
    env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-test" },
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
    env: { OPENAI_API_KEY: "test-key", AI_REQUESTS_PER_MINUTE: "1", AI_REQUESTS_PER_DAY: "2" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(result) }) }),
  });
  await service.run(request, { clientId: "same-live-user" });
  await assert.rejects(
    () => service.run({ ...request, taskId: "publish-live-limit-2" }, { clientId: "same-live-user" }),
    /操作太频繁/,
  );
});
