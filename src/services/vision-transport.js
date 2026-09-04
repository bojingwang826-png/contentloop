export async function requestVision(options, fetchImpl = fetch, onProgress = () => {}, timeoutMs = 115000) {
  const abort = new AbortController();
  let timer;
  let reader;
  let reachedServer = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error("视觉识别等待超时，未收到完整结果；请稍后重试")); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl("/api/ai/vision", { ...options, signal: abort.signal,
        headers: { ...options.headers, accept: "application/x-ndjson" } });
      reachedServer = true;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `视觉接口返回 ${response.status}，未收到识别结果`);
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
        const payload = await response.json(); // Compatibility with the previous deployment.
        if (payload?.provider !== "deepseek-vision" || typeof payload.text !== "string") throw new Error("视觉接口返回格式异常");
        return payload;
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error("识别连接提前结束，没有收到完整结果；未自动重复请求，请稍后重试");
        total += value.byteLength;
        if (total > 1000000) throw new Error("视觉响应内容超出限制");
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let event;
          try { event = JSON.parse(line); } catch { throw new Error("视觉响应格式异常，未保存部分结果"); }
          if (event.type === "progress") onProgress(event.message);
          else if (event.type === "error") throw new Error(event.message || "视觉识别失败");
          else if (event.type === "result") {
            if (event.result?.provider !== "deepseek-vision" || typeof event.result.text !== "string") throw new Error("视觉结果不完整");
            return event.result;
          }
        }
      }
    })()]);
  } catch (error) {
    if (error instanceof TypeError) throw new Error(reachedServer
      ? "服务器已接收图片，但识别连接中途断开；未自动重复请求，请稍后重试"
      : "未能连接截图识别服务，图片上传未获确认；请检查连接或稍后重试");
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
  }
}
