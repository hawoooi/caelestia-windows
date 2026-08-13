// Album art for the currently playing track.
//
// Zebar's media provider carries title/artist/album/position and NO artwork --
// grepping the vendored bundle for thumbnail/artwork/albumArt/coverArt returns
// nothing, so there is no field being overlooked. Direct user report: "it
// still can't fetch the current playing media image (this was possible in my
// previous yasb bar)". Correct on both counts; yasb read the Windows SMTC API
// directly rather than going through a provider, and tools/media-art.cs now
// does the same for this pack.
//
// Same split as net-stats.js and gpu-stats.js: pure parsing here, testable
// without a shell, and a stateful fetcher that owns the caching and the
// process discipline.

export const MEDIA_ART_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\media-art.exe';

export function artCommand() {
  return { program: MEDIA_ART_PATH, args: [] };
}

// One key for "which track is this". Case- and whitespace-insensitive,
// because players are not consistent about either between the metadata they
// report to the provider and the metadata they report to SMTC -- and a key
// that disagrees between the two would re-fetch the same cover forever.
export function trackKey(title, artist) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(title)}\u0000${norm(artist)}`;
}

/**
 * Parses media-art.exe's single output line: `<title>\t<artist>\t<base64>`.
 *
 * Never throws; returns null for anything malformed. The tool prints nothing
 * at all on every failure it knows about (no session, no thumbnail, timeout),
 * so an empty string is the ORDINARY case, not an error -- plenty of tracks
 * genuinely have no cover.
 */
export function parseArt(stdout) {
  if (typeof stdout !== 'string') return null;
  const line = stdout.replace(/\r?\n$/, '');
  if (!line) return null;

  const tab = line.indexOf('\t');
  if (tab === -1) return null;
  const tab2 = line.indexOf('\t', tab + 1);
  if (tab2 === -1) return null;

  const title = line.slice(0, tab);
  const artist = line.slice(tab + 1, tab2);
  const b64 = line.slice(tab2 + 1);
  if (!b64) return null;
  // Cheap sanity check: base64 only. Catches a tool that started printing a
  // diagnostic before anyone notices it rendering as a broken image.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;

  // image/png is a lie only in the MIME label: SMTC thumbnails are usually
  // JPEG. Browsers sniff the actual bytes for data: URIs, so the label does
  // not have to be right -- but PNG is the label app-icon.js already uses, so
  // both stay consistent.
  return { title, artist, dataUrl: `data:image/png;base64,${b64}` };
}

/**
 * Fetches artwork for a track, at most once per track.
 *
 * Three things this has to get right, all of which cost something if wrong:
 *
 * 1. **One spawn per track, not one per render.** The panel re-renders on
 *    every provider emission -- once a second or faster. Spawning a process
 *    that often is exactly the pattern that has twice orphaned a helper onto
 *    zebar's listening socket and blanked every widget.
 * 2. **Discard a stale answer.** The fetch is async; the song can change
 *    while it is in flight. media-art.exe echoes back the track its image is
 *    actually for, which is the only reliable way to tell -- so an answer for
 *    a track that is no longer current is dropped rather than shown.
 * 3. **Remember failures too.** A track with no cover must be asked once, not
 *    once per second forever.
 */
export function createMediaArt(shell, { maxEntries = 24 } = {}) {
  const cache = new Map();   // trackKey -> dataUrl | null (null = asked, none)
  let inFlight = false;

  return {
    /** Synchronous cache read: what the renderer calls on every frame. */
    cached(title, artist) {
      const key = trackKey(title, artist);
      return cache.has(key) ? cache.get(key) : undefined;
    },

    /**
     * Fetches if this track has not been asked about yet. Resolves to the
     * data URL, or null when there is no art (or no way to get it).
     */
    async fetch(title, artist) {
      const key = trackKey(title, artist);
      if (cache.has(key)) return cache.get(key);
      if (inFlight) return undefined;          // try again on the next render
      if (!shell || typeof shell.shellExec !== 'function') return null;

      inFlight = true;
      try {
        const cmd = artCommand();
        let stdout = '';
        try {
          const res = await shell.shellExec(cmd.program, cmd.args);
          stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
        } catch (e) {
          // Nonzero exit is the tool's documented "no art" signal, not a
          // fault worth logging on every silent track.
          stdout = '';
        }

        const parsed = parseArt(stdout);
        if (!parsed) {
          remember(cache, key, null, maxEntries);
          return null;
        }

        // (2): store the answer under the track it is ACTUALLY for, which may
        // not be the one that was asked about.
        const actualKey = trackKey(parsed.title, parsed.artist);
        remember(cache, actualKey, parsed.dataUrl, maxEntries);
        if (actualKey !== key) {
          // The song changed mid-fetch. Do not attribute this cover to the
          // track that was asked about; leave that one unasked so the next
          // render retries it.
          return undefined;
        }
        return parsed.dataUrl;
      } finally {
        inFlight = false;
      }
    },
  };
}

// A plain bounded LRU-ish map: oldest insertion evicted first. A playlist can
// run for hours, and each entry is a base64 image worth ~100KB.
function remember(cache, key, value, maxEntries) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}
