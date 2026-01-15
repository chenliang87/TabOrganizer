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

function approximateRegistrableDomain(hostname) {
  const h = (hostname || "").toLowerCase().replace(/\.+$/, "");
  if (!h) return "";
  if (h.includes(":")) return h; // IPv6 or host:port-ish
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h; // IPv4

  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const thirdLast = parts[parts.length - 3];

  // Heuristic for common 2-level public suffixes like co.uk, com.au, etc.
  const commonSecondLevel = new Set([
    "ac",
    "co",
    "com",
    "edu",
    "gov",
    "net",
    "org",
  ]);

  if (last.length === 2 && commonSecondLevel.has(secondLast) && thirdLast) {
    return `${thirdLast}.${secondLast}.${last}`;
  }

  return `${secondLast}.${last}`;
}

function isWikipediaHost(hostname) {
  if (!hostname) return false;
  return (
    hostname === "wikipedia.org" ||
    hostname.endsWith(".wikipedia.org") ||
    hostname.endsWith(".m.wikipedia.org")
  );
}

function getWikipediaLang(hostname) {
  const h = (hostname || "").toLowerCase();
  if (!isWikipediaHost(h)) return "";

  // Examples:
  // - en.wikipedia.org => en
  // - zh.m.wikipedia.org => zh
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 3) return "";
  if (parts[1] === "m") return parts[0]; // zh.m.wikipedia.org
  return parts[0]; // en.wikipedia.org
}

function normalizeWikipediaTitle(title) {
  const t = (title || "").trim();
  // Common suffix across many languages: " - Wikipedia"
  return t.replace(/\s+-\s+Wikipedia\s*$/i, "").trim();
}

function getCollatorForWikipediaLang(lang) {
  // Prefer language collation. Fallback to default.
  try {
    if (lang === "zh") return new Intl.Collator(["zh", "zh-Hans", "zh-Hant"], { sensitivity: "base" });
    if (lang === "en") return new Intl.Collator(["en"], { sensitivity: "base" });
    if (lang) return new Intl.Collator([lang], { sensitivity: "base" });
  } catch {
    // ignore
  }
  return new Intl.Collator(undefined, { sensitivity: "base" });
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

function normalizeGoogleWorkspaceTitle(title, productKey) {
  const t0 = (title || "").trim();
  if (!t0) return { name: "", isUntitled: true };

  // Common suffixes:
  // - " - Google Docs"
  // - " - Google Sheets"
  // - " - Google Slides"
  // - Sometimes " - Google Docs - Google Chrome" etc. We'll strip the first known suffix.
  const suffixes = [
    " - Google Docs",
    " - Google Sheets",
    " - Google Slides",
    " - Google 表格",
    " - Google 文件",
    " - Google 幻燈片",
  ];

  let base = t0;
  for (const s of suffixes) {
    if (base.endsWith(s)) {
      base = base.slice(0, -s.length).trim();
      break;
    }
  }

  // Detect untitled variants.
  const untitledPatterns = [
    /^Untitled document$/i,
    /^Untitled spreadsheet$/i,
    /^Untitled presentation$/i,
    /^無標題文件$/,
    /^無標題試算表$/,
    /^無標題簡報$/,
    /^未命名文件$/,
    /^未命名試算表$/,
    /^未命名簡報$/,
  ];

  const isUntitled = untitledPatterns.some((re) => re.test(base));
  if (isUntitled) return { name: "", isUntitled: true };

  // If we failed to strip suffix and title still contains product name, keep as-is.
  // Return lower-cased name for stable sorting; display doesn’t matter here.
  return { name: base, isUntitled: false, productKey };
}

/**
 * Sorts tabs by:
 *  1) subdomain/app group key (grouped contiguously)
 *  2) lastAccessed desc within each group
 *
 * By default (non-Google), group key is the base domain (approx eTLD+1-ish),
 * so language subdomains like en.wikipedia.org and zh.wikipedia.org stay together.
 * For common Google apps we split further (e.g., docs vs sheets under docs.google.com).
 */
export function sortTabsBySubdomainThenRecency(tabs) {
  return [...tabs].sort((a, b) => {
    const ha = getHostname(a);
    const hb = getHostname(b);

    // Wikipedia special: language first, then page title initials (alphabetical).
    // (Fallback tie-breakers preserve deterministic ordering.)
    const isWikiA = isWikipediaHost(ha);
    const isWikiB = isWikipediaHost(hb);
    if (isWikiA && isWikiB) {
      const la = getWikipediaLang(ha);
      const lb = getWikipediaLang(hb);
      if (la !== lb) return la.localeCompare(lb);

      const collator = getCollatorForWikipediaLang(la);
      const ta = normalizeWikipediaTitle(a.title);
      const tb = normalizeWikipediaTitle(b.title);
      const cmp = collator.compare(ta, tb);
      if (cmp !== 0) return cmp;

      // If titles match, keep most recent first.
      const aa = Number.isFinite(a.lastAccessed) ? a.lastAccessed : 0;
      const bb = Number.isFinite(b.lastAccessed) ? b.lastAccessed : 0;
      if (bb !== aa) return bb - aa;
    }

    // If both are under google.com, use product grouping; else hostname.
    const isGoogleA = ha.endsWith(".google.com") || ha === "google.com";
    const isGoogleB = hb.endsWith(".google.com") || hb === "google.com";

    const ga = isGoogleA ? getGoogleProductKey(a) : approximateRegistrableDomain(ha);
    const gb = isGoogleB ? getGoogleProductKey(b) : approximateRegistrableDomain(hb);

    if (ga !== gb) return ga.localeCompare(gb);

    // Google Workspace docs/sheets/slides: sort by document name; if untitled, sort by recency.
    const isWorkspace = ga === "gdoc" || ga === "gsheet" || ga === "gslides";
    if (isWorkspace) {
      const ta = normalizeGoogleWorkspaceTitle(a.title, ga);
      const tb = normalizeGoogleWorkspaceTitle(b.title, gb);

      // Put titled docs before untitled, then sort titled alphabetically.
      if (ta.isUntitled !== tb.isUntitled) return ta.isUntitled ? 1 : -1;

      if (!ta.isUntitled && !tb.isUntitled) {
        const collator = new Intl.Collator(undefined, { sensitivity: "base" });
        const cmp = collator.compare(ta.name, tb.name);
        if (cmp !== 0) return cmp;
        // Same name: most recent first.
      } else {
        // Both untitled: fall through to recency below.
      }
    }

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

