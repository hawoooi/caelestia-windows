// Pure logic, split out of corners.js for unit testing without a DOM/Tauri
// runtime -- see tests/js/entries.test.mjs's own established pattern
// (splitClock, workspaceState, etc.) in docs/zebar-bar.md.

/**
 * Decides which screen corner a window sits in from its own on-screen
 * position, rather than trusting a hardcoded preset-name->corner map. The
 * zpack.json "corners" widget runs the SAME index.html/corners.js for all
 * four presets (top-left/top-right/bottom-left/bottom-right); this is how
 * a given instance learns which one it is at runtime.
 *
 * @param {number} x - window's outer-left, physical pixels, screen-relative
 *   (Tauri's `outerPosition()`).
 * @param {number} y - window's outer-top, physical pixels, screen-relative.
 * @param {number} screenWidth - `window.screen.width`.
 * @param {number} screenHeight - `window.screen.height`.
 * @returns {'top-left'|'top-right'|'bottom-left'|'bottom-right'}
 */
export function classifyCorner(x, y, screenWidth, screenHeight) {
  const vertical = y < screenHeight / 2 ? 'top' : 'bottom';
  const horizontal = x < screenWidth / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}`;
}
