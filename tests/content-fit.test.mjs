import test from "node:test";
import assert from "node:assert/strict";
import { renderPageToCanvasWithAudit, getRuleGridLayout } from "../src/domain/canvas-renderer.js";
import { resolveOutlineRewriteInstruction, ensureDistinctPageCopy } from "../src/domain/state.js";
import { materializeDynamicProject, enrichOutlineWithGameData } from "../src/domain/dynamic-pages.js";
import { analyzeInputDemo, buildResearchBriefDemo, generateOutlineDemo } from "../src/domain/input-analysis.js";

test("保存后的大纲全文进入第四步且不会被补全或刷新改回旧稿", () => {
  const analysis = analyzeInputDemo("神谕羁绊的英雄技能怎么用");
  const topic = analysis.topics[0];
  const research = buildResearchBriefDemo(topic, analysis);
  const viewpointId = research.recommendedViewpointId;
  const outline = enrichOutlineWithGameData(generateOutlineDemo(topic, research, viewpointId), topic);
  outline.pages = outline.pages.map((page) => ({ ...page, contentEdited: true,
    title: `新标题${page.pageNo}`, summary: `修改后的说明${page.pageNo}`,
    keyPoints: [`我的第一段${page.pageNo}，保留原文。`, `我的第二段${page.pageNo}，不套用模板。`],
  }));
  const result = materializeDynamicProject({ topic, research, viewpointId, outline });
  result.pages.forEach((page, index) => {
    assert.equal(page.title, outline.pages[index].title);
    assert.equal(page.subtitle, outline.pages[index].summary);
    const items = page.blocks[0].items;
    assert.deepEqual(index === 0 ? items : items.map((item) => item.detail), outline.pages[index].keyPoints);
    assert.deepEqual(ensureDistinctPageCopy(page), page);
  });
});

test("没有额外意见也会将手改标题和说明提交给 AI", () => {
  const original = { title: "原题", summary: "原说明", keyPointsText: "原要点" };
  const draft = { ...original, title: "神谕英雄的技能", summary: "只讲技能和回蓝机制" };
  const instruction = resolveOutlineRewriteInstruction(draft, original, "");
  assert.match(instruction, /神谕英雄的技能/);
  assert.match(instruction, /只讲技能和回蓝机制/);
  assert.equal(resolveOutlineRewriteInstruction(draft, original, "改为装备推荐"), "改为装备推荐");
  assert.ok(resolveOutlineRewriteInstruction(original, original, ""));
});

test("规则卡按同排最长文案扩展高度，下一排随之下移", () => {
  const layout = getRuleGridLayout(500, [{}, {}, {}, {}], { minHeights: [700, 500, 300, 400] });
  assert.equal(layout.cards[0].height, 700);
  assert.equal(layout.cards[1].height, 700);
  assert.equal(layout.cards[2].y, 1218);
  assert.ok(layout.contentBottom > 1440);
});

test("长正文和黄色提示完整绘制，长页同步扩展画布与页脚安全区", async (t) => {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  t.after(() => { globalThis.document = previousDocument; globalThis.Image = previousImage; });
  globalThis.Image = class { naturalWidth = 128; naturalHeight = 128; set src(value) { queueMicrotask(() => this.onload()); } };
  globalThis.document = { baseURI: "https://example.test", createElement() {
    const canvas = { width: 1080, height: 1440, cues: [] };
    const stack = [];
    const ctx = new Proxy({ canvas, font: "23px sans-serif", textAlign: "left", textBaseline: "alphabetic",
      beginPath() { this.points = []; },
      moveTo(x, y) { this.points.push([x, y]); },
      arcTo(x, y, x2, y2) { this.points.push([x, y], [x2, y2]); },
      fill() { if (this.fillStyle === "#1e1434") {
        const xs = this.points.map(([x]) => x), ys = this.points.map(([, y]) => y);
        canvas.cues.push([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
      } },
      measureText(text) { return { width: Array.from(String(text)).length * Number(this.font.match(/([\d.]+)px/)?.[1] || 23) }; },
      save() { stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
      restore() { Object.assign(this, stack.pop()); },
      createLinearGradient() { return { addColorStop() {} }; },
      createRadialGradient() { return { addColorStop() {} }; },
    }, { get(target, key) { return key in target ? target[key] : () => {}; } });
    canvas.getContext = () => ctx;
    return canvas;
  } };
  for (const layoutStyle of ["cards", "checklist", "timeline", "roster"]) {
    const page = { id: "long", pageNo: 3, type: "rule", layoutStyle, title: "测试完整内容", subtitle: "保留所有文字",
      blocks: [{ kind: "steps", items: Array.from({ length: 4 }, (_, i) => ({ name: ["甲", "乙", "丙", "丁"][i],
        imageUrl: "https://ddragon.leagueoflegends.com/test.png",
        detail: "观察当前来牌和装备后，再选择合适的调整方式。".repeat(12),
        example: "先看输出能否启动，再判断是否需要更换承伤位置。".repeat(i + 1),
      })) }] };
    const { canvas, audit } = await renderPageToCanvasWithAudit(page);
    assert.equal(audit.status, "pass", `${layoutStyle}: ${JSON.stringify(audit.issues)}`);
    assert.ok(canvas.height > 1440, layoutStyle);
    assert.ok(audit.contentBottom <= canvas.height - 116, layoutStyle);
    if (layoutStyle === "cards") {
      const cues = canvas.cues.slice(-4);
      assert.equal(cues.length, 4);
      assert.ok(cues.every((box) => JSON.stringify(box) === JSON.stringify(cues[0])));
    }
  }
});
