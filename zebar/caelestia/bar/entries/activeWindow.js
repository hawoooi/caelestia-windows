import { register } from './registry.js';

// Focus is flagged at the CONTAINER level, not per window. Verified against
// zebar's index.d.ts at both 3.0.3 and 3.3.1: `KomorebiWindow` is
// {id, class, exe, hwnd, title, role, subrole, icon_path} -- there is no
// `isFocused` field at any version. Use `focusedWorkspace.focusedContainerIndex`
// to pick the container, then the window within it.
//
// There is NO within-container focused-window index in zebar's type at all:
// `KomorebiContainer` is exactly {id: string, windows: KomorebiWindow[]} at
// both 3.0.3 and 3.3.1 (checked via `npm pack zebar@<version>` and reading
// dist/index.d.ts) -- no `focusedWindowIndex` or similar field exists to read.
// This isn't a naming guess to correct; zebar simply doesn't expose which
// window in a stacked container has focus, so windows[0] is the only option
// the provider gives us. It is also correct for the common case of a
// single-window container, which is the vast majority of the time.
//
// Change 2: this used to return the window's `title`. Titles run far too
// long for a 52px vertical bar (a real observed case: `imation movie
// "Before you` -- a mid-string fragment of a much longer title, clipped
// wherever the vertical column's max-height happened to cut it). The
// display now derives from `exe` instead (see appName() below) -- `exe` is
// a real, populated field on this build, re-confirmed directly against a
// live `komorebic state` capture during this task: `"exe": "wezterm-gui.exe"`,
// `"exe": "vesktop.exe"`, `"exe": "chrome.exe"`, `"exe": "explorer.exe"`,
// `"exe": "foobar2000.exe"` were all present on real windows, not guessed.
// `focusedWindow()` below keeps the exact same container/focus-selection
// logic the old `windowTitle()` had (unit-tested already, see
// tests/js/entries.test.mjs) -- only what gets read off the resolved
// window object changed.
export function focusedWindow(komorebi) {
  const ws = komorebi?.focusedWorkspace;
  const containers = ws?.tilingContainers;
  if (!Array.isArray(containers)) return null;

  const ci = ws.focusedContainerIndex;
  const container = typeof ci === 'number' ? containers[ci] : undefined;
  if (!container) return null;

  const windows = container.windows ?? [];
  return windows[0] ?? null;
}

// wezterm-gui/Code/explorer/chrome/msedge are the ones that read badly (or
// inconsistently-cased) raw -- everything else falls back to its own
// stripped exe name unchanged, per the brief ("never fall back to the
// window title"). Keys are lower-cased stripped exe names; lookup below
// lower-cases before matching so `Code.exe`/`code.exe`/`CODE.EXE` all hit
// the same entry regardless of how komorebi reports the casing.
const ALIASES = {
  'wezterm-gui': 'WezTerm',
  'code': 'VS Code',
  'explorer': 'Explorer',
  'chrome': 'Chrome',
  'msedge': 'Edge',
};

// Backstop truncation for a genuinely long, unaliased exe name -- CSS
// text-overflow: ellipsis exists on .active-window too, but in a vertical
// writing-mode column with a fixed max-height it clips wherever the box
// happens to end, not necessarily with a visible "..." (the mid-string
// title-fragment bug this whole change replaces was exactly that). This
// guarantees a bounded, ellipsis-terminated string regardless of how the
// CSS clips it.
const MAX_LEN = 14;

export function appName(exe) {
  if (typeof exe !== 'string') return '';
  const trimmed = exe.trim();
  if (trimmed === '') return '';
  const stripped = trimmed.replace(/\.exe$/i, '');
  const alias = ALIASES[stripped.toLowerCase()];
  const name = alias ?? stripped;
  if (name.length > MAX_LEN) return `${name.slice(0, MAX_LEN - 1)}…`;
  return name;
}

// --- App icon (real exe icon, not a hand-mapped brand glyph) ---------------
//
// The user asked for the FOCUSED APPLICATION'S OWN ICON, read literally: the
// real icon of the running executable, not a Font Awesome brand glyph table
// (that covers Chrome/Discord and falls over on WezTerm, foobar2000, and
// everything else on this machine -- there is no FA brand icon for any of
// those). ../tools/app-icon.cs (compiled app-icon.exe) does the actual
// extraction -- see its own doc comment for how it resolves an exe NAME
// (never a path; komorebi's provider only ever gives a name, see
// focusedWindow()'s own comment above and docs/zebar-bar.md) to a running
// process's module path and prints a base64 PNG of its shell icon.
//
// This module never shells out on every provider tick -- doing so would
// repeat the exact port-6124-orphan risk class this pack has already been
// burned by once (fullscreen-detect.exe outliving its parent zebar, see
// fullscreen.js's own doc comment and docs/zebar-bar.md's troubleshooting
// section). createIconController below is the guard: it shells out only
// when the focused exe actually CHANGES (an unchanged focus returns before
// touching `shell` at all), caches every result (success AND failure, keyed
// by lower-cased exe name, so a permanently icon-less exe is never re-probed
// every time it regains focus), never starts a second app-icon.exe while one
// is still outstanding, and races every call against a timeout -- the same
// three disciplines fullscreen.js's startFullscreenWatch already
// established for its own shellExec poll.
const ICON_TOOL_PATH = 'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\app-icon.exe';
const ICON_TIMEOUT_MS = 2000;

export function iconCacheKey(exe) {
  return String(exe).trim().toLowerCase();
}

// Runs app-icon.exe for one exe name and returns a `data:image/png;base64,...`
// URL, or null on any failure/empty output/no-shell/timeout -- caching the
// result (including null) in `cache` so a repeat lookup for the same exe
// never shells out again. Exported standalone (no DOM, no controller state)
// so the caching/timeout/fail-soft behavior can be unit tested directly,
// the same way fullscreen.js exports isFullscreenState separately from the
// stateful startFullscreenWatch.
export async function fetchIcon(shell, exeName, cache, timeoutMs) {
  const key = iconCacheKey(exeName);
  if (cache.has(key)) return cache.get(key);

  if (!shell || typeof shell.shellExec !== 'function') {
    // No shellExec on this build: fail soft, same as fullscreen.js -- and
    // still cache the miss, so a shell-less build doesn't retry forever.
    cache.set(key, null);
    return null;
  }

  let timer;
  try {
    const result = await Promise.race([
      shell.shellExec(ICON_TOOL_PATH, [exeName]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('app-icon probe timed out')), timeoutMs || ICON_TIMEOUT_MS);
      }),
    ]);
    const b64 = String(result && result.stdout ? result.stdout : '').trim();
    const dataUrl = b64 ? `data:image/png;base64,${b64}` : null;
    cache.set(key, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error('app-icon extraction failed, falling back to glyph', e);
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Stateful controller wrapping fetchIcon with the "only shell out when the
// focused app CHANGES" rule plus an in-flight guard (never overlap two
// app-icon.exe calls). `update(exe, onResolve)` is meant to be called once
// per provider tick with whatever `focusedWindow(out.komorebi)?.exe`
// currently is:
//   - unchanged exe (same app still focused)  -> returns immediately, no
//     shell-out, onResolve is NOT called (the DOM is already correct).
//   - changed exe, already cached             -> onResolve fires
//     synchronously with the cached result (still no shell-out).
//   - changed exe, not cached                 -> onResolve(null) fires
//     immediately (show the fallback glyph while the probe is outstanding),
//     then again asynchronously once the probe resolves -- but ONLY if the
//     focused exe hasn't changed AGAIN in the meantime, so a slow probe for
//     an app the user has since switched away from can never clobber the
//     icon of whatever is focused now.
export function createIconController(shell, timeoutMs) {
  const cache = new Map();
  let currentExe = null;
  let inFlight = false;

  return {
    update(exe, onResolve) {
      const normalized = typeof exe === 'string' ? exe.trim() : '';

      if (normalized === '') {
        currentExe = null;
        onResolve(null);
        return;
      }
      if (normalized === currentExe) return; // unchanged focus -- no shell-out
      currentExe = normalized;

      const key = iconCacheKey(normalized);
      if (cache.has(key)) {
        onResolve(cache.get(key));
        return;
      }

      onResolve(null); // fallback glyph while the probe is outstanding
      if (inFlight) return; // never overlap a second app-icon.exe call
      inFlight = true;
      fetchIcon(shell, normalized, cache, timeoutMs)
        .then((dataUrl) => {
          if (currentExe === normalized) onResolve(dataUrl);
        })
        .finally(() => {
          inFlight = false;
        });
    },
  };
}

// Font Awesome Free 6 Solid "window-maximize" (\uF2D0) -- a neutral glyph
// for when extraction fails or the focused app has no icon, per the brief:
// "fall back to a neutral Font Awesome Solid glyph (window-maximize) rather
// than leaving a gap or a broken image". Written as a literal \uXXXX escape
// per CLAUDE.md's "Nerd Font glyphs" discipline (raw pasted PUA glyphs have
// previously been silently dropped by tooling between drafting and the file
// write).
const FALLBACK_GLYPH = '\uF2D0';

register('activeWindow', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'active-window';

  // Icon sits BEFORE the name in reading order -- above it in the vertical
  // writing-mode flow, per the brief. The icon box itself gets no
  // writing-mode of its own (only .active-window__name below does), so
  // whichever of these two children is visible stays upright regardless of
  // the name's own vertical-rl rotation.
  const iconBox = document.createElement('span');
  iconBox.className = 'active-window__icon';
  const iconImg = document.createElement('img');
  iconImg.className = 'active-window__icon-img';
  iconImg.alt = '';
  const iconFallback = document.createElement('span');
  iconFallback.className = 'active-window__icon-fallback fa-solid';
  iconFallback.textContent = FALLBACK_GLYPH;
  iconBox.append(iconImg, iconFallback);

  const name = document.createElement('div');
  name.className = 'active-window__name';

  el.append(iconBox, name);

  // Both branches set an EXPLICIT display value on both elements, never ''.
  // `.active-window__icon-img`'s CSS default is `display: none` (so a bare
  // <img> with no src never flashes a broken-image icon before JS runs --
  // see style.css's own comment) -- clearing an inline style with `''`
  // does NOT override that stylesheet rule, it just re-reveals it, which
  // silently meant showImage() could never actually show the image (caught
  // live: a real, successfully-extracted icon stayed invisible because
  // `iconImg.style.display = ''` fell straight back to the CSS `none`).
  function showFallback() {
    iconImg.removeAttribute('src');
    iconImg.style.display = 'none';
    iconFallback.style.display = 'inline';
  }

  function showImage(dataUrl) {
    iconImg.src = dataUrl;
    iconImg.style.display = 'inline-block';
    iconFallback.style.display = 'none';
  }

  showFallback(); // default state before the first icon (or failure) resolves

  const iconController = createIconController(shell);

  return {
    el,
    update(out) {
      const exe = focusedWindow(out.komorebi)?.exe;
      const label = appName(exe);
      name.textContent = label;
      el.style.display = label ? '' : 'none';

      iconController.update(exe, (dataUrl) => {
        if (dataUrl) showImage(dataUrl);
        else showFallback();
      });
    },
  };
});
