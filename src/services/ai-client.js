import { requestJson } from "./request-json.js";
import { validateAiTaskResponse } from "../domain/ai-contract.js";

let aiAccessCode = "";

export function setAiAccessCode(value) {
  aiAccessCode = String(value || "").trim();
}

export function clearAiAccessCode() {
  aiAccessCode = "";
}

export async function getAiRuntimeStatus(fetchImpl = globalThis.fetch) {
  try {
    return await requestJson("/api/ai/status", { headers: { accept: "application/json" } }, fetchImpl, 8000);
  } catch {
    return {
      mode: "unavailable",
      provider: "unknown",
      model: "",
      message: "暂时无法确认 AI 服务状态，请检查网络后重试。",
    };
  }
}

export async function runAiTask(request, context = {}, fetchImpl = globalThis.fetch) {
  try {
    const headers = { "content-type": "application/json", accept: "application/json" };
    if (aiAccessCode) headers["x-ai-access-code"] = aiAccessCode;
    const payload = await requestJson("/api/ai/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    }, fetchImpl);
    const checked = validateAiTaskResponse(payload, request);
    if (!checked.success) throw new Error(`AI 返回内容未通过检查：${checked.issues.join("；")}`);
    return payload;
  } catch (error) {
    throw error;
  }
}

export async function researchGameTopic(input, supplement = "", fetchImpl = globalThis.fetch) {
  const payload = await requestJson("/api/game/research", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ input, supplement }),
  }, fetchImpl, 12000);
  if (!payload.ok) throw new Error(payload.message || "当前赛季资料暂时无法读取");
  return payload;
}
