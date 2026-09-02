export const routes = ["home", "research", "outline", "editor", "export"];

export function normalizeRoute(hash) {
  const candidate = String(hash || "").replace(/^#\/?/, "").split("?")[0];
  return routes.includes(candidate) ? candidate : "home";
}

export function updatePage(pages, pageId, patch) {
  return pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page));
}

export function updateOutlinePage(pages, pageNo, patch) {
  const target = Number(pageNo);
  return pages.map((page) => (
    Number(page.pageNo) === target ? { ...page, ...patch } : page
  ));
}

export function validateOutlinePageDraft(draft, { requireKeyPoints = false } = {}) {
  const kicker = String(draft?.kicker || "").trim();
  const title = String(draft?.title || "").trim();
  const summary = String(draft?.summary || "").trim();
  const keyPoints = String(draft?.keyPointsText || "")
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!kicker) return { ok: false, field: "outlineKicker", error: "请填写这一页的页签。" };
  if (!title) return { ok: false, field: "outlineTitle", error: "请填写这一页的标题。" };
  if (!summary) return { ok: false, field: "outlineSummary", error: "请填写这一页要解决的问题。" };
  if (requireKeyPoints && (keyPoints.length < 2 || keyPoints.length > 4)) {
    return { ok: false, field: "outlineKeyPoints", error: "页面要点请保留 2～4 条，每行一条。" };
  }
  return { ok: true, value: { kicker, title, summary, keyPoints } };
}

export function normalizeManualOrder(page) {
  return Array.isArray(page?.manualOrder)
    ? [...new Set(page.manualOrder.filter((name) => typeof name === "string" && name.trim()))]
    : [];
}

export function hasManualOrder(page) {
  return normalizeManualOrder(page).length > 0;
}

function remapPreservedItemFields(page, previousItems, nextItems) {
  const remapped = normalizePreservedFields(page).map((fieldKey) => {
    const match = fieldKey.match(/^items\.(\d+)\.(detail|cue|example)$/);
    if (!match) return fieldKey;
    const previousItem = previousItems[Number(match[1])];
    const nextIndex = nextItems.findIndex((item) => item?.name === previousItem?.name);
    return nextIndex >= 0 ? `items.${nextIndex}.${match[2]}` : fieldKey;
  });
  return [...new Set(remapped)];
}

function reorderEquipmentPage(page, orderedItems, manualOrder) {
  const blockIndex = page.blocks.findIndex((block) => block.kind === "equipment");
  if (blockIndex < 0) return page;
  const previousItems = page.blocks[blockIndex].items;
  const blocks = page.blocks.map((block, index) => (
    index === blockIndex ? { ...block, items: orderedItems } : block
  ));
  return {
    ...page,
    blocks,
    manualOrder,
    preservedFields: remapPreservedItemFields(page, previousItems, orderedItems),
  };
}

export function moveEquipmentItem(pages, pageId, itemIndex, direction) {
  const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  return pages.map((page) => {
    if (page.id !== pageId || page.locked || !delta) return page;
    const block = page.blocks.find((candidate) => candidate.kind === "equipment");
    const from = Number(itemIndex);
    const to = from + delta;
    if (!block || !Number.isInteger(from) || from < 0 || to < 0 || to >= block.items.length) return page;
    const items = [...block.items];
    [items[from], items[to]] = [items[to], items[from]];
    return reorderEquipmentPage(page, items, items.map((item) => item.name));
  });
}

export function restoreEquipmentOrder(pages, pageId, referenceNames = []) {
  return pages.map((page) => {
    if (page.id !== pageId || page.locked) return page;
    const block = page.blocks.find((candidate) => candidate.kind === "equipment");
    if (!block) return page;
    const order = new Map(referenceNames.map((name, index) => [name, index]));
    const items = [...block.items].sort((left, right) => (
      (order.get(left.name) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.name) ?? Number.MAX_SAFE_INTEGER)
    ));
    return reorderEquipmentPage(page, items, []);
  });
}

export function normalizePreservedFields(page) {
  return Array.isArray(page?.preservedFields)
    ? [...new Set(page.preservedFields.filter((key) => typeof key === "string" && key.trim()))]
    : [];
}

export function isFieldPreserved(page, fieldKey) {
  return normalizePreservedFields(page).includes(fieldKey);
}

export function togglePreservedField(pages, pageId, fieldKey) {
  return pages.map((page) => {
    if (page.id !== pageId) return page;
    const preserved = new Set(normalizePreservedFields(page));
    if (preserved.has(fieldKey)) preserved.delete(fieldKey);
    else preserved.add(fieldKey);
    return { ...page, preservedFields: [...preserved] };
  });
}

function restorePreservedFields(original, rewritten) {
  const preserved = normalizePreservedFields(original);
  if (!preserved.length) return { page: rewritten, count: 0 };

  const restored = structuredClone(rewritten);
  for (const fieldKey of preserved) {
    if (fieldKey === "title" || fieldKey === "subtitle") {
      restored[fieldKey] = original[fieldKey];
      continue;
    }
    const match = fieldKey.match(/^items\.(\d+)\.(detail|cue|example)$/);
    if (!match) continue;
    const index = Number(match[1]);
    const property = match[2];
    const originalItem = original.blocks?.[0]?.items?.[index];
    const rewrittenItem = restored.blocks?.[0]?.items?.[index];
    if (originalItem && rewrittenItem && typeof originalItem === "object" && typeof rewrittenItem === "object") {
      rewrittenItem[property] = originalItem[property];
    }
  }
  restored.preservedFields = preserved;
  return { page: restored, count: preserved.length };
}

function restoreManualItemOrder(original, rewritten) {
  const manualOrder = normalizeManualOrder(original);
  if (!manualOrder.length) return rewritten;
  const order = new Map(manualOrder.map((name, index) => [name, index]));
  const restored = structuredClone(rewritten);
  restored.blocks = restored.blocks.map((block) => {
    if (block.kind !== "equipment") return block;
    return {
      ...block,
      items: [...block.items].sort((left, right) => (
        (order.get(left.name) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      )),
    };
  });
  restored.manualOrder = manualOrder;
  return restored;
}

function replaceInPage(page, from, to) {
  const replace = (value) => (typeof value === "string" ? value.replaceAll(from, to) : value);
  return {
    ...page,
    title: replace(page.title),
    subtitle: replace(page.subtitle),
    blocks: page.blocks.map((block) => ({
      ...block,
      items: block.items.map((item) => (
        typeof item === "string"
          ? replace(item)
          : Object.fromEntries(Object.entries(item).map(([key, value]) => [key, replace(value)]))
      )),
    })),
  };
}

function appendOnce(value, addition) {
  const text = String(value || "").trim();
  return text.includes(addition) ? text : `${text}${text ? " " : ""}${addition}`;
}

function prefixOnce(value, prefix) {
  const text = String(value || "").trim();
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

const equipmentCopyProfiles = [
  {
    pattern: /无尽之刃|强化暴击/u,
    detail: "强化暴击更适合依赖物理爆发的输出位；它放大单次伤害，但不能替代破甲或启动功能。",
    cue: "主 C 已能稳定出手、又需要提高爆发时再选；对手护甲高时，要同时检查队伍有没有破甲。",
  },
  {
    pattern: /巨人捕手|处理高血量/u,
    detail: "对手前排血量厚、战斗容易拖长时，它能提高处理高血量目标的效率。",
    cue: "先观察对面前排数量和质量；脆皮较多或战斗很短时，不必把它当固定第一件。",
  },
  {
    pattern: /最后的轻语|物理破甲/u,
    detail: "物理阵容遇到高护甲目标时需要稳定破甲，适合交给能持续攻击的输出位触发。",
    cue: "队伍没有其他减甲来源时优先；已有可靠破甲时，可把装备格留给伤害或启动装。",
  },
  {
    pattern: /珠光护手|技能爆发/u,
    detail: "适合主要伤害来自技能、希望一轮施法压低血线的法术输出位。",
    cue: "先确认英雄能及时启动；第一轮技能放不出来时，回蓝装通常比继续堆爆发更急。",
  },
  {
    pattern: /朔极之矛|加快启动|回蓝/u,
    detail: "通过持续普攻加快技能循环，适合需要多次施法、且能安全站场输出的英雄。",
    cue: "技能启动慢或需要频繁施法时优先；若英雄很少普攻，要重新确认回蓝方式是否匹配。",
  },
  {
    pattern: /大天使之杖|持续成长/u,
    detail: "战斗越久越能发挥成长价值，适合能活到后半程继续施法的法术核心。",
    cue: "前排能拖住时间再考虑；阵容容易快速减员时，先补启动或即时伤害会更稳。",
  },
  {
    pattern: /鬼索的狂暴之刃|越打越快/u,
    detail: "持续普攻可以逐步抬高输出节奏，适合站得住、并依赖攻速成长的后排核心。",
    cue: "预期战斗较长时收益更高；主 C 容易暴毙或对局结束太快时，叠层价值会明显下降。",
  },
  {
    pattern: /海妖之怒|持续输出/u,
    detail: "偏向整场战斗的稳定普攻输出，适合需要持续攻速而不是只打一轮爆发的单位。",
    cue: "先判断输出位能否获得足够攻击时间；若当前缺的是瞬间爆发，应换成更直接的伤害功能。",
  },
  {
    pattern: /泰坦的坚决|攻防成长/u,
    detail: "在持续攻击或承伤中兼顾输出与站场，更适合会贴身作战的近战核心。",
    cue: "能稳定叠层、又需要补容错时再给；纯后排脆皮通常吃不满它的攻防两面。",
  },
  {
    pattern: /石像鬼石板甲|补双抗/u,
    detail: "主坦同时承受多个敌人火力时更容易发挥双抗价值，重点是提高被集火时的站场能力。",
    cue: "优先给站在主要火力交汇处的前排；躲在侧边、很少被集火的单位收益会降低。",
  },
  {
    pattern: /狂徒铠甲|补血量/u,
    detail: "直接抬高生命上限，适合抗性尚可但血量不足、需要扩大承伤空间的前排。",
    cue: "面对混合伤害时可与双抗装搭配；若对手单一伤害特别集中，先补对应抗性更有效。",
  },
  {
    pattern: /日炎斗篷|前排功能/u,
    detail: "兼顾前期坦度与持续功能，适合能尽早接敌并在前排存活一段时间的单位。",
    cue: "给最早接触敌人的前排，才能更快发挥作用；后排或经常绕开的单位不适合携带。",
  },
];

function equipmentProfile(item, index = 0) {
  const subject = `${item?.name || ""} ${item?.tag || ""}`;
  const matched = equipmentCopyProfiles.find((profile) => profile.pattern.test(subject));
  if (matched) return matched;
  const name = String(item?.name || `第 ${index + 1} 件装备`).trim();
  const tag = String(item?.tag || "当前功能").trim();
  const fallbacks = [
    {
      detail: `${name}主要补足“${tag}”，先判断核心单位是否真的缺这一项，再考虑占用装备格。`,
      cue: `选择${name}前先对照英雄定位和现有装备，避免同类功能重复堆叠。`,
    },
    {
      detail: `${name}的重点是“${tag}”，它解决的是特定阵容缺口，而不是任何单位都能直接套用。`,
      cue: `决定合成${name}时，把对手阵容和战斗节奏一起纳入判断。`,
    },
    {
      detail: `理解${name}时先记住“${tag}”这个用途，再看当前英雄能否稳定发挥它的效果。`,
      cue: `${name}更适合功能明确的装备位；若已有同类效果，优先补阵容另一处短板。`,
    },
  ];
  return fallbacks[index % fallbacks.length];
}

function copySkeleton(value, item = {}) {
  let text = String(value || "").toLowerCase();
  for (const token of [item.name, item.tag, item.recipe]) {
    if (token) text = text.replaceAll(String(token).toLowerCase(), "{内容}");
  }
  return text
    .replace(/[“”"'‘’]/gu, "")
    .replace(/[\s，。！？；：、,.!?;:（）()【】\[\]《》<>]/gu, "");
}

function stepSpecificCopy(item, index, property) {
  const name = String(item?.name || `要点 ${index + 1}`).trim();
  const detailOptions = [
    `先围绕“${name}”确认当前条件，找出真正影响这一步的关键信息，再决定是否继续。`,
    `判断“${name}”时，把可选方案的收益、代价和适用场景放在一起比较。`,
    `把“${name}”拆成可观察的信号，条件满足再执行，不满足就及时换路线。`,
    `处理“${name}”要先排优先级：先解决会让整套思路失效的问题，再补上限。`,
  ];
  const exampleOptions = [
    `实战先记录与“${name}”直接相关的现象，不用被无关信息带跑。`,
    `如果两个方案都能处理“${name}”，优先选择代价更低、当前更容易完成的一个。`,
    `遇到条件变化时重新检查“${name}”，不要沿用上一局的固定答案。`,
    `做完“${name}”这一步后再看下一处缺口，避免同时改太多导致判断混乱。`,
  ];
  return property === "example" ? exampleOptions[index % 4] : detailOptions[index % 4];
}

function isBoilerplateCopy(value) {
  return /先看英雄是否.*需要.*功能|它解决的是.*问题.*不等于|阵容缺.*时再做|不用每局硬合|合成前再检查主\s*C\s*装备格|先看阵容缺什么|判断时还要结合英雄定位|如果功能重复|先确认当前条件，再决定下一步|结合当前局面重新判断/u.test(String(value || ""));
}

function ensureDistinctItems(items, kind) {
  const nextItems = items.map((item) => (typeof item === "object" && item ? { ...item } : item));
  const properties = kind === "equipment" ? ["detail", "cue"] : ["detail", "example"];
  for (const property of properties) {
    const seen = new Set();
    nextItems.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const skeleton = copySkeleton(item[property], item);
      if (skeleton && !seen.has(skeleton) && !isBoilerplateCopy(item[property])) {
        seen.add(skeleton);
        return;
      }
      if (kind === "equipment") {
        const profile = equipmentProfile(item, index);
        item[property] = profile[property];
      } else {
        item[property] = stepSpecificCopy(item, index, property);
      }
      seen.add(copySkeleton(item[property], item));
    });
  }
  return nextItems;
}

function copyLength(value) {
  return Array.from(String(value || "").trim()).length;
}

function stepDensityCopy(item, index) {
  const name = String(item?.name || `第 ${index + 1} 步`).trim();
  const subject = `${name} ${item?.detail || ""}`;
  const profiles = [
    {
      pattern: /主\s*C|核心|输出/u,
      detail: "还要确认核心能否稳定到位、有没有足够装备格，避免把关键输出资源平均拆给多个单位。",
      example: "确定一个能持续完成输出的核心，再把同类装备集中给他。",
    },
    {
      pattern: /伤害|物理|法术|破甲|魔抗/u,
      detail: "同时检查队伍缺的是爆发、持续输出还是破甲减抗，先补完整条伤害链路，再追求更高面板。",
      example: "若两种伤害并存，优先保证主 C 的核心伤害链路完整。",
    },
    {
      pattern: /启动|回蓝|攻速|技能/u,
      detail: "再对照蓝量、普攻频率和第一轮施法时间；启动太慢时，回蓝或攻速往往比继续堆伤害更急。",
      example: "观察第一轮技能是否来得及放出，再决定补启动还是补伤害。",
    },
    {
      pattern: /前排|坦|承伤|生存/u,
      detail: "结合对手伤害类型和集火位置补血量或双抗，让前排撑到核心完成一轮完整输出。",
      example: "先看对手主要伤害和集火位置，再决定补血量还是对应双抗。",
    },
  ];
  const titlePatterns = [
    /定主\s*C|定核心|核心输出/u,
    /辨伤害|伤害类型|物理|法术|破甲|魔抗/u,
    /看启动|启动|回蓝|攻速|技能循环/u,
    /保前排|前排|坦度|承伤|生存/u,
  ];
  const titleMatchIndex = titlePatterns.findIndex((pattern) => pattern.test(name));
  return (titleMatchIndex >= 0 ? profiles[titleMatchIndex] : profiles.find((profile) => profile.pattern.test(subject))) || {
    detail: `把“${name}”放回当前局面检查：现有资源、目标功能和对手压力都会改变这一步的优先级。`,
    example: `围绕“${name}”确认条件、目标和代价，满足前提再执行。`,
  };
}

function ensureReadableItems(items, kind) {
  return items.map((item, index) => {
    if (!item || typeof item !== "object") return item;
    if (kind === "equipment") return item;
    const profile = stepDensityCopy(item, index);
    let detail = String(item.detail || "").trim();
    let example = String(item.example || "").trim();
    for (const legacyExample of [
      "物理阵容检查破甲，法术阵容检查减抗和第一轮施法。",
      "缺血量补血量，吃多人集火时再优先补双抗和站位。",
    ]) example = example.replace(legacyExample, "").trim();
    const knownProfiles = [0, 1, 2, 3].map((profileIndex) => stepDensityCopy({
      name: ["定主 C", "辨伤害", "看启动", "保前排"][profileIndex],
      detail: "",
    }, profileIndex));
    for (const known of knownProfiles) {
      if (known.detail !== profile.detail) detail = detail.replace(known.detail, "").trim();
      if (known.example !== profile.example) example = example.replace(known.example, "").trim();
    }
    if (copyLength(detail) < 48) detail = appendOnce(detail, profile.detail);
    if (!example.startsWith("实战检查：")) example = `实战检查：${example}`;
    if (copyLength(example) < 28) example = appendOnce(example, profile.example);
    return { ...item, detail, example };
  });
}

export function ensureDistinctPageCopy(page) {
  const next = structuredClone(page);
  next.blocks = (next.blocks || []).map((block) => {
    if (block.kind !== "equipment" && block.kind !== "steps") return block;
    const distinct = ensureDistinctItems(block.items || [], block.kind);
    return { ...block, items: ensureReadableItems(distinct, block.kind) };
  });
  return next;
}

function rewriteEquipmentItems(items, intents) {
  const rewritten = items.map((item, index) => {
    const profile = equipmentProfile(item, index);
    let detail = item.detail || profile.detail;
    let cue = item.cue || profile.cue;

    if (intents.simple) {
      detail = profile.detail;
      cue = `新手判断：${profile.cue}`;
    }
    if (intents.detailed) {
      detail = appendOnce(detail, profile.detail);
      cue = appendOnce(cue, profile.cue);
    }
    if (intents.friendly) {
      detail = `铲友们可以先记功能：${detail}`;
      cue = `实战里这样判断就行：${cue}`;
    }
    if (intents.pitfall) cue = `避坑：${cue}`;

    return { ...item, detail, cue };
  });
  return ensureDistinctItems(rewritten, "equipment");
}

function rewriteStepItems(items, intents) {
  const rewritten = items.map((item) => {
    if (typeof item === "string") return item;
    let detail = item.detail;
    let example = item.example;
    if (intents.simple) detail = `${detail.split("，")[0].replace(/[。！？；]+$/u, "")}。`;
    if (intents.detailed) example = prefixOnce(example, "实战检查：");
    if (intents.friendly) detail = prefixOnce(detail, "宝子们先做这一件事：");
    if (intents.pitfall) example = prefixOnce(example, "常见误区：");
    return { ...item, detail, example };
  });
  return ensureDistinctItems(rewritten, "steps");
}

function applyGenericFallback(page) {
  const subtitles = {
    cover: "从散件、功能到分配，一步步看懂装备",
    tree: "先看散件组合，再按当前阵容需要决定是否合成",
    equipment: "结合英雄定位、阵容缺口和对手情况再决定",
    rule: "按当前阵容逐项检查，不要机械照抄",
  };

  return {
    ...page,
    subtitle: subtitles[page.type] || page.subtitle,
    blocks: page.blocks.map((block) => {
      if (block.kind === "equipment") {
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            detail: appendOnce(item.detail, "判断时还要结合英雄定位、战斗节奏和对手阵容。"),
            cue: appendOnce(item.cue, "如果功能重复，优先留给更缺这一项的单位。"),
          })),
        };
      }
      if (block.kind === "steps") {
        return {
          ...block,
          items: block.items.map((item) => (
            typeof item === "string"
              ? item
              : {
                ...item,
                detail: appendOnce(item.detail, "再结合当前来牌和装备数量决定。"),
                example: appendOnce(item.example, "做决定前再检查一次阵容最缺的功能。"),
              }
          )),
        };
      }
      return block;
    }),
  };
}

function analyzeSuggestion(suggestion) {
  const text = String(suggestion || "").trim();
  const intents = {
    text,
    simple: /简单|简洁|精简|缩短|短一点|少一点|太长|小白|新手|好懂|看得懂/.test(text),
    detailed: /详细|具体|细节|丰富|补充|完整|展开|多讲|多一点|解释|为什么/.test(text),
    friendly: /口语|自然|像人|人话|朋友|搭子|安利|活人|热情/.test(text),
    pitfall: /避坑|踩坑|风险|错误|误区|不要|提醒|注意/.test(text),
    saveable: /收藏|干货|口诀|归纳|总结|重点/.test(text),
  };
  return {
    ...intents,
    matched: intents.simple || intents.detailed || intents.friendly || intents.pitfall || intents.saveable,
  };
}

function intentSummary(intents, replaced = false, usedFallback = false) {
  const labels = [];
  if (replaced) labels.push("按指定内容完成替换");
  if (intents.simple) labels.push("降低术语密度，改得更适合新手");
  if (intents.detailed) labels.push("补充选择理由和实战判断");
  if (intents.friendly) labels.push("调整为游戏搭子式口吻");
  if (intents.pitfall) labels.push("突出常见误区和提醒");
  if (intents.saveable) labels.push("强化可收藏的结论");
  if (usedFallback) labels.push("未识别到具体指令，已按通用方向补充判断依据");
  return labels.length ? labels.join("；") : "按更清楚、更具体的方向整理当前页";
}

export function rewritePage(pages, pageId, suggestion = "更适合新手阅读") {
  const intents = analyzeSuggestion(suggestion);
  return pages.map((page) => {
    if (page.id !== pageId || page.locked) return page;

    let rewritten = structuredClone(page);
    let replaced = false;
    const replacement = intents.text.match(/把[“\"]?(.+?)[”\"]?(?:改成|换成|替换成)[“\"]?(.+?)[”\"]?$/);
    if (replacement?.[1] && replacement?.[2]) {
      rewritten = replaceInPage(rewritten, replacement[1].trim(), replacement[2].trim());
      replaced = true;
    }
    const usedFallback = !intents.matched && !replaced;

    if (intents.simple) {
      const simpleSubtitles = {
        cover: "不用背表，先学会按功能找装备",
        tree: "先认散件，再看它能合成什么",
        equipment: "先看它解决什么问题，再决定给谁",
        rule: "照着四步判断，新手也能自己配装",
      };
      rewritten.subtitle = simpleSubtitles[page.type] || rewritten.subtitle;
    }
    if (intents.detailed) {
      const detailSubtitles = {
        equipment: "看功能、适用场景和常见误区，再决定是否合成",
        rule: "每一步都有判断依据，照着当前阵容逐项检查",
      };
      rewritten.subtitle = detailSubtitles[page.type] || rewritten.subtitle;
    }
    if (intents.friendly) {
      rewritten.subtitle = page.type === "equipment"
        ? "这三件别只看推荐，我帮你把使用场景讲明白"
        : "不用死记，我陪你一步一步判断";
    }
    if (intents.pitfall) rewritten.kicker = "新手避坑提醒";
    if (intents.saveable) rewritten.kicker = "建议收藏这页";

    rewritten.blocks = rewritten.blocks.map((block) => {
      if (block.kind === "equipment") return { ...block, items: rewriteEquipmentItems(block.items, intents) };
      if (block.kind === "steps") return { ...block, items: rewriteStepItems(block.items, intents) };
      return block;
    });

    if (usedFallback) rewritten = applyGenericFallback(rewritten);

    rewritten = ensureDistinctPageCopy(rewritten);
    rewritten = restoreManualItemOrder(page, rewritten);
    const preserved = restorePreservedFields(page, rewritten);
    const preservationSummary = preserved.count
      ? `；已保留 ${preserved.count} 个字段未改动`
      : "";
    const orderSummary = hasManualOrder(page) ? "；已保留人工装备顺序" : "";
    return {
      ...preserved.page,
      rewriteCount: (page.rewriteCount || 0) + 1,
      rewriteMode: usedFallback ? "fallback" : "matched",
      rewriteSummary: `${intentSummary(intents, replaced, usedFallback)}${preservationSummary}${orderSummary}`,
    };
  });
}

function pageFieldEntries(page) {
  const entries = new Map();
  const add = (path, label, value) => {
    if (typeof value === "string") entries.set(path, { label, value });
  };
  add("kicker", "页眉提示", page.kicker);
  add("title", "主标题", page.title);
  add("subtitle", "补充说明", page.subtitle);
  const block = page.blocks?.[0];
  const propertyLabels = {
    name: "名称",
    recipe: "配方",
    tag: "功能标签",
    detail: block?.kind === "steps" ? "怎么判断" : "适用场景",
    cue: "选择判断",
    example: "实战提醒",
  };
  for (const [index, item] of (block?.items || []).entries()) {
    if (typeof item === "string") {
      add(`items.${index}`, `第 ${index + 1} 条内容`, item);
      continue;
    }
    for (const [property, value] of Object.entries(item || {})) {
      const subject = item.name || `第 ${index + 1} 条`;
      add(
        `items.${index}.${property}`,
        `${subject} · ${propertyLabels[property] || property}`,
        value,
      );
    }
  }
  return entries;
}

function impactReason(summary) {
  return String(summary || "")
    .replace(/；已保留 \d+ 个字段未改动/g, "")
    .replace(/；已保留人工装备顺序/g, "")
    .trim();
}

export function analyzeRewriteImpact(pages, suggestion = "") {
  return pages.map((page) => {
    const before = pageFieldEntries(page);
    const simulated = rewritePage([structuredClone(page)], page.id, suggestion)[0];
    const after = pageFieldEntries(simulated);
    const changedFieldPaths = [...before.keys()].filter((path) => (
      before.get(path)?.value !== after.get(path)?.value
    ));
    const changedFieldLabels = changedFieldPaths.map((path) => before.get(path)?.label || path);
    const protectedFieldLabels = normalizePreservedFields(page).map((path) => (
      before.get(path)?.label || path
    ));
    if (hasManualOrder(page)) protectedFieldLabels.push("人工装备顺序");
    const status = page.locked
      ? "protected"
      : changedFieldPaths.length
        ? "affected"
        : "unchanged";
    return {
      pageId: page.id,
      pageNo: page.pageNo,
      title: page.title,
      status,
      changedFieldPaths,
      changedFieldLabels,
      protectedFieldLabels: page.locked ? ["整页已锁定"] : protectedFieldLabels,
      reason: status === "affected"
        ? impactReason(simulated.rewriteSummary)
        : status === "protected"
          ? "整页锁定，系统不会发送任何字段给 AI"
          : "这条建议不会改变本页现有内容",
    };
  });
}

export function rewriteDocument(pages, suggestion, selectedPageIds = []) {
  const selected = new Set(selectedPageIds);
  return pages.reduce((current, page) => (
    selected.has(page.id) ? rewritePage(current, page.id, suggestion) : current
  ), pages);
}

const viewpointPagePlans = {
  "component-first": {
    "page-cover": "aligned",
    "page-tree": "aligned",
    "page-damage": "rewrite",
    "page-cast": "rewrite",
    "page-sustain": "rewrite",
    "page-tank": "rewrite",
    "page-rule": "rewrite",
  },
  "role-first": {
    "page-cover": "rewrite",
    "page-tree": "conflict",
    "page-damage": "aligned",
    "page-cast": "aligned",
    "page-sustain": "rewrite",
    "page-tank": "aligned",
    "page-rule": "rewrite",
  },
  "function-first": {
    "page-cover": "rewrite",
    "page-tree": "rewrite",
    "page-damage": "aligned",
    "page-cast": "aligned",
    "page-sustain": "aligned",
    "page-tank": "aligned",
    "page-rule": "rewrite",
  },
};

const viewpointCopy = {
  "component-first": {
    "page-cover": { subtitle: "先认散件，再把合成关系和装备功能对上" },
    "page-tree": { title: "两个散件，会合成什么？", subtitle: "先看完整合成树，再理解常用成装的功能" },
    "page-damage": { title: "物理输出装，先看散件能合什么" },
    "page-cast": { title: "法术和启动装备，从散件开始理解" },
    "page-sustain": { title: "攻速散件能合什么，分别解决什么问题" },
    "page-tank": { title: "防御散件怎么合，先补队伍最缺的功能" },
    "page-rule": { title: "先认散件，再按四步判断装备" },
  },
  "role-first": {
    "page-cover": { subtitle: "先分清主 C、前排和辅助，再决定装备给谁" },
    "page-tree": { title: "合成以后，先判断该给哪个位置", subtitle: "完整配方作为查询底图，正文重点讲英雄定位" },
    "page-sustain": { title: "持续输出主 C：攻速装怎么挑" },
    "page-rule": { title: "主 C、前排、辅助，按定位检查装备" },
  },
  "function-first": {
    "page-cover": { subtitle: "按伤害、攻速、回蓝和生存四类功能找装备" },
    "page-tree": { title: "先查合成，再把装备放进四个功能桶" },
    "page-rule": { title: "按伤害、启动、生存四类功能判断" },
  },
};

const viewpointNames = {
  "component-first": "先认散件，再理解功能",
  "role-first": "先按英雄定位分装备",
  "function-first": "直接按功能找装备",
};

export function normalizeViewpointConflicts(conflicts) {
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter((item) => (
    item
    && typeof item.pageId === "string"
    && item.pageId.trim().length > 0
    && typeof item.viewpointId === "string"
    && item.viewpointId.trim().length > 0
    && typeof item.reason === "string"
    && item.reason.trim().length > 0
  ));
}

export function analyzeViewpointImpact(pages, currentViewpointId, targetViewpointId, conflicts = []) {
  const unresolved = new Set(
    normalizeViewpointConflicts(conflicts)
      .filter((item) => item.viewpointId === targetViewpointId)
      .map((item) => item.pageId),
  );
  const resolvingCurrent = currentViewpointId === targetViewpointId && unresolved.size > 0;
  const plan = viewpointPagePlans[targetViewpointId] || {};

  return pages.map((page) => {
    let status = resolvingCurrent
      ? (unresolved.has(page.id) ? "conflict" : "aligned")
      : (plan[page.id] || "rewrite");
    if (page.appliedViewpointId === targetViewpointId) status = "aligned";
    if (page.appliedViewpointId && page.appliedViewpointId !== targetViewpointId && status === "aligned") {
      status = "rewrite";
    }
    const protectedFieldLabels = page.locked
      ? ["整页已锁定"]
      : normalizePreservedFields(page).map((path) => pageFieldEntries(page).get(path)?.label || path);
    if (!page.locked && hasManualOrder(page)) protectedFieldLabels.push("人工装备顺序");
    const fields = status === "aligned"
      ? []
      : page.type === "equipment"
        ? ["主标题", "补充说明", "适用场景", "选择判断"]
        : ["主标题", "补充说明", "页面任务"];
    const reasons = {
      aligned: "现有页面任务与新观点一致，可以直接保留",
      rewrite: `页面切入仍偏向“${viewpointNames[currentViewpointId] || "当前观点"}”，建议按新观点重组表达`,
      conflict: "当前页强调完整合成关系，新观点要求弱化合成树并优先讲英雄定位，存在直接矛盾",
    };
    return {
      pageId: page.id,
      pageNo: page.pageNo,
      title: page.title,
      status,
      fields,
      reason: reasons[status],
      locked: Boolean(page.locked),
      canRewrite: !page.locked,
      protectedFieldLabels,
    };
  });
}

function applyViewpointCopy(page, targetViewpointId) {
  const copy = viewpointCopy[targetViewpointId]?.[page.id] || {};
  const patch = {};
  for (const [field, value] of Object.entries(copy)) {
    if (!isFieldPreserved(page, field)) patch[field] = value;
  }
  return {
    ...page,
    ...patch,
    appliedViewpointId: targetViewpointId,
    viewpointRewriteSummary: `已按“${viewpointNames[targetViewpointId] || targetViewpointId}”调整页面任务`,
  };
}

export function applyViewpointImpact(pages, targetViewpointId, decisions = {}, impacts = []) {
  let nextPages = pages;
  const conflicts = [];
  for (const impact of impacts) {
    if (impact.status === "aligned") continue;
    const decision = impact.status === "conflict" ? "rewrite" : decisions[impact.pageId];
    if (decision === "rewrite" && impact.canRewrite) {
      const suggestion = `更适合新手，补充为什么，按${viewpointNames[targetViewpointId] || "新观点"}重新组织`;
      nextPages = rewritePage(nextPages, impact.pageId, suggestion);
      nextPages = nextPages.map((page) => (
        page.id === impact.pageId ? applyViewpointCopy(page, targetViewpointId) : page
      ));
      continue;
    }
    if (impact.status === "conflict") {
      conflicts.push({
        pageId: impact.pageId,
        pageNo: impact.pageNo,
        title: impact.title,
        viewpointId: targetViewpointId,
        reason: impact.locked
          ? "页面被锁定，无法按新观点重写"
          : "直接矛盾尚未选择重写",
      });
    }
  }
  return { pages: nextPages, conflicts };
}

function analyzePublishSuggestion(suggestion) {
  const text = String(suggestion || "").trim();
  const intents = {
    text,
    concise: /精简|简洁|短一点|缩短|太长/.test(text),
    detailed: /详细|具体|展开|丰富|补充|多一点/.test(text),
    lively: /网感|小红书|活人|口语|自然|朋友|搭子|热情|有趣/.test(text),
    emojiMore: /多一点.*(?:emoji|表情)|(?:emoji|表情).*多一点|加.*(?:emoji|表情)/i.test(text),
    emojiLess: /少一点.*(?:emoji|表情)|不要.*(?:emoji|表情)|去掉.*(?:emoji|表情)/i.test(text),
    interaction: /互动|评论|提问|结尾/.test(text),
    beginner: /新手|小白|好懂|看得懂/.test(text),
    restrained: /克制|专业|少夸张|稳重/.test(text),
  };
  return {
    ...intents,
    matched: Object.entries(intents).some(([key, value]) => key !== "text" && value === true),
  };
}

function publishSummary(intents, replaced, usedFallback) {
  const labels = [];
  if (replaced) labels.push("按指定内容完成替换");
  if (intents.concise) labels.push("压缩篇幅，保留核心信息");
  if (intents.detailed) labels.push("补充判断步骤和使用场景");
  if (intents.lively) labels.push("增强小红书式口语节奏");
  if (intents.emojiMore) labels.push("适量增加 Emoji 视觉停顿");
  if (intents.emojiLess) labels.push("减少 Emoji，保持清爽");
  if (intents.interaction) labels.push("增加自然的评论区互动");
  if (intents.beginner) labels.push("降低新手理解门槛");
  if (intents.restrained) labels.push("收敛语气，避免过度承诺");
  if (usedFallback) labels.push("未命中具体词，已按清晰、口语化方向重组");
  return labels.join("；");
}

function stripContentEmoji(value) {
  return value.replace(/[😵‍💫👇💡✅🎮📌✨]/gu, "").replace(/ {2,}/g, " ");
}

function buildPublishBody(intents) {
  const lively = intents.lively && !intents.restrained;
  const useEmoji = !intents.emojiLess;
  const emoji = (value) => (useEmoji ? value : "");
  const hook = lively
    ? `铲友们，装备表一打开就头大？我把最容易卡住的地方拆明白了${emoji("😵‍💫")}`
    : `铲友们，装备合成表是不是一打开就头大？${emoji("😵‍💫")}`;
  const intro = intents.beginner
    ? "不用背整张表，新手先弄懂“怎么合、给谁用、没有时怎么换”这 3 件事。"
    : "这篇不要求背整张表，先把合成、分配和平替逻辑理清。";
  const steps = [
    "① 基础合成：先认散件，再看它们能合成什么",
    "② 装备分配：输出装给主 C，坦装优先照顾前排",
    "③ 替代装备：没拿到推荐装，就找功能接近的平替",
  ];
  if (intents.detailed) {
    steps.push("④ 实战判断：伤害够不够、启动快不快、前排站不站得住，要一起看");
  }

  if (intents.concise) {
    const conciseBody = `${hook}\n${intro}\n\n${emoji("📌")}先定主 C，再看伤害类型；伤害够了补启动，最后检查前排。\n\n资料整理版，配方按已确认素材整理；版本结论请以当前游戏为准。`;
    return intents.emojiLess ? stripContentEmoji(conciseBody) : conciseBody;
  }

  const interaction = intents.interaction || lively
    ? "你最容易卡在“怎么合”还是“给谁用”？评论区聊聊～"
    : "如果你也总在合成和分配之间纠结，可以按这 4 步逐项检查。";
  const extraEmoji = intents.emojiMore ? `${emoji("✨")}照着图一项项对，不用一次全背下来。\n\n` : "";
  const body = `${hook}\n${intro}\n\n${emoji("👇")}先抓住这 3 件事：\n${steps.join("\n")}\n\n${extraEmoji}${emoji("💡")}一句口诀：先定主 C，再看伤害类型；伤害够了补启动，最后检查前排能不能站住。\n\n这篇是资料整理版，配方按已确认素材整理；版本数值和强度结论请以当前游戏为准。\n${interaction}`;
  return intents.emojiLess ? stripContentEmoji(body) : body;
}

export function rewritePublishBody(currentBody, suggestion = "更有小红书网感") {
  const intents = analyzePublishSuggestion(suggestion);
  const replacement = intents.text.match(/把[“\"]?(.+?)[”\"]?(?:改成|换成|替换成)[“\"]?(.+?)[”\"]?$/);
  if (replacement?.[1] && replacement?.[2]) {
    return {
      body: String(currentBody || "").replaceAll(replacement[1].trim(), replacement[2].trim()),
      mode: "matched",
      summary: publishSummary(intents, true, false),
    };
  }

  const usedFallback = !intents.matched;
  return {
    body: buildPublishBody(intents),
    mode: usedFallback ? "fallback" : "matched",
    summary: publishSummary(intents, false, usedFallback),
  };
}

export function nextRoute(current) {
  const index = routes.indexOf(current);
  return routes[Math.min(index + 1, routes.length - 1)];
}
