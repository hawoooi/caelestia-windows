// The status dropdown: the flyout half of "pinned to the bar, or inside a
// dropdown". Everything structural about it -- why a flyout has to be its own
// Zebar widget, why it parks at 1x1 while closed, why it talks over
// localStorage instead of a poller -- is identical to the layout menu and is
// documented once in ../widget-channel.js and docs/zebar-bar.md.
//
// What is DIFFERENT from the layout menu, and is the whole reason this is a
// second widget rather than a second preset of the first:
//
//   * Its rows are readouts, not choices. Clicking one closes the dropdown;
//     nothing is selected and no command is ever run. This widget has an
//     empty `shellCommands` privilege list and needs no komorebi provider.
//   * Its content CHANGES WHILE OPEN. CPU and memory move every tick, so the
//     bar re-posts the row set on every provider tick while the dropdown is
//     open, and this widget re-measures and re-sizes its window when the
//     content's size actually changes (see applyRows).
//
// It stays deliberately dumb in the same way: the bar owns the providers,
// the catalogue and the pinned/dropdown split, and sends finished rows. This
// widget never reads a provider field itself.

import * as zebar from '../bar/vendor/zebar.js';
import { STATUS_CMD_KEY, STATUS_ACK_KEY, createChannel } from '../widget-channel.js';
import { menuPlacement, isAnchorOnMonitor } from '../flyout-placement.js';

// Longer than the layout menu's 6s. That menu is a pick-one-and-go control,
// but this one is something you read -- four rows of numbers takes longer to
// take in than four labels to choose between, and re-opening it costs a
// click every time it closes too eagerly.
export const MENU_DISMISS_MS = 10000;

export const PARKED_SIZE = 1;
export const FADE_MS = 300;   // keep in step with statusmenu.css's --dur

const panel = document.getElementById('menu');

// Rebuilds the panel's DOM from a row set. Rows are keyed by id and reused
// across updates rather than recreated: the dropdown re-renders on every
// provider tick while open, and replacing the whole subtree each time would
// restart the CSS transitions and make hover flicker under the cursor.
const rendered = new Map();

function applyRows(rows) {
  const seen = new Set();

  for (const row of rows) {
    seen.add(row.id);
    let el = rendered.get(row.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'status-menu__item';
      el.dataset.id = row.id;

      const glyph = document.createElement('span');
      glyph.className = 'status-menu__glyph fa-solid';

      const text = document.createElement('span');
      text.className = 'status-menu__text';

      const label = document.createElement('span');
      label.className = 'status-menu__label';

      const detail = document.createElement('span');
      detail.className = 'status-menu__detail';

      text.append(label, detail);

      const value = document.createElement('span');
      value.className = 'status-menu__value';

      el.append(glyph, text, value);
      rendered.set(row.id, { root: el, glyph, label, detail, value });
      el = rendered.get(row.id);
      panel.appendChild(el.root);
    }

    // Assign only when changed: an unconditional textContent write on every
    // tick would keep invalidating layout for rows whose value did not move.
    if (el.glyph.textContent !== row.glyph) el.glyph.textContent = row.glyph;
    if (el.label.textContent !== row.label) el.label.textContent = row.label;
    const detailText = row.detail ?? '';
    if (el.detail.textContent !== detailText) el.detail.textContent = detailText;
    el.detail.classList.toggle('status-menu__detail--empty', detailText === '');
    const valueText = row.value ?? '';
    if (el.value.textContent !== valueText) el.value.textContent = valueText;
  }

  // Drop rows the bar stopped sending -- an item can genuinely disappear
  // (unplug the only disk, a provider that stops emitting), and a stale row
  // frozen at its last value is worse than no row.
  for (const [id, el] of rendered) {
    if (!seen.has(id)) {
      el.root.remove();
      rendered.delete(id);
    }
  }

  // Preserve the order the bar sent, which is the order configured in
  // bar.config.json's status.dropdown. Reusing nodes means append order
  // alone does not maintain it once a row is removed and re-added.
  for (const row of rows) {
    const el = rendered.get(row.id);
    if (el) panel.appendChild(el.root);
  }
}

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  // Monitor identity from the STARTING position, before parking -- see
  // ../layoutmenu/menu.js for why this and the zpack preset are a matched
  // pair, and which two nicer APIs do not exist on zebar 3.3.1.
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('status menu: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };

  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED_SIZE, height: PARKED_SIZE });
    await win.setPosition({ type: 'Physical', x: monitor.x, y: monitor.y });
  }
  await park();

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* measure anyway */ }
  }

  const channel = createChannel(localStorage, window, {
    sendKey: STATUS_ACK_KEY,
    receiveKey: STATUS_CMD_KEY,
  });

  let open = false;
  let dismissTimer = null;
  let anchor = { anchorX: 0, anchorY: 0 };
  let lastSize = { width: 0, height: 0 };

  function clearDismissTimer() {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  // Measures the panel and moves/resizes the window to match. Called on open
  // AND on every content update while open, because CPU/memory values change
  // width as they cross digit boundaries (9% -> 10%) and a window left at the
  // old size would clip the last column.
  async function fit(force) {
    const rect = panel.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const placement = menuPlacement({
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY,
      panelWidth: Math.ceil(rect.width * scale),
      panelHeight: Math.ceil(rect.height * scale),
      monitor,
    });
    if (!force && placement.width === lastSize.width && placement.height === lastSize.height) {
      return;   // nothing moved; skip two IPC round trips per tick
    }
    lastSize = { width: placement.width, height: placement.height };
    await win.setSize({ type: 'Physical', width: placement.width, height: placement.height });
    await win.setPosition({ type: 'Physical', x: placement.x, y: placement.y });
  }

  async function openMenu(msg) {
    anchor = { anchorX: msg.anchorX, anchorY: msg.anchorY };
    applyRows(Array.isArray(msg.rows) ? msg.rows : []);
    open = true;
    await fit(true);
    document.body.classList.add('open');
    clearDismissTimer();
    dismissTimer = setTimeout(() => { dismiss(); }, MENU_DISMISS_MS);
  }

  async function closeMenu(notify) {
    clearDismissTimer();
    if (!open) return;
    open = false;
    document.body.classList.remove('open');
    if (notify) channel.post({ closed: true });
    await new Promise((r) => setTimeout(r, FADE_MS));
    if (!open) {
      lastSize = { width: 0, height: 0 };
      await park();
    }
  }

  function dismiss() { closeMenu(true); }

  // Clicking anywhere in the panel closes it. Unlike the layout menu there
  // is nothing to choose, so every click is a dismissal.
  document.body.addEventListener('click', () => { dismiss(); });

  channel.subscribe((msg) => {
    if (msg.open) {
      if (!isAnchorOnMonitor(monitor, msg.anchorX, msg.anchorY)) return;
      if (open) {
        // A live refresh, not a fresh open -- keep the dismiss timer running
        // rather than restarting it, or a bar ticking once a second would
        // hold the dropdown open forever.
        applyRows(Array.isArray(msg.rows) ? msg.rows : []);
        fit(false).catch((e) => console.warn('status menu: could not resize', e));
        return;
      }
      openMenu(msg).catch((e) => console.warn('status menu: could not open', e));
    } else {
      closeMenu(false).catch((e) => console.warn('status menu: could not close', e));
    }
  });

  // Tell a running bar this flyout just (re)started and is closed, so its
  // own open/closed flag cannot be left stuck after a widget restart.
  channel.post({ closed: true });
}

init().catch((e) => console.error('status menu failed to initialise', e));
