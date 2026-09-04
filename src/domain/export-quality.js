export const EXPORT_SAFE_CONTENT_BOTTOM = 1324;

export function createExportAudit(model) {
  return {
    pageNo: model.pageNo,
    pageType: model.type,
    expectedIcons: 0,
    loadedIcons: 0,
    expectedBlocks: model.type === "cover" ? 1 : model.items.length,
    drawnBlocks: 0,
    bodyTop: null,
    contentBottom: null,
    issues: [],
  };
}

export function recordTextOverflow(audit, label, totalLines, maxLines) {
  if (!audit || !Number.isFinite(maxLines) || totalLines <= maxLines) return;
  audit.issues.push({
    type: "text-overflow",
    severity: "warning",
    label,
    message: `${label}超过 ${maxLines} 行，导出时可能被省略`,
  });
}

export function assessExportAudit(audit) {
  const issues = [...(audit.issues || [])];
  if (audit.loadedIcons !== audit.expectedIcons) {
    issues.push({
      type: "missing-icon",
      severity: "error",
      label: "官方装备图标",
      message: `应加载 ${audit.expectedIcons} 个图标，实际加载 ${audit.loadedIcons} 个`,
    });
  }
  if (!Number.isFinite(audit.bodyTop) || !Number.isFinite(audit.contentBottom)) {
    issues.push({
      type: "invalid-layout",
      severity: "error",
      label: "页面排版",
      message: "正文坐标无效，页面可能只有背景或页眉页脚",
    });
  } else if (audit.contentBottom > (audit.safeContentBottom || EXPORT_SAFE_CONTENT_BOTTOM)) {
    issues.push({
      type: "content-overflow",
      severity: "error",
      label: "页面排版",
      message: `正文超出安全区 ${Math.ceil(audit.contentBottom - EXPORT_SAFE_CONTENT_BOTTOM)} 像素`,
    });
  }
  if (audit.drawnBlocks < audit.expectedBlocks) {
    issues.push({
      type: "missing-content",
      severity: "error",
      label: "正文内容",
      message: `应绘制 ${audit.expectedBlocks} 个内容块，实际绘制 ${audit.drawnBlocks} 个`,
    });
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length
      ? "warning"
      : "pass";
  return { ...audit, status, issues };
}
