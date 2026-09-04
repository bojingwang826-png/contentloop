import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../src/services/request-json.js";
import { runAiTask, getAiRuntimeStatus, setAiAccessCode, clearAiAccessCode } from "../src/services/ai-client.js";
import { createAiService } from "../scripts/ai-service.mjs";
import { runMockAiTask } from "../src/domain/mock-ai-provider.js";
import { sampleProject } from "../src/data/sample-project.js";
import { createUnderstandInputRequest, createResearchBriefRequest, createOutlineRequest, createRewriteFieldsRequest, createPublishCopyRequest, createSourceExtractionRequest } from "../src/domain/ai-contract.js";

test("连接或响应正文卡住均会到期退出并取消请求", async () => {
  for (const bodyStalls of [false, true]) {
    let signal;
    const fetcher = async (_url, options) => {
      signal = options.signal;
      return bodyStalls ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    };
    await assert.rejects(() => requestJson("/test", {}, fetcher, 5), /超时.*已保留/);
    assert.equal(signal.aborted, true);
  }
});

test("所有任务断网均明确失败，不偷换成演示结果", async () => {
  for (const taskType of ["understand_input", "extract_source", "build_research_brief", "generate_outline", "rewrite_fields", "generate_publish_copy"]) {
    let calls = 0;
    await assert.rejects(() => runAiTask({ taskType }, {}, async () => {
      calls += 1; throw new TypeError("Failed to fetch");
    }), /网络连接中断/);
    assert.equal(calls, 1);
  }
});

test("访问码错误不重复付费请求，异常 HTML 响应不显示代码", async () => {
  let calls = 0;
  await assert.rejects(() => runAiTask({ taskType: "understand_input" }, {}, async () => {
    calls += 1;
    return { ok: false, status: 401, json: async () => ({ message: "AI 访问码不正确" }) };
  }), /访问码不正确/);
  assert.equal(calls, 1);
  await assert.rejects(() => requestJson("/test", {}, async () => ({ ok: true, json: async () => { throw new SyntaxError("<html>"); } })), /返回格式异常/);
  assert.equal((await getAiRuntimeStatus(async () => { throw new TypeError("offline"); })).mode, "unavailable");
});

test("六种任务从客户端经服务层往返并校验结果，只发一次请求", async () => {
  const understanding = createUnderstandInputRequest("新赛季阵容推荐", "", "transport-input");
  const analysis = runMockAiTask(understanding).result;
  const research = createResearchBriefRequest(analysis.topics[0], analysis);
  const brief = runMockAiTask(research).result;
  const requests = [understanding, research, createOutlineRequest(analysis.topics[0], brief, brief.recommendedViewpointId),
    createRewriteFieldsRequest(sampleProject.pages[2], "更自然"),
    createPublishCopyRequest(sampleProject.exportCopy.body, "更自然"),
    createSourceExtractionRequest({ id: "source", url: "https://example.com/post" })];
  setAiAccessCode("fresh-test-code");
  try {
    for (const request of requests) {
      const expected = runMockAiTask(request, { page: request.input.page });
      let calls = 0;
      const service = createAiService({ env: { DEEPSEEK_API_KEY: "test" }, fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ output_text: JSON.stringify(expected.result) }) };
      } });
      const response = await runAiTask(request, {}, async (_url, options) => {
        assert.equal(options.headers["x-ai-access-code"], "fresh-test-code");
        const payload = await service.run(JSON.parse(options.body));
        return { ok: true, json: async () => payload };
      });
      assert.equal(response.provider, "deepseek");
      assert.equal(calls, 1);
    }
  } finally { clearAiAccessCode(); }
});

test("选题返回额外 result 包装时解包后仍逐项校验", async () => {
  const request = createUnderstandInputRequest("新赛季阵容推荐", "", "wrapped-understand");
  const result = runMockAiTask(request).result;
  const service = createAiService({ env: { DEEPSEEK_API_KEY: "test" }, fetchImpl: async () => ({
    ok: true, json: async () => ({ output_text: JSON.stringify({ result }) }),
  }) });
  assert.equal((await service.run(request)).result.topics.length, 5);
  result.topics = [];
  await assert.rejects(() => service.run(request), /必须返回 5 个候选选题/);
});

test("误返回 Schema 会收到明确纠错而不是连续一屏缺字段报错", async () => {
  const request = createUnderstandInputRequest("新赛季阵容推荐", "", "schema-echo");
  const result = runMockAiTask(request).result;
  const sent = [];
  const service = createAiService({ env: { DEEPSEEK_API_KEY: "test" }, fetchImpl: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output_text: JSON.stringify(sent.length === 1 ? { type: "object", properties: {} } : result) }) };
  } });
  await service.run(request);
  assert.match(sent[1].input, /返回了 JSON Schema 而不是业务结果/);
  assert.match(sent[0].input, /inputType, summary, intent/);
});
