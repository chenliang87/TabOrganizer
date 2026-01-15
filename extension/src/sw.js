import { buildGroupingPlan } from "./lib/grouping.js";
import { sortTabsBySubdomainThenRecency } from "./lib/sort.js";
import { getRegistrableDomain } from "./lib/domain.js";

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
  tabsQuery: (q) => promisifyChrome(chrome.tabs.query.bind(chrome.tabs), q),
  tabsMove: (tabIds, moveProps) =>
    promisifyChrome(chrome.tabs.move.bind(chrome.tabs), tabIds, moveProps),
  tabsRemove: (tabIds) =>
    promisifyChrome(chrome.tabs.remove.bind(chrome.tabs), tabIds),
  tabsGroup: (opts) => promisifyChrome(chrome.tabs.group.bind(chrome.tabs), opts),
  tabsUngroup: (tabIds) =>
    promisifyChrome(chrome.tabs.ungroup.bind(chrome.tabs), tabIds),
  windowsCreate: (createData) =>
    promisifyChrome(chrome.windows.create.bind(chrome.windows), createData),
  windowsRemove: (windowId) =>
    promisifyChrome(chrome.windows.remove.bind(chrome.windows), windowId),
  tabGroupsUpdate: (groupId, updateProps) =>
    promisifyChrome(
      chrome.tabGroups.update.bind(chrome.tabGroups),
      groupId,
      updateProps,
    ),
  storageLocalGet: (keys) =>
    promisifyChrome(chrome.storage.local.get.bind(chrome.storage.local), keys),
};

const DEFAULT_OPTIONS = {
  threshold: 5,
  includePinned: false,
  closeEmptyWindows: true,
  closeDuplicateTabs: true,
  closeZoomJumpLinks: true,
  groupTabs: true,
};

async function getOptions() {
  const stored = await api.storageLocalGet(DEFAULT_OPTIONS);
  return {
    threshold: Number.isFinite(stored.threshold) ? stored.threshold : 5,
    includePinned: stored.includePinned === true,
    closeEmptyWindows: stored.closeEmptyWindows !== false,
    closeDuplicateTabs: stored.closeDuplicateTabs !== false,
    closeZoomJumpLinks: stored.closeZoomJumpLinks !== false,
    groupTabs: stored.groupTabs !== false,
  };
}

function isZoomJumpLinkUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;

    const host = u.hostname.toLowerCase();
    // Example from user: https://vivun.zoom.us/j/
    if (!(host === "zoom.us" || host.endsWith(".zoom.us"))) return false;

    const path = u.pathname || "/";
    // Join meeting pages (commonly used as calendar -> zoom app jump)
    return path === "/j" || path.startsWith("/j/");
  } catch {
    return false;
  }
}

async function closeZoomJumpLinksIfEnabled(tabs, options) {
  if (!options.closeZoomJumpLinks) return { closedCount: 0 };

  const includePinned = options.includePinned === true;
  /** @type {number[]} */
  const toClose = [];

  for (const tab of tabs) {
    if (!includePinned && tab.pinned) continue;
    if (isZoomJumpLinkUrl(tab.url) && Number.isFinite(tab.id)) {
      toClose.push(tab.id);
    }
  }

  if (toClose.length) {
    try {
      await api.tabsRemove(toClose);
    } catch {
      for (const id of toClose) {
        try {
          await api.tabsRemove(id);
        } catch {
          // ignore
        }
      }
    }
  }

  return { closedCount: toClose.length };
}

function normalizeUrlForDedupe(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const u = new URL(url);
    // Safe default: ignore hash fragments, keep query params.
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

function pickTabToKeep(tabs) {
  return tabs.reduce((best, t) => {
    const bl = Number.isFinite(best.lastAccessed) ? best.lastAccessed : 0;
    const tl = Number.isFinite(t.lastAccessed) ? t.lastAccessed : 0;
    if (tl !== bl) return tl > bl ? t : best;
    const bi = Number.isFinite(best.id) ? best.id : 0;
    const ti = Number.isFinite(t.id) ? t.id : 0;
    return ti < bi ? t : best;
  }, tabs[0]);
}

async function closeDuplicateTabsIfEnabled(tabs, options) {
  if (!options.closeDuplicateTabs) return { closedCount: 0, keptCount: 0 };

  const includePinned = options.includePinned === true;

  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byKey = new Map();
  for (const tab of tabs) {
    if (!includePinned && tab.pinned) continue;
    const key = normalizeUrlForDedupe(tab.url);
    if (!key) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(tab);
    else byKey.set(key, [tab]);
  }

  /** @type {number[]} */
  const toClose = [];
  let kept = 0;
  for (const group of byKey.values()) {
    if (group.length <= 1) continue;
    const keep = pickTabToKeep(group);
    kept += 1;
    for (const t of group) {
      if (t.id !== keep.id && Number.isFinite(t.id)) toClose.push(t.id);
    }
  }

  if (toClose.length) {
    try {
      await api.tabsRemove(toClose);
    } catch {
      for (const id of toClose) {
        try {
          await api.tabsRemove(id);
        } catch {
          // ignore
        }
      }
    }
  }

  return { closedCount: toClose.length, keptCount: kept };
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getHostnameFromTab(tab) {
  const u = safeUrl(tab.url || "");
  if (!u) return "";
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  return (u.hostname || "").toLowerCase();
}

function getSubdomainLabel(hostname, registrableDomain) {
  if (!hostname) return "";
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length === 0) return "";
  if (!registrableDomain) return parts[0];

  const rdParts = registrableDomain.split(".").filter(Boolean);
  if (parts.length > rdParts.length) return parts[0];
  return "";
}

async function groupWindowTabs(windowId, options) {
  if (!options.groupTabs) return;

  const tabs = await api.tabsQuery({ windowId });

  // Tab groups can't include pinned tabs, so always exclude them.
  const eligible = tabs.filter((t) => !t.pinned && Number.isFinite(t.id));
  if (eligible.length === 0) return;

  // Best-effort: ungroup existing groups so repeated runs don't accumulate.
  const alreadyGrouped = eligible
    .filter((t) => Number.isFinite(t.groupId) && t.groupId !== -1)
    .map((t) => t.id);
  if (alreadyGrouped.length) {
    try {
      await api.tabsUngroup(alreadyGrouped);
    } catch {
      // ignore
    }
  }

  /** @type {Map<string, { tabIds:number[], host:string, rd:string|null }>} */
  const byKey = new Map();
  for (const tab of eligible) {
    const host = getHostnameFromTab(tab);
    const rd = host ? (await getRegistrableDomain(host)) : null;
    // Prefer grouping by hostname (subdomain). If missing, fall back to domain.
    const key = host || rd || "other";
    const entry = byKey.get(key);
    if (entry) entry.tabIds.push(tab.id);
    else byKey.set(key, { tabIds: [tab.id], host, rd });
  }

  const keys = [...byKey.keys()];
  const singleKey = keys.length === 1 ? keys[0] : null;

  for (const [key, info] of byKey.entries()) {
    if (info.tabIds.length < 2) continue;
    try {
      const groupId = await api.tabsGroup({
        tabIds: info.tabIds,
        createProperties: { windowId },
      });

      let title = key;
      if (singleKey) {
        // If there's only one subdomain, use the base domain as requested.
        title = info.rd || info.host || key;
      } else {
        const sub = getSubdomainLabel(info.host, info.rd);
        title = sub || info.rd || info.host || key;
      }

      await api.tabGroupsUpdate(groupId, { title });
    } catch {
      // ignore
    }
  }
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
  const sorted = sortTabsBySubdomainThenRecency(unpinned);
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
  // Preview should not close anything; estimate duplicates instead.
  const dupCount = (() => {
    const includePinned = options.includePinned === true;
    const seen = new Map();
    let dups = 0;
    for (const tab of tabs) {
      if (!includePinned && tab.pinned) continue;
      const key = normalizeUrlForDedupe(tab.url);
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, tab);
      } else {
        dups += 1;
      }
    }
    return dups;
  })();

  const zoomJumpCount = (() => {
    if (!options.closeZoomJumpLinks) return 0;
    const includePinned = options.includePinned === true;
    let c = 0;
    for (const tab of tabs) {
      if (!includePinned && tab.pinned) continue;
      if (isZoomJumpLinkUrl(tab.url)) c += 1;
    }
    return c;
  })();

  const plan = await buildGroupingPlan(tabs, options);

  return {
    domainWindowCount: plan.dedicated.length,
    miscTabCount: plan.misc.length,
    ignoredTabCount: plan.ignored.length,
    duplicateTabCount: options.closeDuplicateTabs ? dupCount : 0,
    zoomJumpLinkCount: zoomJumpCount,
    options,
    topDomains: plan.dedicated.slice(0, 10).map((g) => ({
      domain: g.domain,
      count: g.tabs.length,
    })),
  };
}

async function organizeNow() {
  const options = await getOptions();
  const tabs0 = await api.tabsQuery({});
  const zoomClosed = await closeZoomJumpLinksIfEnabled(tabs0, options);
  const dedupe = await closeDuplicateTabsIfEnabled(tabs0, options);
  const tabs =
    zoomClosed.closedCount || dedupe.closedCount ? await api.tabsQuery({}) : tabs0;
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
    await groupWindowTabs(dest.windowId, options);
  }
  if (miscDest) {
    const tabIds = toMovableTabIds(miscDest.tabs);
    await safeMoveTabsToWindow(tabIds, miscDest.windowId);
    await removePlaceholderTab(miscDest.placeholderTabId);
    await reorderWindowTabsMostRecentFirst(miscDest.windowId);
    await groupWindowTabs(miscDest.windowId, options);
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
    closedDuplicateTabs: dedupe.closedCount,
    closedZoomJumpLinks: zoomClosed.closedCount,
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

