const isText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Phase A 轻量验证层。恢复依赖后由同名 Zod Schema 替换，调用方不变。
 * @param {unknown} input
 * @returns {{ success: true, data: any } | { success: false, issues: string[] }}
 */
export function safeParseProject(input) {
  const issues = [];
  if (!input || typeof input !== "object") {
    return { success: false, issues: ["项目必须是对象"] };
  }

  if (!isText(input.id)) issues.push("缺少项目 id");
  if (!isText(input.name)) issues.push("缺少项目名称");
  if (!Array.isArray(input.topics) || input.topics.length !== 5) {
    issues.push("匿名样例必须包含 5 个选题");
  }
  if (!Array.isArray(input.viewpoints) || input.viewpoints.length < 2) {
    issues.push("研究页至少需要 2 个观点");
  }
  if (!Array.isArray(input.pages) || input.pages.length !== 7) {
    issues.push("图文大纲必须恰好包含 7 页");
  }

  const pageIds = new Set();
  for (const [index, page] of (input.pages || []).entries()) {
    if (!isText(page?.id)) issues.push(`第 ${index + 1} 页缺少 id`);
    if (pageIds.has(page?.id)) issues.push(`页面 id 重复：${page.id}`);
    pageIds.add(page?.id);
    if (page?.pageNo !== index + 1) issues.push(`第 ${index + 1} 页页码不连续`);
    if (!isText(page?.title)) issues.push(`第 ${index + 1} 页缺少标题`);
    if (!Array.isArray(page?.blocks)) issues.push(`第 ${index + 1} 页 blocks 必须是数组`);
    if (typeof page?.locked !== "boolean") issues.push(`第 ${index + 1} 页缺少锁定状态`);
    if (page?.preservedFields !== undefined && !Array.isArray(page.preservedFields)) {
      issues.push(`第 ${index + 1} 页 preservedFields 必须是数组`);
    }
    if (page?.manualOrder !== undefined && (
      !Array.isArray(page.manualOrder)
      || page.manualOrder.some((name) => !isText(name))
    )) {
      issues.push(`第 ${index + 1} 页 manualOrder 必须是装备名称数组`);
    }
  }

  for (const evidence of input.evidence || []) {
    if (!["green", "yellow", "red"].includes(evidence.status)) {
      issues.push(`未知证据状态：${evidence.status}`);
    }
    if (!isText(evidence.label)) issues.push("证据缺少文字标签");
  }

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: input };
}

export function parseProject(input) {
  const result = safeParseProject(input);
  if (!result.success) throw new Error(result.issues.join("；"));
  return result.data;
}
