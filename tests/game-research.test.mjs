import test from "node:test";
import assert from "node:assert/strict";
import { buildGameResearch } from "../scripts/game-research.mjs";
import { materializeDynamicProject } from "../src/domain/dynamic-pages.js";
import { buildPageRenderModel } from "../src/domain/page-render.js";

const champion = (id, name, cost, traits) => ({ apiName: `DA_18_${id}`, name, cost, traits, squareIcon: `assets/${id}.tex` });
const trait = (id, name, desc) => ({ apiName: `DA_18_${id}`, name, desc, effects: [{ minUnits: 2 }, { minUnits: 4 }], icon: `assets/${id}.tex` });
const champions = [
  champion("A", "英雄甲", 5, ["灵魂莲华", "法师"]), champion("B", "英雄乙", 4, ["灵魂莲华", "护卫"]),
  champion("C", "英雄丙", 3, ["灵魂莲华", "射手"]), champion("D", "英雄丁", 2, ["永恒之森", "法师"]),
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
  assert.equal(result.season, "S18");
  assert.equal(result.topics.length, 3);
  assert.ok(result.topics.every((topic) => topic.entities.length >= 3));
  assert.ok(result.topics.every((topic) => topic.entities.every((item) => item.imageUrl.startsWith("https://ddragon.leagueoflegends.com/"))));
});

test("指定羁绊时优先生成该真实羁绊和成员解析", () => {
  const result = buildGameResearch("灵魂莲华羁绊解析", bundle);
  assert.match(result.topics[0].title, /灵魂莲华/);
  assert.deepEqual(result.topics[0].entities.map((item) => item.name), ["英雄甲", "英雄乙", "英雄丙"]);
  assert.match(result.topics[0].angle, /获得法术和生命加成/);
});

test("实时题目的官方素材会进入第四步页面并被预览模型保留", () => {
  const topic = buildGameResearch("新赛季阵容推荐", bundle).topics[0];
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
  const project = materializeDynamicProject({ topic, outline, viewpointId: "view-1", research: { viewpoints: [{ id: "view-1", title: "真实阵容" }] } });
  assert.ok(project.pages.filter((page) => page.visual).length >= 4);
  const model = buildPageRenderModel(project.pages[0], "铲友研究所", 7);
  assert.equal(model.visual.kind, "official");
  assert.match(model.visual.source, /^https:\/\/(?:ddragon\.leagueoflegends\.com|raw\.communitydragon\.org)\//);
});
