// Flush progress while the provider is thinking, rather than leaving the proxy idle.
export function visionStream(run, { heartbeatMs = 8000 } = {}) {
  const abort = new AbortController();
  let timer;
  let closed = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const send = (event) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      send({ type: "progress", message: "图片已收到，DeepSeek 正在识别" });
      timer = setInterval(() => send({ type: "progress", message: "DeepSeek 仍在识别，请勿重复提交" }), heartbeatMs);
      Promise.resolve().then(() => run(abort.signal)).then(
        (result) => send({ type: "result", result }),
        (error) => send({ type: "error", message: error.message || "视觉识别失败" }),
      ).finally(() => {
        clearInterval(timer);
        if (!closed) { closed = true; controller.close(); }
      });
    },
    cancel() { closed = true; clearInterval(timer); abort.abort(); },
  });
  return new Response(body, { headers: {
    "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  } });
}
