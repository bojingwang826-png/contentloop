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
  if (hasAny(dense, ["装备合成", "散件", "成装", "装备给谁", "给谁", "平替装备"])) return "equipment";
  if (hasAny(dense, ["阵容", "上分", "主C", "运营", "来牌", "站位", "羁绊"])) return "lineup";
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
    experience: [
      [`${subject}值不值得试？先看这 4 个体验点`, "只围绕输入中的具体主题，从上手成本、反馈节奏、重复度和适合人群整理。", "体验型"],
      [`第一次接触${subject}，最容易卡在哪`, "从原文提到的玩法或问题里整理新手会真正遇到的障碍。", "避坑型"],
      [`${subject}分别适合哪些玩家`, "根据输入内容区分休闲、冲分和收集等不同需求。", "人群型"],
    ],
  };
  return packs[kind];
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
  const intentLabels = { equipment: "装备教学", lineup: "阵容判断与变阵", version: "版本更新解读", performance: "发布效果复盘", comments: "评论问题提炼", experience: "玩法体验与避坑" };
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
  const idKind = String(topic?.id || "").match(/^candidate-(equipment|lineup|version|performance|comments|experience)-/)?.[1];
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
  const isEquipment = topicContentKind(topic) === "equipment";
  const structures = isEquipment ? [
    ["cover", "铲友装备课", topic.title, "一句话说清这篇能帮新手解决什么。", ["突出新手痛点", "承诺给出可收藏的判断路径"], ["清晰装备图标", "系列页码"]],
    ["problem", "先别急着背表", "新手真正卡在哪里？", "把看不懂合成和不知道给谁拆成两个问题。", ["先认手里的散件", "再判断英雄定位", "版本数据暂不写死"], ["新手困惑示意", "少量官方装备图标"]],
    ["framework", "先有一张地图", "基础合成怎么快速看懂", "给出从散件到常用成装的阅读顺序。", ["从手中散件出发", "同类功能放在一起", "完整树支持放大查看"], ["官方清晰图标", "合成路径图"]],
    ["detail", "第一步", "主 C 的装备怎么判断", "围绕输出方式和启动需求给出选择顺序。", ["先看伤害类型", "再看攻速或回蓝", "具体英雄例子待赛季核验"], ["主 C 角色卡", "对应装备图标"]],
    ["detail", "第二步", "前排和辅助怎么分", "先保住关键前排，再考虑团队增益。", ["前排优先生存", "辅助装备看团队收益", "不要只追单件神装"], ["前排角色卡", "辅助角色卡"]],
    ["mistake", "神装不来别硬等", "按功能找平替", "把通用平替与当前阵容平替分开。", ["伤害、攻速、回蓝、生存四类", "功能相近不等于强度相同", "标出待核验阵容例子"], ["替代路径箭头", "装备图标"]],
    ["summary", "收藏这一页", "装备判断口诀", "用 3 到 5 条可迁移规则收束整篇。", ["先认散件", "再看定位", "缺装按功能替", "版本例子发布前复核"], ["口诀卡", "账号名与系列页码"]],
  ] : [
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
