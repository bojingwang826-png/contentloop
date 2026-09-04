import { extractScreenshotSections } from "./ocr-layout.js";

const equipmentNames = [
  "暴风之剑", "反曲之弓", "无用大棒", "女神之泪", "锁子甲", "负极斗篷", "巨人腰带", "拳套", "金铲铲", "金锅锅",
  "无尽之刃", "最后的轻语", "珠光护手", "朔极之矛", "大天使之杖", "鬼索的狂暴之刃", "泰坦的坚决",
  "石像鬼石板甲", "狂徒铠甲", "日炎斗篷", "汲取剑", "海克斯科技枪刃", "夜之锋刃", "适应性头盔",
];

const categoryMeta = {
  game_knowledge: { label: "游戏资料", route: "进入候选选题与研究" },
  performance_data: { label: "发布数据", route: "进入待复盘数据" },
  comments: { label: "评论反馈", route: "提炼问题与候选选题" },
};

function compact(value, max = 30000) {
  return String(value || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function countHits(text, words) {
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}

export function classifyScreenshotText(value) {
  const text = compact(value);
  const searchable = text.replace(/\s+/g, "");
  const scores = {
    game_knowledge: countHits(searchable, ["装备", "阵容", "英雄", "羁绊", "合成", "散件", "主C", "赛季", "版本", "运营"]),
    performance_data: countHits(searchable, ["浏览", "曝光", "观看", "点赞", "收藏", "评论", "涨粉", "发布于", "互动"]),
    comments: countHits(searchable, ["回复", "作者赞过", "展开", "条回复", "我觉得", "请问", "怎么", "为什么", "有人", "玩家"]),
  };
  const category = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || "game_knowledge";
  const winningScore = scores[category];
  return {
    category: winningScore ? category : "game_knowledge",
    confidence: winningScore >= 4 ? "high" : winningScore >= 2 ? "medium" : "low",
    scores,
  };
}

function parseNumber(raw) {
  const normalized = String(raw || "").replace(/,/g, "").trim();
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  if (/万/.test(normalized)) return Math.round(value * 10000);
  if (/千|k/i.test(normalized)) return Math.round(value * 1000);
  return Math.round(value);
}

export function extractScreenshotMetrics(value) {
  const text = compact(value).replace(/\s+/g, "");
  const aliases = {
    views: ["浏览量", "浏览", "曝光", "观看"],
    likes: ["点赞数", "点赞", "获赞"],
    saves: ["收藏数", "收藏"],
    comments: ["评论数", "评论"],
    followers: ["涨粉", "新增粉丝"],
  };
  const metrics = {};
  for (const [key, labels] of Object.entries(aliases)) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const after = text.match(new RegExp(`${escaped}\\s*[:：]?\\s*([0-9,.]+\\s*[万千kK]?)`));
      const before = text.match(new RegExp(`([0-9,.]+\\s*[万千kK]?)\\s*${escaped}`));
      const parsed = parseNumber(after?.[1] || before?.[1]);
      if (parsed !== null) {
        metrics[key] = parsed;
        break;
      }
    }
  }
  return metrics;
}

export function extractEquipmentNames(value) {
  const text = compact(value).replace(/\s+/g, "");
  return equipmentNames.filter((name) => text.includes(name));
}

export function classifyCommentLines(value) {
  const lines = compact(value).split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 4).slice(0, 60);
  const groups = { questions: [], objections: [], experiences: [], emotions: [] };
  for (const line of lines) {
    if (/[?？]|怎么|为什么|请问|求问|看不懂|不知道/.test(line)) groups.questions.push(line);
    else if (/不对|不是|不同意|扯|错了|不行|没用|争议/.test(line)) groups.objections.push(line);
    else if (/我用|我玩|实测|试了|我的|这局|遇到/.test(line)) groups.experiences.push(line);
    else groups.emotions.push(line);
  }
  return groups;
}

export function deriveScreenshotResult(value, categoryOverride = "") {
  const text = compact(value);
  const inferred = classifyScreenshotText(text);
  const category = categoryOverride && categoryMeta[categoryOverride] ? categoryOverride : inferred.category;
  return {
    text,
    category,
    categoryLabel: categoryMeta[category].label,
    route: categoryMeta[category].route,
    confidence: inferred.confidence,
    metrics: extractScreenshotMetrics(text),
    equipment: extractEquipmentNames(text),
    sections: extractScreenshotSections(text),
    commentGroups: category === "comments" ? classifyCommentLines(text) : { questions: [], objections: [], experiences: [], emotions: [] },
  };
}

export function screenshotInputContext(record) {
  const result = deriveScreenshotResult(record.text, record.category);
  const metrics = Object.entries(result.metrics).map(([key, value]) => `${key}:${value}`).join("，");
  const prefix = result.category === "performance_data"
    ? "我上传了一张已确认的发布数据截图，请结合数据判断选题、标题、封面、内容或发布时间问题"
    : result.category === "comments"
      ? "我上传了一张已确认的评论截图，请提炼高频问题、反对意见和候选选题"
      : "我上传了一张已确认的游戏资料截图，请据此生成候选选题，涉及版本事实仍标记待核验";
  return compact(`${prefix}\n截图标题：${record.title || "未命名截图"}\n${metrics ? `识别数据：${metrics}\n` : ""}识别正文：${result.text}`, 5000);
}

export function createConfirmedScreenshotRecord(capture, now = new Date()) {
  const derived = deriveScreenshotResult(capture.text, capture.category);
  return {
    id: `screenshot-${now.getTime()}`,
    title: compact(capture.title || capture.fileName || "截图识别记录", 80),
    fileName: compact(capture.fileName, 120),
    preview: capture.preview || "",
    confirmedAt: now.toISOString(),
    ...derived,
  };
}

export const screenshotCategoryOptions = Object.entries(categoryMeta).map(([value, meta]) => ({ value, ...meta }));
