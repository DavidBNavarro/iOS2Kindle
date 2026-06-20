# Multi-Select Batch Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select checkboxes (left column for sections, right column for blocks) to the preview tab's edit mode, with batch delete and bidirectional section↔block sync. Edits (deletions + manual rotations) regenerate the EPUB at send time so the delivered file reflects the user's changes.

**Architecture:** Two new focused JS files split from the growing `preview.js`: `preview-multiselect.js` (checkbox gutters, state maps, section↔block sync, batch delete, repositioning) and `preview-epub-rebuild.js` (dirty flag tracking, DOM cleaning, EPUB regeneration). A `_dirty` flag avoids regeneration when no edits were made. `processor.js` stores article metadata + build options in `preview_data` so the preview can call `generateEpub` with the same settings.

**Tech Stack:** Vanilla JS (Chrome extension, shared global scope via `<script>` tags), JSDOM + JSZip for Node tests, existing `generateEpub` from `epub-generator.js`.

**Spec:** `docs/superpowers/specs/2026-06-20-multiselect-batch-delete-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `extension/preview-multiselect.js` | **Create** | `computeSectionState()`, `injectCheckboxes()`, state maps, section↔block sync, `deleteSelected()`, `_clearCheckboxes()`, `_repositionCheckboxes()` |
| `extension/preview-epub-rebuild.js` | **Create** | `cleanPreviewDomForEpub()`, `blobToBase64()`, `_buildEpubFromPreview()` |
| `extension/preview.js` | **Modify** | `_dirty` flag, set it in `_remove`/`removeBlock`/`undoRm`/rotate handler, modify `sendToKindle()`, wire `toggleEdit()` with inject/clear, extend `undoRm()` for batch kind |
| `extension/preview.html` | **Modify** | CSS for gutters/checkboxes/indeterminate/delete button, add `<script>` tags for jszip + epub-generator + new files |
| `extension/processor.js` | **Modify** | Extend `preview_data` with `article` metadata + `buildOpts` |
| `tests/test_preview_multiselect.js` | **Create** | Unit test for `computeSectionState()` |
| `tests/test_preview_epub_rebuild.js` | **Create** | Unit test for `cleanPreviewDomForEpub()` |

**Rationale for file split:** The spec says "No new files," but it was written before the EPUB regeneration scope was added. With regeneration, `preview.js` would grow from 301 to ~600+ lines. The codebase already uses focused JS files (`article-extractor.js`, `epub-generator.js`, `image-processor.js`, etc.), so this split follows the established pattern.

---

### Task 1: Section state computation (pure function + test)

**Files:**
- Create: `extension/preview-multiselect.js`
- Create: `tests/test_preview_multiselect.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_preview_multiselect.js`:

```js
var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");

eval(fs.readFileSync(path.join(ROOT, "extension", "preview-multiselect.js"), "utf8"));

var tests = [];

tests.push({ name: "all checked (3 of 3)", pass: computeSectionState(3, 3) === "all" });
tests.push({ name: "none checked (0 of 3)", pass: computeSectionState(0, 3) === "none" });
tests.push({ name: "some checked (2 of 3)", pass: computeSectionState(2, 3) === "some" });
tests.push({ name: "some checked (1 of 3)", pass: computeSectionState(1, 3) === "some" });
tests.push({ name: "empty section (0 blocks)", pass: computeSectionState(0, 0) === "none" });
tests.push({ name: "single block checked", pass: computeSectionState(1, 1) === "all" });

var passed = 0, failed = 0;
for (var i = 0; i < tests.length; i++) {
  if (tests[i].pass) { console.log("PASS: " + tests[i].name); passed++; }
  else { console.log("FAIL: " + tests[i].name); failed++; }
}
console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_preview_multiselect.js`
Expected: FAIL — `preview-multiselect.js` not found or `computeSectionState` not defined

- [ ] **Step 3: Write minimal implementation**

Create `extension/preview-multiselect.js`:

```js
var _checkboxState = new Map();
var _sectionBlocks = new Map();
var _blockSection = new Map();
var _gutterLeft = null;
var _gutterRight = null;

function computeSectionState(checkedCount, totalCount) {
  if (totalCount === 0) return "none";
  if (checkedCount === 0) return "none";
  if (checkedCount === totalCount) return "all";
  return "some";
}
```

Note: `BLOCK_SEL` is NOT redefined here — it's defined in `preview.js` as `"p,figure,.imgwrap,img,blockquote,ul,ol,pre,h2,h3,h4,table,li"` and shared via global scope. Since `injectCheckboxes` is called at runtime (after all scripts load), `BLOCK_SEL` will be available.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_preview_multiselect.js`
Expected: PASS — all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add extension/preview-multiselect.js tests/test_preview_multiselect.js
git commit -m "feat: add computeSectionState pure function with tests"
```

---

### Task 2: DOM cleaning for EPUB rebuild (pure function + test)

**Files:**
- Create: `extension/preview-epub-rebuild.js`
- Create: `tests/test_preview_epub_rebuild.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_preview_epub_rebuild.js`:

```js
var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");
var ROOT = path.join(__dirname, "..");

var dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

eval(fs.readFileSync(path.join(ROOT, "extension", "preview-epub-rebuild.js"), "utf8"));

function buildMockContent() {
  var content = document.createElement("div");
  content.innerHTML =
    '<div class="p2k-section p2k-section-summary">' +
      '<div class="p2k-rm">✕</div>' +
      "<h2>TL;DR</h2>" +
      "<p>Summary text</p>" +
    "</div>" +
    '<div class="p2k-section">' +
      '<div class="p2k-rm">✕</div>' +
      "<h2>Heading</h2>" +
      '<div class="imgwrap" data-rot="90">' +
        '<button class="p2k-rot">↻</button>' +
        '<img src="https://example.com/img.jpg" style="transform:rotate(90deg);width:500px">' +
      "</div>" +
      '<p data-p2k-id="blk-0">Paragraph</p>' +
    "</div>" +
    '<div class="p2k-section p2k-removed">' +
      "<h2>Deleted section</h2>" +
      "<p>This should be removed</p>" +
    "</div>";
  return content;
}

var tests = [];

var content1 = buildMockContent();
var result1 = cleanPreviewDomForEpub(content1);
tests.push({ name: "removed sections gone", pass: !result1.cleanedHtml.includes("Deleted section") });
tests.push({ name: "p2k-rm elements gone", pass: !result1.cleanedHtml.includes("p2k-rm") });
tests.push({ name: "p2k-rot elements gone", pass: !result1.cleanedHtml.includes("p2k-rot") });
tests.push({ name: "imgwrap unwrapped", pass: !result1.cleanedHtml.includes("imgwrap") });
tests.push({ name: "p2k-section unwrapped", pass: !result1.cleanedHtml.includes("p2k-section") });
tests.push({ name: "data-p2k-id stripped", pass: !result1.cleanedHtml.includes("data-p2k-id") });
tests.push({ name: "data-rot stripped", pass: !result1.cleanedHtml.includes("data-rot") });
tests.push({ name: "inline styles stripped from img", pass: !result1.cleanedHtml.includes("transform:rotate") });
tests.push({ name: "rotation map has correct entry", pass: result1.rotationMap.get("https://example.com/img.jpg") === 90 });
tests.push({ name: "summary not removed (not .p2k-removed)", pass: result1.summaryRemoved === false });
tests.push({ name: "heading preserved", pass: result1.cleanedHtml.includes("<h2>Heading</h2>") });
tests.push({ name: "paragraph preserved", pass: result1.cleanedHtml.includes("Paragraph") });
tests.push({ name: "summary content removed (re-added by generateEpub)", pass: !result1.cleanedHtml.includes("Summary text") });

var content2 = buildMockContent();
var summarySec = content2.querySelector(".p2k-section-summary");
summarySec.classList.add("p2k-removed");
var result2 = cleanPreviewDomForEpub(content2);
tests.push({ name: "summaryRemoved true when user deleted summary", pass: result2.summaryRemoved === true });

var passed = 0, failed = 0;
for (var i = 0; i < tests.length; i++) {
  if (tests[i].pass) { console.log("PASS: " + tests[i].name); passed++; }
  else { console.log("FAIL: " + tests[i].name); failed++; }
}
console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_preview_epub_rebuild.js`
Expected: FAIL — `preview-epub-rebuild.js` not found or `cleanPreviewDomForEpub` not defined

- [ ] **Step 3: Write minimal implementation**

Create `extension/preview-epub-rebuild.js`:

```js
function cleanPreviewDomForEpub(root) {
  var rotationMap = new Map();
  var summaryRemoved = false;

  var summary = root.querySelector(".p2k-section-summary");
  if (summary && summary.classList.contains("p2k-removed")) {
    summaryRemoved = true;
  }

  root.querySelectorAll(".p2k-removed").forEach(function (el) {
    el.remove();
  });

  var summarySec = root.querySelector(".p2k-section-summary");
  if (summarySec) {
    summarySec.remove();
  }

  root.querySelectorAll(".p2k-rm, .p2k-rot").forEach(function (el) {
    el.remove();
  });

  root.querySelectorAll(".imgwrap").forEach(function (wrap) {
    var img = wrap.querySelector("img");
    if (img) {
      var rot = parseInt(wrap.getAttribute("data-rot") || "0", 10);
      if (rot > 0) {
        rotationMap.set(img.getAttribute("src") || "", rot);
      }
      img.style.transform = "";
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.objectFit = "";
      img.style.margin = "";
    }
    while (wrap.firstChild) {
      wrap.parentNode.insertBefore(wrap.firstChild, wrap);
    }
    wrap.remove();
  });

  root.querySelectorAll(".p2k-section").forEach(function (sec) {
    while (sec.firstChild) {
      sec.parentNode.insertBefore(sec.firstChild, sec);
    }
    sec.remove();
  });

  root.querySelectorAll("[data-p2k-id]").forEach(function (el) {
    el.removeAttribute("data-p2k-id");
  });
  root.querySelectorAll("[data-rot]").forEach(function (el) {
    el.removeAttribute("data-rot");
  });

  return {
    cleanedHtml: root.innerHTML,
    rotationMap: rotationMap,
    summaryRemoved: summaryRemoved,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_preview_epub_rebuild.js`
Expected: PASS — all 14 tests pass

- [ ] **Step 5: Commit**

```bash
git add extension/preview-epub-rebuild.js tests/test_preview_epub_rebuild.js
git commit -m "feat: add cleanPreviewDomForEpub with tests"
```

---

### Task 3: Extend preview_data in processor.js

**Files:**
- Modify: `extension/processor.js:362-404` (handlePreview function)

- [ ] **Step 1: Modify handlePreview signature and call site**

In `extension/processor.js`, change the `handlePreview` call at line 460 to pass `keepImages` and `keepLinks`:

Old (line 460):
```js
      await handlePreview(built.epubBlob, result.article, result.html, title, built.summary);
```

New:
```js
      await handlePreview(built.epubBlob, result.article, result.html, title, built.summary, keepImages, keepLinks);
```

- [ ] **Step 2: Modify handlePreview function signature**

Change the function signature at line 362:

Old (line 362):
```js
async function handlePreview(epubBlob, article, html, title, summary) {
```

New:
```js
async function handlePreview(epubBlob, article, html, title, summary, keepImages, keepLinks) {
```

- [ ] **Step 3: Add article metadata + buildOpts to preview_data**

In the `chrome.storage.local.set` call (lines 389-400), add the `article` and `buildOpts` fields:

Old:
```js
    chrome.storage.local.set({
      preview_data: {
        title: title,
        content: article.content,
        detailsHtml: detailsHtml,
        metaHtml: metaParts.join(" · "),
        summary: summary || "",
        serverUrl: POPUP_SERVER_URL,
        url: TARGET_URL,
        openerTabId: OPENER_TAB_ID,
      }
    }, resolve);
```

New:
```js
    chrome.storage.local.set({
      preview_data: {
        title: title,
        content: article.content,
        detailsHtml: detailsHtml,
        metaHtml: metaParts.join(" · "),
        summary: summary || "",
        serverUrl: POPUP_SERVER_URL,
        url: TARGET_URL,
        openerTabId: OPENER_TAB_ID,
        article: {
          author: article.author || "",
          sitename: article.sitename || "",
          pubDate: article.pubDate || "",
          readTime: article.readTime || 0,
          textContent: article.textContent || "",
        },
        buildOpts: {
          keepImages: keepImages,
          keepLinks: keepLinks,
          rotateImages: true,
          deliveryMode: false,
        },
      }
    }, resolve);
```

- [ ] **Step 4: Verify processor.js parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/processor.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add extension/processor.js
git commit -m "feat: store article metadata + buildOpts in preview_data"
```

---

### Task 4: CSS + script tags in preview.html

**Files:**
- Modify: `extension/preview.html` (CSS in `<style>` block, scripts before `</body>`)

- [ ] **Step 1: Add CSS for checkbox gutters, checkboxes, and delete button**

In `extension/preview.html`, insert these rules at the end of the `<style>` block (after the `@keyframes spin` rule, before `</style>` at line 63):

```css
    .p2k-gutter-left, .p2k-gutter-right { position: fixed; top: 40px; bottom: 0; width: 28px; display: none; z-index: 9998; pointer-events: none; }
    .p2k-gutter-left { left: 0; }
    .p2k-gutter-right { right: 0; }
    body.p2k-editing .p2k-gutter-left, body.p2k-editing .p2k-gutter-right { display: block; }
    .p2k-cb { position: absolute; left: 6px; width: 16px; height: 16px; pointer-events: auto; cursor: pointer; margin: 4px 0; accent-color: #ff9900; }
    .p2k-gutter-right .p2k-cb { left: auto; right: 6px; }
    .p2k-cb[data-indeterminate="true"] { opacity: 0.5; }
    .p2k-bar button#p2k-delete-selected { background: #dc2626; color: #fff; }
    .p2k-bar button#p2k-delete-selected:hover { background: #b91c1c; }
    body.p2k-editing #p2k-content { padding-left: 32px; padding-right: 32px; }
```

- [ ] **Step 2: Add script tags for jszip, epub-generator, and new files**

In `extension/preview.html`, replace the script block (lines 70-72):

Old:
```html
  <script src="history-store.js"></script>
  <script src="image-processor.js"></script>
  <script src="preview.js"></script>
```

New:
```html
  <script src="lib/jszip.min.js"></script>
  <script src="history-store.js"></script>
  <script src="image-processor.js"></script>
  <script src="epub-generator.js"></script>
  <script src="preview-multiselect.js"></script>
  <script src="preview-epub-rebuild.js"></script>
  <script src="preview.js"></script>
```

Note: `preview.js` must remain last because it calls functions from the other files on load.

- [ ] **Step 3: Verify HTML is valid**

Run: `node -e "var fs = require('fs'); var h = fs.readFileSync('extension/preview.html','utf8'); if (!h.includes('preview-multiselect.js') || !h.includes('preview-epub-rebuild.js') || !h.includes('epub-generator.js')) throw new Error('missing script tag'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add extension/preview.html
git commit -m "feat: add CSS and script tags for multiselect + epub rebuild"
```

---

### Task 5: Checkbox injection + state management + sync

**Files:**
- Modify: `extension/preview-multiselect.js` (add to existing file)

- [ ] **Step 1: Add injectCheckboxes function**

Append to `extension/preview-multiselect.js`:

```js
var BLOCK_SEL = "p,figure,img,blockquote,ul,ol,pre,h2,h3,h4,table,li";

function injectCheckboxes(contentDiv) {
  _clearCheckboxes();
  _gutterLeft = document.createElement("div");
  _gutterLeft.className = "p2k-gutter-left";
  _gutterRight = document.createElement("div");
  _gutterRight.className = "p2k-gutter-right";
  document.body.appendChild(_gutterLeft);
  document.body.appendChild(_gutterRight);

  var sections = contentDiv.querySelectorAll(".p2k-section");
  var secIdx = 0, blkIdx = 0;

  sections.forEach(function (sec) {
    if (sec.classList.contains("p2k-removed")) return;
    var secId = "sec-" + secIdx;
    sec.setAttribute("data-p2k-id", secId);
    secIdx++;

    var secCb = _makeCheckbox(secId, true);
    _gutterLeft.appendChild(secCb);

    var blockIds = [];
    sec.querySelectorAll(BLOCK_SEL).forEach(function (el) {
      if (el.closest(".p2k-rm") || el.closest(".p2k-rot")) return;
      if (el.classList.contains("p2k-removed")) return;
      if (el.parentElement && el.parentElement.classList.contains("imgwrap") && el.tagName === "IMG") return;
      var blkId = "blk-" + blkIdx;
      el.setAttribute("data-p2k-id", blkId);
      blkIdx++;

      var blkCb = _makeCheckbox(blkId, false);
      _gutterRight.appendChild(blkCb);

      _checkboxState.set(blkId, false);
      _blockSection.set(blkId, secId);
      blockIds.push(blkId);
    });

    _checkboxState.set(secId, false);
    _sectionBlocks.set(secId, blockIds);
  });

  _repositionCheckboxes();
}

function _makeCheckbox(id, isSection) {
  var cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "p2k-cb";
  cb.setAttribute("data-item-id", id);
  cb.setAttribute("data-is-section", isSection ? "true" : "false");
  cb.addEventListener("change", function () {
    if (isSection) {
      _onSectionToggle(id, cb.checked);
    } else {
      _onBlockToggle(id, cb.checked);
    }
  });
  cb.addEventListener("click", function (e) {
    e.stopPropagation();
  });
  return cb;
}

function _onSectionToggle(sectionId, checked) {
  _checkboxState.set(sectionId, checked);
  var blockIds = _sectionBlocks.get(sectionId) || [];
  blockIds.forEach(function (blkId) {
    _checkboxState.set(blkId, checked);
    var blkCb = _gutterRight.querySelector('[data-item-id="' + blkId + '"]');
    if (blkCb) {
      blkCb.checked = checked;
      blkCb.removeAttribute("data-indeterminate");
    }
    _updateHighlight(blkId, checked);
  });
  var secCb = _gutterLeft.querySelector('[data-item-id="' + sectionId + '"]');
  if (secCb) {
    secCb.removeAttribute("data-indeterminate");
    secCb.indeterminate = false;
  }
  _updateHighlight(sectionId, checked);
  _updateDeleteButton();
}

function _onBlockToggle(blockId, checked) {
  _checkboxState.set(blockId, checked);
  _updateHighlight(blockId, checked);

  var sectionId = _blockSection.get(blockId);
  if (sectionId) {
    _recomputeSection(sectionId);
  }
  _updateDeleteButton();
}

function _recomputeSection(sectionId) {
  var blockIds = _sectionBlocks.get(sectionId) || [];
  var checkedCount = 0;
  blockIds.forEach(function (blkId) {
    if (_checkboxState.get(blkId)) checkedCount++;
  });
  var state = computeSectionState(checkedCount, blockIds.length);
  var secCb = _gutterLeft.querySelector('[data-item-id="' + sectionId + '"]');
  if (state === "all") {
    _checkboxState.set(sectionId, true);
    if (secCb) { secCb.checked = true; secCb.removeAttribute("data-indeterminate"); secCb.indeterminate = false; }
    _updateHighlight(sectionId, true);
  } else if (state === "none") {
    _checkboxState.set(sectionId, false);
    if (secCb) { secCb.checked = false; secCb.removeAttribute("data-indeterminate"); secCb.indeterminate = false; }
    _updateHighlight(sectionId, false);
  } else {
    _checkboxState.set(sectionId, false);
    if (secCb) { secCb.checked = false; secCb.setAttribute("data-indeterminate", "true"); secCb.indeterminate = true; }
    _updateHighlight(sectionId, false);
  }
}

function _updateHighlight(id, checked) {
  var el = document.querySelector('[data-p2k-id="' + id + '"]');
  if (!el) return;
  if (checked) {
    el.classList.add("p2k-selected");
  } else {
    el.classList.remove("p2k-selected");
  }
}

function _clearCheckboxes() {
  if (_gutterLeft) { _gutterLeft.remove(); _gutterLeft = null; }
  if (_gutterRight) { _gutterRight.remove(); _gutterRight = null; }
  _checkboxState.clear();
  _sectionBlocks.clear();
  _blockSection.clear();
  var delBtn = document.getElementById("p2k-delete-selected");
  if (delBtn) delBtn.style.display = "none";
}
```

- [ ] **Step 2: Verify file parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/preview-multiselect.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Run existing test to ensure no regression**

Run: `node tests/test_preview_multiselect.js`
Expected: PASS — all 6 tests still pass (computeSectionState unchanged)

- [ ] **Step 4: Commit**

```bash
git add extension/preview-multiselect.js
git commit -m "feat: add checkbox injection, state management, and section↔block sync"
```

---

### Task 6: Batch delete + toolbar delete button

**Files:**
- Modify: `extension/preview-multiselect.js` (add deleteSelected + _updateDeleteButton)

- [ ] **Step 1: Add _updateDeleteButton and deleteSelected functions**

Append to `extension/preview-multiselect.js`:

```js
function _updateDeleteButton() {
  var btn = document.getElementById("p2k-delete-selected");
  if (!btn) return;
  var count = 0;
  _checkboxState.forEach(function (v) { if (v) count++; });
  if (count > 0) {
    btn.textContent = "Delete (" + count + ")";
    btn.style.display = "";
  } else {
    btn.style.display = "none";
  }
}

function deleteSelected() {
  var sectionsToRemove = [];
  var blocksToRemove = [];

  _checkboxState.forEach(function (checked, id) {
    if (!checked) return;
    if (id.indexOf("sec-") === 0) {
      sectionsToRemove.push(id);
    } else {
      var sectionId = _blockSection.get(id);
      if (sectionId && _checkboxState.get(sectionId)) return;
      blocksToRemove.push(id);
    }
  });

  var els = [];
  sectionsToRemove.forEach(function (id) {
    var el = document.querySelector('[data-p2k-id="' + id + '"]');
    if (el && !el.classList.contains("p2k-removed")) {
      el.classList.add("p2k-removed");
      els.push(el);
    }
  });
  blocksToRemove.forEach(function (id) {
    var el = document.querySelector('[data-p2k-id="' + id + '"]');
    if (el && !el.classList.contains("p2k-removed")) {
      el.classList.add("p2k-removed");
      els.push(el);
    }
  });

  if (els.length === 0) return;

  undoStack.push({ kind: "batch", els: els });
  _dirty = true;
  _showUndo();

  var count = els.length;
  _checkboxState.clear();
  if (_gutterLeft) {
    _gutterLeft.querySelectorAll(".p2k-cb").forEach(function (cb) { cb.checked = false; cb.removeAttribute("data-indeterminate"); cb.indeterminate = false; });
  }
  if (_gutterRight) {
    _gutterRight.querySelectorAll(".p2k-cb").forEach(function (cb) { cb.checked = false; cb.removeAttribute("data-indeterminate"); cb.indeterminate = false; });
  }
  document.querySelectorAll(".p2k-selected").forEach(function (el) { el.classList.remove("p2k-selected"); });

  _updateDeleteButton();
  _repositionCheckboxes();
  msg("Removed " + count + " item" + (count > 1 ? "s" : ""));
}
```

Note: `undoStack`, `_showUndo`, and `msg` are global functions/variables from `preview.js`, accessible since all scripts share global scope.

- [ ] **Step 2: Verify file parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/preview-multiselect.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add extension/preview-multiselect.js
git commit -m "feat: add batch delete with undo support"
```

---

### Task 7: Checkbox repositioning

**Files:**
- Modify: `extension/preview-multiselect.js` (add _repositionCheckboxes + listeners)

- [ ] **Step 1: Add _repositionCheckboxes function**

Append to `extension/preview-multiselect.js`:

```js
var _repositionRaf = null;

function _repositionCheckboxes() {
  if (!_gutterLeft && !_gutterRight) return;
  if (_repositionRaf) cancelAnimationFrame(_repositionRaf);
  _repositionRaf = requestAnimationFrame(function () {
    _repositionRaf = null;
    _doReposition();
  });
}

function _doReposition() {
  var gutterTop = 40;
  if (_gutterLeft) {
    _gutterLeft.querySelectorAll(".p2k-cb").forEach(function (cb) {
      var id = cb.getAttribute("data-item-id");
      var el = document.querySelector('[data-p2k-id="' + id + '"]');
      if (!el || el.classList.contains("p2k-removed")) {
        cb.style.display = "none";
        return;
      }
      cb.style.display = "";
      var rect = el.getBoundingClientRect();
      cb.style.top = (rect.top + window.scrollY - gutterTop + 4) + "px";
    });
  }
  if (_gutterRight) {
    _gutterRight.querySelectorAll(".p2k-cb").forEach(function (cb) {
      var id = cb.getAttribute("data-item-id");
      var el = document.querySelector('[data-p2k-id="' + id + '"]');
      if (!el || el.classList.contains("p2k-removed")) {
        cb.style.display = "none";
        return;
      }
      cb.style.display = "";
      var rect = el.getBoundingClientRect();
      cb.style.top = (rect.top + window.scrollY - gutterTop + 4) + "px";
    });
  }
}

function _initRepositionListeners() {
  window.addEventListener("scroll", _repositionCheckboxes, { passive: true });
  window.addEventListener("resize", _repositionCheckboxes, { passive: true });
}
```

- [ ] **Step 2: Verify file parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/preview-multiselect.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add extension/preview-multiselect.js
git commit -m "feat: add checkbox repositioning on scroll/resize"
```

---

### Task 8: _buildEpubFromPreview in preview-epub-rebuild.js

**Files:**
- Modify: `extension/preview-epub-rebuild.js` (add blobToBase64 + _buildEpubFromPreview)

- [ ] **Step 1: Add blobToBase64 and _buildEpubFromPreview functions**

Append to `extension/preview-epub-rebuild.js`:

```js
function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function () { resolve(reader.result.split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function _buildEpubFromPreview() {
  var contentDiv = document.getElementById("p2k-content");
  if (!contentDiv) throw new Error("No preview content found");

  var clone = contentDiv.cloneNode(true);
  var result = cleanPreviewDomForEpub(clone);
  var rotationMap = result.rotationMap;
  var summary = _previewSummary || "";
  if (result.summaryRemoved) summary = "";

  var article = {
    title: document.getElementById("p2k-title").value.trim() || "Article",
    author: _previewArticle.author || "",
    sitename: _previewArticle.sitename || "",
    pubDate: _previewArticle.pubDate || "",
    readTime: _previewArticle.readTime || 0,
    textContent: _previewArticle.textContent || "",
    content: result.cleanedHtml,
  };

  var imageProcessor = null;
  if (_previewBuildOpts.keepImages) {
    imageProcessor = {
      fetchImageAsBlob: async function (url, opts) {
        var blob = await fetchImageAsBlob(url, opts);
        var rot = rotationMap.get(url);
        if (rot && rot > 0) blob = await rotateImage(blob, rot);
        return blob;
      },
      getImageInfo: getImageInfo,
      shouldSkipImage: shouldSkipImage,
      shouldRotateImage: function () { return false; },
      rotateImage: rotateImage,
      convertFormat: convertFormat,
      deliveryOptimize: deliveryOptimize,
    };
  }

  var blob = await generateEpub({
    article: article,
    url: _url,
    title: article.title,
    summary: summary,
    keepImages: _previewBuildOpts.keepImages,
    keepLinks: _previewBuildOpts.keepLinks,
    rotateImages: false,
    deliveryMode: _previewBuildOpts.deliveryMode,
    imageProcessor: imageProcessor,
  });

  return blob;
}
```

Note: `_url`, `_previewArticle`, `_previewSummary`, and `_previewBuildOpts` are global variables set in `preview.js` during `init()`. `fetchImageAsBlob`, `rotateImage`, `getImageInfo`, `shouldSkipImage`, `convertFormat`, `deliveryOptimize` are from `image-processor.js`. `generateEpub` is from `epub-generator.js`. `JSZip` is from `lib/jszip.min.js`. All loaded via `<script>` tags in `preview.html`.

- [ ] **Step 2: Verify file parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/preview-epub-rebuild.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Run existing test to ensure no regression**

Run: `node tests/test_preview_epub_rebuild.js`
Expected: PASS — all 14 tests still pass (cleanPreviewDomForEpub unchanged)

- [ ] **Step 4: Commit**

```bash
git add extension/preview-epub-rebuild.js
git commit -m "feat: add _buildEpubFromPreview with imageProcessor rotation wrapper"
```

---

### Task 9: Dirty flag + send flow + wire up in preview.js

**Files:**
- Modify: `extension/preview.js` (globals, init, toggleEdit, _remove, removeBlock, undoRm, sendToKindle, rotate handler)

- [ ] **Step 1: Add _dirty flag and preview state globals**

In `extension/preview.js`, add after the existing globals at the top (after line 4):

```js
var _dirty = false;
var _previewArticle = {};
var _previewSummary = "";
var _previewBuildOpts = { keepImages: true, keepLinks: true, rotateImages: true, deliveryMode: false };
```

- [ ] **Step 2: Store article/buildOpts/summary in init()**

In `extension/preview.js`, inside the `init(data)` function, after the line `_epubBase64 = data.epubBase64 || "";` (line 169), add:

```js
  _previewArticle = data.article || {};
  _previewSummary = data.summary || "";
  _previewBuildOpts = data.buildOpts || { keepImages: true, keepLinks: true, rotateImages: true, deliveryMode: false };
```

- [ ] **Step 3: Set _dirty = true in _remove and removeBlock**

In `extension/preview.js`, modify `_remove` (line 84) and `removeBlock` (line 76):

Old `_remove`:
```js
function _remove(el) {
  if (el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "s", el: el });
  _showUndo();
  msg("Section removed");
}
```

New `_remove`:
```js
function _remove(el) {
  if (el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "s", el: el });
  _dirty = true;
  _showUndo();
  msg("Section removed");
}
```

Old `removeBlock`:
```js
function removeBlock(el) {
  if (!el || el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "b", el: el });
  _showUndo();
  msg("Block removed");
}
```

New `removeBlock`:
```js
function removeBlock(el) {
  if (!el || el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "b", el: el });
  _dirty = true;
  _showUndo();
  msg("Block removed");
}
```

- [ ] **Step 4: Extend undoRm for batch kind + set _dirty**

In `extension/preview.js`, replace `undoRm` (line 92):

Old:
```js
function undoRm() {
  var entry = undoStack.pop();
  if (!entry) return;
  entry.el.classList.remove("p2k-removed");
  if (!undoStack.length) _hideUndo();
  msg("Undone");
}
```

New:
```js
function undoRm() {
  var entry = undoStack.pop();
  if (!entry) return;
  if (entry.kind === "batch") {
    entry.els.forEach(function (el) { el.classList.remove("p2k-removed"); });
  } else {
    entry.el.classList.remove("p2k-removed");
  }
  _dirty = true;
  if (typeof _repositionCheckboxes === "function") _repositionCheckboxes();
  if (!undoStack.length) _hideUndo();
  msg("Undone");
}
```

- [ ] **Step 5: Wire toggleEdit with inject/clear checkboxes**

In `extension/preview.js`, replace `toggleEdit` (line 61):

Old:
```js
function toggleEdit() {
  document.body.classList.toggle("p2k-editing");
  document.getElementById("p2k-edit").classList.toggle("active");
  if (!document.body.classList.contains("p2k-editing") && _selectedBlock) {
    _selectedBlock.classList.remove("p2k-selected");
    _selectedBlock = null;
  }
}
```

New:
```js
function toggleEdit() {
  document.body.classList.toggle("p2k-editing");
  document.getElementById("p2k-edit").classList.toggle("active");
  if (document.body.classList.contains("p2k-editing")) {
    var contentDiv = document.getElementById("p2k-content");
    if (contentDiv) injectCheckboxes(contentDiv);
  } else {
    _clearCheckboxes();
    if (_selectedBlock) {
      _selectedBlock.classList.remove("p2k-selected");
      _selectedBlock = null;
    }
  }
}
```

- [ ] **Step 6: Add delete button to toolbar in init()**

In `extension/preview.js`, modify the toolbar HTML in `init()` (line 182-187). Replace the toolbar innerHTML:

Old:
```js
  toolbar.innerHTML =
    '<button class="p2k-ghost" id="p2k-edit">✂ Edit</button>' +
    '<input id="p2k-title" class="p2k-title" value="' + escTitle + '">' +
    '<button id="p2k-send">Send to Kindle</button>' +
    '<button class="p2k-ghost" id="p2k-undo" style="display:none">↩ Undo</button>' +
    '<span class="p2k-msg" id="p2k-msg"></span>';
```

New:
```js
  toolbar.innerHTML =
    '<button class="p2k-ghost" id="p2k-edit">✂ Edit</button>' +
    '<input id="p2k-title" class="p2k-title" value="' + escTitle + '">' +
    '<button id="p2k-delete-selected" style="display:none">Delete</button>' +
    '<button id="p2k-send">Send to Kindle</button>' +
    '<button class="p2k-ghost" id="p2k-undo" style="display:none">↩ Undo</button>' +
    '<span class="p2k-msg" id="p2k-msg"></span>';
```

- [ ] **Step 7: Wire delete button + reposition listeners in init()**

In `extension/preview.js`, after the existing event listeners block (after line 257 `document.getElementById("p2k-undo").addEventListener("click", undoRm);`), add:

```js
  document.getElementById("p2k-delete-selected").addEventListener("click", deleteSelected);
  _initRepositionListeners();
```

- [ ] **Step 8: Set _dirty = true in rotate click handler**

In `extension/preview.js`, inside the image rotation handler in `init()` (around line 238-243), add `_dirty = true` after the `_rotateImg` call:

Old:
```js
    rot.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cur = parseInt(wrap.getAttribute("data-rot") || "0");
      _rotateImg(img, cur + 90);
    });
```

New:
```js
    rot.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cur = parseInt(wrap.getAttribute("data-rot") || "0");
      _rotateImg(img, cur + 90);
      _dirty = true;
    });
```

- [ ] **Step 9: Modify sendToKindle for EPUB regeneration**

In `extension/preview.js`, replace `sendToKindle` (line 118-133):

Old:
```js
async function sendToKindle() {
  var title = document.getElementById("p2k-title").value.trim() || "Article";
  var btn = document.querySelector(".p2k-bar button:not(.p2k-ghost)");
  btn.disabled = true;
  btn.textContent = "Sending…";
  msg("Sending to Kindle…");
  try {
    if (!_epubBase64) throw new Error("EPUB data not found. Close and try again from the popup.");
    var filename = (title || "article").replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "article";
    var result = await sendEmailViaBackground(_epubBase64, title, _url, filename + ".epub");
    msg("Sent to Kindle!"); btn.textContent = "✓ Sent";
    recordSend(title, _url, "sent");
  } catch (e) {
    msg("Error: " + e.message); btn.disabled = false; btn.textContent = "Send to Kindle";
  }
}
```

New:
```js
async function sendToKindle() {
  var title = document.getElementById("p2k-title").value.trim() || "Article";
  var btn = document.getElementById("p2k-send");
  btn.disabled = true;
  btn.textContent = "Sending…";
  msg("Sending to Kindle…");
  try {
    var epubBase64 = _epubBase64;
    if (_dirty) {
      btn.textContent = "Building EPUB…";
      msg("Rebuilding EPUB from your edits…");
      try {
        var blob = await _buildEpubFromPreview();
        epubBase64 = await blobToBase64(blob);
      } catch (rebuildErr) {
        console.error("EPUB rebuild failed:", rebuildErr);
        msg("Edits could not be applied — sending original EPUB");
        epubBase64 = _epubBase64;
      }
    }
    if (!epubBase64) throw new Error("EPUB data not found. Close and try again from the popup.");
    btn.textContent = "Sending…";
    msg("Sending to Kindle…");
    var filename = (title || "article").replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "article";
    var result = await sendEmailViaBackground(epubBase64, title, _url, filename + ".epub");
    msg("Sent to Kindle!"); btn.textContent = "✓ Sent";
    recordSend(title, _url, "sent");
  } catch (e) {
    msg("Error: " + e.message); btn.disabled = false; btn.textContent = "Send to Kindle";
  }
}
```

Note: the `btn` selector changed from `document.querySelector(".p2k-bar button:not(.p2k-ghost)")` to `document.getElementById("p2k-send")` because the new `#p2k-delete-selected` button would have matched the old selector.

- [ ] **Step 10: Verify file parses**

Run: `node -e "var fs = require('fs'); new Function(fs.readFileSync('extension/preview.js','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 11: Run all tests to ensure no regression**

Run: `node tests/test_preview_multiselect.js && node tests/test_preview_epub_rebuild.js && node tests/test_generateEpub.js`
Expected: All tests pass

- [ ] **Step 12: Commit**

```bash
git add extension/preview.js
git commit -m "feat: dirty flag, EPUB regeneration at send time, wire multiselect into edit mode"
```

---

### Task 10: Manual testing + final verification

**Files:** None (verification only)

- [ ] **Step 1: Reload the extension**

Go to `chrome://extensions` → refresh Web2Kindle after changing any extension file.

- [ ] **Step 2: Test multi-select UI**

Open a preview tab (send an article to Kindle (Preview)). Then:
- Click ✂ Edit → section checkboxes appear on left, block checkboxes on right
- Check a section → all its blocks check + highlight; section checkbox fully checked (not dim)
- Uncheck one block in a checked section → section checkbox becomes dim (indeterminate)
- Uncheck the last checked block in a section → section unchecks
- Check all blocks individually → section auto-checks (no dim)
- Check 2 sections + 3 blocks → toolbar shows "Delete (5)" → click → all 5 removed
- Click ↩ Undo → all 5 restored in one click
- Toggle edit mode off → checkboxes disappear, selections cleared

- [ ] **Step 3: Test EPUB regeneration — no edits**

Open a preview tab, click "Send to Kindle" immediately (no edits).
Expected: Button shows "Sending…" (not "Building EPUB…") → pre-built EPUB sent.

- [ ] **Step 4: Test EPUB regeneration — with deletions**

Delete a section (✕) + a block (Delete key) → click "Send to Kindle".
Expected: Button shows "Building EPUB…" → sent EPUB on Kindle missing the deleted section and block.

- [ ] **Step 5: Test EPUB regeneration — with batch delete**

Check 2 sections, click "Delete (2)" → "Send to Kindle".
Expected: "Building EPUB…" → sent EPUB missing both sections.

- [ ] **Step 6: Test EPUB regeneration — with manual rotation**

Rotate an image (↻) → "Send to Kindle".
Expected: "Building EPUB…" → sent EPUB has the rotated image.

- [ ] **Step 7: Test EPUB regeneration — undo then send**

Delete a section, undo, send.
Expected: "Building EPUB…" → sent EPUB has the section restored.

- [ ] **Step 8: Run epubcheck on a regenerated EPUB (if Java available)**

After a regeneration send, check the EPUB structure:
Run: `epubcheck tests/output/<test-file>.epub`
Expected: No errors

- [ ] **Step 9: Final commit if any fixes were needed**

If any fixes were made during manual testing:
```bash
git add -A
git commit -m "fix: adjustments from manual testing"
```
