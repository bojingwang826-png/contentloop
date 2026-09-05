import test from "node:test";
import assert from "node:assert/strict";
import { obsidianSnapshotMarkdown } from "../src/services/obsidian-sync.js";

test("Obsidian 自动快照保留七页、文案和待确认边界", () => {
  const markdown = obsidianSnapshotMarkdown({
    route: "editor", accountName: "铲友研究所", selectedTopicId: "topic-1", contentSource: "dynamic",
    outlineConfirmed: true, currentPageId: "p1", publishBody: "正文内容", publishBodyPreserved: false,
    pages: [{ pageNo: 1, title: "封面标题", subtitle: "完整说明", blocks: [{ kind: "steps", items: [{ detail: "要点正文" }] }] }],
    confirmedScreenshots: [], customProject: { topic: { title: "新手判断" } }, history: { saved: [{ label: "面试版" }] },
  }, "2026-09-05T00:00:00.000Z");
  assert.match(markdown, /status: ai-pending/);
  assert.match(markdown, /AI 待确认/);
  assert.match(markdown, /第 1 页｜封面标题/);
  assert.match(markdown, /完整说明/);
  assert.match(markdown, /要点正文/);
  assert.match(markdown, /正文内容/);
  assert.doesNotMatch(markdown, /\.obsidian/);
});

test("Obsidian 快照不会被正文中的代码围栏提前闭合", () => {
  const markdown = obsidianSnapshotMarkdown({ pages: [], publishBody: "```危险围栏```", history: {} });
  assert.match(markdown, /` ` `危险围栏` ` `/);
  assert.equal((markdown.match(/```json/g) || []).length, 1);
});
