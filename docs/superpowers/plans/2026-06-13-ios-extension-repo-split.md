# iOS / Extension Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monorepo into two independent repos — one for the Chrome Extension (+ Python backend), one for the iOS Scriptable workflow — with no shared source code, no drift risk, and each having its own AGENTS.md.

**Architecture:** Current repo (`web2kindle`, origin `git@github.com:DavidBNavarro/iOS2Kindle.git`) keeps extension + backend. New repo (`web2kindle-ios`) gets the iOS folder + its tests. Copy + separate approach (no shared library extraction). Straightforward file moves and git operations.

**Tech Stack:** git, GitHub CLI (gh), zsh

---

### Task 1: Create the iOS repo and populate it

**Files:**
- Create: `web2kindle-ios/` (new repo directory)
- Create: `web2kindle-ios/ios/iOS2Kindle.js`
- Create: `web2kindle-ios/ios/bundle.js`
- Create: `web2kindle-ios/tests/test_ios2kindle_flow.js`
- Create: `web2kindle-ios/tests/test_bundle.js`
- Create: `web2kindle-ios/tests/test_wikipedia.js`
- Create: `web2kindle-ios/tests/output/` (empty dir with .gitkeep)
- Note: `debug_nbc3.js` stays with extension repo (has cross-references to extension code)
- Create: `web2kindle-ios/AGENTS.md`
- Create: `web2kindle-ios/.gitignore`

- [ ] **Step 1: Create the GitHub repo**

```bash
gh repo create web2kindle-ios --private --description "iOS Scriptable workflow for sending web articles to Kindle" --clone
```

Expected output: remote URL like `git@github.com:DavidBNavarro/web2kindle-ios.git` and a new `web2kindle-ios/` directory.

- [ ] **Step 2: Copy iOS files**

```bash
cp -r /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle/ios /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/ios
```

- [ ] **Step 3: Copy iOS-specific test files**

Note: `debug_nbc3.js` stays with the extension repo — it has cross-references to `extension/lib/readability.js` and `extension/article-extractor.js`.

```bash
mkdir -p /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/tests/output
cp /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle/tests/test_ios2kindle_flow.js /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/tests/
cp /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle/tests/test_bundle.js /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/tests/
cp /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle/tests/test_wikipedia.js /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/tests/
touch /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios/tests/output/.gitkeep
```

- [ ] **Step 4: Create package.json for iOS tests**

The iOS tests need jsdom and jszip for local testing (the production code in bundle.js is self-contained).

```json
{
  "name": "web2kindle-ios",
  "version": "1.0.0",
  "private": true,
  "description": "iOS Scriptable workflow for sending web articles to Kindle",
  "devDependencies": {
    "jsdom": "^29.1.1",
    "jszip": "^3.10.1"
  }
}
```

Write this to `web2kindle-ios/package.json`.

- [ ] **Step 5: Install iOS test dependencies**

```bash
cd /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios
npm install
```

- [ ] **Step 6: Create AGENTS.md for iOS repo**

```markdown
# web2kindle-ios — iOS Scriptable Workflow

Send web articles to Kindle from iOS using Scriptable.

## Files
- `ios/iOS2Kindle.js` (entry point, runs in Scriptable)
- `ios/bundle.js` (Readability + EPUB generators + ZIP builder, loaded into WebView)

## How It Works
1. **iOS2Kindle.js** fetches article HTML via `Request`, loads `bundle.js` into a **WebView**, processes via Readability, builds EPUB and base64-encodes it inside the WebView, returns the base64 string. Sends to Kindle via the **Gmail API** (automatic, no compose sheet).

2. **Everything binary happens inside the WebView** — ZIP building, `String.fromCharCode`, `btoa()`. This avoids Scriptable's JavaScriptCore `btoa()` corruption of bytes >127.

3. **Bundle.js** is evaled in TWO contexts: first in main context (utility functions), then again in WebView (Readability, EPUB generation).

## Key Constraints
- **No `setTimeout`/`setInterval`/`Timer.delay`** in Scriptable's main context (JavaScriptCore). Use `Timer.schedule(seconds, false, callback)` wrapped in a Promise.
- **No DOMParser/XMLSerializer** in main context — only inside WebView
- **No JSZip** — use custom ZIP builder
- **No `btoa()` in main context** — may corrupt binary bytes >127
- **Only one WebView** can be active — reuse it if needed

## iOS Gmail API Flow
First run: manual OOB auth flow (copy URL → Safari → paste code). Subsequent runs: refresh token from Keychain, fetch access token, build RFC 2822 MIME message with base64 EPUB, POST to Gmail API.

## Testing
```bash
cd tests
node test_ios2kindle_flow.js
node test_bundle.js
node test_wikipedia.js
```

## Credentials (do NOT commit)
- CLIENT_ID, CLIENT_SECRET from Google Cloud Console
- KINDLE_EMAIL — Send-to-Kindle address
```

Write this to `web2kindle-ios/AGENTS.md`.

- [ ] **Step 7: Create .gitignore for iOS repo**

```
.DS_Store
node_modules/
__pycache__/
*.pyc
.env
```

Write this to `web2kindle-ios/.gitignore`.

- [ ] **Step 8: Commit and push iOS repo**

```bash
cd /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios
git add .
git commit -m "Initial commit: iOS Scriptable Kindle workflow (split from web2kindle)"
git push -u origin main
```

---

### Task 2: Strip iOS from the web2kindle repo

**Files:**
- Modify: `web2kindle/tests/` — remove iOS-specific test files
- Modify: `web2kindle/AGENTS.md` — strip iOS sections
- Delete: `web2kindle/ios/`

- [ ] **Step 1: Remove iOS directory**

```bash
cd /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle
git rm -r ios
```

- [ ] **Step 2: Remove iOS-specific test files**

```bash
git rm tests/test_ios2kindle_flow.js
git rm tests/test_bundle.js
git rm tests/test_wikipedia.js
git rm tests/debug_nbc3.js
git rm tests/test_output.epub 2>/dev/null || true
```

- [ ] **Step 3: Update AGENTS.md**

Read current AGENTS.md, then replace it with an extension+backend-only version. Key changes:
- Remove "iOS Scriptable Workflow" section
- Remove "iOS Gmail API Flow" section
- Remove "iOS OAuth Troubleshooting" section
- Remove references to bundle.js eval strategy, iOS constraints (setTimeout, WebView limits, btoa)
- Keep: extension architecture, Gmail API flow for extension, HTTP 429 handling, validation/testing commands, EPUB structure, sanitization chain, text sanitization, known issues

Read the file first to extract the extension-only content.

- [ ] **Step 4: Verify no iOS references remain**

```bash
rg -i "ios|scriptable|iOS2Kindle" --include "*.md" --include "*.json" --include "*.js" AGENTS.md package.json
```

Expected: no matches (or only false positives like "ios" in unrelated paths).

- [ ] **Step 5: Commit the changes**

```bash
git add -A
git commit -m "chore: remove iOS project (split to web2kindle-ios repo)"
git push
```

---

### Task 3: Verify both repos

- [ ] **Step 1: Verify extension repo is self-contained**

```bash
cd /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle
# Check no iOS files remain
ls ios 2>&1 || echo "ios dir removed: OK"
# Count extension files
ls extension/*.js extension/*.html extension/*.json extension/*.css | wc -l
# Check AGENTS.md has no iOS references
rg -i "iOS|Scriptable|iOS2Kindle" AGENTS.md || echo "No iOS refs: OK"
```

- [ ] **Step 2: Verify iOS repo is self-contained**

```bash
cd /Users/davidnavarro/Library/CloudStorage/Dropbox/All/David/Vibecoding/web2kindle-ios
# Count iOS files
ls ios/*.js | wc -l
# Verify no extension files
ls extension 2>&1 || echo "extension dir not present: OK"
# Verify tests exist
ls tests/*.js | wc -l
```
