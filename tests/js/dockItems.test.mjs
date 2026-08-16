// The dock's app list, which merges TWO sources because neither knows about
// every window on its own:
//
//   komorebi's provider -> every MANAGED window, on every workspace
//   tools/window-list.exe -> every alt-tab window the OS knows about
//
// Both gaps are real and were observed live, not theorised. With Chrome on
// another workspace, window-list.exe returned only foobar2000 and WezTerm --
// komorebi hides off-workspace windows at the OS level, so IsWindowVisible is
// false for them. And foobar2000 appeared ONLY in window-list, because
// ~/komorebi.json ignores it, so it is not in komorebi's model at all.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  workspaceWindows,
  managedWindows,
  focusedExe,
  parseWindowList,
  dockItems,
  dockSignature,
  focusCommand,
  listWindowsCommand,
  isSafeHandle,
  WINDOW_LIST_PATH,
} from '../../zebar/caelestia/dock-items.js';

const win = (exe, hwnd, title) => ({ id: null, class: 'X', exe, hwnd, title, role: null, subrole: null, iconPath: null });

const WS1 = {
  focusedContainerIndex: 0,
  floatingWindows: [],
  maximizedWindow: null,
  monocleContainer: null,
  tilingContainers: [
    { id: 'a', windows: [win('wezterm-gui.exe', 101, 'Modify layout')] },
    { id: 'b', windows: [win('wezterm-gui.exe', 102, 'powershell')] },
  ],
};
const WS2 = {
  focusedContainerIndex: 0,
  tilingContainers: [{ id: 'c', windows: [win('chrome.exe', 201, 'Google')] }],
};
const KOMOREBI = { focusedWorkspace: WS1, allWorkspaces: [WS1, WS2] };

// Real shape, captured from the built helper.
const LIST = JSON.stringify({ windows: [
  { hwnd: 900, pid: 3640, exe: 'foobar2000.exe', title: 'RIGHT LIGHT', minimized: false, focused: true },
  { hwnd: 102, pid: 700,  exe: 'wezterm-gui.exe', title: 'powershell', minimized: false, focused: false },
]});

// --- walking komorebi's tree ---------------------------------------------

test('collects windows from all four places komorebi can put one', () => {
  const ws = {
    tilingContainers: [{ id: 'a', windows: [win('a.exe', 1, 'A')] }],
    floatingWindows: [win('b.exe', 2, 'B')],
    maximizedWindow: win('c.exe', 3, 'C'),
    monocleContainer: { id: 'm', windows: [win('d.exe', 4, 'D')] },
  };
  assert.deepStrictEqual(workspaceWindows(ws).map((w) => w.exe), ['a.exe', 'b.exe', 'c.exe', 'd.exe']);
});

test('managedWindows spans EVERY workspace, not just the focused one', () => {
  // This is what makes an app on another workspace ("hidden") appear at all --
  // window-list.exe cannot see it, because komorebi hides it at the OS level.
  const exes = managedWindows(KOMOREBI).map((w) => w.exe);
  assert.deepStrictEqual(exes, ['wezterm-gui.exe', 'wezterm-gui.exe', 'chrome.exe']);
});

test('managedWindows falls back to the focused workspace when allWorkspaces is absent', () => {
  const exes = managedWindows({ focusedWorkspace: WS1 }).map((w) => w.exe);
  assert.deepStrictEqual(exes, ['wezterm-gui.exe', 'wezterm-gui.exe']);
});

test('malformed trees yield nothing rather than throwing', () => {
  for (const bad of [null, undefined, {}, { tilingContainers: null }, { tilingContainers: [null] }, 42]) {
    assert.doesNotThrow(() => workspaceWindows(bad));
    assert.deepStrictEqual(workspaceWindows(bad), []);
  }
  assert.deepStrictEqual(managedWindows(null), []);
});

test('focusedContainerIndex indexes CONTAINERS, not a flat window list', () => {
  const ws = { ...WS1, focusedContainerIndex: 1 };
  assert.strictEqual(focusedExe(ws), 'wezterm-gui.exe');
  assert.strictEqual(focusedExe({ ...WS1, focusedContainerIndex: 99 }), null);
  assert.strictEqual(focusedExe(null), null);
});

// --- parsing the OS window list ------------------------------------------

test('parses real window-list output', () => {
  const list = parseWindowList(LIST);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].exe, 'foobar2000.exe');
  assert.strictEqual(list[0].hwnd, 900);
  assert.strictEqual(list[0].focused, true);
});

test('malformed, empty and truncated window-list output degrade to nothing', () => {
  for (const bad of ['', '  ', 'not json', LIST.slice(0, 40), '{}', '{"windows":null}', null, 7]) {
    assert.deepStrictEqual(parseWindowList(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

// --- the merge ------------------------------------------------------------

test('an IGNORED app appears, even though komorebi has never heard of it', () => {
  // foobar2000 is in ~/komorebi.json's ignore_rules on this machine, so it is
  // absent from komorebi's model entirely. This is the headline requirement.
  const items = dockItems(KOMOREBI, parseWindowList(LIST));
  assert.ok(items.some((i) => i.key === 'foobar2000.exe'), 'ignored app missing from the dock');
});

test('a HIDDEN app on another workspace appears too', () => {
  // Chrome is on WS2 and is NOT in the window list, because komorebi hides
  // off-workspace windows and IsWindowVisible is false for them.
  const items = dockItems(KOMOREBI, parseWindowList(LIST));
  assert.ok(items.some((i) => i.key === 'chrome.exe'), 'off-workspace app missing from the dock');
});

test('a window in both sources is counted once, not twice', () => {
  // wezterm hwnd 102 is managed AND visible to the OS. Counting both would
  // double every window on the displayed workspace.
  const items = dockItems(KOMOREBI, parseWindowList(LIST));
  const wez = items.find((i) => i.key === 'wezterm-gui.exe');
  assert.strictEqual(wez.count, 2, 'two real WezTerm windows, not four');
});

test('the OS foreground window wins the focus marker', () => {
  // komorebi thinks WezTerm is focused (container 0 of the focused workspace),
  // but the real foreground window is foobar2000 -- an app komorebi does not
  // even manage. Exactly one item may end up marked.
  const items = dockItems(KOMOREBI, parseWindowList(LIST));
  assert.deepStrictEqual(
    items.filter((i) => i.focused).map((i) => i.key), ['foobar2000.exe']);
});

test('komorebi still supplies focus when the OS list has no foreground entry', () => {
  const items = dockItems(KOMOREBI, []);
  assert.deepStrictEqual(items.filter((i) => i.focused).map((i) => i.key), ['wezterm-gui.exe']);
});

test('an app is minimized only when every one of its windows is', () => {
  const list = parseWindowList(JSON.stringify({ windows: [
    { hwnd: 1, exe: 'x.exe', title: 'a', minimized: true, focused: false },
    { hwnd: 2, exe: 'x.exe', title: 'b', minimized: false, focused: false },
    { hwnd: 3, exe: 'y.exe', title: 'c', minimized: true, focused: false },
  ]}));
  const items = dockItems({}, list);
  assert.strictEqual(items.find((i) => i.key === 'x.exe').minimized, false);
  assert.strictEqual(items.find((i) => i.key === 'y.exe').minimized, true);
});

test('every item carries a handle to focus', () => {
  const items = dockItems(KOMOREBI, parseWindowList(LIST));
  for (const item of items) assert.ok(isSafeHandle(item.hwnd), `${item.key} has no usable handle`);
});

test('zebar itself is never listed, from either source', () => {
  const list = parseWindowList(JSON.stringify({ windows: [
    { hwnd: 5, exe: 'zebar.exe', title: 'bar', minimized: false, focused: false },
  ]}));
  const komorebi = { allWorkspaces: [{ tilingContainers: [{ id: 'z', windows: [win('zebar.exe', 6, 'bar')] }] }] };
  assert.deepStrictEqual(dockItems(komorebi, list), []);
});

test('exe matching is case-insensitive across sources', () => {
  const komorebi = { allWorkspaces: [{ tilingContainers: [{ id: 'a', windows: [win('Chrome.exe', 1, 'A')] }] }] };
  const list = parseWindowList(JSON.stringify({ windows: [
    { hwnd: 2, exe: 'chrome.exe', title: 'B', minimized: false, focused: false },
  ]}));
  assert.strictEqual(dockItems(komorebi, list).length, 1);
});

test('order is first-appearance, never alphabetical', () => {
  // A dock whose icons re-sort as windows open and close is unusable: the
  // thing you are aiming at moves out from under the cursor.
  const komorebi = { allWorkspaces: [{ tilingContainers: [
    { id: 'a', windows: [win('zzz.exe', 1, 'Z')] },
    { id: 'b', windows: [win('aaa.exe', 2, 'A')] },
  ] }] };
  assert.deepStrictEqual(dockItems(komorebi, []).map((i) => i.key), ['zzz.exe', 'aaa.exe']);
});

test('an empty desktop yields an empty dock rather than throwing', () => {
  assert.deepStrictEqual(dockItems({}, []), []);
  assert.deepStrictEqual(dockItems(null, []), []);
  assert.doesNotThrow(() => dockItems(null, null ?? []));
});

// --- signature ------------------------------------------------------------

test('the signature tracks what renders, and ignores what does not', () => {
  const list = parseWindowList(LIST);
  const a = dockItems(KOMOREBI, list);

  // A title change must NOT rebuild -- that would restart icon fetches every
  // time a browser tab changes.
  const retitled = parseWindowList(LIST.replace('RIGHT LIGHT', 'Something else'));
  assert.strictEqual(dockSignature(a), dockSignature(dockItems(KOMOREBI, retitled)));

  // Focus and minimized state DO render, so they must rebuild.
  const unfocused = parseWindowList(LIST.replace('"focused":true', '"focused":false'));
  assert.notStrictEqual(dockSignature(a), dockSignature(dockItems(KOMOREBI, unfocused)));
});

// --- commands -------------------------------------------------------------

test('commands match the registered argsRegex', () => {
  const regex = /^(list|focus \d{1,19})$/;
  assert.strictEqual(listWindowsCommand().program, WINDOW_LIST_PATH);
  assert.match(listWindowsCommand().args.join(' '), regex);
  assert.match(focusCommand(198332).args.join(' '), regex);
});

test('handles are validated before reaching a command line', () => {
  assert.strictEqual(isSafeHandle(198332), true);
  assert.strictEqual(isSafeHandle(0), false);
  assert.strictEqual(isSafeHandle(-1), false);
  assert.strictEqual(isSafeHandle(1.5), false);
  assert.strictEqual(isSafeHandle('198332'), false);
  assert.strictEqual(isSafeHandle(null), false);
});
