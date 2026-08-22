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
import {
  dockItems, dockSignature, focusCommand, isSafeHandle,
  listWindowsCommand, parseWindowList,
} from '../dock-items.js';
import { appName, fetchIcon } from '../bar/entries/activeWindow.js';
import { startFullscreenWatch } from '../fullscreen.js';
import {
  DOCK_PREVIEW_CMD_KEY, DOCK_PREVIEW_ACK_KEY, createChannel,
} from '../widget-channel.js';

// How much of the dock's footprint lies in territory that was ALREADY dead:
// the frame's 8px bottom band plus the 8px wallpaper gap above it. Only
// documentation now -- nothing positions off it -- but it is the number that
// says how much of placeWindow's permanent footprint costs nothing.
export const DEAD_STRIP_H = 16;

// How tall the dock itself is: purely a visual size, tuned together with the
// icon sizing in dock.css.
//
// This used to double as the hover trigger's reach, because hover was read off
// <body> and the body fills the window. Direct user feedback: "can we keep the
// same size but change the activation range?" -- they are two different
// concerns and are now two different numbers. See TRIGGER_H.
export const DOCK_H = 56;

// How far up from the bottom of the screen the dock arms.
//
// Independent of DOCK_H: the trigger is its own element pinned to the bottom
// of the window (see #trigger in index.html), so the dock can be as tall as it
// likes while still only arming near the very bottom edge. The user settled on
// this range as "perfect" at 40px, which is why it is pinned to that rather
// than derived from anything.
//
// Only OPENING uses it. Closing still watches the whole window, so once the
// dock is open the cursor can move up onto icons that sit above the trigger
// without it collapsing underneath.
export const TRIGGER_H = 40;

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

// The fillet joining the bar's right edge to the dock's top edge, and the
// amount the WINDOW is taller than the dock row in order to hold it -- the
// arch paints ABOVE the row, and a Zebar widget cannot paint outside its own
// window.
//
// The honest cost: the permanent transparent footprint grows by DOCK_W x
// ARCH_W, and only the leftmost ARCH_W of that strip is ever used. A
// transparent Zebar window swallows clicks across its whole footprint, so that
// is 380x16 of newly dead pixels directly above the dock.
//
// Paid deliberately, over the alternative of a fifth `corners` preset plus a
// cross-widget channel telling it when the dock is open: that would cost 16x16
// of dead space instead of 380x16, but it adds a window, a message pair, and a
// way for the two to disagree about whether the dock is showing. Keep in step
// with dock.css's --arch-w.
export const ARCH_W = 16;

// Grace period before the dock slides away, so crossing the gap between two
// icons does not make it flicker. Short, per "takes toooo long".
export const CLOSE_DELAY_MS = 120;

// Matches dock.css's --dur. The window must not drop back until the slide-out
// has actually played. Shortened from 260ms with the timings above -- a dock
// is a flick target, not a transition to admire.
export const SLIDE_MS = 140;

// --- the hover preview card ------------------------------------------------
//
// The card itself lives in the `dockpreview` widget -- see its module comment
// for why it has to be a separate window, which is NOT the usual "the bar is
// too narrow" reason. Everything the dock owns is here: when to ask for a
// card, and when to take it away. The dock's own window never changes shape.

// A dwell before asking for a card. Each capture is a ~100ms process spawn, so
// sliding along a row of icons must not fire one per icon passed over. Longer
// than the dock's own 120ms close grace on purpose: opening the dock and
// flicking straight to the app you wanted should not leave a trail of
// screenshots behind it.
export const PREVIEW_DELAY_MS = 90;

// Grace after leaving an icon before the card goes. Crossing the 4px gap
// between two icons must not make it flicker -- the next icon's mouseenter
// cancels this, so in practice it only fires when the pointer has genuinely
// left the row.
export const PREVIEW_CLOSE_MS = 140;

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
const trigger = document.getElementById('trigger');

// One source of truth for the trigger height and the arch size: JS owns both,
// CSS reads them.
document.documentElement.style.setProperty('--trigger-h', `${TRIGGER_H}px`);
document.documentElement.style.setProperty('--arch-w', `${ARCH_W}px`);

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

// The OS window list, refreshed only while the dock is open. komorebi pushes
// its own changes, but nothing pushes "an ignored app opened a window", so
// this half has to be polled -- and, per this pack's standing rule, a poll
// must not exist while nothing is looking at it.
const WINDOW_POLL_MS = 1000;
let windowList = [];
let windowTimer = null;
let windowInFlight = false;

async function refreshWindows() {
  if (windowInFlight || !shell) return;
  windowInFlight = true;
  try {
    const cmd = listWindowsCommand();
    const res = await shell.shellExec(cmd.program, cmd.args);
    windowList = parseWindowList(res && res.stdout);
    render();
  } catch (e) {
    // Nonzero exit means "nothing to report"; leave the last list in place.
  } finally {
    windowInFlight = false;
  }
}

function stopWindowPoll() {
  if (windowTimer !== null) { clearInterval(windowTimer); windowTimer = null; }
}
function startWindowPoll() {
  stopWindowPoll();
  refreshWindows();
  windowTimer = setInterval(refreshWindows, WINDOW_POLL_MS);
}

let rendered = new Map();     // exe key -> { root, img, badge, hwnd, winTitle }
let lastSignature = null;
let latestItems = [];

// Drives the preview card. Assigned by init(), so it is null for the brief
// window in which items can already be rendered but the channel does not yet
// exist -- hovering then simply shows no card rather than throwing out of an
// event handler. Deliberately a module-scope binding rather than a property
// hung on `window`: the previous attempt at this bridged the same scope gap
// with globals, which works but makes the dock's wiring reachable (and
// breakable) from any other script on the page.
let preview = null;

// Both sources feed one render. Called from the komorebi provider tick AND
// from the window-list poll, so whichever updates first is reflected.
function render() {
  latestItems = dockItems(providers.outputMap.komorebi, windowList);
  renderItems(latestItems);
}

function renderItems(items) {
  const signature = dockSignature(items);
  if (signature === lastSignature) return false;
  debugLog(`render ${signature}`);
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
      // The identity the preview driver works in. Read back off the DOM by the
      // `:hover` re-check and the mousemove repair path, both of which start
      // from an element rather than from a closure.
      root.dataset.key = item.key;

      const img = document.createElement('img');
      img.className = 'dock__icon';
      img.alt = '';

      const badge = document.createElement('span');
      badge.className = 'dock__badge';

      root.append(img, badge);
      root.addEventListener('click', () => focus(rendered.get(item.key)?.hwnd ?? item.hwnd));
      // Hover drives the preview card. These fire on the ITEM, not the window,
      // so crossing the gap between two icons is a leave followed immediately
      // by an enter -- which the driver's close grace absorbs.
      root.addEventListener('mouseenter', () => { if (preview) preview.enter(item.key); });
      root.addEventListener('mouseleave', () => { if (preview) preview.leave(); });
      dock.append(root);
      refs = { root, img, badge, hwnd: item.hwnd, winTitle: '' };
      rendered.set(item.key, refs);

      // One app-icon.exe at a time, cached per exe -- see loadIcon above.
      loadIcon(item.exe, (dataUrl) => {
        if (dataUrl) { img.src = dataUrl; img.classList.remove('dock__icon--missing'); }
        else { img.classList.add('dock__icon--missing'); }
      });
    }

    refs.hwnd = item.hwnd;
    const label = appName(item.exe);
    // The REAL window title, for the preview card's header. Distinct from the
    // tooltip below, which is the app name and a window count -- the card is
    // showing one specific window, so it names that window.
    refs.winTitle = (Array.isArray(item.titles) && item.titles[0]) || '';
    refs.label = label;
    // No `title` attribute, deliberately. It used to carry the app name and a
    // window count as a native tooltip; the preview card now says the same
    // thing better, and Windows drew both at once -- the card above the icon
    // and a small grey tooltip below it, naming the same app twice.
    refs.root.setAttribute('aria-label',
      item.count > 1 ? `${label} (${item.count} windows)` : label);
    refs.root.classList.toggle('dock__item--focused', item.focused);
    refs.root.classList.toggle('dock__item--minimized', item.minimized);
    refs.badge.textContent = item.count > 1 ? String(item.count) : '';
    refs.badge.classList.toggle('dock__badge--hidden', item.count <= 1);
  }

  // Re-append in provider order -- but ONLY when the order has actually
  // changed, and that condition is the whole point.
  //
  // `appendChild` on a node that is already in the document MOVES it: a remove
  // followed by an insert. Doing that to the icon under the pointer destroys
  // its hover state and fires a spurious `mouseleave` on the way past, which
  // the dock reads as "the pointer left" and starts closing on.
  //
  // That is the reported flicker -- "the taskbar sometimes flickers, making do
  // half the closing animation just to reopen again". Measured with the cursor
  // verified parked by GetCursorPos: `render` at +87ms, `close` at +146ms.
  // Opening the dock starts the window-list poll, whose first refresh renders
  // immediately, which re-appended every icon under a stationary pointer.
  //
  // The order almost never changes (dockItems is first-appearance ordered), so
  // in practice this now moves nothing at all.
  const desired = items.map((i) => rendered.get(i.key)).filter(Boolean);
  const current = Array.from(dock.children).filter((el) => el.classList.contains('dock__item'));
  const orderMatches = desired.length === current.length
    && desired.every((refs, i) => refs.root === current[i]);
  if (!orderMatches) {
    debugLog('reorder');
    for (const refs of desired) dock.append(refs.root);
  }
  return true;
}

function focus(hwnd) {
  if (!shell || !isSafeHandle(hwnd)) return;
  const { program, args } = focusCommand(hwnd);
  // Fail-soft, like every other shell-out in this pack: a failed focus warns
  // and never throws out of a click handler.
  shell.shellExec(program, args).catch((e) => console.warn(`focus ${hwnd} failed`, e));
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
  let fullscreen = false;

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
    // DOCK_H + ARCH_W tall: the dock row is pinned to the BOTTOM of the window
    // (dock.css) and the extra strip on top is where the corner fillet paints.
    const height = px(DOCK_H + ARCH_W);
    await win.setSize({
      type: 'Physical',
      width: px(DOCK_W),
      height,
    });
    await win.setPosition({
      type: 'Physical',
      x: monitor.x + px(BAR_W),
      y: monitor.y + monitor.height - height,
    });
  }

  // PLACED FIRST, before any provider, DOM or shell work below.
  //
  // This call used to live at the very END of init(), ~250 lines down, after
  // the item store, the preview card, every listener and the first render().
  // That made correct PLACEMENT depend on all of that succeeding, and the
  // failure it produced was the worst-looking one available: the window stays
  // at the zpack preset's declared 48x6 at (0,0), so the dock appears as a
  // sliver welded to the top-left corner of the screen rather than sitting at
  // the bottom next to the bar. Reported as zebar "not auto navigating into
  // the correct page on start". Seen twice, both times after an unhealthy
  // start -- once with an orphaned process holding the asset-server socket,
  // once with the disk at 99.2% full -- because anything that stalls the
  // widget's own setup also strands its window at the origin.
  //
  // Placement depends on nothing but `win`, `monitor` and `px`, all of which
  // exist by this line, so there is no reason for it to wait behind work that
  // can fail. Doing it here downgrades a broken start from "the dock is in
  // the wrong place" to "the dock is in the right place with some content
  // missing", which is both less alarming and far easier to diagnose.
  //
  // Fail-soft, matching dashboard.js, which already placed itself early and
  // is why it was never affected: a placement error is logged, and the rest
  // of init still runs rather than the whole dock dying on it.
  try {
    await placeWindow();
  } catch (e) {
    console.error('dock: could not place the window', e);
  }

  // With the window static, these are ordinary hover events again: nothing
  // moves under the cursor, so nothing fires spuriously and nothing is
  // swallowed. No polling, no coordinate guards, no settle windows.
  let closeTimer = null;
  // When the slide-in last started. slideOut uses it to refuse to believe a
  // mouseleave that arrives while the row is still transforming under the
  // pointer -- see the grace check there.
  let openedAt = 0;

  // --- driving the preview card --------------------------------------------
  //
  // One-way: the dock posts, the card listens. The card never runs anything
  // itself beyond the capture, and never decides when to appear -- which is
  // what lets it skip a fullscreen poll of its own, since the gate below is
  // the same one that already governs whether the dock opens at all.
  const previewChannel = createChannel(localStorage, window, {
    sendKey: DOCK_PREVIEW_CMD_KEY,
    receiveKey: DOCK_PREVIEW_ACK_KEY,
  });

  preview = (() => {
    let dwellTimer = null;
    let dwellKey = null;           // which icon the pending dwell is counting for
    let closeCardTimer = null;
    let shown = null;              // the key whose card is up, or null

    const cancelDwell = () => {
      if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
    };
    const cancelClose = () => {
      if (closeCardTimer !== null) { clearTimeout(closeCardTimer); closeCardTimer = null; }
    };

    function post(key) {
      const refs = rendered.get(key);
      if (!refs || !isSafeHandle(refs.hwnd)) return;
      const rect = refs.root.getBoundingClientRect();
      previewChannel.post({
        open: true,
        hwnd: refs.hwnd,
        title: refs.winTitle || refs.label || '',
        app: refs.label || '',
        // The icon travels WITH the message rather than being re-extracted on
        // the other side. The dock already has it in memory, and the standing
        // rule in this pack is that a process spawn has to justify itself --
        // a few KB through localStorage, overwriting one key, does not need
        // app-icon.exe run a second time in a second widget.
        icon: refs.img.src || '',
        // Screen coordinates, physical pixels. The window's own x is fixed at
        // the bar's right edge (placeWindow), so the item's position inside it
        // is the only variable part.
        anchorX: Math.round(monitor.x + px(BAR_W) + (rect.x + rect.width / 2) * scale),
        // The dock WINDOW's top, not the row's. The window is ARCH_W taller
        // (it carries the corner fillet above the row), and the card has to
        // clear the whole window -- overlapping it put two top_most windows on
        // top of each other with no defined z-order, which is what made the
        // dock flicker while the card resized over it.
        dockTop: monitor.y + monitor.height - px(DOCK_H),
        // The card clamps to the DOCK's left edge rather than the screen's, so
        // hovering the first icon does not slide it over the top of the bar.
        dockLeft: monitor.x + px(BAR_W),
      });
      shown = key;
      debugLog(`preview open ${key}`);
    }

    return {
      // Safe to call repeatedly for the same icon -- `mousemove` below does
      // exactly that. An already-running dwell for the same key is left alone
      // rather than restarted, so a jittering hand cannot hold the countdown
      // at zero forever.
      enter(key) {
        cancelClose();
        // Same gate as slideIn, and for the same reason: a card is a hover
        // activation, so it must be genuinely inert in fullscreen rather than
        // merely invisible.
        if (fullscreen || document.body.classList.contains('fullscreen-hidden')) return;
        if (!open) return;
        if (shown === key) return;                       // already showing this one
        if (dwellKey === key && dwellTimer !== null) return;   // already counting down
        cancelDwell();
        debugLog(`preview arm ${key}`);
        dwellKey = key;
        dwellTimer = setTimeout(() => { dwellTimer = null; post(key); }, PREVIEW_DELAY_MS);
      },

      // Leaving an icon does NOT cancel the pending dwell, and that is the
      // whole point of this shape.
      //
      // Measured on this machine: with the pointer provably stationary on an
      // icon (GetCursorPos checked), the item fired `mouseenter` and then
      // `mouseleave` 12ms later, and no further `mouseenter` ever arrived --
      // because none can, while the cursor does not move. Cancelling the dwell
      // there stranded the card permanently. This pack has hit fabricated
      // `mouseleave` before (see the dashboard's own close path), and the
      // lesson is the same: a leave is a HINT, and the decision it feeds has to
      // verify before acting.
      //
      // So the close is scheduled instead, and re-checks `:hover` when it
      // fires. Still on an icon -> the leave was noise, re-arm. Genuinely gone
      // -> dismiss, which is also what cancels the dwell.
      leave() {
        debugLog(`preview leave shown=${shown} dwell=${dwellKey}`);
        cancelClose();
        closeCardTimer = setTimeout(() => {
          closeCardTimer = null;
          const still = dock.querySelector('.dock__item:hover');
          if (still && still.dataset.key) {
            debugLog('preview leave was spurious');
            this.enter(still.dataset.key);
            return;
          }
          this.dismiss();
        }, PREVIEW_CLOSE_MS);
      },

      dismiss() {
        cancelDwell();
        cancelClose();
        if (shown === null) return;
        debugLog(`preview dismiss ${shown}`);
        shown = null;
        previewChannel.post({ open: false });
      },
    };
  })();

  // The repair path for a hover state that events alone got wrong. `mouseenter`
  // fires once, on the crossing; if that crossing is missed or immediately
  // undone, nothing else will ever announce which icon the pointer is on.
  // `mousemove` announces it continuously, for free, with no poll and no new
  // process -- so the first real movement after a bad crossing puts it right.
  dock.addEventListener('mousemove', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.dock__item') : null;
    if (el && el.dataset.key) preview.enter(el.dataset.key);
  });

  function slideIn() {
    // Direct user feedback: "the bottom custom taskbar hover shouldn't
    // activate when i am in fullscreen. this goes with any other
    // hover-activation widgets."
    //
    // Hiding the content with CSS was not enough: the trigger still fired,
    // the open class still toggled, and the transition still ran -- invisible,
    // but it WAS activating. Opening is now refused outright while a
    // fullscreen window is up, so the hover is genuinely inert rather than
    // merely unseen. dock.css also drops pointer-events on the trigger, so in
    // practice the event does not even arrive; this is the belt to that
    // braces, and the one that keeps the state machine honest.
    // Reads the CLASS, not just the flag, so there is one source of truth --
    // the flag alone could drift from what the DOM says if anything else ever
    // sets the class, and the two disagreeing is exactly the kind of silent
    // divergence that makes this look fixed while still activating.
    if (fullscreen || document.body.classList.contains('fullscreen-hidden')) return;
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
    if (open) return;
    open = true;
    openedAt = Date.now();
    debugLog('open');
    document.body.classList.add('open');
    // The list only has to be current while it is being looked at.
    startWindowPoll();
  }

  function slideOut() {
    if (closeTimer !== null) clearTimeout(closeTimer);
    // A short grace only, so crossing the gap between two icons does not
    // flicker. Direct user feedback on the old 350ms + 260ms: "takes toooo
    // long".
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!open) return;

      // DO NOT TRUST THE mouseleave THAT GOT US HERE.
      //
      // Reported as: "when i hover on taskbar to see the preview, the taskbar
      // sometimes flickers, making do half the closing animation just to
      // reopen again". That is precisely what a fabricated leave looks like --
      // the close starts, the slide plays part way, a real mouseenter arrives
      // and reopens it.
      //
      // This pack has measured fabricated leaves before: a dock item fired
      // mouseleave 12ms after mouseenter with the pointer provably stationary
      // (GetCursorPos checked), and the dashboard hit the same thing. Every
      // other close decision here already re-checks; the dock's own was the
      // last one still taking the event at face value, which is why it was the
      // one still flickering.
      //
      // GRACE WHILE THE SLIDE-IN IS STILL PLAYING.
      //
      // Measured, cursor verified parked by GetCursorPos: the dock opens, and
      // ~150ms later it closes -- which is inside the 140ms slide. The row is
      // transforming under the pointer during that window, and this pack has
      // three prior rounds of evidence that a WebView2 hover state does not
      // survive geometry changing beneath a stationary cursor. `:hover` reports
      // FALSE at that moment, which is why the re-check below never caught it.
      //
      // A hypothesis that DID NOT survive testing, recorded so it is not tried
      // again: the DOM re-render from the window-list refresh that fires on
      // open. It correlated beautifully -- `render` at +87ms, `close` at
      // +146ms, twice -- and skipping that render entirely changed nothing.
      // The close still landed at +152ms. Correlation, not cause.
      //
      // So: during the slide, a leave is not believable. Re-arm and re-decide
      // once the animation has settled.
      if (Date.now() - openedAt < SLIDE_MS + 60) {
        debugLog('close deferred (slide still playing)');
        slideOut();
        return;
      }

      // If the pointer is genuinely still inside the window, the leave was
      // noise: stay open and let the next real one close us.
      if (document.body.matches(':hover')) {
        debugLog('close cancelled (still hovered)');
        // Re-arm rather than simply returning. If the pointer really has left
        // and `:hover` is the thing lying, no further mouseleave will ever
        // arrive -- the pointer is already outside -- and the dock would hang
        // open forever. Re-checking on the same grace period self-corrects.
        //
        // This only loops while a leave has fired AND the document still
        // claims to be hovered, and it costs one class check per 120ms with no
        // process spawn. The dock's own window-list poll, running the whole
        // time it is open, spawns a process every second.
        slideOut();
        return;
      }

      open = false;
      debugLog('close');
      document.body.classList.remove('open');
      stopWindowPoll();
      // A card cannot outlive the dock it belongs to -- it is anchored to an
      // icon that is no longer on screen.
      preview.dismiss();
    }, CLOSE_DELAY_MS);
  }

  // OPEN only from the bottom strip, so the dock does not arm the moment the
  // cursor drifts near the bottom-left. CLOSE from the whole window, so moving
  // up onto an icon above the trigger keeps it open.
  trigger.addEventListener('mouseenter', slideIn);
  document.body.addEventListener('mouseleave', slideOut);

  // A click on an item focuses another window, which moves the cursor's
  // effective target away; collapse rather than sitting there open. The card
  // goes immediately rather than waiting out the dock's own close grace --
  // the click already answered the question the preview was asking.
  dock.addEventListener('click', () => { preview.dismiss(); slideOut(); });

  providers.onOutput(() => {
    render();
  });

  render();
  // The window was already placed at the TOP of init, deliberately -- see the
  // comment on that call. It is placed once and never again, so there is
  // nothing to do here.

  // Disappear entirely when something goes fullscreen, exactly like the bar
  // and the frame -- a hot zone that pops a dock over a fullscreen game would
  // be worse than the taskbar this replaces.
  startFullscreenWatch(shell, (isFullscreen) => {
    fullscreen = isFullscreen;
    document.body.classList.toggle('fullscreen-hidden', isFullscreen);
    // Something going fullscreen while the dock is already open must retract
    // it, not leave it sitting over the top of the fullscreen window.
    if (isFullscreen && open) {
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      open = false;
      debugLog('close:fullscreen');
      document.body.classList.remove('open');
      stopWindowPoll();
    }
    // Unconditional, not inside the `open` branch above: a card can be up
    // while the dock is mid-close, and something going fullscreen must take
    // it away either way.
    if (isFullscreen) preview.dismiss();
  });
}

init().catch((e) => console.error('dock failed to initialise', e));
