// Only normalize typography: never substitute a guessed hero name or number.
export function normalizeOcrText(value) {
  return String(value || "").replace(/\r/g, "")
    .replace(/(?<=[\p{Script=Han}])[ \t]+(?=[\p{Script=Han}])/gu, "")
    .replace(/[ \t]+/g, " ").trim();
}

export function readOcrLines(data) {
  const lines = (data?.blocks || []).flatMap((block) =>
    (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []));
  return (lines.length ? lines : String(data?.text || "").split("\n").map((text) => ({ text, confidence: data?.confidence || 0 })))
    .map((line) => ({ text: normalizeOcrText(line.text), confidence: Number(line.confidence) || 0, bbox: line.bbox }))
    .filter((line) => line.text);
}

export function ocrEvidenceScore(data) {
  return readOcrLines(data).reduce((sum, line) => sum + (line.confidence >= 55 ? Math.min(line.text.length, 120) * line.confidence / 100 : 0), 0);
}

export function formatOcrResult(data) {
  const lines = readOcrLines(data);
  const uncertain = lines.filter((line) => line.confidence < 55);
  const readable = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].confidence >= 55) { readable.push(lines[index].text); continue; }
    let count = 1;
    while (index + 1 < lines.length && lines[index + 1].confidence < 55) { count += 1; index += 1; }
    readable.push(`【待核对：${count} 行小字或图标无法可靠识别】`);
  }
  return {
    text: readable.join("\n"),
    rawText: lines.map((line) => line.text).join("\n"),
    title: lines.find((line) => line.confidence >= 70)?.text.slice(0, 80) || "",
    confidence: Math.round(Number(data?.confidence) || 0),
    uncertainLines: uncertain.length,
    lines,
  };
}

export function extractScreenshotSections(text) {
  const sections = [];
  for (const line of String(text || "").split("\n")) {
    const match = line.trim().match(/^(?:No\s*[.．]?\s*(\d+)|第\s*(\d+)\s*[名位]|(\d+)[、.．])\s*(.+)$/i);
    if (match) sections.push({ rank: Number(match[1] || match[2] || match[3]), title: match[4].trim(), lines: [] });
    else if (sections.length && line.trim()) sections.at(-1).lines.push(line.trim());
  }
  return sections;
}

export function removeConfirmedScreenshot(records, id) {
  return records.filter((record) => record.id !== id);
}

export function isScreenshotReviewReady(text) {
  return String(text || "").trim().length >= 4 && !String(text).includes("【待核对：");
}
