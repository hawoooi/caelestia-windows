// Turns the komorebi provider's workspace tree into the flat, app-grouped
// list the dock renders. Direct user feedback: the Windows taskbar should be
// replaced by something that keeps "only opened apps on it" and matches the
// left bar.
//
// Pure and DOM-free, so the shape-walking -- which is where this gets fiddly,
// because a window can live in four different places in that tree -- is
// assertable against real captured provider output in
// tests/js/dockItems.test.mjs.
//
// The tree, read live off this machine rather than assumed:
//
//   focusedWorkspace.tilingContainers[] -> .windows[]   normal tiled windows
//   focusedWorkspace.floatingWindows[]                  floated windows
//   focusedWorkspace.maximizedWindow                    a single maximized one
//   focusedWorkspace.monocleContainer -> .windows[]     monocle mode
//
// A window object is { id, class, exe, hwnd, title, role, subrole, iconPath }.
// Only `exe`, `hwnd` and `title` are used here; `iconPath` is always null on
// this build (checked), which is why icons come from tools/app-icon.exe
// instead.

// Windows that are on screen but are not "apps" in the taskbar sense. The bar
// and its flyouts are themselves windows, and a dock that listed itself would
// be both silly and, for the flyouts, flickery -- they appear and disappear.
const HIDDEN_EXES = new Set(['zebar.exe']);

function windowsOfContainer(container) {
  if (!container || !Array.isArray(container.windows)) return [];
  return container.windows.filter(Boolean);
}

// Every window on a workspace, from all four places komorebi can put one.
export function workspaceWindows(workspace) {
  if (!workspace || typeof workspace !== 'object') return [];
  const out = [];

  if (Array.isArray(workspace.tilingContainers)) {
    for (const container of workspace.tilingContainers) out.push(...windowsOfContainer(container));
  }
  if (Array.isArray(workspace.floatingWindows)) {
    out.push(...workspace.floatingWindows.filter(Boolean));
  }
  if (workspace.maximizedWindow) out.push(workspace.maximizedWindow);
  out.push(...windowsOfContainer(workspace.monocleContainer));

  // A maximized or monocled window can also still appear in tilingContainers
  // depending on how it got there, so dedupe by hwnd -- otherwise the dock
  // shows a phantom second copy of whatever is currently maximized.
  const seen = new Set();
  return out.filter((w) => {
    if (!w || typeof w.exe !== 'string' || w.exe === '') return false;
    const key = w.hwnd ?? `${w.exe}:${w.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Which exe currently has focus, so the dock can mark it. focusedContainerIndex
// indexes tilingContainers, NOT a flat window list -- an easy and silent
// off-by-one if you assume otherwise.
export function focusedExe(workspace) {
  if (!workspace) return null;
  if (workspace.maximizedWindow?.exe) return workspace.maximizedWindow.exe.toLowerCase();
  const monocle = windowsOfContainer(workspace.monocleContainer);
  if (monocle.length && monocle[0].exe) return monocle[0].exe.toLowerCase();

  const idx = workspace.focusedContainerIndex;
  if (!Array.isArray(workspace.tilingContainers) || !Number.isInteger(idx)) return null;
  const container = workspace.tilingContainers[idx];
  const windows = windowsOfContainer(container);
  if (!windows.length || typeof windows[0].exe !== 'string') return null;
  return windows[0].exe.toLowerCase();
}

// Groups windows by executable, the way a taskbar with combined buttons does.
// One icon per app, with a count when an app has several windows -- which is
// the common case here (two WezTerm windows, several Chrome windows).
//
// Order is FIRST-APPEARANCE, not alphabetical: a dock whose icons re-sort
// themselves as windows open and close is unusable, because the thing you are
// aiming at moves. First appearance follows komorebi's own container order,
// which is stable for as long as the windows are.
export function dockItems(komorebi, { hidden = HIDDEN_EXES } = {}) {
  const workspace = komorebi?.focusedWorkspace;
  const windows = workspaceWindows(workspace);
  const focused = focusedExe(workspace);

  const byExe = new Map();
  for (const w of windows) {
    const exe = w.exe.toLowerCase();
    if (hidden.has(exe)) continue;
    let item = byExe.get(exe);
    if (!item) {
      item = { exe: w.exe, key: exe, count: 0, titles: [], focused: false };
      byExe.set(exe, item);
    }
    item.count += 1;
    if (typeof w.title === 'string' && w.title !== '') item.titles.push(w.title);
    if (focused && exe === focused) item.focused = true;
  }
  return [...byExe.values()];
}

// A stable identity for the rendered set, so the dock only rebuilds its DOM
// when the apps actually change -- not on every provider emit, which would
// restart the icon fetches and make the row flicker under the cursor.
// Deliberately ignores titles and window counts... except that it does not:
// the count is part of the badge, so it has to be here. Titles are not, since
// they only ever reach a tooltip.
export function dockSignature(items) {
  return items.map((i) => `${i.key}:${i.count}:${i.focused ? 1 : 0}`).join('|');
}

// `komorebic eager-focus <exe>` -- "Focus the first managed window matching
// the given exe". Grouping by exe is what makes this the right call: the dock
// has one button per app, and this focuses that app. There is no focus-by-hwnd
// subcommand on this komorebic build (checked against `komorebic --help`).
export const KOMOREBIC_PATH = 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe';

export function focusCommand(exe) {
  return { program: KOMOREBIC_PATH, args: ['eager-focus', exe] };
}

// The dock only ever passes an exe name that came from the provider, but that
// value still ends up on a command line, so it is validated against the same
// shape the registered argsRegex allows rather than trusted.
export function isSafeExeName(exe) {
  return typeof exe === 'string' && /^[\w.\-]+\.exe$/i.test(exe);
}
