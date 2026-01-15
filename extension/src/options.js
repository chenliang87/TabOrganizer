const DEFAULTS = {
  threshold: 5,
  includePinned: false,
  closeEmptyWindows: true,
  closeDuplicateTabs: true,
  closeZoomJumpLinks: true,
  groupTabs: true,
};

const els = {
  threshold: document.getElementById("threshold"),
  includePinned: document.getElementById("includePinned"),
  closeEmptyWindows: document.getElementById("closeEmptyWindows"),
  closeDuplicateTabs: document.getElementById("closeDuplicateTabs"),
  closeZoomJumpLinks: document.getElementById("closeZoomJumpLinks"),
  groupTabs: document.getElementById("groupTabs"),
  savedStatus: document.getElementById("savedStatus"),
};

function showSaved() {
  els.savedStatus.style.display = "block";
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => {
    els.savedStatus.style.display = "none";
  }, 800);
}

function sanitizeThreshold(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.threshold;
  return Math.max(1, Math.floor(n));
}

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  els.threshold.value = String(sanitizeThreshold(stored.threshold));
  els.includePinned.checked = stored.includePinned === true;
  els.closeEmptyWindows.checked = stored.closeEmptyWindows !== false;
  els.closeDuplicateTabs.checked = stored.closeDuplicateTabs !== false;
  els.closeZoomJumpLinks.checked = stored.closeZoomJumpLinks !== false;
  els.groupTabs.checked = stored.groupTabs !== false;
}

async function save() {
  const payload = {
    threshold: sanitizeThreshold(els.threshold.value),
    includePinned: els.includePinned.checked,
    closeEmptyWindows: els.closeEmptyWindows.checked,
    closeDuplicateTabs: els.closeDuplicateTabs.checked,
    closeZoomJumpLinks: els.closeZoomJumpLinks.checked,
    groupTabs: els.groupTabs.checked,
  };
  await chrome.storage.local.set(payload);
  showSaved();
}

els.threshold.addEventListener("change", save);
els.includePinned.addEventListener("change", save);
els.closeEmptyWindows.addEventListener("change", save);
els.closeDuplicateTabs.addEventListener("change", save);
els.closeZoomJumpLinks.addEventListener("change", save);
els.groupTabs.addEventListener("change", save);

load();

