import { register } from './registry.js';
import { PANELS_CMD_KEY, PANELS_ACK_KEY, createChannel } from '../../widget-channel.js';

export function splitClock(formatted) {
  if (typeof formatted !== 'string') return { top: '--', bottom: '--' };
  const m = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { top: '--', bottom: '--' };
  return { top: m[1], bottom: m[2] };
}

// Direct user feedback: "work on the time widget, when i press on it it should
// also show the clock time date as well. timezones also. It would be nice if
// there was also a tool that allows me to convert to another timezone built
// in."
//
// The bar keeps its stacked HH-over-MM display -- 52px has room for nothing
// else -- and becomes the trigger for the panels flyout's 'clock' panel, which
// has the room for the full date, a world clock and the converter. Same
// trigger shape as trayToggle.js: the bar owns the config and the anchor, the
// flyout owns the rendering.
//
// It is a <button> now rather than a <div>. That is this bar's standing rule
// working in the other direction (style.css's `.bar-btn` comment): anything
// that responds to a click has to look like it does, so the clock picks up the
// hover affordance it previously had no business having.
register('clock', (ctx) => {
  const { shell, clockConfig } = ctx;

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'clock clock-btn';
  el.title = 'Clock, world times and timezone converter';

  const top = document.createElement('div');
  const bottom = document.createElement('div');
  el.append(top, bottom);

  const channel = createChannel(localStorage, window, {
    sendKey: PANELS_CMD_KEY,
    receiveKey: PANELS_ACK_KEY,
  });

  let open = false;

  // The bar window's origin, for converting this element's CSS-pixel rect into
  // the physical screen coords the flyout positions itself by. Read once --
  // the bar is docked and never moves. Fail-soft to the origin.
  let winOrigin = { x: 0, y: 0 };
  if (shell && typeof shell.currentWidget === 'function') {
    Promise.resolve()
      .then(() => shell.currentWidget().tauriWindow.outerPosition())
      .then((pos) => { winOrigin = { x: pos.x, y: pos.y }; })
      .catch((e) => console.warn('clock: could not read window position', e));
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

  el.addEventListener('click', () => {
    open = !open;
    if (open) {
      // The clock config rides along with the open command -- the flyout is a
      // separate document and never reads bar.config.json itself.
      channel.post({ open: true, panel: 'clock', clock: clockConfig ?? null, ...anchor() });
      document.addEventListener('click', onDocumentClick, true);
    } else {
      channel.post({ open: false });
      document.removeEventListener('click', onDocumentClick, true);
    }
  });

  // Any ack means the flyout closed itself (dismiss timer, an in-panel action,
  // or its startup "I am closed" message), so clear our own flag to match.
  channel.subscribe(() => {
    open = false;
    document.removeEventListener('click', onDocumentClick, true);
  });

  return {
    el,
    update(out) {
      const { top: t, bottom: b } = splitClock(out.date?.formatted);
      top.textContent = t;
      bottom.textContent = b;
    },
  };
});
