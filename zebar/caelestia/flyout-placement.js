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
// The bottom strip a bar flyout must stay out of: the dock's whole window.
//
// This is dock.js's DOCK_H + ARCH_W, and the two are a matched pair -- there is
// nothing to derive it from here, since the bar and the dock are separate
// widgets that never talk.
//
// Why it exists: the dock's window is a PERMANENT footprint, transparent above
// the row but still swallowing every click inside it, and hovering it opens the
// dock. A flyout whose bottom reached into that strip was unreachable --
// reported as "when i click the side menu open, i cannot access the bottom menu
// of komorebi layout since it lives inside the zone of the taskbar hover".
// Reaching for the last item both failed to click it and popped the dock out.
export const DOCK_RESERVED_H = 72;

export function menuPlacement({
  anchorX, anchorY, panelWidth, panelHeight, monitor,
  bottomReserved = DOCK_RESERVED_H,
}) {
  const width = panelWidth + SLIDE_PX;
  const height = panelHeight;
  const x = Math.round(anchorX + GAP_PX - SLIDE_PX);
  const unclampedY = Math.round(anchorY - height / 2);
  const minY = monitor.y;
  // The usable bottom is the dock's top edge, less the frame's own gap -- not
  // the screen's bottom. Every one of these flyouts opens directly beside the
  // bar, which is inside the dock's horizontal span, so this applies to all of
  // them rather than being conditional on overlap.
  //
  // Math.max last, so a panel taller than the space is pinned to the TOP edge
  // (clipped at the bottom) rather than the other way round -- the active
  // marker and the first items stay visible either way.
  const maxY = monitor.y + monitor.height - bottomReserved - GAP_PX - height;
  const y = Math.max(minY, Math.min(unclampedY, maxY));
  return { x, y, width, height };
}

// --- the dock's hover preview card ----------------------------------------

// Gap between the dock's top edge and the card's bottom edge. Same 8px as
// everything else in this desktop's frame, so the card reads as part of the
// same system.
export const PREVIEW_GAP_PX = 10;

// The card used to reserve slack below itself to animate up into. It does not
// animate any more -- direct user feedback, "make it so that taskbar hover
// previews are instant and have no animation" -- so the window is exactly the
// card, with nothing under it.
//
// Removing the slack also removed 10px of overlap with the dock's window,
// which mattered for more than tidiness: see previewPlacement below.
export const PREVIEW_RISE_PX = 0;

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
// `dockTop` is the dock's VISIBLE row, not its window. Those differ: the dock's
// window is ARCH_W taller than the row, to hold the corner fillet above it.
//
// Measuring from the window was tried, on the theory that the card's window
// overlapping the dock's was causing the reported flicker ("the taskbar
// sometimes flickers, making do half the closing animation just to reopen").
// It was not. The flicker came from the dock re-appending its icon nodes on a
// window-list refresh, which moves the element under the pointer and fires a
// spurious mouseleave -- measured with the cursor verified parked, `render` at
// +87ms and `close` at +146ms. That is fixed in dock.js's renderItems.
//
// Clearing the whole window also cost 16px of empty space under the card that
// the eye reads as padding, against 10px on its sides -- reported as "the
// bottom padding is a lot bigger than the side padding". Measuring from the
// visible row puts the gap back where it looks right. The residual overlap
// with the dock's transparent fillet strip is tolerated deliberately: the
// flicker's real cause is fixed, and this pack's own isolation test found an
// overlapping card harmless across 5 clean trials.
export function previewPlacement({
  anchorX, dockTop, cardWidth, cardHeight, monitor,
  gap = PREVIEW_GAP_PX, rise = PREVIEW_RISE_PX, leftLimit,
}) {
  const width = cardWidth;
  const height = cardHeight + rise;

  const unclampedX = Math.round(anchorX - width / 2);
  // The left bound is the DOCK's left edge, not the screen's, PLUS the same
  // gap the card already keeps above the dock. Clamping to the screen put the
  // card over the top of the left bar; clamping to the dock's edge exactly
  // left it touching the bar with no breathing room -- direct user feedback,
  // "align the preview so that it has padding on left and bottom away from
  // taskbar and left bar". One `gap` for both sides, so the card is inset
  // identically from the two surfaces it sits against.
  //
  // Falls back to the monitor edge if no limit is supplied.
  const minX = Number.isFinite(leftLimit) ? Math.max(monitor.x, leftLimit + gap) : monitor.x;
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
