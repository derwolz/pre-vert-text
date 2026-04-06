// editorial-engine.js — vertical tategaki version of "The Editorial Engine"
//
// The horizontal original lays out text into lines, carving width slots around
// circular orb obstacles.  This vertical version lays out text into columns,
// carving *height* slots around the same orbs.  Text flows top-to-bottom within
// each column, and columns flow right-to-left across the page (tategaki).
//
// Uses verticalLayout.js (the pretext-equivalent for vertical text).

import {
  prepareVertical,
  layoutNextColumn,
  layoutVerticalWithColumns,
  walkColumnRanges,
  CURSOR_START,
} from "../dist/index.js";

// ── Config ──────────────────────────────────────────────────────────────────

const FONT_SIZE       = 14;
const COL_WIDTH       = FONT_SIZE * 1.85;    // 25.9px — one vertical column width
const FONT_FAMILY     = '"Noto Sans JP", "Hiragino Kaku Gothic Pro", "Yu Gothic", Georgia, serif';
const BODY_FONT       = `${FONT_SIZE}px ${FONT_FAMILY}`;
const HEADLINE_FONT   = FONT_FAMILY;

const GUTTER          = 48;
const ROW_GAP         = 30;                   // gap between text rows (horizontal bands)
const STATS_BAR_H     = 42;
const MIN_SLOT_H      = 40;                   // minimum usable column height in a slot

const HEADLINE_TEXT    = "縦書きレイアウトの未来はCSSではない";

// Japanese body text about the same topic as the original — text layout on the web.
const BODY_TEXT = `ウェブは三十年前に静的文書のために設計されたパイプラインでテキストを描画する。ブラウザはフォントを読み込み、テキストをグリフに整形し、それらの幅を測定し、行の折り返し位置を決定し、各行を垂直に配置する。すべてのステップが前のステップに依存する。すべてのステップでレンダリングエンジンが内部レイアウトツリーを参照する必要がある。

ブログ記事の段落であれば、このパイプラインは見えない。ブラウザは読者の目がアドレスバーから最初の単語に移動する前に、読み込み、レイアウト、描画を完了する。しかしウェブはもはや静的文書の集まりではない。アプリケーションのプラットフォームであり、それらのアプリケーションは元のパイプラインが想定しなかった方法でテキストについて知る必要がある。

メッセージングアプリは仮想化リストをレンダリングする前にすべてのメッセージバブルの正確な高さを知る必要がある。メイソンリーレイアウトはカードの重なりを防ぐためにすべてのカードの高さを必要とする。エディトリアルページはテキストが画像や広告やインタラクティブ要素の周りを流れる必要がある。レスポンシブダッシュボードはユーザーがパネル分割線をドラッグするときにリアルタイムでテキストのサイズ変更と再配置を行う必要がある。

これらの操作すべてにテキスト測定が必要だ。そして今日のウェブ上のすべてのテキスト測定には同期レイアウトリフローが必要だ。そのコストは壊滅的だ。単一のテキストブロックの高さを測定すると、ブラウザはページ上のすべての要素の位置を再計算する。五百のテキストブロックを連続して測定すると、五百回のフルレイアウトパスが発生する。

開発者はますます絶望的な回避策を発明してきた。推定高さは実際の測定をguessで置き換え、推測が間違っていると内容が目に見えてジャンプする。CSSシェイプ仕様は二〇一四年に最終化され、雑誌スタイルのテキストラップをウェブにもたらすはずだった。

しかし実際には著しく制限されている。CSSシェイプはフロート要素でのみ機能する。テキストは形状の片側にしか折り返せない。形状はCSSで静的に定義する必要があり、完全なレイアウトリフローを起こさずにアニメーションまたは動的に変更できない。

印刷雑誌で見るエディトリアルレイアウト、つまり写真の周りを流れるテキスト、コラムを中断するプルクォート、シームレスなテキスト受け渡しを持つ複数カラムは、ウェブでは手の届かないものだった。概念的に難しいからではなく、DOM測定でそれらを実装するパフォーマンスコストが実用的でないからだ。

もしテキスト測定にDOMがまったく必要なかったら？もしすべての行がどこで折り返すか、各行の幅がどれくらいか、テキストブロック全体の高さがどれくらいかを、算術だけで正確に計算できたら？

これがpretextの核心的な洞察だ。ブラウザのキャンバスAPIにはmeasureTextメソッドがあり、レイアウトリフローを発生させずに任意のフォントの任意の文字列の幅を返す。キャンバス測定はDOM描画と同じフォントエンジンを使用する。結果は同一だ。しかしレイアウトツリーの外部で動作するため、リフローのペナルティがない。

pretextはこの非対称性を利用する。テキストが初めて現れたとき、pretextはキャンバス経由ですべての単語を一度測定し幅をキャッシュする。この準備フェーズの後、レイアウトは純粋な算術だ。キャッシュされた幅を走査し、実行中の行幅を追跡し、幅が最大値を超えたときに改行を挿入し、行の高さを合計する。DOMなし。リフローなし。レイアウトツリーへのアクセスなし。`;

const PULLQUOTE_TEXTS = [
  "「パフォーマンスの改善は漸進的ではなく、カテゴリカルだ。〇・〇五ミリ秒対三十ミリ秒。ゼロリフロー対五百。」",
  "「テキストは視覚的構成における第一級の参加者となる。静的ブロックではなく、リアルタイムで適応する流動的な素材だ。」",
];

// ── Slot carving — vertical version ─────────────────────────────────────────
// Instead of carving width slots in a horizontal line band,
// we carve *height* slots in a vertical column band.

function carveColumnHeightSlots(base, blocked) {
  // base: { top, bottom } — full column height range
  // blocked: { top, bottom }[] — obstacle intervals
  let slots = [base];
  for (const iv of blocked) {
    const next = [];
    for (const s of slots) {
      if (iv.bottom <= s.top || iv.top >= s.bottom) { next.push(s); continue; }
      if (iv.top > s.top)    next.push({ top: s.top, bottom: iv.top });
      if (iv.bottom < s.bottom) next.push({ top: iv.bottom, bottom: s.bottom });
    }
    slots = next;
  }
  return slots.filter(s => s.bottom - s.top >= MIN_SLOT_H);
}

// For a circle at (cx,cy,r), what vertical interval does it block within
// a column band from bandLeft to bandRight?
function circleIntervalForColumn(cx, cy, r, bandLeft, bandRight, hPad, vPad) {
  const left  = bandLeft  - hPad;
  const right = bandRight + hPad;
  if (left >= cx + r || right <= cx - r) return null;
  const minDx = (cx >= left && cx <= right) ? 0 : (cx < left ? left - cx : cx - right);
  if (minDx >= r) return null;
  const maxDy = Math.sqrt(r * r - minDx * minDx);
  return { top: cy - maxDy - vPad, bottom: cy + maxDy + vPad };
}

// ── Stage + orbs ────────────────────────────────────────────────────────────

const stage = document.getElementById("stage");

const orbDefs = [
  { fx: 0.52, fy: 0.22, r: 100, vx: 24, vy: 16, color: [196, 163, 90]  },
  { fx: 0.18, fy: 0.48, r: 75,  vx:-19, vy: 26, color: [100, 140, 255] },
  { fx: 0.74, fy: 0.58, r: 85,  vx: 16, vy:-21, color: [232, 100, 130] },
  { fx: 0.38, fy: 0.72, r: 65,  vx:-26, vy:-14, color: [80,  200, 140] },
  { fx: 0.86, fy: 0.18, r: 55,  vx:-13, vy: 19, color: [150, 100, 220] },
];

function createOrbEl(c) {
  const el = document.createElement("div");
  el.className = "orb";
  el.style.background = `radial-gradient(circle at 35% 35%, rgba(${c[0]},${c[1]},${c[2]},0.35), rgba(${c[0]},${c[1]},${c[2]},0.12) 55%, transparent 72%)`;
  el.style.boxShadow = `0 0 60px 15px rgba(${c[0]},${c[1]},${c[2]},0.18), 0 0 120px 40px rgba(${c[0]},${c[1]},${c[2]},0.07)`;
  stage.appendChild(el);
  return el;
}

const W0 = window.innerWidth;
const H0 = window.innerHeight;
const orbs = orbDefs.map(d => ({
  x: d.fx * W0, y: d.fy * H0, r: d.r, vx: d.vx, vy: d.vy,
  color: d.color, paused: false, dragging: false,
  dragStartX: 0, dragStartY: 0, dragStartOrbX: 0, dragStartOrbY: 0,
  el: createOrbEl(d.color),
}));

// ── Prepare text ────────────────────────────────────────────────────────────

const preparedBody = prepareVertical(BODY_TEXT.replace(/\n\n/g, ""), BODY_FONT);
const PQ_FONT       = `italic ${FONT_SIZE}px ${FONT_FAMILY}`;
const preparedPQ    = PULLQUOTE_TEXTS.map(t => prepareVertical(t, PQ_FONT));

// ── DOM pools ───────────────────────────────────────────────────────────────

const segPool    = [];
const hlPool     = [];
const pqSegPool  = [];
const pqBoxPool  = [];

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

// ── Headline fitting (binary search for max font size) ──────────────────────

let cachedHLKey = "", cachedHLSize = 24, cachedHLCols = [];

function fitHeadline(maxHeight, maxWidth) {
  const key = `${maxHeight}:${maxWidth}`;
  if (key === cachedHLKey) return { fontSize: cachedHLSize, cols: cachedHLCols };
  cachedHLKey = key;

  let lo = 18, hi = 80, best = lo, bestCols = [];
  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2);
    const font = `700 ${size}px ${FONT_FAMILY}`;
    const colW = size * 1.85;
    const p = prepareVertical(HEADLINE_TEXT, font);
    const result = layoutVerticalWithColumns(p, maxHeight, colW);
    const totalW = result.width;
    if (totalW <= maxWidth) {
      best = size;
      bestCols = result.columns.map((c, i) => ({
        text: c.text, height: c.height, x: i * colW, y: 0,
      }));
      lo = size + 1;
    } else {
      hi = size - 1;
    }
  }
  cachedHLSize = best;
  cachedHLCols = bestCols;
  return { fontSize: best, cols: bestCols };
}

// ── Vertical column layout with obstacle avoidance ──────────────────────────
// Lays out text into vertical columns within a region, carving height slots
// around circular and rectangular obstacles.

function layoutRow(prepared, startCursor, regionX, regionY, regionW, regionH, colWidth, circleObs, rectObstacles) {
  let cursor = startCursor;
  let colLeft = regionX + regionW - colWidth; // start from right (vertical-rl)
  const segments = [];
  let textExhausted = false;

  while (colLeft >= regionX && !textExhausted) {
    const bandLeft  = colLeft;
    const bandRight = colLeft + colWidth;

    // Find vertical obstacles in this column band
    const blocked = [];
    for (const c of circleObs) {
      const iv = circleIntervalForColumn(c.cx, c.cy, c.r, bandLeft, bandRight, c.hPad, c.vPad);
      if (iv) blocked.push(iv);
    }
    for (const r of rectObstacles) {
      if (bandRight <= r.x || bandLeft >= r.x + r.w) continue;
      blocked.push({ top: r.y, bottom: r.y + r.h });
    }

    // Carve available height slots
    const slots = carveColumnHeightSlots({ top: regionY, bottom: regionY + regionH }, blocked);
    if (slots.length === 0) { colLeft -= colWidth; continue; }

    slots.sort((a, b) => a.top - b.top);

    for (const slot of slots) {
      const slotH = slot.bottom - slot.top;
      const col = layoutNextColumn(prepared, cursor, slotH);
      if (!col) { textExhausted = true; break; }
      segments.push({
        x: Math.round(colLeft),
        y: Math.round(slot.top),
        w: colWidth,
        h: slotH,
        text: col.text,
        height: col.height,
      });
      cursor = col.end;
    }
    colLeft -= colWidth;
  }
  return { segments, cursor };
}

// ── Pointer / drag ──────────────────────────────────────────────────────────

let activeOrb = null, pointerX = -9999, pointerY = -9999;

function hitTestOrbs(px, py) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    if ((px - o.x) ** 2 + (py - o.y) ** 2 <= o.r ** 2) return o;
  }
  return null;
}

stage.addEventListener("pointerdown", e => {
  const orb = hitTestOrbs(e.clientX, e.clientY);
  if (orb) {
    activeOrb = orb; orb.dragging = true;
    orb.dragStartX = e.clientX; orb.dragStartY = e.clientY;
    orb.dragStartOrbX = orb.x; orb.dragStartOrbY = orb.y;
    e.preventDefault();
  }
});
window.addEventListener("pointermove", e => {
  pointerX = e.clientX; pointerY = e.clientY;
  if (activeOrb) {
    activeOrb.x = activeOrb.dragStartOrbX + (e.clientX - activeOrb.dragStartX);
    activeOrb.y = activeOrb.dragStartOrbY + (e.clientY - activeOrb.dragStartY);
  }
});
window.addEventListener("pointerup", e => {
  if (activeOrb) {
    const dx = e.clientX - activeOrb.dragStartX, dy = e.clientY - activeOrb.dragStartY;
    if (dx * dx + dy * dy < 16) {
      activeOrb.paused = !activeOrb.paused;
      activeOrb.el.classList.toggle("paused", activeOrb.paused);
    }
    activeOrb.dragging = false; activeOrb = null;
  }
});

// ── FPS counter ─────────────────────────────────────────────────────────────

const fpsTs = []; let fpsDisplay = 60;
function updateFPS(now) {
  fpsTs.push(now);
  while (fpsTs.length > 0 && fpsTs[0] < now - 1000) fpsTs.shift();
  fpsDisplay = fpsTs.length;
}

// ── Stats elements ──────────────────────────────────────────────────────────

const elSegs   = document.getElementById("sSegs");
const elReflow = document.getElementById("sReflow");
const elDom    = document.getElementById("sDom");
const elFps    = document.getElementById("sFps");
const elRows   = document.getElementById("sRows");

// ── Animation loop ──────────────────────────────────────────────────────────

let lastTime = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const pw = window.innerWidth;
  const ph = window.innerHeight;

  // ── Orb physics ──────────────────────────────────────────────────────────
  for (const o of orbs) {
    if (o.paused || o.dragging) continue;
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (o.x - o.r < 0)                    { o.x = o.r;                   o.vx =  Math.abs(o.vx); }
    if (o.x + o.r > pw)                   { o.x = pw - o.r;             o.vx = -Math.abs(o.vx); }
    if (o.y - o.r < GUTTER * 0.5)         { o.y = o.r + GUTTER * 0.5;  o.vy =  Math.abs(o.vy); }
    if (o.y + o.r > ph - STATS_BAR_H)     { o.y = ph - STATS_BAR_H - o.r; o.vy = -Math.abs(o.vy); }
  }
  // Orb-orb repulsion
  for (let i = 0; i < orbs.length; i++) {
    for (let j = i + 1; j < orbs.length; j++) {
      const a = orbs[i], b = orbs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.r + b.r + 20;
      if (dist < minDist && dist > 0.1) {
        const force = (minDist - dist) * 0.8;
        const nx = dx / dist, ny = dy / dist;
        if (!a.paused && !a.dragging) { a.vx -= nx * force * dt; a.vy -= ny * force * dt; }
        if (!b.paused && !b.dragging) { b.vx += nx * force * dt; b.vy += ny * force * dt; }
      }
    }
  }

  const circleObs = orbs.map(o => ({ cx: o.x, cy: o.y, r: o.r, hPad: 10, vPad: 10 }));

  const t0 = performance.now();

  // ── Headline (vertical, right side) ──────────────────────────────────────
  const hlMaxH = ph - GUTTER * 2 - STATS_BAR_H;
  const hlMaxW = Math.floor(pw * 0.25);
  const { fontSize: hlSize, cols: hlCols } = fitHeadline(hlMaxH, hlMaxW);
  const hlColW = hlSize * 1.85;
  const hlFont = `700 ${hlSize}px ${FONT_FAMILY}`;
  const hlTotalW = hlCols.length * hlColW;
  const hlLeft = GUTTER; // headline on the right (first in reading order)

  syncPool(hlPool, hlCols.length, "headline");
  for (let i = 0; i < hlCols.length; i++) {
    const el = hlPool[i];
    const col = hlCols[i];
    el.textContent = col.text;
    // Columns go right-to-left within the headline block
    el.style.left  = (hlLeft + hlTotalW - (i + 1) * hlColW) + "px";
    el.style.top   = GUTTER + "px";
    el.style.font  = hlFont;
    el.style.width = hlColW + "px";
    el.style.height = hlMaxH + "px";
    el.style.lineHeight = hlColW + "px";
  }

  // ── Body layout region (to the left of headline) ─────────────────────────
  const bodyRight = pw - GUTTER;
  const bodyLeft  = hlLeft + hlTotalW + ROW_GAP;
  const bodyW     = bodyRight - bodyLeft;
  const bodyTop   = GUTTER;
  const bodyH     = ph - GUTTER - STATS_BAR_H - 8;

  // Treat body as one big region; layoutRow fills columns right-to-left
  const rowCount = 1;
  const result = layoutRow(
    preparedBody, CURSOR_START,
    bodyLeft, bodyTop, bodyW, bodyH,
    COL_WIDTH, circleObs, [],
  );

  const reflowTime = performance.now() - t0;

  // ── Render body segments ─────────────────────────────────────────────────
  syncPool(segPool, result.segments.length, "col-seg");
  for (let i = 0; i < result.segments.length; i++) {
    const el  = segPool[i];
    const seg = result.segments[i];
    el.textContent  = seg.text;
    el.style.left   = seg.x + "px";
    el.style.top    = seg.y + "px";
    el.style.width  = COL_WIDTH + "px";
    el.style.height = seg.h + "px";
    el.style.font   = BODY_FONT;
    el.style.lineHeight = COL_WIDTH + "px";
  }

  // ── Render orbs ──────────────────────────────────────────────────────────
  for (const o of orbs) {
    o.el.style.left   = (o.x - o.r) + "px";
    o.el.style.top    = (o.y - o.r) + "px";
    o.el.style.width  = (o.r * 2) + "px";
    o.el.style.height = (o.r * 2) + "px";
  }

  // ── Cursor / stats ───────────────────────────────────────────────────────
  const hovered = hitTestOrbs(pointerX, pointerY);
  document.body.style.cursor = activeOrb ? "grabbing" : hovered ? "grab" : "";

  updateFPS(now);
  elSegs.textContent   = String(result.segments.length);
  elReflow.textContent = reflowTime.toFixed(1) + "ms";
  elDom.textContent    = "0";
  elFps.textContent    = String(fpsDisplay);
  elRows.textContent   = String(rowCount);
}

lastTime = performance.now();
requestAnimationFrame(animate);
