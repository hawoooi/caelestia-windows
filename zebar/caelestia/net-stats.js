// Client side of tools/net-stats.exe -- live download/upload rates for the
// network panel. Pure, so the sampling arithmetic (the part that is easy to
// get subtly wrong) is assertable in tests/js/netStats.test.mjs without a
// network, a helper process or a browser.
//
// The helper is stateless and prints CUMULATIVE byte counters; the rate is
// the difference between two samples. All of that differencing lives here.

export const NET_STATS_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\net-stats.exe';

// Windows' own "available networks" flyout -- the real Wi-Fi picker, with
// scanning, signal strength and password entry. Direct user feedback: "i think
// we can put a button that shortcuts to the actual wifi scanning page in
// windows settings."
//
// This is the honest answer to a hard block rather than a workaround: this
// pack CANNOT scan for networks itself, because `netsh wlan show networks`
// requires Windows Location services (machine consent reads Deny here) and
// reports an elevation error without them. Handing the job to the OS surface
// that already has the permission is better than asking the user to loosen a
// privacy setting for a bar widget.
//
// Launched via explorer.exe, which is how a shell URI gets resolved; the
// registered argsRegex in zpack.json pins the argument to this exact URI.
export const EXPLORER_PATH = 'C:\\Windows\\explorer.exe';
export const WIFI_URI = 'ms-availablenetworks:';

export function statsCommand() {
  return { program: NET_STATS_PATH, args: [] };
}

export function wifiSettingsCommand() {
  return { program: EXPLORER_PATH, args: [WIFI_URI] };
}

// Never throws; returns null for anything unusable.
export function parseStats(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return null;
  let o;
  try {
    o = JSON.parse(stdout);
  } catch (e) {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (!Number.isFinite(Number(o.rxBytes)) || !Number.isFinite(Number(o.txBytes))) return null;
  return {
    name: typeof o.name === 'string' ? o.name : '',
    adapter: typeof o.adapter === 'string' ? o.adapter : '',
    wireless: Boolean(o.wireless),
    ipv4: typeof o.ipv4 === 'string' ? o.ipv4 : '',
    linkBps: Math.max(0, Number(o.linkBps) || 0),
    rxBytes: Number(o.rxBytes),
    txBytes: Number(o.txBytes),
    tickMs: Number(o.tickMs) || 0,
  };
}

// GetTickCount is a 32-bit millisecond counter, so it wraps roughly every 49.7
// days. A machine that has been up that long would otherwise produce a huge
// negative interval and, from it, a nonsense rate -- so an apparent backwards
// step is corrected by one wrap rather than trusted.
const TICK_WRAP = 0x100000000;

export function intervalSeconds(prevTickMs, nextTickMs) {
  let delta = nextTickMs - prevTickMs;
  if (delta < 0) delta += TICK_WRAP;
  return delta / 1000;
}

// Rate between two samples, in bytes/sec. Returns null when no meaningful rate
// can be derived, which callers render as "--" rather than as zero:
//
//  * no previous sample yet (the first poll after opening the panel);
//  * a zero/absurd interval (two samples inside the same millisecond, or a
//    clock that did not advance) -- dividing by that manufactures a spike;
//  * the adapter changed underneath us, so the counters belong to a different
//    interface and their difference is meaningless;
//  * counters that went backwards, which happens when an adapter resets.
//
// Zero would be a lie in every one of those cases; "unknown" is the truth.
export function computeRates(prev, next, { maxIntervalSeconds = 30 } = {}) {
  if (!prev || !next) return null;
  if (prev.adapter !== next.adapter) return null;

  const seconds = intervalSeconds(prev.tickMs, next.tickMs);
  if (!(seconds > 0.05) || seconds > maxIntervalSeconds) return null;

  const rx = next.rxBytes - prev.rxBytes;
  const tx = next.txBytes - prev.txBytes;
  if (rx < 0 || tx < 0) return null;

  return { down: rx / seconds, up: tx / seconds };
}

// Human-readable rate. Uses SI units (kB = 1000 B), matching how link speeds
// and ISP figures are quoted, and how the disk provider already reports sizes
// elsewhere in this pack -- mixing SI and IEC across one bar would be worse
// than either choice on its own.
export function formatRate(bytesPerSecond) {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond)) return '--';
  const b = Math.max(0, bytesPerSecond);
  if (b < 1000) return `${Math.round(b)} B/s`;
  if (b < 1e6) return `${(b / 1e3).toFixed(b < 1e5 ? 1 : 0)} kB/s`;
  if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e8 ? 1 : 0)} MB/s`;
  return `${(b / 1e9).toFixed(1)} GB/s`;
}

// Negotiated link rate, reported by the adapter in BITS per second. 0 means
// the adapter does not know (an unplugged port reports u64::MAX, which the
// helper normalises to 0).
export function formatLink(linkBps) {
  if (!linkBps) return null;
  if (linkBps >= 1e9) return `${(linkBps / 1e9).toFixed(linkBps % 1e9 === 0 ? 0 : 1)} Gbps`;
  return `${Math.round(linkBps / 1e6)} Mbps`;
}

// Samples the helper and turns successive reads into rates. Same non-overlap
// discipline as the audio mixer: one call in flight at a time, because this is
// polled on a timer and a backed-up queue of helper processes is the exact
// shape of bug that cost this pack two debugging sessions (see fullscreen.js).
export function createNetStats(shell) {
  let previous = null;
  let inFlight = false;

  return {
    // Dropping the remembered sample matters when the panel closes: on reopen,
    // differencing against a minutes-old sample would average the whole gap
    // into one bogus "current" rate.
    reset() { previous = null; },

    async sample() {
      if (inFlight) return null;
      if (!shell || typeof shell.shellExec !== 'function') return null;
      inFlight = true;
      try {
        let stdout;
        try {
          const res = await shell.shellExec(statsCommand().program, statsCommand().args);
          stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
        } catch (e) {
          return null;   // nonzero exit = no active adapter; a normal outcome
        }
        const next = parseStats(stdout);
        if (!next) return null;
        const rates = computeRates(previous, next);
        previous = next;
        return { stats: next, rates };
      } finally {
        inFlight = false;
      }
    },

    openWifiSettings() {
      if (!shell || typeof shell.shellExec !== 'function') return Promise.resolve(null);
      const cmd = wifiSettingsCommand();
      // explorer.exe returns a nonzero exit code for a URI handoff even when
      // it succeeds, so a rejection here says nothing useful and is swallowed.
      return shell.shellExec(cmd.program, cmd.args).catch(() => null);
    },
  };
}
