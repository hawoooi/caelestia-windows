// The dock: a replacement for the Windows taskbar, in the same visual
// language as the left bar.
//
// Direct user feedback: "The color should be the same as the left bar, and you
// should remove the right half of the taskbar ... The windows icon should also
// go, and only keep opened apps on it, It should fit in style along with the
// left bar, and have rounded top corners, it should slide in and out of the
// bottom left corner when hovered."
//
// None of that is reachable by theming the real taskbar. Windows 11 offers no
// way to remove the tray or the Start button, no way to round its corners, and
// no way to turn it into a bottom-left slide-out -- third-party shell mods
// (ExplorerPatcher, StartAllBack) exist precisely because the shell does not.
// So this is a Zebar widget instead, which is what the rest of this desktop
// already is. The tray, clock, volume and network the real taskbar carried are
// already covered by the panels flyout, so nothing is lost by replacing it.
//
// THE HOVER PROBLEM, and why the window is never zero-sized:
//
// The flyouts in this pack park at 1x1 while closed, because they are opened
// by a click somewhere else (a bar button). This one is opened by hovering the
// screen edge -- and a 1x1 window cannot notice the cursor. So the dock keeps
// a permanent HOT ZONE: a strip a few pixels tall along the bottom, which is
// a real window and does receive mouseenter.
//
// That strip is cheap because of where it sits: the bottom 8px overlap the
// desktop frame's own band, which is already click-dead, and the top 8px lie
// in the wallpaper gap above it, where there is nothing to click either. See
// DEAD_STRIP_H for what that covers -- the band is a top_most window that
// wins the hit test, so a hot zone living only inside it is unreachable.

import * as zebar from '../bar/vendor/zebar.js';
import { dockItems, dockSignature, focusCommand, isSafeExeName } from '../dock-items.js';
import { appName, fetchIcon } from '../bar/entries/activeWindow.js';
import { startFullscreenWatch } from '../fullscreen.js';

// How much of the dock's footprint lies in territory that was ALREADY dead:
// the frame's 8px bottom band plus the 8px wallpaper gap above it. Only
// documentation now -- nothing positions off it -- but it is the number that
// says how much of placeWindow's permanent footprint costs nothing.
export const DEAD_STRIP_H = 16;

// The dock's own height when open, and the gap it leaves above the very bottom
// of the screen so it reads as sitting ON the frame rather than hanging off
// the edge of it.
export const DOCK_H = 56;

// The dock's fixed width. Fixed, and deliberately not derived from content.
//
// Deriving it was the first attempt and it failed twice over. On a cold start
// the komorebi provider has not emitted yet, so the dock measures empty and
// the strip came out 48px wide -- and because the collapsed size was only
// recomputed while OPEN, it stayed 48px even once apps appeared. Worse, even
// working correctly it would mean the target you have to aim at SHRINKS as you
// close windows, which is precisely backwards.
//
// A fixed strip is a constant, findable target: the bottom-left corner, always
// the same size. It costs nothing extra, since the whole strip lies in the
// frame band and the wallpaper gap, neither of which is clickable.
export const DOCK_W = 380;

// Grace period before the dock slides away, so crossing the gap between two
// icons does not make it flicker. Short, per "takes toooo long".
export const CLOSE_DELAY_MS = 120;

// Matches dock.css's --dur. The window must not drop back until the slide-out
// has actually played. Shortened from 260ms with the timings above -- a dock
// is a flick target, not a transition to admire.
export const SLIDE_MS = 140;

// The left bar's width. The dock starts just right of it so the two read as
// one L-shaped surface meeting at the bottom-left corner, rather than the dock
// sliding out from underneath the bar.
const BAR_W = 52;

// A small rolling log of hover events, readable as window.__dockEvents from a
// CDP session. This behaviour can only be reproduced with a real cursor, so
// when it misbehaves the only alternative to guessing is a record of what
// actually fired.
const DEBUG_LOG_MAX = 60;
window.__dockEvents = [];
function debugLog(what) {
  window.__dockEvents.push(`${Date.now()} ${what}`);
  if (window.__dockEvents.length > DEBUG_LOG_MAX) window.__dockEvents.shift();
}

const dock = document.getElementById('dock');

const providers = zebar.createProviderGroup({ komorebi: { type: 'komorebi' } });
const shell = zebar.shellExec ? zebar : null;
// createIconController (activeWindow.js) is deliberately SINGLE-SLOT: it
// tracks one `currentExe` and returns early when asked for the same one
// again, because the bar only ever shows the focused app's icon. The dock
// needs N icons at once, so reusing it would make every item after the first
// silently overwrite the previous item's tracked exe. fetchIcon is the piece
// worth sharing -- it owns the caching (successes AND failures, so an
// icon-less exe is never re-probed) and the timeout.
//
// The one thing fetchIcon does not own is non-overlap, which the controller
// used to provide, so requests are chained: one app-icon.exe at a time, in
// order. This pack has lost two debugging sessions to unsupervised shellExec
// children (see fullscreen.js).
const iconCache = new Map();
let iconChain = Promise.resolve();
function loadIcon(exe, onResolve) {
  iconChain = iconChain
    .then(() => fetchIcon(shell, exe, iconCache, undefined))
    .then((dataUrl) => onResolve(dataUrl))
    .catch(() => onResolve(null));
}

let rendered = new Map();     // exe key -> { root, img, badge }
let lastSignature = null;
let latestItems = [];

function renderItems(items) {
  const signature = dockSignature(items);
  if (signature === lastSignature) return false;
  lastSignature = signature;

  const live = new Set(items.map((i) => i.key));
  for (const [key, refs] of rendered) {
    if (!live.has(key)) { refs.root.remove(); rendered.delete(key); }
  }

  for (const item of items) {
    let refs = rendered.get(item.key);
    if (!refs) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'dock__item';
      root.dataset.exe = item.exe;

      const img = document.createElement('img');
      img.className = 'dock__icon';
      img.alt = '';

      const badge = document.createElement('span');
      badge.className = 'dock__badge';

      root.append(img, badge);
      root.addEventListener('click', () => focus(item.exe));
      dock.append(root);
      refs = { root, img, badge };
      rendered.set(item.key, refs);

      // One app-icon.exe at a time, cached per exe -- see loadIcon above.
      loadIcon(item.exe, (dataUrl) => {
        if (dataUrl) { img.src = dataUrl; img.classList.remove('dock__icon--missing'); }
        else { img.classList.add('dock__icon--missing'); }
      });
    }

    const label = appName(item.exe);
    refs.root.title = item.count > 1 ? `${label} (${item.count} windows)` : label;
    refs.root.classList.toggle('dock__item--focused', item.focused);
    refs.badge.textContent = item.count > 1 ? String(item.count) : '';
    refs.badge.classList.toggle('dock__badge--hidden', item.count <= 1);
  }

  // Re-append in provider order; appendChild moves existing nodes, so this
  // keeps the row stable rather than rebuilding it.
  for (const item of items) {
    const refs = rendered.get(item.key);
    if (refs) dock.append(refs.root);
  }
  return true;
}

function focus(exe) {
  if (!shell || !isSafeExeName(exe)) return;
  const { program, args } = focusCommand(exe);
  // Fail-soft, like every other shell-out in this pack: a failed focus warns
  // and never throws out of a click handler.
  shell.shellExec(program, args).catch((e) => console.warn(`eager-focus ${exe} failed`, e));
}

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  // The monitor this instance belongs to, captured from its STARTING position
  // before anything below moves it -- the same matched pair with the zpack
  // preset the flyouts rely on: anchor top_left at offset (0,0), so
  // outerPosition() at this exact moment IS the monitor's origin.
  //
  // This preset was briefly bottom_left/offsetX 52px, which broke that
  // invariant silently: outerPosition then returns the WINDOW's corner, not
  // the monitor's, and every calculation below double-counted it -- the dock
  // landed at (104, 2868), i.e. one bar-width too far right and a full screen
  // height below the desktop. Change the preset and this together, or not at
  // all.
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('dock: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };

  const scale = window.devicePixelRatio || 1;
  const px = (n) => Math.round(n * scale);

  let open = false;

  // Both states are anchored to the BOTTOM of the monitor and differ only in
  // height, so the dock grows upward out of the edge rather than sliding along
  // it. Collapsed leaves only the hot zone.
  // The window is placed ONCE, at startup, and never touched again.
  //
  // Three rounds of hover bugs all had the same root cause, and it took
  // reading the event log to see it: ANY geometry change -- resize or move --
  // clears WebView2's hover state under a stationary cursor. First it fired
  // synthetic mouseleave (dock flickered). Filtering those by coordinates
  // swallowed real leaves too (dock stuck open). Switching to polling
  // `:hover` instead of events did not help either, because the geometry
  // change is what invalidates `:hover` in the first place -- the log showed
  // open/close cycling at exactly the poll period.
  //
  // So the window never moves. It sits at its full open size permanently and
  // the slide is pure CSS transform on .dock, which moves no window and
  // therefore cannot disturb hover at all. Hover detection becomes ordinary
  // mouseenter/mouseleave and simply works.
  //
  // THE TRADE-OFF, stated plainly: the window is now a permanent footprint at
  // the bottom-left, and a transparent Zebar window swallows clicks across its
  // whole footprint. The bottom 16px lie in the frame band and the wallpaper
  // gap, which were already dead -- but the rest overlaps real window content.
  // A narrower, shorter dock keeps that small, and it sits exactly where the
  // dock is expected to be. Removing it entirely needs a second widget (a
  // never-moving hot-zone window driving a separate dock window), which is the
  // refinement to make if this ever proves annoying.
  async function placeWindow() {
    await win.setSize({
      type: 'Physical',
      width: px(DOCK_W),
      height: px(DOCK_H),
    });
    await win.setPosition({
      type: 'Physical',
      x: monitor.x + px(BAR_W),
      y: monitor.y + monitor.height - px(DOCK_H),
    });
  }

  // With the window static, these are ordinary hover events again: nothing
  // moves under the cursor, so nothing fires spuriously and nothing is
  // swallowed. No polling, no coordinate guards, no settle windows.
  let closeTimer = null;

  function slideIn() {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
    if (open) return;
    open = true;
    debugLog('open');
    document.body.classList.add('open');
  }

  function slideOut() {
    if (closeTimer !== null) clearTimeout(closeTimer);
    // A short grace only, so crossing the gap between two icons does not
    // flicker. Direct user feedback on the old 350ms + 260ms: "takes toooo
    // long".
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!open) return;
      open = false;
      debugLog('close');
      document.body.classList.remove('open');
    }, CLOSE_DELAY_MS);
  }

  document.body.addEventListener('mouseenter', slideIn);
  document.body.addEventListener('mouseleave', slideOut);

  // A click on an item focuses another window, which moves the cursor's
  // effective target away; collapse rather than sitting there open.
  dock.addEventListener('click', slideOut);

  providers.onOutput(() => {
    latestItems = dockItems(providers.outputMap.komorebi);
    renderItems(latestItems);
  });

  latestItems = dockItems(providers.outputMap.komorebi);
  renderItems(latestItems);
  // Placed once, and never again -- see placeWindow.
  await placeWindow();

  // Disappear entirely when something goes fullscreen, exactly like the bar
  // and the frame -- a hot zone that pops a dock over a fullscreen game would
  // be worse than the taskbar this replaces.
  startFullscreenWatch(shell, (isFullscreen) => {
    document.body.classList.toggle('fullscreen-hidden', isFullscreen);
  });
}

init().catch((e) => console.error('dock failed to initialise', e));
