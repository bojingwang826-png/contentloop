function compact(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractUrls(value) {
  return [...new Set(String(value || "").match(/https?:\/\/[^\s<>'"，。；]+/gi) || [])].slice(0, 3);
}

function domainFor(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return "未知站点";
  }
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

const equipmentNames = [
  "暴风之剑", "反曲之弓", "无用大棒", "女神之泪", "锁子甲", "负极斗篷", "巨人腰带", "拳套", "金铲铲", "金锅锅",
  "无尽之刃", "最后的轻语", "珠光护手", "朔极之矛", "大天使之杖", "鬼索的狂暴之刃", "泰坦的坚决",
  "石像鬼石板甲", "狂徒铠甲", "日炎斗篷", "汲取剑", "海克斯科技枪刃", "夜之锋刃", "适应性头盔",
];

const gameNames = ["金铲铲之战", "金铲铲", "云顶之弈", "王者荣耀", "无畏契约", "英雄联盟"];

function cleanSubject(value) {
  return compact(value, 42)
    .replace(/^(?:希望围绕|我想做|想做|请根据|请结合|围绕|关于|识别正文[:：]?|截图标题[:：]?|标题[:：]?)/, "")
    .replace(/[“”"'《》【】]/g, "")
    .replace(/[，。；：:!?！？]+$/g, "")
    .trim();
}

function meaningfulInput(value) {
  return compact(value, 5000)
    .replace(/https?:\/\/[^\s<>'"，。；]+/gi, " ")
    .replace(/我上传了一张已确认的(?:游戏资料|发布数据|评论)截图[^。；\n]*/g, " ")
    .replace(/请(?:据此生成候选选题|提炼高频问题、反对意见和候选选题|结合数据判断选题、标题、封面、内容或发布时间问题)/g, " ")
    .replace(/涉及版本事实仍标记待核验/g, " ")
    .replace(/识别数据[:：][^\n。；]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectContentKind(text) {
  const dense = text.replace(/\s+/g, "");
  if (hasAny(dense, ["浏览量", "点赞", "收藏", "评论", "涨粉", "曝光", "发布数据"])) return "performance";
  if (hasAny(dense, ["评论截图", "高频问题", "反对意见", "作者赞过", "条回复"])) return "comments";
  if (hasAny(dense, ["版本更新", "更新公告", "平衡调整", "补丁说明", "增强", "削弱"])) return "version";
  if (hasAny(dense, ["新赛季阵容", "阵容推荐", "强势阵容", "上分阵容", "阵容"])) return "lineup";
  if (hasAny(dense, ["强化符文", "强化选择", "海克斯", "银色强化", "金色强化", "彩色强化"])) return "augment";
  if (hasAny(dense, ["赛季机制", "玩法机制", "特殊机制", "新机制", "机制解读"])) return "mechanic";
  if (hasAny(dense, ["羁绊", "转职", "纹章", "羁绊追踪器"])) return "trait";
  if (hasAny(dense, ["站位", "对位", "防刺客", "防钩", "集火", "换边"])) return "positioning";
  if (hasAny(dense, ["运营", "经济", "升级", "搜牌", "拉人口", "利息", "连胜", "连败"])) return "economy";
  if (hasAny(dense, ["英雄推荐", "主C推荐", "棋子解析", "单卡解析", "英雄解析", "追三星", "三星五费"])) return "hero";
  if (hasAny(dense, ["装备合成", "散件", "成装", "装备给谁", "给谁", "平替装备"])) return "equipment";
  if (hasAny(dense, ["上分", "主C", "来牌"])) return "lineup";
  if (hasAny(dense, ["装备", "合成", ...equipmentNames.filter((name) => !["金铲铲", "金锅锅"].includes(name))])) return "equipment";
  if (hasAny(dense, ["版本", "赛季", "更新", "改动"])) return "version";
  return "experience";
}

function subjectFromInput(text, kind) {
  const titleMatch = text.match(/(?:截图标题|标题)[:：]\s*([^。；]{3,42})/);
  const namedEquipment = equipmentNames.filter((name) => text.replace(/\s+/g, "").includes(name));
  if (kind === "equipment" && namedEquipment.length) return namedEquipment.slice(0, 2).join("和");
  const game = gameNames.find((name) => text.includes(name));
  const candidates = meaningfulInput(text)
    .split(/[。；\n]|(?<=[！？!?])/)
    .map(cleanSubject)
    .filter((item) => item.length >= 3 && item.length <= 42)
    .filter((item) => !/^(?:用户提供的网页链接|未命名截图|截图识别记录|equipment-test)/i.test(item));
  const scored = candidates.map((item, index) => {
    const kindWords = {
      equipment: ["装备", "合成", "散件", "主C", "前排"],
      lineup: ["阵容", "上分", "运营", "来牌", "站位"],
      version: ["版本", "赛季", "更新", "改动"],
      performance: ["收藏", "点赞", "浏览", "发布"],
      comments: ["问题", "评论", "玩家"],
      augment: ["强化", "符文", "海克斯", "选择"],
      mechanic: ["机制", "玩法", "赛季", "规则"],
      trait: ["羁绊", "转职", "纹章", "搭配"],
      positioning: ["站位", "对位", "前排", "后排"],
      economy: ["运营", "经济", "升级", "搜牌"],
      hero: ["英雄", "棋子", "主C", "三星"],
      experience: ["玩法", "体验", "活动", "英雄"],
    }[kind];
    return { item, score: kindWords.filter((word) => item.includes(word)).length * 5 - index + Math.min(item.length, 18) / 20 };
  }).sort((a, b) => b.score - a.score);
  const title = cleanSubject(titleMatch?.[1] || "");
  if (title && !/^[\w-]+$/.test(title)) return title.slice(0, 20);
  if (scored[0]?.item) return scored[0].item.slice(0, 20);
  return game || (kind === "equipment" ? "这组装备信息" : kind === "lineup" ? "这套阵容" : "这段游戏内容");
}

function candidateBlueprints(kind, subject) {
  const packs = {
    equipment: [
      [`${subject}怎么合、给谁？一张图讲清`, "从截图或正文中的具体装备出发，整理合成、定位和使用顺序。", "实用型"],
      [`${subject}没拿到怎么办？两种平替思路`, "按功能而不是按名称死等装备，分别给出通用平替和阵容内平替。", "收藏型"],
      [`别只背${subject}：新手最容易错的 3 步`, "围绕输入中的装备信息，拆解合成、分配和替换时最常见的误区。", "避坑型"],
    ],
    lineup: [
      [`${subject}能不能硬玩？先看这 3 个信号`, "把来牌、装备和经济条件拆成新手可执行的判断顺序。", "判断型"],
      [`${subject}低费版和上限版怎么切`, "根据输入内容整理逆风降配与顺风提升上限的两套路径。", "收藏型"],
      [`玩${subject}别只会抄：主 C 不来怎么变`, "从原文线索延伸出替代主 C、装备转移和阵容调整。", "变阵型"],
    ],
    version: [
      [`${subject}改了什么？新手先看这 4 点`, "把更新内容翻译成玩家能直接理解的影响清单。", "版本型"],
      [`${subject}之后，哪些旧思路还能用`, "区分继续有效、需要调整和暂时别照搬的内容。", "对比型"],
      [`这次${subject}影响谁？按玩家类型拆开讲`, "分别说明冲分、新手和休闲玩家最需要关注的变化。", "人群型"],
    ],
    performance: [
      [`${subject}为什么值得复盘？先看收藏和浏览`, "根据截图中的真实指标判断内容是否解决了可收藏问题。", "复盘型"],
      [`同类内容怎么超过${subject}这次表现`, "从标题、封面、信息密度和发布时间拆解下一次改进点。", "增长型"],
      [`从${subject}的数据里再挖 3 个选题`, "把高收藏、低点击或评论问题转换成后续候选方向。", "选题型"],
    ],
    comments: [
      [`围绕${subject}，评论区最常问什么`, "把识别到的问题按频率和新手痛点整理成答疑图文。", "问答型"],
      [`${subject}为什么有争议？两边观点都讲清`, "把反对意见和补充经验分开，标明各自适用情况。", "争议型"],
      [`从${subject}的玩家反馈里挖 3 个新选题`, "把问题、反对意见和经验补充转成可继续发布的系列。", "选题型"],
    ],
    augment: [
      [`${subject}：先看阵容缺的功能`, "按即时战力、经济节奏和阵容上限整理强化符文的选择顺序。", "符文型"],
      [`${subject}别只看推荐榜：3 种局面分别选`, "区分保血、提速和冲上限三种局面，给出可执行的条件分支。", "判断型"],
      [`${subject}最容易踩的坑：强不等于适合`, "解释为什么热门强化也可能与当前装备、羁绊或节奏冲突。", "避坑型"],
    ],
    mechanic: [
      [`${subject}：一张图看懂核心规则`, "把触发条件、收益和使用时机拆成新手能跟着做的步骤。", "机制型"],
      [`${subject}开局到后期怎么用`, "按对局阶段整理操作重点，说明什么时候该调整计划。", "流程型"],
      [`${subject}常见误区：这些规则别理解反了`, "用正反例澄清容易混淆的机制边界。", "避坑型"],
    ],
    trait: [
      [`${subject}：先看核心收益和启动条件`, "从羁绊效果、关键棋子与转职去向建立完整判断框架。", "羁绊型"],
      [`${subject}低配过渡和高配上限怎么切`, "分别整理缺牌、缺转职和资源充足时的搭配路线。", "变阵型"],
      [`玩${subject}别凑数：最容易浪费的 3 个位置`, "说明何时值得开高层羁绊，何时应把人口留给功能棋子。", "避坑型"],
    ],
    positioning: [
      [`${subject}：先看对手威胁来自哪`, "按集火、控制、切后排和范围伤害给出站位检查顺序。", "站位型"],
      [`${subject}不是固定答案：左右换边怎么判断`, "用侦查结果和关键单位位置解释临场换位。", "对位型"],
      [`${subject}最常见的 4 个失误`, "整理抱团、分散、前排错位和主 C 暴露等典型问题。", "避坑型"],
    ],
    economy: [
      [`${subject}：按阶段看升级和搜牌`, "把血量、金币、连胜连败和阵容质量放进同一条判断顺序。", "运营型"],
      [`${subject}顺风与逆风分别怎么处理`, "对比保经济、提战力和止损三种资源使用方式。", "节奏型"],
      [`${subject}别死背等级：先看这 4 个信号`, "用场面、血量、对子和目标阵容决定何时行动。", "判断型"],
    ],
    hero: [
      [`${subject}：先看定位和启动条件`, "从技能、伤害类型、装备需求和阵容职责建立判断。", "英雄型"],
      [`${subject}主 C、副 C 还是功能位`, "按资源投入和对局阶段解释不同用法。", "定位型"],
      [`玩${subject}最容易忽略的 3 个细节`, "整理站位、启动速度、对手克制与替代选择。", "避坑型"],
    ],
    experience: [
      [`${subject}值不值得试？先看这 4 个体验点`, "只围绕输入中的具体主题，从上手成本、反馈节奏、重复度和适合人群整理。", "体验型"],
      [`第一次接触${subject}，最容易卡在哪`, "从原文提到的玩法或问题里整理新手会真正遇到的障碍。", "避坑型"],
      [`${subject}分别适合哪些玩家`, "根据输入内容区分休闲、冲分和收集等不同需求。", "人群型"],
    ],
  };
  return packs[kind] || [
    [`${subject}怎么理解？先拆成 4 个关键问题`, "紧扣输入主题整理规则、场景、选择依据和行动建议。", "解读型"],
    [`${subject}新手从哪里开始`, "把复杂内容改写成由浅入深、可直接执行的步骤。", "教程型"],
    [`${subject}有哪些误区和不同选择`, "保留条件差异与争议边界，不输出脱离主题的固定答案。", "避坑型"],
  ];
}

function pendingUrlTopics(sources) {
  const domain = sources[0]?.domain || "这个网站";
  return [
    [`等待读取 ${domain} 的正文`, "网页正文尚未确认，暂不编造具体选题。", "等待解析"],
    ["先核对网页标题、日期和核心内容", "确认识别结果后，系统会用原文主题重新生成候选。", "确认后生成"],
    ["当前只保留网址，不建立内容结论", "读取失败时可以粘贴公开正文片段继续。", "事实保护"],
  ].map(([title, angle, badge], index) => ({
    id: `candidate-pending-${index + 1}`,
    title,
    angle,
    badge,
    recommendation: 20 - index * 2,
    freshness: 10,
    saveValue: 10,
    evergreen: 10,
    pain: 10,
    reason: "还没有经过你确认的网页正文，因此不会返回固定模板或冒充已理解内容。",
    evidenceIds: ["fact-user-intent"],
    pending: true,
  }));
}

export function analyzeInputDemo(rawInput, supplement = "") {
  const original = compact(rawInput, 1200);
  const extra = compact(supplement, 600);
  const combined = compact(`${original} ${extra}`, 1600);
  const urls = extractUrls(combined);
  const kind = detectContentKind(combined);
  const subject = subjectFromInput(combined, kind);
  const intentLabels = { equipment: "装备教学", lineup: "阵容推荐与变阵", version: "版本更新解读", performance: "发布效果复盘", comments: "评论问题提炼", augment: "强化符文选择", mechanic: "玩法机制解读", trait: "羁绊与转职", positioning: "站位与对位", economy: "运营与经济", hero: "英雄与棋子", experience: "玩法体验与避坑" };
  const intent = `${intentLabels[kind]} · ${subject}`;
  const sources = urls.map((url, index) => ({
    id: `source-user-${index + 1}`,
    title: `用户提供的网页链接 ${index + 1}`,
    url,
    status: "user_provided",
    domain: domainFor(url),
    author: "",
    publishedAt: "",
    excerpt: "",
    extractionStatus: "pending",
    failureReason: "",
    confirmed: false,
  }));
  const facts = [{
    id: "fact-user-intent",
    label: "用户明确表达",
    claim: `希望围绕“${compact(combined || "金铲铲内容", 90)}”寻找可做的图文方向。`,
    status: "input_claim",
    evidenceSourceIds: [],
  }];
  if (urls.length) {
    facts.push({
      id: "fact-link-pending",
      label: "链接内容待读取",
      claim: "系统正在尝试读取网页公开正文；读取成功后会先展示识别结果，由你确认是否用于候选选题和研究卡。",
      status: "needs_verification",
      evidenceSourceIds: sources.map((item) => item.id),
    });
  }
  const textWithoutUrls = meaningfulInput(combined);
  const topics = urls.length && textWithoutUrls.length < 3
    ? pendingUrlTopics(sources)
    : candidateBlueprints(kind, subject).map(([title, angle, badge], index) => ({
      id: `candidate-${kind}-${index + 1}-${Array.from(subject).slice(0, 5).map((char) => char.codePointAt(0).toString(36)).join("")}`,
      title: compact(title, 70),
      angle,
      badge,
      recommendation: [91, 87, 84][index],
      freshness: kind === "version" ? [92, 88, 84][index] : kind === "performance" || kind === "comments" ? [82, 78, 76][index] : [76, 72, 69][index],
      saveValue: [95, 92, 89][index],
      evergreen: kind === "version" ? [62, 72, 68][index] : [86, 89, 84][index],
      pain: [94, 91, 88][index],
      reason: `直接来自输入线索“${compact(subject, 24)}”；第 ${index + 1} 个方向分别承担${index === 0 ? "核心问题解释" : index === 1 ? "条件变化或对比" : "避坑与后续延展"}。`,
      evidenceIds: ["fact-user-intent"],
      pending: false,
    }));
  const questions = [];
  if (urls.length) questions.push("请补充网页中最想保留的结论，或切换在线模式尝试检索公开信息。 ");
  if (combined.length < 16) questions.push("你更想解决“看不懂”“不会选”还是“不会变阵”？");
  questions.push("是否需要严格跟随当前赛季？若需要，发布前请核对网页标注的赛季和更新时间。 ");
  return {
    inputType: urls.length && compact(combined.replace(/https?:\/\/[^\s]+/g, "")).length ? "mixed" : urls.length ? "url" : "idea",
    summary: topics.some((topic) => topic.pending)
      ? `已识别到 ${sources[0]?.domain || "网页"} 链接；先读取并确认正文，再生成基于原文的候选选题。`
      : `已从输入中提取主题“${subject}”，三个候选会分别覆盖核心解释、条件变化和延展方向。`,
    intent,
    facts,
    sources,
    topics,
    questions: questions.map((item) => item.trim()).slice(0, 3),
    mode: "matched",
  };
}

export function refreshAnalysisWithParsedSources(analysis, rawInput, supplement = "") {
  const sources = Array.isArray(analysis?.sources) ? analysis.sources : [];
  const usableSources = sources.filter((source) => source.confirmed && ["extracted", "manual"].includes(source.extractionStatus) && compact(source.excerpt, 1200).length >= 20);
  if (!usableSources.length) return analysis;
  const sourceContext = usableSources.map((source) => {
    const structured = source.structured || {};
    const recipes = (structured.recipes || []).map((item) => `${item.ingredients?.join("+")}=${item.result}`).join(" ");
    return `标题：${source.title}。正文：${source.excerpt}。游戏：${structured.game || ""}。版本：${structured.version || ""}。识别对象：${(structured.items || []).join(" ")}。配方：${recipes}。`;
  }).join(" ");
  // 已确认的网页内容放在最前面，确保候选主题由当前网页驱动，而不是被旧输入文字覆盖。
  const refreshed = analyzeInputDemo(`${sourceContext} ${rawInput}`, supplement);
  const sourceFact = {
    id: "fact-parsed-source",
    label: "网站内容已解析",
    claim: `已读取 ${usableSources.map((source) => source.title).join("、")} 的公开内容，候选方向会直接据此生成。`,
    status: "source_supported",
    evidenceSourceIds: usableSources.map((source) => source.id),
  };
  return {
    ...refreshed,
    inputType: analysis?.inputType || refreshed.inputType,
    summary: `已解析 ${usableSources.length} 个用户提供的网站，并结合网页内容生成候选选题。`,
    facts: [
      ...(analysis?.facts || refreshed.facts).filter((fact) => fact.id !== "fact-link-pending" && fact.id !== sourceFact.id),
      sourceFact,
    ],
    sources,
    topics: refreshed.topics.map((topic) => ({
      ...topic,
      reason: topic.id.endsWith("-1") ? "最贴近你提供的网站内容，且收藏价值和新手痛点最突出。" : topic.reason,
      evidenceIds: [...new Set([...(topic.evidenceIds || []), sourceFact.id])],
    })),
    questions: refreshed.questions.filter((question) => !question.includes("补充网页") && !question.includes("独立来源")),
  };
}

function topicContentKind(topic) {
  const idKind = String(topic?.id || "").match(/^candidate-(equipment|lineup|version|performance|comments|augment|mechanic|trait|positioning|economy|hero|experience)-/)?.[1];
  if (idKind) return idKind;
  const title = String(topic?.title || "");
  if (hasAny(title, ["阵容", "主 C", "主C", "来牌", "上分"])) return "lineup";
  if (hasAny(title, ["装备", "合成", "散件", "神装", ...equipmentNames])) return "equipment";
  return detectContentKind(`${title} ${topic?.angle || ""}`);
}

function viewpointPack(topic) {
  const kind = topicContentKind(topic);
  if (kind === "equipment") {
    return [
      ["先认散件，再理解功能", "从手里的散件出发，告诉新手能合什么、解决什么问题。", "适合完全看不懂合成表的新手。", "容易讲成纯配方表，需要补判断顺序。"],
      ["按英雄定位分装备", "把主 C、前排和辅助分开讲，先判断英雄职责，再决定装备。", "最贴近“不知道装备给谁”的痛点。", "具体英雄举例需要跟随赛季核验。"],
      ["按功能寻找平替", "神装不来时，按伤害、攻速、回蓝和生存寻找替代。", "适合已经会基础合成、想进一步学会变通的人。", "不能把功能相近写成强度完全等价。"],
    ];
  }
  if (kind === "lineup") {
    return [
      ["先看条件，再决定能不能玩", "用装备、来牌和经济三个信号判断是否适合硬玩。", "适合只会抄作业、不会判断开局的新手。", "版本强度和具体阈值必须另行核验。"],
      ["低成本保底思路", "优先讲资源不足时怎么降配，减少新手卡在完美阵容上。", "适合偏稳健、怕一局崩盘的读者。", "可能牺牲上限，需要明确适用局面。"],
      ["保留分歧的灵活变阵", "展示两到三种条件分支，不给唯一答案。", "适合愿意多做一步判断的进阶新手。", "信息量较大，七页里必须控制分支数量。"],
    ];
  }
  const specialistPacks = {
    augment: [
      ["按阵容缺口选强化", "先判断当前缺战力、经济、续航还是上限，再筛选强化。", "适合总按推荐榜选符文的玩家。", "具体强化名称与数值需要跟随赛季核验。"],
      ["按对局阶段做取舍", "把第一次、第二次和后续强化选择放进不同目标中。", "适合已经会看阵容、但节奏容易乱的玩家。", "不能把阶段规律写成绝对答案。"],
      ["保留多条可行分支", "同时给出保血、提速和冲上限的判断条件。", "适合希望提高临场决策的人。", "分支过多时需要控制信息密度。"],
    ],
    mechanic: [
      ["先讲规则再讲用法", "先解释机制如何触发，再说明收益、代价和使用时机。", "适合第一次接触新机制的玩家。", "版本细节必须以已确认来源为准。"],
      ["按对局阶段拆解", "从开局、过渡到后期分别说明机制怎么影响决策。", "适合想把规则真正用进对局的人。", "需要避免重复介绍同一条规则。"],
      ["用正反例澄清边界", "并排展示适用与不适用情况，减少误读。", "适合争议较多或规则复杂的主题。", "案例不能冒充真实实测。"],
    ],
    trait: [
      ["从启动条件讲羁绊", "先看关键棋子、层级收益和转职条件，再决定是否投入。", "适合只会凑最高层羁绊的新手。", "具体数值和强度需要核验。"],
      ["低配与高配两条路线", "分别说明资源不足时如何过渡、条件齐全时如何提上限。", "适合来牌不稳定时做变阵参考。", "需要清楚写出切换条件。"],
      ["按功能位优化人口", "比较开高羁绊与加入控制、前排、辅助棋子的取舍。", "适合希望理解阵容结构的玩家。", "不能把功能相近写成完全等价。"],
    ],
    positioning: [
      ["先侦查威胁再站位", "定位对手的主输出、控制和切后排手段，再调整关键单位。", "适合不会临场换位的玩家。", "站位示例需要说明假设局面。"],
      ["按保护与集火目标布局", "围绕主 C 安全、前排承伤和第一集火点解释位置。", "适合建立通用站位逻辑。", "不能把示意图写成万能站位。"],
      ["用常见错误做反例", "从抱团、分散、错位和换边失败中提炼检查项。", "适合收藏后在对局前快速自查。", "案例需避免依赖未核验版本单位。"],
    ],
    economy: [
      ["血量、经济、质量一起看", "不死背等级，用四个信号决定升级、搜牌或存钱。", "适合运营节奏经常断档的新手。", "具体等级阈值应随赛季核验。"],
      ["顺风扩优势，逆风先止损", "把资源使用拆成保连胜、补质量和冲上限三种目标。", "适合想学会根据局势变速的玩家。", "需要明确每条路线的代价。"],
      ["按目标阵容倒推节奏", "先确认核心费用和成型窗口，再安排人口与搜牌。", "适合已有阵容目标但不会运营的人。", "不能假设每局来牌都相同。"],
    ],
    hero: [
      ["先看定位与启动条件", "从技能作用、伤害方式和阵容职责判断是否值得投入。", "适合想了解某个棋子怎么用的玩家。", "具体数值和星级强度需要核验。"],
      ["比较不同资源投入", "说明作为主 C、副 C 或功能位时分别需要什么条件。", "适合避免把所有资源都堆给一张牌。", "示例装备与阵容需注明适用版本。"],
      ["从克制关系讲用法", "结合站位、启动速度和目标选择说明优势与短板。", "适合希望提高对位理解的玩家。", "不能给出无条件的强弱结论。"],
    ],
    version: [
      ["把改动翻译成行动", "不只复述公告，而是说明阵容、装备和运营思路会怎样变化。", "适合想快速抓住版本重点的玩家。", "只使用已确认来源里的改动事实。"],
      ["区分立即影响与长期观察", "把确定改动、合理推测和待验证结论分开。", "适合避免被首日结论带偏。", "推测必须显式标记，不能冒充数据。"],
      ["按玩家类型筛重点", "分别告诉新手、冲分和休闲玩家先关注什么。", "适合信息量大的更新内容。", "需要控制覆盖面，避免每项都浅尝辄止。"],
    ],
  };
  if (specialistPacks[kind]) return specialistPacks[kind];
  return [
    ["朋友安利型", "先说为什么值得试，再把适合和不适合的人讲清楚。", "适合轻松、有活人感的体验内容。", "没有真实体验时必须保持资料整理口吻。"],
    ["新手避坑型", "围绕第一次玩最容易卡住的问题组织内容。", "适合收藏型教程和搜索需求。", "不要把个别反馈包装成普遍结论。"],
    ["中立对比型", "把不同观点并排展示，交给读者按情况选择。", "适合存在争议或体验分化的内容。", "结论可能不够强，需要更明确的选择框架。"],
  ];
}

export function buildResearchBriefDemo(topic, analysis) {
  const usableFacts = (analysis?.facts || []).filter((item) => item.status !== "blocked");
  const usableSources = (analysis?.sources || []).filter((item) => item.confirmed && ["extracted", "manual"].includes(item.extractionStatus) && compact(item.excerpt, 1200).length >= 20);
  const factIds = usableFacts.map((item) => item.id);
  const sourceIds = usableSources.map((item) => item.id);
  const pack = viewpointPack(topic);
  const viewpoints = pack.map(([title, summary, fit, risk], index) => ({
    id: `viewpoint-${topic.id}-${index + 1}`,
    title,
    summary,
    fit,
    risk,
    recommended: index === 0,
    factIds: [...factIds],
    sourceIds: [...sourceIds],
  }));
  const pendingFacts = (analysis?.facts || []).filter((item) => item.status === "needs_verification" || item.status === "blocked");
  return {
    topicId: topic.id,
    summary: `${topic.title}适合做成一篇先解决具体问题、再给判断方法的收藏型图文。`,
    whyWorth: `${topic.reason || topic.angle} 已解析的用户网页会直接进入研究；涉及当前版本数值时仍需核对页面日期和适用赛季。`,
    whyNow: topic.freshness >= 80 ? "这个方向具有较强时效性，但发布前仍要核验当前赛季信息。" : "这个方向更偏长期搜索和收藏需求，不必冒充今日热点。",
    viewpoints,
    disputes: pendingFacts.length
      ? pendingFacts.map((item) => ({ claim: item.claim, status: item.status === "blocked" ? "blocked" : "needs_verification", guidance: "可以继续使用当前网页展开；若写具体版本数值，请先核对页面日期和适用赛季。" }))
      : [{ claim: "具体版本强度与英雄举例尚未核验。", status: "needs_verification", guidance: "当前大纲只写通用判断框架；版本例子留作待补素材。" }],
    questions: (analysis?.questions || []).slice(0, 3),
    recommendedViewpointId: viewpoints[0].id,
    mode: "matched",
  };
}

export function generateOutlineDemo(topic, research, viewpointId) {
  const viewpoint = research.viewpoints.find((item) => item.id === viewpointId) || research.viewpoints[0];
  const factIds = [...(viewpoint?.factIds || [])];
  const contentKind = topicContentKind(topic);
  const isEquipment = contentKind === "equipment";
  const specialistStructures = {
    lineup: [
      ["cover", "阵容推荐", topic.title, "先交代这套内容适合谁，以及需要核验的赛季边界。", ["说明适用玩家", "突出收藏价值"], ["阵容棋盘主题图"]],
      ["problem", "先看门槛", "什么开局适合考虑这类阵容", "从来牌、装备与经济判断能不能继续。", ["识别关键来牌", "检查可用装备", "判断经济与血量", "保留转向空间"], ["开局条件图"]],
      ["framework", "完整路线", viewpoint.title, viewpoint.summary, ["确定核心与功能位", "安排前中期过渡", "明确成型节点", "列出转阵信号"], ["阵容路线图"]],
      ["detail", "运营节奏", "从开局到成型怎么走", "按阶段说明升级、搜牌和补质量的优先级。", ["开局先稳质量", "中期判断是否提速", "关键等级集中搜牌", "成型后再补上限"], ["经济运营图"]],
      ["detail", "装备站位", "核心资源怎么分配", "把主 C、前排与功能位分开，并给出对位检查。", ["主 C 保证启动", "前排补足承伤", "功能装看团队收益", "每回合侦查换边"], ["站位示意图"]],
      ["mistake", "及时变阵", "条件不对时怎么撤", "列出不能硬玩的信号和替代方向。", ["核心牌迟迟不来", "装备方向明显不合", "血量不够继续贪", "同行过多及时换线"], ["分支选择图"]],
      ["summary", "收藏清单", "开局照着这 4 步判断", "把阵容选择、运营、装备与站位压成一页清单。", ["看牌", "看装", "看经济", "看对手"], ["判断清单"]],
    ],
    augment: [
      ["cover", "强化符文", topic.title, "封面说清选择问题与适用场景。", ["不照抄推荐榜", "强调局面判断"], ["强化符文主题图"]],
      ["problem", "先看缺口", "为什么强势强化不一定适合你", "把阵容功能与当前局面放在推荐等级之前。", ["缺即时战力还是经济", "阵容是否吃特定效果", "剩余阶段还有多少", "替代选项是否更稳"], ["取舍对比图"]],
      ["framework", "选择顺序", viewpoint.title, viewpoint.summary, ["先看阵容需求", "再看阶段目标", "比较即时与长期收益", "排除冲突效果"], ["选择流程图"]],
      ["detail", "保血局", "需要即时战力时怎么选", "优先解决这一回合就会暴露的短板。", ["补前排承伤", "补输出启动", "补控制与续航", "不为远期上限掉太多血"], ["战斗局势图"]],
      ["detail", "发育局", "经济和上限强化怎么取舍", "资源充足时仍要确认兑现窗口。", ["估算回报周期", "确认阵容能否吃满", "给转阵保留余地", "避免多个效果互相冲突"], ["经济成长图"]],
      ["mistake", "常见误区", "看到热门就无脑拿", "逐项解释推荐榜无法替你判断的条件。", ["忽略阵容适配", "忽略阶段节奏", "重复堆同类效果", "为了上限放弃稳定"], ["避坑提示图"]],
      ["summary", "快速自查", "选强化前问自己 4 句话", "用短问题收束成对局中可执行的检查表。", ["我现在缺什么", "多久能兑现", "是否和阵容匹配", "有没有更稳选择"], ["收藏清单"]],
    ],
    economy: [
      ["cover", "运营节奏", topic.title, "说明这篇解决升级、搜牌和存钱的哪类困惑。", ["按局势判断", "不死背固定答案"], ["金币与等级主题图"]],
      ["problem", "先看局势", "同一回合为什么不能总做同一选择", "血量、场面质量和目标费用会共同改变答案。", ["检查当前血量", "比较场面强度", "确认目标费用", "观察同行压力"], ["局势诊断图"]],
      ["framework", "四个信号", viewpoint.title, viewpoint.summary, ["血量决定容错", "经济决定操作空间", "质量决定是否止损", "目标阵容决定节奏"], ["运营流程图"]],
      ["detail", "顺风处理", "连胜时如何扩大优势", "在不破坏经济的前提下维持场面领先。", ["保住关键利息", "小幅补强保连胜", "提前规划下一人口", "避免无目标刷新"], ["连胜节奏图"]],
      ["detail", "逆风止损", "什么时候该花钱保血", "把每次花钱对应到明确的质量提升。", ["先找可升级对子", "优先补关键前排", "避免一次搜空", "留下下一轮调整空间"], ["止损决策图"]],
      ["mistake", "别照搬节奏", "固定回合拉人口为什么会失效", "解释来牌、血量和同行变化后的调整。", ["只看回合不看质量", "贪利息导致连续掉血", "搜牌没有停止条件", "阵容已变仍沿用旧计划"], ["风险提示图"]],
      ["summary", "回合清单", "操作前先检查这 4 项", "压缩成升级、搜牌或存钱之前的实战自查。", ["血量", "金币", "场面", "目标"], ["收藏清单"]],
    ],
  };
  const structures = isEquipment ? [
    ["cover", "铲友装备课", topic.title, "一句话说清这篇能帮新手解决什么。", ["突出新手痛点", "承诺给出可收藏的判断路径"], ["清晰装备图标", "系列页码"]],
    ["problem", "先别急着背表", "新手真正卡在哪里？", "把看不懂合成和不知道给谁拆成两个问题。", ["先认手里的散件", "再判断英雄定位", "版本数据暂不写死"], ["新手困惑示意", "少量官方装备图标"]],
    ["framework", "先有一张地图", "基础合成怎么快速看懂", "给出从散件到常用成装的阅读顺序。", ["从手中散件出发", "同类功能放在一起", "完整树支持放大查看"], ["官方清晰图标", "合成路径图"]],
    ["detail", "第一步", "主 C 的装备怎么判断", "围绕输出方式和启动需求给出选择顺序。", ["先看伤害类型", "再看攻速或回蓝", "具体英雄例子待赛季核验"], ["主 C 角色卡", "对应装备图标"]],
    ["detail", "第二步", "前排和辅助怎么分", "先保住关键前排，再考虑团队增益。", ["前排优先生存", "辅助装备看团队收益", "不要只追单件神装"], ["前排角色卡", "辅助角色卡"]],
    ["mistake", "神装不来别硬等", "按功能找平替", "把通用平替与当前阵容平替分开。", ["伤害、攻速、回蓝、生存四类", "功能相近不等于强度相同", "标出待核验阵容例子"], ["替代路径箭头", "装备图标"]],
    ["summary", "收藏这一页", "装备判断口诀", "用 3 到 5 条可迁移规则收束整篇。", ["先认散件", "再看定位", "缺装按功能替", "版本例子发布前复核"], ["口诀卡", "账号名与系列页码"]],
  ] : specialistStructures[contentKind] || [
    ["cover", "本期主题", topic.title, "封面明确问题和适合人群。", ["一句话呈现痛点", "突出收藏价值"], ["主题背景", "系列页码"]],
    ["problem", "先说问题", "为什么新手容易卡住", "用读者能对号入座的场景建立共鸣。", ["列出两个常见困惑", "不使用未经核验数字"], ["问题场景图"]],
    ["framework", "判断框架", viewpoint.title, viewpoint.summary, ["给出清晰判断顺序", "说明适用和不适用情况"], ["流程图"]],
    ["detail", "情况一", "最常见的选择", "展开第一种条件和操作重点。", ["先看前置条件", "再给行动建议"], ["真实游戏素材"]],
    ["detail", "情况二", "条件变化时怎么选", "展示另一种情况，避免给唯一答案。", ["标出条件差异", "保留待核验信息"], ["对比素材"]],
    ["mistake", "容易踩坑", "哪些做法别照搬", "解释常见误区和风险边界。", ["区分事实与经验", "版本结论待复核"], ["避坑提示卡"]],
    ["summary", "最后记住", "一张可收藏的判断清单", "用 3 到 5 条规则收束并引导评论。", ["复述判断顺序", "邀请补充不同经验"], ["总结卡", "账号名"]],
  ];
  return {
    topicId: topic.id,
    viewpointId: viewpoint.id,
    title: `${topic.title} · 七页大纲`,
    pages: structures.map(([role, kicker, title, summary, keyPoints, assetNeeds], index) => ({ pageNo: index + 1, role, kicker, title, summary, keyPoints, factIds: [...factIds], assetNeeds })),
    mode: "matched",
  };
}
