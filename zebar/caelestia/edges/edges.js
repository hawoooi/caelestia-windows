// Unlike corners.js, this widget has no per-instance classification to do
// (every "edges" preset is already a fixed, different shape -- see
// edges.css's own comment) -- the only reason this file exists at all is to
// wire up the shared fullscreen auto-hide poller (../fullscreen.js),
// alongside the bar and corner widgets.
import * as zebar from '../bar/vendor/zebar.js';
import { startFullscreenWatch } from '../fullscreen.js';

const shell = zebar.shellExec ? zebar : null;
startFullscreenWatch(shell, (isFullscreen) => {
  document.body.classList.toggle('fullscreen-hidden', isFullscreen);
});
