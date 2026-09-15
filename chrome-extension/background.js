const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?target=image";
const TRUSTED_SITES = new Set(["https://contentloop.pocketbay.app", "https://contentloop--e.pocketbay.app", "http://localhost:4173", "http://127.0.0.1:4173"]);

function validatePayload(payload) {
  if (!payload || typeof payload.title !== "string" || !payload.title.trim() || typeof payload.body !== "string" || !payload.body.trim()) {
    throw new Error("标题或正文为空，发布已取消");
  }
  if (!Array.isArray(payload.images) || payload.images.length !== 7) throw new Error("必须包含七页 PNG 图片");
  for (const [index, image] of payload.images.entries()) {
    if (image.pageNo !== index + 1 || typeof image.name !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl)) {
      throw new Error(`第 ${index + 1} 页图片无效`);
    }
  }
}

async function waitForCreatorScript(tabId) {
  let injected = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url === "about:blank") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (!tab.url?.startsWith("https://creator.xiaohongshu.com/")) throw new Error("请先在同一个 Chrome 中登录小红书创作服务平台，然后重试");
    if (/\/login(?:[/?#]|$)/.test(tab.url)) throw new Error("小红书尚未登录；请登录创作服务平台后重试");
    if (!injected) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["xhs-page.js"] });
      } catch (error) {
        throw new Error(`扩展未能进入小红书图文页：${error.message}。请确认 Chrome 允许此扩展访问小红书创作平台`);
      }
      injected = true;
    }
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { kind: "contentloop-ping" });
      if (reply?.ready) return;
    } catch { /* 内容脚本等待页面完成加载 */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("小红书创作页面未就绪，请检查登录状态并重试");
}

async function showCreatorError(tabId, message) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (new URL(tab.url || "").origin !== "https://creator.xiaohongshu.com") return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (errorText) => {
        if (!document.body) return;
        let status = document.getElementById("contentloop-draft-status");
        if (!status) {
          status = document.createElement("div");
          status.id = "contentloop-draft-status";
          status.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:10px;background:#fff;color:#222;border:1px solid #e5484d;box-shadow:0 4px 18px #0002;font:14px/1.5 system-ui,sans-serif;";
          document.body.appendChild(status);
        }
        status.textContent = `ContentLoop 自动带入未完成：${errorText}。当前页面已保留，请勿连续重试。`;
      },
      args: [String(message || "未知错误").slice(0, 300)],
    });
  } catch { /* 注入权限也可能失效，原错误仍返回 ContentLoop */ }
}

async function prepareDraft(payload) {
  validatePayload(payload);
  const tab = await chrome.tabs.create({ url: PUBLISH_URL, active: true });
  try {
    await waitForCreatorScript(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { kind: "contentloop-fill-draft", payload });
    if (!result?.ok) throw new Error(result?.error || "小红书草稿未完整填入；请检查已打开的页面");
    return { ...result, tabId: tab.id };
  } catch (error) {
    await showCreatorError(tab.id, error.message);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind !== "contentloop-prepare-draft" && message?.kind !== "contentloop-probe") return;
  const originOf = (url) => { try { return new URL(url || "").origin; } catch { return ""; } };
  const frameOrigin = originOf(sender.url);
  const tabOrigin = originOf(sender.tab?.url);
  if (!TRUSTED_SITES.has(frameOrigin) || !TRUSTED_SITES.has(tabOrigin) || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "来源页面不受信任" });
    return;
  }
  if (message.kind === "contentloop-probe") {
    sendResponse({ ok: true, feature: "draft-v3" });
    return;
  }
  prepareDraft(message.payload)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
