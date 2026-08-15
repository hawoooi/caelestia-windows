import { test } from 'node:test';
import assert from 'node:assert';
import { splitClock } from '../../zebar/caelestia/bar/entries/clock.js';
import { workspaceState, focusWorkspaceCommand, KOMOREBIC_PATH } from '../../zebar/caelestia/bar/entries/workspaces.js';
import { mediaLabel, formatMediaTime } from '../../zebar/caelestia/bar/entries/media.js';
import {
  focusedWindow,
  appName,
  iconCacheKey,
  fetchIcon,
  createIconController,
} from '../../zebar/caelestia/bar/entries/activeWindow.js';
import { pingState } from '../../zebar/caelestia/bar/entries/vesktop.js';
import {
  LAYOUT_CYCLE,
  currentLayout,
  layoutGlyph,
  nextLayout,
  changeLayoutCommand,
  normalizeLayoutString,
  createLayoutMenuController,
  KOMOREBIC_PATH as LAYOUT_KOMOREBIC_PATH,
} from '../../zebar/caelestia/bar/entries/layoutToggle.js';

test('splitClock splits HH:mm into stacked parts', () => {
  assert.deepStrictEqual(splitClock('21:40'), { top: '21', bottom: '40' });
});

test('splitClock tolerates a missing value', () => {
  assert.deepStrictEqual(splitClock(undefined), { top: '--', bottom: '--' });
});

test('splitClock tolerates an unexpected format', () => {
  assert.deepStrictEqual(splitClock('nonsense'), { top: '--', bottom: '--' });
});

test('workspaceState marks the focused workspace', () => {
  const out = workspaceState({
    currentWorkspaces: [{ name: '1' }, { name: '2' }, { name: '3' }],
    focusedWorkspace: { name: '2' },
  });
  assert.deepStrictEqual(out, [
    { name: '1', focused: false },
    { name: '2', focused: true },
    { name: '3', focused: false },
  ]);
});

test('workspaceState returns empty when komorebi output is absent', () => {
  assert.deepStrictEqual(workspaceState(undefined), []);
});

test('workspaceState handles a null focusedWorkspace', () => {
  const out = workspaceState({ currentWorkspaces: [{ name: '1' }], focusedWorkspace: null });
  assert.deepStrictEqual(out, [{ name: '1', focused: false }]);
});

// komorebic's focus-workspace target is a zero-indexed position, but the bar
// displays komorebi's workspace *names* ("1".."9") on the buttons -- those
// are two different numbering schemes that happen to look similar. This
// locks the command builder to the array-position index, not the name, and
// pins the real komorebic.exe path so a future move of the binary is a loud
// test failure rather than a silently-dead button.
test('focusWorkspaceCommand builds a zero-indexed focus-workspace command against the real komorebic path', () => {
  assert.strictEqual(KOMOREBIC_PATH, 'C:\\Users\\PC\\scoop\\apps\\komorebi\\current\\komorebic.exe');
  assert.deepStrictEqual(focusWorkspaceCommand(0), {
    program: KOMOREBIC_PATH,
    args: ['focus-workspace', '0'],
  });
  assert.deepStrictEqual(focusWorkspaceCommand(3), {
    program: KOMOREBIC_PATH,
    args: ['focus-workspace', '3'],
  });
});

test('focusWorkspaceCommand never emits a workspace *name* as the target -- index 8 stays "8", not workspace name text', () => {
  // Regression guard for the name-vs-index mixup: the 9th workspace button
  // (array index 8) must still target index 8, even though nothing here
  // coincidentally distinguishes it from a 1-indexed scheme at this value.
  assert.deepStrictEqual(focusWorkspaceCommand(8).args, ['focus-workspace', '8']);
});

test('mediaLabel formats title and artist', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Reset', artist: 'Tiger JK', isPlaying: true } }),
    'Reset — Tiger JK',
  );
});

test('mediaLabel marks a paused session', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Reset', artist: 'Tiger JK', isPlaying: false } }),
    '(Paused) Reset — Tiger JK',
  );
});

test('mediaLabel returns empty string when nothing is playing', () => {
  assert.strictEqual(mediaLabel({ currentSession: null }), '');
  assert.strictEqual(mediaLabel(undefined), '');
});

test('mediaLabel omits the dash when artist is missing', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Untitled', artist: '', isPlaying: true } }),
    'Untitled',
  );
});

// Change 2: activeWindow now displays an app name derived from `exe`, never
// `title` -- these tests lock the same container/focus-selection logic the
// old windowTitle() had (still exactly `windows[0]` of the focused
// container -- see the module's own comment on why), just resolving to the
// window object itself so appName() can read whichever field it needs.
test('focusedWindow reads the focused container\'s first window', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 1,
      tilingContainers: [
        { id: 'a', windows: [{ exe: 'other.exe', title: 'Other' }] },
        { id: 'b', windows: [{ exe: 'Code.exe', title: 'index.js - VS Code' }] },
      ],
    },
  };
  assert.deepStrictEqual(focusedWindow(komorebi), { exe: 'Code.exe', title: 'index.js - VS Code' });
});

test('focusedWindow returns null when there are no tiling containers yet', () => {
  // This is the normal first frame before komorebi has reported any state,
  // not an edge case -- tilingContainers may be undefined or [].
  assert.strictEqual(focusedWindow({ focusedWorkspace: { tilingContainers: [] } }), null);
  assert.strictEqual(focusedWindow({ focusedWorkspace: {} }), null);
  assert.strictEqual(focusedWindow(undefined), null);
});

test('focusedWindow returns null when the focused container has no windows', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 0,
      tilingContainers: [{ id: 'a', windows: [] }],
    },
  };
  assert.strictEqual(focusedWindow(komorebi), null);
});

test('focusedWindow returns null when focusedContainerIndex is out of range', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 5,
      tilingContainers: [{ id: 'a', windows: [{ exe: 'solo.exe' }] }],
    },
  };
  assert.strictEqual(focusedWindow(komorebi), null);
});

// appName's alias table, and the real exe values captured live from this
// machine's own `komorebic state` during this task (docs/zebar-bar.md /
// activeWindow.js's own comment) -- not guessed strings.
test('appName maps wezterm-gui.exe to WezTerm', () => {
  assert.strictEqual(appName('wezterm-gui.exe'), 'WezTerm');
});

test('appName maps Code.exe to VS Code regardless of casing', () => {
  assert.strictEqual(appName('Code.exe'), 'VS Code');
  assert.strictEqual(appName('code.exe'), 'VS Code');
  assert.strictEqual(appName('CODE.EXE'), 'VS Code');
});

test('appName maps explorer.exe to Explorer', () => {
  assert.strictEqual(appName('explorer.exe'), 'Explorer');
});

test('appName maps chrome.exe to Chrome', () => {
  assert.strictEqual(appName('chrome.exe'), 'Chrome');
});

test('appName maps msedge.exe to Edge', () => {
  assert.strictEqual(appName('msedge.exe'), 'Edge');
});

test('appName falls back to the stripped exe name, unchanged, when there is no alias', () => {
  // vesktop.exe and foobar2000.exe are both real, live exe values captured
  // from this machine's own komorebi state during this task -- neither is
  // in the alias table, so both must fall back to their own stripped name
  // verbatim (no forced capitalization).
  assert.strictEqual(appName('vesktop.exe'), 'vesktop');
  assert.strictEqual(appName('foobar2000.exe'), 'foobar2000');
});

test('appName never falls back to a window title -- only exe is ever read', () => {
  // appName's own signature only accepts the exe string; there is no
  // title parameter to fall back to at all. This test exists as a
  // regression guard on the call site (activeWindow.js's update()) staying
  // wired to `focusedWindow(...)?.exe`, not `?.title`.
  assert.strictEqual(appName(undefined), '');
  assert.strictEqual(appName(null), '');
  assert.strictEqual(appName(''), '');
  assert.strictEqual(appName('   '), '');
});

test('appName truncates a genuinely long, unaliased exe name with an ellipsis backstop', () => {
  const long = appName('ThisIsAReallyLongMadeUpExecutableName.exe');
  assert.ok(long.length <= 14, `expected truncated length <= 14, got ${long.length} ('${long}')`);
  assert.ok(long.endsWith('…'), `expected an ellipsis backstop, got '${long}'`);
});

test('appName does not truncate an aliased name even if a hypothetical alias were long', () => {
  // The real alias table entries are all short, but this locks in that
  // truncation applies uniformly to whatever appName ultimately renders,
  // aliased or not -- MAX_LEN is checked against the resolved name, not
  // just the fallback path.
  assert.strictEqual(appName('chrome.exe'), 'Chrome');
  assert.ok(!appName('chrome.exe').includes('…'));
});

// --- App icon: real exe icon, cached, never spawns per-tick (feat/corner-overlays follow-up) ---
//
// The user asked for the focused application's OWN icon, not a hand-mapped
// Font Awesome brand glyph -- ../tools/app-icon.cs (compiled app-icon.exe)
// does the actual extraction via shellExec; fetchIcon/createIconController
// in activeWindow.js own the caching/timeout/in-flight discipline around
// that call. These tests mirror fullscreen.test.mjs's own coverage of the
// identical discipline in startFullscreenWatch (cache, timeout, never
// overlap a call) -- this module was modelled on that one directly.

test('iconCacheKey normalizes exe names for cache lookups', () => {
  assert.strictEqual(iconCacheKey('Chrome.exe'), 'chrome.exe');
  assert.strictEqual(iconCacheKey('  wezterm-gui.exe  '), 'wezterm-gui.exe');
});

test('fetchIcon returns a data: URL built from the helper\'s base64 stdout', async () => {
  const calls = [];
  const shell = {
    shellExec: async (program, args) => {
      calls.push([program, args]);
      return { stdout: 'QUJD' }; // base64("ABC")
    },
  };
  const cache = new Map();
  const url = await fetchIcon(shell, 'chrome.exe', cache, 1000);
  assert.strictEqual(url, 'data:image/png;base64,QUJD');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0][1], ['chrome.exe']);
});

test('fetchIcon caches the result and never calls shellExec twice for the same exe', async () => {
  let callCount = 0;
  const shell = { shellExec: async () => { callCount += 1; return { stdout: 'QUJD' }; } };
  const cache = new Map();
  const first = await fetchIcon(shell, 'chrome.exe', cache, 1000);
  const second = await fetchIcon(shell, 'CHROME.EXE', cache, 1000); // different casing, same key
  assert.strictEqual(callCount, 1, 'a cached exe must never trigger a second shell-out');
  assert.strictEqual(first, second);
});

test('fetchIcon fails soft (returns null, caches the miss) when the helper prints nothing', async () => {
  const shell = { shellExec: async () => ({ stdout: '' }) };
  const cache = new Map();
  const url = await fetchIcon(shell, 'unknown.exe', cache, 1000);
  assert.strictEqual(url, null);
  assert.strictEqual(cache.get('unknown.exe'), null);
});

test('fetchIcon fails soft when shellExec rejects (privilege denied, missing exe, ...)', async () => {
  const shell = { shellExec: async () => { throw new Error('privilege denied'); } };
  const cache = new Map();
  const url = await fetchIcon(shell, 'chrome.exe', cache, 1000);
  assert.strictEqual(url, null);
});

test('fetchIcon fails soft when there is no shellExec at all (no shell on this build)', async () => {
  // Two separate caches (and exe names) so each assertion genuinely
  // exercises the "no shell" branch rather than the second call trivially
  // hitting the first call's now-cached null.
  assert.strictEqual(await fetchIcon(null, 'chrome.exe', new Map(), 1000), null);
  assert.strictEqual(await fetchIcon({}, 'wezterm-gui.exe', new Map(), 1000), null);
});

test('fetchIcon abandons a hung probe after timeoutMs and fails soft, same discipline as fullscreen.js', async () => {
  const shell = { shellExec: () => new Promise(() => {}) }; // never settles
  const cache = new Map();
  const url = await fetchIcon(shell, 'chrome.exe', cache, 20);
  assert.strictEqual(url, null);
});

test('createIconController: repeated ticks with the SAME focused exe never shell out again', () => {
  let callCount = 0;
  const shell = { shellExec: async () => { callCount += 1; return { stdout: 'QUJD' }; } };
  const controller = createIconController(shell, 1000);
  const resolved = [];
  controller.update('chrome.exe', (v) => resolved.push(v));
  // Same exe, five more ticks -- this is the exact "provider tick" shape
  // bar.js drives update() with; none of these may spawn a process.
  for (let i = 0; i < 5; i++) controller.update('chrome.exe', (v) => resolved.push(v));
  assert.strictEqual(callCount, 1, 'an unchanged focused app must not re-shell-out on every tick');
});

test('createIconController: switching to a genuinely different exe DOES trigger a fresh probe', async () => {
  const calls = [];
  const shell = {
    shellExec: async (program, args) => {
      calls.push(args[0]);
      return { stdout: 'QUJD' };
    },
  };
  const controller = createIconController(shell, 1000);
  const resolved = [];
  controller.update('chrome.exe', (v) => resolved.push(v));
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.update('wezterm-gui.exe', (v) => resolved.push(v));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepStrictEqual(calls, ['chrome.exe', 'wezterm-gui.exe']);
});

test('createIconController: falls back to null (neutral glyph) when extraction fails, name stays independent', async () => {
  const shell = { shellExec: async () => ({ stdout: '' }) };
  const controller = createIconController(shell, 1000);
  const resolved = [];
  controller.update('unknown.exe', (v) => resolved.push(v));
  // Immediate fallback fires synchronously before the probe settles.
  assert.deepStrictEqual(resolved, [null]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // The settled (also-null) probe result is delivered too -- still null,
  // never a broken image or a thrown error.
  assert.deepStrictEqual(resolved, [null, null]);
});

test('createIconController: an empty/missing focused exe resolves null with no shell-out', () => {
  let called = false;
  const shell = { shellExec: async () => { called = true; return { stdout: 'QUJD' }; } };
  const controller = createIconController(shell, 1000);
  const resolved = [];
  controller.update(undefined, (v) => resolved.push(v));
  controller.update('', (v) => resolved.push(v));
  assert.deepStrictEqual(resolved, [null, null]);
  assert.strictEqual(called, false);
});

test('createIconController: never starts a second app-icon.exe call while one is still outstanding', async () => {
  let callCount = 0;
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const shell = {
    shellExec: async () => {
      callCount += 1;
      await gate;
      return { stdout: 'QUJD' };
    },
  };
  const controller = createIconController(shell, 999999);
  const resolved = [];
  controller.update('chrome.exe', (v) => resolved.push(v));
  // Focus moves away and back while the first probe is still outstanding --
  // must not launch a second overlapping shellExec call.
  controller.update('wezterm-gui.exe', (v) => resolved.push(v));
  controller.update('chrome.exe', (v) => resolved.push(v));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(callCount, 1, 'a second probe must not start while the first is still outstanding');
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('pingState reads a ping count', () => {
  assert.deepStrictEqual(pingState('3'), { pinged: true, count: 3 });
});

test('pingState treats empty output as no ping', () => {
  assert.deepStrictEqual(pingState(''), { pinged: false, count: 0 });
  assert.deepStrictEqual(pingState('   \n'), { pinged: false, count: 0 });
});

test('pingState treats non-numeric output as no ping', () => {
  assert.deepStrictEqual(pingState('idle'), { pinged: false, count: 0 });
});

test('pingState ignores a zero count', () => {
  assert.deepStrictEqual(pingState('0'), { pinged: false, count: 0 });
});

test('formatMediaTime formats seconds as m:ss', () => {
  assert.strictEqual(formatMediaTime(49), '0:49');
  assert.strictEqual(formatMediaTime(180), '3:00');
  assert.strictEqual(formatMediaTime(65), '1:05');
  assert.strictEqual(formatMediaTime(0), '0:00');
});

// CLAUDE.md's own warning: raw pasted Private-Use-Area Nerd Font glyphs have
// previously been silently dropped to empty strings by some layer between
// drafting and the file write (Task 5). These assert the actual codepoint
// that made it into the committed source, not just that the string is
// truthy/non-empty -- a dropped glyph that got replaced with, say, a space
// would still pass a naive non-empty check.
// Task 3 (Font Awesome icons): the disconnected glyph changed from U+F127
// (chain-broken, the old Nerd-Font-as-FA4.7-stand-in codepoint) to U+E560
// (plug-circle-xmark) -- Font Awesome Free 6.x's own metadata/icons.json
// has no dedicated "wifi-slash" solid glyph, so a broken-connection glyph
// stands in for "disconnected", same idea as before but confirmed present
// in the vendored 6.x release rather than carried over from the old
// mapping.
// Task 3: volume is now a real three-tier muted/low/high split driven by
// the actual level (previously a binary >0 check that only ever chose
// between "some sound" (U+F028, volume-up/volume-high) and "off"). 40 now
// lands in the "low" tier, not "high" -- see the dedicated high-volume
// test just below for the tier that keeps U+F028.
test('formatMediaTime tolerates missing or invalid input', () => {
  assert.strictEqual(formatMediaTime(undefined), '--:--');
  assert.strictEqual(formatMediaTime(NaN), '--:--');
  assert.strictEqual(formatMediaTime(-5), '--:--');
  assert.strictEqual(formatMediaTime('49'), '--:--');
});

// Change 3: layout-cycle ordering, current-layout resolution, and the
// exact komorebic invocation the button's click handler builds.
test('LAYOUT_CYCLE is the curated BSP -> Columns -> Rows -> Grid order', () => {
  // Order matters -- nextLayout() below walks this array positionally.
  // This is the exact curated list verified live against this machine's
  // real komorebic.exe during this task (see layoutToggle.js's own
  // comment): every value here was round-tripped through a real
  // `change-layout` + `komorebic state` read-back with zero disruption to
  // the running bar.
  assert.deepStrictEqual(LAYOUT_CYCLE, ['bsp', 'columns', 'rows', 'grid']);
});

test('nextLayout cycles forward through the curated list and wraps around', () => {
  assert.strictEqual(nextLayout('bsp'), 'columns');
  assert.strictEqual(nextLayout('columns'), 'rows');
  assert.strictEqual(nextLayout('rows'), 'grid');
  assert.strictEqual(nextLayout('grid'), 'bsp');
});

test('nextLayout starts the cycle at bsp for an unrecognized or null current layout', () => {
  // null covers the "provider hasn't reported yet, or reports a layout
  // outside the curated four (e.g. right_main_vertical_stack set by
  // hotkey)" case -- clicking from there should not throw or no-op, it
  // should sensibly start the cycle.
  assert.strictEqual(nextLayout(null), 'bsp');
  assert.strictEqual(nextLayout('right_main_vertical_stack'), 'bsp');
  assert.strictEqual(nextLayout(undefined), 'bsp');
});

test('currentLayout reads the focused workspace\'s layout and maps it into the curated cycle', () => {
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'bsp' } }), 'bsp');
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'rows' } }), 'rows');
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'grid' } }), 'grid');
});

test('currentLayout maps the provider\'s "custom" report to columns (confirmed live, Task 2)', () => {
  // 'columns' is deliberately NOT in zebar's own KomorebiLayout union (see
  // layoutToggle.js's module comment). This task read the REAL provider
  // output live via a CDP session against the running widget:
  // `change-layout columns` -> `focusedWorkspace.layout` read back as
  // exactly "custom", the same bucket every other layout outside the
  // confirmed 8-value union also falls into. PROVIDER_TO_CYCLE's own
  // comment documents why mapping 'custom' -> 'columns' is a deliberate
  // simplification rather than a precise inverse of the CLI.
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'custom' } }), 'columns');
});

test('currentLayout returns null for a layout outside the curated cycle', () => {
  // vertical_stack IS one of zebar's confirmed union values (reported
  // verbatim by the provider, not bucketed into 'custom'), so it correctly
  // falls outside the curated four -- null (-> the fallback glyph), not a
  // thrown error or a guessed-wrong glyph.
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'vertical_stack' } }), null);
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'right_main_vertical_stack' } }), null);
});

test('currentLayout tolerates missing provider output', () => {
  assert.strictEqual(currentLayout(undefined), null);
  assert.strictEqual(currentLayout({}), null);
  assert.strictEqual(currentLayout({ focusedWorkspace: {} }), null);
});

test('normalizeLayoutString lower-cases and strips -/_ separators', () => {
  assert.strictEqual(normalizeLayoutString('bsp'), 'bsp');
  assert.strictEqual(normalizeLayoutString('BSP'), 'bsp');
  assert.strictEqual(normalizeLayoutString('Bsp'), 'bsp');
  assert.strictEqual(normalizeLayoutString('right_main_vertical_stack'), 'rightmainverticalstack');
  assert.strictEqual(normalizeLayoutString('right-main-vertical-stack'), 'rightmainverticalstack');
  assert.strictEqual(normalizeLayoutString('Right-Main_Vertical-Stack'), 'rightmainverticalstack');
});

test('currentLayout is robust to case and -/_ spelling differences (Task 2 hardening)', () => {
  // This task read the REAL, live zebar@3.3.1 komorebi provider output
  // (CDP against the running widget) and found it already reports a flat,
  // lower-case "bsp"/"rows"/"grid"/"custom" -- NOT the capitalised
  // "BSP" `komorebic state`'s own raw CLI JSON reports under its
  // differently-shaped `layout.Default` field. So the exact casing bug the
  // pre-fix code comments warned about was not actually live for this
  // build. This test asserts the defensive normalisation added anyway
  // (in case a future zebar/komorebi build changes that convention) does
  // not silently regress: every case/separator variant of a curated value
  // must still resolve to the same cycle entry as the canonical spelling.
  for (const variant of ['bsp', 'BSP', 'Bsp']) {
    assert.strictEqual(currentLayout({ focusedWorkspace: { layout: variant } }), 'bsp');
  }
  for (const variant of ['rows', 'ROWS', 'Rows']) {
    assert.strictEqual(currentLayout({ focusedWorkspace: { layout: variant } }), 'rows');
  }
  for (const variant of ['grid', 'GRID', 'Grid']) {
    assert.strictEqual(currentLayout({ focusedWorkspace: { layout: variant } }), 'grid');
  }
  for (const variant of ['custom', 'CUSTOM', 'Custom']) {
    assert.strictEqual(currentLayout({ focusedWorkspace: { layout: variant } }), 'columns');
  }
});

test('layoutGlyph returns a distinct glyph for each curated layout and a fallback otherwise', () => {
  const glyphs = LAYOUT_CYCLE.map(layoutGlyph);
  assert.strictEqual(new Set(glyphs).size, glyphs.length, 'every curated layout should render a distinct glyph');
  const fallback = layoutGlyph(null);
  assert.ok(!glyphs.includes(fallback), 'the fallback glyph should be visually distinct from every curated one');
});

test('changeLayoutCommand builds the exact komorebic invocation, pinned to the real binary path', () => {
  assert.strictEqual(LAYOUT_KOMOREBIC_PATH, 'C:\\Users\\PC\\scoop\\apps\\komorebi\\current\\komorebic.exe');
  for (const layout of LAYOUT_CYCLE) {
    assert.deepStrictEqual(changeLayoutCommand(layout), {
      program: LAYOUT_KOMOREBIC_PATH,
      args: ['change-layout', layout],
    });
  }
});

// --- createLayoutMenuController: the menu that replaced the blind cycle ---
//
// Direct user feedback: "can we make the switch button a menu instead of
// blindly toggling as it messes up my windows" -- cycling BSP -> Columns ->
// Rows -> Grid meant reaching a distant layout retiled every real window at
// each intermediate step. The controller is deliberately DOM-free (modelled
// on activeWindow.js's createIconController) so the exact three behaviours
// the task called for can be locked down here without a document: opening/
// closing never calls change-layout, picking the active layout is a no-op,
// and picking a different layout fires exactly one call with the right
// argument.

function fakeShell() {
  const calls = [];
  return {
    calls,
    shellExec: async (program, args) => {
      calls.push({ program, args });
      return { stdout: '' };
    },
  };
}

test('createLayoutMenuController: opening and closing the menu never calls change-layout', () => {
  const shell = fakeShell();
  const controller = createLayoutMenuController(shell);
  controller.sync('bsp');

  assert.strictEqual(controller.toggle(), true, 'first toggle opens the menu');
  assert.strictEqual(controller.isOpen(), true);
  assert.strictEqual(controller.toggle(), false, 'second toggle (the button again) closes it');
  assert.strictEqual(controller.isOpen(), false);

  // Also exercise the two OTHER dismiss paths (timeout, click-outside) --
  // both call close(), never select() -- same "no layout change" contract.
  controller.toggle();
  assert.strictEqual(controller.close(), true, 'close() reports the menu WAS open');
  assert.strictEqual(controller.isOpen(), false);
  assert.strictEqual(controller.close(), false, 'closing an already-closed menu is a no-op too');

  assert.strictEqual(shell.calls.length, 0, 'no change-layout call from any open/close path');
  assert.strictEqual(controller.getCurrent(), 'bsp', 'the tracked layout is unchanged by opening/closing');
});

test('createLayoutMenuController: picking the already-active layout is a no-op, not a redundant call', () => {
  const shell = fakeShell();
  const controller = createLayoutMenuController(shell);
  controller.sync('rows');
  controller.toggle(); // open the menu, as a real click on the button would

  const result = controller.select('rows');

  assert.deepStrictEqual(result, { changed: false });
  assert.strictEqual(shell.calls.length, 0, 'choosing the current layout must never shell out');
  assert.strictEqual(controller.getCurrent(), 'rows', 'tracked layout is unchanged');
  assert.strictEqual(controller.isOpen(), false, 'choosing ANY item, including the active one, still closes the menu');
});

test('createLayoutMenuController: picking a different layout fires exactly one call with the right argument', () => {
  const shell = fakeShell();
  const controller = createLayoutMenuController(shell);
  controller.sync('bsp');
  controller.toggle();

  const result = controller.select('grid');

  assert.deepStrictEqual(result, { changed: true });
  assert.strictEqual(shell.calls.length, 1, 'exactly one change-layout call, never more');
  assert.deepStrictEqual(shell.calls[0], { program: LAYOUT_KOMOREBIC_PATH, args: ['change-layout', 'grid'] });
  assert.strictEqual(controller.getCurrent(), 'grid', 'the pick is tracked immediately, optimistically -- the button/marker must be right for a user-driven change even though the provider will not re-emit it live');
  assert.strictEqual(controller.isOpen(), false);
});

test('createLayoutMenuController: sync() only ever establishes the baseline once, never overwrites a user pick', () => {
  // This is the fix for the documented stale-provider problem
  // (docs/zebar-bar.md: "the komorebi provider's layout field does not
  // appear to re-emit live"): the provider's tick output stays frozen at
  // its connect-time value for the rest of the widget's life, so re-syncing
  // from it on every tick would silently fight the user's own menu pick on
  // the very next tick.
  const shell = fakeShell();
  const controller = createLayoutMenuController(shell);

  controller.sync('bsp'); // connect-time baseline
  controller.select('grid'); // user picks a different layout through the menu

  // Further ticks keep reporting the SAME stale connect-time value (exactly
  // what the real, non-re-emitting provider does) -- must not clobber the
  // user's pick.
  controller.sync('bsp');
  controller.sync('bsp');
  assert.strictEqual(controller.getCurrent(), 'grid', 'a stale provider re-read must never overwrite a user-driven pick');
});

test('createLayoutMenuController: sync() ignores a null provider read (not yet reported) without clearing an existing baseline', () => {
  const controller = createLayoutMenuController(fakeShell());
  controller.sync('columns');
  controller.sync(null);
  assert.strictEqual(controller.getCurrent(), 'columns');
});

test('createLayoutMenuController: select() fails soft (warns, never throws) when there is no shell handle', () => {
  const controller = createLayoutMenuController(null);
  controller.sync('bsp');
  assert.doesNotThrow(() => controller.select('grid'));
  assert.strictEqual(controller.getCurrent(), 'grid', 'tracked locally even though there is nothing to shell out to');
});
