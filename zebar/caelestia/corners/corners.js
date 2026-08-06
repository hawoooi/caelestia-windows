import * as zebar from '../bar/vendor/zebar.js';
import { classifyCorner } from './classify.js';

// Falls back to top-left rather than staying unclassified (no class at all
// -- corners.css's rules all key off a body.corner--* class, so no class
// means no paint, i.e. the widget silently vanishes) if outerPosition()
// ever rejects or currentWidget() throws before the DOM/Tauri bridge is
// ready. A wrong-but-painted corner is a smaller failure than an invisible
// one -- both would need a real fix, but only one leaves the desktop
// looking broken with zero signal.
async function init() {
  let corner = 'top-left';
  try {
    const widget = zebar.currentWidget();
    const pos = await widget.tauriWindow.outerPosition();
    corner = classifyCorner(pos.x, pos.y, window.screen.width, window.screen.height);
  } catch (e) {
    console.error('corner classification failed, defaulting to top-left', e);
  }
  document.body.classList.add(`corner--${corner}`);
}

init();
