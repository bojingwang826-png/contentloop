import test from "node:test";
import assert from "node:assert/strict";
import { renderPageToCanvasWithAudit, getRuleGridLayout } from "../src/domain/canvas-renderer.js";
import { resolveOutlineRewriteInstruction } from "../src/domain/state.js";

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
    const canvas = { width: 1080, height: 1440 };
    const stack = [];
    const ctx = new Proxy({ canvas, font: "23px sans-serif", textAlign: "left", textBaseline: "alphabetic",
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
        example: "先看输出能否启动，再判断是否需要更换承伤位置。".repeat(5),
      })) }] };
    const { canvas, audit } = await renderPageToCanvasWithAudit(page);
    assert.equal(audit.status, "pass", `${layoutStyle}: ${JSON.stringify(audit.issues)}`);
    assert.ok(canvas.height > 1440, layoutStyle);
    assert.ok(audit.contentBottom <= canvas.height - 116, layoutStyle);
  }
});
