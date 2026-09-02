---
type: data-and-ai-schema
status: confirmed-direction
sync_status: synced
synced_at: 2026-08-19
target_path: 产品探索/数据结构与AI输出Schema-v0.1.md
version: 0.1
created: 2026-08-19
updated: 2026-08-19
tags:
  - 数据结构
  - AI-Schema
  - TypeScript
  - MVP
---

# 数据结构与 AI 输出 Schema v0.1

> 本文定义产品数据语义与 AI 输出边界。开发时以 TypeScript 类型＋Zod 为单一校验来源，再由 Zod 生成 JSON Schema；不要同时手工维护三套不同定义。

## 1. 设计原则

- 所有持久化对象包含 `id`、`schemaVersion`、`createdAt`、`updatedAt`。
- 游戏事实必须绑定地区、模式、版本或明确的未知状态。
- 事实可信度按字段计算，不给整张卡粗暴标绿。
- 保留来源网页与来源家族信息用于追溯和去重，但不再把两个独立来源设为进入研究的门槛。
- AI 只能返回引用 ID，不能凭空生成来源、素材路径或事实 ID。
- 用户修改、锁页、人工确认和 AI 生成值分层保存，不能互相覆盖。
- 页面只保存结构化内容与素材引用；最终 PNG 不作为可编辑真相源。
- 所有模型输出先校验，失败自动修复或重试一次；失败后保留旧数据。

## 2. 通用基础类型

```ts
type ISODateTime = string;
type Id = string;

interface EntityBase {
  id: Id;
  schemaVersion: 1;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

type GameId = "jcc";
type Region = "CN" | "GLOBAL" | "UNKNOWN";
type GameMode = "standard" | "ranked" | "special" | "all-common-recipes" | "unknown";

interface VersionScope {
  game: GameId;
  region: Region;
  mode: GameMode;
  patch?: string;
  season?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  capturedAt: ISODateTime;
  status: "current" | "historical" | "unknown";
}
```

## 3. 创作项目与输入

```ts
type ContentType =
  | "evergreen_beginner"
  | "version_hotspot"
  | "lineup_guide"
  | "experience_opinion"
  | "advertisement";

interface CreationProject extends EntityBase {
  title: string;
  status:
    | "input"
    | "research"
    | "viewpoint_selected"
    | "outline_approved"
    | "editing"
    | "export_ready"
    | "published"
    | "reviewed"
    | "archived";
  contentType: ContentType;
  auxiliaryTypes: ContentType[];
  versionScope: VersionScope;
  inputBatchIds: Id[];
  sourceIds: Id[];
  researchBriefId?: Id;
  outlineId?: Id;
  documentId?: Id;
  publishPackageId?: Id;
  selectedMainViewpointId?: Id;
  selectedReminderId?: Id;
  accountName?: string;
}

interface InputBatch extends EntityBase {
  projectId: Id;
  batchNumber: number;
  ideaText?: string;
  links: InputLink[];
  screenshots: InputFile[];
  pastedTexts: PastedText[];
  status: "queued" | "processing" | "partial" | "complete" | "failed";
}

interface InputLink {
  id: Id;
  url: string;
  extractionStatus: "pending" | "success" | "failed" | "fallback_used";
  failureReason?: string;
  replacementUrl?: string;
}

interface InputFile {
  id: Id;
  localRef: string;
  mimeType: string;
  sha256?: string;
  ocrStatus: "pending" | "recognized" | "user_confirmed" | "failed";
}

interface PastedText {
  id: Id;
  text: string;
  originalLinkId?: Id;
  label: "user_pasted_original_copy" | "manual_note" | "subtitle";
}
```

校验规则：单批 `links.length <= 5`、`screenshots.length <= 10`；超出部分必须在 UI 中形成下一批，不能截断或丢弃。

## 4. 任务理解卡

```ts
interface TaskUnderstanding extends EntityBase {
  projectId: Id;
  problemToSolve: string;
  inferredPrimaryType: ContentType;
  identifiedSourceIds: Id[];
  failedInputIds: Id[];
  missingInformation: MissingInfoQuestion[];
  userEdits?: Record<string, unknown>;
  confirmedAt?: ISODateTime;
}

interface MissingInfoQuestion {
  id: Id;
  question: string;
  whyItMatters: string;
  recommendedAnswer?: string;
  recommendationLabel: "system_suggestion";
  userAnswer?: string;
  status: "unanswered" | "answered" | "skipped_unknown";
}
```

AI 最多返回 3 个问题。`recommendedAnswer` 永远不能自动写入 `userAnswer`。

## 5. 来源与来源家族

```ts
type SourceType =
  | "official_announcement"
  | "in_game_encyclopedia"
  | "public_data_site"
  | "creator_content"
  | "player_community"
  | "overseas_tft"
  | "user_upload";

interface SourceRecord extends EntityBase {
  sourceType: SourceType;
  title: string;
  url?: string;
  canonicalUrl?: string;
  author?: string;
  publisher?: string;
  publishedAt?: ISODateTime;
  collectedAt: ISODateTime;
  versionScope: VersionScope;
  sourceFamilyId: Id;
  extractionStatus: "full" | "partial" | "failed";
  cacheRef?: string;
  cacheFingerprint?: string;
  necessaryExcerpts: SourceExcerpt[];
  usageBoundary: string[];
  rightsRisk: "low" | "medium" | "high" | "unknown";
  incompleteReason?: string;
}

interface SourceFamily extends EntityBase {
  label: string;
  rootSourceId?: Id;
  memberSourceIds: Id[];
  relationship: "independent" | "same_origin" | "suspected_same_origin";
  relationshipReason: string;
  manuallySplit?: boolean;
  splitEvidence?: string;
}

interface SourceExcerpt {
  text: string;
  locator?: string; // 段落、页码或视频时间戳
  purpose: "fact_evidence" | "viewpoint" | "style_method";
}
```

同源公开替代页、用户粘贴副本、截图与原链接默认共用一个 `sourceFamilyId`。`extractionStatus: failed` 的来源不能进入事实证据或观点蒸馏。

## 6. 字段级事实与证据

```ts
type VerificationStatus =
  | "green_verified"
  | "yellow_unverified"
  | "yellow_stale"
  | "yellow_suspected_same_source"
  | "red_conflict"
  | "red_prohibited";

type FactFieldKind =
  | "recipe"
  | "full_effect"
  | "function_label"
  | "position_tag"
  | "recommended_item"
  | "replacement_item"
  | "rating"
  | "lineup_position"
  | "operation_timing"
  | "metric";

interface FactField<T = unknown> extends EntityBase {
  entityType: "equipment" | "hero" | "trait" | "lineup" | "patch";
  entityId: Id;
  fieldKind: FactFieldKind;
  value: T;
  versionScope: VersionScope;
  verificationStatus: VerificationStatus;
  evidenceLinks: EvidenceLink[];
  sourceFamilyCount: number;
  derivedFromFactIds: Id[];
  derivationNote?: string;
  verifiedAt?: ISODateTime;
  staleReason?: string;
  conflictGroupId?: Id;
}

interface EvidenceLink {
  sourceId: Id;
  sourceFamilyId: Id;
  excerptLocator?: string;
  supports: "supports" | "contradicts" | "context_only";
  note?: string;
}
```

### 状态计算

- 绿：至少一个用户提供的公开网页已成功解析或完成手动补充，可以进入选题与研究链。
- 黄：页面日期、地区／模式／版本未知，或具体数值可能过期；不阻止继续创作，但发布前提示核对。
- 红：来源直接冲突且无法消解，或属于未经证实爆料等禁止内容。
- 推导字段继承所有依赖事实中的最低状态；`function_label` 和抽象 `position_tag` 可以透明推导，但必须保存 `derivedFromFactIds` 与 `derivationNote`。
- 用户只改措辞时保留状态；语义发生变化时创建新的黄色候选值，不能直接覆盖已核验值。

## 7. 装备与阵容知识实体

```ts
interface Equipment extends EntityBase {
  game: GameId;
  canonicalName: string;
  aliases: string[];
  category: "component" | "regular_completed" | "special";
  iconAssetId: Id;
  recipeFactId?: Id;
  effectFactId?: Id;
  functionLabelFactIds: Id[];
  positionTagFactIds: Id[];
  replacementFactIds: Id[];
  ratingFactId?: Id;
}

interface Lineup extends EntityBase {
  name: string;
  versionScope: VersionScope;
  heroIds: Id[];
  traitIds: Id[];
  positionFactIds: Id[];
  equipmentAssignmentFactIds: Id[];
  operationTimingFactIds: Id[];
  metricFactIds: Id[];
}

interface Asset extends EntityBase {
  kind: "equipment_icon" | "hero_icon" | "background" | "screenshot" | "preview";
  path: string;
  sourceId?: Id;
  width?: number;
  height?: number;
  sha256?: string;
  rightsRisk: "low" | "medium" | "high" | "unknown";
  aiGenerated: boolean;
  mustPreserveOriginal: boolean;
}
```

官方图标 `mustPreserveOriginal: true`，不允许图片模型重绘、改色或变形。

## 8. 选题评分

```ts
interface TopicScores {
  heat: number;
  growth: number;
  timeliness: number;
  differentiation: number;
  evidence: number;
  accountFit: number;
  composite: number;
  weights: {
    heat: number;
    growth: number;
    timeliness: number;
    differentiation: number;
    evidence: number;
    accountFit: number;
  };
  explanations: Record<keyof Omit<TopicScores, "composite" | "weights" | "explanations">, string>;
}

interface EvergreenSignals {
  searchDemand: number;
  saveValue: number;
  longevity: number;
  beginnerPain: number;
}

interface TopicCandidate extends EntityBase {
  titleDirection: string;
  primaryType: ContentType;
  sourceIds: Id[];
  scores: TopicScores;
  evergreenSignals?: EvergreenSignals;
  whyNow: string[];
  differentiationAngle: string;
  candidateViewpoints: string[];
  evidenceFactIds: Id[];
  risks: string[];
  materialDifficulty: "low" | "medium" | "high";
  cooldownUntil?: ISODateTime;
  rejectedReason?: string;
}
```

分数范围为整数 0～100，综合分必须由程序按权重计算，AI 只返回子分和解释，不能直接决定最终综合分。

## 9. 研究简报与观点

```ts
interface Viewpoint extends EntityBase {
  claim: string;
  suitableFor: string[];
  evidenceFactIds: Id[];
  sourceIds: Id[];
  controversy: "none" | "limited" | "high";
  risks: string[];
}

interface SupplementaryReminder extends EntityBase {
  kind: "applicability_boundary" | "controversy_warning" | "counterexample";
  text: string;
  relatedViewpointId: Id;
  evidenceFactIds: Id[];
  suggestedPageRole?: string;
}

interface ResearchBrief extends EntityBase {
  projectId: Id;
  whyWorthDoing: string[];
  viewpointIds: Id[];
  systemRecommendedViewpointId?: Id;
  recommendationReason?: string;
  keyFactIds: Id[];
  unresolvedIssues: string[];
  sourceIds: Id[];
}
```

AI 可以推荐但不能写入 `CreationProject.selectedMainViewpointId`。只有用户确认操作可以设置该字段。

## 10. 七页大纲

```ts
type TemplateId = "evergreen_tutorial_7p" | "version_guide_7p";

interface ContentOutline extends EntityBase {
  projectId: Id;
  templateId: TemplateId;
  mainViewpointId: Id;
  reminderId?: Id;
  status: "draft" | "approved" | "superseded";
  pages: OutlinePage[];
}

interface OutlinePage {
  pageNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  role: string;
  objective: string;
  keyPoints: string[];
  requiredFactIds: Id[];
  requiredAssetIds: Id[];
  reminderId?: Id;
}
```

固定为 7 页且页码唯一。补充提醒最多一个，只能绑定一页，不得生成独立页面。

## 11. 可编辑七页文档

```ts
interface SevenPageDocument extends EntityBase {
  projectId: Id;
  outlineId: Id;
  templateId: TemplateId;
  mainViewpointId: Id;
  seriesName?: string;
  accountName?: string;
  pages: ContentPage[];
  themeId: string;
  activeVersionId: Id;
}

interface ContentPage {
  id: Id;
  pageNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  pageType: string;
  locked: boolean;
  fields: Record<string, EditableField<unknown>>;
  assetIds: Id[];
  factReferences: PageFactReference[];
  reminder?: ReminderBox;
  manualOrder?: Id[];
  orderReason?: string;
  layoutVariant: string;
}

interface EditableField<T> {
  aiValue: T;
  userValue?: T;
  effectiveValue: T;
  preserved: boolean;
  lastEditedBy: "ai" | "user";
  semanticStatus: "unchanged" | "wording_only" | "meaning_changed_pending_review";
}

interface PageFactReference {
  factId: Id;
  fieldPath: string;
  usage: "displayed" | "layout_only" | "internal_context";
}

interface ReminderBox {
  kind: "applicability_boundary" | "controversy_warning" | "counterexample" | "pitfall";
  text: EditableField<string>;
}
```

`effectiveValue` 由程序计算：存在 `userValue` 时优先用户值，否则使用 `aiValue`。模型重写只能更新 `preserved: false` 且页面未锁定的 `aiValue`。

Phase A 无依赖原型暂以 `ContentPage.preservedFields: string[]` 保存字段路径，例如 `title`、`subtitle`、`items.0.detail`。导出时随页面写入 JSON；迁移到正式 Schema 后再映射为各字段的 `EditableField.preserved`，语义保持不变。导出正文使用 `copy.preserved` 保存整体保护状态。

Phase A 的装备卡人工顺序暂以 `ContentPage.manualOrder: string[]` 保存装备名称。排序时同步重映射 `preservedFields` 的装备索引，避免保留状态串到其他装备；迁移到正式 Schema 后将名称替换为稳定装备 ID。

## 12. 首篇装备页专用结构

```ts
interface EquipmentCardContent {
  equipmentId: Id;
  name: string;
  iconAssetId: Id;
  recipeFactId: Id;
  functionLabelFactId: Id;
  positionTagFactIds: Id[]; // 1～2 个
}

interface EquipmentFunctionPage {
  question: EditableField<string>;
  cards: EquipmentCardContent[]; // 固定 3 张
  pitfallReminder: EditableField<string>;
  manualOrder?: Id[];
}
```

首篇不得包含具体英雄、替代装备和推荐等级字段。模型即使返回也应被 Schema 拒绝或在适配层剔除并记录警告。

## 13. 版本与页面影响

```ts
interface ImpactAnalysis extends EntityBase {
  projectId: Id;
  trigger: "main_viewpoint_changed" | "patch_changed" | "fact_replaced";
  oldReferenceId: Id;
  newReferenceId: Id;
  affectedPages: PageImpact[];
}

interface PageImpact {
  pageId: Id;
  affectedFieldPaths: string[];
  reasons: string[];
  conflictWithUserEdit: boolean;
  userDecision?: "keep" | "regenerate";
}
```

未受影响页面不进入重生成请求。用户决定前不能更新现有页面。

## 14. 导出检查

```ts
type ExportBlockerType =
  | "fact_unverified"
  | "fact_conflict"
  | "viewpoint_conflict"
  | "version_stale"
  | "missing_asset"
  | "low_resolution_asset"
  | "text_overflow"
  | "font_not_loaded";

interface ExportIssue {
  id: Id;
  severity: "block" | "warning";
  type: ExportBlockerType;
  pageId?: Id;
  objectId?: Id;
  fieldPath?: string;
  message: string;
  fixAction: "jump_to_field" | "replace_fact" | "replace_asset" | "regenerate" | "wait";
}

interface ExportCheckResult {
  checkedAt: ISODateTime;
  canExportOfficial: boolean;
  canExportInternalDraft: boolean;
  issues: ExportIssue[];
}
```

仅 `usage: displayed` 的黄色或红色事实影响正式导出。黄色允许带水印内部草稿；红色不允许进入生成。

## 15. 发布包与复盘

```ts
interface TitleCandidate {
  id: Id;
  type: "search_keyword" | "pain_resonance" | "save_value";
  text: string;
  keywords: string[];
  attractionReason: string;
  exaggerationRisk: "low" | "medium" | "high";
  evidenceFactIds: Id[];
  manuallyEdited: boolean;
  generatedForContentType: ContentType;
}

interface PublishPackage extends EntityBase {
  projectId: Id;
  selectedTitleId?: Id;
  titleCandidates: TitleCandidate[];
  body: EditableField<string>;
  hashtags: EditableField<string[]>;
  pngFileNames: string[];
  zipFileName?: string;
  structuredDraftFileName: string;
}

interface PublishedReview extends EntityBase {
  projectId: Id;
  publishedAt: ISODateTime;
  reviewWindow: "7d";
  screenshotAssetIds: Id[];
  ocrStatus: "pending" | "recognized" | "user_confirmed" | "rejected";
  metrics: Partial<Record<
    "views" | "likes" | "saves" | "comments" | "shares" | "followers" | "coverCtr" | "profileVisits" | "searchShare",
    number
  >>;
  attribution: {
    topic?: string;
    title?: string;
    cover?: string;
    content?: string;
    publishTime?: string;
  };
  commentClusters: CommentCluster[];
  generatedTopicCandidateIds: Id[];
  isAdvertisement: boolean;
  anonymizedForDemo: boolean;
}

interface CommentCluster {
  type: "question" | "objection" | "extra_experience" | "emotion";
  summary: string;
  count?: number;
  sourceCommentRefs: string[];
}
```

## 16. 偏好学习信号

```ts
interface PreferenceSignal extends EntityBase {
  projectId: Id;
  type: "title_edit" | "page_lock" | "page_rewrite" | "page_delete" | "card_reorder" | "tag_edit";
  contentType: ContentType;
  contextKey?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  eligibleForLongTermLearning: boolean;
  isAdvertisement: boolean;
}

interface PreferenceRule extends EntityBase {
  type: "title" | "card_order" | "voice" | "cover";
  contentType?: ContentType;
  contextKey?: string;
  evidenceSignalIds: Id[];
  minimumSignalCount: number;
  userConfirmed: boolean;
  rule: string;
}
```

标题和排序至少 3 个同类信号再请求确认；封面至少 5 篇同类样本。广告信号 `eligibleForLongTermLearning` 必须为 `false`。

## 17. Obsidian 写入任务

```ts
interface ObsidianWriteOperation {
  targetRelativePath: string;
  operation: "create" | "append_confirmed_section" | "create_diff";
  frontmatter: Record<string, unknown>;
  markdown: string;
  relatedEntityIds: Id[];
}

interface ObsidianWriteBatch extends EntityBase {
  projectId: Id;
  operations: ObsidianWriteOperation[];
  reviewStatus: "pending" | "partially_approved" | "approved" | "written" | "failed";
  selectedOperationIndexes: number[];
  failureReason?: string;
  fallbackDownloadPath?: string;
}
```

AI 不得请求 `delete` 或直接覆盖已确认笔记。已有事实变化只能 `create_diff`。

## 18. AI 任务统一信封

所有 AI 接口采用同一外层结构：

```ts
interface AiTaskRequest<T> {
  taskId: Id;
  taskType:
    | "understand_input"
    | "extract_source"
    | "ocr_image"
    | "distill_research"
    | "score_topics"
    | "generate_outline"
    | "generate_pages"
    | "rewrite_fields"
    | "analyze_impact"
    | "generate_publish_copy"
    | "analyze_review";
  schemaVersion: 1;
  locale: "zh-CN";
  input: T;
  allowedSourceIds: Id[];
  allowedFactIds: Id[];
  allowedAssetIds: Id[];
}

interface AiTaskResponse<T> {
  taskId: Id;
  schemaVersion: 1;
  result: T;
  warnings: string[];
  usedSourceIds: Id[];
  usedFactIds: Id[];
  usedAssetIds: Id[];
  unknowns: string[];
}
```

### 全局拒绝条件

- 返回请求允许列表之外的来源、事实或素材 ID。
- 新增不可追溯的精确数字、胜率、上分结果或个人实测。
- 把 `unknown` 自动补成确定内容。
- 返回超过模板允许数量的页面、卡片、数字或补充观点。
- 修改锁定页、已保留字段或文章级主要观点。

## 19. 各 AI 任务最小输出

### `understand_input`

返回 `problemToSolve`、`inferredPrimaryType`、已识别输入、失败输入、最多 3 个缺失问题；不做事实结论。

### `distill_research`

返回 `whyWorthDoing`、2～3 个观点、证据引用、争议和推荐理由；不得替用户选定观点。

### `score_topics`

返回六项子分与每项解释；综合分由服务端计算。证据不足时降低分数并写入 `unknowns`，不能编造代理数据。

### `generate_outline`

固定返回 7 页；每页必须关联页面任务和事实 ID。补充提醒最多一个且绑定最相关页面。

### `generate_pages`

只返回模板允许字段。首篇装备功能页固定 3 张卡，定位标签最多 2 个，不能返回具体英雄和平替。

### `rewrite_fields`

请求中显式列出可改字段路径；响应只能返回这些路径的新 `aiValue`。任何越界字段导致整次响应拒绝。

### `analyze_impact`

只返回受影响页面、字段和原因，不直接写入页面。

Phase A 已用只读模拟实现这一约束：影响分析不写入草稿，也不进入持久化存储；确认时只把用户勾选的受影响页面 ID 交给整篇重写。若分析后页面内容或建议发生变化，旧分析立即失效，必须重新预览。

观点切换复用同一约束，并把结果分为 `aligned`、`rewrite`、`conflict`。普通 `rewrite` 允许用户逐页保留或重写；`conflict` 必须重写。若冲突页被锁定，切换观点时只记录 `viewpointConflicts`，不覆盖页面；正式图片导出保持阻塞，直到用户解锁并重新处理。冲突记录只保存页面 ID、目标观点 ID 和原因，不保存临时影响预览。

### `generate_publish_copy`

返回 3 个不同类型标题、150～250 字正文和 5～8 个相关标签；无证据时禁止事实型结果承诺。

### `analyze_review`

只基于用户确认后的 OCR 指标和评论内容生成归因候选；必须用“可能”表达，不把相关性写成因果。

## 20. 本地存储划分

### IndexedDB

- `projects`
- `inputBatches`
- `draftDocuments`
- `draftVersions`
- `publishPackages`
- `pendingWriteBatches`

Phase A／B 无依赖原型暂用本地存储模拟 `draftVersions`：`past` 和 `future` 各最多 20 个自动版本，`saved` 保存不限数量的命名存档，`deletedSaved` 暂存刚删除且可撤销的命名存档。命名存档支持改名和按 `workflow.route` 筛选；只有 `saved` 可删除，自动版本仍由 20 个上限滚动清理。迁移到 IndexedDB 时保持这些字段语义不变。

### 服务端临时数据

- AI／搜索任务状态与限额。
- 必要的短期处理缓存。
- 不存 Vault 全量内容和最终高清 PNG。

### 项目素材目录

- 官方图标、预置背景、用户上传素材、原文缓存和高清输出。

### Obsidian

- 只写确认后的长期知识和必要的历史引用。

## 21. Schema 迁移

- 所有本地对象使用 `schemaVersion: 1`。
- 读取旧版本时先复制备份，再执行单向迁移；迁移失败保留原数据并提示导出项目包。
- 新增可选字段可以保持版本不变；重命名、删除、改变语义或枚举值时必须升级版本。

## 22. 开发验收

- [ ] Zod 可以验证所有 AI 输出，错误能定位到具体字段。
- [ ] 模型不能修改锁页、保留字段和未授权路径。
- [ ] 综合分由程序计算，不信任模型返回值。
- [ ] 导出检查能沿 `PageFactReference` 找到实际展示事实。
- [ ] 单个可读来源无需第二站点即可进入研究，来源家族仍用于追溯和去重。
- [ ] Obsidian 写入不包含删除与静默覆盖操作。
- [ ] 项目包导出后可以在空浏览器中重新导入并恢复七页编辑状态。

## 23. 关联文档

- [[产品探索/MVP产品需求文档-PRD-v0.1]]
- [[产品探索/技术架构-v0.1]]
- [[产品探索/七页图文生成与渲染架构-v0.1]]
- [[游戏版本与事实库/索引]]
- [[来源与博主档案/来源内容存储边界-v0.1]]
