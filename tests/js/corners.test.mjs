import { test } from 'node:test';
import assert from 'node:assert';
import { classifyCorner } from '../../zebar/caelestia/corners/classify.js';

// Screen used throughout: 2560x1440 (this machine's actual resolution --
// see CLAUDE.md/the corner-overlays report for the geometry this was
// measured against). classifyCorner itself is resolution-agnostic (just
// compares against screenWidth/2 and screenHeight/2), but fixed real
// numbers make the test cases easy to sanity-check by eye.

test('classifyCorner: a window near the physical top-left is "top-left"', () => {
  // Actual zpack.json "top-left" preset placement (post flush-to-edge fix,
  // frame-flush with both the bar's own right edge and the screen top):
  // anchor top_left, offsetX 52px, offsetY 0px.
  assert.strictEqual(classifyCorner(52, 0, 2560, 1440), 'top-left');
});

test('classifyCorner: a window near the physical top-right is "top-right"', () => {
  // Every corner preset now uses anchor top_left with a purely positive,
  // absolute offset (sidesteps the offset-sign trap -- see
  // docs/zebar-bar.md): offsetX 2516px, offsetY 0px, width 44px -> outer
  // x = 2516, which is 2560 - 44 (flush with the screen's right edge).
  assert.strictEqual(classifyCorner(2516, 0, 2560, 1440), 'top-right');
});

test('classifyCorner: a window near the physical bottom-left is "bottom-left"', () => {
  // anchor top_left, offsetX 52px, offsetY 1396px, height 44px -> outer y
  // = 1396, which is 1440 - 44 (flush with the screen's bottom edge).
  assert.strictEqual(classifyCorner(52, 1396, 2560, 1440), 'bottom-left');
});

test('classifyCorner: a window near the physical bottom-right is "bottom-right"', () => {
  assert.strictEqual(classifyCorner(2516, 1396, 2560, 1440), 'bottom-right');
});

test('classifyCorner: exactly at the midpoint rounds to bottom-right (strict "<" means a tie loses)', () => {
  assert.strictEqual(classifyCorner(1280, 720, 2560, 1440), 'bottom-right');
});

test('classifyCorner: is resolution-agnostic -- a different screen size still classifies correctly', () => {
  assert.strictEqual(classifyCorner(10, 10, 1920, 1080), 'top-left');
  assert.strictEqual(classifyCorner(1900, 10, 1920, 1080), 'top-right');
  assert.strictEqual(classifyCorner(10, 1070, 1920, 1080), 'bottom-left');
  assert.strictEqual(classifyCorner(1900, 1070, 1920, 1080), 'bottom-right');
});
