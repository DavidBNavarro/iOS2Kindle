# Preview Multi-Select Batch Delete

## Goal

Add multi-select checkboxes to the preview tab's edit mode so users can check
multiple sections and/or blocks, then delete them in a single batch action.
Section checkboxes appear in a left column; block checkboxes in a right column.
Checking an item highlights it in the article text.

## Context

The preview tab (`extension/preview.html` + `extension/preview.js`) already
supports an edit mode (toggled by the ✂ Edit button) where users can:

- Click a section's ✕ button to remove that section (`.p2k-section`)
- Click an individual block (p, img, h2, h3, h4, blockquote, ul, ol, pre,
  table, li, figure, .imgwrap) to select it, then press Delete/Backspace to
  remove it
- Undo the last removal via ↩ Undo

This spec adds **batch** selection and deletion on top of the existing
single-item interactions, which remain unchanged.

## Architecture

```
Edit mode toggled ON
        │
        ▼
preview.js injects two checkbox columns:
  • Left gutter  → one checkbox per .p2k-section
  • Right gutter → one checkbox per block (BLOCK_SEL)
        │
        ▼
State map: _checkboxState = Map<itemId, boolean>
        │
        ▼
User toggles a checkbox
        │
        ├── Section checkbox ──► set all child blocks to same value
        │                         recompute section's own state if needed
        │
        └── Block checkbox ────► recompute parent section state:
                                   all checked   → section checked
                                   none checked  → section unchecked
                                   some checked  → section indeterminate (dim)
        │
        ▼
Checked items get .p2k-selected highlight (existing class)
        │
        ▼
"Delete (N)" button appears in toolbar when ≥1 item checked
        │
        ▼
Click → remove all checked sections + blocks in one undoable batch
        │                                 sets _dirty = true
        ▼
Single undoStack entry { kind: "batch", els: [...] }


User clicks "Send to Kindle"
        │
        ▼
_dirty flag set?  (any deletion or manual rotation occurred)
        │
        ├── No  ──► send pre-built _epubBase64 (instant, same as today)
        │
        └── Yes ──► _buildEpubFromPreview():
                     │  1. Clone #p2k-content DOM
                     │  2. Remove .p2k-removed elements
                     │  3. Strip preview-only UI (.p2k-rm, .p2k-rot, checkboxes)
                     │  4. Unwrap .p2k-section, .imgwrap
                     │  5. Read data-rot per image → rotation map
                     │  6. Strip preview-only inline styles
                     │  7. article.content = cleaned HTML
                     │  8. generateEpub(stored article + opts + imageProcessor wrapper)
                     │  9. Send regenerated EPUB
                     ▼
              Gmail API send
```

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Toolbar: [✂ Edit] [title input] [Delete (3)] [Send] [↩ Undo] [msg] │
├─────┬─────────────────────────────────────────────────────────┬─────┤
│     │  Article H1                                             │     │
│     │  Meta line                                              │     │
│     │                                                         │     │
│ ☐   │ ┌── .p2k-section ──────────────────────────────────┐   │     │
│     │ │ <h2>Heading</h2>                                  │   │ ☐   │
│     │ │ <p>Paragraph one…</p>                              │   │ ☐   │
│     │ │ <img>                                              │   │ ☐   │
│     │ │ <p>Paragraph two…</p>                              │   │ ☐   │
│     │ └────────────────────────────────────────────────────┘   │     │
│ ☐   │ ┌── .p2k-section ──────────────────────────────────┐   │     │
│     │ │ <h2>Another heading</h2>                          │   │     │
│     │ │ <p>More text…</p>                                  │   │ ☐   │
│     │ └────────────────────────────────────────────────────┘   │     │
└─────┴─────────────────────────────────────────────────────────┴─────┘
  ▲                                                         ▲
  left gutter (section checkboxes)            right gutter (block checkboxes)
```

Left and right gutters are `position: fixed` vertical strips shown only when
`body.p2k-editing` is active. Each checkbox is positioned to align vertically
with its corresponding DOM element via a `data-item-id` attribute and a
`requestAnimationFrame` repositioning pass on scroll/resize/edit toggle.

## Files

### Modified files

- **`extension/preview.html`** — Add CSS for checkbox gutters, checkbox
  styling, indeterminate (dim) state, and the toolbar "Delete (N)" button
  styling. Add `<script>` tags for `lib/jszip.min.js` and
  `epub-generator.js` (needed for EPUB regeneration at send time).
  `image-processor.js` is already loaded.
- **`extension/preview.js`** — Add checkbox injection, state management,
  bidirectional section↔block sync, batch delete, repositioning logic,
  and EPUB regeneration at send time (`_dirty` flag, `_buildEpubFromPreview`).
- **`extension/processor.js`** — Extend `preview_data` stored in
  `chrome.storage.local` to include the `article` metadata object and the
  build options (`keepImages`, `keepLinks`, `rotateImages`, `deliveryMode`)
  so preview.js can regenerate the EPUB with the same settings.

No new files.

## State management

### IDs

Each selectable element gets a stable id assigned at injection time:

- Sections: `sec-{index}` (index in document order)
- Blocks: `blk-{index}` (index in document order within its section)

IDs are stored as `data-p2k-id` attributes on the element and on its
corresponding checkbox.

### State map

```js
var _checkboxState = new Map();  // id → boolean (checked?)
var _sectionBlocks = new Map();  // sectionId → [blockId, ...]
var _blockSection  = new Map();  // blockId → sectionId
```

### Sync rules

| Action | Effect |
|---|---|
| Check section | Set all child blocks to checked; section fully checked |
| Uncheck section | Set all child blocks to unchecked; section unchecked |
| Check a block | If now all sibling blocks checked → section checked. Else → section indeterminate |
| Uncheck a block | If now no sibling blocks checked → section unchecked. Else → section indeterminate |
| Check last unchecked block in a checked-but-indeterminate section | Section becomes fully checked (no longer dim) |

### Indeterminate ("dim") visual state

A section checkbox whose blocks are partially checked gets:

- `data-indeterminate="true"` attribute on the checkbox `<input>`
- CSS: `opacity: 0.5` on the checkbox
- The native `input.indeterminate = true` property set for the dash glyph

When the section becomes fully checked or fully unchecked, the attribute is
removed and opacity returns to 1.

## Highlight behavior

When a checkbox (section or block) is checked, its target element receives
the existing `.p2k-selected` class (orange outline + tinted background). When
unchecked, the class is removed.

If a section is checked, all its child blocks are also visually highlighted
(since they are checked too, per the sync rules). No special "section-level
highlight" is needed beyond the existing per-element highlight.

## Batch delete

### Toolbar button

A new button `#p2k-delete-selected` is injected into the toolbar, hidden by
default. Whenever `_checkboxState` has any `true` value, the button is shown
with its label updated to `Delete (N)` where N is the count of checked items.
When no items are checked, the button is hidden.

### Delete action

`deleteSelected()`:

1. Collect all checked sections and checked blocks (excluding blocks whose
   parent section is also checked — those are removed with the section).
2. Mark each collected element with `.p2k-removed` (existing class).
3. Push a single `undoStack` entry: `{ kind: "batch", els: [el, ...] }`.
4. Uncheck all checkboxes, clear `_checkboxState`.
5. Hide the batch delete button.
6. Show `_showUndo()`, `msg("Removed N items")`.

### Undo

`undoRm()` is extended to handle `kind: "batch"`: iterate `entry.els` and
remove `.p2k-removed` from each. The existing single-section (`kind: "s"`)
and single-block (`kind: "b"`) cases remain unchanged.

### Interaction with existing single-item delete

The existing single-item delete paths (✕ button on a section, Delete
keypress on a selected block) are unchanged. They push their own
`undoStack` entries. A batch undo restores only the batch's elements;
single-item undos restore only that item. Order is LIFO as today.

## Repositioning

Checkbox gutters are `position: fixed`. Each checkbox's `top` is synced to
its target element's `getBoundingClientRect().top + scrollY` minus the
gutter's offset. Repositioning runs:

- On edit-mode toggle (after injection)
- On `scroll` (passive listener, rAF-throttled)
- On `resize` (rAF-throttled)
- After any DOM mutation that changes element positions (batch delete,
  undo) — call `_repositionCheckboxes()` once at the end of those actions.

## CSS additions (preview.html)

```css
/* Left gutter — section checkboxes */
.p2k-gutter-left, .p2k-gutter-right {
  position: fixed; top: 40px; bottom: 0; width: 28px;
  display: none; z-index: 9998; pointer-events: none;
}
.p2k-gutter-left  { left: 0; }
.p2k-gutter-right { right: 0; }
body.p2k-editing .p2k-gutter-left,
body.p2k-editing .p2k-gutter-right { display: block; }

.p2k-cb {
  position: absolute; left: 6px; width: 16px; height: 16px;
  pointer-events: auto; cursor: pointer; margin: 4px 0;
  accent-color: #ff9900;
}
.p2k-gutter-right .p2k-cb { left: auto; right: 6px; }
.p2k-cb[data-indeterminate="true"] { opacity: 0.5; }

/* Toolbar batch-delete button (reuses .p2k-bar button styles) */
.p2k-bar button#p2k-delete-selected {
  background: #dc2626; color: #fff;
}
.p2k-bar button#p2k-delete-selected:hover { background: #b91c1c; }

/* When editing, pad content so it doesn't slide under gutters */
body.p2k-editing #p2k-content { padding-left: 32px; padding-right: 32px; }
```

## Edge cases

- **Block inside a removed section**: if a section is already
  `.p2k-removed`, its block checkboxes are disabled and not counted.
- **Empty section**: a `.p2k-section` with no matching blocks (e.g., a
  heading-only section) still gets a section checkbox but no block
  checkboxes inside it. Checking it just highlights/removes the section.
- **Summary section** (`.p2k-section-summary`): treated as a regular
  section — gets a section checkbox on the left and block checkboxes for
  its `<h2>TL;DR</h2>` and `<p>` on the right.
- **Toggling edit mode off**: all checkboxes are cleared and removed from
  the DOM; `_checkboxState` is cleared; the batch-delete button is hidden.
  Existing `_selectedBlock` (single-click selection) is also cleared as
  today.
- **Toggling edit mode back on**: checkboxes are re-injected fresh. No
  prior selection state is restored (matches today's behavior for
  `_selectedBlock`).

## EPUB regeneration at send time

### Problem

The current architecture generates the EPUB in `processor.js` **before**
opening the preview. The preview's edit-mode deletions (single section ✕,
single block Delete) are visual-only — they do not modify the EPUB that
gets sent. The user wants all edits (deletions and manual rotations) to
affect the delivered file.

### Approach: dirty flag + regenerate on demand

A `_dirty` flag tracks whether any edit occurred. At send time:

- **`_dirty = false`** (no edits) → send the pre-built `_epubBase64`
  instantly. Identical to today's behavior.
- **`_dirty = true`** (any deletion or manual rotation) → regenerate the
  EPUB from the current preview DOM, then send.

This preserves instant send for users who don't edit, and only pays the
regeneration cost when edits exist.

### What sets `_dirty = true`

| Trigger | Where |
|---|---|
| Single section remove (✕ button) | `_remove()` |
| Single block remove (Delete key) | `removeBlock()` |
| Batch delete | `deleteSelected()` |
| Undo | `undoRm()` (any kind) |
| Manual image rotation (↻ button click) | rotate click handler |

Auto-rotation during `init()` (wide images rotated for display) does
**not** set `_dirty` — the pre-built EPUB already applied the same
auto-rotation (same thresholds: `_shouldAutoRotate` and
`shouldRotateImage` are equivalent), so no regeneration is needed.

### `processor.js` changes

Extend `preview_data` in `handlePreview()` to include:

```js
preview_data: {
  // ...existing fields...
  article: {
    author: article.author,
    sitename: article.sitename,
    pubDate: article.pubDate,
    readTime: article.readTime,
    textContent: article.textContent,
  },
  buildOpts: {
    keepImages: keepImages,
    keepLinks: keepLinks,
    rotateImages: true,   // matches buildEpub default
    deliveryMode: deliveryMode,
  },
}
```

`article.content` is not stored here — it is rebuilt from the preview DOM
at send time. The existing `content` field in `preview_data` remains for
the initial preview render.

### `_buildEpubFromPreview()` (in preview.js)

1. **Clone** `#p2k-content` into a detached fragment.
2. **Remove** all `.p2k-removed` elements (deleted sections + blocks).
3. **Remove** the summary section (`.p2k-section-summary`) — the summary
   is re-added by `generateEpub` from the stored `summary` string. If the
   summary section was `.p2k-removed` (user deleted it), set `summary = ""`
   before calling `generateEpub` so the deletion is respected.
4. **Strip preview-only UI**: `.p2k-rm`, `.p2k-rot` elements; any checkbox
   or gutter elements that may have been injected into content.
5. **Build rotation map**: for each `.imgwrap`, read `data-rot` degrees
   and map `img.src → degrees`. Unwrap each `.imgwrap` (replace with its
   child `<img>`).
6. **Strip preview-only inline styles** from images (the CSS transform,
   width, height, margin, object-fit, max-width set by `_rotateImg`).
7. **Unwrap** all `.p2k-section` divs (replace with children).
8. **Strip** `data-p2k-id`, `data-rot`, and other preview-only attributes.
9. **Serialize** the cleaned fragment to HTML string → set as
   `article.content`.
10. **Build imageProcessor wrapper** that applies manual rotation:
    ```js
    var _previewImageProcessor = {
      fetchImageAsBlob: async function(url, opts) {
        var blob = await fetchImageAsBlob(url, opts);
        var rot = _rotationMap.get(url);
        if (rot && rot > 0) blob = await rotateImage(blob, rot);
        return blob;
      },
      getImageInfo: getImageInfo,
      shouldSkipImage: shouldSkipImage,
      shouldRotateImage: function() { return false; }, // disabled — rotation handled in fetch
      rotateImage: rotateImage,
      convertFormat: convertFormat,
      deliveryOptimize: deliveryOptimize,
    };
    ```
    Manual rotation is applied in `fetchImageAsBlob` (before dimension
    checks), and `shouldRotateImage` is disabled to avoid double-rotation.
    This ensures the regenerated EPUB matches what the preview displays.
11. **Call** `generateEpub({ article, url, title, summary, keepImages,
    keepLinks, rotateImages: false, deliveryMode, imageProcessor })`.
    `rotateImages: false` because rotation is already handled by the
    wrapper.
12. **Return** the EPUB blob → `blobToBase64` → send via Gmail.

### `sendToKindle()` changes

```js
async function sendToKindle() {
  var title = document.getElementById("p2k-title").value.trim() || "Article";
  var btn = ...;
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    var epubBase64 = _epubBase64;
    if (_dirty) {
      btn.textContent = "Building EPUB…";
      msg("Rebuilding EPUB from your edits…");
      var blob = await _buildEpubFromPreview();
      epubBase64 = await blobToBase64(blob);
    }
    msg("Sending to Kindle…");
    var result = await sendEmailViaBackground(epubBase64, title, _url, filename);
    ...
  }
}
```

### Error handling

If `_buildEpubFromPreview()` throws (e.g., image fetch fails, JSZip
error), fall back to sending the pre-built `_epubBase64` with a warning
message: `"Edits could not be applied — sending original EPUB"`. This
ensures the user still gets the article, just without their edits. The
error is logged to console.

## Edge cases (EPUB regeneration)

- **No edits, images present**: `_dirty = false`, pre-built EPUB sent
  (already has auto-rotated images from processor.js). No regeneration.
- **Edits, no images** (`keepImages = false`): regeneration is fast
  (text-only EPUB, no image fetching). Effectively instant.
- **Edits, images present**: regeneration re-fetches all visible images.
  Slower (2-10s for image-heavy articles). Button shows "Building EPUB…"
  during this phase.
- **Image fetch fails during regeneration**: the image is skipped by
  `generateEpub` (existing behavior — failed fetches `continue` in the
  image loop). The EPUB is still generated without that image.
- **All images deleted**: regeneration with `keepImages` effectively
  produces a text-only EPUB (no `<img>` elements in cleaned content).
- **Summary section**: removed from cleaned content (step 3 above); the
  stored `summary` string is passed to `generateEpub`, which re-adds it
  as `.p2k-summary` in the EPUB. If the user deleted the summary section
  in the preview, the cleaned content won't have it, but `generateEpub`
  will re-add it from the `summary` param. To respect the deletion, if
  the summary section is `.p2k-removed`, set `summary = ""` before
  calling `generateEpub`.

## Testing

### Multi-select (manual)

- Toggle edit mode → section checkboxes appear on left, block
  checkboxes on right, aligned with their elements.
- Check a section → all its blocks check + highlight; section
  checkbox is fully checked (not dim).
- Uncheck one block in a checked section → section checkbox
  becomes dim (indeterminate).
- Uncheck the last checked block in a section → section
  unchecks.
- Check all blocks individually → section auto-checks (no
  dim).
- Check 2 sections + 3 blocks → toolbar shows "Delete (5)" →
  click → all 5 removed → "↩ Undo" restores all 5 in one click.
- Toggle edit mode off → checkboxes disappear, selections
  cleared.

### EPUB regeneration (manual)

- **No edits**: open preview, click "Send to Kindle" immediately →
  button shows "Sending…" (not "Building EPUB…") → pre-built EPUB
  sent. Confirms `_dirty = false` path.
- **With deletions**: delete a section (✕) + a block (Delete key) →
  click "Send to Kindle" → button shows "Building EPUB…" → sent EPUB
  on Kindle should be missing the deleted section and block.
- **With batch delete**: check 2 sections, click "Delete (2)" →
  "Send to Kindle" → "Building EPUB…" → sent EPUB missing both
  sections.
- **With manual rotation**: rotate an image (↻) → "Send to Kindle" →
  "Building EPUB…" → sent EPUB has the rotated image.
- **Undo then send**: delete a section, undo, send → button shows
  "Building EPUB…" (because `_dirty` is true even after undo) → sent
  EPUB has the section restored (undo removed `.p2k-removed`).

### Existing tests

`node tests/test_full_pipeline.js` and
`node tests/test_generateEpub.js` remain unaffected (preview UI and
processor.js's `preview_data` extension don't change EPUB structure for
non-preview paths).
