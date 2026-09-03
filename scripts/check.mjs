import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/styles.css",
  "src/data/sample-project.js",
  "src/domain/schema.js",
  "src/domain/state.js",
  "src/domain/history.js",
  "src/domain/page-render.js",
  "src/domain/canvas-renderer.js",
  "src/domain/export-quality.js",
  "src/domain/ai-contract.js",
  "src/domain/input-analysis.js",
  "src/domain/screenshot-ocr.js",
  "src/domain/mock-ai-provider.js",
  "src/services/ai-client.js",
  "src/services/screenshot-ocr-client.js",
  "src/assets/ocr/chi_sim.traineddata.gz",
  "src/assets/ocr/eng.traineddata.gz",
  "src/vendor/tesseract/tesseract.esm.min.js",
  "src/vendor/tesseract/worker.min.js",
  "src/domain/zip.js",
  "scripts/ai-service.mjs",
  "src/assets/game-icons/tft_item_bfsword.png",
  "src/assets/game-icons/tft_item_recurvebow.png",
  "src/assets/game-icons/tft_item_needlesslylargerod.png",
  "src/assets/game-icons/tft_item_tearofthegoddess.png",
  "src/assets/game-icons/tft_item_chainvest.png",
  "src/assets/game-icons/tft_item_negatroncloak.png",
  "src/assets/game-icons/tft_item_giantsbelt.png",
  "src/assets/game-icons/tft_item_sparringgloves.png",
  "src/assets/game-icons/tft_item_spatula.png",
  "src/assets/game-icons/tft_item_fryingpan.png",
  "src/assets/game-icons/tft_item_infinityedge.png",
  "src/assets/game-icons/tft_item_madredsbloodrazor.png",
  "src/assets/game-icons/tft_item_lastwhisper.png",
  "src/assets/game-icons/tft_item_jeweledgauntlet.png",
  "src/assets/game-icons/tft_item_spearofshojin.png",
  "src/assets/game-icons/tft_item_archangelsstaff.png",
  "src/assets/game-icons/tft_item_guinsoosrageblade.png",
  "src/assets/game-icons/tft_item_krakenslayer.png",
  "src/assets/game-icons/tft_item_titansresolve.png",
  "src/assets/game-icons/tft_item_gargoylestoneplate.png",
  "src/assets/game-icons/tft_item_warmogsarmor.png",
  "src/assets/game-icons/sunfire_cape.png",
  "src/assets/game-icons/SOURCE.md",
  "design-system/MASTER.md",
];

const issues = [];
for (const file of requiredFiles) {
  try {
    await access(join(root, file));
  } catch {
    issues.push(`缺少文件：${file}`);
  }
}

const html = await readFile(join(root, "index.html"), "utf8");
const css = await readFile(join(root, "src/styles.css"), "utf8");
const app = await readFile(join(root, "src/app.js"), "utf8");
const pageRender = await readFile(join(root, "src/domain/page-render.js"), "utf8");
const build = await readFile(join(root, "scripts/build.mjs"), "utf8");
const aiService = await readFile(join(root, "scripts/ai-service.mjs"), "utf8");
const aiContract = await readFile(join(root, "src/domain/ai-contract.js"), "utf8");

const checks = [
  [html.includes('lang="zh-CN"'), "HTML 缺少中文语言声明"],
  [html.includes('name="viewport"'), "HTML 缺少移动端 viewport"],
  [html.includes("skip-link"), "缺少键盘跳转链接"],
  [app.includes('id="main-content"'), "缺少主要内容焦点目标"],
  [app.includes('aria-label="创作步骤"'), "步骤导航缺少无障碍名称"],
  [css.includes("min-height: 44px"), "样式未声明最小触控高度"],
  [css.includes("prefers-reduced-motion"), "缺少减少动态效果支持"],
  [css.includes("@media (max-width: 560px)"), "缺少手机断点"],
  [css.includes("@media (min-width: 1101px)"), "缺少桌面端编辑器布局规则"],
  [css.includes(".canvas-panel,\n  .inspector {\n    position: sticky"), "第四步预览未设置为桌面端固定"],
  [css.includes("overscroll-behavior: contain"), "第四步右侧设置区缺少独立滚动边界"],
  [css.includes("game-item-icon img"), "缺少独立装备图标样式"],
  [pageRender.includes("./src/assets/game-icons"), "未接入独立装备图标目录"],
  [app.includes("renderPageToPng"), "未接入高清 PNG 渲染器"],
  [app.includes("renderPageToCanvas") && app.includes("final-render-preview-canvas"), "第四步预览未与最终成图画布共用同一渲染器"],
  [app.includes("function pageStatus(page)"), "第四步缺少页面锁定状态渲染函数"],
  [app.includes("createZipBlob"), "未接入七页 ZIP 发布包"],
  [app.includes("download-current-png"), "缺少当前页 PNG 下载操作"],
  [app.includes("download-all-zip"), "缺少七页 ZIP 下载操作"],
  [!app.includes("background-position"), "仍在使用截图裁切定位"],
  [!app.includes("game-source"), "仍在引用游戏截图目录"],
  [build.includes('"game-source"'), "构建未明确排除历史截图目录"],
  [app.includes("rewriteSummary"), "缺少 AI 建议理解反馈"],
  [!app.includes("onclick="), "发现内联 onclick，事件边界不统一"],
  [app.includes("runAiTask"), "页面尚未接入统一 AI 客户端"],
  [aiService.includes("https://api.deepseek.com/responses"), "服务端尚未接入 DeepSeek Responses API"],
  [aiContract.includes("understand_input"), "首页输入理解尚未接入统一 AI 协议"],
  [aiService.includes('type: "web_search"'), "在线输入理解尚未接入公开网页检索"],
  [aiContract.includes("allowedFactIds"), "AI 请求缺少事实白名单"],
  [aiService.includes("DEEPSEEK_API_KEY"), "API Key 未限定在服务端读取"],
];

for (const [passed, message] of checks) {
  if (!passed) issues.push(message);
}

if (issues.length > 0) {
  process.stderr.write(`${issues.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`静态检查通过：${requiredFiles.length} 个必需文件，${checks.length} 项规则。\n`);
}
