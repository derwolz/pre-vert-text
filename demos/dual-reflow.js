// dual-reflow.js — pretext (horizontal) + pre-vert-text (vertical) side by side
//
// English text reflows horizontally around the mouse cursor.
// Japanese text reflows vertically around the same cursor.
// Click to swap which is in the foreground.

import { prepareWithSegments, layoutNextLine } from "./pretext.js";
import { prepareVertical, layoutNextColumn, CURSOR_START } from "../dist/index.js";

// ── Text content (translations of each other) ──────────────────────────────

const EN_TEXT = `The web renders text through a pipeline designed thirty years ago for static documents. A browser loads a font, shapes glyphs, measures widths, determines line breaks, and positions each line vertically. Every step depends on the previous one. Every step forces the engine to consult its internal layout tree, a structure so expensive that browsers guard it behind synchronous reflow barriers that freeze the main thread for tens of milliseconds.

For a paragraph in a blog post, this pipeline is invisible. But the web is no longer static documents. It is a platform for applications that need to know about text in ways the original pipeline never anticipated. A messaging app needs exact bubble heights. A masonry layout needs card dimensions. An editorial page needs text flowing around images in real time.

Every one of these operations requires text measurement. And every measurement today requires a synchronous layout reflow. The cost is devastating. Measuring a single block forces recalculation of every element on the page. Five hundred blocks means five hundred full passes. This is layout thrashing: the single largest source of jank on the modern web.

What if text measurement did not require the DOM at all? The canvas API includes measureText, which returns string width without triggering reflow. It uses the same font engine as DOM rendering. The results are identical. But because it operates outside the layout tree, it carries no penalty.

This is the insight at the heart of pretext. Measure every word once via canvas. Cache the widths. After preparation, layout is pure arithmetic: walk cached widths, track line width, break when overflow. No DOM. No reflow. No layout tree. The performance difference is not incremental. It is categorical. Layout that once took thirty milliseconds now takes a fiftieth of one.

Text becomes a first-class participant in visual composition. Not a static block dropped into a grid, but a fluid material that adapts in real time to any shape, any obstacle, any container. The editorial layouts of print magazines, text flowing around photographs and pull quotes across seamless columns, are finally possible on the web. Not because the concept is new, but because the performance barrier has been removed.`;

const JA_TEXT = `ウェブは三十年前に静的文書のために設計されたパイプラインでテキストを描画する。ブラウザはフォントを読み込み、グリフを整形し、幅を測定し、行の折り返し位置を決定し、各行を配置する。すべてのステップが前のステップに依存する。すべてのステップでエンジンが内部レイアウトツリーを参照する必要があり、その構造は非常にコストが高く、ブラウザは同期リフローバリアの背後でそれを保護し、メインスレッドを数十ミリ秒間フリーズさせる。

ブログ記事の段落であれば、このパイプラインは見えない。しかしウェブはもはや静的文書ではない。アプリケーションのプラットフォームであり、元のパイプラインが想定しなかった方法でテキストを知る必要がある。メッセージングアプリはバブルの正確な高さを必要とする。メイソンリーレイアウトはカードの寸法を必要とする。エディトリアルページはリアルタイムで画像の周りをテキストが流れる必要がある。

これらの操作すべてにテキスト測定が必要だ。そして今日のすべての測定には同期レイアウトリフローが必要だ。そのコストは壊滅的だ。単一ブロックの測定がページ上のすべての要素の再計算を強制する。五百ブロックは五百回のフルパスを意味する。これがレイアウトスラッシングであり、現代ウェブにおけるジャンクの最大の原因だ。

もしテキスト測定にDOMがまったく必要なかったら。キャンバスAPIにはmeasureTextがあり、リフローを発生させずに文字列の幅を返す。DOM描画と同じフォントエンジンを使用する。結果は同一だ。しかしレイアウトツリーの外部で動作するため、ペナルティがない。

これがpretextの核心にある洞察だ。キャンバス経由ですべての単語を一度測定する。幅をキャッシュする。準備の後、レイアウトは純粋な算術だ。キャッシュされた幅を走査し、行幅を追跡し、オーバーフロー時に改行する。DOMなし。リフローなし。レイアウトツリーなし。パフォーマンスの差は漸進的ではない。カテゴリカルだ。かつて三十ミリ秒かかったレイアウトが、今や五十分の一ミリ秒で完了する。

テキストは視覚的構成における第一級の参加者となる。グリッドに落とし込まれた静的ブロックではなく、あらゆる形状、あらゆる障害物、あらゆるコンテナにリアルタイムで適応する流動的な素材だ。印刷雑誌のエディトリアルレイアウト、写真やプルクォートの周りを流れ、シームレスなカラムを横断するテキストが、ついにウェブで可能になった。概念が新しいからではなく、パフォーマンスの壁が取り除かれたからだ。`;

// ── Config ──────────────────────────────────────────────────────────────────

const EN_FONT_SIZE = 16;
const EN_LINE_HEIGHT = 26;
const EN_FONT = `${EN_FONT_SIZE}px "Libre Baskerville", Georgia, serif`;

const JA_FONT_SIZE = 14;
const JA_COL_WIDTH = JA_FONT_SIZE * 1.85;
const JA_FONT = `${JA_FONT_SIZE}px "Noto Sans JP", sans-serif`;

const GUTTER = 50;
const CURSOR_R = 120; // radius of the mouse repulsion zone
const CURSOR_PAD_H = 16;
const CURSOR_PAD_V = 8;

// ── State ───────────────────────────────────────────────────────────────────

let mouseX = -9999, mouseY = -9999;
let jaInFront = false; // false = English prominent, Japanese background

const stage = document.getElementById("stage");
const cursorGlow = document.getElementById("cursor-glow");
const statsEl = document.getElementById("stats");

// ── Prepare text (once, cached) ─────────────────────────────────────────────

await document.fonts.ready;

const preparedEN = prepareWithSegments(EN_TEXT.replace(/\n\n/g, " "), EN_FONT);
const preparedJA = prepareVertical(JA_TEXT.replace(/\n\n/g, ""), JA_FONT);

// ── DOM pools ───────────────────────────────────────────────────────────────

const enPool = [];
const jaPool = [];

function syncPool(pool, count, className) {
  while (pool.length < count) {
    const el = document.createElement("div");
    el.className = className;
    stage.appendChild(el);
    pool.push(el);
  }
  for (let i = 0; i < pool.length; i++)
    pool[i].style.display = i < count ? "" : "none";
}

// ── Horizontal layout with circular obstacle ────────────────────────────────

function circleWidthAtY(cx, cy, r, y, pad) {
  const dy = Math.abs(y - cy);
  if (dy >= r) return null;
  const dx = Math.sqrt(r * r - dy * dy) + pad;
  return { left: cx - dx, right: cx + dx };
}

function layoutEnglish(regionX, regionY, regionW, regionH) {
  const lines = [];
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };

  // Single wide column
  const colGap = 40;
  const colCount = 1;
  const colW = regionW;
  let textExhausted = false;

  for (let col = 0; col < colCount && !textExhausted; col++) {
    const colX = regionX + col * (colW + colGap);
    let y = regionY;

    while (y + EN_LINE_HEIGHT <= regionY + regionH) {
      const lineMidY = y + EN_LINE_HEIGHT / 2;
      const obstacle = circleWidthAtY(mouseX, mouseY, CURSOR_R, lineMidY, CURSOR_PAD_H);

      let slotLeft = colX;
      let slotWidth = colW;

      // Build slots on both sides of obstacle
      const slots = [];
      if (obstacle && obstacle.right > colX && obstacle.left < colX + colW) {
        const leftW = Math.max(0, obstacle.left - colX);
        const rightW = Math.max(0, (colX + colW) - obstacle.right);
        if (leftW >= 50)  slots.push({ left: colX, width: leftW });
        if (rightW >= 50) slots.push({ left: obstacle.right, width: rightW });
      } else {
        slots.push({ left: slotLeft, width: slotWidth });
      }

      if (slots.length === 0) { y += EN_LINE_HEIGHT; continue; }

      for (const slot of slots) {
        const line = layoutNextLine(preparedEN, cursor, slot.width);
        if (!line) { textExhausted = true; break; }
        lines.push({ x: slot.left, y, text: line.text, width: line.width });
        cursor = line.end;
      }
      y += EN_LINE_HEIGHT;
    }
  }
  return lines;
}

// ── Vertical layout with circular obstacle ──────────────────────────────────

function circleHeightAtX(cx, cy, r, x, pad) {
  const dx = Math.abs(x - cx);
  if (dx >= r) return null;
  const dy = Math.sqrt(r * r - dx * dx) + pad;
  return { top: cy - dy, bottom: cy + dy };
}

function layoutJapanese(regionX, regionY, regionW, regionH) {
  const segments = [];
  let cursor = CURSOR_START;
  let colX = regionX + regionW - JA_COL_WIDTH; // start from right

  while (colX >= regionX) {
    const colMidX = colX + JA_COL_WIDTH / 2;
    const obstacle = circleHeightAtX(mouseX, mouseY, CURSOR_R, colMidX, CURSOR_PAD_V);

    // Build available height slots
    let slots = [{ top: regionY, bottom: regionY + regionH }];

    if (obstacle && obstacle.bottom > regionY && obstacle.top < regionY + regionH) {
      const newSlots = [];
      for (const s of slots) {
        if (obstacle.bottom <= s.top || obstacle.top >= s.bottom) {
          newSlots.push(s);
          continue;
        }
        if (obstacle.top > s.top) newSlots.push({ top: s.top, bottom: obstacle.top });
        if (obstacle.bottom < s.bottom) newSlots.push({ top: obstacle.bottom, bottom: s.bottom });
      }
      slots = newSlots.filter(s => s.bottom - s.top >= 30);
    }

    if (slots.length === 0) { colX -= JA_COL_WIDTH; continue; }

    let exhausted = false;
    for (const slot of slots) {
      const col = layoutNextColumn(preparedJA, cursor, slot.bottom - slot.top);
      if (!col) { exhausted = true; break; }
      segments.push({ x: colX, y: slot.top, h: slot.bottom - slot.top, text: col.text });
      cursor = col.end;
    }
    if (exhausted) break;
    colX -= JA_COL_WIDTH;
  }
  return segments;
}

// ── Colors ──────────────────────────────────────────────────────────────────

const EN_FRONT = "rgba(232, 225, 210, 0.92)";
const EN_BACK  = "rgba(232, 225, 210, 0.08)";
const JA_FRONT = "rgba(140, 190, 230, 0.88)";
const JA_BACK  = "rgba(140, 190, 230, 0.12)";

// ── Events ──────────────────────────────────────────────────────────────────

window.addEventListener("pointermove", e => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursorGlow.style.left = mouseX + "px";
  cursorGlow.style.top  = mouseY + "px";
});

window.addEventListener("pointerleave", () => {
  mouseX = -9999;
  mouseY = -9999;
});

stage.addEventListener("click", () => {
  jaInFront = !jaInFront;
});

// ── FPS ─────────────────────────────────────────────────────────────────────

const fpsTs = []; let fpsDisplay = 60;
function updateFPS(now) {
  fpsTs.push(now);
  while (fpsTs.length && fpsTs[0] < now - 1000) fpsTs.shift();
  fpsDisplay = fpsTs.length;
}

// ── Render loop ─────────────────────────────────────────────────────────────

function animate(now) {
  requestAnimationFrame(animate);

  const pw = window.innerWidth;
  const ph = window.innerHeight;

  const t0 = performance.now();

  // English: wide and squat, single column centered
  const enW = Math.min(pw - GUTTER * 2, 800);
  const enH = Math.min(ph * 0.45, ph - GUTTER * 2);
  const enX = Math.round((pw - enW) / 2);
  const enY = Math.round((ph - enH) / 2);
  const enLines = layoutEnglish(enX, enY, enW, enH);

  // Japanese: tall and thin, centered, overlapping
  const jaW = Math.min(pw * 0.5, 600);
  const jaH = ph - GUTTER * 2;
  const jaX = Math.round((pw - jaW) / 2);
  const jaY = GUTTER;
  const jaSegs = layoutJapanese(jaX, jaY, jaW, jaH);

  const reflowMs = performance.now() - t0;

  // ── Render English (horizontal lines) ──────────────────────────────────
  const enColor = jaInFront ? EN_BACK : EN_FRONT;
  const enZ     = jaInFront ? "1" : "2";
  const enSize  = jaInFront ? `${EN_FONT_SIZE - 1}px` : `${EN_FONT_SIZE}px`;

  syncPool(enPool, enLines.length, "en-line");
  for (let i = 0; i < enLines.length; i++) {
    const el = enPool[i];
    const ln = enLines[i];
    el.textContent    = ln.text;
    el.style.left     = ln.x + "px";
    el.style.top      = ln.y + "px";
    el.style.font     = EN_FONT;
    el.style.fontSize = enSize;
    el.style.lineHeight = EN_LINE_HEIGHT + "px";
    el.style.color    = enColor;
    el.style.zIndex   = enZ;
  }

  // ── Render Japanese (vertical column segments) ─────────────────────────
  const jaColor = jaInFront ? JA_FRONT : JA_BACK;
  const jaZ     = jaInFront ? "2" : "1";

  syncPool(jaPool, jaSegs.length, "ja-seg");
  for (let i = 0; i < jaSegs.length; i++) {
    const el  = jaPool[i];
    const seg = jaSegs[i];
    el.textContent    = seg.text;
    el.style.left     = seg.x + "px";
    el.style.top      = seg.y + "px";
    el.style.width    = JA_COL_WIDTH + "px";
    el.style.height   = seg.h + "px";
    el.style.font     = JA_FONT;
    el.style.lineHeight = JA_COL_WIDTH + "px";
    el.style.color    = jaColor;
    el.style.zIndex   = jaZ;
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  updateFPS(now);
  statsEl.textContent = `${enLines.length} lines · ${jaSegs.length} cols · ${reflowMs.toFixed(1)}ms · ${fpsDisplay}fps`;
}

requestAnimationFrame(animate);
