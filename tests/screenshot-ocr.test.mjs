import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOcrText, formatOcrResult, extractScreenshotSections, removeConfirmedScreenshot, isScreenshotReviewReady, usableScreenshotText } from "../src/domain/ocr-layout.js";
import {
  classifyCommentLines,
  classifyScreenshotText,
  createConfirmedScreenshotRecord,
  deriveScreenshotResult,
  extractEquipmentNames,
  extractScreenshotMetrics,
  screenshotInputContext,
} from "../src/domain/screenshot-ocr.js";

test("游戏资料截图会识别装备并进入候选选题", () => {
  const result = deriveScreenshotResult("当前赛季装备合成：暴风之剑 + 拳套 = 无尽之刃，主 C 优先输出装");
  assert.equal(result.category, "game_knowledge");
  assert.equal(result.route, "进入候选选题与研究");
  assert.deepEqual(result.equipment, ["暴风之剑", "拳套", "无尽之刃"]);
});

test("发布数据截图会提取常见小红书指标", () => {
  const text = "浏览量 1.2万 点赞 860 收藏 320 评论 45 涨粉 18";
  assert.equal(classifyScreenshotText(text).category, "performance_data");
  assert.deepEqual(extractScreenshotMetrics(text), { views: 12000, likes: 860, saves: 320, comments: 45, followers: 18 });
});

test("评论截图会把问题、反对意见和经验分开", () => {
  const groups = classifyCommentLines("请问这个装备给谁？\n我觉得这个说法不对\n我用这套上了两百分\n太好用了");
  assert.equal(groups.questions.length, 1);
  assert.equal(groups.objections.length, 1);
  assert.equal(groups.experiences.length, 1);
  assert.equal(groups.emotions.length, 1);
});

test("用户可以手动覆盖系统分类", () => {
  const result = deriveScreenshotResult("点赞 20 收藏 30", "comments");
  assert.equal(result.category, "comments");
  assert.equal(result.route, "提炼问题与候选选题");
});

test("确认记录只保留低清预览和结构化结果", () => {
  const record = createConfirmedScreenshotRecord({
    fileName: "数据.png",
    title: "发布七天数据",
    preview: "data:image/jpeg;base64,low-resolution",
    text: "浏览 3000 收藏 120",
    category: "performance_data",
  }, new Date("2026-08-24T10:00:00.000Z"));
  assert.equal(record.confirmedAt, "2026-08-24T10:00:00.000Z");
  assert.equal(record.preview, "data:image/jpeg;base64,low-resolution");
  assert.equal(record.metrics.saves, 120);
  assert.equal("original" in record, false);
});

test("确认后的截图会转换为可分析输入而不是冒充事实", () => {
  const context = screenshotInputContext({ title: "装备截图", text: "当前版本无尽之刃适合主 C", category: "game_knowledge" });
  assert.match(context, /已确认的游戏资料截图/);
  assert.match(context, /涉及版本事实仍标记待核验/);
  assert.match(context, /无尽之刃/);
});

test("装备名称提取不会重复", () => {
  assert.deepEqual(extractEquipmentNames("无尽之刃，无尽之刃，暴风之剑"), ["暴风之剑", "无尽之刃"]);
});

test("OCR 只清理中文排版，不猜测错字，不破坏英文词间空格", () => {
  assert.equal(normalizeOcrText("No.1 裁决 花 妊\nTeam Fight Tactics"), "No.1 裁决花妊\nTeam Fight Tactics");
});

test("低可信行不作为可用正文，原始结果保留供核对", () => {
  const result = formatOcrResult({ confidence: 51, blocks: [{ paragraphs: [{ lines: [
    { text: "阵容 排名", confidence: 92 },
    { text: "乱码XYZ", confidence: 12 }, { text: "abc", confidence: 20 },
    { text: "No.2 阵容乙", confidence: 90 },
  ] }] }] });
  assert.equal(result.title, "阵容排名");
  assert.match(result.text, /2 行小字/);
  assert.doesNotMatch(result.text, /XYZ/);
  assert.match(result.rawText, /XYZ/);
  assert.equal(result.uncertainLines, 2);
});

test("排名分组保留各组正文和未识别提示，不生成不存在的英雄", () => {
  const text = "阵容排名\nNo.1 阵容甲\n英雄甲\nNo.2 阵容乙\n【待核对】";
  assert.deepEqual(extractScreenshotSections(text), [
    { rank: 1, title: "阵容甲", lines: ["英雄甲"] },
    { rank: 2, title: "阵容乙", lines: ["【待核对】"] },
  ]);
  assert.equal(createConfirmedScreenshotRecord({ text }).sections.length, 2);
});

test("删除只移除指定截图，原数组及其他记录不变", () => {
  const records = [{ id: "a", text: "原文" }, { id: "b", text: "另一个" }];
  assert.deepEqual(removeConfirmedScreenshot(records, "a"), [records[1]]);
  assert.equal(records.length, 2);
  assert.deepEqual(removeConfirmedScreenshot(records, "不存在"), records);
});

test("未核对文字不会进入下游 AI", () => {
  assert.equal(isScreenshotReviewReady("排名\n【待核对：2 行小字或图标无法可靠识别】"), false);
  assert.equal(isScreenshotReviewReady("已核对的阵容资料"), true);
  assert.equal(isScreenshotReviewReady("9月4日阵容排名\n【待核对：2 行小字】"), true);
  assert.equal(usableScreenshotText("阵容资料\n【待核对：2 行小字】"), "阵容资料");
  assert.equal(isScreenshotReviewReady("【待核对：20 行小字】"), false);
});
