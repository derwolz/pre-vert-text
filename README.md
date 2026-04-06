# pre-vert-text

Cursor-based vertical text layout engine for Japanese tategaki (縦書き) — the vertical counterpart of [@chenglou/pretext](https://github.com/chenglou/pretext).

**pretext** solved horizontal text layout with a two-phase architecture: measure once via canvas, then lay out with pure arithmetic at any width. **pre-vert-text** applies the same architecture to vertical text, where characters flow top-to-bottom in columns that flow right-to-left.

## Features

- **Two-phase design** — expensive measurement runs once; layout is pure arithmetic (~0.001ms per column)
- **Cursor-based** — `layoutNextColumn` lays out one column at a time, returning a cursor to resume from. Call it in a loop with different `maxHeight` per call for variable column heights
- **Kinsoku shori** — Japanese line-breaking rules enforced at column breaks (30 start-prohibited + 14 end-prohibited characters)
- **Font-parameterized** — accepts any CSS font string, not hardcoded to one font
- **CJK + Latin mixed text** — CJK fullwidth characters use fontSize advance, Latin characters use canvas-measured width (rotated 90deg)
- **Zero dependencies** — no runtime deps, works in any browser with `Intl.Segmenter` support
- **Render-agnostic** — returns data (text + cursor positions), never touches the DOM

## Install

```bash
npm install pre-vert-text
```

Or use the standalone ES module directly:

```html
<script type="module">
  import { prepareVertical, layoutNextColumn, CURSOR_START } from "./dist/index.js";
</script>
```

## Quick Start

```js
import { prepareVertical, layoutNextColumn, CURSOR_START } from "pre-vert-text";

const font = '14px "Noto Sans JP", sans-serif';
const text = "日本語のテキストレイアウトエンジン";

// Phase 1: Prepare (run once per text+font — cached internally)
const prepared = prepareVertical(text, font);

// Phase 2: Layout (run on every resize/reflow — pure arithmetic)
let cursor = CURSOR_START;
const columns = [];

while (true) {
  const col = layoutNextColumn(prepared, cursor, 400); // 400px column height
  if (!col) break;
  columns.push(col);
  cursor = col.end;
}

// columns[0].text = "日本語のテキス"
// columns[0].height = 392  (px consumed)
// columns[0].end = { segmentIndex: 7, graphemeIndex: 0 }
```

### Variable column heights (e.g., reflowing around an image)

```js
let cursor = CURSOR_START;

// First column: shorter (image takes 100px at top)
const col1 = layoutNextColumn(prepared, cursor, 300);
cursor = col1.end;

// Second column: full height
const col2 = layoutNextColumn(prepared, cursor, 400);
cursor = col2.end;

// Third column: shorter again (different obstacle)
const col3 = layoutNextColumn(prepared, cursor, 250);
```

This is the core capability that enables per-frame animated image reflow — impossible with a fixed-height-only API.

## API Reference

### Phase 1: Prepare

#### `prepareVertical(text, font, options?)`

Segment and measure text for vertical layout. Results are cached internally — calling with the same `(text, font)` pair returns the cached result instantly.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Plain text (no newlines — caller splits paragraphs) |
| `font` | `string` | CSS font string, e.g. `'14px "Noto Sans JP", sans-serif'` |
| `options.locale` | `string?` | BCP-47 locale for `Intl.Segmenter` (default: `"ja"`) |

Returns: `PreparedVerticalText` — opaque handle for layout functions.

### Phase 2: Layout

#### `layoutNextColumn(prepared, cursor, maxHeight)`

Lay out exactly one column of text. **The core primitive.**

| Parameter | Type | Description |
|-----------|------|-------------|
| `prepared` | `PreparedVerticalText` | Output of `prepareVertical()` |
| `cursor` | `VerticalCursor` | Start position (use `CURSOR_START` for beginning) |
| `maxHeight` | `number` | Available column height in px |

Returns: `LayoutColumn | null` — `null` if all text consumed.

```ts
interface LayoutColumn {
  text: string;           // Column text content
  height: number;         // Advance height consumed (px)
  start: VerticalCursor;  // Inclusive start position
  end: VerticalCursor;    // Exclusive end — feed into next call
}
```

#### `layoutNextColumnRange(prepared, cursor, maxHeight)`

Same as `layoutNextColumn` but without text materialization — returns height and cursors only. Use when you only need column counts or budget tracking.

Returns: `LayoutColumnRange | null`

#### `layoutVertical(prepared, maxHeight, columnWidth)`

Fast batch column count. Does not materialize text.

Returns: `{ columnCount: number, width: number }`

#### `layoutVerticalWithColumns(prepared, maxHeight, columnWidth)`

Batch layout with materialized columns.

Returns: `{ columns: LayoutColumn[], columnCount: number, width: number }`

#### `walkColumnRanges(prepared, maxHeight, onColumn)`

Non-materializing callback batch. Calls `onColumn(range)` for each column.

Returns: `number` (column count)

### Configuration

#### `setVerticalLocale(locale?)`

Set the locale for `Intl.Segmenter`. Clears all caches.

#### `clearVerticalLayoutCaches()`

Clear all measurement and prepare caches. Call when the font changes.

### Constants

#### `CURSOR_START`

`{ segmentIndex: 0, graphemeIndex: 0 }` — starting cursor for layout.

#### `VERT_FONT_SIZE`

`14` — default font size constant (px).

## Architecture

```
Phase 1: PREPARE (expensive, cached, run once)
  text + font
    → Intl.Segmenter (grapheme segmentation)
    → canvas.measureText (advance height per grapheme)
    → kinsoku classification (canBreakBefore[])
    → PreparedVerticalText (parallel arrays: segments[], advanceHeights[], canBreakBefore[])

Phase 2: LAYOUT (pure arithmetic, run every frame)
  PreparedVerticalText + cursor + maxHeight
    → walk advanceHeights[], accumulate until overflow
    → backtrack to last valid kinsoku break point (forward-tracked, O(1))
    → return LayoutColumn { text, height, start, end }
    → caller feeds end cursor into next call with new maxHeight
```

### How it differs from pretext

| | pretext (horizontal) | pre-vert-text (vertical) |
|---|---|---|
| Primary dimension | Width (maxWidth) | Height (maxHeight) |
| Segment granularity | Word-level + CJK grapheme | Grapheme-level throughout |
| Break rules | CSS white-space + overflow-wrap | Kinsoku shori (JIS X 4051) |
| Whitespace | Complex collapsing, trailing hang | Simple (spaces are content) |
| Bidi | Full Unicode Bidi Algorithm | Not needed (top-to-bottom) |
| Segment kinds | 8 (text, space, tab, soft-hyphen...) | 2 (text, space) |

The vertical domain is simpler — no bidi, no whitespace collapsing, no soft hyphens. This means pre-vert-text is ~500 lines vs pretext's ~1300.

## Demos

Two interactive demos are included in `demos/`:

### Fluid Smoke (`demos/fluid-smoke.html`)

Sideways smoke simulation using CJK characters rendered in vertical columns. Port of pretext's [fluid-smoke demo](https://somnai-dreams.github.io/pretext-demos/fluid-smoke.html).

### Editorial Engine (`demos/editorial-engine.html`)

Draggable orbs with real-time tategaki text reflow at 60fps. Port of pretext's [editorial-engine demo](https://somnai-dreams.github.io/pretext-demos/the-editorial-engine.html). Text flows around circular obstacles using `layoutNextColumn` with variable heights carved by the orb positions.

To run the demos:

```bash
# From the repo root:
python -m http.server 9090
# Open http://localhost:9090/demos/fluid-smoke.html
# Open http://localhost:9090/demos/editorial-engine.html
```

## Browser Support

Requires `Intl.Segmenter` — supported in Chrome 87+, Edge 87+, Safari 15.4+, Firefox 125+.

## License

MIT
