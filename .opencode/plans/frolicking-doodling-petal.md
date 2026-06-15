# Add Cover & Details Pages to iOS EPUB

## Context

The iOS Scriptable workflow produces a barebones EPUB with only `content.xhtml`. Readability already extracts `siteName`, `publishedTime`, and `textContent` (for reading time), but these are discarded at `iOS2Kindle.js:190-191`. The `generateDetailsPage()` function already exists in `bundle.js:3134-3186` with all needed fields — it's just never called from the iOS flow.

## Changes

### 1. `ios/bundle.js` — Add cover generator & details CSS

**a. Replace `generateCoverImageSvg()` stub (line 3130-3132)** with `generateCoverXhtml({ title, authors })`:
- Pure XHTML cover page (no SVG/image, consistent with text-only EPUB)
- Centered title (`<h1>`), author below (`<p>`)
- Returns full XHTML string with XML header and xmlns

**b. Add details/cover CSS to `_KINDLE_CSS` (line 3188-3201):**
- `.details-page` — centered container
- `.details-table` — borderless table, generous spacing
- `.details-table .label` — bold, right-aligned, right-padding
- `.details-table .value` — left-aligned
- `.cover-page` — centered text, vertical padding

### 2. `ios/iOS2Kindle.js` — Extract metadata & add pages to EPUB

**In the WebView eval IIFE (lines 162-222):**

**a. Extract additional metadata (after line 191):**
```js
var siteName = _sanitizeKindleText(a.siteName || '');
var pubDate = _sanitizeKindleText(a.publishedTime || '');
var textContent = a.textContent || '';
var wordCount = textContent.trim() ? textContent.trim().split(/\s+/).length : 0;
var readTime = Math.max(1, Math.round(wordCount / 200));
```

**b. Generate cover XHTML:**
```js
var coverXhtml = generateCoverXhtml({ title: title, authors: author });
```

**c. Generate details XHTML:**
```js
var detailsXhtml = generateDetailsPage({
  title: title, authors: author, pubDate: pubDate,
  place: siteName, url: WV_URL,
  sentDate: new Date().toISOString().split("T")[0],
  readTime: readTime, keepLinks: false
});
```

**d. Update files array (lines 198-205):**
- Add `OEBPS/cover.xhtml` and `OEBPS/details.xhtml` entries

**e. Update manifest, spine, and navPoints:**
- Manifest: add `cover` and `details` items
- Spine: `['cover', 'details', 'content']`
- NavPoints: add cover (title) and details entries before content

### 3. `tests/test_full_pipeline.js` — Update test expectations

- Add `OEBPS/cover.xhtml` and `OEBPS/details.xhtml` to `expectedFiles` (line 259-260)
- Extract additional metadata in Phase 2 (siteName, pubDate, readTime from textContent)
- Generate cover and details XHTML in Phase 3 using same logic
- Add cover/details files to the files array and manifest/spine
- Verify cover page contains title text
- Verify details page contains expected fields (title, author, sent date)

## Files to Modify

| File | Action |
|------|--------|
| `ios/bundle.js` | Add `generateCoverXhtml()`, update CSS |
| `ios/iOS2Kindle.js` | Extract metadata, generate cover+details, update EPUB structure |
| `tests/test_full_pipeline.js` | Mirror changes, update assertions |

## Verification

1. `node tests/test_full_pipeline.js` — all 4 tests pass
2. `node tests/test_wikipedia.js` — live article test passes
3. epubcheck (if Java available) — validate output EPUBs
4. Manual: open output EPUB in Kindle Previewer to verify cover + details render
