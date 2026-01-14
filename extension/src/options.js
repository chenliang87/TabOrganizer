const DEFAULTS = {
  threshold: 5,
  includePinned: false,
  closeEmptyWindows: true,
};

const els = {
  threshold: document.getElementById("threshold"),
  includePinned: document.getElementById("includePinned"),
  closeEmptyWindows: document.getElementById("closeEmptyWindows"),
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
}

async function save() {
  const payload = {
    threshold: sanitizeThreshold(els.threshold.value),
    includePinned: els.includePinned.checked,
    closeEmptyWindows: els.closeEmptyWindows.checked,
  };
  await chrome.storage.local.set(payload);
  showSaved();
}

els.threshold.addEventListener("change", save);
els.includePinned.addEventListener("change", save);
els.closeEmptyWindows.addEventListener("change", save);

load();

