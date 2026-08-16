// Builds the dock's app list by MERGING TWO SOURCES, because neither one
// knows about all the windows on its own.
//
// Direct user feedback: "the taskbar should also show hidden and ignored apps
// as well". The dock was originally built on komorebi's provider alone, which
// cannot satisfy that, and the two gaps have different causes:
//
//   * IGNORED apps -- anything matched by ~/komorebi.json's ignore_rules
//     (PowerToys, Taskmgr, Lively, foobar2000 on this machine) is not in
//     komorebi's model at all, so no amount of reading its state finds them.
//     tools/window-list.exe enumerates the OS's own alt-tab windows and does.
//
//   * HIDDEN apps -- windows on a workspace that is not currently displayed.
//     komorebi hides these at the OS level, so IsWindowVisible is false and
//     window-list.exe cannot see them either. Verified live rather than
//     assumed: with Chrome on another workspace, window-list returned only
//     foobar2000 and WezTerm. komorebi's allWorkspaces DOES have them.
//
// So: komorebi supplies every managed window across every workspace, and
// window-list supplies everything komorebi is not managing. Merged and grouped
// per executable, that is the full taskbar set.

const HIDDEN_EXES = new Set(['zebar.exe']);

function windowsOfContainer(container) {
  if (!container || !Array.isArray(container.windows)) return [];
  return container.windows.filter(Boolean);
}

// Every window on one workspace, from all four places komorebi can put one:
// tiling containers, floating windows, a maximized window, or a monocle
// container.
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

  return out.filter((w) => w && typeof w.exe === 'string' && w.exe !== '');
}

// Every managed window on EVERY workspace -- which is what makes windows on
// other workspaces ("hidden") appear in the dock. Falls back to the focused
// workspace alone if allWorkspaces is missing, so an older provider shape
// degrades to the previous behaviour rather than to nothing.
export function managedWindows(komorebi) {
  const all = komorebi?.allWorkspaces;
  const spaces = Array.isArray(all) && all.length ? all : [komorebi?.focusedWorkspace];
  const out = [];
  for (const space of spaces) out.push(...workspaceWindows(space));
  return out;
}

// Which exe currently has focus per komorebi. focusedContainerIndex indexes
// tilingContainers, NOT a flat window list -- an easy and silent off-by-one.
// Only used as a fallback: window-list reports the real foreground window,
// which is authoritative and also covers ignored apps.
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

// Parses tools/window-list.exe's stdout. Never throws: it is another process's
// output and can be empty or truncated if it is killed mid-write.
export function parseWindowList(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.windows)) return [];
  return parsed.windows
    .filter((w) => w && typeof w.exe === 'string' && w.exe !== '' && Number.isFinite(Number(w.hwnd)))
    .map((w) => ({
      hwnd: Number(w.hwnd),
      exe: w.exe,
      title: typeof w.title === 'string' ? w.title : '',
      minimized: Boolean(w.minimized),
      focused: Boolean(w.focused),
    }));
}

// Groups both sources into one entry per executable, the way a taskbar with
// combined buttons does.
//
// Order is FIRST-APPEARANCE, not alphabetical: a dock whose icons re-sort as
// windows open and close is unusable, because the thing you are aiming at
// moves. komorebi's windows come first (they are the ones in the tiling order
// the user arranged), then anything only the OS knows about.
export function dockItems(komorebi, windowList = [], { hidden = HIDDEN_EXES } = {}) {
  const byExe = new Map();

  const add = (exe, { hwnd = null, title = '', focused = false, minimized = false } = {}) => {
    const key = String(exe).toLowerCase();
    if (hidden.has(key)) return;
    let item = byExe.get(key);
    if (!item) {
      item = { exe, key, count: 0, titles: [], focused: false, minimized: true, hwnd: null };
      byExe.set(key, item);
    }
    item.count += 1;
    if (title) item.titles.push(title);
    if (focused) item.focused = true;
    // An app counts as minimized only when EVERY one of its windows is; one
    // restored window means the app is on screen somewhere.
    if (!minimized) item.minimized = false;
    if (item.hwnd === null && hwnd !== null) item.hwnd = hwnd;
  };

  const komorebiFocus = focusedExe(komorebi?.focusedWorkspace);
  for (const w of managedWindows(komorebi)) {
    add(w.exe, {
      hwnd: Number.isFinite(Number(w.hwnd)) ? Number(w.hwnd) : null,
      title: typeof w.title === 'string' ? w.title : '',
      focused: komorebiFocus !== null && w.exe.toLowerCase() === komorebiFocus,
      minimized: false,
    });
  }

  // Only add OS windows for apps komorebi did not already account for.
  // Counting both would double every managed window, since window-list sees
  // the ones on the displayed workspace too.
  const known = new Set(byExe.keys());
  for (const w of windowList) {
    if (known.has(w.exe.toLowerCase())) {
      // Still let the real foreground window win the focus marker: it is
      // authoritative, and it is the only source that can mark an IGNORED app
      // as focused.
      if (w.focused) {
        const item = byExe.get(w.exe.toLowerCase());
        if (item) item.focused = true;
      }
      continue;
    }
    add(w.exe, { hwnd: w.hwnd, title: w.title, focused: w.focused, minimized: w.minimized });
  }

  // Exactly one item can be focused. window-list's foreground window is the
  // truth; komorebi's guess is dropped when the two disagree.
  const osFocused = windowList.find((w) => w.focused);
  if (osFocused) {
    const winner = osFocused.exe.toLowerCase();
    for (const item of byExe.values()) item.focused = item.key === winner;
  }

  return [...byExe.values()];
}

// A stable identity for the rendered set, so the dock only rebuilds its DOM
// when something visible actually changes -- not on every poll, which would
// restart the icon fetches and flicker the row under the cursor.
export function dockSignature(items) {
  return items.map((i) => `${i.key}:${i.count}:${i.focused ? 1 : 0}:${i.minimized ? 1 : 0}`).join('|');
}

export const WINDOW_LIST_PATH =
  'C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\window-list.exe';

export function listWindowsCommand() {
  return { program: WINDOW_LIST_PATH, args: ['list'] };
}

// Focus by WINDOW HANDLE rather than by exe.
//
// The dock used `komorebic eager-focus <exe>` before, which cannot focus what
// komorebi does not manage -- i.e. exactly the ignored apps this change adds.
// window-list.exe's own focus verb works for every window, managed or not, and
// restores it first if minimized.
export function focusCommand(hwnd) {
  return { program: WINDOW_LIST_PATH, args: ['focus', String(hwnd)] };
}

// The handle comes from the helper's own output, but it still ends up on a
// command line, so it is validated against the shape the registered argsRegex
// allows rather than trusted.
export function isSafeHandle(hwnd) {
  return Number.isInteger(hwnd) && hwnd > 0 && hwnd <= Number.MAX_SAFE_INTEGER;
}
