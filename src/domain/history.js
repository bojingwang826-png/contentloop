export const HISTORY_LIMIT = 20;

function clone(value) {
  return structuredClone(value);
}

function createId(createdAt) {
  return `version-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyHistory(limit = HISTORY_LIMIT) {
  return { past: [], future: [], saved: [], deletedSaved: [], limit };
}

export function normalizeHistory(history) {
  const limit = Number.isInteger(history?.limit) && history.limit > 0
    ? history.limit
    : HISTORY_LIMIT;
  const validSnapshot = (snapshot) => (
    snapshot
    && typeof snapshot.id === "string"
    && typeof snapshot.label === "string"
    && Array.isArray(snapshot.pages)
    && snapshot.pages.length === 7
  );

  return {
    past: Array.isArray(history?.past) ? history.past.filter(validSnapshot).slice(-limit) : [],
    future: Array.isArray(history?.future) ? history.future.filter(validSnapshot).slice(-limit) : [],
    saved: Array.isArray(history?.saved) ? history.saved.filter(validSnapshot) : [],
    deletedSaved: Array.isArray(history?.deletedSaved)
      ? history.deletedSaved.filter(validSnapshot).slice(-limit)
      : [],
    limit,
  };
}

export function normalizeVersionLabel(label, fallback = "未命名存档") {
  const normalized = typeof label === "string" ? label.trim().replace(/\s+/g, " ") : "";
  return (normalized || fallback).slice(0, 40);
}

export function createVersionSnapshot(
  pages,
  currentPageId,
  label = "自动保存",
  createdAt = new Date().toISOString(),
  id = createId(createdAt),
  workflow = null,
) {
  return {
    id,
    label,
    createdAt,
    currentPageId,
    pages: clone(pages),
    workflow: workflow ? clone(workflow) : null,
  };
}

export function checkpointHistory(
  history,
  pages,
  currentPageId,
  label,
  options = {},
) {
  const normalized = normalizeHistory(history);
  const snapshot = createVersionSnapshot(
    pages,
    currentPageId,
    label,
    options.createdAt,
    options.id,
    options.workflow,
  );
  return {
    ...normalized,
    past: [...normalized.past, snapshot].slice(-normalized.limit),
    future: [],
  };
}

export function saveHistoryVersion(
  history,
  pages,
  currentPageId,
  label,
  options = {},
) {
  const normalized = normalizeHistory(history);
  const snapshot = createVersionSnapshot(
    pages,
    currentPageId,
    normalizeVersionLabel(label),
    options.createdAt,
    options.id,
    options.workflow,
  );
  return {
    ...normalized,
    saved: [...normalized.saved, snapshot],
  };
}

export function renameSavedVersion(history, versionId, label) {
  const normalized = normalizeHistory(history);
  const nextLabel = normalizeVersionLabel(label, "");
  if (!nextLabel || !normalized.saved.some((version) => version.id === versionId)) return normalized;
  return {
    ...normalized,
    saved: normalized.saved.map((version) => (
      version.id === versionId ? { ...version, label: nextLabel } : version
    )),
  };
}

export function deleteSavedVersion(history, versionId, deletedAt = new Date().toISOString()) {
  const normalized = normalizeHistory(history);
  const target = normalized.saved.find((version) => version.id === versionId);
  if (!target) return normalized;
  return {
    ...normalized,
    saved: normalized.saved.filter((version) => version.id !== versionId),
    deletedSaved: [
      ...normalized.deletedSaved,
      { ...target, deletedAt },
    ].slice(-normalized.limit),
  };
}

export function restoreDeletedSavedVersion(history, versionId = "") {
  const normalized = normalizeHistory(history);
  const target = versionId
    ? normalized.deletedSaved.find((version) => version.id === versionId)
    : normalized.deletedSaved.at(-1);
  if (!target) return normalized;
  const { deletedAt, ...restored } = target;
  return {
    ...normalized,
    saved: normalized.saved.some((version) => version.id === restored.id)
      ? normalized.saved
      : [...normalized.saved, restored],
    deletedSaved: normalized.deletedSaved.filter((version) => version.id !== restored.id),
  };
}

export function dismissDeletedSavedVersion(history, versionId) {
  const normalized = normalizeHistory(history);
  return {
    ...normalized,
    deletedSaved: normalized.deletedSaved.filter((version) => version.id !== versionId),
  };
}

function unchanged(history, pages, currentPageId) {
  return {
    changed: false,
    history: normalizeHistory(history),
    pages,
    currentPageId,
    workflow: null,
    restored: null,
  };
}

export function undoHistory(history, pages, currentPageId, options = {}) {
  const normalized = normalizeHistory(history);
  if (normalized.past.length === 0) return unchanged(normalized, pages, currentPageId);

  const target = normalized.past.at(-1);
  const current = createVersionSnapshot(
    pages,
    currentPageId,
    "撤销前状态",
    options.createdAt,
    options.id,
    options.workflow,
  );

  return {
    changed: true,
    history: {
      ...normalized,
      past: normalized.past.slice(0, -1),
      future: [...normalized.future, current].slice(-normalized.limit),
    },
    pages: clone(target.pages),
    currentPageId: target.currentPageId,
    workflow: target.workflow ? clone(target.workflow) : null,
    restored: target,
  };
}

export function redoHistory(history, pages, currentPageId, options = {}) {
  const normalized = normalizeHistory(history);
  if (normalized.future.length === 0) return unchanged(normalized, pages, currentPageId);

  const target = normalized.future.at(-1);
  const current = createVersionSnapshot(
    pages,
    currentPageId,
    "重做前状态",
    options.createdAt,
    options.id,
    options.workflow,
  );

  return {
    changed: true,
    history: {
      ...normalized,
      past: [...normalized.past, current].slice(-normalized.limit),
      future: normalized.future.slice(0, -1),
    },
    pages: clone(target.pages),
    currentPageId: target.currentPageId,
    workflow: target.workflow ? clone(target.workflow) : null,
    restored: target,
  };
}

export function restoreHistoryVersion(
  history,
  pages,
  currentPageId,
  versionId,
  options = {},
) {
  const normalized = normalizeHistory(history);
  const target = [...normalized.saved, ...normalized.past]
    .find((snapshot) => snapshot.id === versionId);
  if (!target) return unchanged(normalized, pages, currentPageId);

  const current = createVersionSnapshot(
    pages,
    currentPageId,
    "恢复历史前状态",
    options.createdAt,
    options.id,
    options.workflow,
  );

  return {
    changed: true,
    history: {
      ...normalized,
      past: [...normalized.past, current].slice(-normalized.limit),
      future: [],
    },
    pages: clone(target.pages),
    currentPageId: target.currentPageId,
    workflow: target.workflow ? clone(target.workflow) : null,
    restored: target,
  };
}
