# web2kindle — Current Architecture & Workflow

## EPUB Structure
```
mimetype
META-INF/container.xml
OEBPS/content.xhtml   (XHTML 1.1 DOCTYPE, xml:lang="en" lang="en")
OEBPS/content.opf     (dc:title, dc:language, dc:date, dcterms:modified, dc:creator optional)
OEBPS/toc.ncx         (xml:lang="en", dtb:uid, dtb:depth, navPoints)
OEBPS/style/default.css
```

## Sanitization Chain
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
# Run tests
node tests/test_full_pipeline.js
node tests/test_generateEpub.js

# Epubcheck (requires Java)
epubcheck tests/output/simple_article.epub

# Kindle Previewer (Mac)
cp tests/output/web_scraping.epub /tmp/ && kindlepreviewer /tmp/web_scraping.epub -log
```

## Test Fixtures
`tests/test_full_pipeline.js` tests 4 synthetic pages + validates ZIP structure via JSZip.
`tests/test_generateEpub.js` tests EPUB generation via `generateEpub` using JSZip.
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

## SMTP Delivery (Server-side)
- Uses **port 465 direct TLS** (`tls.connect()`), NOT port 587 STARTTLS — Vercel Lambda's `tls.connect({socket: plain})` fails silently
- `lib/smtp-send.js`: native Node.js `net`/`tls` zero-dep SMTP client
- `SMTP_FROM` must be a **verified SendGrid sender identity** (single sender or domain-authenticated)
- `SMTP_USER` is `apikey`, `SMTP_PASS` is the SendGrid API key

## Known Issues
- No Kindle-specific validator on Mac — use Kindle Previewer 3 for conversion check
- Dropbox corrupts binary EPUBs (UTF-8 re-encoding) — always test from Chrome directly, or AirDrop to Mac
- SendGrid requires from-address to be verified sender identity — `davidbnavarro@gmail.com` currently used; ideally set up domain auth for `web2reader.com`
