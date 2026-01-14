import { buildGroupingPlan } from "./lib/grouping.js";
import { sortTabsMostRecentFirst } from "./lib/sort.js";

function promisifyChrome(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

const api = {
  tabsQuery: (q) => promisifyChrome(chrome.tabs.query, q),
  tabsMove: (tabIds, moveProps) => promisifyChrome(chrome.tabs.move, tabIds, moveProps),
  tabsRemove: (tabIds) => promisifyChrome(chrome.tabs.remove, tabIds),
  windowsCreate: (createData) => promisifyChrome(chrome.windows.create, createData),
  windowsRemove: (windowId) => promisifyChrome(chrome.windows.remove, windowId),
  storageLocalGet: (keys) => promisifyChrome(chrome.storage.local.get, keys),
};

const DEFAULT_OPTIONS = {
  threshold: 5,
  includePinned: false,
  closeEmptyWindows: true,
};

async function getOptions() {
  const stored = await api.storageLocalGet(DEFAULT_OPTIONS);
  return {
    threshold: Number.isFinite(stored.threshold) ? stored.threshold : 5,
    includePinned: stored.includePinned === true,
    closeEmptyWindows: stored.closeEmptyWindows !== false,
  };
}

function toMovableTabIds(tabs) {
  return tabs.map((t) => t.id).filter((id) => Number.isFinite(id));
}

async function safeMoveTabsToWindow(tabIds, windowId) {
  if (!tabIds.length) return;
  try {
    await api.tabsMove(tabIds, { windowId, index: -1 });
  } catch {
    // Fallback: move individually, ignoring failures for restricted URLs.
    for (const id of tabIds) {
      try {
        await api.tabsMove(id, { windowId, index: -1 });
      } catch {
        // ignore
      }
    }
  }
}

async function createEmptyWindow() {
  // Chrome will create one tab by default; we'll remove it after moving real tabs.
  const win = await api.windowsCreate({ focused: false });
  const placeholderTabId = win?.tabs?.[0]?.id ?? null;
  return { windowId: win.id, placeholderTabId };
}

async function removePlaceholderTab(placeholderTabId) {
  if (!Number.isFinite(placeholderTabId)) return;
  try {
    await api.tabsRemove(placeholderTabId);
  } catch {
    // ignore
  }
}

async function reorderWindowTabsMostRecentFirst(windowId) {
  const tabs = await api.tabsQuery({ windowId });
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs.filter((t) => !t.pinned);
  const sorted = sortTabsMostRecentFirst(unpinned);
  const sortedIds = sorted.map((t) => t.id).filter((id) => Number.isFinite(id));
  if (!sortedIds.length) return;
  try {
    // Place unpinned tabs immediately after pinned tabs.
    await api.tabsMove(sortedIds, { windowId, index: pinned.length });
  } catch {
    // ignore; sorting is best-effort
  }
}

async function buildPreview() {
  const options = await getOptions();
  const tabs = await api.tabsQuery({});
  const plan = await buildGroupingPlan(tabs, options);

  return {
    domainWindowCount: plan.dedicated.length,
    miscTabCount: plan.misc.length,
    ignoredTabCount: plan.ignored.length,
    options,
    topDomains: plan.dedicated.slice(0, 10).map((g) => ({
      domain: g.domain,
      count: g.tabs.length,
    })),
  };
}

async function organizeNow() {
  const options = await getOptions();
  const tabs = await api.tabsQuery({});
  const plan = await buildGroupingPlan(tabs, options);

  const sourceWindowIds = new Set(
    [...plan.dedicated.flatMap((g) => g.tabs), ...plan.misc]
      .map((t) => t.windowId)
      .filter((id) => Number.isFinite(id)),
  );

  // Create destination windows
  const destinations = [];
  for (const group of plan.dedicated) {
    const { windowId, placeholderTabId } = await createEmptyWindow();
    destinations.push({ kind: "domain", key: group.domain, windowId, placeholderTabId, tabs: group.tabs });
  }

  let miscDest = null;
  if (plan.misc.length > 0) {
    const { windowId, placeholderTabId } = await createEmptyWindow();
    miscDest = { kind: "misc", windowId, placeholderTabId, tabs: plan.misc };
  }

  const destinationWindowIds = new Set(destinations.map((d) => d.windowId));
  if (miscDest) destinationWindowIds.add(miscDest.windowId);

  // Move tabs
  for (const dest of destinations) {
    const tabIds = toMovableTabIds(dest.tabs);
    await safeMoveTabsToWindow(tabIds, dest.windowId);
    await removePlaceholderTab(dest.placeholderTabId);
    await reorderWindowTabsMostRecentFirst(dest.windowId);
  }
  if (miscDest) {
    const tabIds = toMovableTabIds(miscDest.tabs);
    await safeMoveTabsToWindow(tabIds, miscDest.windowId);
    await removePlaceholderTab(miscDest.placeholderTabId);
    await reorderWindowTabsMostRecentFirst(miscDest.windowId);
  }

  // Close now-empty old windows (best-effort, safety-checked).
  if (options.closeEmptyWindows) {
    const emptyLikeUrls = new Set(["chrome://newtab/", "about:blank"]);
    for (const winId of sourceWindowIds) {
      if (destinationWindowIds.has(winId)) continue;
      try {
        const remaining = await api.tabsQuery({ windowId: winId });
        if (remaining.length === 0) {
          await api.windowsRemove(winId);
          continue;
        }
        if (
          remaining.length === 1 &&
          !remaining[0].pinned &&
          typeof remaining[0].url === "string" &&
          emptyLikeUrls.has(remaining[0].url)
        ) {
          await api.windowsRemove(winId);
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    movedDomainWindows: destinations.length,
    movedMiscTabs: miscDest?.tabs?.length ?? 0,
    ignoredTabs: plan.ignored.length,
    options,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (msg.type === "preview") {
      const data = await buildPreview();
      sendResponse({ ok: true, data });
      return;
    }

    if (msg.type === "organize") {
      const data = await organizeNow();
      sendResponse({ ok: true, data });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  })().catch((e) => {
    sendResponse({ ok: false, error: e?.message || String(e) });
  });

  return true;
});

