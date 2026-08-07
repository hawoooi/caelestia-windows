// Pure geometry for the layout flyout, split out of menu.js so it can be
// asserted directly under `node --test` -- menu.js itself imports
// ../bar/vendor/zebar.js and touches `document` at module scope, so it can
// never be imported in a plain Node process. Same split, and for the same
// reason, as entries/render.js vs bar.js.

// Gap between the bar's right edge and the panel's left edge. Matches the
// desktop frame's own 8px wallpaper gap so the panel looks like it belongs
// to the same system rather than floating at an arbitrary offset.
export const GAP_PX = 8;

// Horizontal slack reserved inside the window so the panel has somewhere to
// slide in FROM without being clipped by its own window bounds (the window
// is sized to the panel, so an un-slacked transform would animate straight
// into the clip edge). The panel sits at `left: SLIDE_PX` (layoutmenu.css)
// and animates translateX(-SLIDE_PX) -> 0, i.e. rightwards, away from the
// bar. Keep in step with layoutmenu.css's --slide.
export const SLIDE_PX = 10;

// All values are PHYSICAL pixels: the anchor arrives that way from the bar
// (which converts its own CSS-pixel button rect through its window's scale
// factor), and Tauri's setPosition/setSize both accept a Physical variant,
// so nothing has to round trip through logical coordinates at all.
//
// Vertically the panel is centred on the button and then clamped into the
// monitor, so a layout button near the very bottom of the bar -- which is
// exactly where it is -- can never place half the panel off-screen.
export function menuPlacement({ anchorX, anchorY, panelWidth, panelHeight, monitor }) {
  const width = panelWidth + SLIDE_PX;
  const height = panelHeight;
  const x = Math.round(anchorX + GAP_PX - SLIDE_PX);
  const unclampedY = Math.round(anchorY - height / 2);
  const minY = monitor.y;
  // Math.max last, so a panel taller than the monitor is pinned to the top
  // edge (clipped at the bottom) rather than the other way round -- the
  // active marker and the first items stay visible either way.
  const maxY = monitor.y + monitor.height - height;
  const y = Math.max(minY, Math.min(unclampedY, maxY));
  return { x, y, width, height };
}

// Multi-monitor guard. `monitorSelection: "all"` means one instance of the
// flyout per monitor AND one bar per monitor; every instance sees every
// bar's `storage` message, since localStorage is shared across the whole
// origin. Without this check, clicking the layout button on monitor 1 would
// fly a menu out on every monitor, all of them jumping to monitor 1's
// absolute coordinates. Each instance therefore answers only for anchors
// that fall inside the monitor it was started on -- captured at init from
// its own starting position, BEFORE it is parked or moved anywhere.
export function isAnchorOnMonitor(monitor, anchorX, anchorY) {
  return (
    anchorX >= monitor.x &&
    anchorX < monitor.x + monitor.width &&
    anchorY >= monitor.y &&
    anchorY < monitor.y + monitor.height
  );
}
