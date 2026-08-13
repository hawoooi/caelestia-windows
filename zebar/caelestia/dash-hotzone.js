// The "open the dashboard" gesture, shared by the two windows that can detect
// it.
//
// **Why two windows detect the same gesture.** The top 16 pixels of this
// desktop are covered by two different `top_most` Zebar windows: the frame's
// top band (edges/top, y=0..8) and the dashboard's hot zone (dashtrigger,
// y=0..16). Windows gives no ordering guarantee BETWEEN top_most windows, and
// this pack has watched it flip between sessions -- a WindowFromPoint scan at
// x=1280 resolved y=0..7 to the band on one run and to the trigger on the
// next. Whichever wins, the other receives nothing.
//
// That is one of the two reasons the gesture was reported as inconsistent
// ("hovering to open isnt consistent and sometimes doesn't work"): on a run
// where the band won, only y=8..15 was live, and the natural gesture -- throw
// the cursor at the top edge of the screen -- lands on y=0. The other reason
// was width; see the dashtrigger preset in zpack.json.
//
// Rather than fight the z-order, BOTH windows listen. Neither needs to know
// which one the pointer actually reached.
//
// Openers only ever post `open: true`. Closing belongs entirely to the panel,
// which is the only window that can see where the pointer is once it is up --
// see dashboard.js.

// How long the pointer must rest in the zone before the panel opens.
//
// The dock opens instantly because it is a strip at the very bottom edge,
// somewhere a pointer rarely rests by accident. The top edge is not: it is
// directly above every window's title bar and on the path to every tab.
// Opening a 440px panel the instant a cursor crosses that line would be an
// ambush, and the zone now spans the whole screen width. A short dwell makes
// it deliberate without feeling sluggish.
export const OPEN_DELAY_MS = 220;

// The panel's width, and therefore the hot zone's width. They MUST match, and
// this constant is the single source for both (dashboard.js imports it from
// here; the dashtrigger preset in zpack.json mirrors it).
//
// Making the zone WIDER than the panel was tried and is broken, in a way worth
// recording because it looks like an improvement. The zone was widened to the
// full top edge so the gesture would work anywhere; hovering the far left then
// opened the panel -- centred, 700px away from the pointer -- and the panel
// immediately and correctly closed itself, because the pointer was nowhere
// near it. The log said it plainly: `panel leave x=-410`.
//
// Once open, the panel is the only window that can track the pointer (it
// occludes the hot zone). So "pointer in the hot zone" has to imply "pointer
// over the panel", which is exactly what equal widths guarantee.
export const PANEL_W = 1140;

/**
 * Wires an element up as a dashboard hot zone.
 *
 * @param {object} options
 * @param {EventTarget} options.element - the element to watch.
 * @param {{post: Function}} options.channel - a widget-channel channel.
 * @param {() => boolean} options.suppressed - true when the gesture must be
 *   ignored (fullscreen). Checked on entry AND again when the dwell expires,
 *   because the user can go fullscreen during it.
 * @param {(what: string, detail?: string) => void} [options.log]
 * @returns {{cancel: () => void}}
 */
export function createHotZone({ element, channel, suppressed, log }) {
  const note = typeof log === 'function' ? log : () => {};
  let timer = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  element.addEventListener('mouseenter', () => {
    note('enter');
    if (suppressed()) { note('enter ignored', 'fullscreen'); return; }
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (suppressed()) return;
      note('post open=true');
      try {
        channel.post({ open: true, fullscreen: false, source: 'trigger' });
      } catch (e) {
        console.error('dashboard hot zone: could not post', e);
      }
    }, OPEN_DELAY_MS);
  });

  // A pointer that leaves before the dwell expires was passing through, not
  // asking for anything.
  element.addEventListener('mouseleave', () => {
    note('leave (dwell cancelled)');
    cancel();
  });

  return { cancel };
}
