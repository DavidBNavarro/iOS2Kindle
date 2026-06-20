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
        │
        ▼
Single undoStack entry { kind: "batch", els: [...] }
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
  styling. No new elements in the static HTML (toolbar and gutters are
  injected by JS, matching the existing pattern).
- **`extension/preview.js`** — Add checkbox injection, state management,
  bidirectional section↔block sync, batch delete, and repositioning logic.

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
- **Send to Kindle**: batch delete is purely a DOM operation on the
  preview. The EPUB is already generated before preview opens, so
  deletions here do **not** affect what gets sent. This matches the
  existing single-item delete behavior (the preview is a visual aid; the
  EPUB was built upstream in `processor.js`). A note will be shown in the
  spec's "Open question" if this needs revisiting — see below.

## Open question (flagged for user review)

The current architecture generates the EPUB in `processor.js` **before**
opening the preview. All existing edit-mode deletions (single section ✕,
single block Delete) are visual-only — they do **not** modify the EPUB
that gets sent. This means batch delete, like single delete, would not
actually remove content from the delivered file.

This spec preserves that behavior (batch delete is visual-only). If the
intent is for batch delete (and by extension the existing single delete)
to affect the sent EPUB, a separate spec is needed to regenerate the
EPUB from the edited preview DOM at send time. That is out of scope here.

## Testing

- **Manual**: toggle edit mode → section checkboxes appear on left, block
  checkboxes on right, aligned with their elements.
- **Manual**: check a section → all its blocks check + highlight; section
  checkbox is fully checked (not dim).
- **Manual**: uncheck one block in a checked section → section checkbox
  becomes dim (indeterminate).
- **Manual**: uncheck the last checked block in a section → section
  unchecks.
- **Manual**: check all blocks individually → section auto-checks (no
  dim).
- **Manual**: check 2 sections + 3 blocks → toolbar shows "Delete (5)" →
  click → all 5 removed → "↩ Undo" restores all 5 in one click.
- **Manual**: toggle edit mode off → checkboxes disappear, selections
  cleared.
- **Existing tests**: `node tests/test_full_pipeline.js` and
  `node tests/test_generateEpub.js` remain unaffected (preview UI is not
  exercised by these tests).
