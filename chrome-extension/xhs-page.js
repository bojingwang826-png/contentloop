const WAIT_MS = 30000;
let draftInProgress = false;

function visible(element) {
  return element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function textOf(element) {
  return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
}

async function waitFor(check, message, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(message);
}

function findImageInput() {
  const inputs = [...document.querySelectorAll('input[type="file"]')].filter((input) => !input.disabled);
  return inputs.find((input) => /image|png|jpg|jpeg|webp/i.test(input.accept || ""))
    || inputs.find((input) => !(input.accept || "").trim());
}

function showDraftStatus(message, failed = false) {
  if (!document.body?.appendChild || !document.createElement) return;
  let status = document.getElementById("contentloop-draft-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "contentloop-draft-status";
    status.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:10px;background:#fff;color:#222;border:1px solid #ddd;box-shadow:0 4px 18px #0002;font:14px/1.5 system-ui,sans-serif;";
    document.body.appendChild(status);
  }
  status.style.borderColor = failed ? "#e5484d" : "#ddd";
  status.textContent = message;
}

function findImageModeTab() {
  const controls = [...document.querySelectorAll('button,[role="tab"],[class*="creator-tab"]')].filter(visible);
  return controls.find((control) => /^(上传图文|图文笔记|发布图文|图文)$/.test(textOf(control))) || null;
}

async function selectImageMode() {
  const option = findImageModeTab() || await waitFor(() => findImageModeTab() || findImageInput(), "未找到小红书的“上传图文”选项，请在打开的页面手动切换");
  if (option.tagName !== "INPUT") option.click();
  return waitFor(findImageInput, "已切换到“上传图文”，但未找到图片上传控件；请检查小红书页面");
}

async function imageFiles(images) {
  const files = [];
  for (const image of images) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    if (blob.type !== "image/png" || !blob.size) throw new Error(`第 ${image.pageNo} 页 PNG 解码失败`);
    files.push(new File([blob], image.name, { type: "image/png" }));
  }
  return files;
}

function findTitleField() {
  const candidates = [...document.querySelectorAll('input:not([type="file"]),textarea')]
    .filter((element) => visible(element) && /标题/.test(`${element.placeholder || ""} ${element.getAttribute("aria-label") || ""}`));
  return candidates.length === 1 ? candidates[0] : null;
}

function findBodyField() {
  const candidates = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
    .filter((element) => visible(element) && /正文|内容|描述/.test(`${element.placeholder || ""} ${element.getAttribute("data-placeholder") || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("role") || ""}`));
  if (candidates.length === 1) return candidates[0];
  const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
  return editors.length === 1 ? editors[0] : null;
}

function setTextField(field, value) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const max = Number(field.maxLength);
    if (max > 0 && value.length > max) throw new Error(`小红书标题或正文超过输入框允许的 ${max} 字符，请返回 ContentLoop 调整`);
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    field.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, value)) {
      field.textContent = value;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
    selection.removeAllRanges();
  }
}

function uploadPreviewCount() {
  const selectors = [
    '[class*="upload"] img', '[class*="img-list"] img', '[class*="image-list"] img',
    '[class*="photo-list"] img', '[class*="preview"] img',
  ];
  const images = new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]));
  return [...images].filter((image) => visible(image) && image.naturalWidth > 0 && image.naturalHeight > 0).length;
}

function assignImages(input, files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function uploadImages(files) {
  let input = await selectImageMode();
  if (input.multiple) {
    assignImages(input, files);
    return;
  }
  assignImages(input, files.slice(0, 1));
  await waitFor(() => uploadPreviewCount() >= 1 || findTitleField(), "首张图片交给小红书后未进入图文编辑页；请检查已打开的页面");
  for (let index = 1; index < files.length; index += 1) {
    input = await waitFor(findImageInput, `第 ${index + 1} 张图片等待上传控件超时；请在小红书页面手动补齐`);
    if (input.multiple) {
      assignImages(input, files.slice(index));
      return;
    }
    await waitFor(() => uploadPreviewCount() >= index, `第 ${index} 张图片尚未出现在预览中；请在小红书页面检查`);
    assignImages(input, files.slice(index, index + 1));
  }
}

async function fillDraft(payload) {
  if (/\/login(?:[/?#]|$)/.test(location.pathname)) throw new Error("请先登录小红书创作服务平台");
  const files = await imageFiles(payload.images);
  await uploadImages(files);

  const title = await waitFor(findTitleField, "图片已交给小红书，但未找到唯一的标题输入框；请在打开的页面手动修改草稿");
  const body = await waitFor(findBodyField, "图片已交给小红书，但未找到正文编辑框；请在打开的页面手动修改草稿");
  setTextField(title, payload.title);
  setTextField(body, payload.body);
  await waitFor(() => {
    const current = findTitleField();
    return current && (current.value?.trim() === payload.title || textOf(current) === payload.title);
  },
    "标题填写未被页面接受；请在小红书页面手动填写");
  await waitFor(() => {
    const current = findBodyField();
    return current && (current.value?.trim() === payload.body || textOf(current) === payload.body);
  },
    "正文填写未被页面接受；请在小红书页面手动填写");
  await waitFor(() => uploadPreviewCount() >= 7,
    "没有确认七张图片全部出现在小红书预览中；请在打开的页面补齐图片并检查草稿", 45000);
  return { ok: true, status: "draft_ready", imageCount: 7 };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind === "contentloop-ping") {
    sendResponse({ ready: true });
    return;
  }
  if (message?.kind !== "contentloop-fill-draft") return;
  if (draftInProgress) {
    sendResponse({ ok: false, error: "已有一篇图文草稿正在填入" });
    return;
  }
  draftInProgress = true;
  showDraftStatus("ContentLoop 正在带入七张图片和文字，请稍候；不会自动发布。");
  fillDraft(message.payload)
    .then((result) => {
      showDraftStatus("ContentLoop 已带入七张图片和文字。请检查、删改后由你手动点击发布。");
      sendResponse(result);
    })
    .catch((error) => {
      showDraftStatus(`ContentLoop 自动带入未完成：${error.message}。当前页面已保留，请勿连续重试。`, true);
      sendResponse({ ok: false, error: error.message });
    })
    .finally(() => { draftInProgress = false; });
  return true;
});
