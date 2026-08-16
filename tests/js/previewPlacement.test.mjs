import test from 'node:test';
import assert from 'node:assert/strict';

import {
  previewPlacement,
  previewBox,
  PREVIEW_GAP_PX,
  PREVIEW_RISE_PX,
  PREVIEW_MAX_W,
  PREVIEW_MAX_H,
  PREVIEW_MIN_W,
  PREVIEW_MIN_H,
} from '../../zebar/caelestia/flyout-placement.js';

// This machine's shape: one 2560x1440 monitor, dock window pinned to the
// bottom at y=1384.
const MON = { x: 0, y: 0, width: 2560, height: 1440 };
const DOCK_TOP = 1384;
const CARD = { cardWidth: 360, cardHeight: 239 };

const place = (anchorX, over = {}) =>
  previewPlacement({ anchorX, dockTop: DOCK_TOP, ...CARD, monitor: MON, ...over });

test('the card is centred on the hovered icon', () => {
  const p = place(300);
  assert.equal(p.x, 300 - 360 / 2);
  assert.equal(p.width, 360);
});

test('the card rests GAP above the dock, with the rise slack below it', () => {
  const p = place(300);
  // The window is taller than the card by exactly the rise slack...
  assert.equal(p.height, 239 + PREVIEW_RISE_PX);
  // ...and the card itself (the window's top `cardHeight` pixels) ends `gap`
  // above the dock. This is the assertion that catches an off-by-one-slack
  // mistake, which would otherwise just look like a slightly wrong gap.
  assert.equal(p.y + 239, DOCK_TOP - PREVIEW_GAP_PX);
});

test('the leftmost icon does not push the card off the left edge', () => {
  // The first dock icon sits at x=79 on this machine -- less than half a card
  // width from the screen edge, so an unclamped centre would be negative.
  const p = place(79);
  assert.equal(p.x, 0);
});

test('leftLimit keeps the card off the left bar, with the same gap as the bottom', () => {
  // The bar is 52px wide and the dock starts at its right edge. Without a
  // leftLimit the card clamped to x=0 and painted over the bar; clamping to
  // the dock's edge exactly left it touching the bar. It is inset by the same
  // `gap` it keeps above the dock, so the two sides match.
  const p = place(79, { leftLimit: 52 });
  assert.equal(p.x, 52 + PREVIEW_GAP_PX);
});

test('the left inset and the bottom gap are the SAME number', () => {
  // The whole point of reusing `gap` -- if these ever diverge the card looks
  // askew rather than obviously wrong, which is the hard kind of bug to see.
  const p = place(79, { leftLimit: 52 });
  const leftInset = p.x - 52;
  const bottomGap = DOCK_TOP - (p.y + CARD.cardHeight);
  assert.equal(leftInset, bottomGap);
});

test('leftLimit only ever pushes right, never past the anchor-centred spot', () => {
  const p = place(900, { leftLimit: 52 });
  assert.equal(p.x, 900 - 180, 'a card with room to centre is left alone');
});

test('a leftLimit outside the monitor cannot drag the card off it', () => {
  assert.equal(place(300, { leftLimit: -500 }).x, 300 - 180);
  assert.equal(place(79, { leftLimit: -500 }).x, 0, 'still clamped to the monitor');
});

test('an icon near the right edge does not push the card off the right', () => {
  const p = place(2550);
  assert.equal(p.x, 2560 - 360);
});

test('the clamp respects a monitor that does not start at the origin', () => {
  const mon = { x: 2560, y: 0, width: 1920, height: 1080 };
  const left = previewPlacement({ anchorX: 2570, dockTop: 1024, ...CARD, monitor: mon });
  assert.equal(left.x, 2560, 'clamped to that monitor, not to the desktop origin');
  const right = previewPlacement({ anchorX: 4470, dockTop: 1024, ...CARD, monitor: mon });
  assert.equal(right.x, 2560 + 1920 - 360);
});

test('a card wider than the monitor pins LEFT, where the icon and title are', () => {
  const mon = { x: 0, y: 0, width: 300, height: 1440 };
  const p = previewPlacement({ anchorX: 150, dockTop: DOCK_TOP, ...CARD, monitor: mon });
  assert.equal(p.x, 0);
});

test('a card taller than the space above the dock pins to the monitor top', () => {
  const p = place(300, { cardHeight: 5000 });
  assert.equal(p.y, 0, 'never placed above the top of the screen');
});

test('everything returned is an integer -- setPosition takes physical pixels', () => {
  const p = place(301.5, { cardWidth: 361 });
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.ok(Number.isInteger(p[k]), `${k} = ${p[k]} is not an integer`);
  }
});

// --- previewBox: the thumbnail fitted to the captured window's shape --------

const aspect = (b) => b.width / b.height;

test('a 16:9 window fills the width, not the height', () => {
  const b = previewBox(2560, 1440);
  assert.equal(b.width, PREVIEW_MAX_W);
  assert.ok(b.height <= PREVIEW_MAX_H);
  assert.ok(Math.abs(aspect(b) - 16 / 9) < 0.02, `aspect ${aspect(b)}`);
});

test('a tall half-screen split gets a TALL card, not a letterboxed strip', () => {
  // The exact case the fixed 16:9 box got wrong: a 1254x1424 tiling split.
  const b = previewBox(1254, 1424);
  assert.equal(b.height, PREVIEW_MAX_H, 'height-bound, so it fills vertically');
  assert.ok(b.width < PREVIEW_MAX_W, 'and is narrower than a landscape card');
  assert.ok(Math.abs(aspect(b) - 1254 / 1424) < 0.02, `aspect ${aspect(b)}`);
});

test('a very wide window is not allowed to collapse into a sliver', () => {
  const b = previewBox(3840, 400);
  assert.equal(b.height, PREVIEW_MIN_H);
  assert.equal(b.width, PREVIEW_MAX_W, 'width bound wins over the aspect ratio');
});

test('a very tall window is not allowed to become a thin column', () => {
  const b = previewBox(300, 2000);
  assert.equal(b.width, PREVIEW_MIN_W);
  assert.ok(b.height <= PREVIEW_MAX_H, 'still capped by the space above the dock');
});

test('unknown dimensions fall back to 16:9 rather than to zero', () => {
  for (const args of [[0, 0], [NaN, NaN], [undefined, undefined], [-5, 10]]) {
    const b = previewBox(...args);
    assert.ok(Math.abs(aspect(b) - 16 / 9) < 0.02, `${args} -> aspect ${aspect(b)}`);
    assert.ok(b.width > 0 && b.height > 0);
  }
});

test('every box stays inside its bounds and is integral', () => {
  const sizes = [[2560, 1440], [1254, 1424], [800, 600], [3840, 400], [300, 2000], [1000, 1000]];
  for (const [w, h] of sizes) {
    const b = previewBox(w, h);
    assert.ok(Number.isInteger(b.width) && Number.isInteger(b.height), `${w}x${h}`);
    assert.ok(b.width <= PREVIEW_MAX_W && b.height <= PREVIEW_MAX_H, `${w}x${h} -> ${b.width}x${b.height} too big`);
    assert.ok(b.width >= PREVIEW_MIN_W && b.height >= PREVIEW_MIN_H, `${w}x${h} -> ${b.width}x${b.height} too small`);
  }
});

test('a square window comes out square', () => {
  const b = previewBox(1440, 1440);
  assert.equal(b.width, b.height);
});
