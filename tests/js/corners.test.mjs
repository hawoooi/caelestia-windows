import { test } from 'node:test';
import assert from 'node:assert';
import { classifyCorner } from '../../zebar/caelestia/corners/classify.js';

// Screen used throughout: 2560x1440 (this machine's actual resolution --
// see CLAUDE.md/the corner-overlays report for the geometry this was
// measured against). classifyCorner itself is resolution-agnostic (just
// compares against screenWidth/2 and screenHeight/2), but fixed real
// numbers make the test cases easy to sanity-check by eye.

test('classifyCorner: a window near the physical top-left is "top-left"', () => {
  // Actual zpack.json "top-left" preset placement: anchor top_left,
  // offsetX 64px, offsetY 12px.
  assert.strictEqual(classifyCorner(64, 12, 2560, 1440), 'top-left');
});

test('classifyCorner: a window near the physical top-right is "top-right"', () => {
  // anchor top_right, offsetX 12px -> outer x = 2560 - 12 - 28 = 2520.
  assert.strictEqual(classifyCorner(2520, 12, 2560, 1440), 'top-right');
});

test('classifyCorner: a window near the physical bottom-left is "bottom-left"', () => {
  // anchor bottom_left, offsetY 12px -> outer y = 1440 - 12 - 28 = 1400.
  assert.strictEqual(classifyCorner(64, 1400, 2560, 1440), 'bottom-left');
});

test('classifyCorner: a window near the physical bottom-right is "bottom-right"', () => {
  assert.strictEqual(classifyCorner(2520, 1400, 2560, 1440), 'bottom-right');
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
