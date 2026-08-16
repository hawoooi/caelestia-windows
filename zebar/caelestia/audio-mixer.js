// Client side of tools/audio-mixer.exe -- the per-application volume mixer.
//
// Split out of panels/panels.js so the parsing, the command construction and
// the non-overlap/caching policy are all assertable under `node --test`
// without a browser or a real audio device (tests/js/audioMixer.test.mjs).
// The DOM half stays in panels.js.
//
// Everything here treats the helper's stdout as UNTRUSTED: it is another
// process's output, it can be truncated if the process is killed mid-write,
// and a malformed read must degrade to "no sessions" rather than throw out of
// a provider tick or a slider drag.

export const MIXER_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\audio-mixer.exe';

// The argsRegex registered in zpack.json is the real gate; these builders
// exist so the bar never hand-concatenates an argument string and drifts out
// of sync with it. Keep the two in step -- a builder that emits something the
// regex rejects fails at the privilege layer with no useful error.
export function listCommand(withIcons) {
  return { program: MIXER_PATH, args: withIcons ? ['list'] : ['list', '--no-icons'] };
}

export function setVolumeCommand(pid, volume) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  return { program: MIXER_PATH, args: ['set', String(pid), String(clamped)] };
}

export function setMuteCommand(pid, muted) {
  return { program: MIXER_PATH, args: ['mute', String(pid), muted ? '1' : '0'] };
}

// Never throws. Returns [] for anything that is not the expected shape.
export function parseSessions(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.sessions)) return [];
  return parsed.sessions
    .filter((s) => s && typeof s === 'object' && Number.isFinite(Number(s.pid)))
    .map((s) => ({
      pid: Number(s.pid),
      process: typeof s.process === 'string' ? s.process : '',
      display: typeof s.display === 'string' && s.display !== '' ? s.display : String(s.process || ''),
      volume: Math.max(0, Math.min(100, Math.round(Number(s.volume) || 0))),
      muted: Boolean(s.muted),
      system: Boolean(s.system),
      icon: typeof s.icon === 'string' && s.icon !== '' ? s.icon : null,
    }));
}

// Sessions arrive in whatever order the Core Audio enumerator hands them back,
// which is neither stable nor meaningful. Sorting keeps rows from jumping
// around under the cursor between polls -- system sounds last, then by display
// name, then by pid so two instances of the same app keep a fixed order.
export function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    if (a.system !== b.system) return a.system ? 1 : -1;
    const byName = a.display.localeCompare(b.display, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.pid - b.pid;
  });
}

// A signature of the session SET (not their volumes), used to decide whether
// the row DOM has to be rebuilt. Volume/mute changes update in place; only an
// app appearing or disappearing needs new rows.
export function sessionsSignature(sessions) {
  return sessions.map((s) => s.pid + ':' + s.process).join('|');
}

// Wraps the helper with the two disciplines this pack has paid for:
//
//  * NON-OVERLAPPING execution. A slider drag plus a poll tick can otherwise
//    have several helper processes in flight at once. Every one of them
//    enumerates Core Audio, and this pack has already lost two debugging
//    sessions to a shellExec helper outliving its parent and inheriting
//    zebar's listening socket (see fullscreen.js). One at a time, always.
//  * ICON CACHING. Icons are the expensive half of `list` and never change
//    while a process lives, so they are fetched once per pid and re-attached
//    from cache on every later poll, which runs `list --no-icons`.
export function createMixer(shell) {
  const icons = new Map();      // pid -> base64 png
  let inFlight = false;

  async function run(command) {
    if (!shell || typeof shell.shellExec !== 'function') return null;
    try {
      const res = await shell.shellExec(command.program, command.args);
      // zebar's shellExec resolves with { stdout, stderr, exitCode }.
      return res && typeof res.stdout === 'string' ? res.stdout : '';
    } catch (e) {
      // A nonzero exit rejects. That is the helper's documented way of saying
      // "nothing to report" (no such session, no default device), so it is a
      // normal outcome here, not an error worth surfacing to the user.
      return null;
    }
  }

  return {
    iconFor(pid) { return icons.get(pid) ?? null; },

    // `wantIcons` should be true only on the first refresh after the panel
    // opens; later polls reuse the cache.
    async refresh(wantIcons) {
      if (inFlight) return null;      // drop this tick rather than pile up
      inFlight = true;
      try {
        const stdout = await run(listCommand(Boolean(wantIcons)));
        if (stdout === null) return null;
        const sessions = sortSessions(parseSessions(stdout));
        for (const s of sessions) {
          if (s.icon) icons.set(s.pid, s.icon);
          else if (icons.has(s.pid)) s.icon = icons.get(s.pid);
        }
        // Forget icons for processes that have gone away, so a long-lived
        // widget cannot accumulate them forever.
        const live = new Set(sessions.map((s) => s.pid));
        for (const pid of [...icons.keys()]) if (!live.has(pid)) icons.delete(pid);
        return sessions;
      } finally {
        inFlight = false;
      }
    },

    // Writes deliberately bypass the in-flight guard: they are what the user
    // is actively doing, must not be dropped, and are cheap (no enumeration
    // of icons). Fail-soft -- a failed write just leaves the level where the
    // next poll finds it.
    setVolume(pid, volume) { return run(setVolumeCommand(pid, volume)); },
    setMute(pid, muted) { return run(setMuteCommand(pid, muted)); },
  };
}
