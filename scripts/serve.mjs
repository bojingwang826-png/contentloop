import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAiService } from "./ai-service.mjs";
import { extractPublicSource } from "./source-service.mjs";
import { fetchGameResearch } from "./game-research.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const aiService = createAiService();

function accessCodeMatches(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

function requireAiAccess(request) {
  const expected = String(process.env.AI_ACCESS_CODE || "").trim();
  if (!expected) throw Object.assign(new Error("在线 AI 访问保护尚未配置，暂时不能执行付费生成"), { statusCode: 503 });
  if (!accessCodeMatches(request.headers["x-ai-access-code"], expected)) {
    throw Object.assign(new Error("AI 访问码不正确，请重新输入后再试；原内容没有变化"), { statusCode: 401 });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 200_000) throw Object.assign(new Error("AI 请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/ai/status") {
      sendJson(response, 200, {
        ...aiService.status(),
        accessRequired: Boolean(process.env.OPENAI_API_KEY && process.env.AI_ACCESS_CODE),
        accessProtected: Boolean(process.env.AI_ACCESS_CODE),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/tasks") {
      try {
        if (process.env.OPENAI_API_KEY) requireAiAccess(request);
        const payload = await readJson(request);
        const result = await aiService.run(payload, { clientId: request.socket.remoteAddress || "local" });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 500, {
          code: error?.statusCode === 401 ? "AI_ACCESS_DENIED" : error?.statusCode === 429 ? "AI_RATE_LIMITED" : "AI_TASK_FAILED",
          message: error instanceof Error ? error.message : "AI 任务失败，旧内容已保留",
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sources/extract") {
      try {
        const payload = await readJson(request);
        const result = await extractPublicSource(payload.url);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 422, {
          code: "SOURCE_EXTRACTION_FAILED",
          message: error instanceof Error ? error.message : "网页解析失败，请手动补充公开正文片段",
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/game/research") {
      try {
        const payload = await readJson(request);
        const result = await fetchGameResearch(`${payload.input || ""} ${payload.supplement || ""}`);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 502, { code: "GAME_RESEARCH_FAILED", message: error instanceof Error ? error.message : "当前赛季数据暂时无法读取" });
      }
      return;
    }
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(root, `.${relative}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`铲友创作台已启动：http://127.0.0.1:${port}\n`);
});
