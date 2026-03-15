/**
 * content.js - Runs in isolated world
 * Bridges messages between the MAIN world injector and the background service worker.
 * Also handles scrolling the page to load all songs.
 */

// Forward API responses from the injected MAIN-world script to the background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "SUNO_API_RESPONSE") return;

  chrome.runtime.sendMessage({
    type: "API_RESPONSE",
    url: event.data.url,
    data: event.data.data,
  }).catch(() => {});
});

// Listen for commands from the popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCROLL_AND_LOAD") {
    scrollToLoadAll()
      .then(() => sendResponse({ done: true }))
      .catch((err) => sendResponse({ done: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === "SCAN_DOM") {
    const urls = scanDomForAudio();
    sendResponse({ urls });
    return true;
  }
});

/**
 * Finds the actual scrollable container in Suno's React SPA.
 * Walks all elements and returns the deepest one with overflow scroll/auto
 * that has real scrollable height.
 */
function findScrollableContainer() {
  // First try known Suno class/role patterns
  const candidates = [
    document.querySelector('main'),
    document.querySelector('[class*="overflow"]'),
    document.querySelector('[class*="scroll"]'),
    document.querySelector('[class*="feed"]'),
    document.querySelector('[class*="content"]'),
    document.querySelector('[class*="songs"]'),
    document.querySelector('[class*="library"]'),
  ].filter(Boolean);

  // Also walk ALL elements to find any that are actually scrollable
  const all = Array.from(document.querySelectorAll("*"));
  for (const el of all) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflow + style.overflowY;
    if (/auto|scroll/.test(overflow) && el.scrollHeight > el.clientHeight + 50) {
      candidates.push(el);
    }
  }

  // Pick the one with the most scrollable height -- that's our feed container
  if (candidates.length === 0) return null;

  return candidates.reduce((best, el) => {
    const gain = el.scrollHeight - el.clientHeight;
    const bestGain = best.scrollHeight - best.clientHeight;
    return gain > bestGain ? el : best;
  });
}

/**
 * Scrolls the correct container to the bottom incrementally,
 * waiting for new content to load each time.
 */
async function scrollToLoadAll() {
  const SCROLL_DELAY = 1400;
  const STABLE_THRESHOLD = 3;

  // Give the page a moment to settle before we start
  await sleep(500);

  const container = findScrollableContainer();

  // Scroll both the container AND window -- one of them will work
  function doScroll(target) {
    const maxScroll = target === window
      ? document.body.scrollHeight
      : target.scrollHeight;
    if (target === window) {
      window.scrollTo({ top: maxScroll, behavior: "smooth" });
    } else {
      target.scrollTo({ top: maxScroll, behavior: "smooth" });
    }
  }

  function getHeight(target) {
    return target === window ? document.body.scrollHeight : target.scrollHeight;
  }

  const targets = container ? [container, window] : [window];

  for (const target of targets) {
    let lastHeight = 0;
    let stableCount = 0;

    while (stableCount < STABLE_THRESHOLD) {
      doScroll(target);
      await sleep(SCROLL_DELAY);

      const currentHeight = getHeight(target);
      if (currentHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = currentHeight;
      }
    }
  }

  // Extra wait for final API responses to settle
  await sleep(1500);

  // Scroll back to top
  if (container) container.scrollTo({ top: 0, behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Fallback: scan DOM for <audio> elements or elements with data-audio-url attributes.
 */
function scanDomForAudio() {
  const urls = new Set();

  // Look for <audio> src attributes
  document.querySelectorAll("audio[src]").forEach((el) => {
    if (el.src && el.src.includes(".mp3")) urls.add(el.src);
  });
  document.querySelectorAll("audio source[src]").forEach((el) => {
    if (el.src && el.src.includes(".mp3")) urls.add(el.src);
  });

  // Look for any element with a data attribute containing an mp3 URL
  document.querySelectorAll("[data-audio-url], [data-src]").forEach((el) => {
    const val = el.dataset.audioUrl || el.dataset.src || "";
    if (val.includes(".mp3")) urls.add(val);
  });

  // Look for any anchor tag pointing to an mp3
  document.querySelectorAll('a[href*=".mp3"]').forEach((el) => {
    urls.add(el.href);
  });

  return Array.from(urls);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
