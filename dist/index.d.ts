/** Opaque prepared data.  Pass to layout functions without inspecting internals. */
export interface PreparedVerticalText {
    /** Advance height in the column direction (px) per segment. */
    readonly advanceHeights: number[];
    /** Whether a column break is permitted before this segment (kinsoku). */
    readonly canBreakBefore: boolean[];
    /** Sub-segment grapheme advances for multi-grapheme clusters (rare). null for single-grapheme segments. */
    readonly breakableAdvances: (number[] | null)[];
    /** Segment text strings aligned with the parallel arrays. */
    readonly segments: string[];
    /** Font size used during preparation. */
    readonly fontSize: number;
}
/** Resumable position within PreparedVerticalText. */
export interface VerticalCursor {
    readonly segmentIndex: number;
    readonly graphemeIndex: number;
}
/** One laid-out column with materialized text. */
export interface LayoutColumn {
    readonly text: string;
    readonly height: number;
    readonly start: VerticalCursor;
    readonly end: VerticalCursor;
}
/** Column range without materialized text (lighter). */
export interface LayoutColumnRange {
    readonly height: number;
    readonly start: VerticalCursor;
    readonly end: VerticalCursor;
}
export interface LayoutVerticalResult {
    readonly columnCount: number;
    readonly width: number;
}
export interface LayoutVerticalWithColumnsResult extends LayoutVerticalResult {
    readonly columns: LayoutColumn[];
}
export interface PrepareVerticalOptions {
    locale?: string;
}
export declare const VERT_FONT_SIZE = 14;
/**
 * Segment and measure text for vertical layout.
 *
 * The result is height-independent: the same PreparedVerticalText can be laid
 * out at any maxHeight via layoutNextColumn.
 *
 * @param text  Plain text (no newlines — caller splits paragraphs before calling)
 * @param font  CSS font string, e.g. '14px "Noto Sans JP", sans-serif'
 */
export declare function prepareVertical(text: string, font: string, options?: PrepareVerticalOptions): PreparedVerticalText;
/** Sentinel cursor: start of text. */
export declare const CURSOR_START: VerticalCursor;
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
export declare function layoutNextColumn(prepared: PreparedVerticalText, cursor: VerticalCursor, maxHeight: number): LayoutColumn | null;
/**
 * Non-materializing variant — returns range + height, no text string.
 * Use when only cursor positions and heights matter (column counting, budget tracking).
 */
export declare function layoutNextColumnRange(prepared: PreparedVerticalText, cursor: VerticalCursor, maxHeight: number): LayoutColumnRange | null;
/**
 * Count columns and compute total width.  Fast batch — does not materialize text.
 *
 * @param maxHeight   Column height (px)
 * @param columnWidth Column width (px) — the horizontal extent of one column (= CSS line-height)
 */
export declare function layoutVertical(prepared: PreparedVerticalText, maxHeight: number, columnWidth: number): LayoutVerticalResult;
/**
 * Batch layout with materialized columns.
 */
export declare function layoutVerticalWithColumns(prepared: PreparedVerticalText, maxHeight: number, columnWidth: number): LayoutVerticalWithColumnsResult;
/**
 * Non-materializing batch callback.  Calls onColumn for each column.
 * Returns column count.
 */
export declare function walkColumnRanges(prepared: PreparedVerticalText, maxHeight: number, onColumn: (column: LayoutColumnRange) => void): number;
/**
 * Set the locale for Intl.Segmenter.  Clears all caches.
 */
export declare function setVerticalLocale(locale?: string): void;
/**
 * Clear all measurement and prepare caches.  Call when font changes.
 */
export declare function clearVerticalLayoutCaches(): void;
//# sourceMappingURL=index.d.ts.map