export const iconRoot = "./src/assets/game-icons";
export const illustrationRoot = "./src/assets/illustrations";

export function cleanDisplayText(value) {
  return String(value || "")
    .replace(/\\(?:r\\n|n|r|t)/giu, " ")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/`{1,3}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export const guideIllustrationAssets = {
  diagnosis: "problem-diagnosis-v1.png",
  tradeoff: "choice-tradeoff-v1.png",
  roadmap: "learning-roadmap-v1.png",
  roles: "team-roles-v1.png",
  branching: "branching-options-v1.png",
  mnemonic: "mnemonic-card-v1.png",
  lineup: "lineup-board-v1.png",
  economy: "economy-tempo-v1.png",
  review: "combat-review-v1.png",
  pitfalls: "newbie-pitfalls-v1.png",
};

export const gameIconAssets = {
  大剑: "tft_item_bfsword.png",
  反曲弓: "tft_item_recurvebow.png",
  无用大棒: "tft_item_needlesslylargerod.png",
  大棒: "tft_item_needlesslylargerod.png",
  女神之泪: "tft_item_tearofthegoddess.png",
  锁子甲: "tft_item_chainvest.png",
  负极斗篷: "tft_item_negatroncloak.png",
  巨人腰带: "tft_item_giantsbelt.png",
  金铲铲: "tft_item_spatula.png",
  拳套: "tft_item_sparringgloves.png",
  金锅锅: "tft_item_fryingpan.png",
  无尽之刃: "tft_item_infinityedge.png",
  最后的轻语: "tft_item_lastwhisper.png",
  珠光护手: "tft_item_jeweledgauntlet.png",
  巨人捕手: "tft_item_madredsbloodrazor.png",
  朔极之矛: "tft_item_spearofshojin.png",
  大天使之杖: "tft_item_archangelsstaff.png",
  鬼索的狂暴之刃: "tft_item_guinsoosrageblade.png",
  泰坦的坚决: "tft_item_titansresolve.png",
  海妖之怒: "tft_item_krakenslayer.png",
  石像鬼石板甲: "tft_item_gargoylestoneplate.png",
  狂徒铠甲: "tft_item_warmogsarmor.png",
  日炎斗篷: "sunfire_cape.png",
};

export function getIconSource(name) {
  const asset = gameIconAssets[name];
  return asset ? `${iconRoot}/${asset}` : "";
}

export function getIllustrationSource(name) {
  const asset = guideIllustrationAssets[name];
  return asset ? `${illustrationRoot}/${asset}` : "";
}

export function getAdaptiveTextDensity(value) {
  const length = Array.from(String(value || "").trim()).length;
  if (length >= 18) return "is-long";
  if (length >= 12) return "is-medium";
  return "is-short";
}

function textLength(value) {
  return Array.from(String(value || "").trim()).length;
}

export function getRulePageDensity(model) {
  if (!model || model.type !== "rule") return "standard";
  const items = Array.isArray(model.items) ? model.items : [];
  if (!items.length) return "standard";
  const scores = items.map((item) => (
    (textLength(item?.name) * 1.35)
    + textLength(item?.detail)
    + (textLength(item?.example) * 0.85)
  ));
  const total = scores.reduce((sum, score) => sum + score, 0);
  const longest = Math.max(...scores);
  const visualPenalty = model.visual ? 28 : 0;
  const densityScore = total + visualPenalty + (Math.max(0, items.length - 3) * 22);
  if (densityScore >= 300 || longest >= 98) return "ultra";
  if (densityScore >= 220 || longest >= 76) return "dense";
  return "standard";
}

function normalizeVisual(visual) {
  const name = cleanDisplayText(visual?.name);
  const externalSource = String(visual?.source || "");
  const trustedExternal = /^https:\/\/(?:ddragon\.leagueoflegends\.com|raw\.communitydragon\.org)\//i.test(externalSource);
  const source = trustedExternal ? externalSource : getIllustrationSource(name);
  if (!source) return null;
  return {
    kind: trustedExternal ? "official" : "illustration",
    name,
    source,
    alt: cleanDisplayText(visual?.alt || "与本页内容对应的概念配图"),
    label: cleanDisplayText(visual?.label || "内容概念图"),
    reason: cleanDisplayText(visual?.reason || "根据本页文字内容选择"),
  };
}

function normalizeEntity(item, index) {
  const imageUrl = String(item?.imageUrl || "");
  const trustedImage = /^https:\/\/(?:ddragon\.leagueoflegends\.com|raw\.communitydragon\.org)\//i.test(imageUrl);
  return {
    number: index + 1,
    name: cleanDisplayText(item?.name || `英雄 ${index + 1}`),
    detail: cleanDisplayText(item?.detail),
    example: cleanDisplayText(item?.example),
    iconName: cleanDisplayText(item?.iconName),
    imageUrl: trustedImage ? imageUrl : "",
    cost: Math.max(0, Number(item?.cost || 0)),
    traits: Array.isArray(item?.traits) ? item.traits.map(cleanDisplayText).filter(Boolean) : [],
    position: ["front", "back", "flex"].includes(item?.position) ? item.position : "flex",
    positionLabel: cleanDisplayText(item?.positionLabel || "灵活位"),
    boardSlot: Number.isInteger(item?.boardSlot?.row) && Number.isInteger(item?.boardSlot?.col)
      ? { row: Math.max(0, Math.min(3, item.boardSlot.row)), col: Math.max(0, Math.min(6, item.boardSlot.col)) }
      : null,
  };
}

export function parseRecipe(value) {
  const recipe = cleanDisplayText(value);
  const [ingredientsText = "", resultName = ""] = recipe.split(/[＝=]/).map((part) => part.trim());
  const ingredients = ingredientsText.split(/[＋+]/).map((part) => part.trim()).filter(Boolean);
  return { recipe, ingredients, resultName };
}

function normalizeStep(item, index) {
  if (typeof item === "string") {
    return {
      number: index + 1,
      name: item,
      detail: "按当前阵容逐项判断。",
      example: "",
      iconName: "",
    };
  }
  return normalizeEntity({ ...item, detail: item?.detail || "按当前阵容逐项判断。" }, index);
}

export function buildPageRenderModel(page, accountName = "", totalPages = 7) {
  const block = page?.blocks?.[0] || { items: [] };
  const base = {
    id: String(page?.id || "page"),
    pageNo: Number(page?.pageNo || 1),
    totalPages,
    type: String(page?.type || "cover"),
    kicker: cleanDisplayText(page?.kicker || "铲友装备课01"),
    title: cleanDisplayText(page?.title),
    subtitle: cleanDisplayText(page?.subtitle),
    accountName: cleanDisplayText(accountName || "账号名"),
    seriesName: "铲友装备课01",
    contentKind: String(page?.contentKind || "equipment"),
    layoutStyle: String(page?.layoutStyle || "cards"),
    visual: normalizeVisual(page?.visual),
    heroEntities: (page?.featuredEntities || []).map(normalizeEntity).filter((item) => item.imageUrl),
    items: [],
  };

  if (base.type === "cover") {
    const defaultEquipmentIcons = ["大剑", "反曲弓", "大棒", "女神之泪", "锁子甲"];
    return {
      ...base,
      heroIcons: base.visual || base.contentKind !== "equipment" ? [] : defaultEquipmentIcons,
      items: (block.items || []).map(cleanDisplayText),
    };
  }

  if (base.type === "tree") {
    return {
      ...base,
      items: (block.items || []).map((item) => parseRecipe(item)),
    };
  }

  if (base.type === "equipment") {
    return {
      ...base,
      items: (block.items || []).map((item) => ({
        name: cleanDisplayText(item?.name),
        recipe: cleanDisplayText(item?.recipe),
        tag: cleanDisplayText(item?.tag),
        detail: cleanDisplayText(item?.detail),
        cue: cleanDisplayText(item?.cue),
      })),
    };
  }

  const model = {
    ...base,
    items: (block.items || []).map(normalizeStep),
  };
  return { ...model, contentDensity: getRulePageDensity(model) };
}

export function pageExportFilename(page, extension = "png") {
  const pageNo = String(page?.pageNo || 1).padStart(2, "0");
  return `铲友装备课01-第${pageNo}页.${extension}`;
}
