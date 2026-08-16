import { register } from './registry.js';
import { PANELS_CMD_KEY, PANELS_ACK_KEY, createChannel } from '../../widget-channel.js';
import { openOnHover } from './hover-open.js';

// The bar trigger for the power panel.
//
// It used to do nothing at all: the click handler called `confirm()` and then
// logged "power action not yet wired". Reported as "power button still doesn't
// do anything" -- which was exactly true.
//
// It opens a PANEL rather than acting, and that is not timidity. The bar's
// buttons now open their flyouts on hover, and a hover that shuts the machine
// down is indefensible; even on a click, one mis-aimed press on a 52px bar
// should not end the session. The panel's rows are labelled and each needs its
// own deliberate click (panels/panels.js's buildPower).
//
// Task 3 (Font Awesome icons): Font Awesome Free 6.x Solid's "power-off"
// (), rendered through the locally vendored webfont via `fa-solid`.
register('power', (ctx) => {
  const { shell } = ctx;

  const el = document.createElement('button');
  el.type = 'button';
  // 'bar-btn' (style.css) is the shared clickable affordance, applied only to
  // elements that genuinely do something. This one finally qualifies.
  el.className = 'power bar-btn fa-solid';
  el.textContent = '';
  el.title = 'Power';

  const channel = createChannel(localStorage, window, {
    sendKey: PANELS_CMD_KEY,
    receiveKey: PANELS_ACK_KEY,
  });

  let open = false;

  // The bar window's origin, for turning this button's CSS-pixel rect into the
  // physical screen coords the flyout positions itself by. Read once -- the bar
  // is docked to the left edge and never moves. Fail-soft default.
  let winOrigin = { x: 0, y: 0 };
  if (shell && typeof shell.currentWidget === 'function') {
    Promise.resolve()
      .then(() => shell.currentWidget().tauriWindow.outerPosition())
      .then((pos) => { winOrigin = { x: pos.x, y: pos.y }; })
      .catch((e) => console.warn('power: could not read window position', e));
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
      if (open) { open = false; channel.post({ open: false }); }
      document.removeEventListener('click', onDocumentClick, true);
    }
  }

  function show() {
    if (open) return;
    open = true;
    channel.post({ open: true, panel: 'power', ...anchor() });
    document.addEventListener('click', onDocumentClick, true);
  }

  function hide() {
    if (!open) return;
    open = false;
    channel.post({ open: false });
    document.removeEventListener('click', onDocumentClick, true);
  }

  el.addEventListener('click', () => { if (open) hide(); else show(); });
  openOnHover(el, show);

  // The flyout acks every close it performs itself (its dismiss timer, a row
  // being clicked, or the "I just restarted" message it posts on startup). Any
  // ack means "not open any more".
  channel.subscribe(() => {
    open = false;
    document.removeEventListener('click', onDocumentClick, true);
  });

  return { el, update() {} };
});
