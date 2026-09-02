import test from "node:test";
import assert from "node:assert/strict";
import { sampleProject } from "../src/data/sample-project.js";
import { safeParseProject } from "../src/domain/schema.js";
import {
  checkpointHistory,
  deleteSavedVersion,
  dismissDeletedSavedVersion,
  emptyHistory,
  normalizeHistory,
  normalizeVersionLabel,
  redoHistory,
  renameSavedVersion,
  restoreDeletedSavedVersion,
  restoreHistoryVersion,
  saveHistoryVersion,
  undoHistory,
} from "../src/domain/history.js";
import {
  analyzeRewriteImpact,
  analyzeViewpointImpact,
  applyViewpointImpact,
  ensureDistinctPageCopy,
  hasManualOrder,
  isFieldPreserved,
  moveEquipmentItem,
  nextRoute,
  normalizeRoute,
  normalizeViewpointConflicts,
  restoreEquipmentOrder,
  rewriteDocument,
  rewritePage,
  rewritePublishBody,
  togglePreservedField,
  updateOutlinePage,
  updatePage,
  validateOutlinePageDraft,
} from "../src/domain/state.js";
import {
  buildPageRenderModel,
  getAdaptiveTextDensity,
  getIconSource,
  getIllustrationSource,
  getRulePageDensity,
  pageExportFilename,
  parseRecipe,
} from "../src/domain/page-render.js";
import { createZipBytes, crc32 } from "../src/domain/zip.js";
import {
  calculateTitleBodyTop,
  getBalancedCoverTagLayout,
  getEquipmentCardTextLayout,
  getEquipmentPageLayout,
  getRuleGridLayout,
  getTitleTextLayout,
} from "../src/domain/canvas-renderer.js";
import {
  assessExportAudit,
  createExportAudit,
  recordTextOverflow,
} from "../src/domain/export-quality.js";
import {
  analyzeInputDemo,
  buildResearchBriefDemo,
  generateOutlineDemo,
  refreshAnalysisWithParsedSources,
} from "../src/domain/input-analysis.js";
import {
  materializeDynamicProject,
  verifiedDynamicRecipes,
} from "../src/domain/dynamic-pages.js";

test("匿名样例满足项目数据约束", () => {
  const result = safeParseProject(sampleProject);
  assert.equal(result.success, true);
  assert.equal(sampleProject.topics.length, 5);
  assert.equal(sampleProject.pages.length, 7);
});

test("缺少七页内容时返回明确问题", () => {
  const invalid = structuredClone(sampleProject);
  invalid.pages.pop();
  const result = safeParseProject(invalid);
  assert.equal(result.success, false);
  assert.ok(result.issues.some((issue) => issue.includes("7 页")));
});

test("预览和高清导出共用同一套页面渲染模型", () => {
  const tree = buildPageRenderModel(sampleProject.pages[1], "铲友研究所");
  assert.equal(tree.type, "tree");
  assert.equal(tree.items.length, 8);
  assert.deepEqual(tree.items[0].ingredients, ["大剑", "拳套"]);
  assert.equal(tree.items[0].resultName, "无尽之刃");
  assert.match(getIconSource(tree.items[0].resultName), /infinityedge\.png$/);
  assert.equal(pageExportFilename(sampleProject.pages[1]), "铲友装备课01-第02页.png");
});

test("封面标签会根据文字长度选择字号密度", () => {
  assert.equal(getAdaptiveTextDensity("突出新手痛点"), "is-short");
  assert.equal(getAdaptiveTextDensity("承诺给出可收藏的判断路径"), "is-medium");
  assert.equal(getAdaptiveTextDensity("这是一段需要自动缩小并允许换行的超长封面标签文字"), "is-long");
});

test("长文字规则页会自动切换紧凑排版，给正文留出安全空间", () => {
  const model = buildPageRenderModel({
    id: "dense-rule",
    pageNo: 3,
    type: "rule",
    title: "保留分歧的灵活变阵",
    subtitle: "展示两到三种条件分支，不给唯一答案。",
    visual: { name: "branching" },
    blocks: [{
      kind: "steps",
      items: Array.from({ length: 4 }, (_, index) => ({
        name: `第 ${index + 1} 种条件判断方式`,
        detail: "先看现有条件，再看目标功能，最后结合当前局面复核，避免把不同情况下的选择混在一起。",
        example: "按顺序逐项检查，版本结论发布前要复核。",
      })),
    }],
  }, "铲友研究所");
  assert.equal(model.contentDensity, "ultra");
  assert.equal(getRulePageDensity(model), "ultra");
});

test("三个封面标签的最后一项会在第二行居中", () => {
  const layout = getBalancedCoverTagLayout(3, { left: 0, top: 0, width: 1000, areaHeight: 130, gap: 12 });
  assert.equal(layout.length, 3);
  assert.equal(layout[0].x, 0);
  assert.equal(layout[1].x, 506);
  assert.equal(layout[2].x + (layout[2].width / 2), 500);
  assert.ok(layout[2].y > layout[0].y);
});

test("四个封面标签保持规整的两行两列", () => {
  const layout = getBalancedCoverTagLayout(4, { left: 0, top: 0, width: 1000, areaHeight: 130, gap: 12 });
  assert.equal(layout.length, 4);
  assert.equal(layout[2].x, layout[0].x);
  assert.equal(layout[3].x, layout[1].x);
  assert.equal(layout[2].y, layout[3].y);
});

function dynamicFixture() {
  const analysis = analyzeInputDemo("我不知道装备怎么合，也不知道装备应该给谁");
  const topic = analysis.topics[0];
  const research = buildResearchBriefDemo(topic, analysis);
  const viewpointId = research.recommendedViewpointId;
  const outline = generateOutlineDemo(topic, research, viewpointId);
  return materializeDynamicProject({ topic, research, viewpointId, outline });
}

test("不同文字输入会生成不同且贴合主题的候选选题", () => {
  const equipment = analyzeInputDemo("我想讲无尽之刃怎么合成、应该给谁");
  const hero = analyzeInputDemo("王者荣耀新英雄苍上手体验和新手避坑");
  assert.notDeepEqual(equipment.topics.map((topic) => topic.title), hero.topics.map((topic) => topic.title));
  assert.ok(equipment.topics.every((topic) => topic.title.includes("无尽之刃")));
  assert.ok(hero.topics.every((topic) => topic.title.includes("王者荣耀新英雄苍")));
});

test("新赛季阵容、强化符文和运营问题会进入不同主题链", () => {
  const lineup = analyzeInputDemo("我想做新赛季阵容推荐");
  const augment = analyzeInputDemo("强化符文怎么选");
  const economy = analyzeInputDemo("什么时候升级搜牌，怎么控制经济");
  assert.match(lineup.intent, /阵容推荐/);
  assert.ok(lineup.topics.every((topic) => topic.id.startsWith("candidate-lineup-")));
  assert.match(augment.intent, /强化符文/);
  assert.ok(augment.topics.every((topic) => topic.id.startsWith("candidate-augment-")));
  assert.match(economy.intent, /运营与经济/);
  assert.ok(economy.topics.every((topic) => topic.id.startsWith("candidate-economy-")));
  assert.notDeepEqual(lineup.topics.map((topic) => topic.title), augment.topics.map((topic) => topic.title));
});

test("冷门自定义金铲铲问题仍会保留用户主题而不是退回固定选题", () => {
  const analysis = analyzeInputDemo("如何判断什么时候追三星五费");
  assert.ok(analysis.topics.every((topic) => topic.title.includes("三星五费")));
  assert.ok(analysis.topics.every((topic) => !topic.title.includes("4 个体验点")));
});

test("不同主题会生成与类型匹配且不重复的七页任务", () => {
  for (const input of ["新赛季阵容推荐", "强化符文怎么选", "什么时候升级搜牌"]) {
    const analysis = analyzeInputDemo(input);
    const topic = analysis.topics[0];
    const research = buildResearchBriefDemo(topic, analysis);
    const outline = generateOutlineDemo(topic, research, research.recommendedViewpointId);
    assert.equal(outline.pages.length, 7);
    assert.equal(new Set(outline.pages.map((page) => page.title)).size, 7);
    assert.ok(outline.pages.every((page) => page.keyPoints.length >= 2));
  }
});

test("只有网址且正文未确认时不会返回固定候选", () => {
  const analysis = analyzeInputDemo("https://example.com/game-guide");
  assert.ok(analysis.topics.every((topic) => topic.pending));
  assert.match(analysis.topics[0].title, /example\.com/);
  assert.ok(analysis.topics.every((topic) => !topic.title.includes("新内容值不值得玩")));
});

test("确认网页正文后会按当前网页标题和内容重建候选", () => {
  const initial = analyzeInputDemo("https://example.com/game-guide");
  const confirmedSources = initial.sources.map((source) => ({
    ...source,
    title: "王者荣耀苍新手连招详解",
    excerpt: "本文整理苍的基础连招、技能衔接和新手最容易出现的三个操作失误。",
    extractionStatus: "extracted",
    confirmed: true,
  }));
  const refreshed = refreshAnalysisWithParsedSources({ ...initial, sources: confirmedSources }, "https://example.com/game-guide");
  assert.ok(refreshed.topics.every((topic) => !topic.pending));
  assert.ok(refreshed.topics.every((topic) => topic.title.includes("王者荣耀苍新手连招详解")));
  assert.ok(refreshed.topics.every((topic) => topic.evidenceIds.includes("fact-parsed-source")));
});

test("阵容网页不会因为正文提到装备而生成装备候选", () => {
  const initial = analyzeInputDemo("https://jinchanchan.fun/articles/demo");
  const confirmedSources = initial.sources.map((source) => ({
    ...source,
    title: "2026年8月21日 金铲铲之战 S18 热门上分阵容推荐",
    excerpt: "本期整理五套 T0 上分阵容，包含莲华阿狸、德莱文和四星飞升天使，也会说明开局装备与运营条件。",
    extractionStatus: "extracted",
    confirmed: true,
    structured: { contentType: "lineup", game: "金铲铲之战", version: "S18", items: ["金铲铲"], recipes: [] },
  }));
  const refreshed = refreshAnalysisWithParsedSources({ ...initial, sources: confirmedSources }, "https://jinchanchan.fun/articles/demo");
  assert.ok(refreshed.topics.every((topic) => topic.id.startsWith("candidate-lineup-")));
  assert.ok(refreshed.topics.every((topic) => !topic.title.includes("怎么合、给谁")));
});

test("动态七页大纲可安全转换为正式编辑页面", () => {
  const result = dynamicFixture();
  assert.equal(result.pages.length, 7);
  assert.equal(result.pages[0].type, "cover");
  assert.equal(result.pages[1].type, "tree");
  assert.deepEqual(result.pages[1].blocks[0].items, verifiedDynamicRecipes());
  assert.ok(result.pages.slice(2).every((page) => page.blocks[0].items.length >= 3));
  assert.ok(result.exportCopy.body.includes("资料") || result.exportCopy.body.includes("发布前复核"));
});

test("第三步大纲编辑会校验必填内容和要点数量", () => {
  const invalid = validateOutlinePageDraft({
    kicker: "新手先看",
    title: "装备怎么分",
    summary: "按功能判断",
    keyPointsText: "只有一条",
  }, { requireKeyPoints: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.field, "outlineKeyPoints");

  const valid = validateOutlinePageDraft({
    kicker: " 新手先看 ",
    title: " 装备怎么分 ",
    summary: " 按功能判断 ",
    keyPointsText: "先看主 C\n再看前排\n\n最后补启动",
  }, { requireKeyPoints: true });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.keyPoints, ["先看主 C", "再看前排", "最后补启动"]);
});

test("第三步修改后的每页大纲会带入第四步正式页面", () => {
  const analysis = analyzeInputDemo("我不知道装备怎么合，也不知道装备应该给谁");
  const topic = analysis.topics[0];
  const research = buildResearchBriefDemo(topic, analysis);
  const viewpointId = research.recommendedViewpointId;
  const originalOutline = generateOutlineDemo(topic, research, viewpointId);
  const pages = updateOutlinePage(originalOutline.pages, 2, {
    kicker: "先看这张地图",
    title: "我改过的合成页",
    summary: "先把常见路径看清楚",
    keyPoints: ["先看散件", "再找功能"],
  });
  const result = materializeDynamicProject({
    topic,
    research,
    viewpointId,
    outline: { ...originalOutline, pages },
  });
  assert.equal(result.pages[1].kicker, "先看这张地图");
  assert.equal(result.pages[1].title, "我改过的合成页");
  assert.equal(result.pages[1].subtitle, "先把常见路径看清楚");
});

test("动态页面按内容选择官方装备图标或概念配图", () => {
  const { pages } = dynamicFixture();
  const framework = buildPageRenderModel(pages[2], "铲友研究所");
  const mainCarry = buildPageRenderModel(pages[3], "铲友研究所");
  const summary = buildPageRenderModel(pages[6], "铲友研究所");
  assert.match(getIllustrationSource(framework.visual.name), /learning-roadmap-v1\.png$/);
  assert.ok(framework.items.every((item) => item.iconName === ""));
  assert.ok(mainCarry.items.every((item) => /\.png$/.test(getIconSource(item.iconName))));
  assert.match(getIllustrationSource(summary.visual.name), /mnemonic-card-v1\.png$/);
  assert.ok(summary.items.every((item) => item.iconName === ""));
  assert.equal(pages.filter((page) => page.visual).length, 2);
  assert.ok(pages.some((page) => !page.visual));
  assert.ok(pages.slice(2).every((page) => page.blocks[0].items.length === 4));
  assert.ok(framework.items.every((item) => item.detail.length > item.name.length + 15));
});

test("非装备选题不会被强行套用装备合成树", () => {
  const analysis = analyzeInputDemo("想讲阵容运营和来牌判断");
  const topic = analysis.topics[0];
  const research = buildResearchBriefDemo(topic, analysis);
  const viewpointId = research.recommendedViewpointId;
  const outline = generateOutlineDemo(topic, research, viewpointId);
  const result = materializeDynamicProject({ topic, research, viewpointId, outline });
  assert.equal(result.pages[1].type, "rule");
  assert.ok(result.pages.every((page) => page.type !== "tree"));
  const illustratedPages = result.pages.filter((page) => page.visual?.kind === "illustration");
  assert.equal(illustratedPages.length, 7);
  assert.equal(new Set(illustratedPages.map((page) => page.visual.name)).size, illustratedPages.length);
  assert.ok(illustratedPages.some((page) => ["lineup", "economy", "branching", "pitfalls", "diagnosis", "tradeoff"].includes(page.visual.name)));
  assert.ok(result.pages.slice(1).flatMap((page) => page.blocks[0].items).every((item) => !item.iconName));
  result.pages.slice(1).forEach((page) => {
    const items = page.blocks[0].items;
    assert.equal(new Set(items.map((item) => item.detail)).size, items.length);
    assert.equal(new Set(items.map((item) => item.example)).size, items.length);
    assert.ok(items.every((item) => item.detail.length >= 38 && item.detail.length <= 110));
  });
  assert.match(result.exportCopy.body, /来牌|经济|站位/);
  assert.doesNotMatch(result.exportCopy.body, /装备合成|神装不来/);
});

test("动态页面 AI 重写只改文字并保留官方图标", () => {
  const { pages } = dynamicFixture();
  const target = pages[2];
  const beforeIcons = target.blocks[0].items.map((item) => item.iconName);
  const rewritten = rewritePage(pages, target.id, "讲得再详细一点，提醒新手常见误区");
  const after = rewritten.find((page) => page.id === target.id);
  assert.deepEqual(after.blocks[0].items.map((item) => item.iconName), beforeIcons);
  assert.notEqual(JSON.stringify(after), JSON.stringify(target));
  assert.ok(after.blocks[0].items[0].detail.length > after.blocks[0].items[0].name.length);
  assert.ok(!after.blocks[0].items[0].detail.includes("讲得再详细一点"));
  assert.ok(after.blocks[0].items.every((item) => !item.detail.includes("。。")));
});

test("配方解析同时兼容全角和半角符号", () => {
  assert.deepEqual(parseRecipe("大剑＋拳套＝无尽之刃").ingredients, ["大剑", "拳套"]);
  assert.equal(parseRecipe("大剑+拳套=无尽之刃").resultName, "无尽之刃");
});

test("高清画布标题行数会生成有限的正文起始坐标", () => {
  assert.equal(calculateTitleBodyTop(true, 1, 1), 283);
  assert.equal(calculateTitleBodyTop(true, 2, 2), 404);
  assert.ok(Number.isFinite(calculateTitleBodyTop(false, 2, 1)));
});

test("高清标题保留完整可用宽度，避免文字叠成白块", () => {
  assert.deepEqual(getTitleTextLayout(true), {
    x: 64,
    y: 182,
    maxWidth: 952,
    lineHeight: 78,
    maxLines: 2,
  });
});

test("装备卡正文与怎么选区域始终保留安全间距", () => {
  for (const height of [288, 296, 310]) {
    const layout = getEquipmentCardTextLayout(height);
    assert.ok(layout.detailTop - 24 >= layout.headerBottom + layout.headerGap);
    assert.ok(layout.detailTop + layout.detailHeight <= layout.cueTop - layout.sectionGap);
    assert.ok(layout.cueTop > layout.detailTop);
    assert.ok(layout.cueBottom <= height - 12);
  }
});

test("三张装备卡会根据长标题后的剩余空间自动缩放", () => {
  const regular = getEquipmentPageLayout(301, 3);
  const compact = getEquipmentPageLayout(422, 3);
  assert.equal(regular.height, 310);
  assert.ok(compact.height < regular.height);
  assert.ok(compact.contentBottom <= 1324);
});

test("规则卡会根据每段文字量生成不同高度并保持在安全区内", () => {
  const items = [
    { name: "短项", detail: "一句简短说明。", example: "实战检查：先看条件。" },
    { name: "长项", detail: "这是一段更完整的判断说明，需要同时比较当前资源、目标功能、对手压力和下一阶段的行动顺序。", example: "实战检查：满足前提再执行，不满足就及时调整路线。" },
    { name: "中等项", detail: "先确认目标，再比较方案代价。", example: "实战检查：保留调整空间。" },
    { name: "另一长项", detail: "把结论放回当前局面复核，避免把上一局的固定答案直接套用到这一局。", example: "实战检查：版本结论发布前单独核验。" },
  ];
  const layout = getRuleGridLayout(330, items);

  assert.equal(layout.cards.length, 4);
  assert.ok(layout.cards[1].height > layout.cards[0].height);
  assert.ok(layout.contentBottom <= 1318);
  assert.equal(layout.cards[0].y, layout.cards[1].y);
  assert.ok(layout.cards[2].y > layout.cards[0].y);
});

test("导出质检可以识别文字截断并给出黄色提醒", () => {
  const audit = createExportAudit({ pageNo: 3, type: "equipment", items: [{}, {}, {}] });
  audit.expectedIcons = 3;
  audit.loadedIcons = 3;
  audit.drawnBlocks = 3;
  audit.bodyTop = 320;
  audit.contentBottom = 1240;
  recordTextOverflow(audit, "无尽之刃适用场景", 3, 2);
  const result = assessExportAudit(audit);

  assert.equal(result.status, "warning");
  assert.match(result.issues[0].message, /超过 2 行/);
});

test("导出质检会阻止坐标无效、正文越界或缺图页面", () => {
  const invalid = createExportAudit({ pageNo: 2, type: "tree", items: Array(8).fill({}) });
  invalid.expectedIcons = 10;
  invalid.loadedIcons = 9;
  invalid.drawnBlocks = 8;
  invalid.bodyTop = Number.NaN;
  invalid.contentBottom = Number.NaN;
  const result = assessExportAudit(invalid);

  assert.equal(result.status, "error");
  assert.ok(result.issues.some((issue) => issue.type === "missing-icon"));
  assert.ok(result.issues.some((issue) => issue.type === "invalid-layout"));
});

test("七页 ZIP 使用有效签名并保留七个中文文件名", () => {
  const entries = sampleProject.pages.map((page) => ({
    name: pageExportFilename(page),
    data: new TextEncoder().encode(`page-${page.pageNo}`),
  }));
  const zip = createZipBytes(entries, new Date("2026-08-20T12:00:00+08:00"));
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...zip.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
  assert.equal(new DataView(zip.buffer).getUint16(zip.length - 12, true), 7);
  assert.equal(crc32(new TextEncoder().encode("test")), 0xd87f7e0c);
  const view = new DataView(zip.buffer);
  const decoder = new TextDecoder();
  const names = [];
  let offset = 0;
  for (let index = 0; index < 7; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const dataLength = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    names.push(decoder.decode(zip.slice(nameStart, nameStart + nameLength)));
    assert.ok(dataLength > 0);
    offset = nameStart + nameLength + extraLength + dataLength;
  }
  const centralOffset = view.getUint32(zip.length - 6, true);
  assert.equal(offset, centralOffset);
  assert.deepEqual(names, entries.map((entry) => entry.name));
});

test("锁定页面不会被样例重写覆盖", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[0].locked = true;
  const rewritten = rewritePage(pages, pages[0].id, "更口语一点");
  assert.deepEqual(rewritten[0], pages[0]);
});

test("未锁定页面只更新目标页", () => {
  const pages = structuredClone(sampleProject.pages);
  const rewritten = rewritePage(pages, pages[1].id, "更适合新手");
  assert.notEqual(rewritten[1].subtitle, pages[1].subtitle);
  assert.deepEqual(rewritten[0], pages[0]);
  assert.deepEqual(rewritten[2], pages[2]);
});

test("AI 建议作为语义指令，不会被原样拼进图片文案", () => {
  const pages = structuredClone(sampleProject.pages);
  const suggestion = "讲得再详细一点，提醒新手常见误区";
  const rewritten = rewritePage(pages, pages[2].id, suggestion);
  assert.equal(rewritten[2].subtitle.includes(suggestion), false);
  assert.match(rewritten[2].rewriteSummary, /选择理由|误区/);
  assert.notEqual(rewritten[2].blocks[0].items[0].detail, pages[2].blocks[0].items[0].detail);
});

test("装备页重写会按每件装备单独总结，不再复用万能话术", () => {
  const pages = structuredClone(sampleProject.pages);
  const rewritten = rewritePage(pages, pages[2].id, "讲得再详细一点，提醒新手常见误区");
  const items = rewritten[2].blocks[0].items;

  assert.equal(new Set(items.map((item) => item.detail)).size, items.length);
  assert.equal(new Set(items.map((item) => item.cue)).size, items.length);
  assert.match(items[0].detail + items[0].cue, /暴击|爆发/u);
  assert.match(items[1].detail + items[1].cue, /高血量|前排/u);
  assert.match(items[2].detail + items[2].cue, /破甲|护甲/u);
  assert.equal(items.every((item) => !item.detail.includes("先看英雄是否真的需要这个功能")), true);
  assert.equal(items.every((item) => !item.cue.includes("合成前再检查主 C 装备格、对手前排和我方启动速度")), true);
});

test("重复的小节文案会按小节标题自动修复为不同总结", () => {
  const page = structuredClone(sampleProject.pages[6]);
  page.blocks[0].items = page.blocks[0].items.map((item) => ({
    ...item,
    detail: "先确认当前条件，再决定下一步。",
    example: "结合当前局面重新判断。",
  }));
  const repaired = ensureDistinctPageCopy(page);
  const items = repaired.blocks[0].items;

  assert.equal(new Set(items.map((item) => item.detail)).size, items.length);
  assert.equal(new Set(items.map((item) => item.example)).size, items.length);
  assert.ok(items.slice(1).every((item) => item.detail.includes(item.name)));
});

test("过短的规则页说明会自动补足信息密度并统一实战提示", () => {
  const page = structuredClone(sampleProject.pages[6]);
  page.blocks[0].items = page.blocks[0].items.map((item) => ({
    ...item,
    detail: item.name === "定主 C" ? "先确定主 C。" : item.detail,
    example: "先检查。",
  }));
  const repaired = ensureDistinctPageCopy(page);
  const items = repaired.blocks[0].items;

  assert.ok(items.every((item) => item.detail.length >= 48));
  assert.ok(items.every((item) => item.example.startsWith("实战检查：")));
  assert.ok(items.every((item) => item.example.length >= 28));
  assert.equal(new Set(items.map((item) => item.detail)).size, items.length);
});

test("AI 建议支持把 A 改成 B 的定向替换", () => {
  const pages = structuredClone(sampleProject.pages);
  const rewritten = rewritePage(pages, pages[2].id, "把物理主 C 改成物理输出位");
  assert.match(rewritten[2].title, /物理输出位/);
  assert.equal(rewritten[2].title.includes("把物理主 C"), false);
});

test("更自然的细节建议也能被识别并产生可见修改", () => {
  const pages = structuredClone(sampleProject.pages);
  const rewritten = rewritePage(pages, pages[2].id, "把细节再丰富一点");
  assert.equal(rewritten[2].rewriteMode, "matched");
  assert.match(rewritten[2].rewriteSummary, /选择理由/);
  assert.notEqual(rewritten[2].blocks[0].items[0].detail, pages[2].blocks[0].items[0].detail);
});

test("未命中固定词时执行通用优化且不照抄用户原话", () => {
  const pages = structuredClone(sampleProject.pages);
  const suggestion = "让这页更有决策感";
  const rewritten = rewritePage(pages, pages[2].id, suggestion);
  assert.equal(rewritten[2].rewriteMode, "fallback");
  assert.match(rewritten[2].rewriteSummary, /通用方向/);
  assert.notEqual(rewritten[2].subtitle, pages[2].subtitle);
  assert.equal(JSON.stringify(rewritten[2]).includes(suggestion), false);
});

test("字段编辑保留其他页面", () => {
  const pages = structuredClone(sampleProject.pages);
  const updated = updatePage(pages, pages[2].id, { title: "用户修改标题" });
  assert.equal(updated[2].title, "用户修改标题");
  assert.equal(updated[1].title, pages[1].title);
});

test("字段可以单独标记保留或取消保留", () => {
  const pages = structuredClone(sampleProject.pages);
  const pageId = pages[2].id;
  const preserved = togglePreservedField(pages, pageId, "items.0.detail");
  assert.equal(isFieldPreserved(preserved[2], "items.0.detail"), true);
  assert.deepEqual(preserved[1], pages[1]);

  const released = togglePreservedField(preserved, pageId, "items.0.detail");
  assert.equal(isFieldPreserved(released[2], "items.0.detail"), false);
});

test("AI 重写跳过已保留字段并继续修改其他字段", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[2].preservedFields = ["subtitle", "items.0.detail"];
  const rewritten = rewritePage(pages, pages[2].id, "讲得再详细一点，提醒新手常见误区");

  assert.equal(rewritten[2].subtitle, pages[2].subtitle);
  assert.equal(rewritten[2].blocks[0].items[0].detail, pages[2].blocks[0].items[0].detail);
  assert.notEqual(rewritten[2].blocks[0].items[1].detail, pages[2].blocks[0].items[1].detail);
  assert.match(rewritten[2].rewriteSummary, /已保留 2 个字段未改动/);
});

test("定向替换也不会覆盖已保留的标题", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[2].preservedFields = ["title"];
  const rewritten = rewritePage(pages, pages[2].id, "把物理主 C 改成物理输出位");
  assert.equal(rewritten[2].title, pages[2].title);
});

test("装备卡可以上移下移并标记人工顺序", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  const before = page.blocks[0].items.map((item) => item.name);
  const moved = moveEquipmentItem(pages, page.id, 0, "down");
  const after = moved[2].blocks[0].items.map((item) => item.name);

  assert.deepEqual(after, [before[1], before[0], before[2]]);
  assert.deepEqual(moved[2].manualOrder, after);
  assert.equal(hasManualOrder(moved[2]), true);
  assert.deepEqual(moved[1], pages[1]);
});

test("装备卡边界与锁定页不会被错误排序", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  assert.deepEqual(moveEquipmentItem(pages, page.id, 0, "up"), pages);
  pages[2].locked = true;
  assert.deepEqual(moveEquipmentItem(pages, page.id, 0, "down"), pages);
});

test("装备卡移动时字段保留会跟着对应装备", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  page.preservedFields = ["items.0.detail", "items.1.cue"];
  const moved = moveEquipmentItem(pages, page.id, 0, "down");
  assert.equal(isFieldPreserved(moved[2], "items.1.detail"), true);
  assert.equal(isFieldPreserved(moved[2], "items.0.cue"), true);
});

test("AI 重写会保留人工装备顺序", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  const moved = moveEquipmentItem(pages, page.id, 0, "down");
  const orderBefore = moved[2].blocks[0].items.map((item) => item.name);
  const rewritten = rewritePage(moved, page.id, "讲得再详细一点");
  const orderAfter = rewritten[2].blocks[0].items.map((item) => item.name);

  assert.deepEqual(orderAfter, orderBefore);
  assert.match(rewritten[2].rewriteSummary, /已保留人工装备顺序/);
  assert.notEqual(rewritten[2].blocks[0].items[0].detail, moved[2].blocks[0].items[0].detail);
});

test("整篇重写影响分析只读运行并标出锁定页", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[0].locked = true;
  const before = structuredClone(pages);
  const impacts = analyzeRewriteImpact(pages, "整篇更像朋友安利，补充新手判断");

  assert.deepEqual(pages, before);
  assert.equal(impacts.length, 7);
  assert.equal(impacts[0].status, "protected");
  assert.deepEqual(impacts[0].protectedFieldLabels, ["整页已锁定"]);
  assert.ok(impacts.some((item) => item.status === "affected"));
});

test("影响分析会显示字段保留和人工装备顺序保护", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  let arranged = moveEquipmentItem(pages, page.id, 0, "down");
  arranged[2].preservedFields = ["items.0.detail"];
  const impact = analyzeRewriteImpact(arranged, "讲得再详细一点")[2];

  assert.equal(impact.status, "affected");
  assert.ok(impact.protectedFieldLabels.includes("人工装备顺序"));
  assert.ok(impact.protectedFieldLabels.some((label) => label.includes("适用场景")));
  assert.equal(impact.changedFieldPaths.includes("items.0.detail"), false);
});

test("整篇重写只更新用户勾选的页面", () => {
  const pages = structuredClone(sampleProject.pages);
  const suggestion = "整篇更像朋友安利，补充新手判断";
  const affected = analyzeRewriteImpact(pages, suggestion)
    .filter((item) => item.status === "affected")
    .map((item) => item.pageId);
  const selected = affected.slice(0, 2);
  const rewritten = rewriteDocument(pages, suggestion, selected);

  assert.notDeepEqual(rewritten.find((page) => page.id === selected[0]), pages.find((page) => page.id === selected[0]));
  assert.notDeepEqual(rewritten.find((page) => page.id === selected[1]), pages.find((page) => page.id === selected[1]));
  const untouchedId = pages.find((page) => !selected.includes(page.id)).id;
  assert.deepEqual(rewritten.find((page) => page.id === untouchedId), pages.find((page) => page.id === untouchedId));
});

test("整篇重写即使误选锁定页也不会覆盖", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[0].locked = true;
  const rewritten = rewriteDocument(pages, "更适合新手", [pages[0].id, pages[1].id]);
  assert.deepEqual(rewritten[0], pages[0]);
  assert.notDeepEqual(rewritten[1], pages[1]);
});

test("切换到定位优先前会识别一致页、待重写页和直接冲突页", () => {
  const pages = structuredClone(sampleProject.pages);
  const before = structuredClone(pages);
  const impacts = analyzeViewpointImpact(pages, "component-first", "role-first");
  const counts = impacts.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});

  assert.deepEqual(pages, before);
  assert.deepEqual(counts, { rewrite: 3, conflict: 1, aligned: 3 });
  assert.equal(impacts.find((item) => item.pageId === "page-tree").status, "conflict");
});

test("观点切换只重写用户选择的普通页面并强制处理直接冲突", () => {
  const pages = structuredClone(sampleProject.pages);
  const impacts = analyzeViewpointImpact(pages, "component-first", "role-first");
  const decisions = Object.fromEntries(impacts.map((item) => [item.pageId, "rewrite"]));
  decisions["page-cover"] = "keep";
  const result = applyViewpointImpact(pages, "role-first", decisions, impacts);

  assert.deepEqual(result.pages[0], pages[0]);
  assert.notDeepEqual(result.pages[1], pages[1]);
  assert.equal(result.pages[1].appliedViewpointId, "role-first");
  assert.equal(result.conflicts.length, 0);
});

test("锁定的直接冲突页不会被覆盖并生成导出阻塞", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[1].locked = true;
  const impacts = analyzeViewpointImpact(pages, "component-first", "role-first");
  const result = applyViewpointImpact(pages, "role-first", {}, impacts);

  assert.deepEqual(result.pages[1], pages[1]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].pageId, "page-tree");
  assert.match(result.conflicts[0].reason, /锁定/);
});

test("解锁后可以重新检查当前观点并消除冲突", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[1].locked = true;
  const firstImpacts = analyzeViewpointImpact(pages, "component-first", "role-first");
  const blocked = applyViewpointImpact(pages, "role-first", {}, firstImpacts);
  const unlocked = updatePage(blocked.pages, "page-tree", { locked: false });
  const retryImpacts = analyzeViewpointImpact(unlocked, "role-first", "role-first", blocked.conflicts);
  const resolved = applyViewpointImpact(unlocked, "role-first", {}, retryImpacts);

  assert.equal(retryImpacts.find((item) => item.pageId === "page-tree").status, "conflict");
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.pages[1].appliedViewpointId, "role-first");
});

test("观点重写继续尊重字段级保留并清理无效冲突数据", () => {
  const pages = structuredClone(sampleProject.pages);
  pages[1].preservedFields = ["title"];
  const impacts = analyzeViewpointImpact(pages, "component-first", "role-first");
  const result = applyViewpointImpact(pages, "role-first", {}, impacts);

  assert.equal(result.pages[1].title, pages[1].title);
  assert.deepEqual(normalizeViewpointConflicts([null, { pageId: "", viewpointId: "x", reason: "x" }]), []);
});

test("可以恢复系统顺序并清除人工顺序标记", () => {
  const pages = structuredClone(sampleProject.pages);
  const page = pages[2];
  const reference = page.blocks[0].items.map((item) => item.name);
  const moved = moveEquipmentItem(pages, page.id, 0, "down");
  const restored = restoreEquipmentOrder(moved, page.id, reference);

  assert.deepEqual(restored[2].blocks[0].items.map((item) => item.name), reference);
  assert.equal(hasManualOrder(restored[2]), false);
});

test("路由会回退到首页并能找到下一步", () => {
  assert.equal(normalizeRoute("#/editor"), "editor");
  assert.equal(normalizeRoute("#/unknown"), "home");
  assert.equal(nextRoute("research"), "outline");
  assert.equal(nextRoute("export"), "export");
});

test("默认小红书正文具备短段落、轻量 Emoji 和事实边界", () => {
  const body = sampleProject.exportCopy.body;
  assert.match(body, /😵‍💫|👇|💡/u);
  assert.match(body, /\n\n/);
  assert.match(body, /资料整理版/);
  assert.match(body, /当前游戏为准/);
});

test("正文 AI 建议会语义重写而不是照抄原话", () => {
  const suggestion = "更有小红书网感，结尾加互动";
  const result = rewritePublishBody(sampleProject.exportCopy.body, suggestion);
  assert.equal(result.mode, "matched");
  assert.match(result.summary, /口语节奏|互动/);
  assert.match(result.body, /评论区/);
  assert.equal(result.body.includes(suggestion), false);
});

test("正文可以精简并减少 Emoji", () => {
  const result = rewritePublishBody(sampleProject.exportCopy.body, "精简一点，不要 emoji");
  assert.match(result.summary, /压缩篇幅|减少 Emoji/);
  assert.ok(result.body.length < sampleProject.exportCopy.body.length);
  assert.doesNotMatch(result.body, /[😵‍💫👇💡✅🎮📌✨]/u);
});

test("正文支持把 A 改成 B 的定向替换", () => {
  const result = rewritePublishBody(sampleProject.exportCopy.body, "把铲友们改成金铲铲玩家");
  assert.match(result.body, /^金铲铲玩家/);
  assert.match(result.summary, /指定内容完成替换/);
});

test("AI 重写前的版本点可以撤销和重做", () => {
  const original = structuredClone(sampleProject.pages);
  const pageId = original[2].id;
  const history = checkpointHistory(emptyHistory(), original, pageId, "AI 重写前", {
    createdAt: "2026-08-20T10:00:00.000Z",
    id: "before-ai",
  });
  const rewritten = rewritePage(original, pageId, "更详细一点");

  const undone = undoHistory(history, rewritten, pageId, {
    createdAt: "2026-08-20T10:01:00.000Z",
    id: "after-ai",
  });
  assert.equal(undone.changed, true);
  assert.deepEqual(undone.pages, original);

  const redone = redoHistory(undone.history, undone.pages, undone.currentPageId, {
    createdAt: "2026-08-20T10:02:00.000Z",
    id: "before-redo",
  });
  assert.equal(redone.changed, true);
  assert.deepEqual(redone.pages, rewritten);
});

test("历史版本最多保留 20 个并可定点恢复", () => {
  let history = emptyHistory();
  let pages = structuredClone(sampleProject.pages);
  for (let index = 0; index < 22; index += 1) {
    pages = updatePage(pages, pages[0].id, { title: `标题 ${index}` });
    history = checkpointHistory(history, pages, pages[0].id, `版本 ${index}`, {
      createdAt: `2026-08-20T10:${String(index).padStart(2, "0")}:00.000Z`,
      id: `version-${index}`,
    });
  }

  assert.equal(history.past.length, 20);
  assert.equal(history.past[0].id, "version-2");
  const restored = restoreHistoryVersion(
    history,
    pages,
    pages[0].id,
    "version-5",
    { createdAt: "2026-08-20T11:00:00.000Z", id: "before-restore" },
  );
  assert.equal(restored.changed, true);
  assert.equal(restored.pages[0].title, "标题 5");
  assert.equal(restored.history.future.length, 0);
});

test("没有历史记录时撤销不会破坏当前页面", () => {
  const pages = structuredClone(sampleProject.pages);
  const result = undoHistory(emptyHistory(), pages, pages[0].id);
  assert.equal(result.changed, false);
  assert.equal(result.pages, pages);
});

test("手动保存的版本不会因撤销而消失", () => {
  const pages = structuredClone(sampleProject.pages);
  let history = saveHistoryVersion(emptyHistory(), pages, pages[0].id, "我的版本", {
    createdAt: "2026-08-20T12:00:00.000Z",
    id: "saved-version",
  });
  history = checkpointHistory(history, pages, pages[0].id, "AI 重写前", {
    createdAt: "2026-08-20T12:01:00.000Z",
    id: "auto-version",
  });
  const rewritten = rewritePage(pages, pages[0].id, "更口语一点");
  const undone = undoHistory(history, rewritten, pages[0].id, {
    createdAt: "2026-08-20T12:02:00.000Z",
    id: "undo-current",
  });

  assert.equal(undone.history.saved.length, 1);
  assert.equal(undone.history.saved[0].id, "saved-version");
  const restored = restoreHistoryVersion(
    undone.history,
    undone.pages,
    undone.currentPageId,
    "saved-version",
    { createdAt: "2026-08-20T12:03:00.000Z", id: "before-saved-restore" },
  );
  assert.equal(restored.changed, true);
  assert.deepEqual(restored.pages, pages);
});

test("命名存档会清理多余空格并限制名称长度", () => {
  assert.equal(normalizeVersionLabel("  面试   演示版  "), "面试 演示版");
  assert.equal(normalizeVersionLabel(" ", ""), "");
  assert.equal(normalizeVersionLabel("铲".repeat(60)).length, 40);
});

test("只有手动命名存档可以改名且自动版本保持不变", () => {
  const pages = structuredClone(sampleProject.pages);
  let history = saveHistoryVersion(emptyHistory(), pages, pages[0].id, "旧名称", {
    createdAt: "2026-08-20T12:10:00.000Z",
    id: "named-version",
  });
  history = checkpointHistory(history, pages, pages[0].id, "自动版本", {
    createdAt: "2026-08-20T12:11:00.000Z",
    id: "auto-version",
  });
  history = renameSavedVersion(history, "named-version", "  封面   定稿  ");
  history = renameSavedVersion(history, "auto-version", "不应生效");

  assert.equal(history.saved[0].label, "封面 定稿");
  assert.equal(history.past[0].label, "自动版本");
});

test("删除命名存档不会影响草稿并且可以撤销删除", () => {
  const pages = structuredClone(sampleProject.pages);
  let history = saveHistoryVersion(emptyHistory(), pages, pages[0].id, "可恢复存档", {
    createdAt: "2026-08-20T12:20:00.000Z",
    id: "recoverable-version",
  });
  history = deleteSavedVersion(history, "recoverable-version", "2026-08-20T12:21:00.000Z");

  assert.equal(history.saved.length, 0);
  assert.equal(history.deletedSaved[0].id, "recoverable-version");
  assert.deepEqual(pages, sampleProject.pages);

  history = restoreDeletedSavedVersion(history, "recoverable-version");
  assert.equal(history.saved[0].label, "可恢复存档");
  assert.equal(history.deletedSaved.length, 0);
  assert.equal(normalizeHistory({ ...history, deletedSaved: [null] }).deletedSaved.length, 0);
});

test("删除恢复提示可以关闭且不影响其他历史版本", () => {
  const pages = structuredClone(sampleProject.pages);
  let history = saveHistoryVersion(emptyHistory(), pages, pages[0].id, "待删除", {
    id: "discard-version",
  });
  history = checkpointHistory(history, pages, pages[0].id, "保留的自动版本", {
    id: "kept-auto-version",
  });
  history = deleteSavedVersion(history, "discard-version");
  history = dismissDeletedSavedVersion(history, "discard-version");

  assert.equal(history.deletedSaved.length, 0);
  assert.equal(history.past[0].id, "kept-auto-version");
});

test("全流程版本会同时恢复选题、观点、正文和所在步骤", () => {
  const pages = structuredClone(sampleProject.pages);
  const before = {
    route: "research",
    accountName: "测试账号",
    sourceInput: "一段灵感",
    selectedTopicId: "topic-before",
    viewpointId: "view-before",
    outlineConfirmed: false,
    pages,
    currentPageId: pages[1].id,
    publishBody: "旧正文",
  };
  const after = {
    ...structuredClone(before),
    route: "export",
    selectedTopicId: "topic-after",
    viewpointId: "view-after",
    publishBody: "新正文",
  };
  const history = checkpointHistory(
    emptyHistory(),
    before.pages,
    before.currentPageId,
    "切换前",
    { createdAt: "2026-08-20T13:00:00.000Z", id: "workflow-before", workflow: before },
  );
  const undone = undoHistory(
    history,
    after.pages,
    after.currentPageId,
    { createdAt: "2026-08-20T13:01:00.000Z", id: "workflow-after", workflow: after },
  );

  assert.equal(undone.workflow.route, "research");
  assert.equal(undone.workflow.selectedTopicId, "topic-before");
  assert.equal(undone.workflow.viewpointId, "view-before");
  assert.equal(undone.workflow.publishBody, "旧正文");

  const redone = redoHistory(
    undone.history,
    undone.pages,
    undone.currentPageId,
    { createdAt: "2026-08-20T13:02:00.000Z", id: "workflow-redo", workflow: before },
  );
  assert.equal(redone.workflow.route, "export");
  assert.equal(redone.workflow.publishBody, "新正文");
});
