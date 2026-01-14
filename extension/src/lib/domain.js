let _pslPromise = null;

function isIPv4(hostname) {
  // Very small heuristic; good enough for our use.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isIPv6(hostname) {
  return hostname.includes(":");
}

function normalizeHostname(hostname) {
  if (!hostname) return "";
  return hostname.toLowerCase().replace(/\.+$/, "").trim();
}

async function loadPslText() {
  const url = chrome.runtime.getURL("src/lib/public_suffix_list.dat");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load PSL: ${resp.status}`);
  return await resp.text();
}

function parsePsl(pslText) {
  const exact = new Set();
  const wildcard = new Set();
  const exception = new Set();

  for (const rawLine of pslText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("//")) continue;

    if (line.startsWith("!")) {
      exception.add(line.slice(1));
      continue;
    }

    if (line.startsWith("*.")) {
      wildcard.add(line.slice(2));
      continue;
    }

    exact.add(line);
  }

  return { exact, wildcard, exception };
}

async function getPsl() {
  if (!_pslPromise) {
    _pslPromise = loadPslText().then(parsePsl);
  }
  return await _pslPromise;
}

function getPublicSuffixFromRules(hostname, rules) {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length === 0) return null;

  // Exception rules have priority.
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    if (rules.exception.has(suffix)) {
      const psLabels = suffix.split(".").slice(1);
      return psLabels.join(".") || null;
    }
  }

  let bestMatch = null;
  let bestLen = 0;

  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");

    if (rules.exact.has(suffix)) {
      const len = labels.length - i;
      if (len > bestLen) {
        bestLen = len;
        bestMatch = suffix;
      }
    }

    // Wildcard rule: *.X matches Y.X (one extra label)
    const wildcardBase = labels.slice(i + 1).join(".");
    if (wildcardBase && rules.wildcard.has(wildcardBase)) {
      const candidate = labels.slice(i).join(".");
      const len = labels.length - i;
      if (len > bestLen) {
        bestLen = len;
        bestMatch = candidate;
      }
    }
  }

  if (bestMatch) return bestMatch;
  // Default rule "*": public suffix is last label (TLD).
  return labels[labels.length - 1];
}

/**
 * Returns registrable domain (eTLD+1). If hostname is itself a public suffix,
 * returns null.
 */
export async function getRegistrableDomain(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return null;
  if (isIPv4(h) || isIPv6(h)) return h;

  const rules = await getPsl();
  const publicSuffix = getPublicSuffixFromRules(h, rules);
  if (!publicSuffix) return null;

  const labels = h.split(".").filter(Boolean);
  const psLabels = publicSuffix.split(".").filter(Boolean);
  if (labels.length <= psLabels.length) return null;

  const rdLabels = labels.slice(labels.length - (psLabels.length + 1));
  return rdLabels.join(".");
}

