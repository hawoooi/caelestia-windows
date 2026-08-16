import { register } from './registry.js';
import { PANELS_CMD_KEY, PANELS_ACK_KEY, createChannel } from '../../widget-channel.js';

// The bar trigger for the system-tray panel. It owns no tray data -- it just
// asks the panels flyout (panels/panels.js) to open its 'tray' panel beside
// the bar; that flyout owns the systray provider and renders the real icons.
// Modelled on statusCluster.js's chevron: same anchor math, same open/close +
// click-away, same fail-soft window-origin read.
//
// FA6 Free Solid chevrons: chevron-right (U+F054) when closed, chevron-left
// (U+F053) when open -- the panel opens to the RIGHT of the bar, so the glyph
// points the way it will appear and then back toward the bar to close it (the
// same convention statusCluster's dropdown used before the tray took it over,
// and that dropdown moved to a gauge glyph so the two are no longer identical).
// \uXXXX escapes, verified present in the vendored fa-solid webfont.
const CLOSED = '\uF054';
const OPEN = '\uF053';

register('trayToggle', (ctx) => {
  const { shell } = ctx;

  const el = document.createElement('button');
  el.type = 'button';
  // 'bar-btn' (style.css) gives the circular hover/press affordance -- honest
  // here because this button genuinely does something (opens the tray).
  el.className = 'tray-toggle bar-btn fa-solid';
  el.textContent = CLOSED;
  el.title = 'System tray';

  const channel = createChannel(localStorage, window, {
    sendKey: PANELS_CMD_KEY,
    receiveKey: PANELS_ACK_KEY,
  });

  let open = false;

  // The bar window's origin, for converting the button's CSS-pixel rect into
  // the physical screen coords the flyout positions itself by. Read once --
  // the bar is docked to the left edge and never moves. Fail-soft default.
  let winOrigin = { x: 0, y: 0 };
  if (shell && typeof shell.currentWidget === 'function') {
    Promise.resolve()
      .then(() => shell.currentWidget().tauriWindow.outerPosition())
      .then((pos) => { winOrigin = { x: pos.x, y: pos.y }; })
      .catch((e) => console.warn('trayToggle: could not read window position', e));
  }

  function anchor() {
    const rect = el.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    return {
      anchorX: Math.round(winOrigin.x + window.innerWidth * scale),
      anchorY: Math.round(winOrigin.y + (rect.top + rect.height / 2) * scale),
    };
  }

  function onDocumentClick(e) {
    if (e.target !== el && !el.contains(e.target)) {
      if (open) { open = false; channel.post({ open: false }); el.textContent = CLOSED; }
      document.removeEventListener('click', onDocumentClick, true);
    }
  }

  function show() {
    if (open) return;
    open = true;
    el.textContent = OPEN;
    channel.post({ open: true, panel: 'tray', ...anchor() });
    document.addEventListener('click', onDocumentClick, true);
  }

  function hide() {
    if (!open) return;
    open = false;
    el.textContent = CLOSED;
    channel.post({ open: false });
    document.removeEventListener('click', onDocumentClick, true);
  }

  el.addEventListener('click', () => { if (open) hide(); else show(); });

  // The flyout acks every close it performs itself (its dismiss timer, or the
  // "I just restarted" message it posts on startup). Any ack means "not open
  // any more", so clear our own flag to match.
  channel.subscribe(() => {
    open = false;
    el.textContent = CLOSED;
    document.removeEventListener('click', onDocumentClick, true);
  });

  return { el, update() {} };
});
