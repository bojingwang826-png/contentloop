import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { formatOcrResult, ocrEvidenceScore } from "../domain/ocr-layout.js";
import { refineOcrRegions } from "./ocr-refinement.js";

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
  let canvas;
  let phase = 0;
  try {
    // OCR uses the original, not the JPEG preview. Enlarge small text before segmentation.
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 24000000) throw new Error("图片像素过大，请裁剪为单页或局部后重试");
      const scale = Math.max(1, Math.min(3, 2400 / bitmap.width, Math.sqrt(12000000 / (bitmap.width * bitmap.height))));
      canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally { bitmap.close(); }
    worker = await createWorker("chi_sim", 1, {
      workerPath: localPath("../vendor/tesseract/worker.min.js"),
      corePath: localPath("../vendor/tesseract"),
      langPath: localPath("../assets/ocr"),
      logger(message) {
        const fraction = Number.isFinite(message?.progress) ? message.progress : 0;
        if (phase === 3) return;
        const progress = Math.round(phase === 0 ? fraction * 10 : phase === 1 ? 10 + fraction * 25 : 35 + fraction * 25);
        onProgress({ status: message?.status || "recognizing text", progress });
      },
    });
    phase = 1;
    await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1", user_defined_dpi: "300" });
    let result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    // Dense picture lists often defeat paragraph segmentation. A sparse pass is
    // bounded to one retry and selected by readable evidence, not text volume.
    if ((result.data?.confidence || 0) < 75 || !result.data?.text?.trim()) {
      phase = 2;
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      const alternative = await worker.recognize(canvas, {}, { text: true, blocks: true });
      if (ocrEvidenceScore(alternative.data) > ocrEvidenceScore(result.data)) result = alternative;
    }
    phase = 3;
    const refined = await refineOcrRegions(result.data, canvas.width, canvas.height, async (region) => {
      const crop = document.createElement("canvas");
      const { left, top, width, height } = region.rectangle;
      const scale = Math.min(3, Math.max(1, 60 / (region.vertical ? width : height)), 3000 / Math.max(width, height));
      const pad = 12;
      crop.width = Math.ceil(width * scale) + pad * 2;
      crop.height = Math.ceil(height * scale) + pad * 2;
      try {
        const context = crop.getContext("2d", { alpha: false });
        context.fillStyle = "#fff";
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(canvas, left, top, width, height, pad, pad, width * scale, height * scale);
        await worker.setParameters({ tessedit_pageseg_mode: region.vertical ? "6" : "7" });
        const original = (await worker.recognize(crop, {}, { text: true, blocks: true })).data;
        if (original.confidence >= 80) return original;
        // Local contrast is more useful than one threshold across a multicolour poster.
        const pixels = context.getImageData(pad, pad, crop.width - pad * 2, crop.height - pad * 2);
        let mean = 0;
        for (let p = 0; p < pixels.data.length; p += 4) mean += (pixels.data[p] + pixels.data[p + 1] + pixels.data[p + 2]) / 3;
        mean /= pixels.data.length / 4;
        for (let p = 0; p < pixels.data.length; p += 4) {
          let gray = pixels.data[p] * 0.299 + pixels.data[p + 1] * 0.587 + pixels.data[p + 2] * 0.114;
          if (mean < 110) gray = 255 - gray;
          gray = Math.max(0, Math.min(255, (gray - 128) * 1.4 + 128));
          pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = gray;
        }
        context.putImageData(pixels, pad, pad);
        const enhanced = (await worker.recognize(crop, {}, { text: true, blocks: true })).data;
        return ocrEvidenceScore(enhanced) > ocrEvidenceScore(original) ? enhanced : original;
      } finally { crop.width = 0; crop.height = 0; }
    }, (progress) => onProgress({ status: "refining regions", progress: Math.round(60 + progress * 39) }));
    onProgress({ status: "complete", progress: 100 });
    return formatOcrResult(refined);
  } finally {
    if (worker) await worker.terminate();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
