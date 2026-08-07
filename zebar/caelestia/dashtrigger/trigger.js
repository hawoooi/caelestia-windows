// The hot zone for the top hover dashboard.
//
// **Why this is a separate widget from the panel it opens.**
//
// The dock (dock/dock.js) paid for this lesson in full: ANY geometry change
// on a Zebar/WebView2 window -- a resize OR a move -- invalidates the hover
// state under a stationary cursor. The window comes back believing the
// pointer is outside it, fires a spurious `mouseleave`, closes, and then
// re-fires `mouseenter` on the next real mouse movement. With a hot zone and
// a resizing panel in the SAME window, that is an open/close oscillation
// under a cursor the user is holding perfectly still -- the exact symptom
// reported there ("when i hover there and put my mouse still it opens and
// closes"). Three separate fixes were tried against the symptom before the
// cause was found by reading a rolling event log; do not re-litigate it.
//
// The dock could dodge this by never changing geometry at all -- it is only
// 56px tall, so a permanently-sized window is affordable. This panel cannot:
// it is ~440px tall and ~1140px wide, and a Zebar window swallows clicks
// across its whole footprint even when fully transparent (proved with
// WindowFromPoint sampling; `pointer-events: none` gives no OS-level
// click-through). A permanently panel-sized window would be a permanent dead
// zone across the top third of the screen.
//
// So the two responsibilities are split across two windows:
//
//   * THIS widget owns the hot zone. It is small, static, and NEVER changes
//     size or position for the whole session, so its hover is trustworthy.
//   * dashboard/ owns the panel. It parks at 1x1 while closed and sizes
//     itself on open -- its own hover only has to be reliable AFTER its
//     geometry has settled, which it is.
//
// **Where the hot zone sits.** The desktop frame's top band (edges/top) is
// 8px tall, `top_most`, and wins hit-testing against anything underneath.
// Below it is the 8px wallpaper gap, which nothing else claims. So this
// window spans y=0..16: the top half is shadowed by the band and never sees
// a pointer, and the bottom half -- in the free gap -- is what actually
// receives hover. The dock hit exactly this and was fixed the same way; a
// zone that only covered the band would be unreachable, which is not
// obvious from looking at it.

import * as zebar from '../bar/vendor/zebar.js';
import { startFullscreenWatch } from '../fullscreen.js';
import { createChannel, DASH_CMD_KEY, DASH_ACK_KEY } from '../widget-channel.js';
// isRealDeparture lives in the shared pure module so it can be unit-tested
// without a DOM -- this file cannot be imported outside a widget window.
import { isRealDeparture } from '../dashboard-data.js';

// The hot zone's own geometry, mirrored by the `dashtrigger` preset in
// zpack.json. Both must agree: this window is never resized at runtime, so
// the preset is the single source of truth for its size, and these constants
// exist to document the reasoning rather than to drive anything.
export const ZONE_H = 16; // 8px frame band (dead) + 8px wallpaper gap (live)
export const ZONE_W = 560;

// How long the pointer must rest in the zone before the panel opens.
//
// The dock opens instantly because it is a 56px strip at the very bottom
// edge -- somewhere a pointer rarely rests by accident. The top-centre of the
// screen is not: it is directly above every window's title bar and on the
// path to every tab. Opening a 440px panel the instant a cursor crosses that
// line would be an ambush. A short dwell makes it deliberate without feeling
// sluggish.
export const OPEN_DELAY_MS = 220;

const channel = createChannel(localStorage, window, { sendKey: DASH_CMD_KEY, receiveKey: DASH_ACK_KEY });

const zone = document.getElementById('zone');

// A rolling log of every hover event and the decision taken on it, readable
// from devtools as `window.__dashEvents`. This is not debug leftovers: the
// dock's equivalent log is the ONLY reason its open/close oscillation was
// ever diagnosed -- three fixes had already been aimed at the wrong cause
// from reasoning alone. Hover bugs here are invisible, timing-dependent, and
// impossible to reproduce by clicking around, so the log stays.
const EVENT_LOG_MAX = 60;
window.__dashEvents = [];
function logEvent(what, detail) {
  window.__dashEvents.push(`${new Date().toISOString().slice(11, 23)} ${what}${detail ? ' ' + detail : ''}`);
  if (window.__dashEvents.length > EVENT_LOG_MAX) window.__dashEvents.shift();
}

let fullscreen = false;
let openTimer = null;

function suppressed() {
  return fullscreen || document.body.classList.contains('fullscreen-hidden');
}

// Every message carries the fullscreen answer as well as the hover state.
// This widget is the ONLY one of the pair that polls fullscreen-detect.exe --
// the panel takes its answer from here rather than spawning a second helper
// once a second for the same question. See dashboard.js's channel subscriber.
function post(open) {
  try {
    channel.post({ open, fullscreen, source: 'trigger' });
  } catch (e) {
    console.error('dashboard trigger: could not post hover state', e);
  }
}

function cancelOpen() {
  if (openTimer !== null) {
    clearTimeout(openTimer);
    openTimer = null;
  }
}

zone.addEventListener('mouseenter', () => {
  logEvent('enter');
  if (suppressed()) { logEvent('enter ignored', 'fullscreen'); return; }
  cancelOpen();
  openTimer = setTimeout(() => {
    openTimer = null;
    // Re-check: the user may have gone fullscreen during the dwell.
    if (suppressed()) return;
    logEvent('post open=true');
    post(true);
  }, OPEN_DELAY_MS);
});

zone.addEventListener('mouseleave', (event) => {
  cancelOpen();
  // Report the departure and let the PANEL decide whether to close -- the
  // pointer has very likely just moved down into the panel itself, and only
  // the panel knows that. Closing from here would race it.
  const real = isRealDeparture({ y: event.clientY }, window.innerHeight);
  logEvent('leave', `clientY=${event.clientY} innerH=${window.innerHeight} real=${real}`);
  if (!real) return;
  post(false);
});

// Fullscreen gate, shared with every other hover widget in this pack.
// Direct user requirement, stated for all of them at once: "the bottom custom
// taskbar hover shouldn't activate when i am in fullscreen. this goes with
// any other hover-activation widgets."
startFullscreenWatch(
  zebar,
  (isFullscreen) => {
    const changed = isFullscreen !== fullscreen;
    fullscreen = isFullscreen;
    document.body.classList.toggle('fullscreen-hidden', isFullscreen);
    if (isFullscreen) {
      cancelOpen();
      post(false);
    } else if (changed) {
      // Announce the release too, so a panel that latched itself shut on the
      // way in does not stay latched after the game exits. Only on a CHANGE:
      // posting every second would be a message storm across every widget on
      // this origin, since they all see every storage event.
      post(false);
    }
  },
  1000,
);
