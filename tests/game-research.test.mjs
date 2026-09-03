import test from "node:test";
import assert from "node:assert/strict";
import { buildGameResearch } from "../scripts/game-research.mjs";
import { enrichOutlineWithGameData, materializeDynamicProject } from "../src/domain/dynamic-pages.js";
import { buildPageRenderModel } from "../src/domain/page-render.js";

const champion = (id, name, cost, traits, range = 1) => ({ apiName: `DA_18_${id}`, name, cost, traits, stats: { range }, squareIcon: `assets/${id}.tex` });
const trait = (id, name, desc) => ({ apiName: `DA_18_${id}`, name, desc, effects: [{ minUnits: 2 }, { minUnits: 4 }], icon: `assets/${id}.tex` });
const champions = [
  champion("A", "英雄甲", 5, ["灵魂莲华", "法师"], 4), champion("B", "英雄乙", 4, ["灵魂莲华", "护卫"], 1),
  champion("C", "英雄丙", 3, ["灵魂莲华", "射手"], 3), champion("D", "英雄丁", 2, ["永恒之森", "法师"], 2),
  champion("E", "英雄戊", 4, ["永恒之森", "护卫"]), champion("F", "英雄己", 1, ["永恒之森", "射手"]),
  champion("G", "英雄庚", 5, ["花仙子", "法师"]), champion("H", "英雄辛", 3, ["花仙子", "护卫"]),
  champion("I", "英雄壬", 2, ["花仙子", "射手"]),
];
const bundle = {
  version: "16.17.1",
  cdragon: { sets: { 18: { champions, traits: [trait("Soul", "灵魂莲华", "获得法术和生命加成。"), trait("Wood", "永恒之森", "获得可放置的植物。"), trait("Fairy", "花仙子", "获得仙灵增益。") ] } }, items: [] },
  ddragonChampions: { data: Object.fromEntries(champions.map((item) => [item.apiName, { id: item.apiName, image: { full: `${item.name}.png` } }])) },
  ddragonTraits: { data: {} },
};

test("新赛季阵容候选包含真实英雄名字与官方头像", () => {
  const result = buildGameResearch("新赛季阵容推荐", bundle);
  assert.match(result.season, /^S18/);
  assert.equal(result.topics.length, 5);
  assert.ok(result.topics.every((topic) => topic.entities.length >= 3));
  assert.ok(result.topics.every((topic) => topic.entities.every((item) => item.imageUrl.startsWith("https://raw.communitydragon.org/latest/game/"))));
});

test("指定羁绊时优先生成该真实羁绊和成员解析", () => {
  const result = buildGameResearch("灵魂莲华羁绊解析", bundle);
  assert.match(result.topics[0].title, /灵魂莲华/);
  assert.deepEqual(result.topics[0].entities.map((item) => item.name), ["英雄甲", "英雄乙", "英雄丙"]);
  assert.match(result.topics[0].angle, /获得法术和生命加成/);
  assert.equal(new Set(result.topics.map((topic) => topic.title)).size, 5);
  assert.ok(result.topics.every((topic) => topic.gameData.traitName === "灵魂莲华"));
  assert.ok(result.topics.every((topic) => topic.entities.map((item) => item.name).join("、") === "英雄甲、英雄乙、英雄丙"));
});

test("非官方创作者参考不会作为公开来源展示", () => {
  const result = buildGameResearch("灵魂莲华羁绊解析", bundle);
  const privateSources = result.sources.filter((source) => source.id.startsWith("source-creator-") || source.id === "source-jcc-reference");
  assert.equal(privateSources.length, 4);
  assert.ok(privateSources.every((source) => source.publicDisplay === false));
  assert.ok(privateSources.every((source) => source.retrievalMethod === "private_reference"));
});

test("羁绊成员数量不再被固定截成五个或七个", () => {
  const extraMembers = Array.from({ length: 6 }, (_, index) => champion(`X${index}`, `扩展英雄${index + 1}`, (index % 5) + 1, ["灵魂莲华"], index % 2 ? 4 : 1));
  const expandedChampions = [...champions, ...extraMembers];
  const expandedBundle = {
    ...bundle,
    cdragon: { ...bundle.cdragon, sets: { 18: { ...bundle.cdragon.sets[18], champions: expandedChampions } } },
    ddragonChampions: { data: Object.fromEntries(expandedChampions.map((item) => [item.apiName, { id: item.apiName, image: { full: `${item.name}.png` } }])) },
  };
  const result = buildGameResearch("灵魂莲华羁绊解析", expandedBundle);
  assert.equal(result.topics[0].entities.length, 9);
  const outline = { pages: Array.from({ length: 7 }, (_, index) => ({ pageNo: index + 1, role: "detail", kicker: "测试", title: "测试", summary: "测试说明", keyPoints: ["测试"], factIds: [], assetNeeds: [] })) };
  const project = materializeDynamicProject({ topic: result.topics[0], outline: enrichOutlineWithGameData(outline, result.topics[0]), viewpointId: "view-1", research: { viewpoints: [{ id: "view-1", title: "真实阵容" }] } });
  assert.equal(buildPageRenderModel(project.pages[0], "测试", 7).heroEntities.length, 9);
  assert.equal(buildPageRenderModel(project.pages[1], "测试", 7).items.length, 9);
  assert.equal(buildPageRenderModel(project.pages[3], "测试", 7).items.length, 9);
});

test("实时题目的官方素材会进入第四步页面并被预览模型保留", () => {
  const topic = buildGameResearch("灵魂莲华阵容推荐", bundle).topics[0];
  const outline = { pages: Array.from({ length: 7 }, (_, index) => ({
    pageNo: index + 1,
    role: index === 0 ? "cover" : index === 6 ? "summary" : "detail",
    kicker: "当前赛季",
    title: index === 0 ? topic.title : `${topic.gameData.traitName}要点 ${index + 1}`,
    summary: "根据真实英雄与羁绊关系进行讲解。",
    keyPoints: ["确认核心英雄", "理解羁绊效果", "结合来牌调整"],
    factIds: ["fact-current-set"],
    assetNeeds: ["当前赛季官方素材"],
  })) };
  const enriched = enrichOutlineWithGameData(outline, topic);
  assert.equal(enriched.pages[1].layoutStyle, "roster");
  assert.equal(enriched.pages[3].layoutStyle, "board");
  assert.match(enriched.pages[1].title, /有哪些英雄/);
  const project = materializeDynamicProject({ topic, outline: enriched, viewpointId: "view-1", research: { viewpoints: [{ id: "view-1", title: "真实阵容" }] } });
  assert.equal(project.pages[1].layoutStyle, "roster");
  assert.equal(project.pages[3].layoutStyle, "board");
  const model = buildPageRenderModel(project.pages[0], "铲友研究所", 7);
  assert.equal(model.heroEntities.length, 3);
  assert.ok(model.heroEntities.every((item) => item.imageUrl.startsWith("https://raw.communitydragon.org/latest/game/")));
  const boardModel = buildPageRenderModel(project.pages[3], "铲友研究所", 7);
  assert.equal(boardModel.layoutStyle, "board");
  assert.deepEqual(boardModel.items.map((item) => item.position), ["back", "front", "back"]);
  assert.ok(boardModel.items.every((item) => Number.isInteger(item.boardSlot.row) && Number.isInteger(item.boardSlot.col)));
  const closingModel = buildPageRenderModel(project.pages[6], "铲友研究所", 7);
  assert.equal(closingModel.layoutStyle, "checklist");
  assert.equal(closingModel.heroEntities.length, 3);
  assert.deepEqual(closingModel.heroEntities.map((item) => item.imageUrl), model.heroEntities.map((item) => item.imageUrl));
  const generatedItems = project.pages.slice(1).flatMap((page) => page.blocks[0]?.items || []).filter((item) => typeof item === "object");
  const generatedCopy = generatedItems.flatMap((item) => [item.detail, item.example]).filter(Boolean);
  assert.equal(new Set(generatedCopy).size, generatedCopy.length);
  assert.ok(generatedCopy.every((text) => !text.includes("再结合当前来牌、装备和对手站位复核")));
  assert.ok(generatedCopy.every((text) => !text.includes("读完就能知道下一步怎么做")));
  const transitionCopy = project.pages[4].blocks[0].items.map((item) => item.detail).join(" ");
  assert.match(transitionCopy, /前期|中期|后期/);
  assert.match(transitionCopy, /两星|羁绊|高费核心/);
});
