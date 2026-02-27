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
  tabsUpdate: (tabId, updateProps) =>
    promisifyChrome(chrome.tabs.update.bind(chrome.tabs), tabId, updateProps),
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
  tabGroupsGet: (groupId) =>
    promisifyChrome(chrome.tabGroups.get.bind(chrome.tabGroups), groupId),
  storageLocalGet: (keys) =>
    promisifyChrome(chrome.storage.local.get.bind(chrome.storage.local), keys),
};

function sortTabsByTitleAsc(tabs) {
  return [...tabs].sort((a, b) => {
    const ta = typeof a.title === "string" ? a.title : "";
    const tb = typeof b.title === "string" ? b.title : "";
    const cmp = ta.localeCompare(tb, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;

    const ua = typeof a.url === "string" ? a.url : "";
    const ub = typeof b.url === "string" ? b.url : "";
    const ucmp = ua.localeCompare(ub);
    if (ucmp !== 0) return ucmp;

    const ia = Number.isFinite(a.index) ? a.index : 0;
    const ib = Number.isFinite(b.index) ? b.index : 0;
    if (ia !== ib) return ia - ib;

    const ida = Number.isFinite(a.id) ? a.id : 0;
    const idb = Number.isFinite(b.id) ? b.id : 0;
    return ida - idb;
  });
}

function sortTabsByMostRecentDesc(tabs) {
  return [...tabs].sort((a, b) => {
    const la = Number.isFinite(a.lastAccessed) ? a.lastAccessed : 0;
    const lb = Number.isFinite(b.lastAccessed) ? b.lastAccessed : 0;
    if (lb !== la) return lb - la;

    const ia = Number.isFinite(a.index) ? a.index : 0;
    const ib = Number.isFinite(b.index) ? b.index : 0;
    if (ia !== ib) return ia - ib;

    const ida = Number.isFinite(a.id) ? a.id : 0;
    const idb = Number.isFinite(b.id) ? b.id : 0;
    return ida - idb;
  });
}

async function sortWindowTabs(windowId, mode) {
  const tabs = await api.tabsQuery({ windowId });
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs.filter((t) => !t.pinned);

  const sorted =
    mode === "title" ? sortTabsByTitleAsc(unpinned) : sortTabsByMostRecentDesc(unpinned);
  const sortedIds = sorted.map((t) => t.id).filter((id) => Number.isFinite(id));
  if (!sortedIds.length) return;

  // Place unpinned tabs immediately after pinned tabs.
  await api.tabsMove(sortedIds, { windowId, index: pinned.length });
}

const DEFAULT_OPTIONS = {
  threshold: 5,
  includePinned: false,
  closeEmptyWindows: true,
  closeDuplicateTabs: true,
  closeZoomJumpLinks: true,
  groupTabs: true,
  unpinForGrouping: false,
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
    unpinForGrouping: stored.unpinForGrouping === true,
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
  return (u.hostname || "").toLowerCase();
}

function getGroupKeyForTab(tab) {
  const u = safeUrl(tab.url || "");
  if (!u) return "other";
  const host = (u.hostname || "").toLowerCase();
  if (host) return host;
  // For hostless URLs (e.g. about:blank), group by protocol.
  return `${u.protocol}//`;
}

function getSubdomainLabel(hostname, registrableDomain) {
  if (!hostname) return "";
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length === 0) return "";
  if (!registrableDomain) return parts[0];

  const rdParts = registrableDomain.split(".").filter(Boolean);
  // Immediate label before the registrable domain:
  // dev.smith.langchain.com (rd=langchain.com) -> smith
  // mail.google.com (rd=google.com) -> mail
  if (parts.length > rdParts.length) {
    const idx = parts.length - rdParts.length - 1;
    return parts[idx] || "";
  }
  return "";
}

function getWikipediaLanguageFromHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!(h === "wikipedia.org" || h.endsWith(".wikipedia.org"))) return "";
  const parts = h.split(".").filter(Boolean);
  // en.wikipedia.org => ["en","wikipedia","org"]
  // zh.m.wikipedia.org => ["zh","m","wikipedia","org"]
  if (parts.length < 3) return "";
  if (parts[1] === "m") return parts[0];
  return parts[0];
}

async function getGroupLabelForHost(host) {
  if (!host) return "";
  // Special-case wikipedia mobile: zh.m.wikipedia.org should group as "zh"
  const wikiLang = getWikipediaLanguageFromHost(host);
  if (wikiLang) return wikiLang;

  const rd = host.includes(".") ? await getRegistrableDomain(host) : null;
  const sub = getSubdomainLabel(host, rd);
  return sub || rd || host;
}

async function groupWindowTabs(windowId, options) {
  if (!options.groupTabs) return;

  const tabs = await api.tabsQuery({ windowId });

  // Tab groups can't include pinned tabs. If requested, we can unpin first.
  if (options.unpinForGrouping) {
    const pinnedIds = tabs
      .filter((t) => t.pinned && Number.isFinite(t.id))
      .map((t) => t.id);
    for (const id of pinnedIds) {
      try {
        await api.tabsUpdate(id, { pinned: false });
      } catch {
        // ignore
      }
    }
  }

  const tabsAfter = options.unpinForGrouping ? await api.tabsQuery({ windowId }) : tabs;

  // Exclude pinned tabs (cannot be grouped).
  const eligible = tabsAfter.filter((t) => !t.pinned && Number.isFinite(t.id));
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
  /** @type {Map<string, string|null>} */
  const rdCache = new Map();
  /** @type {Map<string, string>} */
  const labelCache = new Map();
  for (const tab of eligible) {
    const host = getHostnameFromTab(tab);
    let rd = null;
    if (host && host.includes(".")) {
      if (rdCache.has(host)) rd = rdCache.get(host);
      else {
        rd = await getRegistrableDomain(host);
        rdCache.set(host, rd);
      }
    }

    // Group by immediate subdomain label (fallback to base domain, then protocol bucket)
    let label = "";
    if (host) {
      if (labelCache.has(host)) label = labelCache.get(host);
      else {
        label = await getGroupLabelForHost(host);
        labelCache.set(host, label);
      }
    }

    const key = label || rd || host || getGroupKeyForTab(tab);
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
        // Prefer label-based title when grouping label differs from hostname.
        title = sub || info.rd || info.host || key;
      }

      await api.tabGroupsUpdate(groupId, { title, collapsed: true });
    } catch {
      // ignore
    }
  }
}

async function reorderGroupsBySizeThenName(windowId) {
  const tabs = await api.tabsQuery({ windowId });
  const pinned = tabs.filter((t) => t.pinned).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const unpinned = tabs.filter((t) => !t.pinned);

  /** @type {Map<number, chrome.tabs.Tab[]>} */
  const byGroupId = new Map();
  /** @type {chrome.tabs.Tab[]} */
  const ungrouped = [];

  for (const t of unpinned) {
    if (Number.isFinite(t.groupId) && t.groupId !== -1) {
      const arr = byGroupId.get(t.groupId) ?? [];
      arr.push(t);
      byGroupId.set(t.groupId, arr);
    } else {
      ungrouped.push(t);
    }
  }

  if (byGroupId.size === 0) return;

  const groupInfos = [];
  for (const [groupId, groupTabs] of byGroupId.entries()) {
    let title = "";
    try {
      const g = await api.tabGroupsGet(groupId);
      title = typeof g?.title === "string" ? g.title : "";
    } catch {
      // ignore
    }
    groupTabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    groupInfos.push({ groupId, title, size: groupTabs.length, tabs: groupTabs });
  }

  groupInfos.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return String(a.title || "").localeCompare(String(b.title || ""), undefined, {
      sensitivity: "base",
    });
  });

  const ungroupedSorted = [...ungrouped].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const desiredUnpinnedIds = [
    ...groupInfos.flatMap((g) => g.tabs.map((t) => t.id)),
    ...ungroupedSorted.map((t) => t.id),
  ].filter((id) => Number.isFinite(id));

  if (!desiredUnpinnedIds.length) return;

  try {
    await api.tabsMove(desiredUnpinnedIds, { windowId, index: pinned.length });
  } catch {
    // ignore
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
    // Misc window: place the largest tab-groups first (tie-breaker: group name A→Z)
    if (options.groupTabs) {
      await reorderGroupsBySizeThenName(miscDest.windowId);
    }
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

function buildSearchMatcher(criteria) {
  const query = typeof criteria?.query === "string" ? criteria.query : "";
  const inTitle = criteria?.inTitle !== false;
  const inUrl = criteria?.inUrl !== false;
  const matchMode = String(criteria?.matchMode || "contains");
  const caseSensitive = criteria?.caseSensitive === true;
  const domainContains = typeof criteria?.domainContains === "string" ? criteria.domainContains.trim() : "";

  let regex = null;
  if (matchMode === "regex" && query) {
    const flags = caseSensitive ? "" : "i";
    regex = new RegExp(query, flags);
  }

  const q = caseSensitive ? query : query.toLowerCase();
  const domNeedle = caseSensitive ? domainContains : domainContains.toLowerCase();

  return (tab) => {
    const title = typeof tab.title === "string" ? tab.title : "";
    const url = typeof tab.url === "string" ? tab.url : "";

    if (domNeedle) {
      try {
        const host = new URL(url).hostname || "";
        const hh = caseSensitive ? host : host.toLowerCase();
        if (!hh.includes(domNeedle)) return false;
      } catch {
        return false;
      }
    }

    if (!query) return true; // domain-only filter

    const haystacks = [];
    if (inTitle) haystacks.push(title);
    if (inUrl) haystacks.push(url);

    if (!haystacks.length) return false;

    if (regex) return haystacks.some((h) => regex.test(h));

    const needles = q;
    return haystacks.some((h) => {
      const hh = caseSensitive ? h : h.toLowerCase();
      return hh.includes(needles);
    });
  };
}

function summarizeDuplicatesAmongTabs(tabs, includePinned) {
  const seen = new Map();
  let dups = 0;
  for (const tab of tabs) {
    if (!includePinned && tab.pinned) continue;
    const key = normalizeUrlForDedupe(tab.url);
    if (!key) continue;
    if (seen.has(key)) dups += 1;
    else seen.set(key, tab);
  }
  return dups;
}

async function groupMatchingTabsByHostname(matches) {
  /** @type {Map<number, Map<string, number[]>>} */
  const byWindow = new Map();

  for (const tab of matches) {
    if (!Number.isFinite(tab.windowId)) continue;
    if (!Number.isFinite(tab.id)) continue;
    if (tab.pinned) continue; // tab groups cannot include pinned tabs

    const host = getHostnameFromTab(tab);
    const label = host ? await getGroupLabelForHost(host) : "";
    const key = label || host || getGroupKeyForTab(tab);
    const winMap = byWindow.get(tab.windowId) ?? new Map();
    const arr = winMap.get(key) ?? [];
    arr.push(tab.id);
    winMap.set(key, arr);
    byWindow.set(tab.windowId, winMap);
  }

  let groupsCreated = 0;
  for (const [windowId, hostMap] of byWindow.entries()) {
    for (const [key, tabIds] of hostMap.entries()) {
      if (tabIds.length < 2) continue;
      try {
        const groupId = await api.tabsGroup({ tabIds, createProperties: { windowId } });
        const title = key || "group";
        await api.tabGroupsUpdate(groupId, { title, collapsed: true });
        groupsCreated += 1;
      } catch {
        // ignore
      }
    }
  }

  return { groupsCreated };
}

async function closeDuplicatesAmongTabs(matches, options) {
  const includePinned = options.includePinned === true;
  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byKey = new Map();
  for (const tab of matches) {
    if (!includePinned && tab.pinned) continue;
    const key = normalizeUrlForDedupe(tab.url);
    if (!key) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(tab);
    else byKey.set(key, [tab]);
  }

  /** @type {number[]} */
  const toClose = [];
  for (const group of byKey.values()) {
    if (group.length <= 1) continue;
    const keep = pickTabToKeep(group);
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

  return { closedCount: toClose.length };
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

    if (msg.type === "sortWindows") {
      const windowSorts = Array.isArray(msg.windowSorts) ? msg.windowSorts : [];
      let sortedWindows = 0;
      for (const w of windowSorts) {
        const windowId = Number(w?.windowId);
        const mode = String(w?.mode || "recency");
        if (!Number.isFinite(windowId)) continue;
        try {
          await sortWindowTabs(windowId, mode);
          sortedWindows += 1;
        } catch {
          // best-effort: keep going
        }
      }
      sendResponse({ ok: true, sortedWindows });
      return;
    }

    if (msg.type === "searchPreview") {
      const options = await getOptions();
      const criteria = msg.criteria || {};
      const scope = String(criteria.scope || "allWindows");
      const currentWindowId = Number(criteria.currentWindowId);
      const includePinned = options.includePinned === true;

      const tabs =
        scope === "currentWindow" && Number.isFinite(currentWindowId)
          ? await api.tabsQuery({ windowId: currentWindowId })
          : await api.tabsQuery({});

      const predicate = buildSearchMatcher(criteria);
      const matches = tabs.filter((t) => {
        try {
          return predicate(t);
        } catch {
          return false;
        }
      });

      const duplicateCount = summarizeDuplicatesAmongTabs(matches, includePinned);
      const zoomJumpLinkCount = matches.filter((t) => isZoomJumpLinkUrl(t.url)).length;

      const results = matches
        .slice(0, 50)
        .map((t) => ({ id: t.id, title: t.title, url: t.url, windowId: t.windowId, index: t.index }));

      sendResponse({
        ok: true,
        data: {
          matchCount: matches.length,
          duplicateCount,
          zoomJumpLinkCount,
          results,
        },
      });
      return;
    }

    if (msg.type === "searchExecute") {
      const options = await getOptions();
      const criteria = msg.criteria || {};
      const scope = String(criteria.scope || "allWindows");
      const currentWindowId = Number(criteria.currentWindowId);
      const action = String(criteria.action || "moveToNewWindow");

      const tabs =
        scope === "currentWindow" && Number.isFinite(currentWindowId)
          ? await api.tabsQuery({ windowId: currentWindowId })
          : await api.tabsQuery({});

      const predicate = buildSearchMatcher(criteria);
      const matches = tabs.filter((t) => {
        try {
          return predicate(t);
        } catch {
          return false;
        }
      });

      // Safety: refuse to act on empty.
      if (!matches.length) {
        sendResponse({ ok: true, data: { message: "No matches." } });
        return;
      }

      // Respect pinned handling from global options for destructive actions.
      const includePinned = options.includePinned === true;
      const actionable = includePinned ? matches : matches.filter((t) => !t.pinned);

      if (action === "closeMatches") {
        const ids = actionable.map((t) => t.id).filter((id) => Number.isFinite(id));
        if (ids.length) await api.tabsRemove(ids);
        sendResponse({ ok: true, data: { message: `Closed ${ids.length} tab(s).` } });
        return;
      }

      if (action === "closeZoomJumpLinks") {
        const ids = actionable
          .filter((t) => isZoomJumpLinkUrl(t.url))
          .map((t) => t.id)
          .filter((id) => Number.isFinite(id));
        if (ids.length) await api.tabsRemove(ids);
        sendResponse({ ok: true, data: { message: `Closed ${ids.length} Zoom jump tab(s).` } });
        return;
      }

      if (action === "dedupeMatches") {
        const dedupe = await closeDuplicatesAmongTabs(matches, options);
        sendResponse({ ok: true, data: { message: `Closed ${dedupe.closedCount} duplicate tab(s).` } });
        return;
      }

      if (action === "groupMatches") {
        const grouped = await groupMatchingTabsByHostname(matches);
        sendResponse({ ok: true, data: { message: `Created ${grouped.groupsCreated} group(s).` } });
        return;
      }

      if (action === "moveToNewWindow") {
        const tabIds = actionable.map((t) => t.id).filter((id) => Number.isFinite(id));
        const { windowId, placeholderTabId } = await createEmptyWindow();
        await safeMoveTabsToWindow(tabIds, windowId);
        await removePlaceholderTab(placeholderTabId);
        await reorderWindowTabsMostRecentFirst(windowId);
        await groupWindowTabs(windowId, options);
        sendResponse({ ok: true, data: { message: `Moved ${tabIds.length} tab(s) to a new window.` } });
        return;
      }

      sendResponse({ ok: false, error: `Unknown search action: ${action}` });
      return;
    }

    if (msg.type === "clearPreview" || msg.type === "clearExecute") {
      const PERIOD_MS = {
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
        month: 2_592_000_000,
      };
      const period = String(msg.period || "day");
      const periodMs = PERIOD_MS[period] ?? PERIOD_MS.day;
      const cutoff = Date.now() - periodMs;

      const options = await getOptions();
      const includePinned = options.includePinned === true;
      const scope = String(msg.scope || "allWindows");
      const currentWindowId = Number(msg.currentWindowId);

      const tabs =
        scope === "currentWindow" && Number.isFinite(currentWindowId)
          ? await api.tabsQuery({ windowId: currentWindowId })
          : await api.tabsQuery({});

      const stale = tabs.filter((t) => {
        if (!includePinned && t.pinned) return false;
        if (t.active) return false;
        const la = Number.isFinite(t.lastAccessed) ? t.lastAccessed : 0;
        return la > 0 && la < cutoff;
      });

      if (msg.type === "clearPreview") {
        const now = Date.now();
        const formatAgo = (ms) => {
          const sec = Math.floor(ms / 1000);
          if (sec < 60) return `${sec}s ago`;
          const min = Math.floor(sec / 60);
          if (min < 60) return `${min}m ago`;
          const hr = Math.floor(min / 60);
          if (hr < 24) return `${hr}h ago`;
          const days = Math.floor(hr / 24);
          return `${days}d ago`;
        };

        const results = stale.slice(0, 50).map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          windowId: t.windowId,
          index: t.index,
          lastAccessedAgo: formatAgo(now - (t.lastAccessed || 0)),
        }));

        sendResponse({ ok: true, data: { staleCount: stale.length, results } });
        return;
      }

      const ids = stale.map((t) => t.id).filter((id) => Number.isFinite(id));
      if (ids.length) {
        try {
          await api.tabsRemove(ids);
        } catch {
          for (const id of ids) {
            try { await api.tabsRemove(id); } catch { /* ignore */ }
          }
        }
      }
      sendResponse({ ok: true, data: { closedCount: ids.length } });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  })().catch((e) => {
    sendResponse({ ok: false, error: e?.message || String(e) });
  });

  return true;
});

