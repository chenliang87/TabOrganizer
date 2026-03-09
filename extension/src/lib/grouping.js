import { getRegistrableDomain } from "./domain.js";

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function getDomainKeyForTab(tab) {
  const url = tab?.url || tab?.pendingUrl || "";
  const urlObj = safeParseUrl(typeof url === "string" ? url : "");
  if (!urlObj) return null;
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") return null;

  const hostname = (urlObj.hostname || "").toLowerCase();
  if (!hostname) return null;

  const rd = await getRegistrableDomain(hostname);
  return rd || hostname;
}

/**
 * Returns a plan describing which tabs go into dedicated domain windows vs misc.
 *
 * - Dedicated window: domain groups with size > threshold
 * - Misc window: everything else that is movable/eligible
 */
export async function buildGroupingPlan(tabs, options) {
  const threshold = Number.isFinite(options?.threshold)
    ? options.threshold
    : 5;
  const includePinned = options?.includePinned === true;

  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byDomain = new Map();
  /** @type {chrome.tabs.Tab[]} */
  const misc = [];
  /** @type {chrome.tabs.Tab[]} */
  const ignored = [];

  for (const tab of tabs) {
    if (!includePinned && tab.pinned) {
      ignored.push(tab);
      continue;
    }

    const key = await getDomainKeyForTab(tab);
    if (!key) {
      misc.push(tab);
      continue;
    }

    const arr = byDomain.get(key);
    if (arr) arr.push(tab);
    else byDomain.set(key, [tab]);
  }

  /** @type {{ domain: string, tabs: chrome.tabs.Tab[] }[]} */
  const dedicated = [];
  /** @type {chrome.tabs.Tab[]} */
  const miscFinal = [...misc];

  for (const [domain, groupTabs] of byDomain.entries()) {
    if (groupTabs.length > threshold) {
      dedicated.push({ domain, tabs: groupTabs });
    } else {
      miscFinal.push(...groupTabs);
    }
  }

  // Deterministic ordering: biggest groups first, then alpha.
  dedicated.sort((a, b) => {
    if (b.tabs.length !== a.tabs.length) return b.tabs.length - a.tabs.length;
    return a.domain.localeCompare(b.domain);
  });

  return {
    threshold,
    includePinned,
    dedicated,
    misc: miscFinal,
    ignored,
  };
}

