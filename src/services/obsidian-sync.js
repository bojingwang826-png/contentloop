const DB_NAME = "chanyou-obsidian-sync";
const STORE_NAME = "handles";
const HANDLE_KEY = "vault";
const SYNC_FOLDER = "铲友创作台自动同步";

let vaultHandle = null;
let status = { mode: "disconnected", message: "尚未连接 Obsidian" };
let timer = 0;
let latestSnapshot = null;
let lastFingerprint = "";
const listeners = new Set();

function emit(next) {
  status = next;
  listeners.forEach((listener) => listener(status));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function storeHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

async function removeStoredHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

function cleanInline(value, max = 200) {
  return String(value || "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function fencedJson(value) {
  return JSON.stringify(value, null, 2).replaceAll("```", "` ` `");
}

export function obsidianSnapshotMarkdown(snapshot, syncedAt = new Date().toISOString()) {
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
  const topic = snapshot.customProject?.topic?.title || snapshot.selectedTopicId || "未选择";
  const route = cleanInline(snapshot.route || "home", 30);
  return `---
type: chanyou-site-snapshot
status: ai-pending
synced_at: ${syncedAt}
source: 铲友创作台
---

# 铲友创作台自动同步草稿

> [!warning] AI 待确认
> 这是网站当前草稿的自动快照，不代表游戏事实已核验，也不会覆盖正式知识笔记。

- 当前步骤：${route}
- 主题：${cleanInline(topic)}
- 发布账号：${cleanInline(snapshot.accountName)}
- 页面数量：${pages.length}
- 大纲状态：${snapshot.outlineConfirmed ? "已确认" : "未确认"}

## 七页内容

${pages.map((page) => `### 第 ${Number(page.pageNo) || "?"} 页｜${cleanInline(page.title)}

${cleanInline(page.subtitle || page.purpose || page.baseSubtitle, 800) || "（无补充说明）"}`).join("\n\n") || "（尚未生成页面）"}

## 发布文案

${String(snapshot.publishBody || "（尚未生成）").trim()}

## 完整结构化草稿

\`\`\`json
${fencedJson({
    contentSource: snapshot.contentSource,
    sourceInput: snapshot.sourceInput,
    confirmedScreenshots: snapshot.confirmedScreenshots,
    customProject: snapshot.customProject,
    pages,
    currentPageId: snapshot.currentPageId,
    publishBody: snapshot.publishBody,
    publishBodyPreserved: snapshot.publishBodyPreserved,
    namedVersions: snapshot.history?.saved || [],
  })}
\`\`\`
`;
}

async function writableFolder(root) {
  // A real Vault is required. Never create or modify .obsidian.
  await root.getDirectoryHandle(".obsidian", { create: false });
  const inbox = await root.getDirectoryHandle("AI待确认", { create: true });
  return inbox.getDirectoryHandle(SYNC_FOLDER, { create: true });
}

async function writeFile(folder, name, content) {
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(content); await writable.close(); }
  catch (error) { await writable.abort(); throw error; }
}

async function appendLog(folder, line) {
  const handle = await folder.getFileHandle("同步记录.md", { create: true });
  const old = await (await handle.getFile()).text();
  const header = old || "# 铲友创作台同步记录\n\n此日志只记录自动快照时间与步骤；完整内容见当前草稿。\n\n";
  await writeFile(folder, "同步记录.md", `${header}${line}\n`);
}

async function flush() {
  if (!vaultHandle || !latestSnapshot) return;
  const permission = await vaultHandle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    emit({ mode: "permission", message: "需要重新授权 Obsidian 文件夹" });
    return;
  }
  const markdown = obsidianSnapshotMarkdown(latestSnapshot);
  const fingerprint = markdown.replace(/^synced_at:.*$/m, "");
  if (fingerprint === lastFingerprint) return;
  emit({ mode: "syncing", message: "正在写入 Obsidian…" });
  const folder = await writableFolder(vaultHandle);
  await writeFile(folder, "当前草稿.md", markdown);
  await appendLog(folder, `- ${new Date().toLocaleString("zh-CN")} · ${cleanInline(latestSnapshot.route || "home", 30)} · 已更新当前草稿`);
  lastFingerprint = fingerprint;
  emit({ mode: "connected", message: `已连接：${vaultHandle.name}` });
}

export function scheduleObsidianSync(snapshot) {
  latestSnapshot = structuredClone(snapshot);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => flush().catch((error) => emit({ mode: "error", message: `写入失败：${error.message || "请重新连接"}` })), 900);
}

export async function connectObsidianVault(snapshot) {
  if (typeof window.showDirectoryPicker !== "function") throw new Error("当前浏览器不支持文件夹写入，请使用最新版 Chrome 或 Edge");
  const handle = vaultHandle || await window.showDirectoryPicker({ id: "chanyou-obsidian-vault", mode: "readwrite", startIn: "documents" });
  if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("未获得文件夹写入权限");
  await writableFolder(handle);
  vaultHandle = handle;
  await storeHandle(handle);
  emit({ mode: "connected", message: `已连接：${handle.name}` });
  scheduleObsidianSync(snapshot);
}

export async function restoreObsidianConnection() {
  if (typeof indexedDB === "undefined") return;
  try {
    vaultHandle = await storedHandle();
    if (!vaultHandle) return;
    const permission = await vaultHandle.queryPermission({ mode: "readwrite" });
    emit(permission === "granted"
      ? { mode: "connected", message: `已连接：${vaultHandle.name}` }
      : { mode: "permission", message: `已记住 ${vaultHandle.name}，点击重新授权` });
  } catch {
    emit({ mode: "error", message: "无法读取已保存的 Obsidian 授权" });
  }
}

export async function disconnectObsidianVault() {
  window.clearTimeout(timer);
  vaultHandle = null;
  latestSnapshot = null;
  lastFingerprint = "";
  await removeStoredHandle();
  emit({ mode: "disconnected", message: "尚未连接 Obsidian" });
}

export function getObsidianStatus() {
  return { ...status };
}

export function subscribeObsidianStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
