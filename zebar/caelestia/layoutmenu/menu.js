// The horizontal layout-menu flyout. A widget of its own (not part of the
// bar) purely because a Zebar widget cannot paint outside its own OS window
// and the bar's is 52px wide -- see ../layout-channel.js's module comment
// for the two escape routes that were tried and are closed on this build,
// and docs/zebar-bar.md's "The horizontal layout menu" for the full account.
//
// This widget is deliberately DUMB: it renders the choices, reports which
// one was clicked, and closes. It never runs `komorebic` itself and never
// tracks what the current layout is. The bar owns both -- it already has
// the komorebi provider, the shellExec privilege and the tested
// change-layout logic (bar/entries/layoutToggle.js), so duplicating either
// here would mean two sources of truth for the active marker and a second
// copy of the "picking the active layout is a no-op" rule.

import * as zebar from '../bar/vendor/zebar.js';
import { LAYOUT_CYCLE, layoutGlyph, layoutLabel } from '../layouts.js';
import { CMD_KEY, ACK_KEY, createChannel } from '../widget-channel.js';
import { menuPlacement, isAnchorOnMonitor } from '../flyout-placement.js';

// Matches the auto-dismiss the in-bar menu used to own. The flyout keeps
// this timer rather than the bar because the flyout is what the user is
// actually looking at, and because it must self-close even if the bar
// process is restarted mid-open (Apply-Theme does exactly that on a theme
// change) -- otherwise a menu could be left painted over the desktop with
// nothing left alive to close it.
export const MENU_DISMISS_MS = 6000;

// Where the window sits while closed. 1x1 rather than hidden because Zebar
// exposes no window-visibility toggle in its JS API (`currentWidget()`
// gives `close()` and `setZOrder()`, nothing else) -- and a transparent
// Zebar window still swallows every click inside its footprint, so leaving
// it at menu size while closed would be a permanent dead zone over the
// user's real windows. 1x1 parks that dead zone on a single pixel of the
// bar's own top padding.
export const PARKED_SIZE = 1;

// Must stay in step with layoutmenu.css's own --dur, which drives the
// panel's fade. closeMenu waits this long before shrinking the window back
// to PARKED_SIZE, so the fade actually plays instead of the panel being
// clipped out of existence on its first frame.
export const FADE_MS = 300;

const panel = document.getElementById('menu');
const items = new Map();

for (const layout of LAYOUT_CYCLE) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'layout-menu__item';
  item.dataset.layout = layout;

  const glyph = document.createElement('span');
  glyph.className = 'layout-menu__glyph fa-solid';
  glyph.textContent = layoutGlyph(layout);

  const label = document.createElement('span');
  label.className = 'layout-menu__label';
  label.textContent = layoutLabel(layout);

  item.append(glyph, label);
  panel.appendChild(item);
  items.set(layout, item);
}

async function init() {
  const widget = zebar.currentWidget();
  const win = widget.tauriWindow;

  // Which monitor this instance belongs to (see isAnchorOnMonitor).
  //
  // Read from the window's STARTING position, before anything below moves
  // it. Zebar places this widget's only preset at anchor `top_left`,
  // offset (0,0), `monitorSelection: all` -- so each instance starts at its
  // own monitor's origin, and `outerPosition()` at this exact moment IS
  // that origin. The preset and this line are a matched pair: changing the
  // preset's anchor or offsets in zpack.json silently breaks the multi-
  // monitor guard rather than the visible layout, so change both together.
  //
  // Two better-looking APIs were tried live and are not available on this
  // build (zebar 3.3.1): `tauriWindow.currentMonitor()` is not a function,
  // and `createProvider({ type: 'monitors' })` rejects with "Not a
  // supported provider type". `screen.width/height` does report the
  // dimensions of the monitor the window is on, which is what covers the
  // size half.
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('layout menu: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };

  // Park inside this instance's own monitor, not at the desktop origin, so
  // the one dead pixel stays on the bar this flyout belongs to.
  const parked = { x: monitor.x, y: monitor.y };
  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED_SIZE, height: PARKED_SIZE });
    await win.setPosition({ type: 'Physical', x: parked.x, y: parked.y });
  }
  await park();

  // The panel is measured below to size the window to it exactly. Measuring
  // before the vendored Font Awesome webfont has loaded would size it
  // against fallback glyph metrics -- the icons would then be clipped or
  // adrift once the real font swapped in. `document.fonts.ready` resolves
  // once font loading has settled, which is cheap here (two local woff2
  // files, no network).
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* measure anyway */ }
  }

  const channel = createChannel(localStorage, window, { sendKey: ACK_KEY, receiveKey: CMD_KEY });

  let open = false;
  let dismissTimer = null;

  function clearDismissTimer() {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  async function openMenu(msg) {
    renderActive(msg.current);
    open = true;

    // Measured while the window is still parked at 1x1. That is safe
    // because the panel is `position: absolute; width: max-content` with
    // non-wrapping items (layoutmenu.css), so its layout size is a function
    // of its content and fonts only, never of the viewport it is measured
    // in. Verified live against the running widget rather than assumed.
    const rect = panel.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const placement = menuPlacement({
      anchorX: msg.anchorX,
      anchorY: msg.anchorY,
      panelWidth: Math.ceil(rect.width * scale),
      panelHeight: Math.ceil(rect.height * scale),
      monitor,
    });

    // Size before position: the window is invisible either way (nothing is
    // painted until `.open` lands below), but sizing first means it is
    // never briefly menu-sized at the parked spot, where it would sit over
    // the bar.
    await win.setSize({ type: 'Physical', width: placement.width, height: placement.height });
    await win.setPosition({ type: 'Physical', x: placement.x, y: placement.y });
    document.body.classList.add('open');

    clearDismissTimer();
    dismissTimer = setTimeout(() => { dismiss(null); }, MENU_DISMISS_MS);
  }

  // `notify` is false when the bar itself asked for the close -- it already
  // knows, and echoing an ack back would just bounce a message between two
  // widgets for no reason.
  async function closeMenu(notify, selected) {
    clearDismissTimer();
    if (!open) return;
    open = false;
    document.body.classList.remove('open');
    if (notify) channel.post({ closed: true, selected: selected ?? null });
    // Let the fade-out finish before the window shrinks out from under it;
    // shrinking first would make the panel vanish instantly instead.
    await new Promise((r) => setTimeout(r, FADE_MS));
    if (!open) await park();
  }

  function dismiss(selected) { closeMenu(true, selected); }

  function renderActive(current) {
    for (const [layout, el] of items) {
      el.classList.toggle('layout-menu__item--active', layout === current);
    }
  }

  for (const [layout, el] of items) {
    el.addEventListener('click', () => { dismiss(layout); });
  }

  // Clicking the panel's own padding (or the slide slack beside it) closes
  // without choosing. This is the only "click outside" that can ever work:
  // a click on some OTHER OS window is delivered to that window and this
  // document never hears about it, which is exactly why MENU_DISMISS_MS
  // exists as the primary dismiss path.
  document.body.addEventListener('click', (e) => {
    if (!e.target.closest('.layout-menu__item')) dismiss(null);
  });

  channel.subscribe((msg) => {
    if (msg.open) {
      if (!isAnchorOnMonitor(monitor, msg.anchorX, msg.anchorY)) return;
      openMenu(msg).catch((e) => console.warn('layout menu: could not open', e));
    } else {
      closeMenu(false).catch((e) => console.warn('layout menu: could not close', e));
    }
  });

  // Tells a bar that is already running that this flyout just (re)started
  // and is definitely closed. Without it, a flyout restart while the bar
  // believed the menu was open would leave the bar's own open/closed flag
  // stuck -- the next click would post a close nobody needed and appear to
  // do nothing.
  channel.post({ closed: true, selected: null });
}

init().catch((e) => console.error('layout menu failed to initialise', e));
