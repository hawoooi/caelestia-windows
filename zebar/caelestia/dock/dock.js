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
// That strip costs nothing, because of where it sits. The desktop frame
// already paints an 8px `var(--surface)` band across the bottom of the screen
// (the `edges` widget), and that band is already click-dead -- a transparent
// Zebar window swallows clicks across its whole footprint, which is why the
// frame is built from small windows in the first place. The hot zone lies
// inside that existing dead band, so it takes no interactive area away from
// anything the user can actually click.

import * as zebar from '../bar/vendor/zebar.js';
import { dockItems, dockSignature, focusCommand, isSafeExeName } from '../dock-items.js';
import { appName, fetchIcon } from '../bar/entries/activeWindow.js';
import { startFullscreenWatch } from '../fullscreen.js';

// Height of the always-present strip that catches the cursor. Deliberately
// smaller than the frame's own 8px bottom band so it can never stick out below
// it into interactive territory.
export const HOT_ZONE_H = 6;

// The dock's own height when open, and the gap it leaves above the very bottom
// of the screen so it reads as sitting ON the frame rather than hanging off
// the edge of it.
export const DOCK_H = 56;

// How long the cursor must be off the dock before it slides away. Without a
// delay, crossing the gap between two icons -- or the instant during a
// resize when the window moves out from under the cursor -- reads as a
// mouseleave and the dock collapses under the user's hand.
export const CLOSE_DELAY_MS = 350;

// Matches dock.css's --dur. The window must not shrink until the slide-out
// animation has actually played.
export const SLIDE_MS = 260;

// The left bar's width. The dock starts just right of it so the two read as
// one L-shaped surface meeting at the bottom-left corner, rather than the dock
// sliding out from underneath the bar.
const BAR_W = 52;

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

      // Icons are fetched per exe and cached by createIconController, the same
      // controller the bar's activeWindow entry uses -- so it never starts a
      // second app-icon.exe while one is outstanding, caches failures as well
      // as successes, and races every call against a timeout.
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
  let closeTimer = null;
  let width = 0;

  // Both states are anchored to the BOTTOM of the monitor and differ only in
  // height, so the dock grows upward out of the edge rather than sliding along
  // it. Collapsed leaves only the hot zone.
  async function applyState(isOpen, contentWidth) {
    const h = isOpen ? px(DOCK_H) : px(HOT_ZONE_H);
    const w = Math.max(px(48), contentWidth);
    await win.setSize({ type: 'Physical', width: w, height: h });
    await win.setPosition({
      type: 'Physical',
      x: monitor.x + px(BAR_W),
      y: monitor.y + monitor.height - h,
    });
  }

  function measure() {
    const rect = dock.getBoundingClientRect();
    return Math.ceil(rect.width * scale);
  }

  async function slideIn() {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
    if (open) return;
    open = true;
    document.body.classList.add('open');
    // Size the window BEFORE the panel animates in, so the slide is not
    // clipped by a window that is still only the hot zone tall.
    width = measure();
    await applyState(true, width);
  }

  function slideOut() {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = setTimeout(async () => {
      closeTimer = null;
      if (!open) return;
      open = false;
      document.body.classList.remove('open');
      // Let the slide-out play before the window shrinks out from under it.
      await new Promise((r) => setTimeout(r, SLIDE_MS));
      if (!open) await applyState(false, width);
    }, CLOSE_DELAY_MS);
  }

  document.body.addEventListener('mouseenter', slideIn);
  document.body.addEventListener('mouseleave', slideOut);
  // A click on an item focuses another window, which moves the cursor's
  // effective target away; collapse rather than sitting there open.
  dock.addEventListener('click', slideOut);

  providers.onOutput(() => {
    latestItems = dockItems(providers.outputMap.komorebi);
    const changed = renderItems(latestItems);
    if (changed && open) {
      width = measure();
      applyState(true, width).catch((e) => console.warn('dock: could not resize', e));
    }
  });

  latestItems = dockItems(providers.outputMap.komorebi);
  renderItems(latestItems);
  width = measure();
  await applyState(false, width);

  // Disappear entirely when something goes fullscreen, exactly like the bar
  // and the frame -- a hot zone that pops a dock over a fullscreen game would
  // be worse than the taskbar this replaces.
  startFullscreenWatch(shell, (isFullscreen) => {
    document.body.classList.toggle('fullscreen-hidden', isFullscreen);
  });
}

init().catch((e) => console.error('dock failed to initialise', e));
