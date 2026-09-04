import { createAiService } from "../scripts/ai-service.mjs";
import { MAX_VISION_BYTES } from "../scripts/vision-service.mjs";
import { visionStream } from "../scripts/vision-stream.mjs";
import { fetchGameResearch } from "../scripts/game-research.mjs";

const MAX_JSON_BYTES = 200_000;
const MAX_READER_BYTES = 2_000_000;
const readerTimeoutMs = 20_000;

const knownItems = [
  "暴风大剑", "大剑", "反曲之弓", "反曲弓", "无用大棒", "大棒", "女神之泪", "锁子甲", "负极斗篷", "巨人腰带", "拳套", "金铲铲", "金锅锅",
  "无尽之刃", "海克斯科技枪刃", "朔极之矛", "夜之锋刃", "汲取剑", "红霸符", "鬼索的狂暴之刃", "虚空之杖", "泰坦的坚决", "珠光护手", "大天使之杖", "冕卫", "离子火花", "蓝霸符", "圣盾使的誓约", "适应性头盔", "振奋盔甲", "正义之手", "坚定之心", "石像鬼石板甲", "薄暮法袍", "水银", "日炎斗篷", "狂徒铠甲", "强袭者的链枷", "秘法手套",
];

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function accessCodeMatches(provided, expected) {
  const left = new TextEncoder().encode(String(provided || ""));
  const right = new TextEncoder().encode(String(expected || ""));
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function requireAiAccess(request, env) {
  const expected = String(env.AI_ACCESS_CODE || "").trim();
  if (!expected) {
    throw Object.assign(new Error("在线 AI 访问保护尚未配置，暂时不能执行付费生成"), { statusCode: 503 });
  }
  if (!accessCodeMatches(request.headers.get("x-ai-access-code"), expected)) {
    throw Object.assign(new Error("AI 访问码不正确，请重新输入后再试；原内容没有变化"), { statusCode: 401 });
  }
}

async function readJson(request, limit = MAX_JSON_BYTES) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(data) || "{}"); }
  catch { throw Object.assign(new Error("请求格式不正确"), { statusCode: 400 }); }
}

function compact(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function validatePublicUrl(value) {
  const url = new URL(String(value || ""));
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error("仅支持公开的 http 或 https 网页"), { statusCode: 400 });
  }
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || isPrivateIpv4(hostname) || hostname.includes(":")) {
    throw Object.assign(new Error("出于安全原因，不能读取本地或内网地址"), { statusCode: 400 });
  }
  return url;
}

async function readBounded(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_READER_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("网页内容超过 2MB，暂不自动读取"), { statusCode: 413 });
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function markdownText(raw) {
  return String(raw || "")
    .split(/^Markdown Content:\s*$/im).slice(1).join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, token) => {
    if (token[0] === "#") {
      const hex = token[1]?.toLowerCase() === "x";
      const point = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : " ";
    }
    return named[token.toLowerCase()] || " ";
  });
}

function readableHtml(raw) {
  const html = String(raw || "");
  const selected = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]
    || /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]
    || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
    || html;
  return decodeHtml(selected
    .replace(/<(script|style|svg|noscript|template|nav|footer|header|aside|form|dialog|button)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractRecipes(text) {
  const recipes = [];
  const seen = new Set();
  const pattern = /([\u4e00-\u9fa5A-Za-z·]{1,12})\s*[+＋]\s*([\u4e00-\u9fa5A-Za-z·]{1,12})\s*[=＝]\s*([\u4e00-\u9fa5A-Za-z·]{1,18})/g;
  for (const match of text.matchAll(pattern)) {
    const item = { ingredients: [compact(match[1], 12), compact(match[2], 12)], result: compact(match[3], 18) };
    const key = `${item.ingredients.join("+")}=${item.result}`;
    if (!seen.has(key)) {
      seen.add(key);
      recipes.push(item);
    }
    if (recipes.length >= 12) break;
  }
  return recipes;
}

function extractStructured(text, title) {
  const content = `${title}\n${text}`;
  const items = knownItems.filter((item, index) => content.includes(item) && knownItems.indexOf(item) === index).slice(0, 16);
  const recipes = extractRecipes(content);
  const version = compact(/(?:版本|Ver(?:sion)?\.?)[：:\s-]*([0-9]{1,2}(?:\.[0-9]{1,2}){1,2})/i.exec(content)?.[1], 24);
  const contentType = /(版本更新|更新公告|补丁|平衡调整)/.test(content) ? "patch"
    : /(强化符文|海克斯|强化选择)/.test(content) ? "augment"
      : /(赛季机制|玩法机制|新机制)/.test(content) ? "mechanic"
        : /(阵容|羁绊|站位|运营|来牌|上分|赌狗|T0)/.test(content) ? "lineup"
      : /(装备|合成|散件|成装)/.test(content) ? "equipment"
        : /(攻略|教程|新手|避坑)/.test(content) ? "guide" : "general";
  const keywordPool = ["装备合成", "装备分配", "替代装备", "版本更新", "新手攻略", "阵容推荐", "阵容运营", "强化符文", "海克斯", "赛季机制", "搜牌", "升级", "站位", "对位", "羁绊", "转职", "主C", "三星", "前排", "回蓝", "攻速", "生存"];
  const keywords = keywordPool.filter((item) => content.includes(item)).slice(0, 8);
  const evidenceCount = items.length + recipes.length + keywords.length + Number(Boolean(version));
  return {
    contentType,
    game: /金铲铲/.test(content) ? "金铲铲之战" : /Teamfight Tactics|\bTFT\b/i.test(content) ? "Teamfight Tactics" : "",
    version,
    items,
    recipes,
    lineupNames: [],
    keywords,
    confidence: evidenceCount >= 6 ? "high" : evidenceCount >= 2 ? "medium" : "low",
  };
}

async function extractPublicSource(value) {
  const target = validatePublicUrl(value);
  let directError;
  try {
    const direct = await fetch(target, {
      redirect: "follow",
      headers: {
        accept: "text/html,text/plain;q=0.9",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!direct.ok) throw new Error(`网页返回 ${direct.status}`);
    const contentType = direct.headers.get("content-type") || "";
    if (!/text\/(html|plain)/i.test(contentType)) throw new Error("这个链接不是可读取的公开网页");
    const raw = await readBounded(direct);
    const title = compact(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1], 160) || target.hostname;
    const text = /text\/plain/i.test(contentType) ? compact(raw, 12_000) : readableHtml(raw).slice(0, 12_000);
    if (text.length < 20) throw new Error("网页没有可读取的公开正文");
    return {
      status: "extracted",
      url: direct.url || target.href,
      title: decodeHtml(title),
      author: "",
      publishedAt: "",
      excerpt: compact(text, 1200),
      structured: extractStructured(text, title),
      retrievalMethod: "direct",
      failureReason: "",
    };
  } catch (error) {
    directError = error;
  }

  try {
    const readerUrl = new URL(`https://r.jina.ai/${target.href}`);
    const response = await fetch(readerUrl, {
      headers: { accept: "text/plain; charset=utf-8", "x-no-cache": "true" },
      signal: AbortSignal.timeout(readerTimeoutMs),
    });
    if (!response.ok) throw new Error(`兼容阅读器返回 ${response.status}`);
    const raw = await readBounded(response);
    const title = compact(/^Title:[ \t]*(.+)$/im.exec(raw)?.[1], 160) || target.hostname;
    const publishedAt = compact(/^Published Time:[ \t]*(.+)$/im.exec(raw)?.[1], 40);
    const text = markdownText(raw);
    const blocked = /(Target URL returned error|登录后你可以|安全验证|Access Denied|Forbidden)/i.test(`${raw.slice(0, 600)} ${text.slice(0, 300)}`);
    if (text.length < 20 || blocked) throw new Error("网页返回的是登录页或拦截页，没有把它当成正文");
    return {
      status: "extracted",
      url: target.href,
      title,
      author: compact(/^Author:[ \t]*(.+)$/im.exec(raw)?.[1], 100),
      publishedAt,
      excerpt: compact(text, 1200),
      structured: extractStructured(text, title),
      retrievalMethod: "reader",
      failureReason: "",
    };
  } catch (readerError) {
    throw Object.assign(new Error(`直接读取失败（${directError?.message || "未知原因"}），兼容解析也失败（${readerError?.message || "未知原因"}）`), { statusCode: 422 });
  }
}

let cachedAiKey = "";
let cachedAiService;
function aiService(env) {
  const key = `${env.DEEPSEEK_API_KEY || ""}|${env.DEEPSEEK_MODEL || ""}|${env.AI_REQUESTS_PER_MINUTE || ""}|${env.AI_REQUESTS_PER_DAY || ""}`;
  if (!cachedAiService || key !== cachedAiKey) {
    cachedAiKey = key;
    cachedAiService = createAiService({ env, fetchImpl: fetch });
  }
  return cachedAiService;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/ai/status") {
      return json({
        ...aiService(env).status(),
        accessRequired: Boolean(env.DEEPSEEK_API_KEY && env.AI_ACCESS_CODE),
        accessProtected: Boolean(env.AI_ACCESS_CODE),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/ai/tasks") {
      try {
        if (env.DEEPSEEK_API_KEY) requireAiAccess(request, env);
        const payload = await readJson(request);
        const result = await aiService(env).run(payload, {
          clientId: request.headers.get("cf-connecting-ip") || "online-demo",
        });
        return json(result);
      } catch (error) {
        return json({
          code: error?.statusCode === 401 ? "AI_ACCESS_DENIED" : error?.statusCode === 429 ? "AI_RATE_LIMITED" : "AI_TASK_FAILED",
          message: error instanceof Error ? error.message : "AI 任务失败，旧内容已保留",
        }, error?.statusCode || 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/ai/vision") {
      try {
        requireAiAccess(request, env);
        const input = await readJson(request, MAX_VISION_BYTES + 100);
        if (request.headers.get("accept")?.includes("application/x-ndjson")) {
          return visionStream((signal) => aiService(env).vision(input, { signal, clientId: request.headers.get("cf-connecting-ip") || "online-demo" }));
        }
        return json(await aiService(env).vision(input, { clientId: request.headers.get("cf-connecting-ip") || "online-demo" }));
      } catch (error) {
        return json({ code: "VISION_FAILED", message: error.message || "视觉识别失败" }, error.statusCode || 502);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/sources/extract") {
      try {
        const payload = await readJson(request);
        return json(await extractPublicSource(payload.url));
      } catch (error) {
        return json({
          code: "SOURCE_EXTRACTION_FAILED",
          message: error instanceof Error ? error.message : "网页解析失败，请手动补充公开正文片段",
        }, error?.statusCode || 422);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/game/research") {
      try {
        const payload = await readJson(request);
        const query = compact(`${payload.input || ""} ${payload.supplement || ""}`, 1600);
        if (query.length < 2) return json({ code: "GAME_QUERY_REQUIRED", message: "请先输入一个金铲铲主题" }, 400);
        return json(await fetchGameResearch(query, fetch));
      } catch (error) {
        return json({
          code: "GAME_RESEARCH_FAILED",
          message: error instanceof Error ? error.message : "当前赛季数据暂时无法读取",
        }, 502);
      }
    }
    return new Response(null, { status: 404 });
  },
};
