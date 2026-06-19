# Newsletter-to-Kindle & Web Dashboard Design

**Date:** 2026-06-19  
**Status:** Draft

## Overview

Add inbound email forwarding to web2kindle, letting users forward newsletters to a unique address and receive them as EPUBs on their Kindle. Alongside, build a web dashboard that serves as a unified management hub for newsletters, RSS feeds (future), and extension-sent articles.

## User Experience

### Signup
1. User visits `web2kindle.com/register`
2. Enters their Kindle email address
3. Receives a unique forwarding address (`wk-abc123@inbound.web2kindle.com`) and an API key
4. Adds `noreply@web2kindle.com` to their Amazon approved senders list

### Forwarding newsletters
1. User forwards any newsletter to their unique address
2. System extracts the article content from the email HTML
3. EPUB appears on their Kindle automatically

### Web Dashboard (`/dashboard`)
- Shows forwarding address with copy button
- Usage stats ("6/20 newsletters sent this month")
- Unified send history (newsletters + extension articles + future RSS)
- Settings: update Kindle email, view API key
- RSS placeholders: "Coming soon - add RSS feeds to auto-send"

### Chrome Extension linking
1. User pastes API key in extension options
2. Extension sends include API key, attributed to user's account
3. Extension-converted articles appear in web dashboard history
4. History starts fresh when linked (no migration of existing local history)
5. Future: extension becomes thin client - just sends URL + API key, backend does the work

## Architecture

### Infrastructure

| Component | Tech | Purpose |
|-----------|------|---------|
| Web dashboard | Vercel static HTML + JS | Registration, dashboard, settings |
| API endpoints | Vercel serverless functions | All backend logic |
| Database | Turso (SQLite edge) | Users, sources, history, usage |
| Email receiving | SendGrid Inbound Parse | Receives forwarded newsletters |
| Email sending | SMTP (Resend or SendGrid SMTP) | Sends EPUBs to Kindle |
| Source code | This repo (`web2kindle/`) | Monorepo: extension + api + web |

### Domain note
`web2kindle.com` is used as a placeholder. Actual domain TBD. The noreply sender domain must match a domain with verified SMTP sending capability.

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `api/register.js` | POST | Create user, return forwarding address + API key |
| `api/inbound-email.js` | POST | Receive SendGrid webhook, process newsletter |
| `api/send.js` | POST | Generate EPUB + send to Kindle (shared by newsletters, extension, future RSS) |
| `api/history.js` | GET/DELETE | List/delete user's send history |
| `api/usage.js` | GET | Current month usage counts |
| `api/settings.js` | GET/PUT | Kindle email, preferences |
| `api/verify.js` | POST | Existing - license key verification |
| `api/summarize.js` | POST | Existing - AI summarization |

### Data Flow

```
NEWSLETTER PATH:
  Forward email -> SendGrid -> POST api/inbound-email.js
    -> Parse email (sender, subject, HTML body)
    -> Extract article content from HTML
    -> Call EPUB generation
    -> Send to Kindle via SMTP
    -> Log to history

EXTENSION PATH (current, will evolve):
  Extension -> extractArticle(html) -> generateEpub()
    -> sendEmail() via Gmail API -> Kindle
  (Future: POST api/send.js with URL + API key)

FUTURE RSS PATH:
  Cron/scheduled trigger -> fetch RSS feed -> for each new item
    -> Fetch full article -> Call api/send.js
```

### Database Schema (Turso SQLite)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- UUID
  api_key TEXT UNIQUE NOT NULL, -- w2k_xxx...
  kindle_email TEXT NOT NULL,
  forwarding_address TEXT UNIQUE NOT NULL,  -- wk-abc123@inbound...
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  year_month TEXT NOT NULL,     -- '2026-06'
  count INTEGER DEFAULT 0,
  source_type TEXT NOT NULL,    -- 'extension' | 'newsletter' | 'rss'
  UNIQUE(user_id, year_month, source_type)
);

CREATE TABLE send_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  url TEXT,
  source_type TEXT NOT NULL,    -- 'extension' | 'newsletter' | 'rss'
  sent_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'sent'    -- 'sent' | 'failed' | 'rejected'
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,          -- UUID
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,           -- 'newsletter' | 'rss'
  address TEXT,                 -- forwarding address for newsletter
  feed_url TEXT,                -- RSS feed URL (future)
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Server-Side EPUB Pipeline

The newsletter path needs to run EPUB generation server-side (Node.js). The existing extension pipeline uses browser APIs. Adaptations needed:

| Browser API | Server-Side Replacement |
|-------------|------------------------|
| `DOMParser` | `jsdom` (already a dev dependency) |
| `XMLSerializer` | `jsdom` |
| `fetch` | Node.js native (18+) |
| Canvas / OffscreenCanvas | Skip image rotation for newsletters; or add `canvas` npm package if needed |
| `blobToBase64` | Node.js Buffer |

Newsletters are simpler than web articles - mostly text, fewer images, no landscape photos needing rotation. A stripped-down pipeline is acceptable initially.

### Email HTML Extraction

Newsletter emails arrive as multipart MIME with an HTML body. The extraction approach:

1. Parse the MIME email from SendGrid webhook payload
2. Extract HTML body (preferred) or plain text fallback
3. Strip email chrome (forwarded message headers like "---------- Forwarded message ---------")
4. Run through extraction focused on newsletter structure
5. Sanitize for EPUB (same `_sanitizeHtmlForEpub` rules)

For extraction, consider:
- Keep: `<p>`, `<h1>`-`<h6>`, `<img>`, `<a>`, `<ul>/<ol>/<li>`, `<blockquote>`, `<table>`, `<hr>`, `<br>`
- Strip all other tags
- Strip inline styles (email HTML is notoriously style-heavy)
- Remove tracking pixels (1x1 images with tracking URLs)
- Remove "View in browser" links, "Unsubscribe" links, footer boilerplate

### Sending to Kindle

**Sender:** `noreply@web2kindle.com` via SMTP (Resend or SendGrid SMTP relay)
**To:** User's Kindle email
**Subject:** `convert`
**Attachment:** EPUB file

Flow:
1. Build MIME multipart/mixed message with EPUB attachment
2. `To:` user's Kindle email, `From: noreply@web2kindle.com`
3. Send via SMTP (not Gmail API - no per-user OAuth needed)

### Free Tier & Limits

- **20 newsletters/month** (free)
- **Separate pool for extension** articles (limit TBD later)
- Counter stored in `usage` table, resets monthly
- Over-limit: bounce email with reply ("You've reached your monthly limit. Upgrade to Pro for unlimited.")

### Extension History

When a user links their API key in the extension, no history migration occurs. History starts fresh from that point forward, stored server-side via API calls.

## Future

### RSS Feeds

The `sources` table already supports `type: 'rss'`. When implemented:
- `POST api/rss/add` - add RSS feed URL
- `POST api/rss/remove` - remove feed
- Scheduled job (Vercel cron or external) polls feeds, sends new items
- Dashboard shows connected RSS feeds with toggle on/off

### Extension as Thin Client

Instead of running the full EPUB pipeline in the browser:
1. Extension sends `POST api/send.js` with `{ url, api_key }`
2. Backend fetches the article, extracts content, generates EPUB, sends to Kindle
3. Extension just handles the UX (popup, preview, batch)
4. Gmail OAuth can be removed from the extension entirely
