// Opening a bar flyout by hovering it, rather than clicking.
//
// Direct user request: "make it that for left bar buttons it activates
// whenever i hover over it". The rest of this desktop is already hover-driven
// -- the dock, the top dashboard, the dock's preview cards -- so a bar whose
// flyouts need a click was the odd one out.
//
// **The dwell is the whole design.** The bar is a 52px column of stacked
// buttons, so travelling from the logo at the top to the power button at the
// bottom sweeps the pointer straight through every flyout trigger in between.
// Opening on the bare `mouseenter` would fire four or five panels on the way
// past. A short dwell means only the button you actually stopped on opens.
//
// Deliberately NOT a close-on-leave: the panel appears to the RIGHT of the
// bar, so reaching it means leaving the button. Closing on mouseleave would
// make every flyout unreachable. Dismissal stays exactly as it was -- click
// away, pick something, or the flyout's own timer.
//
// Nothing here polls and nothing spawns a process; it is two listeners and a
// timer, which matters in a pack that already spawns fullscreen-detect.exe
// ~10x/second.

// Long enough that crossing a button does not open it, short enough that
// stopping on one feels immediate. The dock uses 320ms before its preview
// capture, but that gates a process spawn; this only posts a message, so it
// can afford to be quicker.
export const HOVER_DELAY_MS = 180;

/**
 * Calls `open` once the pointer has rested on `el` for the dwell.
 *
 * Returns a disposer. Safe to call `open` repeatedly -- every trigger in this
 * bar guards on its own `open` flag -- but the timer is cancelled on leave, so
 * a pointer passing through never reaches it at all.
 */
export function openOnHover(el, open, { delayMs = HOVER_DELAY_MS } = {}) {
  let timer = null;

  const cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  const onEnter = () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      try {
        open();
      } catch (e) {
        // A throwing opener must not break the bar: update() is wrapped in
        // bar.js's per-entry try/catch, but this runs on a timer, outside it.
        console.warn('hover-open: opener threw', e);
      }
    }, delayMs);
  };

  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', cancel);

  return () => {
    cancel();
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', cancel);
  };
}
