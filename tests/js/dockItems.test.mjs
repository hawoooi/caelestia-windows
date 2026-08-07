// Turning komorebi's workspace tree into the dock's app list. A window can
// live in four different places in that tree, and the fixtures below are
// shaped from output READ LIVE off this machine's provider rather than from
// what the shape ought to be -- the same discipline the status catalogue
// follows, and for the same reason: this pack has twice shipped a bug from
// assuming a provider field.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  workspaceWindows,
  focusedExe,
  dockItems,
  dockSignature,
  focusCommand,
  isSafeExeName,
  KOMOREBIC_PATH,
} from '../../zebar/caelestia/dock-items.js';

const win = (exe, hwnd, title) => ({ id: null, class: 'X', exe, hwnd, title, role: null, subrole: null, iconPath: null });

// Real shape: focusedWorkspace.tilingContainers[].windows[]
const WORKSPACE = {
  containerPadding: null,
  floatingWindows: [],
  focusedContainerIndex: 0,
  layout: 'bsp',
  maximizedWindow: null,
  monocleContainer: null,
  name: '1',
  tilingContainers: [
    { id: 'a', windows: [win('wezterm-gui.exe', 198332, 'Modify layout changer')] },
    { id: 'b', windows: [win('wezterm-gui.exe', 8717810, 'powershell.exe')] },
    { id: 'c', windows: [win('chrome.exe', 4242, 'Google')] },
  ],
};
const OUT = { focusedWorkspace: WORKSPACE };

// --- walking the tree -----------------------------------------------------

test('collects tiled windows', () => {
  assert.deepStrictEqual(workspaceWindows(WORKSPACE).map((w) => w.hwnd), [198332, 8717810, 4242]);
});

test('collects floating, maximized and monocled windows too', () => {
  // All four places a window can be. Missing any of them means an open app
  // silently absent from the dock, which is worse than a wrong icon.
  const ws = {
    tilingContainers: [{ id: 'a', windows: [win('a.exe', 1, 'A')] }],
    floatingWindows: [win('b.exe', 2, 'B')],
    maximizedWindow: win('c.exe', 3, 'C'),
    monocleContainer: { id: 'm', windows: [win('d.exe', 4, 'D')] },
  };
  assert.deepStrictEqual(workspaceWindows(ws).map((w) => w.exe), ['a.exe', 'b.exe', 'c.exe', 'd.exe']);
});

test('a window in two places is only counted once', () => {
  // A maximized window can still appear in tilingContainers, which would
  // otherwise show a phantom second copy of whatever is maximized.
  const ws = {
    tilingContainers: [{ id: 'a', windows: [win('a.exe', 1, 'A')] }],
    maximizedWindow: win('a.exe', 1, 'A'),
  };
  assert.strictEqual(workspaceWindows(ws).length, 1);
});

test('malformed or empty trees yield nothing rather than throwing', () => {
  for (const bad of [null, undefined, {}, { tilingContainers: null }, { tilingContainers: [null] }, 42]) {
    assert.doesNotThrow(() => workspaceWindows(bad));
    assert.deepStrictEqual(workspaceWindows(bad), []);
  }
});

test('windows with no exe are dropped', () => {
  const ws = { tilingContainers: [{ id: 'a', windows: [win(null, 1, 'A'), win('', 2, 'B'), win('c.exe', 3, 'C')] }] };
  assert.deepStrictEqual(workspaceWindows(ws).map((w) => w.exe), ['c.exe']);
});

// --- focus ----------------------------------------------------------------

test('focusedContainerIndex indexes CONTAINERS, not a flat window list', () => {
  // The silent off-by-one this guards: with three containers, index 2 is the
  // third container -- not the third window.
  assert.strictEqual(focusedExe({ ...WORKSPACE, focusedContainerIndex: 2 }), 'chrome.exe');
  assert.strictEqual(focusedExe({ ...WORKSPACE, focusedContainerIndex: 0 }), 'wezterm-gui.exe');
});

test('a maximized or monocled window takes focus priority', () => {
  assert.strictEqual(focusedExe({ ...WORKSPACE, maximizedWindow: win('z.exe', 9, 'Z') }), 'z.exe');
  assert.strictEqual(
    focusedExe({ ...WORKSPACE, monocleContainer: { id: 'm', windows: [win('y.exe', 8, 'Y')] } }), 'y.exe');
});

test('an out-of-range or missing focus index yields null, not a crash', () => {
  assert.strictEqual(focusedExe({ ...WORKSPACE, focusedContainerIndex: 99 }), null);
  assert.strictEqual(focusedExe({ ...WORKSPACE, focusedContainerIndex: null }), null);
  assert.strictEqual(focusedExe(null), null);
});

// --- grouping -------------------------------------------------------------

test('windows are grouped per app, the way a combined taskbar button is', () => {
  const items = dockItems(OUT);
  assert.deepStrictEqual(items.map((i) => [i.key, i.count]), [['wezterm-gui.exe', 2], ['chrome.exe', 1]]);
});

test('the focused app is marked, and only that one', () => {
  const items = dockItems(OUT);
  assert.deepStrictEqual(items.map((i) => i.focused), [true, false]);
});

test('order is first-appearance, never alphabetical', () => {
  // A dock whose icons re-sort as windows open and close is unusable: the
  // thing you are aiming at moves out from under the cursor.
  const ws = {
    focusedContainerIndex: 0,
    tilingContainers: [
      { id: 'a', windows: [win('zzz.exe', 1, 'Z')] },
      { id: 'b', windows: [win('aaa.exe', 2, 'A')] },
    ],
  };
  assert.deepStrictEqual(dockItems({ focusedWorkspace: ws }).map((i) => i.key), ['zzz.exe', 'aaa.exe']);
});

test('zebar itself is never listed', () => {
  // The bar, the frame and every flyout are windows too. A dock that listed
  // itself would also flicker, since the flyouts come and go.
  const ws = {
    focusedContainerIndex: 0,
    tilingContainers: [
      { id: 'a', windows: [win('zebar.exe', 1, 'bar')] },
      { id: 'b', windows: [win('chrome.exe', 2, 'C')] },
    ],
  };
  assert.deepStrictEqual(dockItems({ focusedWorkspace: ws }).map((i) => i.key), ['chrome.exe']);
});

test('exe matching is case-insensitive for grouping', () => {
  const ws = {
    focusedContainerIndex: 0,
    tilingContainers: [
      { id: 'a', windows: [win('Chrome.exe', 1, 'A')] },
      { id: 'b', windows: [win('chrome.exe', 2, 'B')] },
    ],
  };
  const items = dockItems({ focusedWorkspace: ws });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].count, 2);
});

test('an empty desktop yields an empty dock rather than throwing', () => {
  assert.deepStrictEqual(dockItems({}), []);
  assert.deepStrictEqual(dockItems(null), []);
  assert.deepStrictEqual(dockItems({ focusedWorkspace: { tilingContainers: [] } }), []);
});

// --- signature ------------------------------------------------------------

test('the signature tracks apps, counts and focus -- the things that render', () => {
  const a = dockItems(OUT);
  const b = dockItems({ focusedWorkspace: { ...WORKSPACE, focusedContainerIndex: 2 } });
  assert.notStrictEqual(dockSignature(a), dockSignature(b), 'a focus change must repaint');

  // ...but NOT titles, which only ever reach a tooltip. Rebuilding on a title
  // change would restart the icon fetches every time a browser tab changes.
  const titled = JSON.parse(JSON.stringify(WORKSPACE));
  titled.tilingContainers[2].windows[0].title = 'Something else entirely';
  assert.strictEqual(dockSignature(a), dockSignature(dockItems({ focusedWorkspace: titled })));
});

// --- focus command --------------------------------------------------------

test('the focus command matches the registered argsRegex', () => {
  const regex = /^eager-focus [\w.\-]+\.exe$/;
  const cmd = focusCommand('wezterm-gui.exe');
  assert.strictEqual(cmd.program, KOMOREBIC_PATH);
  assert.match(cmd.args.join(' '), regex);
});

test('exe names are validated before they reach a command line', () => {
  // The value comes from the provider, but it still ends up as an argument,
  // so it is checked against the same shape the privilege regex allows
  // instead of being trusted.
  assert.strictEqual(isSafeExeName('chrome.exe'), true);
  assert.strictEqual(isSafeExeName('wezterm-gui.exe'), true);
  assert.strictEqual(isSafeExeName('a b.exe'), false);
  assert.strictEqual(isSafeExeName('chrome.exe & calc'), false);
  assert.strictEqual(isSafeExeName('..\\..\\evil.exe'), false);
  assert.strictEqual(isSafeExeName('chrome'), false);
  assert.strictEqual(isSafeExeName(null), false);
});
