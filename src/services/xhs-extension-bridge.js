export const XHS_BRIDGE_CHANNEL = "contentloop-xhs-publish-v1";

export function checkedPublishPages(artifacts, fingerprint) {
  if (!artifacts || artifacts.fingerprint !== fingerprint) throw new Error("图片已过期，请重新生成七页图片");
  if (artifacts.failures?.length || artifacts.pages?.length !== 7) throw new Error("七页图片尚未全部生成，请先完成导出");
  const pages = [...artifacts.pages].sort((a, b) => a.pageNo - b.pageNo);
  if (pages.some((page, index) => page.pageNo !== index + 1 || page.audit?.status !== "pass" || page.blob?.type !== "image/png")) {
    throw new Error("七页图片未全部通过质检，不能发布");
  }
  return pages;
}

export async function buildXhsPublishPayload({ title, body, pages }) {
  const safeTitle = String(title || "").trim();
  const safeBody = String(body || "").trim();
  if (!safeTitle || !safeBody) throw new Error("请先确认标题和小红书正文");
  if (!Array.isArray(pages) || pages.length !== 7) throw new Error("发布必须包含七页图片");
  const images = [];
  for (const page of pages) {
    if (!(page.blob instanceof Blob) || page.blob.type !== "image/png") throw new Error("发布图片格式不正确");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`第 ${page.pageNo} 页读取失败`));
      reader.readAsDataURL(page.blob);
    });
    images.push({ name: page.name, pageNo: page.pageNo, dataUrl });
  }
  return { title: safeTitle, body: safeBody, images };
}

function requestExtension(kind, payload, { target = window, timeoutMs = 180000 } = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("未收到本机扩展回复。请确认扩展已启用，并在同一个 Chrome 中打开 ContentLoop"));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener("message", onMessage);
    }
    function onMessage(event) {
      if (event.source !== target || event.origin !== target.location.origin) return;
      const message = event.data;
      if (message?.channel !== XHS_BRIDGE_CHANNEL || message?.kind !== "result" || message.requestId !== requestId) return;
      cleanup();
      if (message.ok) resolve(message);
      else reject(new Error(message.error || "小红书发布未完成，请检查创作页面"));
    }
    target.addEventListener("message", onMessage);
    target.postMessage({ channel: XHS_BRIDGE_CHANNEL, kind, requestId, payload }, target.location.origin);
  });
}

export async function probeXhsExtension(options = {}) {
  const response = await requestExtension("ping", null, { ...options, timeoutMs: 3500 });
  if (response.feature !== "draft-v3") throw new Error("本机发布助手需更新到 0.2.1；请在 chrome://extensions 重新加载扩展，并新开 ContentLoop 导出页");
  return response;
}

export function sendXhsDraftToExtension(payload, options = {}) {
  return requestExtension("prepare-draft", payload, options);
}
