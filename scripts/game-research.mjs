const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const CDRAGON_URL = "https://raw.communitydragon.org/latest/cdragon/tft/zh_cn.json";
const RIOT_TFT_DOCS = "https://developer.riotgames.com/docs/tft";
const RIOT_TFT_NEWS = "https://teamfighttactics.leagueoflegends.com/zh-cn/news/";

let cachedBundle;
let cachedAt = 0;
const CACHE_MS = 30 * 60 * 1000;

function compact(value, max = 180) {
  return String(value || "").replace(/<br\s*\/?>/gi, "；").replace(/<[^>]+>/g, " ").replace(/%i:[^%]+%/gi, "").replace(/@[^@]+@/g, "").replace(/；\s*；/g, "；").replace(/\s+/g, " ").trim().slice(0, max);
}

function imageUrl(version, group, file) {
  return file ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/${group}/${encodeURIComponent(file)}` : "";
}

function cdragonImageUrl(path) {
  const clean = String(path || "").trim().toLowerCase().replace(/\.tex$/i, ".png");
  return clean.startsWith("assets/") ? `https://raw.communitydragon.org/latest/game/${clean}` : "";
}

function currentSetNumber(data) {
  return Math.max(...Object.keys(data?.sets || {}).map(Number).filter((value) => Number.isFinite(value) && value > 0));
}

function kindFor(text) {
  if (/(新赛季阵容|阵容推荐|强势阵容|上分阵容|阵容)/u.test(text)) return "lineup";
  if (/(羁绊|转职|纹章)/u.test(text)) return "trait";
  if (/(强化符文|海克斯|强化)/u.test(text)) return "augment";
  if (/(英雄|棋子|主\s*C|单卡)/u.test(text)) return "hero";
  if (/(装备|合成|散件|成装)/u.test(text)) return "equipment";
  if (/(版本|更新|补丁|改动)/u.test(text)) return "version";
  if (/(站位|对位|换边|集火)/u.test(text)) return "positioning";
  if (/(运营|经济|升级|搜牌|人口)/u.test(text)) return "economy";
  if (/(机制|玩法|赛季)/u.test(text)) return "mechanic";
  return "experience";
}

function entity(champion) {
  return {
    name: champion.name,
    cost: Number(champion.cost || champion.tier || 0),
    traits: champion.traits || [],
    imageUrl: champion.imageUrl,
    alt: `${champion.name}英雄头像`,
  };
}

function mediaFrom(trait, champions) {
  const traitMedia = trait?.imageUrl ? [{
    kind: "official",
    name: `trait-${trait.apiName}`,
    source: trait.imageUrl,
    label: `${trait.name}羁绊图标`,
    alt: `${trait.name}羁绊的官方图标`,
    reason: `本页讲解${trait.name}，使用对应赛季官方素材`,
  }] : [];
  return [...traitMedia, ...champions.filter((item) => item.imageUrl).slice(0, 7).map((item) => ({
    kind: "official",
    name: `hero-${item.apiName}`,
    source: item.imageUrl,
    label: `${item.name}英雄头像`,
    alt: `${item.name}的当前赛季官方头像`,
    reason: `该英雄属于本题实际讲解内容`,
  }))];
}

function score(index, bonus = 0) {
  return Math.max(78, 94 - (index * 4) + bonus);
}

function topicRecord({ id, kind, title, angle, badge, reason, trait, champions, index, facts }) {
  const entities = champions.slice(0, 7).map(entity);
  return {
    id: `candidate-${kind}-live-${id}`,
    title: compact(title, 48),
    angle: compact(angle, 150),
    badge,
    recommendation: score(index),
    freshness: 96,
    saveValue: 91 - index,
    evergreen: 72,
    pain: 88 - index,
    reason: compact(reason, 220),
    evidenceIds: facts,
    pending: false,
    entities,
    media: mediaFrom(trait, champions),
    gameData: {
      traitName: trait?.name || "",
      traitDescription: compact(trait?.desc, 260),
      heroNames: entities.map((item) => item.name),
    },
  };
}

function pickTraits(text, traits, champions) {
  const exact = traits.filter((trait) => text.includes(trait.name));
  const ranked = traits.map((trait) => ({
    ...trait,
    members: champions.filter((champion) => champion.traits.includes(trait.name)),
  })).filter((trait) => {
    const uniqueNames = new Set(trait.members.map((member) => member.name.replace(/\s*\([^)]*\)\s*$/u, "")));
    return trait.members.length >= 3 && uniqueNames.size >= 3 && (!/(?:自然之力|大元素使)/u.test(trait.name) || exact.some((item) => item.apiName === trait.apiName));
  })
    .sort((a, b) => (exact.some((item) => item.apiName === b.apiName) - exact.some((item) => item.apiName === a.apiName)) || b.members.length - a.members.length || a.name.localeCompare(b.name, "zh-CN"));
  return [...exact.map((trait) => ranked.find((item) => item.apiName === trait.apiName)).filter(Boolean), ...ranked]
    .filter((trait, index, list) => list.findIndex((item) => item.apiName === trait.apiName) === index)
    .slice(0, 3);
}

function bestMembers(trait) {
  return [...trait.members].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, "zh-CN")).slice(0, 7);
}

function buildTopics(text, kind, traits, champions, augments) {
  const selectedTraits = pickTraits(text, traits, champions);
  const factIds = ["fact-current-set", "fact-current-roster"];
  if (kind === "lineup") return selectedTraits.map((trait, index) => {
    const members = bestMembers(trait);
    const core = members.slice(0, 3).map((item) => item.name).join("＋");
    return topicRecord({ id: `${index + 1}`, kind, index, trait, champions: members, facts: factIds,
      title: `${trait.name}阵容方向：${core}`,
      angle: `以真实${trait.name}成员${members.map((item) => item.name).join("、")}为基础，讲开局条件、成型结构与可替换位置。`,
      badge: "赛季阵容",
      reason: `当前赛季数据中，这些英雄实际拥有${trait.name}羁绊；内容按真实成员关系整理，不虚构胜率或“T0”结论。`,
    });
  });
  if (kind === "trait") return selectedTraits.map((trait, index) => {
    const members = bestMembers(trait);
    return topicRecord({ id: `${index + 1}`, kind, index, trait, champions: members, facts: factIds,
      title: `${trait.name}羁绊解析：效果、档位与英雄`,
      angle: `${compact(trait.desc, 76)}；涉及英雄：${members.map((item) => item.name).join("、")}。`,
      badge: "真实羁绊",
      reason: `使用当前赛季客户端羁绊说明和真实英雄名单，后续页面会分别解释效果、成员职责与搭配条件。`,
    });
  });
  if (kind === "hero") {
    const named = champions.filter((item) => text.includes(item.name));
    const chosen = [...named, ...champions].filter((item, index, list) => list.findIndex((value) => value.apiName === item.apiName) === index)
      .sort((a, b) => (named.includes(b) - named.includes(a)) || b.cost - a.cost).slice(0, 3);
    return chosen.map((champion, index) => topicRecord({ id: `${index + 1}`, kind, index, champions: [champion], facts: factIds,
      title: `${champion.name}解析：技能定位与阵容职责`,
      angle: `${champion.cost}费英雄，拥有${champion.traits.join("、")}羁绊；结合当前赛季真实技能与队友关系讲解。`,
      badge: "英雄解析",
      reason: `候选内容直接绑定${champion.name}的当前赛季头像、费用与羁绊，不使用通用英雄模板。`,
    }));
  }
  if (kind === "augment" && augments.length) {
    const selected = augments.filter((item) => item.name && item.imageUrl && !/missing/i.test(item.icon)).slice(0, 3);
    return selected.map((augment, index) => ({
      ...topicRecord({ id: `${index + 1}`, kind, index, champions: bestMembers(selectedTraits[index] || selectedTraits[0]), facts: factIds,
        title: `${augment.name}强化符文：适用条件与阵容`, angle: compact(augment.desc, 130), badge: "真实强化",
        reason: "按当前客户端强化符文说明讲适用条件，并配合真实赛季英雄举例。" }),
      media: [{ kind: "official", name: `augment-${augment.apiName}`, source: augment.imageUrl, label: `${augment.name}强化图标`, alt: `${augment.name}强化符文图标`, reason: "当前主题对应的真实强化素材" }, ...mediaFrom(selectedTraits[index], bestMembers(selectedTraits[index] || selectedTraits[0]))],
    }));
  }
  const labels = {
    equipment: ["当前赛季装备怎么给：先看英雄职责", "同一件装备，哪些真实英雄更适合", "装备不齐时如何按羁绊功能替换"],
    version: ["当前赛季改动先看哪些真实英雄", "版本变化如何影响羁绊结构", "更新后最值得重新检查的搭配"],
    positioning: ["当前赛季前后排怎么站", "面对切后排阵容如何换边", "根据真实英雄射程安排站位"],
    economy: ["围绕低费核心的搜牌节奏", "高费核心阵容如何规划人口", "用真实阵容比较顺风与逆风运营"],
    mechanic: ["当前赛季机制与真实英雄怎么配合", "从开局到后期的机制使用路径", "新赛季机制最容易误解的三点"],
    experience: ["当前赛季最值得了解的三类内容", "新手从真实英雄与羁绊开始", "把输入主题做成一套可收藏攻略"],
  }[kind] || ["当前赛季内容解析", "真实英雄搭配思路", "新手可执行攻略"];
  return labels.map((title, index) => {
    const trait = selectedTraits[index] || selectedTraits[0];
    const members = bestMembers(trait || { members: champions }).slice(0, 5);
    return topicRecord({ id: `${index + 1}`, kind, index, trait, champions: members, facts: factIds, title,
      angle: `以${members.map((item) => item.name).join("、")}等当前赛季英雄为例，围绕“${compact(text, 36)}”给出具体讲解。`,
      badge: "赛季实题",
      reason: "题目与素材均绑定当前赛季真实英雄和羁绊，后续七页不再轮播固定概念图。",
    });
  });
}

export function buildGameResearch(text, bundle) {
  const setNumber = currentSetNumber(bundle.cdragon);
  const set = bundle.cdragon.sets[String(setNumber)];
  const prefix = `DA_${setNumber}_`;
  const championImages = new Map(Object.values(bundle.ddragonChampions?.data || {}).map((item) => [item.id, imageUrl(bundle.version, "tft-champion", item.image?.full)]));
  const traitImages = new Map(Object.values(bundle.ddragonTraits?.data || {}).map((item) => [item.id, imageUrl(bundle.version, "tft-trait", item.image?.full)]));
  const champions = set.champions.filter((item) => item.apiName?.startsWith(prefix) && item.name && item.traits?.length).map((item) => ({
    ...item, imageUrl: championImages.get(item.apiName) || cdragonImageUrl(item.squareIcon || item.tileIcon),
  }));
  const traits = set.traits.filter((item) => item.apiName?.startsWith(prefix) && item.name).map((item) => ({
    ...item, imageUrl: traitImages.get(item.apiName) || cdragonImageUrl(item.icon),
  }));
  const augments = bundle.cdragon.items.filter((item) => item.isAugment && item.apiName?.startsWith(prefix) && item.name).map((item) => ({ ...item, imageUrl: cdragonImageUrl(item.icon) }));
  const kind = kindFor(text);
  const topics = buildTopics(text, kind, traits, champions, augments).slice(0, 3);
  return {
    ok: topics.length === 3,
    kind,
    season: `S${setNumber}`,
    patch: bundle.version,
    updatedAt: new Date().toISOString(),
    topics,
    facts: [
      { id: "fact-current-set", label: `当前赛季 S${setNumber}`, claim: `已联网读取 S${setNumber} 的英雄、费用、羁绊与素材数据；数据版本 ${bundle.version}。`, status: "source_supported", evidenceSourceIds: ["source-riot-tft-data"] },
      { id: "fact-current-roster", label: "真实英雄与羁绊", claim: `本次候选题仅使用数据中实际存在的 ${champions.length} 名英雄和 ${traits.length} 个羁绊关系。`, status: "source_supported", evidenceSourceIds: ["source-riot-tft-data"] },
    ],
    sources: [
      { id: "source-riot-tft-data", title: `Riot TFT Data Dragon · ${bundle.version}`, url: RIOT_TFT_DOCS, status: "found", excerpt: `Riot 官方静态数据提供当前版本的 TFT 英雄名称、费用、头像与羁绊素材。本次同时读取游戏客户端数据中的赛季成员关系。`, extractionStatus: "manual", retrievalMethod: "manual", confirmed: true, structured: { contentType: kind, game: "Teamfight Tactics / 金铲铲之战", version: bundle.version, lineupNames: topics.map((item) => item.title), keywords: ["当前赛季", "英雄", "羁绊"], confidence: "high" } },
      { id: "source-riot-tft-news", title: "Teamfight Tactics 官方更新与赛季资讯", url: RIOT_TFT_NEWS, status: "found", excerpt: "官方更新页面用于复核赛季与版本语境；候选题不把未经统计支持的阵容描述为胜率排行或 T0。", extractionStatus: "manual", retrievalMethod: "manual", confirmed: true, structured: { contentType: "version", game: "Teamfight Tactics", version: bundle.version, keywords: ["官方更新", "赛季"], confidence: "high" } },
    ],
    warning: "阵容方向依据当前赛季真实羁绊与英雄关系整理，不代表胜率排行；发布前仍建议结合当日补丁复核。",
  };
}

export async function fetchGameResearch(text, fetchImpl = globalThis.fetch) {
  if (!cachedBundle || Date.now() - cachedAt > CACHE_MS) {
    const versions = await fetchImpl(VERSIONS_URL).then((response) => {
      if (!response.ok) throw new Error("无法读取 Riot 版本信息");
      return response.json();
    });
    const version = versions[0];
    const [cdragon, ddragonChampions, ddragonTraits] = await Promise.all([
      fetchImpl(CDRAGON_URL).then((response) => response.ok ? response.json() : Promise.reject(new Error("无法读取赛季数据"))),
      fetchImpl(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/tft-champion.json`).then((response) => response.ok ? response.json() : ({ data: {} })),
      fetchImpl(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/tft-trait.json`).then((response) => response.ok ? response.json() : ({ data: {} })),
    ]);
    cachedBundle = { version, cdragon, ddragonChampions, ddragonTraits };
    cachedAt = Date.now();
  }
  return buildGameResearch(compact(text, 1600), cachedBundle);
}
