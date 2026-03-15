/**
 * background.js - Service Worker
 * Stores discovered songs from API intercepts and drives the download queue.
 */

// In-memory store: songId -> { id, title, audioUrl }
let discoveredSongs = new Map();
let isDownloading = false;

// ---- Message Routing ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "API_RESPONSE":
      handleApiResponse(msg.data);
      break;

    case "GET_SONGS":
      sendResponse({ songs: Array.from(discoveredSongs.values()) });
      break;

    case "CLEAR_SONGS":
      discoveredSongs.clear();
      broadcastSongsUpdated();
      sendResponse({ ok: true });
      break;

    case "DOWNLOAD_ALL":
      if (!isDownloading) {
        downloadAll(msg.songs, msg.template, msg.subfolder, msg.concurrency);
      }
      sendResponse({ ok: true });
      break;

    default:
      break;
  }

  return false;
});

// ---- API Response Parsing ----
function handleApiResponse(data) {
  if (!data) return;

  const beforeCount = discoveredSongs.size;

  // Suno returns arrays directly or objects with a clips/data array
  const candidates = Array.isArray(data)
    ? data
    : data.clips ?? data.songs ?? data.data ?? data.items ?? [];

  if (Array.isArray(candidates)) {
    candidates.forEach((item) => parseSongItem(item));
  }

  // Also recursively search top-level object values for nested arrays
  if (!Array.isArray(data) && typeof data === "object") {
    Object.values(data).forEach((val) => {
      if (Array.isArray(val)) val.forEach((item) => parseSongItem(item));
    });
  }

  if (discoveredSongs.size !== beforeCount) {
    broadcastSongsUpdated();
  }
}

function parseSongItem(item) {
  if (!item || typeof item !== "object") return;

  const audioUrl = item.audio_url ?? item.audioUrl ?? item.mp3_url ?? null;
  const id = item.id ?? item.clip_id ?? null;

  if (!audioUrl || !id) return;
  if (!audioUrl.includes(".mp3") && !audioUrl.includes("audio")) return;

  if (!discoveredSongs.has(id)) {
    discoveredSongs.set(id, {
      id,
      title: sanitizeTitle(item.title ?? item.name ?? `track-${id.slice(0, 8)}`),
      audioUrl,
    });
  }
}

function sanitizeTitle(title) {
  // Strip characters that are invalid in filenames
  return title.replace(/[\\/:*?"<>|]/g, "-").trim();
}

// ---- Download Queue ----
async function downloadAll(songs, template, subfolder, concurrency = 3) {
  if (!songs || songs.length === 0) return;

  isDownloading = true;
  let completed = 0;
  broadcastProgress(0, songs.length);

  // Work through the list using a fixed-size concurrency pool
  let index = 0;

  async function worker() {
    while (index < songs.length) {
      const i = index++;
      const song = songs[i];
      const filename = buildFilename(template, i + 1, subfolder);

      try {
        await triggerDownload(song.audioUrl, filename);
      } catch (err) {
        console.warn(`Download failed for ${song.title}:`, err);
      }

      completed++;
      broadcastProgress(completed, songs.length);

      // Small stagger between each worker's requests
      await sleep(400);
    }
  }

  // Launch `concurrency` workers in parallel
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  isDownloading = false;
  broadcastDownloadComplete(songs.length);
}

/**
 * Builds a filename from the template.
 * The longest run of '#' characters is replaced with a zero-padded index.
 * Example: "mysong-###" + index 5 => "mysong-005"
 */
function buildFilename(template, index, subfolder) {
  const hashMatch = template.match(/#+/);
  let name;

  if (hashMatch) {
    const padLen = hashMatch[0].length;
    const padded = String(index).padStart(padLen, "0");
    name = template.replace(/#+/, padded);
  } else {
    name = `${template}-${String(index).padStart(3, "0")}`;
  }

  // Ensure .mp3 extension
  if (!name.toLowerCase().endsWith(".mp3")) name += ".mp3";

  // Prepend subfolder path if provided (goes inside the browser's Downloads dir)
  if (subfolder && subfolder.trim()) {
    const cleanFolder = subfolder.trim().replace(/[\\:*?"<>|]/g, "-");
    return `${cleanFolder}/${name}`;
  }

  return name;
}

function triggerDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Wait for the download to actually finish before resolving
        function onChanged(delta) {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === "complete") {
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve(downloadId);
          } else if (delta.state?.current === "interrupted") {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error(`Download interrupted: ${delta.error?.current || "unknown"}`));
          }
        }
        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}

// ---- Broadcast Helpers ----
function broadcastSongsUpdated() {
  chrome.runtime.sendMessage({
    type: "SONGS_UPDATED",
    count: discoveredSongs.size,
  }).catch(() => {});
}

function broadcastProgress(current, total) {
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_PROGRESS",
    current,
    total,
  }).catch(() => {});
}

function broadcastDownloadComplete(total) {
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_COMPLETE",
    total,
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
