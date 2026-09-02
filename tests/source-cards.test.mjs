import test from "node:test";
import assert from "node:assert/strict";
import {
  applySourceExtraction,
  confirmExtractedSource,
  normalizeSourceCards,
  saveManualSource,
  sourceReadinessSummary,
  updateSourceCard,
} from "../src/domain/source-cards.js";

function source(id, url, excerpt = "这是一段用于核对来源的公开正文片段，长度已经超过二十个字。") {
  return { id, url, title: id, excerpt, extractionStatus: "manual", confirmed: false };
}

test("一个已确认来源即可用于研究，不要求第二个站点", () => {
  const sources = normalizeSourceCards([{ ...source("a", "https://www.example.com/a"), confirmed: true }]);
  const readiness = sourceReadinessSummary(sources);
  assert.equal(readiness.usableCount, 1);
  assert.equal(readiness.ready, true);
  assert.equal(sources[0].confirmed, true);
});

test("自动识别结果先等待确认，确认后才用于候选选题", () => {
  let sources = normalizeSourceCards([{ id: "a", url: "https://example.com/a", extractionStatus: "pending" }]);
  sources = applySourceExtraction(sources, "a", {
    status: "extracted",
    title: "装备合成",
    author: "",
    publishedAt: "",
    excerpt: "这是一段已经识别完成、等待用户确认后再用于候选选题的公开正文内容。",
    structured: { contentType: "equipment", version: "S15", items: ["无尽之刃"] },
    retrievalMethod: "reader",
  });
  assert.equal(sourceReadinessSummary(sources).ready, false);
  assert.equal(sources[0].structured.version, "S15");
  assert.equal(sources[0].retrievalMethod, "reader");
  sources = confirmExtractedSource(sources, "a");
  assert.equal(sourceReadinessSummary(sources).ready, true);
});

test("待解析或失败来源不会伪装成可用", () => {
  const sources = normalizeSourceCards([
    { id: "a", url: "https://example.com/a", extractionStatus: "pending" },
    { id: "b", url: "https://example.org/b", extractionStatus: "failed" },
  ]);
  const readiness = sourceReadinessSummary(sources);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.pendingCount, 1);
  assert.equal(readiness.failedCount, 1);
});

test("提取失败保留原始标题并允许手动补充", () => {
  let sources = normalizeSourceCards([{ id: "a", title: "原始标题", url: "https://example.com/a", status: "user_provided" }]);
  sources = applySourceExtraction(sources, "a", { status: "failed", failureReason: "需要登录" });
  assert.equal(sources[0].title, "原始标题");
  assert.equal(sources[0].extractionStatus, "failed");
  sources = updateSourceCard(sources, "a", { excerpt: "这是用户手动补充的一段公开正文片段，已经达到最小长度要求。" });
  sources = saveManualSource(sources, "a");
  assert.equal(sources[0].extractionStatus, "manual");
  assert.equal(sources[0].confirmed, true);
});
