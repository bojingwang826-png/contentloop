import test from "node:test";
import assert from "node:assert/strict";
import { recognizeVision, validateVisionInput, validateVisionResult, VISION_MODEL } from "../scripts/vision-service.mjs";
import { createAiService } from "../scripts/ai-service.mjs";
import worker from "../worker/index.js";
import { createConfirmedScreenshotRecord } from "../src/domain/screenshot-ocr.js";

const image = "data:image/png;base64,iVBORw0KGgo=";
const result = { title: "9月4日阵容排名", sections: [
  { heading: "No.1 裁决花妖", lines: ["英雄：凯南", "小字：[无法辨认]"] },
  { heading: "No.2 阵容二", lines: ["英雄：黛安娜"] },
], uncertain: ["第一组头像下方小字"] };
const response = (value = result) => ({ ok: true, json: async () => ({ output_text: JSON.stringify(value) }) });

test("视觉请求发送原始图片，指定视觉模型，不将图片作为纯文字", async () => {
  let calls = 0;
  const out = await recognizeVision({ image, consent: true }, { apiKey: "test-key", fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, "https://api.deepseek.com/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.model, VISION_MODEL);
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "none" }, "图片转录必须显式关闭默认深度思考，避免耗尽托管连接时间");
    assert.deepEqual(body.input[0].content[1], { type: "input_image", image_url: image, detail: "original" });
    assert.equal(body.text.format.type, "json_schema");
    return response();
  } });
  assert.equal(calls, 1);
  assert.match(out.text, /No.1 裁决花妖\n英雄：凯南/);
  assert.equal(out.provider, "deepseek-vision");
  assert.equal(out.uncertainLines, 1);
});

test("拒绝未同意上传和远程图片地址，避免服务端任意 URL 请求", () => {
  assert.throws(() => validateVisionInput({ image, consent: false }), /同意/);
  assert.throws(() => validateVisionInput({ image: "http://localhost/image.png", consent: true }), /格式/);
  assert.throws(() => validateVisionInput({ image: "data:image/svg+xml;base64,abc", consent: true }), /格式/);
});

test("视觉接口没有 Key 时不能伪装成演示成功", async () => {
  const service = createAiService({ env: {} });
  await assert.rejects(() => service.vision({ image, consent: true }), /尚未配置/);
});

test("视觉返回截断或错误结构时失败，绝不保存不完整结果", async () => {
  assert.throws(() => validateVisionResult({ ...result, sections: [{}] }), /格式异常/);
  await assert.rejects(() => recognizeVision({ image, consent: true }, { apiKey: "x", fetchImpl: async () => ({ ok: true, json: async () => ({ status: "incomplete", output_text: JSON.stringify(result) }) }) }), /未返回完整/);
});

test("视觉模型不可用时不自动重试、不泄露上游响应", async () => {
  let calls = 0;
  await assert.rejects(() => recognizeVision({ image, consent: true }, { apiKey: "x", fetchImpl: async () => {
    calls += 1; return { ok: false, status: 400, json: async () => ({ secret: "do-not-show" }) };
  } }), /400/);
  assert.equal(calls, 1);
});

test("生产视觉路由验证访问码后才读取图片和调用模型", async () => {
  const denied = await worker.fetch(new Request("https://test/api/ai/vision", { method: "POST", body: JSON.stringify({ image, consent: true }) }), { AI_ACCESS_CODE: "test-only", DEEPSEEK_API_KEY: "x" });
  assert.equal(denied.status, 401);
  const bad = await worker.fetch(new Request("https://test/api/ai/vision", { method: "POST", headers: { "x-ai-access-code": "test-only" }, body: "{" }), { AI_ACCESS_CODE: "test-only" });
  assert.equal(bad.status, 400);
});

test("确认记录不保存高清原图；长正文不会在六千字被截断", () => {
  const record = createConfirmedScreenshotRecord({ image, text: "字".repeat(7000), preview: "low" });
  assert.equal(record.text.length, 7000);
  assert.equal("image" in record, false);
});

test("视觉调用共用 AI 限流额度", async () => {
  const service = createAiService({ env: { DEEPSEEK_API_KEY: "x", AI_REQUESTS_PER_MINUTE: 1 }, fetchImpl: async () => response() });
  await service.vision({ image, consent: true });
  await assert.rejects(() => service.vision({ image, consent: true }), /频繁/);
});
