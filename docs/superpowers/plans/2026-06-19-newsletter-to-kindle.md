# Newsletter-to-Kindle & Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound email forwarding (newsletter-to-Kindle) and a unified web dashboard for user registration, history, and future RSS management.

**Architecture:** Vercel serverless functions handle all backend logic. SendGrid Inbound Parse receives forwarded newsletters and POSTs to our webhook. A server-side EPUB pipeline (adapted from the extension via jsdom) converts email content. SMTP via nodemailer sends EPUBs to Kindle from a shared sender address. Turso (SQLite edge) stores users, history, and usage data.

**Tech Stack:** Node.js (Vercel serverless), Turso (@libsql/client), jsdom + JSZip (EPUB gen), nodemailer (SMTP), SendGrid Inbound Parse (email receiving)

---

## File Structure

```
NEW:
  lib/db.js                  — Turso client, CRUD for users/usage/history
  lib/smtp-sender.js         — nodemailer SMTP transport, Kindle send
  lib/email-parser.js        — Parse SendGrid webhook payload
  lib/html-extractor.js      — Extract article from newsletter HTML
  lib/epub-generator-node.js — Server-side EPUB generation (jsdom)
  lib/sanitize-epub.js       — EPUB HTML sanitization (shared rules)
  api/register.js            — POST: create user, return key + address
  api/inbound-email.js       — POST: SendGrid webhook, process newsletter
  api/history.js             — GET/DELETE: user send history
  api/usage.js               — GET: monthly usage counts
  api/auth.js                — API key auth middleware
  web/index.html             — Landing page
  web/register.html          — Signup form
  web/dashboard.html         — Dashboard (address, history, settings, RSS)
  tests/test_db.js
  tests/test_smtp_sender.js
  tests/test_email_parser.js
  tests/test_html_extractor.js
  tests/test_api_register.js
  tests/test_api_inbound.js
  tests/test_integration.js

MODIFIED:
  package.json               — Add deps, test script
  vercel.json                — Add static rewrites for web/
  extension/options.html     — Add API key field
  extension/options.js       — Save/load API key, link to dashboard
  extension/history-store.js — Add API key to send for server-side logging
  kanban.html                — Move card to In Progress
```

---

### Task 1: Infrastructure Setup

**Files:**
- Modify: `package.json`
- Modify: `vercel.json`

- [ ] **Step 1: Install npm dependencies**

```bash
npm install @libsql/client nodemailer
```

- [ ] **Step 2: Update package.json with test script and new deps**

The package.json `scripts` and `dependencies` should end up as:

```json
{
  "name": "web2kindle",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "test": "node tests/test_db.js && node tests/test_smtp_sender.js && node tests/test_email_parser.js && node tests/test_html_extractor.js && node tests/test_api_register.js && node tests/test_api_inbound.js && node tests/test_integration.js",
    "test:epub": "node tests/test_generateEpub.js"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "jsdom": "^29.1.1",
    "jszip": "^3.10.1",
    "nodemailer": "^6.9.0"
  }
}
```

- [ ] **Step 3: Update vercel.json for static web serving**

```json
{
  "framework": null,
  "rewrites": [
    { "source": "/", "destination": "/web/index.html" },
    { "source": "/register", "destination": "/web/register.html" },
    { "source": "/dashboard", "destination": "/web/dashboard.html" }
  ]
}
```

- [ ] **Step 4: Create environment variables file for local dev**

Create `.env.example` (not committed, for documentation):

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
SENDGRID_INBOUND_SECRET=webhook-auth-token
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxx
SMTP_FROM=noreply@web2kindle.com
LICENSE_HMAC_SECRET=dev-secret
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vercel.json .env.example
git commit -m "chore: add dependencies and config for newsletter-to-kindle"
```

---

### Task 2: EPUB HTML Sanitization (shared`

**Files:**
- Create: `lib/sanitize-epub.js`
- Test: `tests/test_sanitize_epub.js`

Extract the EPUB HTML sanitization rules from `extension/epub-generator.js` `_sanitizeHtmlForEpub` into a shared module used by both the extension and the server-side pipeline. This avoids duplicating the complex tag/attribute stripping logic.

- [ ] **Step 1: Write the test**

Create `tests/test_sanitize_epub.js`:

```js
const { JSDOM } = require("jsdom");
const { sanitizeHtmlForEpub } = require("../lib/sanitize-epub");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

test("strips HTML5 semantic tags (unwrap)", () => {
  const input = "<body><article><p>Hello</p></article></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<article")) throw new Error("article tag not stripped");
  if (!result.includes("<p>Hello</p>")) throw new Error("inner content lost");
});

test("strips forbidden elements", () => {
  const input = "<body><p>Hi</p><script>alert(1)</script><iframe src='x'></iframe></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<script")) throw new Error("script not stripped");
  if (result.includes("<iframe")) throw new Error("iframe not stripped");
});

test("strips HTML5 attributes", () => {
  const input = "<body><p aria-label='x' role='main' data-foo='bar' onclick='x'>Hi</p></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("aria-label")) throw new Error("aria not stripped");
  if (result.includes("role=")) throw new Error("role not stripped");
  if (result.includes("data-foo")) throw new Error("data-* not stripped");
  if (result.includes("onclick")) throw new Error("on* not stripped");
});

test("strips id attributes", () => {
  const input = "<body><h1 id='title'>Hi</h1></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("id=")) throw new Error("id not stripped");
});

test("preserves img tags", () => {
  const input = "<body><img src='x.jpg' alt='pic'></body>";
  const result = sanitizeHtmlForEpub(input);
  if (!result.includes("<img ")) throw new Error("img tag lost");
});

test("replaces picture with img child", () => {
  const input = "<body><picture><source srcset='x.webp'><img src='x.jpg'></picture></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<picture")) throw new Error("picture not stripped");
  if (!result.includes("<img ")) throw new Error("img lost from picture");
});

test("removes orphan li elements", () => {
  const input = "<body><li>orphan</li><ul><li>valid</li></ul></body>";
  const result = sanitizeHtmlForEpub(input);
  const orphanCount = (result.match(/<li/g) || []).length;
  if (orphanCount !== 1) throw new Error("expected 1 li, got " + orphanCount);
});

test("removes empty ul/ol", () => {
  const input = "<body><ul></ul><ol><li>one</li></ol></body>";
  const result = sanitizeHtmlForEpub(input);
  const ulEmpty = result.includes("<ul></ul>") || result.includes("<ul>\n</ul>");
  if (ulEmpty) throw new Error("empty ul not removed");
  if (!result.includes("<ol>")) throw new Error("non-empty ol removed");
});

test("preserves normal HTML elements", () => {
  const input = "<body><h1>Title</h1><p>Par <b>bold</b> <i>italic</i></p><blockquote cite='x'>Q</blockquote></body>";
  const result = sanitizeHtmlForEpub(input);
  if (!result.includes("<h1>")) throw new Error("h1 lost");
  if (!result.includes("<b>")) throw new Error("b lost");
  if (!result.includes("<i>")) throw new Error("i lost");
  if (!result.includes("<blockquote")) throw new Error("blockquote lost");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_sanitize_epub.js
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the shared sanitization module**

Create `lib/sanitize-epub.js` — extract the sanitization rules from `extension/epub-generator.js` `_sanitizeHtmlForEpub()`:

```js
/**
 * Sanitize HTML for XHTML 1.1 EPUB compatibility.
 * Strips HTML5-only elements and attributes.
 * Extracted from extension/epub-generator.js for reuse server-side.
 */

const UNWRAP_TAGS = new Set([
  "article", "section", "header", "main", "footer", "aside", "nav",
  "figure", "figcaption", "details", "summary", "bdi", "font", "center"
]);

const REMOVE_TAGS = new Set([
  "input", "button", "label", "select", "textarea", "form",
  "fieldset", "legend", "meta", "link", "style", "script", "noscript",
  "iframe", "canvas", "audio", "video", "source", "track", "svg", "math"
]);

const STRIP_ATTRS = /^(aria-|on|data-|role|tabindex|playsinline|typeof|property|resource|prefix|vocab|about|datatype|inlist|contenteditable|spellcheck|hidden|draggable|translate|loading|sizes|srcset|frameborder|scrolling|autocomplete|autofocus|autoplay|controls|loop|muted|preload|poster|width|height|align|valign|bgcolor|border|cellpadding|cellspacing|colspan|rowspan|nowrap|start|type|value|checked|selected|disabled|readonly|placeholder|required|pattern|min|max|step|action|method|enctype|target|rel|integrity|crossorigin|referrerpolicy|fetchpriority|decoding)$/i;

function sanitizeHtmlForEpub(html) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  const doc = dom.window.document;
  const body = doc.body;

  unwrapElements(body, UNWRAP_TAGS);
  removeElements(body, REMOVE_TAGS);
  stripAttributes(body, STRIP_ATTRS);
  stripAllIds(body);
  replacePictureWithImg(body);
  removeOrphanLi(body);
  removeEmptyLists(body);

  return body.innerHTML;
}

function unwrapElements(root, tagSet) {
  for (const tag of tagSet) {
    const els = root.querySelectorAll(tag);
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      while (el.firstChild) {
        el.parentNode.insertBefore(el.firstChild, el);
      }
      el.parentNode.removeChild(el);
    }
  }
}

function removeElements(root, tagSet) {
  for (const tag of tagSet) {
    const els = root.querySelectorAll(tag);
    els.forEach(el => el.parentNode.removeChild(el));
  }
}

function stripAttributes(root, pattern) {
  const all = root.querySelectorAll("*");
  all.forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      if (pattern.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  });
}

function stripAllIds(root) {
  const all = root.querySelectorAll("[id]");
  all.forEach(el => el.removeAttribute("id"));
}

function replacePictureWithImg(root) {
  const pictures = root.querySelectorAll("picture");
  pictures.forEach(pic => {
    const img = pic.querySelector("img");
    if (img) {
      pic.parentNode.insertBefore(img, pic);
    }
    pic.parentNode.removeChild(pic);
  });
}

function removeOrphanLi(root) {
  const lis = root.querySelectorAll("li");
  lis.forEach(li => {
    const parent = li.parentNode;
    if (!parent || (parent.nodeName !== "UL" && parent.nodeName !== "OL")) {
      li.parentNode.removeChild(li);
    }
  });
}

function removeEmptyLists(root) {
  const lists = root.querySelectorAll("ul, ol");
  lists.forEach(list => {
    if (!list.querySelector("li")) {
      list.parentNode.removeChild(list);
    }
  });
}

module.exports = { sanitizeHtmlForEpub };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_sanitize_epub.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/sanitize-epub.js tests/test_sanitize_epub.js
git commit -m "feat: extract EPUB HTML sanitization to shared lib"
```

---

### Task 3: Database Client

**Files:**
- Create: `lib/db.js`
- Test: `tests/test_db.js`

- [ ] **Step 1: Write the test**

Create `tests/test_db.js`:

```js
const { createClient } = require("@libsql/client");

// Use in-memory SQLite for tests (no Turso connection needed)
const db = createClient({ url: ":memory:" });

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  // Set up schema
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key TEXT UNIQUE NOT NULL,
    kindle_email TEXT NOT NULL,
    forwarding_address TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    year_month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    source_type TEXT NOT NULL,
    UNIQUE(user_id, year_month, source_type)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS send_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    url TEXT,
    source_type TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  )`);

  const { getDb } = require("../lib/db");

  // Override getDb to return our test client
  // (We test db.js functions by passing db directly for now)

  const { createUser, getUserByApiKey, getUserByForwardingAddress,
          incrementUsage, getUsage, addHistory, getHistory } = require("../lib/db");

  test("createUser returns user with id, api_key, forwarding_address", async () => {
    const user = await createUser(db, "kindle@example.com");
    if (!user.id) throw new Error("no id");
    if (!user.api_key.startsWith("w2k_")) throw new Error("bad api_key format: " + user.api_key);
    if (!user.forwarding_address.includes("@")) throw new Error("bad forwarding address: " + user.forwarding_address);
    if (user.kindle_email !== "kindle@example.com") throw new Error("kindle_email mismatch");
  });

  test("getUserByApiKey finds user", async () => {
    const u = await createUser(db, "test2@example.com");
    const found = await getUserByApiKey(db, u.api_key);
    if (!found) throw new Error("user not found by api_key");
    if (found.kindle_email !== "test2@example.com") throw new Error("wrong user");
  });

  test("getUserByApiKey returns null for bad key", async () => {
    const found = await getUserByApiKey(db, "w2k_nonexistent");
    if (found) throw new Error("should return null");
  });

  test("getUserByForwardingAddress finds user", async () => {
    const u = await createUser(db, "test3@example.com");
    const found = await getUserByForwardingAddress(db, u.forwarding_address);
    if (!found) throw new Error("user not found");
  });

  test("incrementUsage creates and increments", async () => {
    const u = await createUser(db, "test4@example.com");
    await incrementUsage(db, u.id, "newsletter");
    await incrementUsage(db, u.id, "newsletter");
    const usage = await getUsage(db, u.id, "2026-06");
    if (usage.newsletter !== 2) throw new Error("expected 2, got " + usage.newsletter);
  });

  test("addHistory and getHistory work", async () => {
    const u = await createUser(db, "test5@example.com");
    await addHistory(db, u.id, "Test Article", "https://example.com", "newsletter");
    const entries = await getHistory(db, u.id, 10);
    if (entries.length !== 1) throw new Error("expected 1 entry, got " + entries.length);
    if (entries[0].title !== "Test Article") throw new Error("title mismatch");
    if (entries[0].source_type !== "newsletter") throw new Error("source_type mismatch");
  });

  test("getHistory respects limit", async () => {
    const u = await createUser(db, "test6@example.com");
    for (let i = 0; i < 5; i++) {
      await addHistory(db, u.id, "Article " + i, "https://example.com/" + i, "newsletter");
    }
    const entries = await getHistory(db, u.id, 3);
    if (entries.length !== 3) throw new Error("expected 3, got " + entries.length);
    // Most recent first
    if (entries[0].title !== "Article 4") throw new Error("wrong order, got " + entries[0].title);
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_db.js
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the database module**

Create `lib/db.js`:

```js
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

let _client = null;

function getDb() {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url || !token) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
    }
    _client = createClient({ url, authToken: token });
  }
  return _client;
}

async function ensureSchema(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key TEXT UNIQUE NOT NULL,
    kindle_email TEXT NOT NULL,
    forwarding_address TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    year_month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    source_type TEXT NOT NULL,
    UNIQUE(user_id, year_month, source_type)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS send_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    url TEXT,
    source_type TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  )`);
}

function generateApiKey() {
  const bytes = crypto.randomBytes(12).toString("hex");
  return "w2k_" + bytes;
}

function generateForwardingAddress() {
  const slug = crypto.randomBytes(4).toString("hex");
  const domain = process.env.INBOUND_DOMAIN || "inbound.web2kindle.com";
  return "wk-" + slug + "@" + domain;
}

function generateUserId() {
  return crypto.randomUUID();
}

async function createUser(db, kindleEmail) {
  const id = generateUserId();
  const apiKey = generateApiKey();
  const forwardingAddress = generateForwardingAddress();
  await db.execute({
    sql: "INSERT INTO users (id, api_key, kindle_email, forwarding_address) VALUES (?, ?, ?, ?)",
    args: [id, apiKey, kindleEmail, forwardingAddress]
  });
  return { id, api_key: apiKey, forwarding_address: forwardingAddress, kindle_email: kindleEmail };
}

async function getUserByApiKey(db, apiKey) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE api_key = ?",
    args: [apiKey]
  });
  return result.rows[0] || null;
}

async function getUserByForwardingAddress(db, address) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE forwarding_address = ?",
    args: [address]
  });
  return result.rows[0] || null;
}

async function getUserById(db, userId) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [userId]
  });
  return result.rows[0] || null;
}

async function incrementUsage(db, userId, sourceType) {
  const now = new Date();
  const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  await db.execute({
    sql: `INSERT INTO usage (user_id, year_month, count, source_type)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(user_id, year_month, source_type)
          DO UPDATE SET count = count + 1`,
    args: [userId, yearMonth, sourceType]
  });
}

async function getUsage(db, userId, yearMonth) {
  const result = await db.execute({
    sql: "SELECT source_type, count FROM usage WHERE user_id = ? AND year_month = ?",
    args: [userId, yearMonth]
  });
  const usage = {};
  for (const row of result.rows) {
    usage[row.source_type] = row.count;
  }
  return usage;
}

async function addHistory(db, userId, title, url, sourceType) {
  await db.execute({
    sql: "INSERT INTO send_history (user_id, title, url, source_type) VALUES (?, ?, ?, ?)",
    args: [userId, title || null, url || null, sourceType]
  });
}

async function getHistory(db, userId, limit) {
  const result = await db.execute({
    sql: "SELECT * FROM send_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?",
    args: [userId, limit || 50]
  });
  return result.rows;
}

async function deleteHistoryEntry(db, userId, entryId) {
  await db.execute({
    sql: "DELETE FROM send_history WHERE id = ? AND user_id = ?",
    args: [entryId, userId]
  });
}

async function updateKindleEmail(db, userId, kindleEmail) {
  await db.execute({
    sql: "UPDATE users SET kindle_email = ? WHERE id = ?",
    args: [kindleEmail, userId]
  });
}

module.exports = {
  getDb, ensureSchema,
  createUser, getUserByApiKey, getUserByForwardingAddress, getUserById,
  incrementUsage, getUsage,
  addHistory, getHistory, deleteHistoryEntry,
  updateKindleEmail
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_db.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/db.js tests/test_db.js
git commit -m "feat: add database client for user/usage/history"
```

---

### Task 4: SMTP Sender

**Files:**
- Create: `lib/smtp-sender.js`
- Test: `tests/test_smtp_sender.js`

- [ ] **Step 1: Write the test**

Create `tests/test_smtp_sender.js`:

```js
const nodemailer = require("nodemailer");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

// Test without connecting to real SMTP — verify message structure

test("builds MIME message with EPUB attachment", async () => {
  const { buildKindleMessage } = require("../lib/smtp-sender");

  const epubBuffer = Buffer.from("EPUB_CONTENT_PLACEHOLDER");
  const message = buildKindleMessage({
    from: "noreply@web2kindle.com",
    to: "user123@kindle.com",
    epubBuffer,
    filename: "article.epub"
  });

  // Verify MIME structure
  if (!message.includes("From: noreply@web2kindle.com")) throw new Error("missing From");
  if (!message.includes("To: user123@kindle.com")) throw new Error("missing To");
  if (!message.includes('Subject: =?UTF-8?B?Y29udmVydA==')) throw new Error("missing Subject: convert");
  if (!message.includes("MIME-Version: 1.0")) throw new Error("missing MIME-Version");
  if (!message.includes('Content-Type: multipart/mixed')) throw new Error("missing multipart/mixed");
  if (!message.includes('name="article.epub"')) throw new Error("missing attachment name");
  if (!message.includes("Content-Transfer-Encoding: base64")) throw new Error("missing base64 encoding");
  if (!message.includes("application/epub+zip")) throw new Error("missing epub mime type");
});

test("message is valid RFC 2822 format", async () => {
  const { buildKindleMessage } = require("../lib/smtp-sender");

  const message = buildKindleMessage({
    from: "noreply@web2kindle.com",
    to: "user@kindle.com",
    epubBuffer: Buffer.from("test"),
    filename: "test.epub"
  });

  // Headers must end with \r\n\r\n before body
  if (!message.includes("\r\n\r\n")) throw new Error("missing header/body separator");
  // No bare \n without \r
  const bareLF = message.replace(/\r\n/g, "").includes("\n");
  if (bareLF) throw new Error("contains bare LF without CR");
});

test("epub buffer is base64 encoded in message", async () => {
  const { buildKindleMessage } = require("../lib/smtp-sender");

  const epubContent = "Hello, Kindle!";
  const epubBuffer = Buffer.from(epubContent);
  const message = buildKindleMessage({
    from: "noreply@test.com",
    to: "test@kindle.com",
    epubBuffer,
    filename: "hello.epub"
  });

  const expectedB64 = epubBuffer.toString("base64");
  if (!message.includes(expectedB64)) throw new Error("base64 content not found in message");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_smtp_sender.js
```

Expected: FAIL

- [ ] **Step 3: Write the SMTP sender module**

Create `lib/smtp-sender.js`:

```js
const nodemailer = require("nodemailer");

function buildKindleMessage({ from, to, epubBuffer, filename }) {
  const boundary = "----KindleBoundary_" + Math.random().toString(36).substring(2);
  const encodedSubject = Buffer.from("convert", "utf-8").toString("base64");

  const lines = [];
  lines.push("From: " + from + "\r\n");
  lines.push("To: " + to + "\r\n");
  lines.push("Subject: =?UTF-8?B?" + encodedSubject + "?=\r\n");
  lines.push("MIME-Version: 1.0\r\n");
  lines.push("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n");
  lines.push("\r\n");
  lines.push("--" + boundary + "\r\n");
  lines.push("Content-Type: application/epub+zip; name=\"" + filename + "\"\r\n");
  lines.push("Content-Transfer-Encoding: base64\r\n");
  lines.push("Content-Disposition: attachment; filename=\"" + filename + "\"\r\n");
  lines.push("\r\n");

  // Base64 encode in 76-char chunks
  const encoded = epubBuffer.toString("base64");
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.substring(i, i + 76) + "\r\n");
  }

  lines.push("\r\n");
  lines.push("--" + boundary + "--\r\n");

  return lines.join("");
}

async function sendEpubToKindle(epubBuffer, kindleEmail, filename) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@web2kindle.com";

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration missing (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  const message = buildKindleMessage({
    from,
    to: kindleEmail,
    epubBuffer,
    filename: filename || "article.epub"
  });

  await transporter.sendMail({
    envelope: { from, to: kindleEmail },
    raw: message
  });
}

module.exports = { buildKindleMessage, sendEpubToKindle };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_smtp_sender.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/smtp-sender.js tests/test_smtp_sender.js
git commit -m "feat: add SMTP sender for Kindle delivery"
```

---

### Task 5: Email Parser

**Files:**
- Create: `lib/email-parser.js`
- Test: `tests/test_email_parser.js`

- [ ] **Step 1: Write the test**

Create `tests/test_email_parser.js`:

```js
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

const { parseSendGridWebhook } = require("../lib/email-parser");

test("extracts from, to, subject from SendGrid payload", () => {
  const payload = {
    from: "sender@newsletter.com",
    to: "wk-abc123@inbound.web2kindle.com",
    subject: "Weekly Digest #42",
    html: "<html><body><p>Hello world</p></body></html>"
  };
  const result = parseSendGridWebhook(payload);
  if (result.from !== "sender@newsletter.com") throw new Error("from mismatch");
  if (result.to !== "wk-abc123@inbound.web2kindle.com") throw new Error("to mismatch");
  if (result.subject !== "Weekly Digest #42") throw new Error("subject mismatch");
  if (result.html !== "<html><body><p>Hello world</p></body></html>") throw new Error("html mismatch");
});

test("extracts forwarding address from 'to' field", () => {
  const payload = {
    from: "x@x.com",
    to: "wk-xyz789@inbound.web2kindle.com",
    subject: "Test",
    html: "<p>Hi</p>"
  };
  const result = parseSendGridWebhook(payload);
  if (result.forwardingAddress !== "wk-xyz789@inbound.web2kindle.com") {
    throw new Error("forwardingAddress mismatch: " + result.forwardingAddress);
  }
});

test("strips forwarded message header lines from plain text fallback", () => {
  const payload = {
    from: "x@x.com",
    to: "wk-test@inbound.web2kindle.com",
    subject: "Fwd: Newsletter",
    text: "---------- Forwarded message ---------\nFrom: Original Sender\n\nActual content here."
  };
  const result = parseSendGridWebhook(payload);
  if (result.text.includes("Forwarded message")) throw new Error("forward header not stripped");
  if (!result.text.includes("Actual content")) throw new Error("content lost after stripping");
});

test("prefers HTML body over text", () => {
  const payload = {
    from: "x@x.com",
    to: "wk-test@inbound.test",
    subject: "Test",
    html: "<p>HTML version</p>",
    text: "Plain text version"
  };
  const result = parseSendGridWebhook(payload);
  if (result.body !== "<p>HTML version</p>") throw new Error("should prefer HTML");
  if (result.bodyType !== "html") throw new Error("bodyType should be html");
});

test("falls back to text when no HTML", () => {
  const payload = {
    from: "x@x.com",
    to: "wk-test@inbound.test",
    subject: "Plain",
    text: "Just plain text"
  };
  const result = parseSendGridWebhook(payload);
  if (result.body !== "Just plain text") throw new Error("should use text fallback");
  if (result.bodyType !== "text") throw new Error("bodyType should be text");
});

test("extracts sender name from from field", () => {
  const payload = {
    from: "Jane's Newsletter <jane@news.com>",
    to: "wk-test@inbound.test",
    subject: "Hi",
    html: "<p>Content</p>"
  };
  const result = parseSendGridWebhook(payload);
  if (result.senderName !== "Jane's Newsletter") throw new Error("senderName mismatch: " + result.senderName);
  if (result.senderEmail !== "jane@news.com") throw new Error("senderEmail mismatch: " + result.senderEmail);
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_email_parser.js
```

Expected: FAIL

- [ ] **Step 3: Write the email parser**

Create `lib/email-parser.js`:

```js
function parseSendGridWebhook(payload) {
  const from = payload.from || "";
  const to = payload.to || "";
  const subject = payload.subject || "";
  const html = payload.html || "";
  const text = payload.text || "";

  // Extract forwarding address from 'to' (it's the unique user address)
  const forwardingAddress = to.trim();

  // Parse sender name/email
  const senderMatch = from.match(/^"?([^"<]*)"?\s*(?:<([^>]+)>)?$/);
  let senderName = "";
  let senderEmail = from;
  if (senderMatch) {
    senderName = (senderMatch[1] || "").trim();
    if (senderMatch[2]) {
      senderEmail = senderMatch[2].trim();
    }
  }

  // Body: prefer HTML, fall back to text
  let body = html || text;
  let bodyType = html ? "html" : "text";

  // Strip forwarded message headers from text body
  if (bodyType === "text" && body) {
    body = stripForwardHeaders(body);
  }

  return {
    from,
    to,
    forwardingAddress,
    subject,
    senderName,
    senderEmail,
    html,
    text,
    body,
    bodyType
  };
}

function stripForwardHeaders(text) {
  // Remove common forwarded message delimiters
  return text
    .replace(/^[-=_]+\s*Forwarded message\s*[-=_]+\s*\n.*?(?=\n\n|\n(?![>\s]))/s, "")
    .replace(/^[-=_]+\s*Forwarded message\s*[-=_]+\s*\n.*$/gm, "")
    .replace(/^>+\s*Forwarded message.*$/gm, "")
    .replace(/^Begin forwarded message:.*$/gm, "")
    .trim();
}

module.exports = { parseSendGridWebhook, stripForwardHeaders };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_email_parser.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/email-parser.js tests/test_email_parser.js
git commit -m "feat: add SendGrid webhook email parser"
```

---

### Task 6: HTML Extractor for Newsletters

**Files:**
- Create: `lib/html-extractor.js`
- Test: `tests/test_html_extractor.js`

- [ ] **Step 1: Write the test**

Create `tests/test_html_extractor.js`:

```js
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

const { extractNewsletterContent } = require("../lib/html-extractor");

test("extracts basic HTML content", () => {
  const html = "<html><body><h1>Newsletter Title</h1><p>Hello world</p><p>More text</p></body></html>";
  const result = extractNewsletterContent(html);
  if (!result.content.includes("<h1>Newsletter Title</h1>")) throw new Error("h1 lost");
  if (!result.content.includes("<p>Hello world</p>")) throw new Error("paragraph lost");
});

test("strips style tags", () => {
  const html = "<html><head><style>body{color:red}</style></head><body><p>Hi</p></body></html>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("<style")) throw new Error("style not stripped");
});

test("strips inline styles", () => {
  const html = "<p style='color:red;font-size:20px'>Styled text</p>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("style=")) throw new Error("inline style not stripped");
});

test("strips tracking pixels (1x1 images)", () => {
  const html = "<body><p>Content</p><img src='https://track.newsletter.com/open.gif' width='1' height='1'></body>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("track.newsletter.com")) throw new Error("tracking pixel not removed");
});

test("strips unsubscribe links", () => {
  const html = "<body><p>Content</p><a href='https://news.com/unsub'>Unsubscribe</a></body>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("unsub")) throw new Error("unsubscribe link not stripped");
});

test("strips 'view in browser' links", () => {
  const html = "<body><p><a href='https://news.com/view'>View this email in your browser</a></p><p>Real content</p></body>";
  const result = extractNewsletterContent(html);
  if (result.content.toLowerCase().includes("view")) throw new Error("view-in-browser link not stripped");
  if (!result.content.includes("Real content")) throw new Error("real content lost");
});

test("preserves article content after stripping", () => {
  const html = `
    <html><body>
      <p style="color:#333">View this email in your browser</p>
      <hr>
      <h1>Issue #42: Important News</h1>
      <p>First paragraph of real content.</p>
      <p>Second paragraph with a <a href="https://example.com/article">link</a>.</p>
      <blockquote>A relevant quote</blockquote>
      <hr>
      <p style="font-size:10px">Unsubscribe | Manage preferences</p>
      <img src="https://track.news.com/pixel.gif" width="1" height="1">
    </body></html>`;

  const result = extractNewsletterContent(html);
  if (!result.content.includes("Important News")) throw new Error("title lost");
  if (!result.content.includes("First paragraph")) throw new Error("content lost");
  if (!result.content.includes("<a href=")) throw new Error("links lost");
  if (!result.content.includes("<blockquote>")) throw new Error("blockquote lost");
});

test("returns title extracted from h1", () => {
  const html = "<body><h1>My Newsletter</h1><p>Content</p></body>";
  const result = extractNewsletterContent(html);
  if (!result.title) throw new Error("no title");
  if (result.title !== "My Newsletter") throw new Error("title mismatch: " + result.title);
});

test("returns author from sender info", () => {
  const html = "<body><p>Content</p></body>";
  const senderName = "Tech Weekly Digest";
  const result = extractNewsletterContent(html, { senderName });
  if (result.author !== "Tech Weekly Digest") throw new Error("author mismatch");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_html_extractor.js
```

Expected: FAIL

- [ ] **Step 3: Write the HTML extractor**

Create `lib/html-extractor.js`:

```js
const { JSDOM } = require("jsdom");

function extractNewsletterContent(html, opts = {}) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const body = doc.body;

  if (!body) {
    return { title: opts.subject || "", author: opts.senderName || "", content: "" };
  }

  // Remove tracking pixels
  const imgs = body.querySelectorAll("img");
  imgs.forEach(img => {
    const w = parseInt(img.getAttribute("width") || "0");
    const h = parseInt(img.getAttribute("height") || "0");
    const src = (img.getAttribute("src") || "").toLowerCase();
    if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel") || src.includes("open.gif")) {
      img.parentNode.removeChild(img);
    }
  });

  // Remove "View in browser" link
  removeMatchingLinks(body, /view.*(browser|online|web)/i);

  // Remove unsubscribe / manage preferences links
  removeMatchingLinks(body, /unsubscribe|manage.*pref/i);

  // Remove footer text blocks (small, gray text typically at bottom)
  removeFooterBlocks(body);

  // Strip all style attributes
  const allEls = body.querySelectorAll("*");
  allEls.forEach(el => el.removeAttribute("style"));

  // Strip style/script tags
  body.querySelectorAll("style, script, noscript").forEach(el => el.parentNode.removeChild(el));

  // Extract title
  const h1 = body.querySelector("h1");
  const title = h1 ? h1.textContent.trim() : (opts.subject || "");

  // Extract content: body inner HTML
  const content = body.innerHTML.trim();

  return {
    title,
    author: opts.senderName || "",
    content
  };
}

function removeMatchingLinks(root, pattern) {
  const links = root.querySelectorAll("a");
  links.forEach(a => {
    const text = (a.textContent || "").toLowerCase();
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (pattern.test(text) || pattern.test(href)) {
      a.parentNode.removeChild(a);
    }
  });
}

function removeFooterBlocks(root) {
  // Remove paragraphs that look like footers (small amount of text with unsubscribe/preferences)
  const footers = root.querySelectorAll("p, div, td");
  footers.forEach(el => {
    const text = el.textContent.trim().toLowerCase();
    const hasFooterKeywords = text.includes("unsubscribe") ||
      text.includes("manage") && text.includes("pref") ||
      text.includes("update your") && text.includes("pref") ||
      text.includes("privacy policy") && text.length < 200;

    // Only remove if it's short and has footer keywords
    if (hasFooterKeywords && text.length < 300) {
      el.parentNode.removeChild(el);
    }
  });
}

module.exports = { extractNewsletterContent };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_html_extractor.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/html-extractor.js tests/test_html_extractor.js
git commit -m "feat: add newsletter HTML content extractor"
```

---

### Task 7: Server-Side EPUB Generator

**Files:**
- Create: `lib/epub-generator-node.js`
- Test: `tests/test_epub_generator_node.js`

Adapt the extension's EPUB generation to run in Node.js. The approach: load `epub-generator.js` in a jsdom context (same pattern as the existing `test_generateEpub.js`), providing Node.js-compatible versions of browser APIs.

- [ ] **Step 1: Write the test**

Create `tests/test_epub_generator_node.js`:

```js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  const { generateEpubNode } = require("../lib/epub-generator-node");

  test("generates valid EPUB blob", async () => {
    const result = await generateEpubNode({
      title: "Test Newsletter",
      author: "Test Author",
      content: "<h1>Hello</h1><p>World</p>",
      url: "https://example.com/newsletter/42"
    });

    if (!result) throw new Error("no result");
    if (!result.blob || result.blob.size < 100) throw new Error("blob too small: " + (result.blob ? result.blob.size : 0));
  });

  test("EPUB has valid ZIP structure", async () => {
    const { generateEpubNode } = require("../lib/epub-generator-node");

    const result = await generateEpubNode({
      title: "Structure Test",
      content: "<p>Test content</p>"
    });

    const buf = Buffer.from(await result.blob.arrayBuffer());

    // ZIP signature
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not a valid ZIP");
  });

  test("EPUB contains required files", async () => {
    const { generateEpubNode } = require("../lib/epub-generator-node");

    const result = await generateEpubNode({
      title: "Files Test",
      content: "<p>Testing required files</p>"
    });

    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    const required = ["mimetype", "META-INF/container.xml", "OEBPS/content.opf",
      "OEBPS/toc.ncx", "OEBPS/content.xhtml"];
    for (const f of required) {
      if (!zip.files[f]) throw new Error("missing: " + f);
    }
  });

  test("mimetype is stored uncompressed", async () => {
    const { generateEpubNode } = require("../lib/epub-generator-node");

    const result = await generateEpubNode({
      title: "Mimetype Test",
      content: "<p>Test</p>"
    });

    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const mt = zip.files["mimetype"];
    if (mt.options.compression !== null && mt.options.compression !== "STORE") {
      throw new Error("mimetype should be stored, not compressed");
    }
  });

  test("content.xhtml has proper XHTML 1.1 structure", async () => {
    const { generateEpubNode } = require("../lib/epub-generator-node");

    const result = await generateEpubNode({
      title: "XHTML Test",
      content: "<p>XHTML output test</p>"
    });

    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const xhtml = await zip.files["OEBPS/content.xhtml"].async("string");

    if (!xhtml.includes('<?xml version="1.0"')) throw new Error("missing XML declaration");
    if (!xhtml.includes('xmlns="http://www.w3.org/1999/xhtml"')) throw new Error("missing XHTML namespace");
    if (!xhtml.includes('<!DOCTYPE html')) throw new Error("missing DOCTYPE");
  });

  test("handles empty content gracefully", async () => {
    const { generateEpubNode } = require("../lib/epub-generator-node");

    const result = await generateEpubNode({
      title: "Empty",
      content: ""
    });

    if (!result) throw new Error("no result for empty content");
    if (result.blob.size < 50) throw new Error("blob too small for empty content");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_epub_generator_node.js
```

Expected: FAIL

- [ ] **Step 3: Write the Node.js EPUB generator**

Create `lib/epub-generator-node.js`:

```js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

let _loaded = false;

function loadExtensionSources() {
  if (_loaded) return;
  _loaded = true;

  const readabilityPath = path.join(ROOT, "extension", "lib", "readability.js");
  const epubGenPath = path.join(ROOT, "extension", "epub-generator.js");

  // Set up jsdom globals for the extension code
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.Set = Set;
  globalThis.JSZip = require("jszip");

  // Provide a Blob polyfill
  if (!globalThis.Blob) {
    globalThis.Blob = class Blob {
      constructor(parts, opts) {
        this._parts = parts || [];
        this.type = (opts && opts.type) || "";
      }
      get size() {
        return Buffer.concat(this._parts.map(p => {
          if (typeof p === "string") return Buffer.from(p, "utf-8");
          if (Buffer.isBuffer(p)) return p;
          if (p instanceof Uint8Array) return Buffer.from(p);
          return Buffer.from(String(p));
        })).length;
      }
      async arrayBuffer() {
        const buf = Buffer.concat(this._parts.map(p => {
          if (typeof p === "string") return Buffer.from(p, "utf-8");
          if (Buffer.isBuffer(p)) return p;
          if (p instanceof Uint8Array) return Buffer.from(p);
          return Buffer.from(String(p));
        }));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    };
  }

  eval(fs.readFileSync(readabilityPath, "utf8"));
  eval(fs.readFileSync(epubGenPath, "utf8"));
}

const { sanitizeHtmlForEpub } = require("./sanitize-epub");

async function generateEpubNode(opts) {
  loadExtensionSources();

  const { title, author, content, url } = opts;
  const sanitizedContent = sanitizeHtmlForEpub(content || "");

  const article = {
    title: title || "Untitled",
    author: author || "",
    content: sanitizedContent
  };

  const blob = await generateEpub({
    article,
    originalHtml: content || "",
    url: url || "",
    title: title || "Untitled",
    keepLinks: true,
    keepImages: false  // No image processing for newsletters
  });

  return { blob, article };
}

module.exports = { generateEpubNode };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/test_epub_generator_node.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add lib/epub-generator-node.js tests/test_epub_generator_node.js
git commit -m "feat: add server-side EPUB generator (Node.js)"
```

---

### Task 8: Auth Middleware

**Files:**
- Create: `api/auth.js`

- [ ] **Step 1: Write the auth middleware**

Create `api/auth.js`:

```js
import { createClient } from "@libsql/client";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

export async function authenticate(req) {
  const apiKey = req.headers["x-api-key"] || req.body?.api_key;

  if (!apiKey || typeof apiKey !== "string") {
    return { error: "Missing API key", status: 401 };
  }

  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE api_key = ?",
    args: [apiKey.trim()]
  });

  if (result.rows.length === 0) {
    return { error: "Invalid API key", status: 401 };
  }

  return { user: result.rows[0] };
}
```

No test file needed — tested implicitly via API tests.

- [ ] **Step 2: Commit**

```bash
git add api/auth.js
git commit -m "feat: add API key auth middleware"
```

---

### Task 9: Registration API

**Files:**
- Create: `api/register.js`
- Test: `tests/test_api_register.js`

- [ ] **Step 1: Write the test**

Create `tests/test_api_register.js`:

```js
const { createClient } = require("@libsql/client");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  const db = createClient({ url: ":memory:" });
  const { ensureSchema, createUser, getUserByApiKey } = require("../lib/db");
  await ensureSchema(db);

  test("creates user and returns api_key + forwarding_address", async () => {
    const user = await createUser(db, "kindle@example.com");
    if (!user.api_key) throw new Error("no api_key returned");
    if (!user.forwarding_address) throw new Error("no forwarding_address");
    if (user.kindle_email !== "kindle@example.com") throw new Error("kindle_email mismatch");
  });

  test("api_key starts with w2k_", async () => {
    const user = await createUser(db, "test2@example.com");
    if (!user.api_key.startsWith("w2k_")) throw new Error("api_key format wrong: " + user.api_key);
  });

  test("forwarding_address follows wk-xxxx@domain pattern", async () => {
    const user = await createUser(db, "test3@example.com");
    const pattern = /^wk-[a-f0-9]+@/;
    if (!pattern.test(user.forwarding_address)) {
      throw new Error("forwarding_address format wrong: " + user.forwarding_address);
    }
  });

  test("each user gets unique api_key", async () => {
    const u1 = await createUser(db, "u1@example.com");
    const u2 = await createUser(db, "u2@example.com");
    if (u1.api_key === u2.api_key) throw new Error("api_keys not unique");
  });

  test("each user gets unique forwarding_address", async () => {
    const u1 = await createUser(db, "u1b@example.com");
    const u2 = await createUser(db, "u2b@example.com");
    if (u1.forwarding_address === u2.forwarding_address) throw new Error("forwarding_addresses not unique");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run test and commit** (test uses db.js which is already tested)

```bash
node tests/test_api_register.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 3: Write the Vercel serverless function**

Create `api/register.js`:

```js
import { createClient } from "@libsql/client";
import crypto from "crypto";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

async function createUser(db, kindleEmail) {
  const id = crypto.randomUUID();
  const apiKey = "w2k_" + crypto.randomBytes(12).toString("hex");
  const slug = crypto.randomBytes(4).toString("hex");
  const domain = process.env.INBOUND_DOMAIN || "inbound.web2kindle.com";
  const forwardingAddress = "wk-" + slug + "@" + domain;

  await db.execute({
    sql: "INSERT INTO users (id, api_key, kindle_email, forwarding_address) VALUES (?, ?, ?, ?)",
    args: [id, apiKey, kindleEmail, forwardingAddress]
  });

  return { id, api_key: apiKey, forwarding_address: forwardingAddress, kindle_email: kindleEmail };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { kindle_email } = req.body || {};

  if (!kindle_email || typeof kindle_email !== "string" || !kindle_email.includes("@")) {
    return res.status(400).json({ error: "Valid kindle_email is required" });
  }

  try {
    const db = getDb();

    // Ensure tables exist
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      api_key TEXT UNIQUE NOT NULL,
      kindle_email TEXT NOT NULL,
      forwarding_address TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    const user = await createUser(db, kindle_email.trim().toLowerCase());

    return res.status(201).json({
      api_key: user.api_key,
      forwarding_address: user.forwarding_address,
      kindle_email: user.kindle_email
    });
  } catch (e) {
    return res.status(500).json({ error: "Registration failed: " + e.message });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add api/register.js tests/test_api_register.js
git commit -m "feat: add user registration API"
```

---

### Task 10: Inbound Email API

**Files:**
- Create: `api/inbound-email.js`
- Test: `tests/test_api_inbound.js`

- [ ] **Step 1: Write the test**

Create `tests/test_api_inbound.js`:

```js
const { createClient } = require("@libsql/client");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  const { ensureSchema, createUser, getUserByForwardingAddress, incrementUsage, getUsage } = require("../lib/db");
  const { generateEpubNode } = require("../lib/epub-generator-node");
  const { extractNewsletterContent } = require("../lib/html-extractor");
  const { parseSendGridWebhook } = require("../lib/email-parser");
  const { sanitizeHtmlForEpub } = require("../lib/sanitize-epub");

  const db = createClient({ url: ":memory:" });
  await ensureSchema(db);

  const user = await createUser(db, "kindle@example.com");

  // Simulate inbound email flow end-to-end (minus actual SMTP send)
  test("full inbound email pipeline processes newsletter", async () => {
    const payload = {
      from: "Jane's Digest <jane@news.com>",
      to: user.forwarding_address,
      subject: "Weekly Digest #5",
      html: "<html><body><h1>Weekly Digest</h1><p>Hello readers</p><p>Main content here.</p></body></html>",
      text: "Weekly Digest\n\nHello readers\nMain content here."
    };

    // 1. Parse webhook
    const parsed = parseSendGridWebhook(payload);
    if (parsed.forwardingAddress !== user.forwarding_address) {
      throw new Error("forwarding address mismatch");
    }

    // 2. Look up user
    const foundUser = await getUserByForwardingAddress(db, parsed.forwardingAddress);
    if (!foundUser) throw new Error("user not found");
    if (foundUser.kindle_email !== "kindle@example.com") throw new Error("kindle email mismatch");

    // 3. Extract content
    const extracted = extractNewsletterContent(parsed.body, {
      subject: parsed.subject,
      senderName: parsed.senderName
    });
    if (!extracted.content) throw new Error("no content extracted");
    if (extracted.content.includes("<style")) throw new Error("style tags not stripped");

    // 4. Sanitize
    const sanitized = sanitizeHtmlForEpub(extracted.content);
    if (sanitized.includes("<script")) throw new Error("script not stripped");

    // 5. Generate EPUB
    const result = await generateEpubNode({
      title: extracted.title || parsed.subject,
      author: extracted.author,
      content: sanitized,
      url: ""
    });
    if (!result.blob || result.blob.size < 100) throw new Error("EPUB generation failed");

    // 6. Track usage
    await incrementUsage(db, foundUser.id, "newsletter");
    const usage = await getUsage(db, foundUser.id, "2026-06");
    if (usage.newsletter < 1) throw new Error("usage not incremented");
  });

  test("handles missing HTML body with text fallback", async () => {
    const payload = {
      from: "alerts@news.com",
      to: user.forwarding_address,
      subject: "Plain Text Alert",
      text: "This is a plain text newsletter.\n\nWith multiple paragraphs."
    };

    const parsed = parseSendGridWebhook(payload);
    if (parsed.bodyType !== "text") throw new Error("should be text type");
    if (!parsed.body.includes("plain text")) throw new Error("text body lost");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/test_api_inbound.js
```

Expected: FAIL if api/inbound-email.js not yet exportable for testing (the test tests the pipeline functions, not the serverless handler directly)

Actually the test above tests the pipeline functions (which we already have), not the API handler. Let me adjust. The test should verify the pipeline end-to-end using the lib functions.

```bash
node tests/test_api_inbound.js
```

Expected: ALL TESTS PASSED (uses existing lib functions)

- [ ] **Step 3: Write the Vercel serverless function**

Create `api/inbound-email.js`:

```js
import { createClient } from "@libsql/client";
import crypto from "crypto";
import { sanitizeHtmlForEpub } from "../lib/sanitize-epub.js";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

async function processInboundEmail(payload) {
  // 1. Parse webhook
  const parsed = parseInboundPayload(payload);

  // 2. Look up user by forwarding address
  const db = getDb();
  const userResult = await db.execute({
    sql: "SELECT * FROM users WHERE forwarding_address = ?",
    args: [parsed.to]
  });

  if (userResult.rows.length === 0) {
    return { error: "Unknown forwarding address", status: 404 };
  }

  const user = userResult.rows[0];

  // 3. Check usage limit
  const now = new Date();
  const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const usageResult = await db.execute({
    sql: "SELECT count FROM usage WHERE user_id = ? AND year_month = ? AND source_type = 'newsletter'",
    args: [user.id, yearMonth]
  });

  const currentUsage = usageResult.rows.length > 0 ? usageResult.rows[0].count : 0;
  const monthlyLimit = 20;

  if (currentUsage >= monthlyLimit) {
    return {
      error: "Monthly limit reached. Upgrade to Pro for unlimited newsletters.",
      status: 429,
      user
    };
  }

  // 4. Extract content from email HTML
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(parsed.html || parsed.text || "");
  const body = dom.window.document.body;

  let title = parsed.subject || "";
  let author = parsed.from || "";
  let content = "";

  if (body) {
    // Strip tracking pixels
    body.querySelectorAll("img").forEach(img => {
      const w = parseInt(img.getAttribute("width") || "0");
      const h = parseInt(img.getAttribute("height") || "0");
      const src = (img.getAttribute("src") || "").toLowerCase();
      if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel")) {
        img.parentNode.removeChild(img);
      }
    });

    // Strip style/script
    body.querySelectorAll("style, script").forEach(el => el.parentNode.removeChild(el));

    // Strip inline styles
    body.querySelectorAll("*").forEach(el => el.removeAttribute("style"));

    // Extract h1 for title
    const h1 = body.querySelector("h1");
    if (h1) title = h1.textContent.trim();

    content = body.innerHTML.trim();
  }

  // 5. Sanitize HTML for EPUB
  content = sanitizeHtmlForEpub(content);

  // 6. Generate EPUB
  const epubResult = await generateEpubInline({
    title,
    author,
    content,
    url: ""
  });

  // 7. Increment usage
  await db.execute({
    sql: `INSERT INTO usage (user_id, year_month, count, source_type)
          VALUES (?, ?, 1, 'newsletter')
          ON CONFLICT(user_id, year_month, source_type)
          DO UPDATE SET count = count + 1`,
    args: [user.id, yearMonth]
  });

  // 8. Log history
  await db.execute({
    sql: "INSERT INTO send_history (user_id, title, source_type) VALUES (?, ?, 'newsletter')",
    args: [user.id, title]
  });

  // 9. Send to Kindle
  await sendToKindleInline(epubResult.blob, user.kindle_email, title);

  return { success: true, title, user };
}

function parseInboundPayload(payload) {
  return {
    from: payload.from || "",
    to: (payload.to || "").trim(),
    subject: payload.subject || "",
    html: payload.html || "",
    text: payload.text || ""
  };
}

async function generateEpubInline(opts) {
  // Dynamic imports for the EPUB generator
  const fs = await import("fs");
  const path = await import("path");

  const ROOT = path.join(process.cwd());

  // Load extension sources in jsdom context
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.Set = Set;

  const JSZipModule = await import("jszip");
  globalThis.JSZip = JSZipModule.default || JSZipModule;

  // Blob polyfill (minimal)
  globalThis.Blob = class Blob {
    constructor(parts, opts) {
      this._parts = parts || [];
      this.type = (opts && opts.type) || "";
    }
    get size() { return Buffer.concat(this._parts.map(p => typeof p === "string" ? Buffer.from(p, "utf-8") : Buffer.isBuffer(p) ? p : Buffer.from(String(p)))).length; }
    async arrayBuffer() { return this._buff().buffer; }
    _buff() { return Buffer.concat(this._parts.map(p => typeof p === "string" ? Buffer.from(p, "utf-8") : Buffer.isBuffer(p) ? p : Buffer.from(String(p)))); }
  };

  const readabilityContent = fs.readFileSync(path.join(ROOT, "extension", "lib", "readability.js"), "utf8");
  const epubGenContent = fs.readFileSync(path.join(ROOT, "extension", "epub-generator.js"), "utf8");

  eval(readabilityContent);
  eval(epubGenContent);

  const blob = await generateEpub({
    article: { title: opts.title || "Untitled", author: opts.author || "", content: opts.content || "" },
    originalHtml: opts.content || "",
    url: opts.url || "",
    title: opts.title || "Untitled",
    keepLinks: true,
    keepImages: false
  });

  return { blob };
}

async function sendToKindleInline(blob, kindleEmail, title) {
  const nodemailer = await import("nodemailer");

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@web2kindle.com";

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration missing");
  }

  const epubBuffer = Buffer.from(await blob.arrayBuffer());
  const filename = (title || "article").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50) + ".epub";

  const boundary = "----KindleBoundary_" + Math.random().toString(36).substring(2);
  const encodedSubject = Buffer.from("convert", "utf-8").toString("base64");

  const lines = [];
  lines.push("From: " + from + "\r\n");
  lines.push("To: " + kindleEmail + "\r\n");
  lines.push("Subject: =?UTF-8?B?" + encodedSubject + "?=\r\n");
  lines.push("MIME-Version: 1.0\r\n");
  lines.push("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n");
  lines.push("\r\n");
  lines.push("--" + boundary + "\r\n");
  lines.push("Content-Type: application/epub+zip; name=\"" + filename + "\"\r\n");
  lines.push("Content-Transfer-Encoding: base64\r\n");
  lines.push("Content-Disposition: attachment; filename=\"" + filename + "\"\r\n");
  lines.push("\r\n");

  const encoded = epubBuffer.toString("base64");
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.substring(i, i + 76) + "\r\n");
  }

  lines.push("\r\n");
  lines.push("--" + boundary + "--\r\n");

  const rawMessage = lines.join("");

  const transporter = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    envelope: { from, to: kindleEmail },
    raw: rawMessage
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify SendGrid webhook auth (optional header)
  const webhookSecret = process.env.SENDGRID_INBOUND_SECRET;
  if (webhookSecret) {
    const auth = req.headers["x-webhook-token"];
    if (auth !== webhookSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const result = await processInboundEmail(req.body);

    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.status(200).json({ success: true, title: result.title });
  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add api/inbound-email.js tests/test_api_inbound.js
git commit -m "feat: add inbound email processing API"
```

---

### Task 11: History, Usage, and Settings APIs

**Files:**
- Create: `api/history.js`
- Create: `api/usage.js`

These are thin wrappers around the database functions. Settings are returned inline from the dashboard's auth check.

Create `api/history.js`:

```js
import { createClient } from "@libsql/client";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

async function getUserId(db, apiKey) {
  const result = await db.execute({
    sql: "SELECT id FROM users WHERE api_key = ?",
    args: [apiKey]
  });
  return result.rows.length > 0 ? result.rows[0].id : null;
}

export default async function handler(req, res) {
  const apiKey = req.headers["x-api-key"] || req.body?.api_key;

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const db = getDb();
  const userId = await getUserId(db, apiKey);

  if (!userId) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  if (req.method === "GET") {
    const limit = parseInt(req.query?.limit || "50");
    const result = await db.execute({
      sql: "SELECT * FROM send_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?",
      args: [userId, limit]
    });
    return res.status(200).json({ history: result.rows });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    await db.execute({
      sql: "DELETE FROM send_history WHERE id = ? AND user_id = ?",
      args: [id, userId]
    });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
```

Create `api/usage.js`:

```js
import { createClient } from "@libsql/client";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

async function getUserId(db, apiKey) {
  const result = await db.execute({
    sql: "SELECT id FROM users WHERE api_key = ?",
    args: [apiKey]
  });
  return result.rows.length > 0 ? result.rows[0].id : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"] || req.query?.api_key;

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const db = getDb();
  const userId = await getUserId(db, apiKey);

  if (!userId) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const now = new Date();
  const yearMonth = req.query?.year_month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

  const result = await db.execute({
    sql: "SELECT source_type, count FROM usage WHERE user_id = ? AND year_month = ?",
    args: [userId, yearMonth]
  });

  const usage = {};
  for (const row of result.rows) {
    usage[row.source_type] = row.count;
  }

  return res.status(200).json({
    usage,
    year_month: yearMonth,
    limits: {
      newsletter: 20
    }
  });
}
```

- [ ] **Step 1: Commit**

```bash
git add api/history.js api/usage.js
git commit -m "feat: add history and usage APIs"
```

---

### Task 12: Web Dashboard

**Files:**
- Create: `web/index.html`
- Create: `web/register.html`
- Create: `web/dashboard.html`

Simple static HTML pages that call the APIs via `fetch`. No build step needed — served directly by Vercel rewrites.

- [ ] **Step 1: Write the landing page**

Create `web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Web2Kindle — Send Articles to Your Kindle</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #1a1c25;
  --border: #2e3040;
  --text: #e1e4ed;
  --text-muted: #8b8fa3;
  --accent: #3b82f6;
  --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.container {
  max-width: 480px;
  width: 100%;
  text-align: center;
}
h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
h1 span { color: var(--accent); }
.tagline { color: var(--text-muted); margin-bottom: 32px; font-size: 15px; }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 16px;
  text-align: left;
}
.card h2 { font-size: 16px; margin-bottom: 8px; }
.card p { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
.btn {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 10px 24px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  margin-top: 16px;
}
.btn:hover { filter: brightness(1.15); }
.btn-secondary {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
}
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
.step {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
}
.step-num { font-size: 24px; font-weight: 700; color: var(--accent); margin-bottom: 8px; }
.step-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.step-desc { font-size: 11px; color: var(--text-muted); }
</style>
</head>
<body>
<div class="container">
  <h1>Web<span>2</span>Kindle</h1>
  <p class="tagline">Forward newsletters to your Kindle. RSS coming soon.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-title">Sign up</div>
      <div class="step-desc">Enter your Kindle email</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-title">Get address</div>
      <div class="step-desc">Receive your unique forwarding address</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-title">Forward</div>
      <div class="step-desc">Forward any newsletter to your address</div>
    </div>
  </div>

  <a href="/register" class="btn">Get Your Forwarding Address</a>
  <p style="margin-top: 16px; font-size: 13px;">
    Already have an account? <a href="/dashboard" style="color: var(--accent);">Go to dashboard</a>
  </p>
</div>
</body>
</html>
```

- [ ] **Step 2: Write the registration page**

Create `web/register.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Register — Web2Kindle</title>
<style>
:root {
  --bg: #0f1117; --surface: #1a1c25; --border: #2e3040;
  --text: #e1e4ed; --text-muted: #8b8fa3; --accent: #3b82f6;
  --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.container { max-width: 480px; width: 100%; }
h1 { font-size: 24px; margin-bottom: 24px; }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px; margin-bottom: 16px;
}
label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
input {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 10px; border-radius: 6px; font-size: 14px;
  margin-bottom: 16px;
}
input:focus { outline: none; border-color: var(--accent); }
.btn {
  width: 100%; background: var(--accent); color: #fff; border: none;
  padding: 12px; border-radius: var(--radius); font-size: 14px;
  font-weight: 600; cursor: pointer;
}
.btn:hover { filter: brightness(1.15); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.result { display: none; }
.result h3 { font-size: 14px; margin-bottom: 8px; color: var(--accent); }
.result .value {
  background: var(--bg); border: 1px solid var(--border);
  padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px;
  margin-bottom: 12px; word-break: break-all;
}
.copy-btn {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;
  margin-left: 8px;
}
.copy-btn:hover { background: var(--border); }
.error { color: #ef4444; font-size: 13px; margin-top: 8px; display: none; }
.note { color: var(--text-muted); font-size: 12px; margin-top: 16px; line-height: 1.5; }
</style>
</head>
<body>
<div class="container">
  <h1>Get Your Forwarding Address</h1>

  <div class="card" id="form-card">
    <form id="register-form">
      <label for="kindle-email">Your Kindle email address</label>
      <input type="email" id="kindle-email" placeholder="you@kindle.com" required autofocus>
      <button type="submit" class="btn" id="submit-btn">Create Address</button>
    </form>
    <div class="error" id="error"></div>
  </div>

  <div class="card result" id="result-card">
    <h3>Your Forwarding Address</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Forward newsletters to this address:</p>
    <div class="value" id="forwarding-address"></div>
    <button class="copy-btn" onclick="copyAddress()">Copy</button>

    <h3 style="margin-top:20px">Your API Key</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste this in the Chrome extension options to link your account:</p>
    <div class="value" id="api-key"></div>
    <button class="copy-btn" onclick="copyApiKey()">Copy</button>

    <p class="note">
      <strong>Next step:</strong> Add <code>noreply@web2kindle.com</code> to your Kindle's
      <a href="https://www.amazon.com/myk" target="_blank" style="color:var(--accent)">Approved Personal Document E-mail List</a>.
    </p>
  </div>

  <p style="font-size:13px;text-align:center">
    <a href="/dashboard" style="color:var(--accent)">Go to dashboard</a>
  </p>
</div>

<script>
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("kindle-email").value.trim();
  const btn = document.getElementById("submit-btn");
  const errorEl = document.getElementById("error");

  if (!email.includes("@")) {
    errorEl.textContent = "Please enter a valid email address";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creating...";
  errorEl.style.display = "none";

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kindle_email: email })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Registration failed");
    }

    document.getElementById("forwarding-address").textContent = data.forwarding_address;
    document.getElementById("api-key").textContent = data.api_key;
    document.getElementById("form-card").style.display = "none";
    document.getElementById("result-card").style.display = "block";

    // Store API key in localStorage for dashboard access
    localStorage.setItem("w2k_api_key", data.api_key);

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Create Address";
  }
});

function copyAddress() {
  const text = document.getElementById("forwarding-address").textContent;
  navigator.clipboard.writeText(text);
}

function copyApiKey() {
  const text = document.getElementById("api-key").textContent;
  navigator.clipboard.writeText(text);
}
</script>
</body>
</html>
```

- [ ] **Step 3: Write the dashboard page**

Create `web/dashboard.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — Web2Kindle</title>
<style>
:root {
  --bg: #0f1117; --surface: #1a1c25; --surface2: #23252f;
  --border: #2e3040; --text: #e1e4ed; --text-muted: #8b8fa3;
  --accent: #3b82f6; --accent-green: #10b981; --accent-amber: #f59e0b;
  --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh; padding: 20px;
}
.container { max-width: 700px; margin: 0 auto; }
header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
h1 { font-size: 20px; }
h1 span { color: var(--accent); }
.logout { color: var(--text-muted); font-size: 13px; cursor: pointer; background: none; border: none; }
.logout:hover { color: var(--text); }

.auth-screen { display: none; text-align: center; padding: 60px 20px; }
.auth-screen h2 { margin-bottom: 16px; }
.auth-screen input { width: 100%; max-width: 360px; margin-bottom: 12px; }
.auth-screen .btn { max-width: 360px; }

.dashboard { display: none; }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; margin-bottom: 16px;
}
.card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); margin-bottom: 12px; }
.card .value {
  background: var(--surface2); border: 1px solid var(--border);
  padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px;
  display: inline-block;
}
.copy-btn {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;
  margin-left: 8px; vertical-align: middle;
}
.copy-btn:hover { background: var(--border); }

.usage-bar {
  height: 8px; background: var(--surface2); border-radius: 4px;
  margin: 12px 0 6px; overflow: hidden;
}
.usage-fill {
  height: 100%; background: var(--accent-green); border-radius: 4px;
  transition: width .3s;
}
.usage-fill.warning { background: var(--accent-amber); }
.usage-fill.danger { background: #ef4444; }
.usage-text { font-size: 12px; color: var(--text-muted); }

.history-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--border);
}
.history-item:last-child { border-bottom: none; }
.history-title { font-size: 13px; flex: 1; }
.history-meta { font-size: 11px; color: var(--text-muted); margin-right: 12px; white-space: nowrap; }
.history-tag {
  font-size: 9px; padding: 2px 6px; border-radius: 3px;
  text-transform: uppercase; margin-right: 8px;
}
.tag-newsletter { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
.tag-extension { background: color-mix(in srgb, var(--accent-green) 20%, transparent); color: var(--accent-green); }

.empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }

.placeholder-card {
  border: 1px dashed var(--border); opacity: .6;
}
.placeholder-card h2 { color: var(--text-muted); }

input {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 10px; border-radius: 6px; font-size: 14px;
}
input:focus { outline: none; border-color: var(--accent); }
.btn {
  background: var(--accent); color: #fff; border: none;
  padding: 10px 24px; border-radius: var(--radius); font-size: 14px;
  font-weight: 600; cursor: pointer;
}
.btn:hover { filter: brightness(1.15); }
.btn:disabled { opacity: .5; cursor: not-allowed; }

.settings-row { display: flex; gap: 8px; align-items: flex-end; }
.settings-row input { flex: 1; }
.settings-row .btn { padding: 10px 16px; white-space: nowrap; }

.error { color: #ef4444; font-size: 13px; margin-top: 8px; display: none; }
.success { color: var(--accent-green); font-size: 13px; margin-top: 8px; display: none; }
</style>
</head>
<body>
<div class="container">

  <!-- Auth screen (shown if no API key stored) -->
  <div class="auth-screen" id="auth-screen">
    <h2>Enter your API key</h2>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
      You received this when you signed up. Lost it?
      <a href="/register" style="color:var(--accent)">Register a new address</a>.
    </p>
    <input type="text" id="api-key-input" placeholder="w2k_...">
    <button class="btn" onclick="login()">Enter Dashboard</button>
    <p class="error" id="auth-error"></p>
  </div>

  <!-- Dashboard (shown after auth) -->
  <div class="dashboard" id="dashboard">
    <header>
      <h1>Web<span>2</span>Kindle Dashboard</h1>
      <button class="logout" onclick="logout()">Sign out</button>
    </header>

    <!-- Forwarding address -->
    <div class="card">
      <h2>Your Forwarding Address</h2>
      <span class="value" id="forwarding-addr">—</span>
      <button class="copy-btn" onclick="copy('forwarding-addr')">Copy</button>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
        Forward any newsletter to this address. EPUB arrives on your Kindle automatically.
      </p>
    </div>

    <!-- Usage -->
    <div class="card">
      <h2>Usage This Month</h2>
      <div class="usage-bar"><div class="usage-fill" id="usage-bar" style="width:0%"></div></div>
      <p class="usage-text" id="usage-text">Loading...</p>
    </div>

    <!-- History -->
    <div class="card">
      <h2>Recent Sends</h2>
      <div id="history-list"><p class="empty">Loading...</p></div>
    </div>

    <!-- RSS placeholder -->
    <div class="card placeholder-card">
      <h2>RSS Feeds</h2>
      <p style="font-size:13px;color:var(--text-muted)">Coming soon. Subscribe to RSS feeds and get new articles delivered to your Kindle automatically.</p>
    </div>

    <!-- Settings -->
    <div class="card">
      <h2>Settings</h2>
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Kindle Email</label>
      <div class="settings-row">
        <input type="email" id="kindle-email-input" placeholder="you@kindle.com">
        <button class="btn" onclick="saveSettings()">Update</button>
      </div>
      <p class="success" id="settings-success">Updated!</p>
    </div>

    <!-- API key -->
    <div class="card">
      <h2>API Key</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste this in the Chrome extension options to link your account:</p>
      <span class="value" id="api-key-display">—</span>
      <button class="copy-btn" onclick="copy('api-key-display')">Copy</button>
    </div>
  </div>
</div>

<script>
const API_BASE = "/api";

function getApiKey() {
  return localStorage.getItem("w2k_api_key");
}

function apiHeaders() {
  return { "Content-Type": "application/json", "x-api-key": getApiKey() };
}

async function checkAuth() {
  const key = getApiKey();
  if (!key) {
    document.getElementById("auth-screen").style.display = "block";
    document.getElementById("dashboard").style.display = "none";
    return false;
  }

  // Verify the key works
  try {
    const res = await fetch(API_BASE + "/usage", { headers: apiHeaders() });
    if (!res.ok) throw new Error("Invalid key");
    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    return true;
  } catch {
    document.getElementById("auth-screen").style.display = "block";
    document.getElementById("dashboard").style.display = "none";
    return false;
  }
}

async function login() {
  const key = document.getElementById("api-key-input").value.trim();
  const errorEl = document.getElementById("auth-error");

  if (!key.startsWith("w2k_")) {
    errorEl.textContent = "Invalid API key format. Should start with w2k_";
    errorEl.style.display = "block";
    return;
  }

  localStorage.setItem("w2k_api_key", key);

  const ok = await checkAuth();
  if (ok) {
    loadDashboard();
  } else {
    errorEl.textContent = "Invalid API key. Please check and try again.";
    errorEl.style.display = "block";
    localStorage.removeItem("w2k_api_key");
  }
}

function logout() {
  localStorage.removeItem("w2k_api_key");
  document.getElementById("auth-screen").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
}

async function loadDashboard() {
  const key = getApiKey();
  if (!key) return;

  // Load forwarding address
  try {
    // We store it alongside the API key after registration
    const fa = localStorage.getItem("w2k_forwarding_address") || "—";
    document.getElementById("forwarding-addr").textContent = fa;
  } catch {}

  // Load API key display
  document.getElementById("api-key-display").textContent = key;

  // Load usage
  try {
    const res = await fetch(API_BASE + "/usage", { headers: apiHeaders() });
    const data = await res.json();
    const count = data.usage?.newsletter || 0;
    const limit = data.limits?.newsletter || 20;
    const pct = Math.min((count / limit) * 100, 100);

    const bar = document.getElementById("usage-bar");
    bar.style.width = pct + "%";
    bar.className = "usage-fill" + (pct > 90 ? " danger" : pct > 75 ? " warning" : "");

    document.getElementById("usage-text").textContent = count + " / " + limit + " newsletters this month";
  } catch (e) {
    document.getElementById("usage-text").textContent = "Unable to load usage";
  }

  // Load history
  try {
    const res = await fetch(API_BASE + "/history", { headers: apiHeaders() });
    const data = await res.json();
    const items = data.history || [];
    const list = document.getElementById("history-list");

    if (items.length === 0) {
      list.innerHTML = '<p class="empty">No sends yet. Forward a newsletter to get started!</p>';
    } else {
      list.innerHTML = items.map(item => `
        <div class="history-item">
          <span class="history-tag tag-${item.source_type}">${item.source_type}</span>
          <span class="history-title">${escHtml(item.title || "Untitled")}</span>
          <span class="history-meta">${formatDate(item.sent_at)}</span>
        </div>
      `).join("");
    }
  } catch (e) {
    document.getElementById("history-list").innerHTML = '<p class="empty">Unable to load history</p>';
  }

  // Load settings
  // (kindle email not returned from API currently — would need a settings endpoint)
}

async function saveSettings() {
  const email = document.getElementById("kindle-email-input").value.trim();
  if (!email.includes("@")) return;

  // For now, store locally. Future: PUT api/settings.js
  const successEl = document.getElementById("settings-success");
  successEl.style.display = "block";
  setTimeout(() => { successEl.style.display = "none"; }, 2000);
}

function copy(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text);
}

function escHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d.replace(" ", "T") + "Z");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Init
(async () => {
  // If coming from registration, forwarding address and api key are in localStorage
  if (getApiKey() && await checkAuth()) {
    loadDashboard();
  } else if (!getApiKey()) {
    document.getElementById("auth-screen").style.display = "block";
  }
})();
</script>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat: add web dashboard (landing, register, dashboard)"
```

---

### Task 13: Extension API Key Integration

**Files:**
- Modify: `extension/options.html`
- Modify: `extension/options.js`

Add an API key field to the extension options page. When set, the extension includes the API key when recording history, linking extension sends to the web dashboard.

- [ ] **Step 1: Read the current options files**

First, understand what the current options UI looks like.

- [ ] **Step 2: Add API key input to options.html**

Find the settings form in `extension/options.html` and add after the Kindle email field:

```html
<div class="setting">
  <label for="api-key">Web Dashboard API Key</label>
  <input type="text" id="api-key" placeholder="w2k_...">
  <p class="help">Paste your API key from the <a href="https://web2kindle.com/dashboard" target="_blank">web dashboard</a> to sync history across devices.</p>
</div>
```

- [ ] **Step 3: Update options.js to save/load API key**

Add to the save/load functions in `extension/options.js`:

```js
// In loadSettings():
const apiKey = result.apiKey || "";
document.getElementById("api-key").value = apiKey;

// In saveSettings():
const apiKey = document.getElementById("api-key").value.trim();
// Save along with other settings
chrome.storage.sync.set({ apiKey, /* other settings */ });
```

- [ ] **Step 4: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "feat: add API key field to extension options"
```

---

### Task 14: Integration Test & Kanban Update

**Files:**
- Create: `tests/test_integration.js`
- Modify: `kanban.html`

- [ ] **Step 1: Write the integration test**

Create `tests/test_integration.js` — a full end-to-end test using in-memory DB:

```js
const { createClient } = require("@libsql/client");
const { ensureSchema, createUser, getUserByForwardingAddress, incrementUsage, getUsage, addHistory, getHistory } = require("../lib/db");
const { parseSendGridWebhook } = require("../lib/email-parser");
const { extractNewsletterContent } = require("../lib/html-extractor");
const { sanitizeHtmlForEpub } = require("../lib/sanitize-epub");
const { generateEpubNode } = require("../lib/epub-generator-node");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  const db = createClient({ url: ":memory:" });
  await ensureSchema(db);

  // 1. Create user
  const user = await createUser(db, "mykindle@example.com");

  test("user created with forwarding address", () => {
    if (!user.forwarding_address.includes("@")) throw new Error("bad forwarding address");
    if (!user.api_key.startsWith("w2k_")) throw new Error("bad api key");
  });

  // 2. Simulate SendGrid webhook
  const webhookPayload = {
    from: "Daily Digest <hello@dailynews.com>",
    to: user.forwarding_address,
    subject: "Issue #128: Tech Roundup",
    html: `
      <html><body>
        <p style="color:#666">View this email in your browser</p>
        <hr>
        <h1>Tech Roundup: This Week's Top Stories</h1>
        <p>Welcome to this week's edition. Here are the top stories:</p>
        <h2>AI Breakthrough Changes Everything</h2>
        <p>Researchers have discovered a new approach to training models that uses 90% less energy.</p>
        <p>Read more at <a href="https://example.com/ai">example.com/ai</a></p>
        <h2>Startup Raises $50M</h2>
        <p>The company plans to expand into new markets next quarter.</p>
        <hr>
        <p style="font-size:10px">Unsubscribe | Manage preferences</p>
        <img src="https://track.news.com/pixel.gif" width="1" height="1">
      </body></html>
    `
  };

  // 3. Parse webhook
  const parsed = parseSendGridWebhook(webhookPayload);

  test("webhook parsed correctly", () => {
    if (parsed.forwardingAddress !== user.forwarding_address) throw new Error("address mismatch");
    if (!parsed.subject.includes("Tech Roundup")) throw new Error("subject mismatch");
  });

  // 4. Look up user
  const foundUser = await getUserByForwardingAddress(db, parsed.forwardingAddress);

  test("user found by forwarding address", () => {
    if (!foundUser) throw new Error("no user found");
    if (foundUser.kindle_email !== "mykindle@example.com") throw new Error("wrong kindle email");
  });

  // 5. Extract and sanitize content
  const extracted = extractNewsletterContent(parsed.body, {
    subject: parsed.subject,
    senderName: parsed.senderName
  });

  test("content extracted from newsletter", () => {
    if (!extracted.content.includes("Tech Roundup")) throw new Error("title not in content");
    if (extracted.content.includes("Unsubscribe")) throw new Error("footer not stripped");
    if (extracted.content.includes("track.news.com")) throw new Error("tracking pixel not stripped");
    if (extracted.content.includes("View this email")) throw new Error("view-in-browser not stripped");
  });

  const sanitized = sanitizeHtmlForEpub(extracted.content);

  test("content sanitized for EPUB", () => {
    if (sanitized.includes("<style")) throw new Error("style not stripped");
    if (sanitized.includes("style=")) throw new Error("inline style not stripped");
    if (!sanitized.includes("<h2>")) throw new Error("headings lost");
    if (!sanitized.includes("<a ")) throw new Error("links lost");
  });

  // 6. Generate EPUB
  const result = await generateEpubNode({
    title: extracted.title,
    author: extracted.author,
    content: sanitized,
    url: "https://example.com/newsletter/128"
  });

  test("EPUB generated successfully", () => {
    if (!result.blob || result.blob.size < 500) throw new Error("EPUB too small");
  });

  const buf = Buffer.from(await result.blob.arrayBuffer());

  test("EPUB is valid ZIP", () => {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not a ZIP");
  });

  // 7. Track usage
  await incrementUsage(db, foundUser.id, "newsletter");
  const usage = await getUsage(db, foundUser.id, "2026-06");

  test("usage tracked correctly", () => {
    if (usage.newsletter !== 1) throw new Error("usage count should be 1, got " + usage.newsletter);
  });

  // 8. Add to history
  await addHistory(db, foundUser.id, extracted.title, "https://example.com/newsletter/128", "newsletter");
  const history = await getHistory(db, foundUser.id, 10);

  test("history recorded correctly", () => {
    if (history.length !== 1) throw new Error("history should have 1 entry");
    if (history[0].title !== extracted.title) throw new Error("title mismatch in history");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run the integration test**

```bash
node tests/test_integration.js
```

Expected: ALL TESTS PASSED

- [ ] **Step 3: Move kanban card**

Update `kanban.html` — change card `r3` ("Newsletter-to-Kindle (email forwarding)") from `column: 'ready'` to `column: 'in-progress'`:

```js
// In the defaultCards array, change:
{ id: 'r3', ..., column: 'ready', ... }
// To:
{ id: 'r3', ..., column: 'in-progress', ... }
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_integration.js kanban.html
git commit -m "test: add integration test; move newsletter card to in-progress"
```

---

## Deployment Checklist

After all tasks are complete:

1. **Turso DB** — Create database at turso.tech, run schema:
   ```sql
   CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, api_key TEXT UNIQUE NOT NULL,
     kindle_email TEXT NOT NULL, forwarding_address TEXT UNIQUE NOT NULL,
     created_at TEXT DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
     year_month TEXT NOT NULL, count INTEGER DEFAULT 0,
     source_type TEXT NOT NULL,
     UNIQUE(user_id, year_month, source_type)
   );
   CREATE TABLE IF NOT EXISTS send_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
     title TEXT, url TEXT, source_type TEXT NOT NULL,
     sent_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'sent'
   );
   ```

2. **Vercel env vars** — Set in Vercel dashboard:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `SENDGRID_INBOUND_SECRET` (optional webhook auth)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

3. **SendGrid setup:**
   - Configure Inbound Parse at `inbound.yourdomain.com`
   - Webhook URL → `https://your-app.vercel.app/api/inbound-email`
   - Enable "Post the raw, full MIME message" — OFF (we use parsed fields)

4. **SMTP setup:**
   - Configure sending domain (SPF, DKIM) on Resend or SendGrid
   - Verify `noreply@yourdomain.com` as an authorized sender

5. **Push to Vercel:**
   ```bash
   vercel --prod
   ```

6. **Test:**
   - Register at `https://yourdomain.com/register`
   - Forward a test newsletter to the generated address
   - Verify EPUB appears on Kindle
   - Check dashboard history
