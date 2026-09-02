import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const screenshotEvidence = resolve(root, "src", "assets", "game-source");

const builder = await createBuilder({ root, builder: {} });
await builder.buildApp();
await Promise.all([
  access(resolve(root, "dist", "server", "index.js")),
  access(resolve(root, "dist", "client", "index.html")),
  access(resolve(root, ".openai", "hosting.json")),
]);

process.stdout.write(`在线构建完成；历史截图目录未发布：${screenshotEvidence}\n`);
