import { getIconSource } from "./page-render.js";

const verifiedRecipes = [
  "大剑＋拳套＝无尽之刃",
  "大剑＋反曲弓＝巨人捕手",
  "反曲弓＋拳套＝最后的轻语",
  "大棒＋拳套＝珠光护手",
  "大剑＋女神之泪＝朔极之矛",
  "大棒＋女神之泪＝大天使之杖",
  "大棒＋反曲弓＝鬼索的狂暴之刃",
  "反曲弓＋反曲弓＝海妖之怒",
];

const pageIcons = {
  4: ["无尽之刃", "巨人捕手", "最后的轻语", "朔极之矛"],
  5: ["石像鬼石板甲", "狂徒铠甲", "日炎斗篷", "锁子甲"],
  6: ["朔极之矛", "鬼索的狂暴之刃", "泰坦的坚决", "珠光护手"],
};

const roleCue = {
  problem: [
    "先写清现象，再判断自己缺的是哪类信息。",
    "先找触发条件，别把偶发失误当成固定规律。",
    "两个问题分开处理，行动顺序会更清楚。",
    "每个卡点只配一个下一步，避免一次改太多。",
  ],
  framework: [
    "第一轮只看现有条件，不急着追求标准答案。",
    "第二轮确认目标功能，排除看似强但不合适的选项。",
    "第三轮比较代价，保留随局面调整的空间。",
    "最后再复核版本信息，把通用方法和时效结论分开。",
  ],
  detail: [
    "先看这一项负责解决什么问题，再决定是否需要。",
    "资源不够时先补短板，别为了完美方案空等。",
    "功能接近可以替代，但强度和适用条件仍要区分。",
    "落到当前局面复核一次，答案才真正能执行。",
  ],
  mistake: [
    "只记结论最容易照搬，先补上适用条件。",
    "看见相似效果别急着互换，还要比较付出的代价。",
    "争议结论先标记，不把未经核验的说法写成事实。",
    "发布前检查版本和来源，避免旧经验误导新手。",
  ],
  summary: [
    "先看条件，再定目标，最后才做选择。",
    "没有完美答案时，优先解决当前最缺的功能。",
    "遇到分歧就保留分支，不强行给唯一答案。",
    "涉及版本强度和数字时，发布前再核验一次。",
  ],
};

const roleDetail = {
  problem: [
    "先描述它在什么场景出现、手里有哪些条件，以及最后卡在了哪里，才能区分信息缺口和判断失误。",
    "再往前追一步，找出真正触发问题的条件，避免只盯着结果反复试错。",
    "把同时出现的困惑拆成两条线，一条补知识，一条练判断，处理起来会轻松很多。",
    "最后把每种卡点对应到一个可执行动作，让读者看完就知道下一局先改什么。",
  ],
  framework: [
    "把这一项放进固定检查顺序：先盘点现有条件，再确认目标，暂时不评价答案强不强。",
    "明确这一轮最需要解决的功能，能快速排除与当前目标无关的选择。",
    "比较两个方案各自解决的问题和付出的代价，给后续变化保留调整空间。",
    "结合当前局面再复核一次；涉及版本数据的部分单独标记，发布前补做核验。",
  ],
  detail: [
    "先看它承担的职责和能解决的核心问题，不只因为常见或热门就直接采用。",
    "当资源不足或关键条件没来时，优先补当前短板，比等待一套完美答案更实用。",
    "替代方案要按功能寻找，同时说明强度、启动速度或生存能力上会失去什么。",
    "把前面的判断放回实际局面：已有资源、对手压力和下一阶段目标都会改变优先级。",
  ],
  mistake: [
    "把结论和适用条件放在一起看，缺少前提的经验很容易在另一种局面里失效。",
    "功能相似不代表可以无条件互换，还要比较启动速度、稳定性和资源成本。",
    "遇到玩家分歧或无法验证的说法，先标记争议，不把个人体验包装成确定事实。",
    "检查示例是否属于当前版本；通用判断可以保留，时效结论必须重新核验。",
  ],
  summary: [
    "把复杂问题压缩成一条容易执行的判断顺序，对局中不需要临时回忆整篇攻略。",
    "当标准答案暂时拿不到时，用功能和缺口寻找次优解，保证这一轮仍然能行动。",
    "保留条件分支，让不同开局和不同资源都能找到对应路线，而不是只给一套答案。",
    "最后把通用方法与版本结论分开保存，复用时更稳定，更新时也更省力。",
  ],
};

const roleSupplement = {
  problem: ["先描述具体卡点", "找到问题触发条件", "把两个困惑拆开", "给出下一步动作"],
  framework: ["盘点现有条件", "确认本轮目标", "比较方案代价", "结合局面复核"],
  detail: ["先看核心职责", "资源不足先补短板", "按功能寻找替代", "回到当前局面验证"],
  mistake: ["结论必须带条件", "相似功能不等于互换", "争议内容先标记", "版本示例发布前复核"],
  summary: ["记住判断顺序", "先解决当前短板", "保留条件分支", "版本内容单独核验"],
};

const illustrationThemes = {
  diagnosis: {
    label: "卡点诊断图",
    alt: "从信息、判断顺序和临场选择定位新手卡点的原创概念配图",
    keywords: ["问题", "困惑", "卡住", "卡点", "原因", "诊断", "信息", "新手"],
  },
  tradeoff: {
    label: "方案取舍图",
    alt: "对比两条可行路线及不同收益与代价的原创概念配图",
    keywords: ["比较", "取舍", "代价", "适用", "选择", "两种", "不同", "分别"],
  },
  lineup: {
    label: "阵容站位图",
    alt: "棋盘站位、前后排与调整方向的概念配图",
    keywords: ["阵容", "站位", "棋盘", "前排", "后排", "位置", "换位", "集火"],
  },
  economy: {
    label: "经济运营图",
    alt: "金币、升级、搜牌与节奏选择的概念配图",
    keywords: ["运营", "经济", "金币", "升级", "商店", "搜牌", "花钱", "节奏", "利息"],
  },
  review: {
    label: "战斗复盘图",
    alt: "对局过程、关键转折与复盘分析的概念配图",
    keywords: ["复盘", "实战", "战斗", "对局", "体验", "试玩", "结果", "转折"],
  },
  pitfalls: {
    label: "新手避坑图",
    alt: "错误路线、风险提示与正确选择的概念配图",
    keywords: ["避坑", "误区", "错误", "别", "不要", "风险", "踩坑", "照搬", "新手"],
  },
  roles: {
    label: "英雄职责图",
    alt: "输出、前排与辅助三种职责的概念配图",
    keywords: ["主 C", "主C", "输出", "前排", "辅助", "定位", "职责", "承伤"],
  },
  branching: {
    label: "条件分支图",
    alt: "根据来牌、条件与功能选择不同方案的概念配图",
    keywords: ["替代", "平替", "分支", "条件", "变化", "变阵", "来牌", "情况"],
  },
  roadmap: {
    label: "学习路径图",
    alt: "从问题到判断方法的学习路径概念配图",
    keywords: ["步骤", "顺序", "流程", "框架", "合成", "路径", "先", "再"],
  },
  mnemonic: {
    label: "收藏口诀图",
    alt: "便于收藏和复习的判断口诀概念配图",
    keywords: ["口诀", "清单", "总结", "收藏", "记住", "复习"],
  },
};

function topicKind(topic) {
  const idKind = String(topic?.id || "").match(/^candidate-(equipment|lineup|version|performance|comments|augment|mechanic|trait|positioning|economy|hero|experience)-/)?.[1];
  if (idKind) return idKind;
  const text = `${topic?.title || ""} ${topic?.angle || ""}`;
  if (/(阵容|主\s*C|来牌|运营|上分|站位)/u.test(text)) return "lineup";
  if (/(装备|合成|散件|神装|给谁)/u.test(text)) return "equipment";
  return "experience";
}

function semanticText(page, topic) {
  return [
    topic?.title,
    topic?.angle,
    page?.title,
    page?.summary,
    ...(page?.keyPoints || []),
    ...(page?.assetNeeds || []),
  ].filter(Boolean).join(" ");
}

function themeScore(theme, page, topic) {
  const pageText = [page?.title, page?.summary, ...(page?.keyPoints || []), ...(page?.assetNeeds || [])].filter(Boolean).join(" ");
  const topicText = `${topic?.title || ""} ${topic?.angle || ""}`;
  return theme.keywords.reduce((score, keyword) => (
    score + (pageText.includes(keyword) ? 4 : 0) + (topicText.includes(keyword) ? 1 : 0)
  ), 0);
}

function rankedThemes(page, topic) {
  return Object.entries(illustrationThemes)
    .map(([name, theme]) => ({ name, theme, score: themeScore(theme, page, topic) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function visualRecord(name, page, topic) {
  const theme = illustrationThemes[name];
  return {
    kind: "illustration",
    name,
    label: theme.label,
    alt: theme.alt,
    reason: `识别到“${String(page.title || topic.title).slice(0, 18)}”更适合用${theme.label}辅助理解`,
  };
}

function planPageVisuals(pages, topic, kind) {
  const planned = new Map();
  const liveMedia = Array.isArray(topic?.media)
    ? topic.media.filter((item) => /^https:\/\/(?:ddragon\.leagueoflegends\.com|raw\.communitydragon\.org)\//i.test(String(item?.source || "")))
    : [];
  if (liveMedia.length) {
    const targetPages = pages.filter((page) => page.pageNo >= 3 && page.layoutStyle !== "board");
    targetPages.forEach((page, index) => {
      const media = liveMedia[index % liveMedia.length];
      planned.set(page.pageNo, {
        ...media,
        reason: media.reason || `“${String(page.title || topic.title).slice(0, 18)}”使用该题涉及的当前赛季真实素材`,
      });
    });
    return planned;
  }
  if (kind === "equipment") {
    planned.set(3, visualRecord("roadmap", pages[2], topic));
    planned.set(7, visualRecord("mnemonic", pages[6], topic));
    return planned;
  }

  const coverTheme = ({ lineup: "lineup", positioning: "lineup", economy: "economy", hero: "roles", trait: "branching", augment: "tradeoff", mechanic: "roadmap", version: "review" })[kind] || "review";
  const roleThemes = {
    problem: ["diagnosis", "pitfalls", "roadmap"],
    framework: ["roadmap", "branching", "diagnosis"],
    detail: ["roles", "tradeoff", "branching", "lineup", "economy"],
    mistake: ["pitfalls", "tradeoff", "diagnosis"],
    summary: ["mnemonic", "roadmap", "tradeoff"],
  };
  planned.set(1, visualRecord(coverTheme, pages[0], topic));
  const usedThemes = new Set([coverTheme]);

  pages.slice(1).forEach((page) => {
    const ranked = rankedThemes(page, topic).map((candidate) => candidate.name);
    const preferred = roleThemes[page.role] || ["roadmap", "tradeoff", "branching"];
    const theme = [...preferred, ...ranked, ...Object.keys(illustrationThemes)]
      .find((name) => !usedThemes.has(name));
    if (!theme) return;
    planned.set(page.pageNo, visualRecord(theme, page, topic));
    usedThemes.add(theme);
  });
  return planned;
}

function sentence(value, fallback = "按当前阵容逐项判断。") {
  const text = String(value || "").trim().replace(/[。！？；]+$/u, "");
  return `${text || fallback.replace(/[。！？；]+$/u, "")}。`;
}

function shortName(value, index) {
  const text = String(value || "").trim().split(/[，。；：]/u)[0].replace(/^先/u, "先");
  return text.slice(0, 12) || `判断要点 ${index + 1}`;
}

function boundedDetail(value, maxLength = 142) {
  const clean = String(value || "")
    .replace(/。{2,}/gu, "。")
    .replace(/\s+/gu, " ")
    .trim();
  if (clean.length <= maxLength) return sentence(clean);
  const clipped = clean.slice(0, maxLength);
  const breakAt = Math.max(clipped.lastIndexOf("。"), clipped.lastIndexOf("；"));
  const safe = breakAt >= Math.floor(maxLength * 0.58) ? clipped.slice(0, breakAt + 1) : `${clipped.slice(0, maxLength - 1).replace(/[，、；：。]$/u, "")}…`;
  return safe;
}

function pointParts(point) {
  const raw = String(point || "").trim();
  const separator = raw.search(/[：:]/u);
  if (separator < 0) return { label: raw, value: "" };
  return { label: raw.slice(0, separator).trim(), value: raw.slice(separator + 1).trim() };
}

function quotedSubject(value, fallback) {
  const subject = String(value || fallback || "这一项").replace(/[。！？；]+$/u, "").trim();
  return subject.length > 30 ? subject.slice(0, 30) : subject;
}

function specificStepCopy(page, point, index, kind) {
  const { label, value } = pointParts(point);
  const subject = quotedSubject(value, label);
  const pageFocus = quotedSubject(page.title, `第 ${page.pageNo} 页`);
  const signal = String(point || "");
  const copy = (detail, example) => ({ detail: boundedDetail(detail), example: boundedDetail(example, 76) });

  if (/(前期|开局|低费|可留)/u.test(signal)) return copy(
    value
      ? `前期可以先留${subject}把场面撑住，谁先两星就先上，能打工的装备也不用一直捏在手里。等关键牌真正到场后再逐张替换，别为了等“标准答案”把能赢的质量先拆掉。`
      : `开局先把场面质量稳住，谁先两星就先用谁，能打工的装备也不用一直捏着。等关键牌真正到场后再逐张替换，别为了“${subject}”把眼前能赢的牌先拆掉。`,
    `看${subject}时别急着换：低费两星能稳血，就比一张没装备、没羁绊的一星高费牌更实在。`,
  );
  if (/(中期|衔接|过渡)/u.test(signal)) return copy(
    value
      ? `中期可以用${subject}接住节奏，先看它上场后能不能补羁绊、接装备或提高前排质量。换完场面没有明显变强，就先别为了一张阵容表硬换。`
      : `中期要不要提速，先看“${subject}”能不能带来真实提升：补出两星、接上关键羁绊，或者让前排多站一轮。三样都做不到，就先守住经济。`,
    `处理${subject}时，每换一张牌都问一句：羁绊断没断、主坦变没变脆、输出有没有更早启动？`,
  );
  if (/(后期|终点|高费|成型|补上限)/u.test(signal)) return copy(
    value
      ? `${subject}是后期要留资源找的核心，但拿到后也别一键全换。先确认前排能不能多扛一轮、装备是否匹配；如果上场反而让关键羁绊断掉，宁可晚一回合再换。`
      : `到了后期再处理“${subject}”。高费核心来了也别一键全换，先确认前排能不能多扛一轮、装备是否匹配；上场反而让关键羁绊断掉，就宁可晚一回合。`,
    `${subject}到场后按这个顺序检查：先保住主坦和主输出，再用剩余人口补控制、减抗或第二输出点。`,
  );
  if (/(前排|承伤|坦度|补血|生存)/u.test(signal)) return copy(
    `处理${subject}时，不是把最肉的牌顶在第一排就结束。先看对面主要伤害从哪边来，再让主坦接第一波火力，副坦负责挡切入或控制，这样后排才有完整输出时间。`,
    `如果${subject}还是秒倒，先换承伤位置和装备分配，别第一反应就是把所有钱都拿去搜牌。`,
  );
  if (/(后排|输出|主\s*C|启动|回蓝|攻速)/u.test(signal)) return copy(
    `安排${subject}时，要同时看输出环境和启动速度。把主 C 放到能安全打出第一轮技能的位置，装备先补最缺的启动或穿透，再考虑继续堆面板，通常比三件纯伤害更稳。`,
    `检查${subject}时，先看主 C 是“没放出技能”还是“放了但打不动”，两个问题的补法完全不一样。`,
  );
  if (/(灵活|功能位|控制|辅助|团队收益)/u.test(signal)) return copy(
    `轮到${subject}时，优先补当前最明显的缺口：缺控制就补控制，前排站不住就补保护，伤害够但收不掉残血再考虑副 C。这个位置可以跟着对手变化。`,
    `安排${subject}时别照榜单填，先看这局最难处理的是前排、后排还是控制链。`,
  );
  if (/(来牌|核心牌|对子|追星)/u.test(signal)) return copy(
    `在“${pageFocus}”这页里，判断${subject}要看数量和质量，不是商店里露过一次就算胡。手里已有对子、同费卡不拥挤，而且打工阵容还能顶住时才值得继续；连续几轮没进展就留条退路。`,
    `决定${subject}前先数手里的对子和同行，再考虑继续搜，还是把钱留给下一次升级。`,
  );
  if (/(装备|散件|神装|物理|法术|破甲|减抗)/u.test(signal)) return copy(
    `判断${subject}时先看功能：这局到底缺启动、持续伤害、穿透还是保命。散件能解决眼前战力就可以先合，等神装却连续掉血，往往比少一点理论上限更亏。`,
    `围绕${subject}配装时别只看推荐栏前三件，先看主 C 能不能启动、前排能不能撑到技能放出来。`,
  );
  if (/(经济|金币|利息|升级|搜牌|花钱|血量)/u.test(signal)) return copy(
    `决定${subject}时，把血量、场面和金币放在一起看。还能稳定赢就留经济准备升级；已经连续大掉血，就把钱花在最容易两星或补齐关键羁绊的地方，搜到能止血就先停。`,
    `处理${subject}时别定“必须搜到谁”，改成“这轮至少补强哪一排”，更容易知道什么时候停手。`,
  );
  if (/(站位|侦查|换边|对手|集火|切后)/u.test(signal)) return copy(
    `调整${subject}前，最好每回合都看一眼对手。主 C 避开第一波控制和切入，主坦对准核心火力；如果几家威胁方向不同，就优先防下一轮最可能遇到、也最容易让你掉大血的那家。`,
    `调整${subject}时有个小习惯很好用：最后几秒只动一两张关键牌，别整队乱换把保护关系拆散。`,
  );
  if (/(同行|换线|转阵|撤|替代|平替|保留.*空间)/u.test(signal)) return copy(
    `看到${subject}这个信号，就别再死磕。优先保留能继承现有装备的输出位和已经两星的前排，再找共享羁绊的替代牌，慢慢换线比突然卖空整队更容易稳住血量。`,
    `准备处理${subject}前先留三样：能接装备的人、能顶住的前排，以及下一套阵容的关键连接牌。`,
  );
  if (/(羁绊|档位|开启|成员)/u.test(signal)) return copy(
    `在“${pageFocus}”这页里，判断${subject}值不值得开，别只追最高层数。先看多一档换来了什么、又牺牲了哪个功能位；只是数字好看却让阵容失去控制，就没必要硬凑。`,
    `为了${subject}凑羁绊前，把要下掉的棋子也算进去；少了控制或主坦，面板变高不一定更能打。`,
  );
  if (/(版本|来源|核验|公告|改动)/u.test(signal)) return copy(
    `${subject}要把确定信息和玩家体感分开。公告里的改动可以直接说明，强度判断则要结合当前赛季、发布时间和多场对局反馈，别把一两局顺风写成人人可复制的结论。`,
    `写${subject}前再看一眼版本号和更新时间，旧赛季截图最容易把读者带偏。`,
  );

  const detailFallbacks = {
    problem: `“${pageFocus}”里碰到${subject}先别急着套答案，把当时的来牌、装备和血量记下来。很多时候不是阵容不能玩，而是动手太早，或者把两个不同的问题混在了一起。`,
    framework: `“${pageFocus}”里的${subject}可以按条件、目标、代价三步走：先确认手里有什么，再决定这回合最想解决什么，最后比较哪种做法最不伤经济和场面。`,
    detail: `在“${pageFocus}”这页，${subject}真正有用的地方是能直接影响这一回合的选择。先看它解决什么，再对照手里资源；条件不够就换个更容易兑现的方案，不用为了攻略截图强行照搬。`,
    mistake: `说到“${pageFocus}”，${subject}看起来省事，其实最容易把节奏带偏。只要来牌、装备或对手有一项不一样，原来的结论就可能失效，最好给自己留个能随时掉头的备选。`,
    summary: `复盘“${pageFocus}”时，把${subject}记成三个问题就够了：现在最缺什么、这回合能解决什么、做完还剩多少调整空间。能答出来，基本就不会乱操作。`,
  };
  const exampleFallbacks = [
    `${subject}就当朋友给的攻略参考，先照顾这局真实拿到的牌，不必追求一模一样。`,
    `${subject}有两个方案都说得通时，优先选现在更容易做成、失败后也更好退的那个。`,
    `做完${subject}先看一轮战斗，哪里没改善，下一轮就只改那个位置。`,
    `收藏${subject}时记方法，进游戏看条件；换个版本也不至于整条思路都失效。`,
  ];
  return copy(detailFallbacks[page.role] || detailFallbacks.detail, exampleFallbacks[index % exampleFallbacks.length]);
}

function materializeStep(page, point, index, kind) {
  const icons = kind === "equipment" ? pageIcons[page.pageNo] : null;
  const iconName = icons?.[index % icons.length] || "";
  const copy = specificStepCopy(page, point, index, kind);
  return {
    name: shortName(point, index),
    detail: copy.detail,
    example: copy.example,
    iconName,
  };
}

function fillPagePoints(page) {
  const points = page.keyPoints.slice(0, 4);
  const supplements = roleSupplement[page.role] || roleSupplement.detail;
  while (points.length < 4) points.push(supplements[points.length % supplements.length]);
  return points;
}

function entityNames(entities, position = "") {
  return entities.filter((item) => !position || item.position === position).map((item) => item.name);
}

function joinNames(names, fallback = "根据本局来牌灵活调整") {
  return names.length ? names.join("、") : fallback;
}

function enrichPage(page, patch) {
  return {
    ...page,
    ...patch,
    factIds: [...(page.factIds || [])],
    assetNeeds: [...new Set([...(page.assetNeeds || []), ...(patch.assetNeeds || [])])],
  };
}

export function enrichOutlineWithGameData(outline, topic) {
  if (!outline?.pages?.length) return outline;
  const kind = topicKind(topic);
  const entities = Array.isArray(topic?.entities) ? topic.entities.filter((item) => item?.name) : [];
  if (!entities.length || kind === "equipment") return outline;
  const traitName = topic?.gameData?.traitName || (kind === "lineup" || kind === "trait" ? "核心羁绊" : "本题阵容");
  const tiers = (topic?.gameData?.traitTiers || []).filter(Boolean);
  const front = entityNames(entities, "front");
  const back = entityNames(entities, "back");
  const flex = entityNames(entities, "flex");
  const lowCost = entities.filter((item) => Number(item.cost) <= 2).map((item) => item.name);
  const highCost = entities.filter((item) => Number(item.cost) >= 4).map((item) => item.name);
  const pages = outline.pages.map((page) => {
    if (page.pageNo === 1) return enrichPage(page, {
      summary: `${topic.angle || page.summary} 本篇使用当前赛季真实英雄名单与官方头像。`,
      keyPoints: [`真实成员共 ${entities.length} 名`, `${traitName}效果与开启条件`, "基础建议站位与临场换边"],
      assetNeeds: ["当前赛季英雄官方头像"],
    });
    if (page.pageNo === 2 && entities.length >= 3) return enrichPage(page, {
      kicker: "先认真实成员",
      title: `${traitName}有哪些英雄`,
      summary: `按费用、羁绊和基础职责认识 ${entities.length} 名真实成员，不再用泛化文字代替阵容内容。`,
      keyPoints: entities.map((item) => `${item.name}：${item.cost || "?"}费 · ${(item.traits || []).join(" / ") || traitName} · ${item.positionLabel || "灵活位"}`),
      layoutStyle: "roster",
      assetNeeds: ["真实英雄名单与官方头像"],
    });
    if (page.pageNo === 3 && (kind === "lineup" || kind === "trait")) return enrichPage(page, {
      kicker: "再看羁绊效果",
      title: `${traitName}怎么开、强在哪里`,
      summary: topic?.gameData?.traitDescription || `结合当前赛季资料解释${traitName}的效果和成员关系。`,
      keyPoints: [
        tiers.length ? `开启档位：${tiers.join(" / ")}` : `实际成员：${joinNames(entities.map((item) => item.name))}`,
        `可用前排：${joinNames(front, "优先选择能稳定承伤的成员")}`,
        `后排与输出：${joinNames(back, joinNames(flex))}`,
      ],
      layoutStyle: "trait",
      assetNeeds: [`${traitName}官方羁绊素材`],
    });
    if (page.pageNo === 4 && entities.length >= 3) return enrichPage(page, {
      kicker: "基础建议站位",
      title: `${traitName}英雄怎么摆`,
      summary: "依据英雄射程与职责生成基础站位；这是可执行的起点，实战仍需根据对手换边和防切入。",
      keyPoints: [
        `前排承伤：${joinNames(front)}`,
        `后排输出：${joinNames(back)}`,
        `灵活调整：${joinNames(flex)}`,
      ],
      layoutStyle: "board",
      assetNeeds: ["英雄头像站位图"],
    });
    if (page.pageNo === 5) return enrichPage(page, {
      kicker: "过渡到成型",
      title: `${traitName}的低费过渡与高费终点`,
      summary: "把真实成员按费用拆开，先保证当前战力，再逐步替换到高费核心。",
      keyPoints: [
        `前期可留：${joinNames(lowCost)}`,
        `中期衔接：${joinNames(entities.filter((item) => Number(item.cost) === 3).map((item) => item.name))}`,
        `后期核心：${joinNames(highCost)}`,
      ],
      layoutStyle: "timeline",
      assetNeeds: ["真实英雄费用与头像"],
    });
    if (page.pageNo === 6) return enrichPage(page, {
      layoutStyle: "comparison",
      assetNeeds: ["与本页判断条件对应的当前赛季素材"],
    });
    if (page.pageNo === 7) return enrichPage(page, {
      layoutStyle: "checklist",
      assetNeeds: ["便于收藏复核的主题素材"],
    });
    return page;
  });
  return { ...outline, pages };
}

function materializeEntity(entity, index, layoutStyle) {
  const traits = (entity.traits || []).join(" / ");
  const positionText = entity.positionLabel || "灵活位";
  const identity = `${entity.name}是${entity.cost || "?"}费${positionText}`;
  const roleDetailByPosition = {
    front: `${identity}，主要任务是接住第一波伤害并给后排争取启动时间。看它时重点不是单卡名气，而是能否和现有前排连成一条稳定承伤线。`,
    back: `${identity}，更需要安全输出位和完整启动条件。上场前先看装备能否匹配、第一轮技能会不会被打断，再决定要不要把资源集中给它。`,
    flex: `${identity}，可以根据对手和来牌补输出、控制或保护。这个格子不用锁死，哪张牌能解决当前最明显的缺口，就先让谁上场。`,
  };
  const entityTips = [
    `拿到${entity.name}时，顺手检查同费卡拥挤度，别为了追一张牌把经济搜空。`,
    `${entity.name}上场后先看一轮实战：前排时间、启动速度和目标选择，至少要改善一项。`,
    `如果${entity.name}暂时没来，先用能继承它装备或补同类羁绊的棋子过渡。`,
    `${entity.name}的位置不是固定答案，对面主 C 换边或有切入时，记得同步调整保护关系。`,
  ];
  return {
    name: entity.name,
    detail: layoutStyle === "board"
      ? `${positionText} · ${traits || "根据阵容职责调整"}`
      : `${roleDetailByPosition[entity.position] || roleDetailByPosition.flex}${traits ? ` 它关联${traits}羁绊，换人时记得一起检查层数有没有断。` : ""}`,
    example: layoutStyle === "board" ? `${entity.name}站${positionText}，实战按对手换边` : entityTips[index % entityTips.length],
    imageUrl: entity.imageUrl || "",
    cost: entity.cost || 0,
    traits: entity.traits || [],
    position: entity.position || "flex",
    positionLabel: positionText,
    boardSlot: entity.boardSlot || null,
    number: index + 1,
  };
}

function outlinePageToEditorPage(page, topic, visualPlan) {
  const kind = topicKind(topic);
  const entities = Array.isArray(topic?.entities) ? topic.entities : [];
  const base = {
    id: `dynamic-page-${page.pageNo}`,
    pageNo: page.pageNo,
    kicker: page.kicker,
    title: page.title,
    subtitle: page.summary,
    baseSubtitle: page.summary,
    purpose: page.summary,
    factIds: [...page.factIds],
    assetNeeds: [...page.assetNeeds],
    locked: false,
    preservedFields: [],
    manualOrder: [],
    visual: visualPlan.get(page.pageNo) || null,
    // Keep the current-season roster available to every page renderer. Some
    // layouts use several real heroes to build a lineup banner.
    featuredEntities: entities,
    contentKind: kind,
    layoutStyle: page.layoutStyle || "cards",
    layoutVersion: 5,
  };
  if (page.pageNo === 1) {
    return {
      ...base,
      type: "cover",
      featuredEntities: entities,
      blocks: [{ kind: "chips", items: page.keyPoints.slice(0, 3) }],
    };
  }
  if (["roster", "board"].includes(page.layoutStyle) && entities.length) {
    return {
      ...base,
      type: "rule",
      featuredEntities: entities,
      visual: null,
      blocks: [{ kind: "steps", items: entities.map((item, index) => materializeEntity(item, index, page.layoutStyle)) }],
    };
  }
  if (page.pageNo === 2) {
    if (kind !== "equipment") {
      const points = fillPagePoints(page);
      return {
        ...base,
        type: "rule",
        blocks: [{ kind: "steps", items: points.map((point, index) => materializeStep(page, point, index, kind)) }],
      };
    }
    return {
      ...base,
      type: "tree",
      blocks: [{ kind: "recipes", items: [...verifiedRecipes] }],
    };
  }
  const points = fillPagePoints(page);
  return {
    ...base,
    type: "rule",
    blocks: [{ kind: "steps", items: points.map((point, index) => materializeStep(page, point, index, kind)) }],
  };
}

function ensureProjectCopyIsDistinct(pages) {
  const seen = new Set();
  return pages.map((page) => ({
    ...page,
    blocks: (page.blocks || []).map((block) => ({
      ...block,
      items: (block.items || []).map((item) => {
        if (!item || typeof item !== "object") return item;
        const next = { ...item };
        for (const property of ["detail", "example", "cue"]) {
          if (!next[property]) continue;
          const fingerprint = String(next[property]).replace(/\s+/gu, "").trim();
          if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            continue;
          }
          const focus = quotedSubject(page.title, page.kicker);
          const prefix = property === "detail" ? `说到“${focus}”，` : `这页聊“${focus}”时，`;
          next[property] = boundedDetail(`${prefix}${next[property]}`, property === "detail" ? 142 : 82);
          seen.add(String(next[property]).replace(/\s+/gu, "").trim());
        }
        return next;
      }),
    })),
  }));
}

function buildExportCopy(topic, viewpoint) {
  const title = topic.title;
  const kind = topicKind(topic);
  if (kind !== "equipment") {
    const isLineup = kind === "lineup";
    const tagByKind = {
      augment: "强化符文", mechanic: "赛季机制", trait: "羁绊攻略", positioning: "站位技巧",
      economy: "运营思路", hero: "英雄攻略", version: "版本解读", comments: "玩家讨论", performance: "内容复盘",
    };
    return {
      titles: [
        title,
        `${viewpoint.title}：${title}`.slice(0, 36),
        `新手先别照抄，这套判断顺序建议收藏`.slice(0, 36),
      ],
      body: isLineup
        ? `铲友们，${title}这件事，我按新手真正会遇到的对局顺序拆成 7 页了 🎮\n\n这篇不是让你背一套固定答案，而是先看开局条件，再判断阵容能不能继续玩。来牌、经济和站位发生变化时，行动顺序也要跟着变。\n\n具体英雄强度和版本阈值仍需要发布前复核，所以这次先把通用判断框架讲明白。建议先收藏，下一局准备硬玩某套阵容前拿出来过一遍 ✨\n\n你最容易卡在来牌、经济，还是站位？评论区告诉我，后面继续拆。`
        : `铲友们，${title}这件事，我按新手最容易卡住的顺序拆成 7 页了 🎮\n\n这篇先讲可迁移的判断方法：看清场景、找出关键条件，再决定当前最值得做的一步，不用照搬唯一答案。\n\n涉及具体版本结论和数据的部分，发布前仍需要核对来源和日期。建议先收藏，实际遇到类似情况时再回来对照一下 ✨\n\n你还想看哪个场景的详细拆解？评论区告诉我。`,
      tags: isLineup
        ? ["金铲铲之战", "阵容运营", "金铲铲新手", "游戏攻略", "铲友研究所"]
        : ["金铲铲之战", tagByKind[kind] || "新手攻略", "游戏攻略", "金铲铲攻略", "铲友研究所"],
    };
  }
  return {
    titles: [
      title,
      `${viewpoint.title}：${title}`.slice(0, 36),
      `新手先别硬背，这套判断顺序建议收藏`.slice(0, 36),
    ],
    body: `铲友们，${title}这件事，我按新手真正会卡住的顺序拆成 7 页了 🎮\n\n这篇不要求你把整张表背下来：先看散件能合什么，再判断主 C、前排和辅助分别缺什么功能。神装不来时，也可以按伤害、攻速、回蓝和生存去找替代。\n\n具体英雄和版本强度还需要发布前复核，所以这里先把通用判断方法讲明白。建议先收藏，对局里遇到不确定的装备再回来查一下 ✨\n\n你最容易卡在“看不懂合成”，还是“不知道给谁”？评论区告诉我，后面继续拆。`,
    tags: ["金铲铲之战", "金铲铲新手", "装备搭配", "游戏攻略", "铲友装备课"],
  };
}

export function materializeDynamicProject(customProject) {
  if (!customProject?.outline || !customProject?.topic || !customProject?.research) {
    throw new Error("缺少已确认的动态大纲");
  }
  if (customProject.outline.pages?.length !== 7) throw new Error("动态大纲必须正好包含 7 页");
  const viewpoint = customProject.research.viewpoints.find((item) => item.id === customProject.viewpointId);
  if (!viewpoint) throw new Error("动态观点不存在，请返回研究页重新选择");
  const outline = enrichOutlineWithGameData(customProject.outline, customProject.topic);
  const kind = topicKind(customProject.topic);
  const visualPlan = planPageVisuals(outline.pages, customProject.topic, kind);
  const pages = ensureProjectCopyIsDistinct(
    outline.pages.map((page) => outlinePageToEditorPage(page, customProject.topic, visualPlan)),
  );
  const iconNames = pages.flatMap((page) => page.blocks[0]?.items || []).flatMap((item) => (
    typeof item === "object" && item.iconName ? [item.iconName] : []
  ));
  const missingIcons = iconNames.filter((name) => !getIconSource(name));
  if (missingIcons.length) throw new Error(`缺少官方装备图标：${[...new Set(missingIcons)].join("、")}`);
  return {
    pages,
    currentPageId: pages[0].id,
    exportCopy: buildExportCopy(customProject.topic, viewpoint),
  };
}

export function verifiedDynamicRecipes() {
  return [...verifiedRecipes];
}
