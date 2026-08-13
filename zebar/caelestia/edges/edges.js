// The desktop frame's edge strips (top / right / bottom).
//
// Two jobs, both of them wiring rather than logic: the shared fullscreen
// auto-hide poller (../fullscreen.js), alongside the bar and corner widgets;
// and -- for the TOP strip only -- a second hot zone for the dashboard.
//
// **Why the top band opens the dashboard.** It sits at y=0..8, which is where
// a pointer thrown at the top of the screen actually lands, and it is
// `top_most`, so it can win hit-testing against the dashboard's own hot zone
// underneath it. Windows gives no ordering guarantee between two top_most
// windows and this pack has seen it flip between sessions, so both listen and
// neither needs to know which one won. See ../dash-hotzone.js.

import * as zebar from '../bar/vendor/zebar.js';
import { startFullscreenWatch } from '../fullscreen.js';
import { createChannel, DASH_CMD_KEY, DASH_ACK_KEY } from '../widget-channel.js';
import { createHotZone, PANEL_W } from '../dash-hotzone.js';

const shell = zebar.shellExec ? zebar : null;

let fullscreen = false;
startFullscreenWatch(shell, (isFullscreen) => {
  fullscreen = isFullscreen;
  document.body.classList.toggle('fullscreen-hidden', isFullscreen);
});

// Which strip is this? The widget has three presets and no per-instance
// classification (edges.css keys off nothing but each preset's fixed shape),
// and `currentWidget()` reports the WIDGET name, not the preset. Position is
// the discriminator: only the top strip starts at y=0 -- the right strip is at
// y=24 and the bottom at y=1432.
async function init() {
  const win = zebar.currentWidget().window.tauri;

  let origin;
  try {
    origin = await win.outerPosition();
  } catch (e) {
    // Fail closed: if the position cannot be read, this strip simply does not
    // open the dashboard. The dashtrigger widget covers the same pixels, so
    // the gesture degrades to relying on that one alone rather than breaking.
    console.warn('edges: could not read position, not arming the hot zone', e);
    return;
  }
  if (origin.y !== 0) return;

  // Line the zone up with the panel, which is centred on the MONITOR -- not on
  // this band. The band starts at x=68, so its own midpoint is 22px right of
  // the screen's; centring within the band would put the zone that far off.
  const el = document.getElementById('dashHot');
  if (!el) return;
  const panelLeft = Math.round((window.screen.width - PANEL_W) / 2);
  el.style.left = `${panelLeft - origin.x}px`;
  el.style.width = `${PANEL_W}px`;
  document.body.classList.add('dash-armed');

  const channel = createChannel(localStorage, window, { sendKey: DASH_CMD_KEY, receiveKey: DASH_ACK_KEY });
  createHotZone({
    element: el,
    channel,
    suppressed: () => fullscreen || document.body.classList.contains('fullscreen-hidden'),
  });
}

init().catch((e) => console.error('edges: init failed', e));
