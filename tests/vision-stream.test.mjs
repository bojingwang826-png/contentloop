import test from "node:test";
import assert from "node:assert/strict";
import { visionStream } from "../scripts/vision-stream.mjs";
import { requestVision } from "../src/services/vision-transport.js";

const result = { provider: "deepseek-vision", text: "完整识别正文" };
test("模型尚未返回时立即发送状态，等待期间持续发送心跳，仅调用一次模型", async () => {
  let finish;
  let calls = 0;
  const stream = visionStream(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); }, { heartbeatMs: 5 });
  const reader = stream.body.getReader();
  const decode = (value) => JSON.parse(new TextDecoder().decode(value));
  assert.equal(decode((await reader.read()).value).type, "progress");
  assert.equal(decode((await reader.read()).value).type, "progress");
  finish(result);
  let last;
  while (true) { const item = await reader.read(); if (item.done) break; last = decode(item.value); }
  assert.equal(last.type, "result");
  assert.equal(calls, 1);
});
test("客户端等待心跳后只采用完整最终结果", async () => {
  const progress = [];
  const output = await requestVision({}, async () => visionStream(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20)); return result;
  }, { heartbeatMs: 5 }), (message) => progress.push(message));
  assert.deepEqual(output, result);
  assert.ok(progress.length >= 2);
});
test("浏览器断开时取消上游识别", async () => {
  let signal;
  const response = visionStream((value) => { signal = value; return new Promise(() => {}); });
  const reader = response.body.getReader();
  await reader.read(); await reader.cancel();
  assert.equal(signal.aborted, true);
});
test("错误作为终止消息返回，不把 HTTP 200 当成识别成功", async () => {
  await assert.rejects(() => requestVision({}, async () => visionStream(async () => { throw new Error("模型权限不足"); })), /权限不足/);
});
test("连接提前关闭不会返回半截结果或自动重发", async () => {
  let calls = 0;
  await assert.rejects(() => requestVision({}, async () => {
    calls += 1;
    return new Response('{"type":"progress","message":"已收到"}\n', { headers: { "content-type": "application/x-ndjson" } });
  }), /提前结束/);
  assert.equal(calls, 1);
});
test("流式中文跨字节分块也能完整解码", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "result", result }) + "\n");
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } });
  assert.deepEqual(await requestVision({}, async () => new Response(body, { headers: { "content-type": "application/x-ndjson" } })), result);
});
test("持续心跳仍受总等待时限约束", async () => {
  await assert.rejects(() => requestVision({}, async () => visionStream(() => new Promise(() => {}), { heartbeatMs: 2 }), () => {}, 15), /等待超时/);
});
