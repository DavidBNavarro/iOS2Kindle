var _SUMMARIZE_ENDPOINT = "https://web2kindle-sooty.vercel.app/api/summarize";
var _SUMMARY_PREFIX = "summary_cache_";
var _CACHE_TTL = 24 * 60 * 60 * 1000;
var _MAX_CHARS = 8000;

async function _getCachedSummary(url) {
  if (!url) return null;
  var key = _SUMMARY_PREFIX + url;
  var result = await chrome.storage.local.get(key);
  var cached = result[key];
  if (!cached) return null;
  if (Date.now() - cached.timestamp > _CACHE_TTL) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return cached.summary;
}

async function _setCachedSummary(url, summary) {
  if (!url) return;
  var key = _SUMMARY_PREFIX + url;
  await chrome.storage.local.set({
    [key]: { summary: summary, timestamp: Date.now() }
  });
}

async function summarizeArticle(textContent, url) {
  var pro = await hasProLicense();
  if (!pro) return null;
  if (url) {
    var cached = await _getCachedSummary(url);
    if (cached) return cached;
  }
  var licenseKey = await getStoredLicenseKey();
  if (!licenseKey) return null;
  var text = textContent || "";
  if (text.length > _MAX_CHARS) {
    text = text.slice(0, _MAX_CHARS) + "\u2026";
  }
  try {
    var resp = await fetch(_SUMMARIZE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: licenseKey,
        text: text,
        url: url || ""
      })
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    if (!data.summary) return null;
    if (url) await _setCachedSummary(url, data.summary);
    return data.summary;
  } catch (err) {
    console.warn("Summarization failed:", err);
    return null;
  }
}
