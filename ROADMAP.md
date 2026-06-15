# iOS Roadmpa
Turn scriptable workflow more immediate: currently saves to files and then i send manually to my kindle address. I want the saved file to be sent directly by email, without my intervention.

# Web2Kindle Roadmap


## 🟢 Ready now (no blockers, standalone)
- **7-day unlimited trial** — trial mode for Pro before requiring purchase
https://en.wikipedia.org/wiki/Web_scraping

## 🟡 Needs prerequisite first
_none_

## 🔵 Done
| Task | Area | Completed |
|---|---|---|
| **Conversion counter** — `chrome.storage.local` counter, caps at 10 free conversions, increments on send/download | Extension core | 2026-05-13 |
| **License key system** — format validation, Vercel HMAC verification endpoint, `chrome.storage.sync` persistence | Extension core | 2026-05-13 |
| **Pro upgrade UI** — nudge at 8-9, block card at 10, PRO badge, Settings input, Remove License button | Extension UX | 2026-05-13 |
| **Estimated read time** — "X min read" in EPUB details page and popup | Core pipeline | 2026-05-11 |
| **Links in Kindle** — `_reinject_links()` restores `<a>` tags from original HTML | Core pipeline | 2026-05-13 |
| **EPUB details page** — `generate_details_page_html()` ported to `extension/epub-generator.js` | Core pipeline | 2026-05-11 |
| **Image pipeline (JS code written)** — `extension/image-processor.js` implements 4 Canvas functions + heuristics + tests | Core pipeline | Code exists, tests pass |
| **"Save EPUB" / download** — Download button triggers EPUB blob download | Extension UX | 2026-05-13 |
| **History in `chrome.storage.local`** — migrated from server `history.db`, capped at 500 | Extension UX | 2026-05-13 |
| **SMTP relay server** — standalone `smtp_relay.py` (port 5002). Accepts EPUB + SMTP config via JSON POST → smtplib. | SMTP relay | 2026-05-14 |
| **Multi-send** — comma-separated Kindle addresses, BCC delivery to all, helper text in settings UI | SMTP relay + Extension UX | 2026-05-14 |
| **Batch URL queue** — paste multiple URLs in a textarea, auto-detect batch, process sequentially, individual EPUBs | Extension UX | 2026-05-14 |
| **Wire image-processor.js into extension** — `<script>` tag added in popup.html alongside other modules. File is written (149 lines, tested) and now loaded. | Core pipeline | 2026-05-14 |
| **Cover image SVG** — `generateCoverImageSvg()` in `epub-generator.js` replaces PIL-based `generate_cover_image()` with inline SVG. Kindle-rendered, 3 template variants. | Core pipeline | 2026-05-14 |
| **Article post-processing (JS port)** — strip UI text, remove related-content, restore `<ol>`/`<blockquote>`. Ported server.py's 200+ lines of BeautifulSoup to DOM APIs in `article-extractor.js`. | Core pipeline | 2026-05-14 |
| **Image pipeline wiring (Canvas)** — `generateEpub()` accepts `imageProcessor` interface; `image-processor.js` fetched/resized/rotates via Canvas. | Core pipeline | 2026-05-14 |
| **Browser-native article processing** — Readability + JSZip replace server-side trafilatura + ebooklib. Full in-extension pipeline: fetch → extract → post-process → EPUB → download/send. Server stripped to SMTP relay only. | Core pipeline | 2026-05-14 |
| **Preview + send flow (browser-native)** — in-browser preview via `preview.html`, section editing, metadata display, send to Kindle from preview. Replaces server `/article/generate-preview` → `/view/<token>`. | Extension UX | 2026-05-15 |
| **Delivery optimization** — `deliveryOptimize()` recompresses JPEGs to q75, downscales >1600px via Canvas, strips preview-only UI from EPUB. `warnEpubSize()` estimates size and blocks send if >25MB. | SMTP relay | 2026-05-15 |
| **Paywall bypass** — `resolveArchiveUrl()` in `popup.js` rewrites paywalled URLs to archive.is/archive.org before fetch. Config-driven via chrome.storage.sync. Removed dead contentScript.js. | Site compatibility | 2026-05-16 |
| **SMTP creds in chrome.storage** — SMTP config migrated from server `config.json` to `chrome.storage.sync`. Extension sends creds inline with `/send-epub`. `/config` API removed. | Extension core | 2026-05-16 |
| **Wire extension to smtp_relay.py** — extension sends EPUBs to `smtp_relay.py` port 5002 via base64 JSON instead of `server.py` multipart `/send-epub`. `server.py` fully optional. Resend button removed. | Extension core | 2026-05-16 |
| **10a. Google Cloud OAuth setup** — project created, Gmail API enabled, consent screen configured, OAuth client ID created. | Ops | 2026-05-16 |
| **10b. background.js Gmail send** — `chrome.identity.getAuthToken()` + Gmail API with base64 EPUB attachment. | Extension core | 2026-05-16 |
| **10c. popup.js relay removal** — send functions switched to background message. Relay/SMTP field references removed from popup. | Extension core | 2026-05-16 |
| **10d. Remove SMTP/relay config from options** — SMTP fields and relay URL removed from settings page. | Extension UX | 2026-05-16 |
| **10e. Drop health check** — server status indicator removed from popup. | Extension core | 2026-05-16 |
| **Right-click context menu** — "Send to Kindle" and "Send to Kindle (Preview)" on links and text selections via hidden processor tab | Extension UX | 2026-05-23 |
| **Privacy policy page** — `docs/privacy.html` deployed via GitHub Pages for CWS listing compliance | CWS submission | 2026-06-03 |

## 🔘 Not yet scoped (stretch / future)
- **Chrome Web Store submission**
  - CWS developer account registration ($5 fee)
  - Store listing assets (screenshots 1280×800, promo tile 1400×560, small tile 440×280, description)
  - `<all_urls>` permission justification for CWS review
  - Landing page at web2kindle.com for CWS upgrade links
  - Content marketing: blog posts, comparison charts vs Amazon's Send to Kindle
- **Monetization (subscription model)** — replace/concurrent with one-time $7. Subscription preferred (monthly/yearly). Requires:
  - Lemon Squeezy checkout page with recurring billing
  - Deploy Vercel HMAC verification endpoint (code exists)
  - Revisit conversion cap UX for subscription vs one-time
- **Firefox + Edge ports** — port extension to other browsers (doubles addressable market)
- **EPUB polish** — template customization, advanced styling presets, keyboard shortcuts (`Cmd+Shift+E`), `{title} - {date}.epub` naming
- **Per-site profiles** — custom extraction rules per-hostname for sites Readability struggles with. Build when a real problem site appears; no point designing in the abstract.
- **SMTP relay deployment** — pip package, Dockerfile, serverless adapter
- **Optional PWA** — SMTP relay + static HTML for non-extension users

---

## Dependency map

```
```
┌─────────────────────────────────────────────────┐
│ Extension (fully serverless) ✅                 │
│                                                 │
│  Article pipeline (all client-side):            │
│    fetchViaBackground → resolveArchiveUrl       │
│    → extractArticle → post-process → generateEpub│
│                                                 │
│  Send: background.js → chrome.identity          │
│    → Gmail API → Kindle                         │
│                                                 │
│  Features (all chrome.storage):                 │
│    History, batch queue, preview,               │
│    conversion counter, license system,           │
│    paywall config, Kindle email                  │
└─────────────────────────────────────────────────┘

Dependencies by task:
  1-6  Browser-native pipeline (article processing, EPUB gen, images) ✅
  7    Paywall bypass (resolveArchiveUrl) ✅
  8    SMTP creds in chrome.storage ✅
  9    Wire to smtp_relay.py ✅
  10   Gmail API (serverless) ✅
        10a: Google Cloud OAuth setup ✅
        10b: background.js Gmail send ✅
        10c: popup relay removal ✅
        10d: options cleanup ✅
        10e: drop health check ✅
```

## What to tackle next

_none — all planned tasks complete._
