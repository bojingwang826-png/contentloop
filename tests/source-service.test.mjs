import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCleanReadableText,
  extractGameKnowledge,
  extractPublicSource,
  extractReaderPage,
  extractReadablePage,
  validatePublicUrl,
} from "../scripts/source-service.mjs";

test("公开网页正文可提取为来源卡", () => {
  const result = extractReadablePage(`<!doctype html><html><head><title>装备合成指南</title><meta name="author" content="铲友"></head><body><main><h1>金铲铲装备合成</h1><p>这是一段足够长的公开正文，用来解释铲子相关装备和适用情况。</p></main></body></html>`, "https://example.com/items");
  assert.equal(result.status, "extracted");
  assert.equal(result.title, "装备合成指南");
  assert.equal(result.author, "铲友");
  assert.match(result.excerpt, /铲子相关装备/);
});

test("网页正文清洗会优先正文并移除导航页脚和重复文字", () => {
  const text = extractCleanReadableText(`<body><nav>首页 登录 注册 热门推荐</nav><main><h1>金铲铲 S15 装备教程</h1><p>大剑＋拳套＝无尽之刃</p><p>先看主C需要什么功能，再决定装备。</p><p>先看主C需要什么功能，再决定装备。</p></main><footer>版权所有 隐私政策</footer></body>`);
  assert.match(text, /大剑＋拳套＝无尽之刃/);
  assert.doesNotMatch(text, /登录|隐私政策/);
  assert.equal(text.match(/先看主C需要什么功能/g)?.length, 1);
});

test("游戏资料会识别内容类型、赛季、装备和配方", () => {
  const result = extractGameKnowledge("金铲铲 S15 新手装备合成\n大剑＋拳套＝无尽之刃\n反曲弓＋大棒＝鬼索的狂暴之刃", "装备课");
  assert.equal(result.contentType, "equipment");
  assert.equal(result.game, "金铲铲之战");
  assert.equal(result.version, "S15");
  assert.ok(result.items.includes("无尽之刃"));
  assert.deepEqual(result.recipes[0], { ingredients: ["大剑", "拳套"], result: "无尽之刃" });
});

test("阵容文章即使提到装备也优先识别为阵容内容", () => {
  const result = extractGameKnowledge("金铲铲 S18 热门上分阵容推荐，共 5 套 T0 阵容。开局法系装备合适时可以玩莲华阿狸，运营到八级再搜牌。", "S18 上分阵容");
  assert.equal(result.contentType, "lineup");
  assert.equal(result.game, "金铲铲之战");
  assert.equal(result.version, "S18");
});

test("兼容阅读器正文可以转换为来源卡", () => {
  const result = extractReaderPage("Title: 金铲铲装备课\n\nURL Source: https://example.com/items\n\nMarkdown Content:\n# S15 新手装备合成\n大剑＋拳套＝无尽之刃\n这是一段足够长的公开教程正文。", "https://example.com/items");
  assert.equal(result.status, "extracted");
  assert.equal(result.title, "金铲铲装备课");
  assert.equal(result.retrievalMethod, "reader");
  assert.equal(result.structured.version, "S15");
});

test("兼容阅读器不会把登录拦截页误认成文章", () => {
  const result = extractReaderPage("Title: \n\nURL Source: https://zhuanlan.zhihu.com/p/1\n\nMarkdown Content:\n知乎，让每一次点击都充满意义 —— 欢迎来到知乎。", "https://zhuanlan.zhihu.com/p/1");
  assert.equal(result.status, "failed");
  assert.equal(result.title, "zhuanlan.zhihu.com");
  assert.match(result.failureReason, /登录页或拦截页/);
});

test("本地和内网地址会在请求前被拒绝", async () => {
  await assert.rejects(() => validatePublicUrl("http://127.0.0.1/private"), /本地或内网/);
  await assert.rejects(() => validatePublicUrl("http://intranet.local/private"), /本地或内网/);
});

test("服务端解析会校验类型并限制公开地址", async () => {
  const fetchImpl = async () => new Response("<title>TFTips 装备</title><p>公开装备页面提供了足够长的正文信息，可以直接用于候选选题。</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await extractPublicSource("https://example.com/items", { fetchImpl, lookupImpl });
  assert.equal(result.status, "extracted");
  assert.match(result.title, /TFTips/);
  assert.equal(result.retrievalMethod, "direct");
});

test("站点拒绝直接读取时自动改用兼容阅读器", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://r.jina.ai/")) {
      return new Response("Title: 知乎装备教程\n\nMarkdown Content:\n金铲铲 S15 装备合成，大剑＋拳套＝无尽之刃。这是一段足够长的公开正文内容。", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response("Forbidden", { status: 403 });
  };
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await extractPublicSource("https://example.com/items", { fetchImpl, lookupImpl });
  assert.equal(result.status, "extracted");
  assert.equal(result.retrievalMethod, "reader");
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^https:\/\/r\.jina\.ai\//);
});

test("兼容阅读器第一次拿到拦截页时会换协议重试", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (!String(url).startsWith("https://r.jina.ai/")) return new Response("Forbidden", { status: 403 });
    if (String(url).includes("/https://")) return new Response("Title: \n\nMarkdown Content:\n知乎，让每一次点击都充满意义。", { headers: { "content-type": "text/plain" } });
    return new Response("Title: 金铲铲攻略\n\nMarkdown Content:\n金铲铲新手装备攻略，这是一段足够长并且可以确认使用的公开正文。", { headers: { "content-type": "text/plain" } });
  };
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await extractPublicSource("https://example.com/items", { fetchImpl, lookupImpl });
  assert.equal(result.status, "extracted");
  assert.equal(result.title, "金铲铲攻略");
  assert.ok(calls.some((url) => url.includes("/http://")));
});
