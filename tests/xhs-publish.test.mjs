import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { buildXhsPublishPayload, checkedPublishPages, probeXhsExtension } from "../src/services/xhs-extension-bridge.js";

function artifacts(status = "pass") {
  return {
    fingerprint: "current",
    failures: [],
    pages: Array.from({ length: 7 }, (_, index) => ({
      pageNo: index + 1,
      name: `page-${index + 1}.png`,
      blob: new Blob(["png"], { type: "image/png" }),
      audit: { status },
    })),
  };
}

test("小红书发布只接受当前版本、七页连续且全部质检通过的 PNG", () => {
  assert.equal(checkedPublishPages(artifacts(), "current").length, 7);
  assert.throws(() => checkedPublishPages(artifacts(), "old"), /过期/);
  assert.throws(() => checkedPublishPages(artifacts("warning"), "current"), /质检/);
  const missing = artifacts();
  missing.pages.pop();
  assert.throws(() => checkedPublishPages(missing, "current"), /七页/);
  const failed = artifacts();
  failed.failures.push({ pageNo: 2 });
  assert.throws(() => checkedPublishPages(failed, "current"), /七页/);
});

test("发布包保留用户最终标题和正文，按七页顺序发送", async () => {
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload();
      });
    }
  };
  try {
    const payload = await buildXhsPublishPayload({ title: "  手动标题 ", body: "  手动正文  ", pages: checkedPublishPages(artifacts(), "current") });
    assert.equal(payload.title, "手动标题");
    assert.equal(payload.body, "手动正文");
    assert.deepEqual(payload.images.map((image) => image.pageNo), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(payload.images.every((image) => image.dataUrl.startsWith("data:image/png;base64,")));
  } finally {
    globalThis.FileReader = previous;
  }
});

test("扩展拒绝非 ContentLoop 来源和不完整图片，不打开小红书标签", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  let listener;
  let opened = 0;
  const chrome = {
    runtime: { id: "test-extension", onMessage: { addListener(callback) { listener = callback; } } },
    tabs: { async create() { opened += 1; return { id: 1 }; } },
  };
  vm.runInNewContext(source, { chrome, URL, setTimeout });
  const send = (payload, frameUrl, tabUrl = frameUrl) => new Promise((resolveReply) => {
    listener({ kind: "contentloop-prepare-draft", payload }, { id: "test-extension", url: frameUrl, tab: { url: tabUrl } }, resolveReply);
  });
  const payload = { title: "标题", body: "正文", images: [] };
  const foreign = await send(payload, "https://evil.example/");
  assert.match(foreign.error, /不受信任/);
  const foreignFrame = await send(payload, "https://evil.example/", "https://contentloop.pocketbay.app/#/export");
  assert.match(foreignFrame.error, /不受信任/);
  const incomplete = await send(payload, "https://contentloop.pocketbay.app/#/export");
  assert.match(incomplete.error, /七页/);
  const pocketBayFrame = await send(payload, "https://contentloop--e.pocketbay.app/#/export", "https://contentloop.pocketbay.app/#/export");
  assert.match(pocketBayFrame.error, /七页/);
  assert.equal(opened, 0);
});

test("网站在生成图片前能探测扩展，忽略其他来源的回复", async () => {
  const listeners = new Set();
  const target = {
    location: { origin: "https://contentloop--e.pocketbay.app" },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    postMessage(message) {
      const reply = { channel: message.channel, kind: "result", requestId: message.requestId, ok: true, feature: "draft-v3" };
      for (const listener of listeners) listener({ source: target, origin: "https://evil.example", data: reply });
      queueMicrotask(() => { for (const listener of listeners) listener({ source: target, origin: target.location.origin, data: reply }); });
    },
  };
  assert.equal((await probeXhsExtension({ target })).ok, true);
  assert.equal(listeners.size, 0);
});

test("扩展探测必须真的连到后台，失效的内容脚本不能伪装成已连接", async () => {
  const source = await readFile(resolve("chrome-extension/contentloop-page.js"), "utf8");
  let handler;
  const replies = [];
  const page = {
    addEventListener(_type, callback) { handler = callback; },
    postMessage(message) { replies.push(message); },
  };
  const origin = "https://contentloop--e.pocketbay.app";
  const chrome = { runtime: { sendMessage() { throw new Error("Extension context invalidated"); } } };
  vm.runInNewContext(source, { window: page, location: { origin }, chrome });
  const send = (kind, requestId) => handler({ source: page, origin, data: { channel: "contentloop-xhs-publish-v1", kind, requestId } });
  assert.doesNotThrow(() => send("ping", "probe"));
  assert.equal(replies[0].ok, false);
  assert.match(replies[0].error, /失效|重新打开/);
  assert.doesNotThrow(() => send("prepare-draft", "draft"));
  assert.equal(replies[1].ok, false);
});

test("扩展后台只对可信 ContentLoop 页面报告草稿能力", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  let listener;
  const chrome = { runtime: { id: "test-extension", onMessage: { addListener(callback) { listener = callback; } } } };
  vm.runInNewContext(source, { chrome, URL, setTimeout });
  const probe = (frameUrl) => new Promise((resolveReply) => {
    listener({ kind: "contentloop-probe" }, { id: "test-extension", url: frameUrl, tab: { url: "https://contentloop.pocketbay.app/#/export" } }, resolveReply);
  });
  assert.equal((await probe("https://contentloop--e.pocketbay.app/#/export")).feature, "draft-v3");
  assert.equal((await probe("https://evil.example/")).ok, false);
});

test("线上扩展脚本只注入真实应用内嵌域名，不注入 PocketBay 外壳", async () => {
  const manifest = JSON.parse(await readFile(resolve("chrome-extension/manifest.json"), "utf8"));
  const matches = manifest.content_scripts[0].matches;
  assert.ok(matches.includes("https://contentloop--e.pocketbay.app/*"));
  assert.ok(!matches.includes("https://contentloop.pocketbay.app/*"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(manifest.content_scripts.length, 1);
  assert.ok(manifest.host_permissions.includes("https://creator.xiaohongshu.com/*"));
});

test("旧版扩展会立即提示重新加载，不会等待草稿请求超时", async () => {
  const listeners = new Set();
  const target = {
    location: { origin: "https://contentloop--e.pocketbay.app" },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    postMessage(message) {
      queueMicrotask(() => {
        for (const listener of listeners) listener({ source: target, origin: target.location.origin, data: { channel: message.channel, kind: "result", requestId: message.requestId, ok: true } });
      });
    },
  };
  await assert.rejects(() => probeXhsExtension({ target }), /重新加载/);
  assert.equal(listeners.size, 0);
});

test("扩展打开小红书图文入口，不再使用旧的视频默认入口", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  const context = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(`${source}\nglobalThis.creatorUrlForTest = PUBLISH_URL;`, context);
  assert.equal(context.creatorUrlForTest, "https://creator.xiaohongshu.com/publish/publish?target=image");
});

test("打开图文页后明确注入小红书脚本，探测成功才发送草稿", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  const steps = [];
  const payload = {
    title: "人工标题",
    body: "人工正文",
    images: Array.from({ length: 7 }, (_, index) => ({ pageNo: index + 1, name: `page-${index + 1}.png`, dataUrl: "data:image/png;base64,cG5n" })),
  };
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    tabs: {
      async create() { steps.push("create"); return { id: 42 }; },
      async get() { steps.push("loaded"); return { url: "https://creator.xiaohongshu.com/publish/publish?target=image", status: "complete" }; },
      async sendMessage(_tabId, message) {
        steps.push(message.kind === "contentloop-ping" ? "ping" : "fill");
        return message.kind === "contentloop-ping" ? { ready: true } : { ok: true, status: "draft_ready" };
      },
    },
    scripting: { async executeScript(injection) { steps.push("inject"); assert.deepEqual(Array.from(injection.files), ["xhs-page.js"]); return [{ frameId: 0 }]; } },
  };
  const context = { chrome, URL, setTimeout };
  vm.runInNewContext(`${source}\nglobalThis.prepareDraftForTest = prepareDraft;`, context);
  assert.equal((await context.prepareDraftForTest(payload)).status, "draft_ready");
  assert.deepEqual(steps, ["create", "loaded", "inject", "ping", "fill"]);
});

test("新标签先处于 about:blank 且仍在 loading 时也能等待可信地址并注入", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  const steps = [];
  let getCount = 0;
  const payload = {
    title: "标题", body: "正文",
    images: Array.from({ length: 7 }, (_, index) => ({ pageNo: index + 1, name: `page-${index + 1}.png`, dataUrl: "data:image/png;base64,cG5n" })),
  };
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    tabs: {
      async create() { steps.push("create"); return { id: 43 }; },
      async get() {
        getCount += 1;
        steps.push(getCount === 1 ? "pending" : "trusted-loading");
        return getCount === 1
          ? { url: "about:blank", status: "loading" }
          : { url: "https://creator.xiaohongshu.com/publish/publish?target=image", status: "loading" };
      },
      async sendMessage(_tabId, message) {
        steps.push(message.kind === "contentloop-ping" ? "ping" : "fill");
        return message.kind === "contentloop-ping" ? { ready: true } : { ok: true, status: "draft_ready" };
      },
    },
    scripting: { async executeScript() { steps.push("inject"); return [{ frameId: 0 }]; } },
  };
  const fastTimeout = (callback) => { queueMicrotask(callback); return 1; };
  const context = { chrome, URL, setTimeout: fastTimeout };
  vm.runInNewContext(`${source}\nglobalThis.prepareDraftForTest = prepareDraft;`, context);
  assert.equal((await context.prepareDraftForTest(payload)).status, "draft_ready");
  assert.deepEqual(steps, ["create", "pending", "trusted-loading", "inject", "ping", "fill"]);
});

test("小红书脚本注入失败时，后台会尝试在已打开的可信页面显示原因", async () => {
  const source = await readFile(resolve("chrome-extension/background.js"), "utf8");
  const steps = [];
  const payload = {
    title: "标题", body: "正文",
    images: Array.from({ length: 7 }, (_, index) => ({ pageNo: index + 1, name: `page-${index + 1}.png`, dataUrl: "data:image/png;base64,cG5n" })),
  };
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    tabs: {
      async create() { steps.push("create"); return { id: 44 }; },
      async get() { steps.push("get"); return { url: "https://creator.xiaohongshu.com/publish/publish?target=image", status: "loading" }; },
    },
    scripting: {
      async executeScript(injection) {
        if (injection.files) { steps.push("inject-error"); throw new Error("injection denied"); }
        steps.push("show-error");
        assert.match(injection.args[0], /injection denied/);
        return [{ frameId: 0 }];
      },
    },
  };
  const context = { chrome, URL, setTimeout };
  vm.runInNewContext(`${source}\nglobalThis.prepareDraftForTest = prepareDraft;`, context);
  await assert.rejects(() => context.prepareDraftForTest(payload), /injection denied/);
  assert.deepEqual(steps, ["create", "get", "inject-error", "get", "show-error"]);
});

test("图文模式可识别未声明 accept 的图片输入框，不误用视频输入框", async () => {
  const source = await readFile(resolve("chrome-extension/xhs-page.js"), "utf8");
  const blankAccept = { accept: "", disabled: false };
  const videoInput = { accept: "video/mp4", disabled: false };
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: { querySelectorAll(selector) { return selector === 'input[type="file"]' ? [videoInput, blankAccept] : []; } },
  };
  vm.runInNewContext(`${source}\nglobalThis.imageInputForTest = findImageInput;`, context);
  assert.equal(context.imageInputForTest(), blankAccept);
});

test("小红书页面会显示自动带入失败原因，且不覆盖用户已打开的草稿", async () => {
  const source = await readFile(resolve("chrome-extension/xhs-page.js"), "utf8");
  let status;
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      body: { appendChild(element) { status = element; } },
      getElementById() { return status; },
      createElement() { return { style: {}, textContent: "" }; },
    },
  };
  vm.runInNewContext(`${source}\nglobalThis.showDraftStatusForTest = showDraftStatus;`, context);
  context.showDraftStatusForTest("ContentLoop 自动带入未完成：未找到图片控件。当前页面已保留。", true);
  assert.match(status.textContent, /未找到图片控件/);
  assert.equal(status.style.borderColor, "#e5484d");
  assert.equal(status.id, "contentloop-draft-status");
});

test("扩展切换上传图文并填入七张图与文案，最终发布仍由用户点击", async () => {
  const source = await readFile(resolve("chrome-extension/xhs-page.js"), "utf8");
  let selectedImageMode = false;
  let uploadedCount = 0;
  let publishClicks = 0;
  const preview = () => ({ getClientRects: () => [1], naturalWidth: 1080, naturalHeight: 1440 });
  const tab = { innerText: "上传图文", getClientRects: () => [1], matches: () => false, click() { selectedImageMode = true; } };
  const submit = { innerText: "发布", getClientRects: () => [1], click() { publishClicks += 1; } };
  const firstInput = { accept: "image/png", disabled: false, multiple: false, files: [], dispatchEvent(event) { if (event.type === "change") uploadedCount = this.files.length; } };
  const restInput = { accept: "image/png", disabled: false, multiple: true, files: [], dispatchEvent(event) { if (event.type === "change") uploadedCount += this.files.length; } };
  class Input {
    constructor(placeholder) { this.placeholder = placeholder; this.maxLength = 1000; this.current = ""; }
    get value() { return this.current; }
    set value(text) { this.current = text; }
    getClientRects() { return [1]; }
    getAttribute() { return ""; }
    dispatchEvent() {}
  }
  class Textarea extends Input {}
  const title = new Input("填写标题");
  const body = new Textarea("填写正文");
  class Transfer {
    constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
  }
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: { querySelectorAll(selector) {
      if (selector.includes("creator-tab")) return [tab, submit];
      if (selector === 'input[type="file"]') return selectedImageMode ? [uploadedCount ? restInput : firstInput] : [];
      if (selector === 'input:not([type="file"]),textarea') return uploadedCount ? [title, body] : [];
      if (selector === 'textarea,[contenteditable="true"]') return uploadedCount ? [body] : [];
      if (selector === '[class*="upload"] img') return Array.from({ length: uploadedCount }, preview);
      return [];
    } },
    getComputedStyle: () => ({ visibility: "visible" }),
    location: { pathname: "/publish/publish" },
    fetch: async () => ({ blob: async () => ({ type: "image/png", size: 1 }) }),
    File: class { constructor(_parts, name, { type }) { this.name = name; this.type = type; } },
    DataTransfer: Transfer,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Textarea,
    Event: class { constructor(type) { this.type = type; } },
    setTimeout,
  };
  vm.runInNewContext(`${source}\nglobalThis.fillDraftForTest = fillDraft;`, context);
  const images = Array.from({ length: 7 }, (_, index) => ({ pageNo: index + 1, name: `page-${index + 1}.png`, dataUrl: "data:image/png;base64,cG5n" }));
  const result = await context.fillDraftForTest({ title: "人工确认标题", body: "人工确认正文", images });
  assert.equal(result.status, "draft_ready");
  assert.equal(selectedImageMode, true);
  assert.equal(uploadedCount, 7);
  assert.equal(title.value, "人工确认标题");
  assert.equal(body.value, "人工确认正文");
  assert.equal(publishClicks, 0);
});
