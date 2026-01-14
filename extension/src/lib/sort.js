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

