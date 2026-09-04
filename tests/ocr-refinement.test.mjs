import test from "node:test";
import assert from "node:assert/strict";
import { planOcrRegions, refineOcrRegions } from "../src/services/ocr-refinement.js";
import { readOcrLines } from "../src/domain/ocr-layout.js";

const page = (lines) => ({ blocks: [{ paragraphs: [{ lines }] }] });
const line = (text, confidence, bbox = { x0: 0, y0: 0, x1: 80, y1: 20 }) => ({ text, confidence, bbox });
test("局部重识别只选择有限区域并限制在图片边界内", () => {
  const regions = planOcrRegions(page(Array.from({ length: 30 }, () => line("需要核对", 30))), 100, 100);
  assert.equal(regions.length, 16);
  assert.equal(regions[0].rectangle.left, 0);
  assert.ok(regions[0].rectangle.width <= 100);
  assert.equal(planOcrRegions(page([line("可信标题", 99)]), 100, 100).length, 0);
});
test("局部复识别保留原有顺序与坐标，不用短片段替换整行", async () => {
  const input = page([line("标题", 99), line("一行原始文字", 30), line("另外一段原文", 20)]);
  const out = await refineOcrRegions(input, 100, 100, async (region) => page([
    line(region.index === 1 ? "一行清晰文字" : "字", 95),
  ]));
  assert.equal(out.improvedRegions, 1);
  assert.deepEqual(readOcrLines(out).map((item) => item.text), ["标题", "一行清晰文字", "另外一段原文"]);
  assert.deepEqual(readOcrLines(out)[1].bbox, readOcrLines(input)[1].bbox);
});
test("竖排行复识别按字序连接，低质量重试不覆盖原文", async () => {
  const input = page([line("竖排", 30, { x0: 5, y0: 5, x1: 15, y1: 80 })]);
  const out = await refineOcrRegions(input, 100, 100, async (region) => {
    assert.equal(region.vertical, true);
    return page([line("英", 90), line("雄", 90)]);
  });
  assert.equal(readOcrLines(out)[0].text, "英雄");
  const unchanged = await refineOcrRegions(input, 100, 100, async () => page([line("乱码", 10)]));
  assert.equal(readOcrLines(unchanged)[0].text, "竖排");
});
