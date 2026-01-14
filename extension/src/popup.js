const els = {
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  domainWindowCount: document.getElementById("domainWindowCount"),
  miscTabCount: document.getElementById("miscTabCount"),
  ignoredTabCount: document.getElementById("ignoredTabCount"),
  topDomains: document.getElementById("topDomains"),
  threshold: document.getElementById("threshold"),
  includePinned: document.getElementById("includePinned"),
  closeEmptyWindows: document.getElementById("closeEmptyWindows"),
  organizeBtn: document.getElementById("organizeBtn"),
  openOptions: document.getElementById("openOptions"),
};

function setStatus(text) {
  els.status.textContent = text;
}

function showSummary({
  domainWindowCount,
  miscTabCount,
  ignoredTabCount,
  options,
  topDomains,
}) {
  els.domainWindowCount.textContent = String(domainWindowCount);
  els.miscTabCount.textContent = String(miscTabCount);
  els.ignoredTabCount.textContent = String(ignoredTabCount ?? 0);

  const lines = Array.isArray(topDomains)
    ? topDomains.map((d) => `${d.domain} (${d.count})`)
    : [];
  els.topDomains.textContent = lines.length ? lines.join("\n") : "—";

  els.threshold.textContent = String(options?.threshold ?? 5);
  els.includePinned.textContent = options?.includePinned ? "yes" : "no";
  els.closeEmptyWindows.textContent =
    options?.closeEmptyWindows === false ? "no" : "yes";

  els.summary.style.display = "block";
}

async function sendMessage(msg) {
  return await chrome.runtime.sendMessage(msg);
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

refreshPreview();

