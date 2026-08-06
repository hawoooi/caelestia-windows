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

register('activeWindow', () => {
  const el = document.createElement('div');
  el.className = 'active-window';
  return {
    el,
    update(out) {
      const name = appName(focusedWindow(out.komorebi)?.exe);
      el.textContent = name;
      el.style.display = name ? '' : 'none';
    },
  };
});
