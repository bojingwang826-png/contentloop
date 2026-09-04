import { readOcrLines } from "../domain/ocr-layout.js";

export function planOcrRegions(data, width, height, limit = 16) {
  return readOcrLines(data).map((line, index) => ({ ...line, index }))
    .filter((line) => line.bbox && line.confidence < 88 && line.text.length >= 2)
    .sort((a, b) => b.text.length - a.text.length || a.index - b.index)
    .slice(0, limit).map((line) => {
      const box = line.bbox;
      const left = Math.max(0, Math.floor(box.x0 - 3));
      const top = Math.max(0, Math.floor(box.y0 - 3));
      const regionWidth = Math.min(width, Math.ceil(box.x1 + 3)) - left;
      const regionHeight = Math.min(height, Math.ceil(box.y1 + 3)) - top;
      return { ...line, vertical: regionHeight > regionWidth * 1.8,
        rectangle: { left, top, width: regionWidth, height: regionHeight } };
    }).filter((region) => region.rectangle.width > 0 && region.rectangle.height > 0);
}

// A second look at pixels, not a language-model rewrite of potentially wrong OCR.
export async function refineOcrRegions(data, width, height, recognizeRegion, onProgress = () => {}) {
  const lines = readOcrLines(data);
  const regions = planOcrRegions(data, width, height);
  let improved = 0;
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const result = await recognizeRegion(region);
    const candidates = readOcrLines(result);
    const text = candidates.map((line) => line.text).join(region.vertical ? "" : " ");
    const confidence = candidates.reduce((sum, line) => sum + line.confidence * line.text.length, 0)
      / Math.max(1, candidates.reduce((sum, line) => sum + line.text.length, 0));
    // Do not replace a full line with a tiny high-confidence fragment.
    if (text && text.length >= region.text.length * 0.55 && confidence >= Math.max(55, region.confidence + 8)) {
      lines[region.index] = { text, confidence, bbox: region.bbox };
      improved += 1;
    }
    onProgress((i + 1) / regions.length);
  }
  const confidence = lines.reduce((sum, line) => sum + line.confidence * line.text.length, 0)
    / Math.max(1, lines.reduce((sum, line) => sum + line.text.length, 0));
  return { ...data, confidence, blocks: [{ paragraphs: [{ lines }] }], improvedRegions: improved };
}
