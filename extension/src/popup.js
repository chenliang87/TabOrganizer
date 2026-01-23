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
  openOptions: document.getElementById("openOptions"),
};

function setStatus(text) {
  els.status.textContent = text;
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
  const isFocused = win.focused ? " (focused)" : "";
  const tabCount = Array.isArray(tabs) ? tabs.length : 0;
  // Best-effort label: window id + tab count.
  return `Window ${win.id}${isFocused} · ${tabCount} tabs`;
}

let currentWindowId = null;

async function refreshCurrentWindow() {
  els.sortCurrentWindowBtn.disabled = true;
  els.currentWindowLabel.textContent = "Loading current window…";
  currentWindowId = null;

  try {
    const win = await chrome.windows.getCurrent({ populate: true });
    if (!Number.isFinite(win?.id)) throw new Error("No current window");
    currentWindowId = win.id;
    els.currentWindowLabel.textContent = windowLabel(win, win.tabs);
    els.sortCurrentWindowBtn.disabled = false;
  } catch {
    els.currentWindowLabel.textContent = "Unable to read current window.";
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
    // close popup after a brief moment
    setTimeout(() => window.close(), 300);
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

refreshPreview();
refreshCurrentWindow();

