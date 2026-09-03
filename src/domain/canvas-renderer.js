import {
  buildPageRenderModel,
  getAdaptiveTextDensity,
  getRulePageDensity,
  getIconSource,
  getIllustrationSource,
} from "./page-render.js";
import {
  assessExportAudit,
  createExportAudit,
  recordTextOverflow,
} from "./export-quality.js";

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1440;

const colors = {
  canvas: "#140d2b",
  surface: "#26183f",
  raised: "#35204d",
  border: "#6e557f",
  text: "#fff9ec",
  muted: "#d7cbe0",
  accent: "#f2c862",
  accentSoft: "#d7a944",
  cue: "#1e1434",
};

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRounded(ctx, x, y, width, height, radius, fill, stroke = "") {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function setFont(ctx, size, weight = 400) {
  ctx.font = `${weight} ${size}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
}

const forbiddenLineStart = new Set(Array.from(`，。！？；：、）》」』】〕〉…％%”’"'`));
const forbiddenLineEnd = new Set(Array.from("（《「『【〔〈“‘"));

export function splitText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const char of String(text || "")) {
    const candidate = line + char;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      // Chinese punctuation must stay with the preceding text. Let a closing
      // mark hang slightly outside the measure instead of placing it alone.
      if (forbiddenLineStart.has(char)) {
        line = candidate;
        continue;
      }
      // Opening brackets should travel with at least one following character.
      const tail = line.at(-1);
      if (tail && forbiddenLineEnd.has(tail) && line.length > 1) {
        lines.push(line.slice(0, -1));
        line = `${tail}${char}`;
        continue;
      }
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  ctx,
  text,
  x,
  y,
  maxWidth,
  lineHeight,
  maxLines = Infinity,
  audit = null,
  label = "文字",
) {
  const lines = splitText(ctx, text, maxWidth);
  recordTextOverflow(audit, label, lines.length, maxLines);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    let last = visible.at(-1);
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    visible[visible.length - 1] = `${last}…`;
  }
  visible.forEach((line, index) => ctx.fillText(line, x, y + (index * lineHeight)));
  return visible.length;
}

function getFittedTextLayout(ctx, text, maxWidth, maxHeight, options = {}) {
  const preferredSize = Number(options.preferredSize || 22);
  const minSize = Number(options.minSize || 14);
  const weight = Number(options.weight || 500);
  const lineFactor = Number(options.lineFactor || 1.35);
  const maxLines = Number(options.maxLines || Infinity);
  for (let size = preferredSize; size >= minSize; size -= 1) {
    setFont(ctx, size, weight);
    const lineHeight = Math.ceil(size * lineFactor);
    const lines = splitText(ctx, text, maxWidth);
    if (lines.length <= maxLines && (lines.length * lineHeight) <= maxHeight) {
      return { size, lineHeight, lines, overflow: false };
    }
  }
  setFont(ctx, minSize, weight);
  const lineHeight = Math.ceil(minSize * lineFactor);
  const allLines = splitText(ctx, text, maxWidth);
  const visibleLineCount = Math.max(1, Math.min(maxLines, Math.floor(maxHeight / lineHeight)));
  return {
    size: minSize,
    lineHeight,
    lines: allLines.slice(0, visibleLineCount),
    overflow: allLines.length > visibleLineCount,
    totalLines: allLines.length,
  };
}

function drawFittedText(ctx, text, x, y, maxWidth, maxHeight, options, audit, label) {
  const layout = getFittedTextLayout(ctx, text, maxWidth, maxHeight, options);
  setFont(ctx, layout.size, options.weight || 500);
  if (layout.overflow) recordTextOverflow(audit, label, layout.totalLines, layout.lines.length);
  layout.lines.forEach((line, index) => ctx.fillText(line, x, y + (index * layout.lineHeight)));
  return layout;
}

function drawVerticallyCenteredFittedText(ctx, text, x, boxY, maxWidth, boxHeight, options, audit, label) {
  const layout = getFittedTextLayout(ctx, text, maxWidth, boxHeight, options);
  setFont(ctx, layout.size, options.weight || 500);
  if (layout.overflow) recordTextOverflow(audit, label, layout.totalLines, layout.lines.length);
  const previousAlign = ctx.textAlign;
  const previousBaseline = ctx.textBaseline;
  ctx.textBaseline = "middle";
  const firstLineY = boxY + (boxHeight / 2) - (((layout.lines.length - 1) * layout.lineHeight) / 2);
  layout.lines.forEach((line, index) => ctx.fillText(line, x, firstLineY + (index * layout.lineHeight)));
  ctx.textAlign = previousAlign;
  ctx.textBaseline = previousBaseline;
  return layout;
}

function getAdaptiveTagLayout(ctx, text, maxWidth, maxHeight) {
  const density = getAdaptiveTextDensity(text);
  const preferredSize = density === "is-long" ? 22 : density === "is-medium" ? 25 : 28;
  const minSize = 17;
  for (let size = preferredSize; size >= minSize; size -= 1) {
    setFont(ctx, size, 700);
    const lines = splitText(ctx, text, maxWidth);
    const lineHeight = Math.round(size * 1.28);
    if (lines.length <= 2 && (lines.length * lineHeight) <= maxHeight) {
      return { size, lineHeight, lines };
    }
  }
  setFont(ctx, minSize, 700);
  return { size: minSize, lineHeight: 21, lines: splitText(ctx, text, maxWidth).slice(0, 2) };
}

function drawAdaptiveCoverTag(ctx, text, x, y, width, height, audit, index) {
  fillRounded(ctx, x, y, width, height, height / 2, "rgba(20,13,43,.74)", "rgba(242,200,98,.32)");
  const layout = getAdaptiveTagLayout(ctx, text, width - 40, height - 12);
  const allLines = splitText(ctx, text, width - 40);
  recordTextOverflow(audit, `封面标签 ${index + 1}`, allLines.length, 2);
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const totalHeight = layout.lines.length * layout.lineHeight;
  const firstLineY = y + (height / 2) - (totalHeight / 2) + (layout.lineHeight / 2);
  layout.lines.forEach((line, lineIndex) => {
    ctx.fillText(line, x + (width / 2), firstLineY + (lineIndex * layout.lineHeight));
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    if (/^https:\/\//i.test(String(src || ""))) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`页面图片加载失败：${src}`));
    image.src = new URL(src, document.baseURI).href;
  });
}

function iconNames(model) {
  if (model.type === "cover") return model.heroIcons;
  if (model.type === "tree") return model.items.flatMap((item) => [...item.ingredients, item.resultName]);
  if (model.type === "equipment") return model.items.map((item) => item.name);
  if (model.type === "rule") return model.items.map((item) => item.iconName).filter(Boolean);
  return [];
}

async function loadOfficialIcons(model, audit) {
  const names = [...new Set(iconNames(model).filter(Boolean))];
  audit.expectedIcons = names.length;
  const missing = names.filter((name) => !getIconSource(name));
  if (missing.length) throw new Error(`缺少官方图标：${missing.join("、")}`);
  const loaded = await Promise.all(names.map(async (name) => [name, await loadImage(getIconSource(name))]));
  audit.loadedIcons = loaded.length;
  return new Map(loaded);
}

async function loadPageAssets(model, audit) {
  const images = await loadOfficialIcons(model, audit);
  if (model.visual) {
    const source = model.visual.source || getIllustrationSource(model.visual.name);
    if (!source) throw new Error(`缺少页面配图：${model.visual.name}`);
    images.set(`illustration:${model.visual.name}`, await loadImage(source));
  }
  const remoteSources = [...new Set([
    ...(model.heroEntities || []).map((item) => item.imageUrl),
    ...(model.items || []).map((item) => item.imageUrl),
  ].filter(Boolean))];
  const remoteImages = await Promise.all(remoteSources.map(async (source) => [source, await loadImage(source)]));
  remoteImages.forEach(([source, image]) => images.set(`remote:${source}`, image));
  return images;
}

function drawIcon(ctx, image, x, y, size, radius = 18) {
  fillRounded(ctx, x, y, size, size, radius, "#0d0a18", colors.accentSoft);
  ctx.save();
  roundedPath(ctx, x + 4, y + 4, size - 8, size - 8, Math.max(8, radius - 4));
  ctx.clip();
  ctx.drawImage(image, x + 4, y + 4, size - 8, size - 8);
  ctx.restore();
}

function drawIllustration(ctx, image, x, y, width, height, radius = 28, fit = "cover") {
  fillRounded(ctx, x, y, width, height, radius, colors.surface, "rgba(242,200,98,.28)");
  const contain = fit === "contain" || fit === "smart";
  const scale = contain
    ? Math.min((width - 20) / image.naturalWidth, (height - 20) / image.naturalHeight)
    : Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.save();
  roundedPath(ctx, x + 3, y + 3, width - 6, height - 6, Math.max(12, radius - 3));
  ctx.clip();
  if (contain) {
    const backdropScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const backdropWidth = image.naturalWidth * backdropScale;
    const backdropHeight = image.naturalHeight * backdropScale;
    ctx.save();
    ctx.filter = "blur(18px) saturate(.82) brightness(.58)";
    ctx.globalAlpha = 0.82;
    ctx.drawImage(image, x + ((width - backdropWidth) / 2), y + ((height - backdropHeight) / 2), backdropWidth, backdropHeight);
    ctx.restore();
    ctx.fillStyle = "rgba(18,10,42,.24)";
    ctx.fillRect(x, y, width, height);
  }
  ctx.drawImage(image, x + ((width - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
  const shade = ctx.createLinearGradient(x, y, x, y + height);
  shade.addColorStop(0, "rgba(20,13,43,.02)");
  shade.addColorStop(1, "rgba(20,13,43,.30)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawLineupBanner(ctx, entities, images, x, y, width, height, audit) {
  const lineup = entities.filter((entity) => images.get(`remote:${entity.imageUrl}`)).slice(0, 3);
  if (lineup.length < 2) return false;
  fillRounded(ctx, x, y, width, height, 28, colors.surface, "rgba(242,200,98,.30)");
  ctx.save();
  roundedPath(ctx, x + 3, y + 3, width - 6, height - 6, 25);
  ctx.clip();
  const tileWidth = width / lineup.length;
  lineup.forEach((entity, index) => {
    const image = images.get(`remote:${entity.imageUrl}`);
    const scale = Math.max(tileWidth / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const tileX = x + (index * tileWidth);
    ctx.drawImage(image, tileX + ((tileWidth - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
    if (index) {
      ctx.fillStyle = "rgba(242,200,98,.28)";
      ctx.fillRect(tileX - 1, y, 2, height);
    }
    const shade = ctx.createLinearGradient(0, y + (height * 0.48), 0, y + height);
    shade.addColorStop(0, "rgba(13,10,24,0)");
    shade.addColorStop(1, "rgba(13,10,24,.88)");
    ctx.fillStyle = shade;
    ctx.fillRect(tileX, y, tileWidth, height);
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    drawFittedText(ctx, entity.name, tileX + (tileWidth / 2), y + height - 24, tileWidth - 20, 28, {
      preferredSize: 18, minSize: 14, weight: 800, lineFactor: 1.1, maxLines: 1,
    }, audit, `阵容组合图 ${index + 1}`);
  });
  ctx.restore();
  ctx.textAlign = "left";
  return true;
}

function drawHeroPortrait(ctx, images, entity, x, y, size, audit, label = "英雄") {
  const image = images.get(`remote:${entity.imageUrl}`);
  if (!image) {
    recordTextOverflow(audit, `${label}头像`, 2, 1);
    return;
  }
  drawIcon(ctx, image, x, y, size, Math.round(size * 0.2));
}

function drawHeroStrip(ctx, entities, images, x, y, width, height, audit) {
  const list = entities;
  if (!list.length) return;
  const columnCount = Math.min(5, Math.max(1, Math.ceil(list.length / Math.ceil(list.length / 5))));
  const rows = Array.from({ length: Math.ceil(list.length / columnCount) }, (_, index) => (
    list.slice(index * columnCount, (index + 1) * columnCount)
  ));
  const rowHeight = height / rows.length;
  rows.forEach((row, rowIndex) => {
    const gap = rows.length >= 3 ? 14 : 24;
    const portrait = Math.max(54, Math.min(92, Math.floor(rowHeight - 46), Math.floor((width - ((row.length - 1) * gap)) / row.length)));
    const rowWidth = (row.length * portrait) + (Math.max(0, row.length - 1) * gap);
    const startX = x + ((width - rowWidth) / 2);
    const rowY = y + (rowIndex * rowHeight) + Math.max(4, (rowHeight - portrait - 30) / 2);
    row.forEach((entity, index) => {
      const px = startX + (index * (portrait + gap));
      drawHeroPortrait(ctx, images, entity, px, rowY, portrait, audit);
      ctx.fillStyle = colors.text;
      ctx.textAlign = "center";
      drawFittedText(ctx, entity.name, px + (portrait / 2), rowY + portrait + 24, portrait + 18, 26, {
        preferredSize: rows.length >= 3 ? 15 : 19, minSize: 12, weight: 700, lineFactor: 1.12, maxLines: 1,
      }, audit, `${entity.name}名称`);
      ctx.textAlign = "left";
    });
  });
}

function drawCoverHeroCollage(ctx, entities, images, x, y, width, height, audit) {
  const list = entities.filter((entity) => images.get(`remote:${entity.imageUrl}`));
  if (!list.length) return false;
  fillRounded(ctx, x, y, width, height, 26, colors.surface, "rgba(242,200,98,.28)");
  ctx.save();
  roundedPath(ctx, x + 3, y + 3, width - 6, height - 6, 23);
  ctx.clip();

  const backdrop = list.slice(0, Math.min(4, list.length));
  const tileWidth = width / backdrop.length;
  ctx.save();
  ctx.filter = "blur(22px) saturate(.9) brightness(.58)";
  ctx.globalAlpha = 0.92;
  backdrop.forEach((entity, index) => {
    const image = images.get(`remote:${entity.imageUrl}`);
    const scale = Math.max((tileWidth + 48) / image.naturalWidth, (height + 48) / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const tileX = x + (index * tileWidth);
    ctx.drawImage(image, tileX + ((tileWidth - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
  });
  ctx.restore();
  const shade = ctx.createLinearGradient(x, y, x, y + height);
  shade.addColorStop(0, "rgba(18,10,42,.28)");
  shade.addColorStop(1, "rgba(18,10,42,.84)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);

  if (list.length === 1) {
    const image = images.get(`remote:${list[0].imageUrl}`);
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + ((width - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
    const singleShade = ctx.createLinearGradient(0, y + (height * 0.42), 0, y + height);
    singleShade.addColorStop(0, "rgba(13,10,24,0)");
    singleShade.addColorStop(1, "rgba(13,10,24,.92)");
    ctx.fillStyle = singleShade;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    setFont(ctx, 28, 800);
    ctx.fillText(list[0].name, x + (width / 2), y + height - 30);
    ctx.textAlign = "left";
    ctx.restore();
    return true;
  }

  const rows = list.length <= 5
    ? [list]
    : [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const portrait = Math.max(64, Math.min(rows.length === 1 ? 112 : 94, Math.floor((width - 90) / maxColumns) - 14));
  const rowGap = rows.length === 1 ? 0 : 24;
  const blockHeight = (rows.length * (portrait + 30)) + rowGap;
  const startY = y + ((height - blockHeight) / 2);
  rows.forEach((row, rowIndex) => {
    const gap = Math.max(14, Math.min(30, (width - (row.length * portrait) - 64) / Math.max(1, row.length - 1)));
    const rowWidth = (row.length * portrait) + (Math.max(0, row.length - 1) * gap);
    const stagger = rows.length > 1 && rowIndex === 1 ? Math.min(22, (width - rowWidth) / 4) : 0;
    const startX = x + ((width - rowWidth) / 2) + stagger;
    row.forEach((entity, index) => {
      const px = startX + (index * (portrait + gap));
      const py = startY + (rowIndex * (portrait + 30 + rowGap)) + ((index % 2) * 8);
      ctx.save();
      ctx.shadowColor = "rgba(7,4,18,.55)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      drawHeroPortrait(ctx, images, entity, px, py, portrait, audit, "封面英雄");
      ctx.restore();
      ctx.fillStyle = colors.text;
      ctx.textAlign = "center";
      drawFittedText(ctx, entity.name, px + (portrait / 2), py + portrait + 23, portrait + 28, 25, {
        preferredSize: 17, minSize: 12, weight: 800, lineFactor: 1.1, maxLines: 1,
      }, audit, `${entity.name}封面名称`);
      ctx.textAlign = "left";
    });
  });
  ctx.restore();
  return true;
}

function contentVisualFit(model) {
  if (model.heroEntities?.length === 1) return "cover";
  return model.visual?.kind === "official" ? "smart" : "cover";
}

function drawBackground(ctx, model) {
  const gradient = ctx.createLinearGradient(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  gradient.addColorStop(0, model.type === "cover" ? "#120a2c" : colors.canvas);
  gradient.addColorStop(0.62, "#34204e");
  gradient.addColorStop(1, model.type === "cover" ? "#72335e" : "#5a2a61");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

  const glow = ctx.createRadialGradient(890, 190, 20, 890, 190, 420);
  glow.addColorStop(0, "rgba(242,200,98,.20)");
  glow.addColorStop(1, "rgba(242,200,98,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, EXPORT_WIDTH, 650);

  ctx.strokeStyle = "rgba(242,200,98,.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(980, 80, 250, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHeader(ctx, model) {
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.accent;
  setFont(ctx, 27, 700);
  ctx.fillText(model.kicker, 64, 84);
  ctx.textAlign = "right";
  ctx.fillStyle = colors.muted;
  setFont(ctx, 25, 500);
  ctx.fillText(`@${model.accountName}`, 1016, 84);
  ctx.textAlign = "left";
}

export function calculateTitleBodyTop(compact, titleLineCount, subtitleLineCount, subtitleLineHeight = 43) {
  const titleStart = compact ? 182 : 220;
  const titleBottom = titleStart + ((titleLineCount - 1) * 78);
  return titleBottom + 58 + (subtitleLineCount * subtitleLineHeight);
}

export function getTitleTextLayout(compact) {
  return {
    x: 64,
    y: compact ? 182 : 220,
    maxWidth: 952,
    lineHeight: 78,
    maxLines: 2,
  };
}

function drawTitle(ctx, model, compact = false, audit = null) {
  ctx.fillStyle = colors.text;
  setFont(ctx, compact ? 54 : 66, 800);
  const titleLayout = getTitleTextLayout(compact);
  const titleLineCount = drawWrappedText(
    ctx,
    model.title,
    titleLayout.x,
    titleLayout.y,
    titleLayout.maxWidth,
    titleLayout.lineHeight,
    titleLayout.maxLines,
    audit,
    "主标题",
  );
  const titleBottom = (compact ? 182 : 220) + ((titleLineCount - 1) * 78);
  ctx.fillStyle = colors.muted;
  const subtitleLayout = drawFittedText(
    ctx,
    model.subtitle,
    64,
    titleBottom + 58,
    952,
    compact ? 174 : 168,
    {
      preferredSize: compact ? 28 : 31,
      minSize: 16,
      weight: 500,
      lineFactor: 1.38,
      maxLines: 8,
    },
    audit,
    "副标题",
  );
  const bodyTop = calculateTitleBodyTop(compact, titleLineCount, subtitleLayout.lines.length, subtitleLayout.lineHeight) + 8;
  if (audit) audit.bodyTop = bodyTop;
  return bodyTop;
}

function drawFooter(ctx, model) {
  ctx.strokeStyle = "rgba(242,200,98,.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 1352);
  ctx.lineTo(1016, 1352);
  ctx.stroke();
  ctx.fillStyle = colors.muted;
  setFont(ctx, 24, 600);
  ctx.fillText(model.seriesName, 64, 1395);
  ctx.textAlign = "right";
  ctx.fillStyle = colors.accent;
  setFont(ctx, 28, 800);
  ctx.fillText(`${model.pageNo}/${model.totalPages}`, 1016, 1395);
  ctx.textAlign = "left";
}

export function getBalancedCoverTagLayout(itemCount, options = {}) {
  const count = Math.max(0, Math.min(4, Number(itemCount) || 0));
  if (!count) return [];
  const left = Number(options.left ?? 64);
  const top = Number(options.top ?? 970);
  const width = Number(options.width ?? 952);
  const areaHeight = Number(options.areaHeight ?? 130);
  const gap = Number(options.gap ?? 12);
  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const itemWidth = (width - ((columns - 1) * gap)) / columns;
  const itemHeight = rows === 1 ? 64 : 56;
  const contentHeight = (rows * itemHeight) + ((rows - 1) * gap);
  const startY = top + ((areaHeight - contentHeight) / 2);

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const isCenteredOddLast = columns === 2 && count % 2 === 1 && index === count - 1;
    const column = index % columns;
    return {
      x: isCenteredOddLast
        ? left + ((width - itemWidth) / 2)
        : left + (column * (itemWidth + gap)),
      y: startY + (row * (itemHeight + gap)),
      width: itemWidth,
      height: itemHeight,
    };
  });
}

function drawCover(ctx, model, images, audit) {
  drawTitle(ctx, model, false, audit);
  const cardY = 565;
  fillRounded(ctx, 64, cardY, 952, 375, 36, "rgba(38,24,63,.74)", "rgba(242,200,98,.28)");
  if (model.heroEntities?.length) {
    drawCoverHeroCollage(ctx, model.heroEntities, images, 82, cardY + 18, 916, 339, audit);
  } else if (model.visual) {
    drawIllustration(ctx, images.get(`illustration:${model.visual.name}`), 82, cardY + 18, 916, 339, 26, model.visual.kind === "official" ? "contain" : "cover");
  } else {
    const size = 136;
    model.heroIcons.forEach((name, index) => {
      const x = 104 + (index * 178);
      const y = cardY + 72 + ((index % 2) * 26);
      drawIcon(ctx, images.get(name), x, y, size, 26);
    });
    ctx.fillStyle = colors.accent;
    setFont(ctx, 30, 700);
    ctx.fillText("先认散件，再理解功能", 292, cardY + 325);
  }

  const tagItems = model.items.slice(0, 4);
  const tagLayout = getBalancedCoverTagLayout(tagItems.length);
  tagItems.forEach((item, index) => {
    const slot = tagLayout[index];
    drawAdaptiveCoverTag(
      ctx,
      item,
      slot.x,
      slot.y,
      slot.width,
      slot.height,
      audit,
      index,
    );
  });
  if (model.items.length > 4) recordTextOverflow(audit, "封面标签数量", model.items.length, 4);

  fillRounded(ctx, 64, 1120, 952, 126, 28, "rgba(242,200,98,.12)", "rgba(242,200,98,.32)");
  ctx.fillStyle = colors.accent;
  setFont(ctx, 31, 800);
  ctx.fillText("收藏后对局随时查，不要求一次背完", 104, 1195);
  audit.drawnBlocks = 1;
  audit.contentBottom = 1246;
}

function drawRecipeCard(ctx, item, images, x, y, width, height, audit, itemIndex) {
  fillRounded(ctx, x, y, width, height, 24, "rgba(38,24,63,.88)", "rgba(242,200,98,.20)");
  const ingredientSize = 58;
  const resultSize = 72;
  const startX = x + 18;
  item.ingredients.slice(0, 2).forEach((name, index) => {
    drawIcon(ctx, images.get(name), startX + (index * 78), y + 25, ingredientSize, 14);
    if (index === 0) {
      ctx.fillStyle = colors.accent;
      setFont(ctx, 31, 700);
      ctx.fillText("+", startX + 60, y + 64);
    }
  });
  ctx.fillStyle = colors.accent;
  setFont(ctx, 31, 700);
  ctx.fillText("=", x + 164, y + 65);
  drawIcon(ctx, images.get(item.resultName), x + 198, y + 18, resultSize, 17);
  ctx.fillStyle = colors.text;
  setFont(ctx, 24, 800);
  drawWrappedText(ctx, item.resultName, x + 286, y + 53, width - 304, 32, 2, audit, `配方 ${itemIndex + 1} 装备名`);
  ctx.fillStyle = colors.muted;
  setFont(ctx, 21, 500);
  drawWrappedText(ctx, item.recipe, x + 22, y + 132, width - 44, 31, 2, audit, `配方 ${itemIndex + 1} 合成路径`);
}

function drawTree(ctx, model, images, audit) {
  const bodyTop = drawTitle(ctx, model, true, audit) + 22;
  const gap = 18;
  const width = 467;
  const height = 210;
  model.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    drawRecipeCard(ctx, item, images, 64 + (column * (width + gap)), bodyTop + (row * (height + gap)), width, height, audit, index);
  });
  const rows = Math.ceil(model.items.length / 2);
  audit.drawnBlocks = model.items.length;
  audit.contentBottom = bodyTop + (rows * height) + (Math.max(0, rows - 1) * gap);
}

export function getEquipmentPageLayout(bodyTop, itemCount, options = {}) {
  const count = Math.max(1, Number(itemCount) || 1);
  const contentBottom = Number(options.contentBottom ?? 1324);
  const gap = Number(options.gap ?? 18);
  const preferredHeight = Number(options.preferredHeight ?? 310);
  const availableHeight = contentBottom - bodyTop - (Math.max(0, count - 1) * gap);
  const height = Math.max(220, Math.min(preferredHeight, Math.floor(availableHeight / count)));
  return {
    gap,
    height,
    contentBottom: bodyTop + (count * height) + (Math.max(0, count - 1) * gap),
  };
}

export function getEquipmentCardTextLayout(height) {
  const cardHeight = Math.max(220, Number(height) || 220);
  const headerBottom = 126;
  const headerGap = 16;
  const cueHeight = Math.max(62, Math.min(68, Math.round(cardHeight * 0.21)));
  const cueBottom = cardHeight - 12;
  const cueTop = cueBottom - cueHeight;
  const detailTop = headerBottom + headerGap + 24;
  const sectionGap = 14;
  const detailBottom = cueTop - sectionGap;
  return {
    headerBottom,
    headerGap,
    detailTop,
    detailHeight: Math.max(24, detailBottom - detailTop),
    sectionGap,
    cueTop,
    cueHeight,
    cueBottom,
  };
}

function drawEquipmentCard(ctx, item, image, x, y, width, height, audit, itemIndex) {
  const textLayout = getEquipmentCardTextLayout(height);
  fillRounded(ctx, x, y, width, height, 28, "rgba(38,24,63,.90)", "rgba(242,200,98,.20)");
  drawIcon(ctx, image, x + 28, y + 24, 102, 22);
  ctx.fillStyle = colors.text;
  setFont(ctx, 32, 800);
  ctx.fillText(item.name, x + 154, y + 62);
  setFont(ctx, 22, 700);
  const tagWidth = Math.min(210, ctx.measureText(item.tag).width + 38);
  fillRounded(ctx, x + 154, y + 77, tagWidth, 44, 22, "rgba(242,200,98,.16)", "rgba(242,200,98,.35)");
  ctx.fillStyle = colors.accent;
  ctx.fillText(item.tag, x + 173, y + 108);
  ctx.fillStyle = colors.muted;
  setFont(ctx, 22, 500);
  drawFittedText(ctx, item.recipe, x + 386, y + 107, width - 414, 34, {
    preferredSize: 22,
    minSize: 18,
    weight: 500,
    lineFactor: 1.2,
    maxLines: 1,
  }, audit, `${item.name}合成路径`);

  ctx.fillStyle = colors.text;
  drawFittedText(ctx, item.detail, x + 28, y + textLayout.detailTop, width - 56, textLayout.detailHeight, {
    preferredSize: 27,
    minSize: 18,
    weight: 500,
    lineFactor: 1.28,
    maxLines: 2,
  }, audit, `${item.name}适用场景`);

  fillRounded(ctx, x + 28, y + textLayout.cueTop, width - 56, textLayout.cueHeight, 18, colors.cue, "rgba(242,200,98,.18)");
  ctx.fillStyle = colors.accent;
  setFont(ctx, 22, 700);
  ctx.textBaseline = "middle";
  ctx.fillText("怎么选", x + 48, y + textLayout.cueTop + (textLayout.cueHeight / 2));
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.muted;
  drawVerticallyCenteredFittedText(ctx, item.cue, x + 146, y + textLayout.cueTop + 8, width - 194, textLayout.cueHeight - 16, {
    preferredSize: 23,
    minSize: 18,
    weight: 500,
    lineFactor: 1.25,
    maxLines: 2,
  }, audit, `${item.name}选择判断`);
}

export function getRuleGridLayout(bodyTop, items, options = {}) {
  const list = Array.isArray(items) && items.length ? items : [{}];
  const gap = Number(options.gap ?? 18);
  const contentLimit = Number(options.contentLimit ?? 1318);
  const rows = Math.max(1, Math.ceil(list.length / 2));
  const rowSlot = Math.max(230, Math.floor((contentLimit - bodyTop - ((rows - 1) * gap)) / rows));
  const cards = [];
  for (let row = 0; row < rows; row += 1) {
    const rowItems = list.slice(row * 2, (row * 2) + 2);
    rowItems.forEach((item, column) => {
      cards.push({
        index: (row * 2) + column,
        row,
        column,
        y: bodyTop + (row * (rowSlot + gap)),
        height: rowSlot,
      });
    });
  }
  return {
    gap,
    rowSlot,
    cards,
    contentBottom: Math.max(...cards.map((card) => card.y + card.height)),
  };
}

function drawEquipment(ctx, model, images, audit) {
  const bodyTop = drawTitle(ctx, model, true, audit) + 18;
  const layout = getEquipmentPageLayout(bodyTop, model.items.length);
  model.items.forEach((item, index) => {
    drawEquipmentCard(ctx, item, images.get(item.name), 64, bodyTop + (index * (layout.height + layout.gap)), 952, layout.height, audit, index);
  });
  audit.drawnBlocks = model.items.length;
  audit.contentBottom = layout.contentBottom;
}

function drawRuleCard(ctx, item, images, x, y, width, height, audit, index, density = "standard") {
    const dense = density !== "standard";
    const ultra = density === "ultra";
    const padding = ultra ? 16 : dense ? 18 : 24;
    const markerSize = ultra ? 50 : dense ? 56 : 70;
    const itemImage = item.imageUrl ? images.get(`remote:${item.imageUrl}`) : null;
    const markerRadius = item.iconName || itemImage ? Math.round(markerSize * 0.24) : markerSize / 2;
    fillRounded(ctx, x, y, width, height, 28, "rgba(38,24,63,.90)", "rgba(242,200,98,.20)");
    if (itemImage) {
      drawIcon(ctx, itemImage, x + padding, y + padding, markerSize, markerRadius);
    } else if (item.iconName && images.get(item.iconName)) {
      drawIcon(ctx, images.get(item.iconName), x + padding, y + padding, markerSize, markerRadius);
    } else {
      fillRounded(ctx, x + padding, y + padding, markerSize, markerSize, markerSize / 2, "rgba(242,200,98,.16)", "rgba(242,200,98,.40)");
      ctx.fillStyle = colors.accent;
      setFont(ctx, ultra ? 24 : dense ? 26 : 29, 800);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(item.number).padStart(2, "0"), x + padding + (markerSize / 2), y + padding + (markerSize / 2));
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    const titleX = x + padding + markerSize + (ultra ? 14 : 18);
    const titleY = y + padding + (ultra ? 25 : dense ? 28 : 33);
    const titleHeight = ultra ? 86 : dense ? 92 : 100;
    ctx.fillStyle = colors.text;
    const titleLayout = drawFittedText(ctx, item.name, titleX, titleY, x + width - padding - titleX, titleHeight, {
      preferredSize: ultra ? 28 : dense ? 29 : 30,
      minSize: 21,
      weight: 800,
      lineFactor: 1.2,
      maxLines: 3,
    }, audit, `步骤 ${index + 1} 标题`);

    const cueHeight = item.example
      ? (ultra ? 94 : dense ? 100 : 108)
      : 0;
    const cueY = cueHeight ? y + height - cueHeight - padding : y + height - padding;
    const markerBottom = y + padding + markerSize;
    const titleBottom = titleY
      + ((Math.max(1, titleLayout.lines.length) - 1) * titleLayout.lineHeight)
      + Math.ceil(titleLayout.size * 0.32);
    const detailY = Math.max(markerBottom, titleBottom) + (ultra ? 22 : 26);
    const detailHeight = Math.max(42, cueY - detailY - (cueHeight ? 14 : 0));
    ctx.fillStyle = colors.muted;
    drawFittedText(ctx, item.detail, x + padding, detailY, width - (padding * 2), detailHeight, {
      preferredSize: ultra ? 23 : dense ? 24 : 25,
      minSize: ultra ? 23 : dense ? 24 : 25,
      weight: 500,
      lineFactor: 1.32,
      maxLines: Infinity,
    }, audit, `步骤 ${index + 1} 解释`);

    if (cueHeight) {
      fillRounded(ctx, x + padding, cueY, width - (padding * 2), cueHeight, 18, colors.cue, "rgba(242,200,98,.16)");
      ctx.fillStyle = colors.accent;
      const cueInset = ultra ? 14 : 18;
      drawVerticallyCenteredFittedText(ctx, item.example, x + padding + cueInset, cueY + 9, width - ((padding + cueInset) * 2), cueHeight - 18, {
        preferredSize: ultra ? 21 : dense ? 22 : 23,
        minSize: ultra ? 21 : dense ? 22 : 23,
        weight: 600,
        lineFactor: 1.28,
        maxLines: Infinity,
      }, audit, `步骤 ${index + 1} 提醒`);
    }
}

function drawRosterCard(ctx, item, images, x, y, width, height, audit, index) {
  fillRounded(ctx, x, y, width, height, 25, "rgba(38,24,63,.90)", "rgba(242,200,98,.22)");
  const compact = height < 300;
  const portraitSize = compact ? Math.max(48, Math.min(62, height - 74)) : 84;
  const inset = compact ? 14 : 22;
  const copyX = x + inset + portraitSize + (compact ? 14 : 20);
  drawHeroPortrait(ctx, images, item, x + inset, y + inset, portraitSize, audit);
  ctx.fillStyle = colors.text;
  drawFittedText(ctx, item.name, copyX, y + (compact ? 34 : 50), x + width - copyX - 20, compact ? 32 : 48, {
    preferredSize: compact ? 21 : 28, minSize: 16, weight: 800, lineFactor: 1.15, maxLines: 1,
  }, audit, `成员 ${index + 1} 名称`);
  ctx.fillStyle = colors.accent;
  setFont(ctx, compact ? 16 : 20, 700);
  ctx.fillText(`${item.cost || "?"}费 · ${item.positionLabel}`, copyX, y + (compact ? 61 : 88));
  ctx.fillStyle = colors.muted;
  const detailTop = y + (compact ? 82 : 132);
  const detail = compact ? (item.traits.join(" / ") || item.detail) : item.detail || item.traits.join(" / ");
  drawFittedText(ctx, detail, x + inset, detailTop, width - (inset * 2), Math.max(24, height - (compact ? 92 : 146)), {
    preferredSize: compact ? 18 : 23, minSize: compact ? 18 : 23, weight: 500, lineFactor: 1.3, maxLines: Infinity,
  }, audit, `成员 ${index + 1} 羁绊`);
}

export function getRosterGridLayout(bodyTop, count) {
  const safeCount = Math.max(1, Number(count) || 1);
  const rows = Math.ceil(safeCount / 2);
  const gap = 16;
  const available = 1318 - bodyTop;
  const cardHeight = Math.floor((available - ((rows - 1) * gap)) / rows);
  return {
    rows,
    gap,
    cardHeight,
    contentBottom: bodyTop + (rows * cardHeight) + (Math.max(0, rows - 1) * gap),
  };
}

function drawRoster(ctx, model, images, audit) {
  const bodyTop = drawTitle(ctx, model, true, audit) + 18;
  const count = model.items.length;
  const { rows, gap, cardHeight, contentBottom } = getRosterGridLayout(bodyTop, count);
  const width = 467;
  model.items.forEach((item, index) => {
    const isOddLast = count % 2 === 1 && index === count - 1;
    const x = isOddLast ? 306.5 : 64 + ((index % 2) * (width + gap));
    const y = bodyTop + (Math.floor(index / 2) * (cardHeight + gap));
    drawRosterCard(ctx, item, images, x, y, width, cardHeight, audit, index);
  });
  audit.drawnBlocks = model.items.length;
  audit.contentBottom = contentBottom;
}

function hexPath(ctx, cx, cy, radius) {
  ctx.beginPath();
  for (let side = 0; side < 6; side += 1) {
    const angle = ((Math.PI / 3) * side) - (Math.PI / 6);
    const px = cx + (radius * Math.cos(angle));
    const py = cy + (radius * Math.sin(angle));
    if (side === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function fallbackBoardSlot(item, index) {
  const byPosition = {
    front: [{ row: 0, col: 2 }, { row: 0, col: 4 }, { row: 1, col: 1 }, { row: 1, col: 5 }],
    flex: [{ row: 1, col: 3 }, { row: 2, col: 2 }, { row: 2, col: 4 }],
    back: [{ row: 3, col: 1 }, { row: 3, col: 5 }, { row: 3, col: 3 }, { row: 2, col: 6 }],
  };
  const list = byPosition[item.position] || byPosition.flex;
  return list[index % list.length];
}

function drawBoard(ctx, model, images, audit) {
  const bodyTop = drawTitle(ctx, model, true, audit) + 18;
  const panelHeight = 604;
  fillRounded(ctx, 64, bodyTop, 952, panelHeight, 34, "rgba(23,15,48,.84)", "rgba(242,200,98,.30)");
  const radius = 53;
  const xStep = 118;
  const yStep = 124;
  const startX = 174;
  const startY = bodyTop + 82;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const cx = startX + (col * xStep) + ((row % 2) * (xStep / 2));
      const cy = startY + (row * yStep);
      hexPath(ctx, cx, cy, radius);
      ctx.fillStyle = row < 2 ? "rgba(242,200,98,.055)" : "rgba(130,109,191,.09)";
      ctx.fill();
      ctx.strokeStyle = "rgba(242,200,98,.24)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  const occupied = new Set();
  model.items.slice(0, 28).forEach((item, index) => {
    let slot = item.boardSlot || fallbackBoardSlot(item, index);
    while (occupied.has(`${slot.row}:${slot.col}`)) slot = { row: (slot.row + 1) % 4, col: (slot.col + 2) % 7 };
    occupied.add(`${slot.row}:${slot.col}`);
    const cx = startX + (slot.col * xStep) + ((slot.row % 2) * (xStep / 2));
    const cy = startY + (slot.row * yStep);
    const image = images.get(`remote:${item.imageUrl}`);
    if (image) {
      ctx.save();
      hexPath(ctx, cx, cy - 5, radius - 5);
      ctx.clip();
      ctx.drawImage(image, cx - radius + 5, cy - radius, (radius - 5) * 2, (radius - 5) * 2);
      ctx.restore();
    }
    hexPath(ctx, cx, cy - 5, radius - 4);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    fillRounded(ctx, cx - 50, cy + 31, 100, 28, 12, "rgba(13,10,24,.88)", "rgba(242,200,98,.34)");
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    setFont(ctx, 14, 800);
    ctx.fillText(item.name.slice(0, 6), cx, cy + 51);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = colors.accent;
  setFont(ctx, 18, 700);
  ctx.fillText("敌方侧", 86, startY - 4);
  ctx.fillText("我方侧", 86, startY + (3 * yStep) + 8);
  const tipY = bodyTop + panelHeight + 18;
  fillRounded(ctx, 64, tipY, 952, 146, 24, "rgba(242,200,98,.12)", "rgba(242,200,98,.28)");
  ctx.fillStyle = colors.accent;
  setFont(ctx, 24, 800);
  ctx.fillText("实战调整", 90, tipY + 45);
  ctx.fillStyle = colors.muted;
  drawFittedText(ctx, "英雄已放入 4×7 真实棋盘格。先按当前赛季职责排基础位置，再参考公开攻略的站位思路；遇到切后排、范围伤害或同侧集火时，优先让主输出换边，再调整前排保护关系。", 90, tipY + 76, 884, 58, {
    preferredSize: 23, minSize: 18, weight: 500, lineFactor: 1.28, maxLines: 2,
  }, audit, "站位实战调整");
  audit.drawnBlocks = model.items.length;
  audit.contentBottom = tipY + 146;
}

export function getSideRuleLayout(bodyTop, count) {
  const safeCount = Math.max(1, Math.min(4, Number(count) || 1));
  const gap = 14;
  const panelHeight = Math.max(0, 1298 - bodyTop);
  const cardHeight = Math.floor((panelHeight - ((safeCount - 1) * gap)) / safeCount);
  return {
    panelHeight,
    gap,
    cardHeight,
    markerBottom: 72,
    detailTop: 100,
    detailHeight: Math.max(0, cardHeight - 108),
    contentBottom: bodyTop + panelHeight,
  };
}

function drawSideRule(ctx, model, images, audit) {
  const bodyTop = drawTitle(ctx, model, true, audit) + 20;
  const count = Math.min(4, model.items.length);
  const layout = getSideRuleLayout(bodyTop, count);
  const { panelHeight, gap, cardHeight } = layout;
  const hasVisual = Boolean(model.visual);
  const visualWidth = hasVisual ? 340 : 0;
  if (hasVisual) {
    drawIllustration(ctx, images.get(`illustration:${model.visual.name}`), 64, bodyTop, visualWidth, panelHeight, 28, contentVisualFit(model));
  }
  const cardX = hasVisual ? 424 : 64;
  const cardWidth = hasVisual ? 592 : 952;
  model.items.slice(0, count).forEach((item, index) => {
    const y = bodyTop + (index * (cardHeight + gap));
    fillRounded(ctx, cardX, y, cardWidth, cardHeight, 24, "rgba(38,24,63,.90)", "rgba(242,200,98,.22)");
    fillRounded(ctx, cardX + 18, y + 18, 54, 54, 18, "rgba(242,200,98,.12)", "rgba(242,200,98,.40)");
    ctx.fillStyle = colors.accent;
    ctx.textAlign = "center";
    setFont(ctx, 19, 800);
    ctx.fillText(String(index + 1).padStart(2, "0"), cardX + 45, y + 52);
    ctx.textAlign = "left";
    ctx.fillStyle = colors.text;
    drawFittedText(ctx, item.name, cardX + 90, y + 48, cardWidth - 112, 50, {
      preferredSize: 26, minSize: 20, weight: 800, lineFactor: 1.18, maxLines: 2,
    }, audit, `侧栏步骤 ${index + 1} 标题`);
    ctx.fillStyle = colors.muted;
    drawFittedText(ctx, item.detail, cardX + 24, y + layout.detailTop, cardWidth - 48, layout.detailHeight, {
      preferredSize: 22, minSize: 22, weight: 500, lineFactor: 1.28, maxLines: Infinity,
    }, audit, `侧栏步骤 ${index + 1} 正文`);
  });
  audit.drawnBlocks = count;
  audit.contentBottom = layout.contentBottom;
}

function drawChecklist(ctx, model, images, audit) {
  let bodyTop = drawTitle(ctx, model, true, audit) + 18;
  if (model.heroEntities.length >= 2) {
    drawLineupBanner(ctx, model.heroEntities, images, 64, bodyTop, 952, 236, audit);
    bodyTop += 254;
  } else if (model.visual) {
    drawIllustration(ctx, images.get(`illustration:${model.visual.name}`), 64, bodyTop, 952, 220, 28, contentVisualFit(model));
    bodyTop += 238;
  }
  const count = Math.min(4, model.items.length);
  const gap = 14;
  const available = 1298 - bodyTop;
  const cardHeight = Math.floor((available - ((count - 1) * gap)) / Math.max(1, count));
  model.items.slice(0, count).forEach((item, index) => {
    const y = bodyTop + (index * (cardHeight + gap));
    fillRounded(ctx, 64, y, 952, cardHeight, 24, "rgba(38,24,63,.90)", "rgba(242,200,98,.22)");
    ctx.beginPath();
    ctx.arc(108, y + (cardHeight / 2), 24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(76,214,153,.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(76,214,153,.55)";
    ctx.stroke();
    ctx.fillStyle = "#6ee7b7";
    setFont(ctx, 24, 800);
    ctx.textAlign = "center";
    ctx.fillText("✓", 108, y + (cardHeight / 2) + 9);
    ctx.textAlign = "left";
    ctx.fillStyle = colors.text;
    drawFittedText(ctx, item.name, 150, y + 46, 828, 44, { preferredSize: 25, minSize: 20, weight: 800, lineFactor: 1.15, maxLines: 1 }, audit, `清单 ${index + 1} 标题`);
    ctx.fillStyle = colors.muted;
    drawFittedText(ctx, item.detail, 150, y + 83, 828, cardHeight - 96, { preferredSize: 23, minSize: 23, weight: 500, lineFactor: 1.28, maxLines: Infinity }, audit, `清单 ${index + 1} 正文`);
  });
  audit.drawnBlocks = count;
  audit.contentBottom = bodyTop + available;
}

function drawRule(ctx, model, images, audit) {
  if (model.layoutStyle === "roster") return drawRoster(ctx, model, images, audit);
  if (model.layoutStyle === "board") return drawBoard(ctx, model, images, audit);
  if (["timeline", "comparison"].includes(model.layoutStyle)) return drawSideRule(ctx, model, images, audit);
  if (model.layoutStyle === "checklist") return drawChecklist(ctx, model, images, audit);
  const density = model.contentDensity || getRulePageDensity(model);
  let bodyTop = drawTitle(ctx, model, true, audit) + 18;
  if (model.visual) {
    const illustrationHeight = density === "ultra"
      ? 170
      : density === "dense"
        ? 190
        : bodyTop > 410 ? 188 : 220;
    drawIllustration(ctx, images.get(`illustration:${model.visual.name}`), 64, bodyTop, 952, illustrationHeight, 28, contentVisualFit(model));
    bodyTop += illustrationHeight + 18;
  }
  const width = 467;
  const layout = getRuleGridLayout(bodyTop, model.items);
  model.items.forEach((item, index) => {
    const card = layout.cards[index];
    const isOddLast = model.items.length % 2 === 1 && index === model.items.length - 1;
    const x = isOddLast && model.items.length === 3 ? 306.5 : isOddLast ? 64 : 64 + ((index % 2) * (width + layout.gap));
    drawRuleCard(ctx, item, images, x, card.y, isOddLast ? 952 : width, card.height, audit, index, density);
  });
  audit.drawnBlocks = model.items.length;
  audit.contentBottom = layout.contentBottom;
}

async function renderPageToCanvasWithAudit(page, accountName = "") {
  if (document.fonts?.ready) await document.fonts.ready;
  const model = buildPageRenderModel(page, accountName);
  const audit = createExportAudit(model);
  const images = await loadPageAssets(model, audit);
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawBackground(ctx, model);
  drawHeader(ctx, model);
  if (model.type === "cover") drawCover(ctx, model, images, audit);
  else if (model.type === "tree") drawTree(ctx, model, images, audit);
  else if (model.type === "equipment") drawEquipment(ctx, model, images, audit);
  else drawRule(ctx, model, images, audit);
  drawFooter(ctx, model);
  return { canvas, audit: assessExportAudit(audit) };
}

export async function renderPageToCanvas(page, accountName = "") {
  const result = await renderPageToCanvasWithAudit(page, accountName);
  return result.canvas;
}

export async function renderPageToPngWithAudit(page, accountName = "") {
  const { canvas, audit } = await renderPageToCanvasWithAudit(page, accountName);
  if (audit.status === "error") {
    const message = audit.issues.find((issue) => issue.severity === "error")?.message || "页面排版质检未通过";
    throw new Error(message);
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size >= 10_000) resolve(blob);
      else reject(new Error("图片生成结果为空，请刷新页面后重新生成。"));
    }, "image/png", 1);
  });
  return { blob, audit };
}

export async function renderPageToPng(page, accountName = "") {
  const result = await renderPageToPngWithAudit(page, accountName);
  return result.blob;
}
