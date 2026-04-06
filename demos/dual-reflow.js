// dual-reflow.js — pretext (horizontal) + pre-vert-text (vertical) side by side
//
// English text reflows horizontally around bouncing orbs.
// Japanese text reflows vertically around the same orbs.
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
const CURSOR_PAD_H = 16;
const CURSOR_PAD_V = 8;

// ── State ───────────────────────────────────────────────────────────────────

let mouseX = -9999, mouseY = -9999;
let jaInFront = false;

const stage = document.getElementById("stage");
const cursorGlow = document.getElementById("cursor-glow");
const statsEl = document.getElementById("stats");

// ── Bouncing orbs ───────────────────────────────────────────────────────────

const orbDefs = [
  { fx: 0.30, fy: 0.25, r: 90,  vx: 30,  vy: 20,  color: [196, 163, 90]  },
  { fx: 0.70, fy: 0.60, r: 70,  vx:-22,  vy: 28,  color: [100, 140, 255] },
  { fx: 0.50, fy: 0.45, r: 80,  vx: 18,  vy:-24,  color: [232, 100, 130] },
  { fx: 0.20, fy: 0.70, r: 60,  vx:-28,  vy:-16,  color: [80,  200, 140] },
  { fx: 0.80, fy: 0.30, r: 55,  vx:-15,  vy: 22,  color: [150, 100, 220] },
];

function createOrbEl(c) {
  const el = document.createElement("div");
  el.className = "orb";
  el.style.background = `radial-gradient(circle at 35% 35%, rgba(${c[0]},${c[1]},${c[2]},0.30), rgba(${c[0]},${c[1]},${c[2]},0.10) 55%, transparent 72%)`;
  el.style.boxShadow = `0 0 50px 12px rgba(${c[0]},${c[1]},${c[2]},0.15), 0 0 100px 35px rgba(${c[0]},${c[1]},${c[2]},0.06)`;
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

// ── Circle-interval helpers ─────────────────────────────────────────────────

function circleWidthAtY(cx, cy, r, y, pad) {
  const dy = Math.abs(y - cy);
  if (dy >= r) return null;
  const dx = Math.sqrt(r * r - dy * dy) + pad;
  return { left: cx - dx, right: cx + dx };
}

function circleHeightAtX(cx, cy, r, x, pad) {
  const dx = Math.abs(x - cx);
  if (dx >= r) return null;
  const dy = Math.sqrt(r * r - dx * dx) + pad;
  return { top: cy - dy, bottom: cy + dy };
}

// ── Slot carving (multiple obstacles) ───────────────────────────────────────

function carveWidthSlots(base, obstacles) {
  // base: { left, width }
  // obstacles: { left, right }[]
  let slots = [{ left: base.left, right: base.left + base.width }];
  for (const ob of obstacles) {
    const next = [];
    for (const s of slots) {
      if (ob.right <= s.left || ob.left >= s.right) { next.push(s); continue; }
      if (ob.left > s.left)   next.push({ left: s.left, right: ob.left });
      if (ob.right < s.right) next.push({ left: ob.right, right: s.right });
    }
    slots = next;
  }
  return slots.filter(s => s.right - s.left >= 50).map(s => ({ left: s.left, width: s.right - s.left }));
}

function carveHeightSlots(base, obstacles) {
  // base: { top, bottom }
  let slots = [base];
  for (const ob of obstacles) {
    const next = [];
    for (const s of slots) {
      if (ob.bottom <= s.top || ob.top >= s.bottom) { next.push(s); continue; }
      if (ob.top > s.top)      next.push({ top: s.top, bottom: ob.top });
      if (ob.bottom < s.bottom) next.push({ top: ob.bottom, bottom: s.bottom });
    }
    slots = next;
  }
  return slots.filter(s => s.bottom - s.top >= 30);
}

// ── Horizontal layout with multiple circular obstacles ──────────────────────

function layoutEnglish(regionX, regionY, regionW, regionH, circles) {
  const lines = [];
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  const colW = regionW;
  const colX = regionX;
  let y = regionY;

  while (y + EN_LINE_HEIGHT <= regionY + regionH) {
    const lineMidY = y + EN_LINE_HEIGHT / 2;

    // Collect all circle obstacles that intersect this line band
    const obstacles = [];
    for (const c of circles) {
      const iv = circleWidthAtY(c.cx, c.cy, c.r, lineMidY, CURSOR_PAD_H);
      if (iv && iv.right > colX && iv.left < colX + colW) obstacles.push(iv);
    }

    const slots = obstacles.length > 0
      ? carveWidthSlots({ left: colX, width: colW }, obstacles)
      : [{ left: colX, width: colW }];

    if (slots.length === 0) { y += EN_LINE_HEIGHT; continue; }

    let exhausted = false;
    for (const slot of slots) {
      const line = layoutNextLine(preparedEN, cursor, slot.width);
      if (!line) { exhausted = true; break; }
      lines.push({ x: slot.left, y, text: line.text, width: line.width });
      cursor = line.end;
    }
    if (exhausted) break;
    y += EN_LINE_HEIGHT;
  }
  return lines;
}

// ── Vertical layout with multiple circular obstacles ────────────────────────

function layoutJapanese(regionX, regionY, regionW, regionH, circles) {
  const segments = [];
  let cursor = CURSOR_START;
  let colX = regionX + regionW - JA_COL_WIDTH;

  while (colX >= regionX) {
    const colMidX = colX + JA_COL_WIDTH / 2;

    // Collect all circle obstacles that intersect this column band
    const obstacles = [];
    for (const c of circles) {
      const iv = circleHeightAtX(c.cx, c.cy, c.r, colMidX, CURSOR_PAD_V);
      if (iv && iv.bottom > regionY && iv.top < regionY + regionH) obstacles.push(iv);
    }

    const slots = obstacles.length > 0
      ? carveHeightSlots({ top: regionY, bottom: regionY + regionH }, obstacles)
      : [{ top: regionY, bottom: regionY + regionH }];

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

// ── Pointer events ──────────────────────────────────────────────────────────

let activeOrb = null;

function hitTestOrbs(px, py) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    if ((px - o.x) ** 2 + (py - o.y) ** 2 <= o.r ** 2) return o;
  }
  return null;
}

window.addEventListener("pointermove", e => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursorGlow.style.left = mouseX + "px";
  cursorGlow.style.top  = mouseY + "px";
  if (activeOrb) {
    activeOrb.x = activeOrb.dragStartOrbX + (e.clientX - activeOrb.dragStartX);
    activeOrb.y = activeOrb.dragStartOrbY + (e.clientY - activeOrb.dragStartY);
  }
});

window.addEventListener("pointerleave", () => {
  mouseX = -9999; mouseY = -9999;
});

stage.addEventListener("pointerdown", e => {
  const orb = hitTestOrbs(e.clientX, e.clientY);
  if (orb) {
    activeOrb = orb; orb.dragging = true;
    orb.dragStartX = e.clientX; orb.dragStartY = e.clientY;
    orb.dragStartOrbX = orb.x; orb.dragStartOrbY = orb.y;
    e.preventDefault();
  }
});

window.addEventListener("pointerup", e => {
  if (activeOrb) {
    const dx = e.clientX - activeOrb.dragStartX, dy = e.clientY - activeOrb.dragStartY;
    if (dx * dx + dy * dy < 16) {
      // Short click on orb — toggle pause
      activeOrb.paused = !activeOrb.paused;
      activeOrb.el.classList.toggle("paused", activeOrb.paused);
    }
    activeOrb.dragging = false; activeOrb = null;
  } else {
    // Click on empty space — swap languages
    jaInFront = !jaInFront;
  }
});

// ── FPS ─────────────────────────────────────────────────────────────────────

const fpsTs = []; let fpsDisplay = 60;
function updateFPS(now) {
  fpsTs.push(now);
  while (fpsTs.length && fpsTs[0] < now - 1000) fpsTs.shift();
  fpsDisplay = fpsTs.length;
}

// ── Render loop ─────────────────────────────────────────────────────────────

const STATS_BAR_H = 30;
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
    if (o.x - o.r < 0)              { o.x = o.r;              o.vx =  Math.abs(o.vx); }
    if (o.x + o.r > pw)             { o.x = pw - o.r;         o.vx = -Math.abs(o.vx); }
    if (o.y - o.r < 0)              { o.y = o.r;              o.vy =  Math.abs(o.vy); }
    if (o.y + o.r > ph - STATS_BAR_H) { o.y = ph - STATS_BAR_H - o.r; o.vy = -Math.abs(o.vy); }
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

  // Build circle obstacle list (orbs + mouse cursor)
  const circles = orbs.map(o => ({ cx: o.x, cy: o.y, r: o.r }));
  if (mouseX > 0 && mouseY > 0) circles.push({ cx: mouseX, cy: mouseY, r: 100 });

  const t0 = performance.now();

  // English: wide and squat, single column centered
  const enW = Math.min(pw - GUTTER * 2, 800);
  const enH = Math.min(ph * 0.45, ph - GUTTER * 2);
  const enX = Math.round((pw - enW) / 2);
  const enY = Math.round((ph - enH) / 2);
  const enLines = layoutEnglish(enX, enY, enW, enH, circles);

  // Japanese: tall and thin, centered, overlapping
  const jaW = Math.min(pw * 0.5, 600);
  const jaH = ph - GUTTER * 2;
  const jaX = Math.round((pw - jaW) / 2);
  const jaY = GUTTER;
  const jaSegs = layoutJapanese(jaX, jaY, jaW, jaH, circles);

  const reflowMs = performance.now() - t0;

  // ── Render English ─────────────────────────────────────────────────────
  const enColor = jaInFront ? EN_BACK : EN_FRONT;
  const enZ     = jaInFront ? "1" : "2";

  syncPool(enPool, enLines.length, "en-line");
  for (let i = 0; i < enLines.length; i++) {
    const el = enPool[i];
    const ln = enLines[i];
    el.textContent      = ln.text;
    el.style.left       = ln.x + "px";
    el.style.top        = ln.y + "px";
    el.style.font       = EN_FONT;
    el.style.lineHeight = EN_LINE_HEIGHT + "px";
    el.style.color      = enColor;
    el.style.zIndex     = enZ;
  }

  // ── Render Japanese ────────────────────────────────────────────────────
  const jaColor = jaInFront ? JA_FRONT : JA_BACK;
  const jaZ     = jaInFront ? "2" : "1";

  syncPool(jaPool, jaSegs.length, "ja-seg");
  for (let i = 0; i < jaSegs.length; i++) {
    const el  = jaPool[i];
    const seg = jaSegs[i];
    el.textContent      = seg.text;
    el.style.left       = seg.x + "px";
    el.style.top        = seg.y + "px";
    el.style.width      = JA_COL_WIDTH + "px";
    el.style.height     = seg.h + "px";
    el.style.font       = JA_FONT;
    el.style.lineHeight = JA_COL_WIDTH + "px";
    el.style.color      = jaColor;
    el.style.zIndex     = jaZ;
  }

  // ── Render orbs ────────────────────────────────────────────────────────
  for (const o of orbs) {
    o.el.style.left   = (o.x - o.r) + "px";
    o.el.style.top    = (o.y - o.r) + "px";
    o.el.style.width  = (o.r * 2) + "px";
    o.el.style.height = (o.r * 2) + "px";
  }

  const hovered = hitTestOrbs(mouseX, mouseY);
  document.body.style.cursor = activeOrb ? "grabbing" : hovered ? "grab" : "none";

  // ── Stats ──────────────────────────────────────────────────────────────
  updateFPS(now);
  statsEl.textContent = `${enLines.length} lines · ${jaSegs.length} cols · ${reflowMs.toFixed(1)}ms · ${fpsDisplay}fps`;
}

lastTime = performance.now();
requestAnimationFrame(animate);
