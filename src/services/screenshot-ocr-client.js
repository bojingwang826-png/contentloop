import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";

const { createWorker } = Tesseract;

function localPath(relative) {
  return new URL(relative, import.meta.url).href.replace(/\/$/, "");
}

export async function createLowResolutionPreview(file, { maxSide = 960, quality = 0.68 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export async function recognizeScreenshot(file, onProgress = () => {}) {
  let worker;
  try {
    worker = await createWorker("chi_sim", 1, {
      workerPath: localPath("../vendor/tesseract/worker.min.js"),
      corePath: localPath("../vendor/tesseract"),
      langPath: localPath("../assets/ocr"),
      logger(message) {
        const progress = Number.isFinite(message?.progress) ? Math.round(message.progress * 100) : 0;
        onProgress({ status: message?.status || "recognizing text", progress });
      },
    });
    const result = await worker.recognize(file);
    return {
      text: result?.data?.text || "",
      confidence: Math.max(0, Math.min(100, Math.round(result?.data?.confidence || 0))),
    };
  } finally {
    if (worker) await worker.terminate();
  }
}
