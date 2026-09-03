import { runMockAiTask } from "../domain/mock-ai-provider.js";
import { validateAiTaskResponse } from "../domain/ai-contract.js";

const liveOnlyTasks = new Set(["rewrite_fields"]);
let aiAccessCode = "";

export function setAiAccessCode(value) {
  aiAccessCode = String(value || "").trim();
}

export function clearAiAccessCode() {
  aiAccessCode = "";
}

function liveAiRequiredMessage() {
  return "当前网站尚未连接在线 AI，已停止使用演示改写。连接在线模型后，AI 才会按你的标题和修改要求真实重写；原内容没有变化。";
}

export async function getAiRuntimeStatus(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl("/api/ai/status", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("AI 状态接口不可用");
    return await response.json();
  } catch {
    return {
      mode: "demo",
      provider: "mock",
      model: "deterministic-demo-v1",
      message: "当前为离线演示模式，仍可体验智能修改。",
    };
  }
}

export async function runAiTask(request, context = {}, fetchImpl = globalThis.fetch) {
  try {
    const headers = { "content-type": "application/json", accept: "application/json" };
    if (aiAccessCode) headers["x-ai-access-code"] = aiAccessCode;
    const response = await fetchImpl("/api/ai/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    if (response.status === 404) {
      if (liveOnlyTasks.has(request.taskType)) throw new Error(liveAiRequiredMessage());
      return runMockAiTask(request, context);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "在线 AI 暂时不可用，旧内容已保留");
    const checked = validateAiTaskResponse(payload, request);
    if (!checked.success) throw new Error(`AI 返回内容未通过检查：${checked.issues.join("；")}`);
    return payload;
  } catch (error) {
    if (error instanceof TypeError) {
      if (liveOnlyTasks.has(request.taskType)) throw new Error(liveAiRequiredMessage());
      return runMockAiTask(request, context);
    }
    throw error;
  }
}

export async function researchGameTopic(input, supplement = "", fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/game/research", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ input, supplement }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || "当前赛季资料暂时无法读取");
  return payload;
}
