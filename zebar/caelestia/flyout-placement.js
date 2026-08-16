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

// --- the dock's hover preview card ----------------------------------------

// Gap between the dock's top edge and the card's bottom edge. Same 8px as
// everything else in this desktop's frame, so the card reads as part of the
// same system.
export const PREVIEW_GAP_PX = 8;

// Vertical slack reserved BELOW the card inside its window, so the card has
// somewhere to rise in from without animating straight into its own clip edge
// -- the same trick SLIDE_PX plays horizontally for the layout menu. The card
// sits at `top: 0` and animates translateY(RISE) -> 0. Keep in step with
// dockpreview/preview.css's --rise.
export const PREVIEW_RISE_PX = 10;

// The thumbnail's box, fitted to the captured window's own aspect ratio.
//
// The first version of this was a fixed 16:9 box with the image CONTAINed
// inside it, which is stable but wrong for most windows on a tiling desktop:
// a tall half-screen split renders as a thin strip floating in a wide letterbox
// of empty surface. Fitting the box to the image instead means the card is
// shaped like the thing it is previewing.
//
// The bounds are what keep that from becoming silly. Without a minimum, a very
// wide window (a full-width terminal) collapses to a card too short to read a
// title next to; without a maximum, a portrait window produces a card taller
// than the space above the dock. Aspect is preserved between the two, and only
// sacrificed at the extremes -- where the CSS `object-fit: contain` letterboxes
// the remainder rather than stretching it.
export const PREVIEW_MAX_W = 360;
export const PREVIEW_MAX_H = 260;
export const PREVIEW_MIN_W = 200;
export const PREVIEW_MIN_H = 110;

export function previewBox(naturalWidth, naturalHeight, {
  maxW = PREVIEW_MAX_W, maxH = PREVIEW_MAX_H,
  minW = PREVIEW_MIN_W, minH = PREVIEW_MIN_H,
} = {}) {
  // Unknown dimensions (no capture yet, or an image that failed to decode)
  // fall back to 16:9 -- the shape most windows on this desktop are closest to,
  // so the card does not visibly re-shape itself the moment the real one lands.
  //
  // BOTH fall back together when EITHER is bad: pairing one real dimension with
  // a substituted one invents an aspect ratio that no window ever had, which is
  // worse than a known-wrong default because it looks deliberate.
  const ok = (n) => Number.isFinite(n) && n > 0;
  const both = ok(naturalWidth) && ok(naturalHeight);
  const nw = both ? naturalWidth : 16;
  const nh = both ? naturalHeight : 9;

  const scale = Math.min(maxW / nw, maxH / nh);
  let width = Math.round(nw * scale);
  let height = Math.round(nh * scale);

  // Grow a too-small dimension back to its minimum, following the aspect ratio
  // until the other bound stops it.
  if (width < minW) {
    width = minW;
    height = Math.min(maxH, Math.round((minW * nh) / nw));
  }
  if (height < minH) {
    height = minH;
    width = Math.min(maxW, Math.round((minH * nw) / nh));
  }
  return { width, height };
}

// Where the preview card's WINDOW goes, in physical pixels.
//
// Horizontally centred on the hovered dock item and then clamped into the
// monitor, so hovering the leftmost icon -- which is 27px from the screen edge,
// under a card ~13x wider than an icon -- cannot place half the card
// off-screen. Vertically it is pinned above the dock rather than centred on
// anything: the dock is at the bottom of the screen and the card is the thing
// that has to get out of its way.
//
// `dockTop` is the dock WINDOW's top edge, not the visible row's -- the dock's
// window is a fixed footprint that never moves (see dock.js's placeWindow), so
// it is the one stable thing to hang this off.
export function previewPlacement({
  anchorX, dockTop, cardWidth, cardHeight, monitor,
  gap = PREVIEW_GAP_PX, rise = PREVIEW_RISE_PX, leftLimit,
}) {
  const width = cardWidth;
  const height = cardHeight + rise;

  const unclampedX = Math.round(anchorX - width / 2);
  // The left bound is the DOCK's left edge, not the screen's. Clamping to the
  // screen put the card over the top of the left bar, which reads as one
  // surface sliding under another rather than as a card belonging to the dock.
  // Falls back to the monitor edge if no limit is supplied.
  const minX = Number.isFinite(leftLimit) ? Math.max(monitor.x, leftLimit) : monitor.x;
  // Math.max last, so a card wider than the space is pinned to the LEFT edge
  // rather than the right -- the icon and title live on that side.
  const maxX = monitor.x + monitor.width - width;
  const x = Math.max(minX, Math.min(unclampedX, maxX));

  // The card's own bottom (not the window's) rests `gap` above the dock; the
  // rise slack hangs below it inside the window.
  const y = Math.max(monitor.y, Math.round(dockTop - gap - cardHeight));

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
