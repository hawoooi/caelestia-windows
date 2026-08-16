// The dock's hover preview card: a thumbnail of the window behind a dock icon,
// the way the real Windows taskbar shows one.
//
// **Why this is a second widget, and why that is not the usual reason.**
//
// The other flyouts in this pack are separate widgets because the bar's window
// is 52px wide and they physically cannot paint outside it. That is not the
// case here -- the dock's window could simply be made taller. It was, in a
// previous attempt, and it was reverted: growing the dock's OWN window is the
// single thing three rounds of hover bugs proved it must never do (dock.js's
// placeWindow comment has the full account). The card grew, the dock lost
// hover, and it collapsed the card it had just opened.
//
// So this window is PASSIVE. It is never hovered, never opened by the pointer,
// and the dock's window never changes shape. It parks at 1x1 like every other
// flyout here, and only the dock decides what it shows and when it goes away.
//
// That "a separate window resizing above the dock is harmless" was MEASURED
// before this file existed, not assumed -- 5 clean trials with the card against
// 5 control trials without it, cursor held on a dock item, hover kept in all
// 10. (The first two attempts at that measurement reported failures that turned
// out to be the real user moving the mouse; the harness now discards any trial
// where GetCursorPos has drifted.)
//
// **What is deliberately NOT here: a fullscreen poll.** Every other top_most
// widget in this pack runs its own fullscreen-detect.exe poll, and the pack
// already spawns that ~10x/second across nine widgets -- a real, documented
// cost. This card needs none: it only ever appears when the dock tells it to,
// and the dock already refuses to open at all while something is fullscreen.
// One gate, in the widget that owns the gesture.

import * as zebar from '../bar/vendor/zebar.js';
import { createWindowPreviews } from '../window-preview.js';
import { DOCK_PREVIEW_CMD_KEY, DOCK_PREVIEW_ACK_KEY, createChannel } from '../widget-channel.js';
import { previewPlacement, previewBox, isAnchorOnMonitor } from '../flyout-placement.js';

// Where the window sits while closed. Same reasoning as every other flyout
// here: Zebar exposes no window-visibility toggle, and a transparent Zebar
// window still swallows clicks across its whole footprint, so a card-sized
// window left parked would be a permanent dead zone over the desktop.
export const PARKED_SIZE = 1;

// The card no longer fades -- it is shown and hidden instantly, per "make it
// so that taskbar hover previews are instant and have no animation". This is
// therefore not a fade delay any more: it is one frame of slack so the browser
// has painted the hidden state before the window shrinks under it. Zero works
// too, but a shrink racing the repaint can flash the card's last frame at 1x1.
export const FADE_MS = 16;

// A card can only ever be closed by the dock. If the dock's window dies while
// one is open -- Apply-Theme restarts every widget on a theme change, and they
// do not come back in a guaranteed order -- nothing would be left alive to
// send that close, and the card would sit on the desktop forever. This is the
// backstop, and it is generous: it must never fire during ordinary hovering.
export const ORPHAN_DISMISS_MS = 10000;

// If a capture is refused because another one is already running, try once
// more rather than showing an empty card. One retry, not a loop: the fetcher
// is single-in-flight by design and a queue here would just re-introduce the
// unsupervised-child problem it exists to prevent.
export const RETRY_MS = 160;

// The card's non-thumbnail chrome, in CSS pixels: the padding on all four
// sides, the title row, and the gap under it. Measured at init from the real
// stylesheet so CSS stays the source of truth; these are the fallback if that
// measurement comes back implausible, which measuring a panel parked at 1x1 has
// silently done twice in this pack's history.
const FALLBACK_CHROME_W = 20;
const FALLBACK_CHROME_H = 48;

const card = document.getElementById('card');
const iconEl = document.getElementById('icon');
const titleEl = document.getElementById('title');
const shotEl = document.getElementById('shot');
const emptyEl = document.getElementById('empty');

const shell = zebar.shellExec ? zebar : null;
const previews = createWindowPreviews(shell);

// `undefined` means "not captured yet" and `null` means "cannot be captured".
// Only the latter earns the "No preview available" label -- saying it while a
// capture is still running would flash the message on every single hover.
function applyShot(dataUrl) {
  const has = typeof dataUrl === 'string' && dataUrl !== '';
  if (has) shotEl.src = dataUrl;
  shotEl.classList.toggle('preview__img--hidden', !has);
  emptyEl.classList.toggle('preview__empty--hidden', has || dataUrl === undefined);
}

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  // The monitor this instance belongs to, captured from its STARTING position
  // before anything below moves it. Same matched pair with the zpack preset
  // every other flyout here relies on: anchor top_left at offset (0,0), so
  // outerPosition() at this exact moment IS the monitor's origin. Change the
  // preset and this together, or not at all.
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('dock preview: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };

  const parked = { x: monitor.x, y: monitor.y };
  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED_SIZE, height: PARKED_SIZE });
    await win.setPosition({ type: 'Physical', x: parked.x, y: parked.y });
  }
  await park();

  // How much of the card is NOT the thumbnail. Measured once, against the
  // stylesheet's own default shot box, so the padding and title row live in
  // exactly one place (the CSS) and this file only has to add a shot size to
  // them. The card's total size then changes with each item's thumbnail.
  const scale = window.devicePixelRatio || 1;
  const root = document.documentElement;
  const shotVar = (name) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  const defaultShot = { width: shotVar('--shot-w'), height: shotVar('--shot-h') };
  const rect = card.getBoundingClientRect();
  let chromeW = Math.round(rect.width - defaultShot.width);
  let chromeH = Math.round(rect.height - defaultShot.height);
  if (!(chromeW >= 0 && chromeW < 200) || !(chromeH >= 0 && chromeH < 200)) {
    console.warn(`dock preview: card measured ${rect.width}x${rect.height} against a ` +
      `${defaultShot.width}x${defaultShot.height} shot, giving implausible chrome ` +
      `${chromeW}x${chromeH} -- using fallbacks`);
    chromeW = FALLBACK_CHROME_W;
    chromeH = FALLBACK_CHROME_H;
  }

  // Remembers each window's real pixel dimensions, so hovering it a second time
  // opens at the right shape immediately instead of opening 16:9 and then
  // re-shaping once the capture lands. Bounded for the same reason the
  // thumbnail cache is: a long session opens and closes a lot of windows, and
  // an unbounded map keyed by hwnd never forgets any of them.
  const SHAPE_MAX = 32;
  const shapes = new Map();
  function rememberShape(hwnd, size) {
    shapes.delete(hwnd);
    shapes.set(hwnd, size);
    while (shapes.size > SHAPE_MAX) shapes.delete(shapes.keys().next().value);
  }

  function applyBox(box) {
    root.style.setProperty('--shot-w', `${box.width}px`);
    root.style.setProperty('--shot-h', `${box.height}px`);
  }

  async function placeWindow(box, msg) {
    const place = previewPlacement({
      anchorX: msg.anchorX,
      dockTop: msg.dockTop,
      leftLimit: msg.dockLeft,
      cardWidth: Math.ceil((chromeW + box.width) * scale),
      cardHeight: Math.ceil((chromeH + box.height) * scale),
      monitor,
    });
    // Size before position, like the other flyouts: the window paints nothing
    // until `.open` lands, so neither order is visible, but sizing first means
    // it is never briefly card-sized at the parked spot.
    await win.setSize({ type: 'Physical', width: place.width, height: place.height });
    await win.setPosition({ type: 'Physical', x: place.x, y: place.y });
  }

  const channel = createChannel(localStorage, window, {
    sendKey: DOCK_PREVIEW_ACK_KEY,
    receiveKey: DOCK_PREVIEW_CMD_KEY,
  });

  let open = false;
  let showing = null;          // hwnd currently on the card
  let orphanTimer = null;
  let fadeToken = 0;           // invalidates an in-flight close when a new open lands

  function armOrphanTimer() {
    if (orphanTimer !== null) clearTimeout(orphanTimer);
    orphanTimer = setTimeout(() => {
      orphanTimer = null;
      closeCard().catch((e) => console.warn('dock preview: orphan close failed', e));
    }, ORPHAN_DISMISS_MS);
  }

  async function openCard(msg) {
    const hwnd = Number(msg.hwnd);
    if (!Number.isFinite(hwnd) || hwnd <= 0) return;

    fadeToken += 1;
    armOrphanTimer();
    showing = hwnd;

    titleEl.textContent = msg.title || msg.app || '';
    const icon = typeof msg.icon === 'string' ? msg.icon : '';
    iconEl.src = icon;
    iconEl.classList.toggle('preview__icon--missing', icon === '');

    // Paint whatever is already cached BEFORE growing, so a re-hover of the
    // same window is instant and the card never appears empty first. The shape
    // is remembered separately from the image, because the cache expires (a
    // window's CONTENTS change) while its dimensions rarely do -- so a
    // re-hover after the thumbnail has gone stale still opens at the right
    // shape rather than snapping from 16:9.
    const shape = shapes.get(hwnd);
    let box = previewBox(shape?.width, shape?.height);
    applyBox(box);
    applyShot(previews.cached(hwnd));

    await placeWindow(box, msg);
    open = true;
    document.body.classList.add('open');

    // Now the slow part. A capture is ~100ms of process spawn; the card is
    // already up and the frame already correct, so this only fills the image.
    let shot = await previews.fetch(hwnd);
    if (shot === undefined) {
      await new Promise((r) => setTimeout(r, RETRY_MS));
      shot = await previews.fetch(hwnd);
    }
    // The pointer may have moved to another icon while that ran.
    if (showing !== hwnd) return;
    if (shot === undefined) return;
    applyShot(shot);
    if (!shot) return;

    // Re-shape to the window's real aspect ratio, now that there is an image to
    // read it from. `decode()` rather than an onload handler so this stays in
    // the same await chain as the showing-still-matches check above.
    try {
      await shotEl.decode();
    } catch (e) {
      return;                      // undecodable: keep the shape it opened at
    }
    if (showing !== hwnd) return;
    const natural = { width: shotEl.naturalWidth, height: shotEl.naturalHeight };
    rememberShape(hwnd, natural);
    const fitted = previewBox(natural.width, natural.height);
    if (fitted.width === box.width && fitted.height === box.height) return;
    box = fitted;
    applyBox(box);
    await placeWindow(box, msg);
  }

  async function closeCard() {
    if (orphanTimer !== null) { clearTimeout(orphanTimer); orphanTimer = null; }
    if (!open) return;
    open = false;
    showing = null;
    document.body.classList.remove('open');

    // Let the fade finish before the window shrinks out from under it.
    const token = ++fadeToken;
    await new Promise((r) => setTimeout(r, FADE_MS));
    // A new open landing during the fade must win -- parking now would shrink
    // the window the new card is already using.
    if (token !== fadeToken || open) return;
    await park();
  }

  channel.subscribe((msg) => {
    if (msg.open) {
      // Multi-monitor guard: every instance sees every dock's storage message,
      // since localStorage is shared across the whole origin.
      if (!isAnchorOnMonitor(monitor, msg.anchorX, msg.dockTop)) return;
      openCard(msg).catch((e) => console.warn('dock preview: could not open', e));
    } else {
      closeCard().catch((e) => console.warn('dock preview: could not close', e));
    }
  });

  // Tells a dock that is already running that this card just (re)started and
  // is definitely closed, the same handshake the layout menu posts.
  channel.post({ closed: true });
}

init().catch((e) => console.error('dock preview failed to initialise', e));
