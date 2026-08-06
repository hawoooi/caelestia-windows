// Shared fullscreen-hide poller for every desktop-frame widget (bar,
// corners, edges). Direct user feedback: the frame should "turn invisible
// with the left bar when I fullscreen something". Zebar has no built-in
// fullscreen awareness -- checked zebar.exe --help, zpack-schema.json and
// settings-schema.json, none expose it (same conclusion docs/zebar-bar.md
// already recorded for the corner/edge widgets' un-mitigated
// top_most-over-fullscreen-games risk). So this pack detects it itself, by
// polling a tiny Win32 helper (../tools/fullscreen-detect.cs, compiled to
// fullscreen-detect.exe) via shellExec, the same shellExec pattern
// entries/vesktop.js already established.
//
// The helper prints "1" when the current foreground window's rect exactly
// covers the monitor it's on AND it isn't one of this pack's own zebar.exe
// windows (bar / corner arcs / edge strips all run as the same zebar.exe
// process, so excluding by owning-process-name excludes every one of them
// at once) -- and prints nothing otherwise, including on any internal
// error. isFullscreenState below is the one place that string gets turned
// into a boolean, kept pure and separate from the DOM/shellExec plumbing so
// it can be unit-tested without either (tests/js/fullscreen.test.mjs).

/**
 * @param {string} stdout - raw stdout from fullscreen-detect.exe.
 * @returns {boolean}
 */
export function isFullscreenState(stdout) {
  return String(stdout).trim() === '1';
}

/**
 * Starts polling the fullscreen-detect helper and calls `onChange(isFullscreen)`
 * on every poll. Fails soft by design: ANY error (shellExec rejecting because
 * the privilege isn't allowlisted for this widget, the helper missing, a
 * thrown exception of any kind) is treated as "not fullscreen" so the
 * desktop frame stays visible rather than silently vanishing on a detection
 * fault -- see the safety note in the task this shipped under.
 *
 * @param {{shellExec: Function}|null} shell - the zebar module (or null if
 *   zebar.shellExec doesn't exist on this build -- mirrors entries/vesktop.js's
 *   own `ctx.shell` null-check pattern).
 * @param {(isFullscreen: boolean) => void} onChange
 * @param {number} [intervalMs] - defaults to 1000ms; vesktop.js polls its own
 *   helper every 5000ms, but visible desktop furniture flickering wrong is
 *   more noticeable than an unread-count badge lagging, so this polls faster.
 * @returns {number|null} the interval id (for tests/cleanup), or null if no
 *   shell was available and polling never started.
 */
export function startFullscreenWatch(shell, onChange, intervalMs) {
  if (!shell || typeof shell.shellExec !== 'function') {
    // No shellExec on this build: fail soft by simply never hiding, rather
    // than polling something that can't work.
    return null;
  }

  const helper = 'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\fullscreen-detect.exe';
  const interval = intervalMs || 1000;

  async function poll() {
    try {
      const { stdout } = await shell.shellExec(helper, []);
      onChange(isFullscreenState(stdout));
    } catch (e) {
      console.error('fullscreen detection failed, staying visible', e);
      onChange(false);
    }
  }

  poll();
  return setInterval(poll, interval);
}
