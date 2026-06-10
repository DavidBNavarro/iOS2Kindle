# web2kindle — Current Architecture & Workflow

## Files
- `ios/iOS2Kindle.js` (entry point, runs in Scriptable)
- `ios/bundle.js` (JSZip + Readability + EPUB generators, loaded by iOS2Kindle.js)
- `tests/test_full_pipeline.js`, `tests/test_wikipedia.js` (local validation)

## How It Works

1. **iOS2Kindle.js** fetches article HTML via `Request`, loads `bundle.js` into a **WebView**, processes the article using Readability inside the WebView, builds the EPUB and base64-encodes it all within the WebView, returns the base64 string. Then sends the EPUB to Kindle via the **Gmail API** (fully automatic, no compose sheet).

2. **Everything binary happens inside the WebView** — ZIP building, `String.fromCharCode`, `btoa()`. This is critical because Scriptable's JavaScriptCore `btoa()` may mishandle bytes >127 (producing UTF-8 double-encoding corruption). Safari's WebView `btoa()` handles binary bytes correctly.

3. **Bundle.js** is evaled in TWO contexts: first in the main context (for utility functions: `_sanitizeKindleText`, `_esc`, `_uuid`, `_epubXmlHeader`, `_xhtmlDoctype`, `_containerXml`, `_contentOpf`, `_tocNcx`, `_KINDLE_CSS`, `escapeHtml`), then again in the WebView (for Readability, `_sanitizeHtmlForEpub`, `stripUiText`, `stripTrailingRelated`, `_restoreHeadings`, `_supplementContent`, `_extractDomArticle`, `_contentFingerprint`, `_isArticleContentElement`, `_findArticleContainer`, `_selfCloseVoidElements`, `generateEpub`, `generateCoverImageSvg`, `generateDetailsPage`).

## iOS Gmail API Flow (iOS2Kindle.js)

### First Run
1. Check `Keychain` for `ios2kindle_gmail_refresh` — if missing, launch **OAuth2 WebView** to `accounts.google.com/o/oauth2/v2/auth` (scope: `gmail.send`, access_type: offline)
2. User logs into Google and grants consent
3. Script polls the WebView for the authorization code (from `.code` element on the OOB page)
4. Exchanges code for `access_token` + `refresh_token` via POST to `oauth2.googleapis.com/token`
5. Stores `refresh_token` in `Keychain`

### Every Share
6. Gets fresh `access_token` by exchanging the stored `refresh_token`
7. Builds RFC 2822 MIME message with EPUB as base64 attachment (76-char wrapped lines)
8. Base64url-encodes the MIME message and POSTs to `gmail.googleapis.com/gmail/v1/users/me/messages/send`
9. Shows "Sent to Kindle!" alert

### Keychain Storage
- `ios2kindle_gmail_refresh` — Google OAuth2 refresh token (never expires unless revoked)
- If token refresh fails, key is removed and first-run flow triggers again

### Credentials (hardcoded, do NOT commit to git)
- `CLIENT_ID`, `CLIENT_SECRET` from Google Cloud Console (Desktop app OAuth2 client)
- `KINDLE_EMAIL` — Send-to-Kindle address

## Key Constraints
- **No DOMParser/XMLSerializer** in main context — only available inside WebView
- **No JSZip** — causes `setImmediate` error in JavaScriptCore; use custom ZIP builder
- **No `btoa()` in main context** — may corrupt binary bytes >127; use WebView's `btoa()`
- **Dropbox corrupts binary EPUBs** (UTF-8 re-encoding) — always test from iOS directly, or AirDrop to Mac
- **EPUB 2.0.1** — content documents must use XHTML 1.1; OPF version 2.0; NCX for TOC

## Custom ZIP Builder
Located in iOS2Kindle.js (embedded in the WebView eval string). Produces valid ZIP with:
- `mimetype` first, stored (no compression)
- All other files stored (no compression)
- Proper little-endian headers, CRC32, and EOCD record
- UTF-8 encoded filenames and data

## EPUB Structure
```
mimetype
META-INF/container.xml
OEBPS/content.xhtml   (XHTML 1.1 DOCTYPE, xml:lang="en" lang="en")
OEBPS/content.opf     (dc:title, dc:language, dc:date, dcterms:modified, dc:creator optional)
OEBPS/toc.ncx         (xml:lang="en", dtb:uid, dtb:depth, navPoints)
OEBPS/style/default.css
```

## Sanitization Chain (in WebView eval)
1. `_restoreHeadings` — replace heading content if it was stripped by Readability
2. `_supplementContent` — append article content missed by Readability (tables, lists, sidebars)
3. `stripUiText` — remove "If you buy something..." affiliate text
4. `stripTrailingRelated` — remove "related articles" section at end
5. `_sanitizeHtmlForEpub` — strip XHTML 1.1-illegal elements and attributes:
   - Unwrap: `article`, `section`, `header`, `main`, `footer`, `aside`, `nav`, `figure`, `figcaption`, `details`, `summary`, `bdi`, `font`, `center`
   - Remove: `input`, `button`, `label`, `select`, `textarea`, `form`, `fieldset`, `legend`, `meta`, `link`, `style`, `script`, `noscript`, `iframe`, `canvas`, `audio`, `video`, `source`, `track`, `svg`, `math`
   - Strip HTML5 attributes: `aria-*`, `on*`, `role`, `tabindex`, `playsinline`, `typeof`, `property`, `resource`, `prefix`, `vocab`, `about`, `datatype`, `inlist`, `contenteditable`, `spellcheck`, `hidden`, `draggable`, `translate`, `loading`, `sizes`, `srcset`, `frameborder`, `scrolling`, etc.
   - Strip all `id` attributes (prevents duplicates)
   - Replace `<picture>` with `<img>` child
   - Remove orphan `<li>` elements (not inside `<ul>`/`<ol>`)
   - Remove empty `<ul>`/`<ol>`
6. Strip links: `<a>` → inner text
7. Reassign heading IDs for TOC, deduplicating against existing IDs
8. `XMLSerializer.serializeToString` for proper XHTML serialization
9. Strip Unicode control characters (0x00-0x08, 0x0b-0x0c, 0x0e-0x1f, 0x7f-0x9f, zero-width chars, bidi controls, soft hyphens, BOM)

## Text Sanitization
`_sanitizeKindleText(text)` — applied to title, author, and navPoint labels:
- Removes emoji ranges (U+200D, U+20E3, U+2300–U+27BF, U+2934–U+2935, U+2B00–U+2BFF, U+3030, U+303D, U+3297, U+3299, U+FE0E–U+FE0F)
- Removes surrogate pairs (d800–dbff, dc00–dfff)
- Normalizes whitespace (multiple spaces → one, trims)

## Validation
```bash
# Run all tests
node tests/test_full_pipeline.js

# Wikipedia-specific test (hardcoded to EPUB article)
node tests/test_wikipedia.js

# Generate clean Web scraping EPUB for Kindle Previewer
node -e "..." # See tests/test_wikipedia.js for pattern

# Epubcheck (requires Java)
epubcheck tests/output/simple_article.epub

# Kindle Previewer (Mac)
cp tests/output/web_scraping.epub /tmp/ && kindlepreviewer /tmp/web_scraping.epub -log
```

## Test Fixtures
`tests/test_full_pipeline.js` tests 4 synthetic pages + validates ZIP structure via JSZip.
`tests/test_wikipedia.js` fetches live Wikipedia article, processes through full pipeline.
Output EPUBs go to `tests/output/`.

## Chrome Extension (`extension/`)

**Status: Working** — all sends via Gmail API OAuth (chrome.identity), no local server needed.

### Architecture
- `manifest.json` — MV3, permissions: activeTab, contextMenus, notifications, scripting, storage, identity
- `background.js` — service worker; handles `fetchPageContent` (with 429 retry + backoff), `sendEmail` (Gmail API via chrome.identity OAuth)
- `processor.js` — opened in a tab; full article pipeline: fetch → extract → post-process → EPUB → send
- `popup.js` — popup UI; supports inline paste send, opens processor tab for URL articles
- `preview.js` — preview/edit tab; stores pre-generated EPUB base64 in chrome.storage.local, sends via Gmail API
- `article-extractor.js` — Readability wrapper with metadata extraction
- `epub-generator.js` — JSZip-based EPUB generation
- `image-processor.js` — image rotation, format conversion, delivery optimization

### Send Flow (Gmail API)
1. `sendEmailViaBackground()` sends message to background.js
2. `background.js` calls `chrome.identity.getAuthToken({ interactive: true })` → OAuth consent
3. Fetches Gmail profile to get sender email
4. Builds RFC 2822 MIME message with EPUB as base64 attachment
5. POSTs to `gmail.googleapis.com/gmail/v1/users/me/messages/send`

### HTTP 429 Handling
- Background.js: 3 retries with exponential backoff (5s → 30s → 60s), respects Retry-After header
- Processor.js: fallback chain — archive.org/archive.ph → tab injection (read DOM from opener tab)

### Dev: Reload extension
`chrome://extensions` → refresh Web2Kindle after changing any extension file.

## History Restored
The `extension/` directory was restored from orphaned git commits (Jun 2026). The git history was squashed
to remove the Chrome extension files, but they remain recoverable via `git checkout f98b857 -- extension/`.

## Known Issues
- No Kindle-specific validator on Mac — use Kindle Previewer 3 for conversion check
- Console logging (`console.log`) errors in Scriptable — catch and show via Alert
- `generateEpub()` function in bundle.js uses JSZip + DOMParser in main context — NOT used by iOS2Kindle.js (would fail). Only used by local tests.
