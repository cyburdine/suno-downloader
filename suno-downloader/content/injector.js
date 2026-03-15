/**
 * injector.js - Runs in MAIN world (page context)
 * Intercepts fetch calls to capture Suno API responses containing song data.
 * Communicates back to the isolated content script via window.postMessage.
 */
(function () {
  if (window.__sunoInjected) return;
  window.__sunoInjected = true;

  const SUNO_PATTERNS = [
    /suno\.ai\/api\//,
    /suno\.com\/api\//,
    /studio-api\.suno/,
    /\/api\/feed/,
    /\/api\/generate/,
    /\/api\/clip/,
    /\/api\/playlist/
  ];

  function shouldCapture(url) {
    return SUNO_PATTERNS.some((p) => p.test(url));
  }

  function extractUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    return "";
  }

  // --- Intercept fetch ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = extractUrl(args[0]);

    if (shouldCapture(url)) {
      try {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            window.postMessage(
              { type: "SUNO_API_RESPONSE", url, data },
              "*"
            );
          })
          .catch(() => {});
      } catch (_) {}
    }

    return response;
  };

  // --- Intercept XHR as fallback ---
  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let capturedUrl = "";

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      capturedUrl = url;
      return originalOpen(method, url, ...rest);
    };

    xhr.addEventListener("load", function () {
      if (shouldCapture(capturedUrl)) {
        try {
          const data = JSON.parse(xhr.responseText);
          window.postMessage(
            { type: "SUNO_API_RESPONSE", url: capturedUrl, data },
            "*"
          );
        } catch (_) {}
      }
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
