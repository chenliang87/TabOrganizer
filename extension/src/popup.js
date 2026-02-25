const els = {
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  domainWindowCount: document.getElementById("domainWindowCount"),
  miscTabCount: document.getElementById("miscTabCount"),
  ignoredTabCount: document.getElementById("ignoredTabCount"),
  duplicateTabCount: document.getElementById("duplicateTabCount"),
  zoomJumpLinkCount: document.getElementById("zoomJumpLinkCount"),
  topDomains: document.getElementById("topDomains"),
  threshold: document.getElementById("threshold"),
  includePinned: document.getElementById("includePinned"),
  closeEmptyWindows: document.getElementById("closeEmptyWindows"),
  groupTabs: document.getElementById("groupTabs"),
  organizeBtn: document.getElementById("organizeBtn"),
  currentWindowLabel: document.getElementById("currentWindowLabel"),
  currentWindowSortMode: document.getElementById("currentWindowSortMode"),
  sortCurrentWindowBtn: document.getElementById("sortCurrentWindowBtn"),
  searchInput: document.getElementById("searchInput"),
  searchInTitle: document.getElementById("searchInTitle"),
  searchInUrl: document.getElementById("searchInUrl"),
  searchCaseSensitive: document.getElementById("searchCaseSensitive"),
  searchMatchMode: document.getElementById("searchMatchMode"),
  searchScope: document.getElementById("searchScope"),
  searchDomain: document.getElementById("searchDomain"),
  searchAction: document.getElementById("searchAction"),
  searchRunBtn: document.getElementById("searchRunBtn"),
  searchStatus: document.getElementById("searchStatus"),
  searchResults: document.getElementById("searchResults"),
  versionBadge: document.getElementById("versionBadge"),
  openFullScreen: document.getElementById("openFullScreen"),
  tabOrganize: document.getElementById("tabOrganize"),
  tabSort: document.getElementById("tabSort"),
  tabSearch: document.getElementById("tabSearch"),
  panelOrganize: document.getElementById("panelOrganize"),
  panelSort: document.getElementById("panelSort"),
  panelSearch: document.getElementById("panelSearch"),
  openOptions: document.getElementById("openOptions"),
};

const isTabMode = new URL(window.location.href).searchParams.get("mode") === "tab";
if (isTabMode) {
  document.body.classList.add("mode-tab");
  if (els.openFullScreen) els.openFullScreen.style.display = "none";
}

if (els.versionBadge) {
  try {
    els.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    els.versionBadge.textContent = "";
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function setActiveTab(which) {
  const mapping = [
    { btn: els.tabOrganize, panel: els.panelOrganize, key: "organize" },
    { btn: els.tabSort, panel: els.panelSort, key: "sort" },
    { btn: els.tabSearch, panel: els.panelSearch, key: "search" },
  ];
  for (const m of mapping) {
    const active = m.key === which;
    if (m.btn) m.btn.classList.toggle("active", active);
    if (m.panel) m.panel.classList.toggle("active", active);
  }
}

function showSummary({
  domainWindowCount,
  miscTabCount,
  ignoredTabCount,
  duplicateTabCount,
  zoomJumpLinkCount,
  options,
  topDomains,
}) {
  els.domainWindowCount.textContent = String(domainWindowCount);
  els.miscTabCount.textContent = String(miscTabCount);
  els.ignoredTabCount.textContent = String(ignoredTabCount ?? 0);
  els.duplicateTabCount.textContent = String(duplicateTabCount ?? 0);
  els.zoomJumpLinkCount.textContent = String(zoomJumpLinkCount ?? 0);

  const lines = Array.isArray(topDomains)
    ? topDomains.map((d) => `${d.domain} (${d.count})`)
    : [];
  els.topDomains.textContent = lines.length ? lines.join("\n") : "—";

  els.threshold.textContent = String(options?.threshold ?? 5);
  els.includePinned.textContent = options?.includePinned ? "yes" : "no";
  els.closeEmptyWindows.textContent =
    options?.closeEmptyWindows === false ? "no" : "yes";
  els.groupTabs.textContent = options?.groupTabs === false ? "no" : "yes";

  els.summary.style.display = "block";
}

async function sendMessage(msg) {
  return await chrome.runtime.sendMessage(msg);
}

function windowLabel(win, tabs) {
  const tabCount = Array.isArray(tabs) ? tabs.length : 0;
  // User-friendly label (Chrome window id is not meaningful to most users).
  return `Current window · ${tabCount} tabs`;
}

let currentWindowId = null;
let currentWindowTabs = [];
let allWindowTabs = [];
let allWindowsIndexById = new Map(); // windowId -> 1-based index for display

async function refreshCurrentWindow() {
  els.sortCurrentWindowBtn.disabled = true;
  els.currentWindowLabel.textContent = "Loading current window…";
  currentWindowId = null;
  currentWindowTabs = [];

  try {
    const win = await chrome.windows.getCurrent({ populate: true });
    if (!Number.isFinite(win?.id)) throw new Error("No current window");
    currentWindowId = win.id;
    currentWindowTabs = Array.isArray(win.tabs) ? win.tabs : [];
    els.currentWindowLabel.textContent = windowLabel(win, win.tabs);
    els.sortCurrentWindowBtn.disabled = false;
  } catch {
    els.currentWindowLabel.textContent = "Unable to read current window.";
  }

  // Refresh search status/results when the focused window changes.
  // Best-effort: only recompute search preview when Search tab is open.
  if (els.panelSearch?.classList?.contains("active")) {
    await refreshSearchPreview();
  }
}

async function refreshAllWindowsTabs() {
  allWindowTabs = [];
  allWindowsIndexById = new Map();

  try {
    const wins = await chrome.windows.getAll({ populate: true });
    const ordered = [...wins].sort((a, b) => {
      // Focused first, then stable by id.
      const fa = a.focused ? 1 : 0;
      const fb = b.focused ? 1 : 0;
      if (fb !== fa) return fb - fa;
      const ia = Number.isFinite(a.id) ? a.id : 0;
      const ib = Number.isFinite(b.id) ? b.id : 0;
      return ia - ib;
    });

    ordered.forEach((w, idx) => {
      if (Number.isFinite(w.id)) allWindowsIndexById.set(w.id, idx + 1);
    });

    for (const w of ordered) {
      const winId = Number.isFinite(w.id) ? w.id : null;
      if (!Number.isFinite(winId)) continue;
      const tabs = Array.isArray(w.tabs) ? w.tabs : [];
      for (const t of tabs) {
        allWindowTabs.push({
          id: t.id,
          title: t.title,
          url: t.url,
          index: t.index,
          windowId: winId,
        });
      }
    }
  } catch {
    // ignore; search can still function with whatever we have
  }
}

async function refreshPreview() {
  els.organizeBtn.disabled = true;
  setStatus("Loading preview…");
  els.summary.style.display = "none";

  try {
    const resp = await sendMessage({ type: "preview" });
    if (!resp || resp.ok !== true) {
      throw new Error(resp?.error || "Preview failed");
    }
    showSummary(resp.data);
    setStatus("Ready.");
    els.organizeBtn.disabled = false;
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
  }
}

els.organizeBtn.addEventListener("click", async () => {
  els.organizeBtn.disabled = true;
  setStatus("Organizing…");
  try {
    const resp = await sendMessage({ type: "organize" });
    if (!resp || resp.ok !== true) throw new Error(resp?.error || "Failed");
    setStatus("Done.");
    // close popup after a brief moment (but don't close in full-screen tab mode)
    if (!isTabMode) setTimeout(() => window.close(), 300);
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
    els.organizeBtn.disabled = false;
  }
});

els.openOptions.addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.runtime.openOptionsPage();
});

els.sortCurrentWindowBtn.addEventListener("click", async () => {
  els.sortCurrentWindowBtn.disabled = true;
  setStatus("Sorting current window…");
  try {
    if (!Number.isFinite(currentWindowId)) throw new Error("No current window");
    const mode = String(els.currentWindowSortMode.value || "recency");
    const resp = await sendMessage({
      type: "sortWindows",
      windowSorts: [{ windowId: currentWindowId, mode }],
    });
    if (!resp || resp.ok !== true) throw new Error(resp?.error || "Sort failed");
    setStatus("Sorted current window.");
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
  } finally {
    await refreshCurrentWindow();
  }
});

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function buildSearchCriteria() {
  const query = String(els.searchInput.value || "").trim();
  const inTitle = els.searchInTitle?.checked !== false;
  const inUrl = els.searchInUrl?.checked !== false;
  const matchMode = String(els.searchMatchMode?.value || "contains");
  const caseSensitive = els.searchCaseSensitive?.checked === true;
  const scope = String(els.searchScope?.value || "allWindows");
  const domainContains = String(els.searchDomain?.value || "").trim();
  const action = String(els.searchAction?.value || "moveToNewWindow");

  return {
    query,
    inTitle,
    inUrl,
    matchMode,
    caseSensitive,
    scope,
    domainContains,
    action,
    currentWindowId,
  };
}

function windowLabelForSearch(windowId) {
  const n = allWindowsIndexById.get(windowId);
  if (n) {
    if (windowId === currentWindowId) return `This window (#${n})`;
    return `Window #${n}`;
  }
  if (windowId === currentWindowId) return "This window";
  return "Other window";
}

let lastSearchPreview = null;

function renderSearchResultsFromPreview(preview) {
  const results = Array.isArray(preview?.results) ? preview.results : [];
  const count = Number.isFinite(preview?.matchCount) ? preview.matchCount : 0;
  const dup = Number.isFinite(preview?.duplicateCount) ? preview.duplicateCount : 0;
  const zoom = Number.isFinite(preview?.zoomJumpLinkCount)
    ? preview.zoomJumpLinkCount
    : 0;

  if (!count) {
    els.searchStatus.textContent = `0 matches. (Duplicates among matches: ${dup}, Zoom jump links among matches: ${zoom})`;
    els.searchResults.style.display = "none";
    els.searchResults.textContent = "";
    return;
  }

  els.searchStatus.textContent = `${count} match(es) (showing up to ${results.length}). Duplicates among matches: ${dup}. Zoom jump links among matches: ${zoom}.`;
  els.searchResults.style.display = "block";
  els.searchResults.textContent = "";

  for (const t of results) {
    if (!Number.isFinite(t.id)) continue;
    if (!Number.isFinite(t.windowId)) continue;

    const btn = document.createElement("button");
    btn.className = "resultRow";
    btn.type = "button";

    const title = document.createElement("div");
    title.className = "resultTitle";
    title.textContent = t.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "resultMeta";
    meta.textContent = `${windowLabelForSearch(t.windowId)} · ${safeHost(
      t.url
    )} · tab #${(t.index ?? 0) + 1}`;

    btn.appendChild(title);
    btn.appendChild(meta);

    btn.addEventListener("click", async () => {
      try {
        await chrome.tabs.update(t.id, { active: true });
        await chrome.windows.update(t.windowId, { focused: true });
        if (!isTabMode) window.close();
      } catch (e) {
        setStatus(`Error: ${e?.message || String(e)}`);
      }
    });

    els.searchResults.appendChild(btn);
  }
}

async function refreshSearchPreview() {
  els.searchRunBtn.disabled = true;
  const criteria = buildSearchCriteria();

  // Require a query OR a domain filter to avoid accidental mass actions.
  if (!criteria.query && !criteria.domainContains) {
    els.searchStatus.textContent = "Type a search query or a hostname filter.";
    els.searchResults.style.display = "none";
    els.searchResults.textContent = "";
    return;
  }

  try {
    const resp = await sendMessage({ type: "searchPreview", criteria });
    if (!resp || resp.ok !== true) throw new Error(resp?.error || "Search preview failed");
    lastSearchPreview = resp.data;
    renderSearchResultsFromPreview(resp.data);
    els.searchRunBtn.disabled = !(resp.data?.matchCount > 0);
  } catch (e) {
    els.searchStatus.textContent = `Error: ${e?.message || String(e)}`;
    els.searchResults.style.display = "none";
    els.searchResults.textContent = "";
  }
}

let searchTimer = null;
function scheduleSearchPreview() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshSearchPreview, 120);
}

els.searchInput.addEventListener("input", scheduleSearchPreview);
els.searchInTitle.addEventListener("change", scheduleSearchPreview);
els.searchInUrl.addEventListener("change", scheduleSearchPreview);
els.searchCaseSensitive.addEventListener("change", scheduleSearchPreview);
els.searchMatchMode.addEventListener("change", scheduleSearchPreview);
els.searchScope.addEventListener("change", scheduleSearchPreview);
els.searchDomain.addEventListener("input", scheduleSearchPreview);
els.searchAction.addEventListener("change", scheduleSearchPreview);

els.searchRunBtn.addEventListener("click", async () => {
  els.searchRunBtn.disabled = true;
  const criteria = buildSearchCriteria();
  setStatus("Running search action…");

  try {
    const resp = await sendMessage({ type: "searchExecute", criteria });
    if (!resp || resp.ok !== true) throw new Error(resp?.error || "Search action failed");
    setStatus(`Done. ${resp.data?.message || ""}`.trim());
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
  } finally {
    await refreshPreview();
    await refreshCurrentWindow();
    await refreshAllWindowsTabs();
    await refreshSearchPreview();
  }
});

els.tabOrganize.addEventListener("click", () => setActiveTab("organize"));
els.tabSort.addEventListener("click", () => setActiveTab("sort"));
els.tabSearch.addEventListener("click", async () => {
  setActiveTab("search");
  await refreshAllWindowsTabs();
  await refreshSearchPreview();
});

els.openFullScreen.addEventListener("click", async () => {
  const url = chrome.runtime.getURL("src/popup.html?mode=tab");
  await chrome.tabs.create({ url });
  window.close();
});

refreshPreview();
refreshCurrentWindow();
refreshAllWindowsTabs().then(refreshSearchPreview);

