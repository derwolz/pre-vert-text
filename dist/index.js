// verticalLayout — cursor-based vertical text layout engine for tategaki.
//
// The vertical counterpart of @chenglou/pretext (which handles horizontal text).
// Same two-phase architecture:
//
//   Phase 1 (prepare): segment text into graphemes via Intl.Segmenter, measure
//     each segment's advance height in the column direction via canvas, cache
//     results in parallel arrays.  Run once per (text, font) pair.
//
//   Phase 2 (layout): pack graphemes into columns using pure arithmetic on
//     cached advance heights.  Cursor-based: layoutNextColumn lays out one
//     column at a time, returning a cursor to resume from.  The caller loops
//     with different maxHeight per call for variable column heights.
//     ~0.001ms per column — cheap enough for 60fps per-frame reflow.
//
// Kinsoku shori (Japanese line-breaking rules) are enforced at column breaks.
//
// API mirror:
//   pretext                          verticalLayout
//   ────────────────────────────     ─────────────────────────────────────
//   prepareWithSegments(text,font)   prepareVertical(text, font)
//   layoutNextLine(prep,cur,maxW)    layoutNextColumn(prep, cur, maxH)
//   layout(prep, maxW, lh)           layoutVertical(prep, maxH, colW)
//   layoutWithLines(prep, maxW, lh)  layoutVerticalWithColumns(prep, maxH, colW)
//   walkLineRanges(prep, maxW, cb)   walkColumnRanges(prep, maxH, cb)
// ── Constants ─────────────────────────────────────────────────────────────────
export const VERT_FONT_SIZE = 14; // px — must match CSS font-size in renderContent
// Kinsoku — characters that may NOT appear at the START of a column.
const KINSOKU_START_CODES = [
    0xFF09, 0x3015, 0xFF3D, 0xFF5D, 0x3009, 0x300B, 0x300D, 0x300F,
    0x3011, 0x3019, 0x3017, 0xFF40, 0x2019, 0x201D, 0x303F, 0x30FB,
    0x3001, 0x3002, 0xFF0C, 0xFF0E, 0xFF01, 0xFF1F, 0xFF1A, 0xFF1B,
    0x2026, 0x2025, 0x3030, 0x30A0, 0xFF1D, 0x30FC, 0x301C, 0xFF5E,
];
const KINSOKU_START = new Set(KINSOKU_START_CODES.map(c => String.fromCodePoint(c)));
// Kinsoku — characters that may NOT appear at the END of a column.
const KINSOKU_END_CODES = [
    0xFF08, 0x3014, 0xFF3B, 0xFF5B, 0x3008, 0x300A, 0x300C, 0x300E,
    0x3010, 0x3018, 0x3016, 0x2018, 0x201C, 0x301D,
];
const KINSOKU_END = new Set(KINSOKU_END_CODES.map(c => String.fromCodePoint(c)));
// ── CJK range check ──────────────────────────────────────────────────────────
function isCJKorFullwidth(grapheme) {
    const cp = grapheme.codePointAt(0);
    if (cp === undefined)
        return false;
    return ((cp >= 0x3000 && cp <= 0x9FFF) ||
        (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFF00 && cp <= 0xFFEF) ||
        (cp >= 0x20000 && cp <= 0x2A6DF) ||
        (cp >= 0x2A700 && cp <= 0x2CEAF) ||
        (cp >= 0x2CEB0 && cp <= 0x2EBEF));
}
// ── Caches ────────────────────────────────────────────────────────────────────
// Layer 1: canvas measurement — keyed by font + grapheme
const _measCache = new Map();
const MEAS_CACHE_MAX = 4000;
// Layer 2: CJK square validation — keyed by font
const _squareCache = new Map();
// Layer 3: full prepared data — keyed by font + text
const _prepCache = new Map();
const PREP_CACHE_MAX = 2000;
// Canvas contexts — keyed by font
const _ctxCache = new Map();
function getCtx(font) {
    if (typeof document === "undefined")
        return null;
    let ctx = _ctxCache.get(font);
    if (ctx)
        return ctx;
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
    if (!ctx)
        return null;
    ctx.font = font;
    _ctxCache.set(font, ctx);
    return ctx;
}
function evictOldest(map, count) {
    let n = 0;
    for (const k of map.keys()) {
        if (n++ >= count)
            break;
        map.delete(k);
    }
}
// ── Measurement helpers ──────────────────────────────────────────────────────
function measureGraphemeWidth(grapheme, font, fontSize) {
    const key = font + "\x00" + grapheme;
    let v = _measCache.get(key);
    if (v !== undefined)
        return v;
    const ctx = getCtx(font);
    if (!ctx) {
        // SSR fallback
        v = grapheme.length * fontSize * 0.55;
    }
    else {
        v = ctx.measureText(grapheme).width;
    }
    if (_measCache.size >= MEAS_CACHE_MAX) {
        evictOldest(_measCache, Math.floor(MEAS_CACHE_MAX * 0.25));
    }
    _measCache.set(key, v);
    return v;
}
function cjkIsSquare(font, fontSize) {
    let valid = _squareCache.get(font);
    if (valid !== undefined)
        return valid;
    const ctx = getCtx(font);
    if (!ctx) {
        _squareCache.set(font, true);
        return true;
    }
    const measured = ctx.measureText("一").width;
    valid = Math.abs(measured - fontSize) / fontSize < 0.15;
    _squareCache.set(font, valid);
    return valid;
}
/** Advance height for one grapheme in the column direction (px). */
function graphemeAdvanceH(grapheme, font, fontSize) {
    if (!grapheme || grapheme === " " || grapheme === "\u3000")
        return fontSize;
    if (isCJKorFullwidth(grapheme) && cjkIsSquare(font, fontSize))
        return fontSize;
    // Latin / halfwidth / mixed: rotated 90°, so advance height = horizontal width.
    return measureGraphemeWidth(grapheme, font, fontSize);
}
// ── Segmenter ─────────────────────────────────────────────────────────────────
let _locale = "ja";
let _segmenter = null;
function getSegmenter(locale) {
    const loc = locale ?? _locale;
    if (!_segmenter || _locale !== loc) {
        _locale = loc;
        _segmenter = new Intl.Segmenter(loc, { granularity: "grapheme" });
    }
    return _segmenter;
}
// ── Phase 1: Prepare ──────────────────────────────────────────────────────────
/**
 * Parse fontSize from a CSS font string (e.g. '14px "Noto Sans JP"' → 14).
 * Falls back to VERT_FONT_SIZE if parsing fails.
 */
function parseFontSize(font) {
    const m = font.match(/(\d+(?:\.\d+)?)\s*px/);
    return m ? parseFloat(m[1]) : VERT_FONT_SIZE;
}
/**
 * Segment and measure text for vertical layout.
 *
 * The result is height-independent: the same PreparedVerticalText can be laid
 * out at any maxHeight via layoutNextColumn.
 *
 * @param text  Plain text (no newlines — caller splits paragraphs before calling)
 * @param font  CSS font string, e.g. '14px "Noto Sans JP", sans-serif'
 */
export function prepareVertical(text, font, options) {
    const cacheKey = font + "\x00" + text;
    const cached = _prepCache.get(cacheKey);
    if (cached)
        return cached;
    const fontSize = parseFontSize(font);
    const segmenter = getSegmenter(options?.locale);
    const entries = [...segmenter.segment(text)];
    const len = entries.length;
    const segments = new Array(len);
    const advanceHeights = new Array(len);
    const canBreakBefore = new Array(len);
    const breakableAdvances = new Array(len);
    for (let i = 0; i < len; i++) {
        const g = entries[i].segment;
        const prev = i > 0 ? entries[i - 1].segment : null;
        segments[i] = g;
        advanceHeights[i] = graphemeAdvanceH(g, font, fontSize);
        breakableAdvances[i] = null; // grapheme-level segmentation — no sub-segment breaking needed
        // Kinsoku: can we break the column before this segment?
        canBreakBefore[i] =
            !KINSOKU_START.has(g) &&
                (prev === null || !KINSOKU_END.has(prev));
    }
    const prepared = {
        segments,
        advanceHeights,
        canBreakBefore,
        breakableAdvances,
        fontSize,
    };
    if (_prepCache.size >= PREP_CACHE_MAX) {
        evictOldest(_prepCache, Math.floor(PREP_CACHE_MAX * 0.25));
    }
    _prepCache.set(cacheKey, prepared);
    return prepared;
}
// ── Phase 2: Layout — core column stepper ─────────────────────────────────────
/** Sentinel cursor: start of text. */
export const CURSOR_START = { segmentIndex: 0, graphemeIndex: 0 };
/**
 * Internal column stepper. Returns a LayoutColumnRange (no text materialization).
 * The caller materializes text only when needed (layoutNextColumn vs layoutNextColumnRange).
 */
function stepColumn(prepared, startCursor, maxHeight) {
    const { advanceHeights, canBreakBefore, breakableAdvances } = prepared;
    const totalSegs = advanceHeights.length;
    let segIdx = startCursor.segmentIndex;
    const gIdx = startCursor.graphemeIndex;
    // Bounds check
    if (segIdx >= totalSegs)
        return null;
    let columnH = 0;
    // Handle sub-segment start (graphemeIndex > 0) — rare, for multi-grapheme clusters
    if (gIdx > 0) {
        const bAdv = breakableAdvances[segIdx];
        if (bAdv !== null) {
            let g = gIdx;
            while (g < bAdv.length) {
                const adv = bAdv[g];
                if (columnH + adv > maxHeight && columnH > 0) {
                    return {
                        height: columnH,
                        start: startCursor,
                        end: { segmentIndex: segIdx, graphemeIndex: g },
                    };
                }
                columnH += adv;
                g++;
            }
        }
        else {
            // Single-grapheme segment but gIdx > 0 shouldn't happen; consume whole segment.
            columnH += advanceHeights[segIdx];
        }
        segIdx++;
    }
    // Main segment loop — forward tracking of last valid break point
    let lastValidBreak = segIdx;
    let lastValidBreakH = columnH;
    for (let i = segIdx; i < totalSegs; i++) {
        const adv = advanceHeights[i];
        if (columnH + adv > maxHeight) {
            // Overflow — need a column break.
            if (canBreakBefore[i]) {
                // Can break right here.
                return {
                    height: columnH,
                    start: startCursor,
                    end: { segmentIndex: i, graphemeIndex: 0 },
                };
            }
            // Kinsoku violation — use last tracked valid break.
            if (lastValidBreak > startCursor.segmentIndex ||
                (lastValidBreak === startCursor.segmentIndex && startCursor.graphemeIndex === 0 && lastValidBreakH > 0)) {
                return {
                    height: lastValidBreakH,
                    start: startCursor,
                    end: { segmentIndex: lastValidBreak, graphemeIndex: 0 },
                };
            }
            // No valid break found — force break after at least one segment.
            const forcedEnd = Math.max(startCursor.segmentIndex + 1, i);
            let forcedH = 0;
            const fStart = startCursor.graphemeIndex > 0 ? startCursor.segmentIndex + 1 : startCursor.segmentIndex;
            for (let j = fStart; j < forcedEnd; j++)
                forcedH += advanceHeights[j];
            return {
                height: forcedH,
                start: startCursor,
                end: { segmentIndex: forcedEnd, graphemeIndex: 0 },
            };
        }
        // Track valid break points (only after consuming at least one segment from start).
        if (canBreakBefore[i] && (i > startCursor.segmentIndex ||
            (i === startCursor.segmentIndex && startCursor.graphemeIndex === 0 && columnH > 0))) {
            lastValidBreak = i;
            lastValidBreakH = columnH;
        }
        columnH += adv;
    }
    // All segments consumed — final column.
    return {
        height: columnH,
        start: startCursor,
        end: { segmentIndex: totalSegs, graphemeIndex: 0 },
    };
}
/** Materialize text from a column range. */
function materializeText(prepared, range) {
    const { segments, breakableAdvances } = prepared;
    const { start, end } = range;
    let text = "";
    for (let i = start.segmentIndex; i < end.segmentIndex; i++) {
        if (i === start.segmentIndex && start.graphemeIndex > 0) {
            // Partial first segment — need grapheme-level slicing.
            const bAdv = breakableAdvances[i];
            if (bAdv !== null) {
                // Reconstruct from graphemes (we only have advance data, not grapheme strings).
                // Fall back to character slicing — grapheme clusters in Japanese are almost
                // always single characters, so this is safe.
                text += segments[i].slice(start.graphemeIndex);
            }
            else {
                text += segments[i];
            }
        }
        else if (i === end.segmentIndex - 1 && end.graphemeIndex > 0 && end.segmentIndex <= i) {
            // Partial last segment (only if end is mid-segment — i.e., end.segmentIndex === i).
            text += segments[i].slice(0, end.graphemeIndex);
        }
        else {
            text += segments[i];
        }
    }
    // Handle case where start and end are in the same segment with grapheme offsets.
    // This is covered by the loop above since end.segmentIndex > start.segmentIndex
    // unless the column spans exactly one partial segment.
    if (end.segmentIndex === start.segmentIndex && end.graphemeIndex > start.graphemeIndex) {
        text = segments[start.segmentIndex].slice(start.graphemeIndex, end.graphemeIndex);
    }
    return text;
}
// ── Phase 2: Public layout functions ──────────────────────────────────────────
/**
 * Lay out exactly one column of text starting at `cursor`.
 * Returns null if all text has been consumed.
 *
 * Variable column heights: call in a loop with different maxHeight per call.
 *
 *   let cursor = CURSOR_START;
 *   const col1 = layoutNextColumn(prepared, cursor, capH - fontSize); // indent
 *   if (col1) cursor = col1.end;
 *   const col2 = layoutNextColumn(prepared, cursor, capH);            // full
 */
export function layoutNextColumn(prepared, cursor, maxHeight) {
    const range = stepColumn(prepared, cursor, maxHeight);
    if (range === null)
        return null;
    return {
        text: materializeText(prepared, range),
        height: range.height,
        start: range.start,
        end: range.end,
    };
}
/**
 * Non-materializing variant — returns range + height, no text string.
 * Use when only cursor positions and heights matter (column counting, budget tracking).
 */
export function layoutNextColumnRange(prepared, cursor, maxHeight) {
    return stepColumn(prepared, cursor, maxHeight);
}
/**
 * Count columns and compute total width.  Fast batch — does not materialize text.
 *
 * @param maxHeight   Column height (px)
 * @param columnWidth Column width (px) — the horizontal extent of one column (= CSS line-height)
 */
export function layoutVertical(prepared, maxHeight, columnWidth) {
    let count = 0;
    let cursor = CURSOR_START;
    while (true) {
        const range = stepColumn(prepared, cursor, maxHeight);
        if (range === null)
            break;
        count++;
        cursor = range.end;
    }
    return { columnCount: count, width: count * columnWidth };
}
/**
 * Batch layout with materialized columns.
 */
export function layoutVerticalWithColumns(prepared, maxHeight, columnWidth) {
    const columns = [];
    let cursor = CURSOR_START;
    while (true) {
        const range = stepColumn(prepared, cursor, maxHeight);
        if (range === null)
            break;
        columns.push({
            text: materializeText(prepared, range),
            height: range.height,
            start: range.start,
            end: range.end,
        });
        cursor = range.end;
    }
    const count = columns.length;
    return { columns, columnCount: count, width: count * columnWidth };
}
/**
 * Non-materializing batch callback.  Calls onColumn for each column.
 * Returns column count.
 */
export function walkColumnRanges(prepared, maxHeight, onColumn) {
    let count = 0;
    let cursor = CURSOR_START;
    while (true) {
        const range = stepColumn(prepared, cursor, maxHeight);
        if (range === null)
            break;
        onColumn(range);
        count++;
        cursor = range.end;
    }
    return count;
}
// ── Configuration ─────────────────────────────────────────────────────────────
/**
 * Set the locale for Intl.Segmenter.  Clears all caches.
 */
export function setVerticalLocale(locale) {
    _locale = locale ?? "ja";
    _segmenter = null;
    clearVerticalLayoutCaches();
}
/**
 * Clear all measurement and prepare caches.  Call when font changes.
 */
export function clearVerticalLayoutCaches() {
    _measCache.clear();
    _squareCache.clear();
    _prepCache.clear();
    _ctxCache.clear();
}
//# sourceMappingURL=index.js.map