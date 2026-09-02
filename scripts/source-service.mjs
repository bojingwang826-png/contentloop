import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
const READER_TIMEOUT_MS = 20_000;

function compact(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, token) => {
      if (token[0] === "#") {
        const hex = token[1]?.toLowerCase() === "x";
        const point = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : " ";
      }
      return named[token.toLowerCase()] || " ";
    });
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const first = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i").exec(html);
    const second = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i").exec(html);
    if (first?.[1] || second?.[1]) return compact(decodeHtml(first?.[1] || second?.[1]), 300);
  }
  return "";
}

const boilerplatePattern = /(登录|注册|关注我们|相关推荐|热门推荐|版权所有|版权声明|ICP备|隐私政策|用户协议|展开全文|返回首页|网站导航|扫码下载|下载客户端|cookie|advertisement|all rights reserved)/i;

function selectReadableRoot(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if (main) return main;
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  if (article) return article;
  return /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html;
}

export function extractCleanReadableText(html) {
  const selected = selectReadableRoot(String(html || ""));
  const withBreaks = selected
    .replace(/<(script|style|svg|noscript|template|nav|footer|header|aside|form|dialog|button)[^>]*>[\s\S]*?<\/\1>/gi, "\n")
    .replace(/<!--([\s\S]*?)-->/g, "\n")
    .replace(/<\/?(?:p|div|section|article|main|h[1-6]|li|ul|ol|table|tr|blockquote|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const seen = new Set();
  return decodeHtml(withBreaks)
    .split(/\r?\n/)
    .map((line) => compact(line, 500))
    .filter((line) => line.length >= 2)
    .filter((line) => !(line.length <= 90 && boilerplatePattern.test(line)))
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .slice(0, 12_000);
}

const knownItems = [
  "暴风大剑", "大剑", "反曲之弓", "反曲弓", "无用大棒", "大棒", "女神之泪", "锁子甲", "负极斗篷", "巨人腰带", "拳套", "金铲铲", "金锅锅",
  "无尽之刃", "海克斯科技枪刃", "朔极之矛", "夜之锋刃", "汲取剑", "红霸符", "鬼索的狂暴之刃", "虚空之杖", "泰坦的坚决", "珠光护手", "大天使之杖", "冕卫", "离子火花", "蓝霸符", "圣盾使的誓约", "适应性头盔", "振奋盔甲", "正义之手", "坚定之心", "石像鬼石板甲", "薄暮法袍", "水银", "日炎斗篷", "狂徒铠甲", "强袭者的链枷", "秘法手套",
];

function uniqueMatches(text, values, max = 16) {
  return values.filter((value) => text.includes(value)).filter((value, index, all) => all.indexOf(value) === index).slice(0, max);
}

function detectVersion(text) {
  const patterns = [
    /(?:版本|Ver(?:sion)?\.?)[：:\s-]*([0-9]{1,2}(?:\.[0-9]{1,2}){1,2})/i,
    /\b([0-9]{1,2}\.[0-9]{1,2})\s*(?:版本|更新|补丁)/i,
    /(?:赛季|Season)[：:\s-]*([A-Za-z]?[0-9]{1,3}(?:\.[0-9]+)?)/i,
    /\b(S[0-9]{1,3}(?:\.[0-9]+)?)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return compact(match[1], 24);
  }
  return "";
}

function extractRecipes(text) {
  const recipes = [];
  const seen = new Set();
  const recipePattern = /([\u4e00-\u9fa5A-Za-z·]{1,12})\s*[+＋]\s*([\u4e00-\u9fa5A-Za-z·]{1,12})\s*[=＝]\s*([\u4e00-\u9fa5A-Za-z·]{1,18})/g;
  for (const match of text.matchAll(recipePattern)) {
    const ingredients = [compact(match[1], 12), compact(match[2], 12)];
    const result = compact(match[3], 18);
    const key = `${ingredients.join("+") }=${result}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipes.push({ ingredients, result });
    if (recipes.length >= 12) break;
  }
  return recipes;
}

export function extractGameKnowledge(text, title = "") {
  const content = `${title}\n${text}`;
  const items = uniqueMatches(content, knownItems);
  const recipes = extractRecipes(content);
  const contentType = /(版本更新|更新公告|补丁|平衡调整)/.test(content)
    ? "patch"
    : /(强化符文|海克斯|强化选择)/.test(content)
      ? "augment"
      : /(赛季机制|玩法机制|新机制)/.test(content)
        ? "mechanic"
        : /(阵容|羁绊|站位|运营|来牌|上分|赌狗|T0)/.test(content)
          ? "lineup"
      : /(装备|合成|散件|成装)/.test(content)
        ? "equipment"
        : /(攻略|教程|新手|避坑)/.test(content)
          ? "guide"
          : "general";
  const game = /金铲铲/.test(content) ? "金铲铲之战" : /Teamfight Tactics|\bTFT\b/i.test(content) ? "Teamfight Tactics" : "";
  const version = detectVersion(content);
  const keywordPool = ["装备合成", "装备分配", "替代装备", "版本更新", "新手攻略", "阵容推荐", "阵容运营", "强化符文", "海克斯", "赛季机制", "搜牌", "升级", "站位", "对位", "羁绊", "转职", "主C", "三星", "前排", "回蓝", "攻速", "生存"];
  const keywords = uniqueMatches(content, keywordPool, 8);
  const lineupNames = text.split(/\r?\n/)
    .map((line) => compact(line, 40))
    .filter((line) => line.length >= 4 && line.length <= 32 && /(阵容|羁绊)/.test(line))
    .slice(0, 6);
  const evidenceCount = Number(Boolean(game)) + Number(Boolean(version)) + items.length + recipes.length + lineupNames.length + keywords.length;
  return {
    contentType,
    game,
    version,
    items,
    recipes,
    lineupNames: [...new Set(lineupNames)],
    keywords,
    confidence: evidenceCount >= 6 ? "high" : evidenceCount >= 2 ? "medium" : "low",
  };
}

export function extractReadablePage(html, url) {
  const raw = String(html || "");
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] || "";
  const title = metaContent(raw, ["og:title", "twitter:title"]) || compact(decodeHtml(titleTag.replace(/<[^>]+>/g, " ")), 160);
  const author = metaContent(raw, ["author", "article:author"]);
  const publishedAt = metaContent(raw, ["article:published_time", "datePublished", "date"]);
  const description = metaContent(raw, ["og:description", "description", "twitter:description"]);
  const readableText = extractCleanReadableText(raw);
  const excerpt = compact(readableText.includes(description) ? readableText : `${description} ${readableText}`, 1200);
  const structured = extractGameKnowledge(readableText, title);
  return {
    status: excerpt.length >= 20 ? "extracted" : "failed",
    title: title || new URL(url).hostname,
    author,
    publishedAt,
    excerpt,
    structured,
    failureReason: excerpt.length >= 20 ? "" : "网页没有可读取的公开正文",
  };
}

export function extractReaderPage(value, url) {
  const raw = String(value || "");
  const title = compact(/^Title:[ \t]*(.+)$/im.exec(raw)?.[1], 160) || new URL(url).hostname;
  const publishedAt = compact(/^Published Time:[ \t]*(.+)$/im.exec(raw)?.[1], 40);
  const markdown = raw.split(/^Markdown Content:\s*$/im).slice(1).join("\n") || raw;
  const readableText = extractCleanReadableText(markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, ""));
  const excerpt = compact(readableText, 1200);
  const blockedPage = /(Target URL returned error|登录后你可以|知乎，让每一次点击都充满意义|安全验证|访问过于频繁|Access Denied|Forbidden)/i.test(`${raw.slice(0, 600)} ${excerpt.slice(0, 300)}`);
  return {
    status: excerpt.length >= 20 && !blockedPage ? "extracted" : "failed",
    title,
    author: "",
    publishedAt,
    excerpt,
    structured: extractGameKnowledge(readableText, title),
    retrievalMethod: "reader",
    failureReason: excerpt.length >= 20 && !blockedPage ? "" : "兼容阅读器拿到的是登录页或拦截页，没有把它当成正文",
  };
}

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

function isPublicAddress(address) {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase();
  if (value === "::" || value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  return mapped ? isPublicIpv4(mapped[1]) : true;
}

export async function validatePublicUrl(value, lookupImpl = lookup) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error("仅支持公开的 http 或 https 网页"), { statusCode: 400 });
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw Object.assign(new Error("不支持本地或内网页址"), { statusCode: 400 });
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupImpl(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw Object.assign(new Error("出于安全原因，不能读取本地或内网地址"), { statusCode: 400 });
  return url;
}

async function readBoundedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("网页内容超过 2MB，暂不自动读取"), { statusCode: 413 });
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

async function fetchDirectSource(initialUrl, fetchImpl, lookupImpl) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: "text/html,text/plain;q=0.9",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) throw Object.assign(new Error("网页跳转次数过多"), { statusCode: 422 });
      const location = response.headers.get("location");
      if (!location) throw Object.assign(new Error("网页跳转地址无效"), { statusCode: 422 });
      current = await validatePublicUrl(new URL(location, current).href, lookupImpl);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`网页返回 ${response.status}`), { statusCode: 422 });
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/(html|plain)/i.test(contentType)) throw Object.assign(new Error("这个链接不是可读取的公开网页"), { statusCode: 415 });
    const result = extractReadablePage(await readBoundedBody(response), current.href);
    if (result.status !== "extracted") throw Object.assign(new Error(result.failureReason), { statusCode: 422 });
    return { ...result, retrievalMethod: "direct", url: current.href };
  }
  throw Object.assign(new Error("网页暂时无法读取"), { statusCode: 422 });
}

async function fetchReaderFallback(targetUrl, fetchImpl) {
  const readerTargets = [targetUrl.href];
  if (targetUrl.protocol === "https:") {
    const alternate = new URL(targetUrl.href);
    alternate.protocol = "http:";
    readerTargets.push(alternate.href);
  }
  let lastError;
  for (const readerTarget of readerTargets) {
    try {
      const readerUrl = new URL(`https://r.jina.ai/${readerTarget}`);
      const response = await fetchImpl(readerUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(READER_TIMEOUT_MS),
        headers: { accept: "text/plain; charset=utf-8", "x-no-cache": "true" },
      });
      if (!response.ok) throw Object.assign(new Error(`兼容阅读器返回 ${response.status}`), { statusCode: 422 });
      const result = extractReaderPage(await readBoundedBody(response), targetUrl.href);
      if (result.status !== "extracted") throw Object.assign(new Error(result.failureReason), { statusCode: 422 });
      return { ...result, url: targetUrl.href };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || Object.assign(new Error("兼容阅读器没有返回可用正文"), { statusCode: 422 });
}

export async function extractPublicSource(value, { fetchImpl = fetch, lookupImpl = lookup } = {}) {
  const targetUrl = await validatePublicUrl(value, lookupImpl);
  let directError;
  try {
    return await fetchDirectSource(targetUrl, fetchImpl, lookupImpl);
  } catch (error) {
    directError = error;
  }
  try {
    return await fetchReaderFallback(targetUrl, fetchImpl);
  } catch (readerError) {
    const networkFailure = /fetch failed|timeout|aborted/i.test(`${directError?.message || ""} ${readerError?.message || ""}`);
    const message = networkFailure
      ? "本地网页解析服务无法连接公网，请重新启动服务后重试"
      : `直接读取失败（${directError?.message || "未知原因"}），兼容解析也失败（${readerError?.message || "未知原因"}）`;
    throw Object.assign(new Error(message), { statusCode: readerError?.statusCode || directError?.statusCode || 422 });
  }
}
