// Pure logic for the launcher: what the typed query means, and which entries
// match it. Split out of launcher/launcher.js -- which imports zebar and
// touches `document` at module scope, and so can never be imported in a plain
// Node process -- so all of this can be asserted directly under `node --test`.
// Same split, and for the same reason, as dashboard-data.js and
// flyout-placement.js.

// Typing this prefix switches from searching applications to running commands,
// the way the Caelestia launcher does. The trailing space is NOT required to
// enter command mode: requiring it means the mode flips on the second
// character rather than the first, and the list visibly changes under you
// after you have already committed to a command.
export const COMMAND_PREFIX = '>';

/**
 * Splits raw input into a mode and the term being searched within it.
 *
 * Never throws and always returns a usable shape -- this runs on every
 * keystroke, and a launcher that can be put into an error state by typing is
 * worse than one that matches nothing.
 */
export function parseQuery(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (text.startsWith(COMMAND_PREFIX)) {
    return { mode: 'command', term: text.slice(COMMAND_PREFIX.length).trim() };
  }
  return { mode: 'app', term: text.trim() };
}

/**
 * Subsequence match, scored.
 *
 * Subsequence rather than substring because it is what makes a launcher feel
 * fast: "vsc" should find "Visual Studio Code" and "ffx" should find "Firefox".
 * Returns null for no match, or a score where LOWER IS BETTER, so callers sort
 * ascending.
 *
 * The scoring exists to stop technically-correct-but-useless matches winning.
 * Three things earn a better score, in order of weight:
 *
 *   1. matching at a WORD BOUNDARY (start of the name, or after a space,
 *      hyphen or dot) -- this is what makes "vsc" prefer "Visual Studio Code"
 *      over "Service Console"
 *   2. matching CONSECUTIVELY
 *   3. matching EARLY in the string
 *
 * Case-insensitive throughout; the caller does not lowercase anything.
 */
export function matchScore(text, term) {
  if (typeof text !== 'string') return null;
  if (typeof term !== 'string' || term === '') return 0;

  const hay = text.toLowerCase();
  const needle = term.toLowerCase();

  let score = 0;
  let at = -1;
  let previousAt = -2;

  for (let i = 0; i < needle.length; i++) {
    const ch = needle[i];
    at = hay.indexOf(ch, at + 1);
    if (at === -1) return null;

    const boundary = at === 0 || ' -_.()[]/\\'.includes(hay[at - 1]);
    if (!boundary) score += 8;
    if (at !== previousAt + 1) score += 4;
    score += Math.min(at, 40) / 10;      // capped, so a long path cannot dominate
    previousAt = at;
  }

  // A shorter name containing the same subsequence is almost always the one
  // meant -- "Code" over "Visual Studio Code Insiders Setup Helper".
  score += Math.min(hay.length, 60) / 30;

  // A CONTIGUOUS match has to outrank a scattered one, and the per-character
  // rules above actively work against that: every letter of "code" inside
  // "CodeBlocks" is mid-word and takes the non-boundary penalty, while
  // "Corel DESIGNER" pays it only twice because its d and e happen to fall at
  // word starts. Measured against the real Start Menu, that ranked
  // "Corel DESIGNER 2025" above "CodeBlocks" for the query "code".
  //
  // So a substring is scored as what it is -- a much stronger signal than a
  // subsequence -- rather than trying to re-balance the per-character weights
  // until it falls out by accident.
  if (hay.startsWith(needle)) {
    score -= 60;
  } else {
    const idx = hay.indexOf(needle);
    if (idx > 0) {
      score -= ' -_.()[]/\\'.includes(hay[idx - 1]) ? 45 : 25;
    }
  }
  return score;
}

/**
 * Ranks entries against a term. `key` names the field to match on.
 *
 * Stable for equal scores: Array.prototype.sort is required to be stable in
 * modern JS, so entries that tie keep their incoming order, which for
 * applications is alphabetical and for commands is the order they are declared
 * in. That matters -- an unstable order would make the highlighted row jump
 * around between identical searches.
 */
export function rank(entries, term, { key = 'name', limit = 8 } = {}) {
  if (!Array.isArray(entries)) return [];
  const scored = [];
  for (const entry of entries) {
    if (!entry) continue;
    const score = matchScore(entry[key], term);
    if (score === null) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.entry);
}

/** Wraps an index into range, so arrowing past either end rolls around. */
export function moveSelection(index, delta, count) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const next = (index + delta) % count;
  return next < 0 ? next + count : next;
}

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const REPO = 'C:\\Users\\PC\\Documents\\git\\setup';
const RUNDLL = 'C:\\Windows\\System32\\rundll32.exe';

/**
 * The command palette, reached with the `>` prefix.
 *
 * Every `run` here is a (program, args) pair that already matches an entry in
 * the launcher's `shellCommands` allowlist in zpack.json. Those two are a
 * MATCHED PAIR -- the allowlist compares the program string literally, so
 * changing one without the other fails at runtime with a privilege error
 * rather than falling back to anything.
 *
 * Glyphs are Font Awesome Free 6 Solid, the same family the bar uses, written
 * as \uXXXX escapes per this repo's rule (raw private-use characters have been
 * silently stripped from a config in this repo before).
 */
export const COMMANDS = [
  {
    id: 'wallpaper',
    name: 'Wallpaper',
    detail: 'Change the current wallpaper',
    glyph: '\uF03E',
    run: { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-next-wallpaper.ps1`] },
  },
  {
    id: 'retheme',
    name: 'Retheme',
    detail: 'Re-apply the theme from the current wallpaper',
    glyph: '\uF53F',
    run: { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-retheme.ps1`] },
  },
  {
    id: 'reload',
    name: 'Reload widgets',
    detail: 'Restart every Zebar widget',
    glyph: '\uF2F1',
    run: { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-reload-widgets.ps1`] },
  },
  {
    id: 'lock',
    name: 'Lock',
    detail: 'Lock the current session',
    glyph: '\uF023',
    run: { program: RUNDLL, args: ['user32.dll,LockWorkStation'] },
  },
  {
    id: 'sleep',
    name: 'Sleep',
    detail: 'Suspend then hibernate',
    glyph: '\uF186',
    run: { program: RUNDLL, args: ['powrprof.dll,SetSuspendState', '0,1,0'] },
  },
  {
    id: 'shutdown',
    name: 'Shut down',
    detail: 'Power off the machine',
    glyph: '\uF011',
    run: { program: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '0'] },
  },
];

export const APP_LIST_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\app-list.exe';

export function listAppsCommand() {
  return { program: APP_LIST_PATH, args: ['list'] };
}

export function appIconsCommand(paths) {
  return { program: APP_LIST_PATH, args: ['icons', ...paths] };
}

/**
 * Parses app-list.exe's output. Never throws: it is another process's stdout
 * and can be empty or truncated if it is killed mid-write.
 */
export function parseAppList(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.apps)) return [];
  return parsed.apps
    .filter((a) => a && typeof a.name === 'string' && a.name !== '' && typeof a.path === 'string' && a.path !== '')
    .map((a) => ({ name: a.name, path: a.path, icon: typeof a.icon === 'string' ? a.icon : null }));
}

/** Parses the `icons` verb's output into a plain path -> dataUrl|null map. */
export function parseIcons(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return {};
  }
  if (!parsed || !parsed.icons || typeof parsed.icons !== 'object') return {};
  const out = {};
  for (const [path, icon] of Object.entries(parsed.icons)) {
    out[path] = typeof icon === 'string' && icon !== '' ? icon : null;
  }
  return out;
}

/**
 * The subtitle shown under an application's name: the Start Menu folder it
 * lives in, not its path.
 *
 * The raw path is unusable as a subtitle -- every entry begins with the same
 * 60 characters of `C:\Users\PC\AppData\Roaming\Microsoft\Windows\Start
 * Menu\Programs\`, so the only part that differs is off the right-hand edge,
 * and the rows all read identically. The folder is the part a person recognises
 * ("Visual Studio Code", "Accessories"), and it is what distinguishes two
 * entries with similar names.
 *
 * Returns '' for an item sitting directly in Programs, which then renders with
 * no subtitle at all rather than a placeholder.
 */
export function appFolder(path) {
  if (typeof path !== 'string') return '';
  const marker = /\\start menu\\programs\\/i;
  const m = marker.exec(path);
  const tail = m ? path.slice(m.index + m[0].length) : path;
  const cut = tail.lastIndexOf('\\');
  return cut === -1 ? '' : tail.slice(0, cut).replace(/\\/g, ' / ');
}

/**
 * Launching an application means handing a path to the shell.
 *
 * `explorer.exe <path>` rather than running the .lnk directly: shellExec
 * launches a program with arguments, and a .lnk is not a program -- it needs
 * ShellExecute semantics to be resolved, which is exactly what handing it to
 * explorer provides. It also drops the child immediately rather than leaving
 * the launched application parented to zebar, which matters here: this pack
 * has twice lost a debugging session to a shellExec child outliving its parent
 * and inheriting zebar's listening socket on port 6124.
 */
export const EXPLORER = 'C:\\Windows\\explorer.exe';

export function launchCommand(path) {
  return { program: EXPLORER, args: [path] };
}

/** A shortcut path is validated against the shape the allowlist permits. */
export function isSafeAppPath(path) {
  return typeof path === 'string'
    && path.length > 4
    && path.length < 512
    && /\.lnk$/i.test(path)
    && !path.includes('"');
}
