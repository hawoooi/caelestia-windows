import { register } from './registry.js';
import { findEvkeyIcon, evkeyMode, modeLabel } from '../../evkey-state.js';

// Shows which mode EVKey is typing in -- VI or EN.
//
// EVKey is a third-party Vietnamese input method editor, NOT a Windows
// keyboard layout. That distinction decided the whole implementation: this
// machine's installed Windows languages are English and Chinese, so zebar's
// `keyboard` provider reports en-US no matter what EVKey is doing. Checking
// that first is what stopped this being built against the wrong signal.
//
// The state is read from EVKey's system-tray tooltip, which updates live --
// see ../../evkey-state.js for why the tooltip and not `setting.ini` (stale
// until EVKey exits) or the registry (nothing there at all), and for the
// inversion that makes the tooltip say the OPPOSITE of the current mode.
//
// COSTS NOTHING TO RUN. The systray provider is a Windows API subscription,
// so there is no helper process, no poll and no shellExec here. That matters:
// this pack already spawns fullscreen-detect.exe ~10x/second across nine
// widgets, and the standing rule is that anything new has to justify itself
// against a process spawn. This has nothing to justify.
//
// When EVKey is not running the entry renders NOTHING rather than a
// placeholder -- an input-mode indicator that shows a mode when there is no
// input method is worse than an absent one.
register('evkey', () => {
  const el = document.createElement('div');
  el.className = 'evkey';

  let shown = null;

  return {
    el,
    update(out) {
      const icon = findEvkeyIcon(out.systray);
      const mode = icon ? evkeyMode(icon.tooltip) : null;
      if (mode === shown) return;      // avoid touching the DOM on every tick
      shown = mode;

      el.textContent = modeLabel(mode);
      // Two independent facts, two independent classes: whether to show
      // anything at all, and which mode it is. The active tint belongs to
      // Vietnamese because that is the state you switch INTO and want to
      // notice; English is the resting mode.
      el.classList.toggle('evkey--hidden', mode === null);
      el.classList.toggle('evkey--vi', mode === 'vi');
      // The tooltip carries the raw string, so a future tooltip change that
      // this parser does not understand is diagnosable from the bar itself
      // rather than only from a CDP session.
      el.title = icon ? icon.tooltip : 'EVKey is not running';
    },
  };
});
