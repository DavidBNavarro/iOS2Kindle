# iOS / Extension Repo Split Design

## Goal

Split the monorepo into two independent repos: one for the Chrome Extension (+ backend), one for iOS Scriptable workflow. Both serve the same purpose (web article → EPUB → Kindle via Gmail API) but share zero runtime code and have different deployment paths.

## Background

The workspace grew organically. `ios/` and `extension/` evolved independently, but share the same `tests/`, `AGENTS.md`, and root-level config. The core EPUB/sanitization logic is duplicated (not shared) in `ios/bundle.js` and `extension/epub-generator.js`. This creates confusion when giving instructions, complicates AGENTS.md, and makes independent deployment harder.

## What Stays (web2kindle — Extension + Backend)

This repo keeps all Chrome Extension and backend files:

- `extension/` — full Chrome extension (MV3)
- `server.py`, `smtp_relay.py`, `w2k_epub.py` — Python backend
- `api/`, `scripts/` — license verification, key generation
- `install.sh`, `uninstall.sh` — deployment
- `package.json` — jsdom, jszip (used by extension + tests)
- `requirements.txt` — Python deps
- `tests/` — stripped of iOS-specific tests
- `AGENTS.md` — trimmed to extension + backend only
- `.gitignore`, `docs/`, etc.

## What Moves (web2kindle-ios — new repo)

New repo with only iOS content:

- `ios/` — iOS2Kindle.js + bundle.js
- iOS-relevant tests from `tests/`:
  - `test_ios2kindle_flow.js` — full iOS pipeline test
  - `test_bundle.js` — bundle.js function tests
  - `debug_nbc3.js` — iOS debug script
  - `test_wikipedia.js` — iOS pipeline with live Wikipedia
  - `output/` — generated EPUBs (from iOS tests)
- `test_full_pipeline.js` stays with extension (validates both, but primarily tests extension-relevant code). iOS repo gets a trimmed copy.
- Its own `AGENTS.md` with iOS-only instructions
- No npm deps, no Python, no extension code

## Mechanics

1. Create new repo `web2kindle-ios` on GitHub
2. Clone it locally, copy `ios/` and applicable tests in, commit
3. In this repo: delete `ios/`, strip iOS tests and AGENTS.md sections, commit
4. Both repos get their own `AGENTS.md`

## Non-Goals

- Not extracting a shared library (the user chose "copy + separate")
- Not restructuring extension code or iOS code
- Not changing any runtime behavior
