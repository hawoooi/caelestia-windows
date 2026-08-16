// Window preview thumbnails for the dock's hover card.
//
// Same split as media-art.js and gpu-stats.js: pure parsing here, testable
// without a shell, and a stateful fetcher owning the caching and the process
// discipline.
//
// The capture itself is tools/window-preview.cs -- see its header for why
// PrintWindow rather than DwmRegisterThumbnail or Windows.Graphics.Capture,
// and for the windows it cannot capture.

export const WINDOW_PREVIEW_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\window-preview.exe';

// Matches PREVIEW_MAX_W in flyout-placement.js -- the widest the card will ever
// draw a thumbnail -- so a landscape window is never upscaled on display. The
// two are a pair: raising the card's max width without raising this just makes
// every wide thumbnail blurry, which reads as a capture problem rather than a
// sizing one.
//
// Small enough that the base64 stays manageable. Measured on this machine: a
// 2560x1440 window comes back 85-230KB depending on how busy the window is.
export const PREVIEW_WIDTH = 360;

export function previewCommand(hwnd, width = PREVIEW_WIDTH) {
  return { program: WINDOW_PREVIEW_PATH, args: [String(hwnd), String(width)] };
}

/**
 * Turns the tool's base64 output into a data URL.
 *
 * Never throws. The tool prints NOTHING for every failure it knows about --
 * window gone, PrintWindow refused, capture came back a flat fill -- so an
 * empty string is an ordinary outcome meaning "no preview for this one", not
 * an error.
 */
export function parsePreview(stdout) {
  if (typeof stdout !== 'string') return null;
  const b64 = stdout.trim();
  if (!b64) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return `data:image/png;base64,${b64}`;
}

/**
 * Fetches previews, cached per window with a short lifetime.
 *
 * Unlike an app icon, a window's contents CHANGE -- so this cache expires,
 * where fetchIcon's does not. The TTL is the tension between showing a stale
 * thumbnail and spawning a process on every hover; a few seconds means moving
 * along a row of icons re-uses captures while a genuine revisit re-captures.
 *
 * One capture at a time, like every other shellExec caller in this pack. That
 * is not politeness: an unsupervised child that outlives its parent zebar
 * inherits zebar's listening socket on port 6124 and the entire desktop paints
 * nothing, under a PID that no longer exists.
 */
export function createWindowPreviews(shell, { ttlMs = 4000, maxEntries = 12, now = () => Date.now() } = {}) {
  const cache = new Map();   // hwnd -> { at, dataUrl|null }
  let inFlight = false;

  function prune() {
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  return {
    /** Synchronous read: what the renderer uses, and never spawns anything. */
    cached(hwnd) {
      const hit = cache.get(hwnd);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) return undefined;
      return hit.dataUrl;
    },

    /**
     * Resolves to a data URL, or null when there is no preview to be had.
     * Resolves to `undefined` when the request was refused because another
     * capture was already running -- the caller should simply try again.
     */
    async fetch(hwnd) {
      const fresh = this.cached(hwnd);
      if (fresh !== undefined) return fresh;
      if (inFlight) return undefined;
      if (!shell || typeof shell.shellExec !== 'function') return null;

      inFlight = true;
      try {
        const cmd = previewCommand(hwnd);
        let stdout = '';
        try {
          const res = await shell.shellExec(cmd.program, cmd.args);
          stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
        } catch (e) {
          // A nonzero exit is the tool's documented "no preview" signal.
          stdout = '';
        }
        const dataUrl = parsePreview(stdout);
        // Failures are remembered too, so a window that cannot be captured is
        // not re-probed on every single hover -- but only for the TTL, since
        // a window that is currently uncapturable may not stay that way.
        cache.delete(hwnd);
        cache.set(hwnd, { at: now(), dataUrl });
        prune();
        return dataUrl;
      } finally {
        inFlight = false;
      }
    },
  };
}
