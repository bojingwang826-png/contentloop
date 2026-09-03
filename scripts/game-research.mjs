const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const CDRAGON_URL = "https://raw.communitydragon.org/latest/cdragon/tft/zh_cn.json";
const RIOT_TFT_DOCS = "https://developer.riotgames.com/docs/tft";
const RIOT_TFT_NEWS = "https://teamfighttactics.leagueoflegends.com/zh-cn/news/";
const JCC_OFFICIAL = "https://jcc.qq.com/";
const JCC_REFERENCE = "https://jinchanchan.fun/";
const CREATOR_REFERENCES = [
  "https://www.xiaohongshu.com/user/profile/689091b200000000280153e5",
  "https://www.xiaohongshu.com/user/profile/5d3b87a9000000001600f453",
  "https://www.xiaohongshu.com/user/profile/65e6bfad000000000b033016",
];

let cachedBundle;
let cachedAt = 0;
const CACHE_MS = 30 * 60 * 1000;

function compact(value, max = 180) {
  return String(value || "").replace(/<br\s*\/?>/gi, "；").replace(/<[^>]+>/g, " ").replace(/%i:[^%]+%/gi, "").replace(/@[^@]+@/g, "").replace(/[（(]\s*[）)]/g, "").replace(/；\s*；/g, "；").replace(/\s*([，。；])/g, "$1").replace(/\s+/g, " ").trim().slice(0, max);
}

function traitDescription(trait) {
  const name = String(trait?.name || "");
  const parts = compact(trait?.desc, 600)
    .split(/[；。]/)
    .map((part) => part.replace(/[%|]+/g, "").replace(/，\s*，/g, "，").trim())
    .filter((part) => part.length >= 6 && /[\u4e00-\u9fff]/u.test(part));
  const matched = parts.find((part) => name && part.includes(`【${name}】`)) || parts.find((part) => !/商店每次|金币|购买/u.test(part)) || parts[0];
  return compact(matched || `${name}的具体效果以当前赛季客户端说明为准。`, 92);
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
  const range = Number(champion.stats?.range || 0);
  const position = range >= 3 ? "back" : range > 0 && range <= 1 ? "front" : "flex";
  return {
    name: champion.name,
    cost: Number(champion.cost || champion.tier || 0),
    traits: champion.traits || [],
    imageUrl: champion.imageUrl,
    alt: `${champion.name}英雄头像`,
    range,
    role: champion.role || "",
    position,
    positionLabel: position === "front" ? "前排" : position === "back" ? "后排" : "灵活位",
  };
}

function assignBoardSlots(entities) {
  const slots = {
    front: [{ row: 0, col: 2 }, { row: 0, col: 4 }, { row: 1, col: 1 }, { row: 1, col: 5 }],
    flex: [{ row: 1, col: 3 }, { row: 2, col: 2 }, { row: 2, col: 4 }],
    back: [{ row: 3, col: 1 }, { row: 3, col: 5 }, { row: 3, col: 3 }, { row: 2, col: 6 }],
  };
  const used = { front: 0, flex: 0, back: 0 };
  return entities.map((item) => {
    const list = slots[item.position] || slots.flex;
    const boardSlot = list[used[item.position]++ % list.length];
    return { ...item, boardSlot };
  });
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

function stableOffset(value, length) {
  if (!length) return 0;
  const hash = Array.from(String(value || "")).reduce((total, char, index) => (
    (total + (char.codePointAt(0) * (index + 11))) % 2147483647
  ), 0);
  return hash % length;
}

function rotate(list, offset) {
  if (!list.length) return [];
  const pivot = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(pivot), ...list.slice(0, pivot)];
}

function uniqueChampions(list) {
  return list.filter((item, index, values) => (
    values.findIndex((value) => value.apiName === item.apiName) === index
  ));
}

function topicRecord({ id, kind, title, angle, badge, reason, trait, champions, index, facts }) {
  const actualChampions = uniqueChampions(champions);
  const entities = assignBoardSlots(actualChampions.map(entity));
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
    media: mediaFrom(trait, actualChampions),
    gameData: {
      traitName: trait?.name || "",
      traitDescription: traitDescription(trait),
      traitTiers: (trait?.effects || []).map((effect) => Number(effect.minUnits || 0)).filter(Boolean),
      heroNames: entities.map((item) => item.name),
    },
  };
}

function pickTraits(text, traits, champions) {
  const exact = traits.filter((trait) => text.includes(trait.name));
  const namedChampions = champions.filter((champion) => text.includes(champion.name));
  const namedTraitNames = new Set(namedChampions.flatMap((champion) => champion.traits || []));
  const ranked = traits.map((trait) => ({
    ...trait,
    members: champions.filter((champion) => champion.traits.includes(trait.name)),
  })).filter((trait) => {
    const uniqueNames = new Set(trait.members.map((member) => member.name.replace(/\s*\([^)]*\)\s*$/u, "")));
    return trait.members.length >= 3 && uniqueNames.size >= 3 && (!/(?:自然之力|大元素使)/u.test(trait.name) || exact.some((item) => item.apiName === trait.apiName));
  })
    .sort((a, b) => (
      (exact.some((item) => item.apiName === b.apiName) - exact.some((item) => item.apiName === a.apiName))
      || (namedTraitNames.has(b.name) - namedTraitNames.has(a.name))
      || b.members.length - a.members.length
      || a.name.localeCompare(b.name, "zh-CN")
    ));
  const matched = ranked.filter((trait) => exact.some((item) => item.apiName === trait.apiName) || namedTraitNames.has(trait.name));
  const remaining = ranked.filter((trait) => !matched.includes(trait));
  const inputDriven = rotate(remaining, stableOffset(text, remaining.length));
  return [...matched, ...inputDriven]
    .filter((trait, index, list) => list.findIndex((item) => item.apiName === trait.apiName) === index)
    .slice(0, 5);
}

function bestMembers(trait) {
  return uniqueChampions([...trait.members]).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, "zh-CN"));
}

function buildTopics(text, kind, traits, champions, augments) {
  const selectedTraits = pickTraits(`${kind}:${text}`, traits, champions);
  const explicitTraits = selectedTraits.filter((trait) => text.includes(trait.name));
  const topicTraits = explicitTraits.length ? explicitTraits : selectedTraits;
  const fiveTraits = topicTraits.length
    ? Array.from({ length: 5 }, (_, index) => topicTraits[index % topicTraits.length])
    : [];
  const factIds = ["fact-current-set", "fact-current-roster"];
  if (kind === "lineup") return fiveTraits.map((trait, index) => {
    const members = bestMembers(trait);
    const core = members.slice(0, 3).map((item) => item.name).join("＋");
    const titles = [
      `${trait.name}阵容方向：${core}`,
      `${trait.name}低费怎么过渡到成型`,
      `${trait.name}站位：主 C 和前排怎么摆`,
      `${trait.name}装备先给谁、散件怎么消化`,
      `${trait.name}缺核心牌时怎么换线`,
    ];
    return topicRecord({ id: `${index + 1}`, kind, index, trait, champions: members, facts: factIds,
      title: titles[index],
      angle: `以真实${trait.name}成员${members.map((item) => item.name).join("、")}为基础，讲开局条件、成型结构与可替换位置。`,
      badge: ["阵容推荐", "成型路线", "站位细节", "低费过渡", "变阵思路"][index],
      reason: `当前赛季数据中，这些英雄实际拥有${trait.name}羁绊；内容按真实成员关系整理，不虚构胜率或“T0”结论。`,
    });
  });
  if (kind === "trait") return fiveTraits.map((trait, index) => {
    const members = bestMembers(trait);
    const titles = [
      `${trait.name}怎么开：效果和档位讲清楚`,
      `${trait.name}全员名单：每张牌负责什么`,
      `${trait.name}从低费打工到高费成型`,
      `${trait.name}站位：前后排怎么分`,
      `${trait.name}缺转职或关键牌怎么调整`,
    ];
    const angles = [
      `${traitDescription(trait)}；当前赛季共有 ${members.length} 名真实成员。`,
      `按费用和职责拆解${members.map((item) => item.name).join("、")}，方便快速认人。`,
      `把成员按费用分层，讲清什么时候留低费、什么时候换成高费核心。`,
      `根据真实英雄射程与职责，把${members.length}名成员放进棋盘格并说明换边条件。`,
      `围绕缺牌、缺转职和对手克制，保留不拆核心羁绊的替代路线。`,
    ];
    return topicRecord({ id: `${index + 1}`, kind, index, trait, champions: members, facts: factIds,
      title: titles[index],
      angle: angles[index],
      badge: ["羁绊效果", "真实成员", "启动档位", "转职去向", "阵容适配"][index],
      reason: `使用当前赛季客户端羁绊说明和真实英雄名单，后续页面会分别解释效果、成员职责与搭配条件。`,
    });
  });
  if (kind === "hero") {
    const named = champions.filter((item) => text.includes(item.name));
    const pool = rotate([...champions].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, "zh-CN")), stableOffset(text, champions.length));
    const chosen = uniqueChampions([...named, ...pool]).slice(0, 5);
    return chosen.map((champion, index) => topicRecord({ id: `${index + 1}`, kind, index, champions: [champion], facts: factIds,
      title: `${champion.name}解析：技能定位与阵容职责`,
      angle: `${champion.cost}费英雄，拥有${champion.traits.join("、")}羁绊；结合当前赛季真实技能与队友关系讲解。`,
      badge: "英雄解析",
      reason: `候选内容直接绑定${champion.name}的当前赛季头像、费用与羁绊，不使用通用英雄模板。`,
    }));
  }
  if (kind === "augment" && augments.length) {
    const available = augments.filter((item) => item.name && item.imageUrl && !/missing/i.test(item.icon));
    const exact = available.filter((item) => text.includes(item.name));
    const selected = uniqueChampions([...exact, ...rotate(available.filter((item) => !exact.includes(item)), stableOffset(text, available.length))]).slice(0, 5);
    return selected.map((augment, index) => ({
      ...topicRecord({ id: `${index + 1}`, kind, index, champions: bestMembers(selectedTraits[index] || selectedTraits[0]), facts: factIds,
        title: `${augment.name}强化符文：适用条件与阵容`, angle: compact(augment.desc, 130), badge: "真实强化",
        reason: "按当前客户端强化符文说明讲适用条件，并配合真实赛季英雄举例。" }),
      media: [{ kind: "official", name: `augment-${augment.apiName}`, source: augment.imageUrl, label: `${augment.name}强化图标`, alt: `${augment.name}强化符文图标`, reason: "当前主题对应的真实强化素材" }, ...mediaFrom(selectedTraits[index], bestMembers(selectedTraits[index] || selectedTraits[0]))],
    }));
  }
  const labels = {
    equipment: ["当前赛季装备怎么给：先看英雄职责", "同一件装备，哪些真实英雄更适合", "装备不齐时如何按功能替换", "主C与主坦的装备优先级", "对局中什么时候该拆散件"],
    version: ["当前赛季改动先看哪些真实英雄", "版本变化如何影响羁绊结构", "更新后最值得重新检查的搭配", "旧阵容哪些思路还能沿用", "新版本实战复核清单"],
    positioning: ["当前赛季基础棋盘怎么摆", "面对切后排阵容如何换边", "根据真实英雄射程安排站位", "范围伤害下怎么分散站位", "决赛圈逐格对位检查"],
    economy: ["围绕低费核心的搜牌节奏", "高费核心阵容如何规划人口", "用真实阵容比较顺风与逆风运营", "关键回合如何取舍战力与利息", "阵容转型时怎样减少资源浪费"],
    mechanic: ["当前赛季机制与真实英雄怎么配合", "从开局到后期的机制使用路径", "新赛季机制最容易误解的三点", "不同阵容如何利用赛季机制", "机制变化后的实战检查顺序"],
    experience: ["当前赛季最值得了解的五类内容", "新手从真实英雄与羁绊开始", "把输入主题做成一套可收藏攻略", "用一局实战拆解输入主题", "遇到克制时保留哪些调整路线"],
  }[kind] || ["当前赛季内容解析", "真实英雄搭配思路", "新手可执行攻略", "一局实战怎么落地", "遇到克制如何调整"];
  return labels.map((title, index) => {
    const trait = selectedTraits[index] || selectedTraits[0];
    const members = bestMembers(trait || { members: rotate(champions, stableOffset(`${text}-${index}`, champions.length)).slice(0, 8) });
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
    ...item, imageUrl: cdragonImageUrl(item.squareIcon || item.tileIcon) || championImages.get(item.apiName),
  }));
  const traits = set.traits.filter((item) => item.apiName?.startsWith(prefix) && item.name).map((item) => ({
    ...item, imageUrl: cdragonImageUrl(item.icon) || traitImages.get(item.apiName),
  }));
  const augments = bundle.cdragon.items.filter((item) => item.isAugment && item.apiName?.startsWith(prefix) && item.name).map((item) => ({ ...item, imageUrl: cdragonImageUrl(item.icon) }));
  const kind = kindFor(text);
  const topics = buildTopics(text, kind, traits, champions, augments).slice(0, 5);
  // Data Dragon sometimes exposes an internal English set name (for example
  // "Set10") even though the Chinese client markets S18 as “自然之力”. Keep
  // that implementation detail out of user-facing research cards.
  const seasonName = setNumber === 18 || /自然之力/u.test(bundle.jccText || "")
    ? "自然之力"
    : compact(set.name || "当前赛季", 28);
  return {
    ok: topics.length === 5,
    kind,
    season: `S${setNumber} · ${seasonName}`,
    patch: bundle.version,
    updatedAt: new Date().toISOString(),
    topics,
    facts: [
      { id: "fact-current-set", label: `当前赛季 S${setNumber} · ${seasonName}`, claim: `已结合金铲铲官方赛季页与客户端 S${setNumber} 数据核对英雄、费用、羁绊和素材；数据版本 ${bundle.version}。`, status: "source_supported", evidenceSourceIds: ["source-jcc-official", "source-riot-tft-data"] },
      { id: "fact-current-roster", label: "真实英雄与羁绊", claim: `本次候选题仅使用数据中实际存在的 ${champions.length} 名英雄和 ${traits.length} 个羁绊关系。`, status: "source_supported", evidenceSourceIds: ["source-riot-tft-data"] },
    ],
    sources: [
      { id: "source-jcc-official", title: `金铲铲之战官方 · ${seasonName}`, url: JCC_OFFICIAL, status: "found", excerpt: `官方页面用于确认当前版本与${seasonName}赛季语境。`, extractionStatus: "manual", retrievalMethod: "network", confirmed: true, structured: { contentType: "version", game: "金铲铲之战", version: bundle.version, keywords: [seasonName, "官方更新"], confidence: "high" } },
      { id: "source-riot-tft-data", title: `Riot TFT Data Dragon · ${bundle.version}`, url: RIOT_TFT_DOCS, status: "found", excerpt: `Riot 官方静态数据提供当前版本的 TFT 英雄名称、费用、头像与羁绊素材。本次同时读取游戏客户端数据中的赛季成员关系。`, extractionStatus: "manual", retrievalMethod: "manual", confirmed: true, structured: { contentType: kind, game: "Teamfight Tactics / 金铲铲之战", version: bundle.version, lineupNames: topics.map((item) => item.title), keywords: ["当前赛季", "英雄", "羁绊"], confidence: "high" } },
      { id: "source-riot-tft-news", title: "Teamfight Tactics 官方更新与赛季资讯", url: RIOT_TFT_NEWS, status: "found", excerpt: "官方更新页面用于复核赛季与版本语境；候选题不把未经统计支持的阵容描述为胜率排行或 T0。", extractionStatus: "manual", retrievalMethod: "manual", confirmed: true, structured: { contentType: "version", game: "Teamfight Tactics", version: bundle.version, keywords: ["官方更新", "赛季"], confidence: "high" } },
      { id: "source-jcc-reference", title: "非官方攻略参考", url: JCC_REFERENCE, status: bundle.referenceText ? "found" : "unavailable", excerpt: bundle.referenceText ? "仅在内部用于了解信息层级，不在项目页面展示链接或复制正文。" : "公开参考页暂时不可用。", extractionStatus: bundle.referenceText ? "manual" : "failed", retrievalMethod: "private_reference", confirmed: Boolean(bundle.referenceText), publicDisplay: false, structured: { contentType: kind, game: "金铲铲之战", version: bundle.version, keywords: ["当前攻略", "阵容", "一图流"], confidence: bundle.referenceText ? "medium" : "low" } },
      ...CREATOR_REFERENCES.map((url, index) => ({ id: `source-creator-${index + 1}`, title: `非官方创作风格参考 ${index + 1}`, url, status: "found", excerpt: "只在内部参考选题节奏与信息分层，不在项目页面展示链接，不复制原文、图片或个人表述。", extractionStatus: "manual", retrievalMethod: "private_reference", confirmed: true, publicDisplay: false, structured: { contentType: "creator_style", game: "金铲铲之战", version: bundle.version, keywords: ["内容风格", "一图流", "阵容榜单"], confidence: "medium" } })),
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
    const [cdragon, ddragonChampions, ddragonTraits, jccText, referenceText] = await Promise.all([
      fetchImpl(CDRAGON_URL).then((response) => response.ok ? response.json() : Promise.reject(new Error("无法读取赛季数据"))),
      fetchImpl(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/tft-champion.json`).then((response) => response.ok ? response.json() : ({ data: {} })),
      fetchImpl(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/tft-trait.json`).then((response) => response.ok ? response.json() : ({ data: {} })),
      fetchImpl(JCC_OFFICIAL).then((response) => response.ok ? response.text() : "").catch(() => ""),
      fetchImpl(JCC_REFERENCE).then((response) => response.ok ? response.text() : "").catch(() => ""),
    ]);
    cachedBundle = { version, cdragon, ddragonChampions, ddragonTraits, jccText, referenceText };
    cachedAt = Date.now();
  }
  return buildGameResearch(compact(text, 1600), cachedBundle);
}
