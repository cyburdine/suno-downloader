/**
 * popup.js
 * Manages the extension popup UI: scan, song list, naming settings, and download.
 */

// ---- DOM refs ----
const songCountEl    = document.getElementById("songCount");
const statusTextEl   = document.getElementById("statusText");
const scanBtn        = document.getElementById("scanBtn");
const clearBtn       = document.getElementById("clearBtn");
const downloadBtn    = document.getElementById("downloadBtn");
const templateInput  = document.getElementById("template");
const subfolderInput = document.getElementById("subfolder");
const concurrencyRange = document.getElementById("concurrencyRange");
const concurrencyVal   = document.getElementById("concurrencyVal");
const progressWrap   = document.getElementById("progressWrap");
const progressFill   = document.getElementById("progressFill");
const progressLabel  = document.getElementById("progressLabel");
const songListSection = document.getElementById("songListSection");
const songList       = document.getElementById("songList");

let songs = [];
let isDownloading = false;

// ---- Init ----
(async function init() {
  // Restore saved settings
  const saved = await chrome.storage.local.get(["template", "subfolder", "concurrency"]);
  if (saved.template)     templateInput.value       = saved.template;
  if (saved.subfolder)    subfolderInput.value       = saved.subfolder;
  if (saved.concurrency)  {
    concurrencyRange.value = saved.concurrency;
    concurrencyVal.textContent = saved.concurrency;
  }

  await refreshSongs();
})();

// ---- Open chrome://settings/downloads (can't use normal links in popups) ----
document.getElementById("openDownloadSettings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://settings/downloads" });
});

// ---- Persist settings on change ----
templateInput.addEventListener("input", () => {
  chrome.storage.local.set({ template: templateInput.value });
});
subfolderInput.addEventListener("input", () => {
  chrome.storage.local.set({ subfolder: subfolderInput.value });
});
concurrencyRange.addEventListener("input", () => {
  concurrencyVal.textContent = concurrencyRange.value;
  chrome.storage.local.set({ concurrency: concurrencyRange.value });
});

// ---- Scan ----
scanBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes("suno.com")) {
    setStatus("Not on suno.com", "error");
    return;
  }

  setScanningState(true);

  // 1. Clear previous data
  setStatus("Clearing...", "scanning");
  await chrome.runtime.sendMessage({ type: "CLEAR_SONGS" });
  songs = [];
  renderUI();
  progressWrap.classList.add("hidden");
  progressFill.style.width = "0";

  // 2. Reload the tab and wait for it to fully load
  setStatus("Reloading page...", "scanning");
  await reloadTabAndWait(tab.id);

  // 3. Extra wait for Suno's SPA to hydrate and initial API calls to fire
  setStatus("Waiting for page...", "scanning");
  await sleep(3000);

  // 4. Scroll down to load all songs
  setStatus("Scrolling page...", "scanning");
  const scrollResponse = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "SCROLL_AND_LOAD" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });

  if (!scrollResponse?.done) {
    setStatus("Scan failed — try again", "error");
    setScanningState(false);
    return;
  }

  // 5. Fallback DOM scan
  chrome.tabs.sendMessage(tab.id, { type: "SCAN_DOM" }, async (domRes) => {
    if (domRes?.urls?.length) {
      await chrome.runtime.sendMessage({ type: "DOM_URLS", urls: domRes.urls });
    }
  });

  // 6. Wait for final API responses to settle
  await sleep(1500);
  await refreshSongs();

  const count = songs.length;
  setStatus(count > 0 ? `Found ${count}` : "No songs found", count > 0 ? "ready" : "error");
  setScanningState(false);
});

/**
 * Reloads a tab and returns a promise that resolves when the tab finishes loading.
 */
function reloadTabAndWait(tabId) {
  return new Promise((resolve) => {
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.reload(tabId);
  });
}

// ---- Clear ----
clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_SONGS" });
  songs = [];
  renderUI();
  setStatus("Ready", "ready");
  progressWrap.classList.add("hidden");
  progressFill.style.width = "0";
});

// ---- Download ----
downloadBtn.addEventListener("click", async () => {
  if (songs.length === 0 || isDownloading) return;

  const template    = templateInput.value.trim() || "suno-###";
  const subfolder   = subfolderInput.value.trim();
  const concurrency = parseInt(concurrencyRange.value, 10) || 3;

  if (!template.includes("#")) {
    setStatus("Template needs ###", "error");
    return;
  }

  isDownloading = true;
  downloadBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  setStatus("Downloading...", "scanning");

  await chrome.runtime.sendMessage({
    type: "DOWNLOAD_ALL",
    songs,
    template,
    subfolder,
    concurrency,
  });
});

// ---- Background message listener ----
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "SONGS_UPDATED":
      refreshSongs();
      break;

    case "DOWNLOAD_PROGRESS": {
      const pct = msg.total > 0 ? (msg.current / msg.total) * 100 : 0;
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${msg.current} / ${msg.total}`;
      break;
    }

    case "DOWNLOAD_COMPLETE":
      isDownloading = false;
      downloadBtn.disabled = false;
      setStatus(`Done! ${msg.total} files saved`, "done");
      progressFill.style.width = "100%";
      break;

    default:
      break;
  }
});

// ---- Helpers ----
async function refreshSongs() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SONGS" });
  songs = res?.songs ?? [];
  renderUI();
}

function renderUI() {
  songCountEl.textContent = songs.length;
  downloadBtn.disabled = songs.length === 0 || isDownloading;

  if (songs.length === 0) {
    songListSection.classList.add("hidden");
    return;
  }

  songListSection.classList.remove("hidden");

  const MAX_SHOW = 30;
  const shown = songs.slice(0, MAX_SHOW);

  songList.innerHTML = shown
    .map(
      (s, i) => `
    <div class="song-item">
      <span class="song-num">${i + 1}</span>
      <span class="song-title" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
    </div>`
    )
    .join("");

  if (songs.length > MAX_SHOW) {
    songList.innerHTML += `<div class="song-more">+${songs.length - MAX_SHOW} more songs</div>`;
  }
}

function setScanningState(scanning) {
  scanBtn.disabled = scanning;
  scanBtn.innerHTML = scanning
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Scanning...`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Scan Page`;
}

function setStatus(text, cls = "") {
  statusTextEl.textContent = text;
  statusTextEl.className = "stat-value status-text " + cls;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
