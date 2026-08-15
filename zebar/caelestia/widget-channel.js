// Cross-widget message channel between the bar and the flyout widgets it
// drives -- the layout menu (layoutmenu/menu.js) and the status dropdown
// (statusmenu/menu.js) -- each of which lives in its own Zebar widget
// window. The transport is generic; only the key pairs below are per-flyout.
//
// **Why two windows at all.** A Zebar widget cannot paint one pixel outside
// its own OS window, and the bar's window is 52px wide -- far too narrow
// for a row of text labels. Two escape routes were considered and both are
// closed on this build, per docs/zebar-bar.md's own live findings:
//
//   1. Widen the bar's window while the menu is open. `dockToEdge`'s
//      work-area reservation is tied 1:1 to the window's actual width, so
//      growing it would move komorebi's work area and retile every real
//      window -- the exact harm ("it messes up my windows") that turned
//      this control from a cycle into a menu in the first place.
//   2. Keep one wide, permanently-transparent window and rely on
//      `pointer-events: none` for click-through. It does not work here:
//      `WindowFromPoint` sampling showed every point across a widened
//      transparent region still resolving to the Zebar window, never to
//      whatever was tiled underneath.
//
// So the flyout is its own widget with `dockToEdge` DISABLED -- no
// work-area reservation, therefore no retile -- which resizes itself from
// a 1x1 parked window to the menu's exact size on open and back on close.
// 1x1 while closed is deliberate and load-bearing: a transparent Zebar
// window still swallows clicks across its whole footprint, so a permanently
// menu-sized window would be a permanent dead zone over the user's real
// windows. See docs/zebar-bar.md, "The horizontal layout menu".
//
// **Why localStorage.** Every widget in this pack is served by Zebar's own
// asset server from the SAME ORIGIN -- verified live over CDP, not assumed:
// both `bar/index.html` and `corners/index.html` report
// `location.origin === 'http://127.0.0.1:6124'`, a value written to
// `localStorage` in the bar window was read back intact in a corner window,
// and a `storage` event fired in the corner window for a write made in the
// bar's. That makes `storage` an event-driven, zero-poll channel between
// widgets -- which matters here specifically because this pack has already
// lost two debugging sessions to a shellExec-based poller orphaning itself
// and inheriting Zebar's listening socket (see fullscreen.js). No new
// helper process, no new poll.

// One key PAIR per flyout. They must not be shared: every widget in the
// pack sees every storage event on this origin, so a single pair would make
// the layout menu and the status dropdown answer each other's commands.
export const CMD_KEY = 'caelestia.layoutMenu.cmd';
export const ACK_KEY = 'caelestia.layoutMenu.ack';
export const STATUS_CMD_KEY = 'caelestia.statusMenu.cmd';
export const STATUS_ACK_KEY = 'caelestia.statusMenu.ack';
// The unified panels flyout (system tray, volume, network, quick settings).
// One key pair for the one flyout, even though several bar triggers drive it:
// each trigger posts { open, panel: '<id>', ...anchor } and the flyout renders
// the requested panel. See panels/panels.js.
export const PANELS_CMD_KEY = 'caelestia.panels.cmd';
export const PANELS_ACK_KEY = 'caelestia.panels.ack';
// The top hover dashboard. Unlike the three pairs above this is ONE-WAY: the
// dashboard is a single window that owns its own hot zone and its own closing,
// and the only thing still posting here is the frame's top band, which can win
// hit-testing over that hot zone and so posts an open on its behalf. See
// dashboard/dashboard.js.
export const DASH_CMD_KEY = 'caelestia.dashboard.cmd';
export const DASH_ACK_KEY = 'caelestia.dashboard.ack';

// `storage` events do NOT fire when setItem writes a value byte-identical
// to the one already stored (HTML spec: the event is only fired when the
// value actually changes). Opening the menu twice in a row with the same
// anchor and same current layout would otherwise be silently swallowed, so
// every message carries a strictly increasing token purely to guarantee the
// serialized payload differs from the last one.
let counter = 0;
export function nextToken() {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export function encodeMessage(msg) {
  return JSON.stringify({ ...msg, token: nextToken() });
}

// Never throws: a malformed or hand-edited localStorage value must not be
// able to break the bar or the flyout, both of which decode whatever the
// other side (or a stale value from a previous session) left behind.
export function decodeMessage(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

// Thin wrapper over a Storage + EventTarget pair, injectable so both sides'
// logic can be unit tested against fakes without a browser (see
// tests/js/layoutChannel.test.mjs). `post` is fail-soft on purpose: a
// storage quota error or a disabled-storage environment must degrade the
// menu to "does nothing", never throw out of a click handler.
export function createChannel(storage, target, { sendKey, receiveKey }) {
  return {
    post(msg) {
      try {
        storage.setItem(sendKey, encodeMessage(msg));
      } catch (e) {
        console.warn('layout-channel: could not post message', e);
      }
    },
    subscribe(handler) {
      const listener = (e) => {
        if (e.key !== receiveKey) return;
        const msg = decodeMessage(e.newValue);
        if (msg) handler(msg);
      };
      target.addEventListener('storage', listener);
      return () => target.removeEventListener('storage', listener);
    },
  };
}
