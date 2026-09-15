const CHANNEL = "contentloop-xhs-publish-v1";
const TRUSTED_ORIGINS = new Set(["https://contentloop--e.pocketbay.app", "http://localhost:4173", "http://127.0.0.1:4173"]);
const CONNECTION_ERROR = "本机扩展连接已失效；请关闭旧 ContentLoop 标签页，在 Chrome 重新打开导出页";

function answer(requestId, result) {
  window.postMessage({ channel: CHANNEL, kind: "result", requestId, ...result }, location.origin);
}

function sendToBackground(message, requestId) {
  try {
    Promise.resolve(chrome.runtime.sendMessage(message))
      .then((result) => answer(requestId, result?.ok ? result : { ok: false, error: result?.error || CONNECTION_ERROR }))
      .catch((error) => answer(requestId, { ok: false, error: /context invalidated/i.test(error.message) ? CONNECTION_ERROR : error.message }));
  } catch (error) {
    answer(requestId, { ok: false, error: /context invalidated/i.test(error.message) ? CONNECTION_ERROR : error.message });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin || !TRUSTED_ORIGINS.has(location.origin)) return;
  const message = event.data;
  if (message?.channel !== CHANNEL || typeof message.requestId !== "string") return;
  if (message.kind === "ping") {
    sendToBackground({ kind: "contentloop-probe" }, message.requestId);
    return;
  }
  if (message.kind !== "prepare-draft") return;
  sendToBackground({ kind: "contentloop-prepare-draft", requestId: message.requestId, payload: message.payload }, message.requestId);
});
