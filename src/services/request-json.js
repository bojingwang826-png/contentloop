// Bound both connection and body reading. Never replay a paid POST in the browser.
export async function requestJson(url, options = {}, fetchImpl = globalThis.fetch, timeoutMs = 120000) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("请求等待超时，原内容已保留，请稍后重试。"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) throw new Error(payload?.message || (response.status === 404
        ? "当前网站尚未连接在线 AI 接口，请检查服务部署；原内容已保留。"
        : `服务暂时不可用（${response.status}），原内容已保留，请稍后重试。`));
      if (!payload || typeof payload !== "object") throw new Error("服务返回格式异常，原内容已保留，请稍后重试。");
      return payload;
    })()]);
  } catch (error) {
    if (error instanceof TypeError) throw new Error("网络连接中断，请检查网络后重试；原内容已保留。");
    throw error;
  } finally { clearTimeout(timer); }
}
