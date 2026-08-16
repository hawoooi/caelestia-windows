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
 * thrown exception of any kind, or the poll TIMING OUT below) is treated as
 * "not fullscreen" so the desktop frame stays visible rather than silently
 * vanishing on a detection fault -- see the safety note in the task this
 * shipped under.
 *
 * Task 3 (feat/corner-overlays follow-up, real incident): one
 * `fullscreen-detect.exe` instance outlived its parent zebar process and
 * inherited zebar's own LISTENING SOCKET on port 6124, so every subsequent
 * zebar start failed to bind the port -- the bar rendered nothing, and this
 * was twice misdiagnosed as a WebView2 fault before the real cause (an
 * orphaned helper process, not the browser engine) was found. See
 * docs/zebar-bar.md's troubleshooting section for the full incident.
 * `shellExec` gives this module no handle to kill a hung child process
 * directly (unlike `shellSpawn`, it returns only the finished result, not a
 * process id `shellKill` could target) -- so this function does the two
 * things it CAN control on the JS side, to stop a single hung probe from
 * ever compounding into a pile of overlapping/orphanable child processes:
 *
 * 1. **Never starts a new poll while the previous one is still outstanding**
 *    (the `inFlight` guard below) -- so a slow or hung probe can never
 *    cause a second, third, ... fullscreen-detect.exe to be launched on top
 *    of it every `intervalMs`.
 * 2. **Abandons (stops AWAITING) a poll that takes longer than `timeoutMs`**
 *    -- `onChange(false)` fires (fail-soft) and `inFlight` is released so
 *    polling can resume on the next tick, rather than the interlock in (1)
 *    permanently wedging shut the moment one probe never returns. This does
 *    NOT terminate the underlying OS process (shellExec exposes no such
 *    handle); it only stops this module from waiting on it forever and,
 *    critically, stops it from blocking every future poll forever too.
 *
 * @param {{shellExec: Function}|null} shell - the zebar module (or null if
 *   zebar.shellExec doesn't exist on this build -- mirrors entries/vesktop.js's
 *   own `ctx.shell` null-check pattern).
 * @param {(isFullscreen: boolean) => void} onChange
 * @param {number} [intervalMs] - defaults to 1000ms; vesktop.js polls its own
 *   helper every 5000ms, but visible desktop furniture flickering wrong is
 *   more noticeable than an unread-count badge lagging, so this polls faster.
 * @param {number} [timeoutMs] - defaults to 2000ms (2x the default interval)
 *   -- generous for a trivial Win32 P/Invoke helper that normally returns in
 *   well under a second, short enough to recover detection within a couple
 *   of poll cycles if a probe does hang.
 * @returns {number|null} the interval id (for tests/cleanup), or null if no
 *   shell was available and polling never started.
 */
export function startFullscreenWatch(shell, onChange, intervalMs, timeoutMs) {
  if (!shell || typeof shell.shellExec !== 'function') {
    // No shellExec on this build: fail soft by simply never hiding, rather
    // than polling something that can't work.
    return null;
  }

  const helper = 'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\fullscreen-detect.exe';
  const interval = intervalMs || 1000;
  const timeout = timeoutMs || 2000;

  let inFlight = false;

  async function poll() {
    if (inFlight) {
      // A previous probe hasn't settled yet -- skip this tick rather than
      // starting a second overlapping shellExec call. The next interval
      // tick will try again; if the outstanding probe is merely slow (not
      // hung), it will have finished by then and this guard is a no-op.
      return;
    }
    inFlight = true;
    // Cleared in `finally` below regardless of which side of the race
    // settles first, so a resolved-in-time probe doesn't leave a dangling
    // timer running for the rest of `timeout`'s duration.
    let timer;
    try {
      const result = await Promise.race([
        shell.shellExec(helper, []),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('fullscreen-detect probe timed out')), timeout);
        }),
      ]);
      onChange(isFullscreenState(result.stdout));
    } catch (e) {
      console.error('fullscreen detection failed, staying visible', e);
      onChange(false);
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  }

  poll();
  return setInterval(poll, interval);
}
