export function sortTabsMostRecentFirst(tabs) {
  return [...tabs].sort((a, b) => {
    const la = Number.isFinite(a.lastAccessed) ? a.lastAccessed : 0;
    const lb = Number.isFinite(b.lastAccessed) ? b.lastAccessed : 0;
    if (lb !== la) return lb - la;

    // Stable tie-breakers: original tab index, then id.
    const ia = Number.isFinite(a.index) ? a.index : 0;
    const ib = Number.isFinite(b.index) ? b.index : 0;
    if (ia !== ib) return ia - ib;

    const ida = Number.isFinite(a.id) ? a.id : 0;
    const idb = Number.isFinite(b.id) ? b.id : 0;
    return ida - idb;
  });
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getHostname(tab) {
  const u = safeUrl(tab.url || "");
  if (!u) return "";
  return (u.hostname || "").toLowerCase();
}

function getGoogleProductKey(tab) {
  const u = safeUrl(tab.url || "");
  if (!u) return "";

  const host = (u.hostname || "").toLowerCase();
  const path = u.pathname || "/";

  if (host === "mail.google.com") return "gmail";
  if (host === "calendar.google.com") return "calendar";
  if (host === "drive.google.com") return "drive";
  if (host === "meet.google.com") return "meet";

  // docs.google.com hosts multiple products; split by first path segment.
  if (host === "docs.google.com") {
    const seg = path.split("/").filter(Boolean)[0] || "";
    if (seg === "document") return "gdoc";
    if (seg === "spreadsheets") return "gsheet";
    if (seg === "presentation") return "gslides";
    if (seg) return `docs:${seg}`;
    return "docs";
  }

  // Default to hostname grouping.
  return host;
}

/**
 * Sorts tabs by:
 *  1) subdomain/app group key (grouped contiguously)
 *  2) lastAccessed desc within each group
 *
 * By default, group key is the tab's hostname. For common Google apps we split
 * further (e.g., docs vs sheets under docs.google.com).
 */
export function sortTabsBySubdomainThenRecency(tabs) {
  return [...tabs].sort((a, b) => {
    const ha = getHostname(a);
    const hb = getHostname(b);

    // If both are under google.com, use product grouping; else hostname.
    const isGoogleA = ha.endsWith(".google.com") || ha === "google.com";
    const isGoogleB = hb.endsWith(".google.com") || hb === "google.com";

    const ga = isGoogleA ? getGoogleProductKey(a) : ha;
    const gb = isGoogleB ? getGoogleProductKey(b) : hb;

    if (ga !== gb) return ga.localeCompare(gb);

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

