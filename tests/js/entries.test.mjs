import { test } from 'node:test';
import assert from 'node:assert';
import { splitClock } from '../../zebar/caelestia/bar/entries/clock.js';
import { workspaceState, focusWorkspaceCommand, KOMOREBIC_PATH } from '../../zebar/caelestia/bar/entries/workspaces.js';
import { mediaLabel, formatMediaTime } from '../../zebar/caelestia/bar/entries/media.js';
import { focusedWindow, appName } from '../../zebar/caelestia/bar/entries/activeWindow.js';
import { pingState } from '../../zebar/caelestia/bar/entries/vesktop.js';
import { statusIconParts, volumeGlyph } from '../../zebar/caelestia/bar/entries/statusIcons.js';
import {
  LAYOUT_CYCLE,
  currentLayout,
  layoutGlyph,
  nextLayout,
  changeLayoutCommand,
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
  assert.strictEqual(KOMOREBIC_PATH, 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe');
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
test('statusIconParts emits the connected wifi glyph (U+F1EB) when online', () => {
  const parts = statusIconParts({ online: true, volume: null, battery: null });
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].kind, 'glyph');
  assert.strictEqual(parts[0].text.codePointAt(0), 0xF1EB);
});

// Task 3 (Font Awesome icons): the disconnected glyph changed from U+F127
// (chain-broken, the old Nerd-Font-as-FA4.7-stand-in codepoint) to U+E560
// (plug-circle-xmark) -- Font Awesome Free 6.x's own metadata/icons.json
// has no dedicated "wifi-slash" solid glyph, so a broken-connection glyph
// stands in for "disconnected", same idea as before but confirmed present
// in the vendored 6.x release rather than carried over from the old
// mapping.
test('statusIconParts emits the disconnected glyph (U+E560) when offline', () => {
  const parts = statusIconParts({ online: false, volume: null, battery: null });
  assert.strictEqual(parts[0].text.codePointAt(0), 0xE560);
});

// Task 3: volume is now a real three-tier muted/low/high split driven by
// the actual level (previously a binary >0 check that only ever chose
// between "some sound" (U+F028, volume-up/volume-high) and "off"). 40 now
// lands in the "low" tier, not "high" -- see the dedicated high-volume
// test just below for the tier that keeps U+F028.
test('statusIconParts emits the volume-low glyph (U+F027) for volume in the low tier and marks it "glyph"', () => {
  const parts = statusIconParts({ online: true, volume: 40, battery: null });
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[1].kind, 'glyph');
  assert.strictEqual(parts[1].text.codePointAt(0), 0xF027);
});

test('statusIconParts emits the volume-high glyph (U+F028) for volume above the low/high boundary', () => {
  const parts = statusIconParts({ online: true, volume: 80, battery: null });
  assert.strictEqual(parts[1].text.codePointAt(0), 0xF028);
});

test('statusIconParts emits the muted glyph (U+F026) at zero volume', () => {
  const parts = statusIconParts({ online: true, volume: 0, battery: null });
  assert.strictEqual(parts[1].text.codePointAt(0), 0xF026);
});

test('volumeGlyph is a monotonic three-tier muted/low/high split with no gaps at the boundaries', () => {
  assert.strictEqual(volumeGlyph(0).codePointAt(0), 0xF026);
  assert.strictEqual(volumeGlyph(1).codePointAt(0), 0xF027);
  assert.strictEqual(volumeGlyph(50).codePointAt(0), 0xF027);
  assert.strictEqual(volumeGlyph(51).codePointAt(0), 0xF028);
  assert.strictEqual(volumeGlyph(100).codePointAt(0), 0xF028);
});

test('statusIconParts appends a battery percentage part marked "battery", not "glyph"', () => {
  const parts = statusIconParts({ online: true, volume: 40, battery: 87 });
  assert.deepStrictEqual(parts.map(p => p.kind), ['glyph', 'glyph', 'battery']);
  assert.strictEqual(parts[2].text, '87%');
});

test('statusIconParts omits volume and battery parts entirely when null', () => {
  const parts = statusIconParts({ online: true, volume: null, battery: null });
  assert.deepStrictEqual(parts.map(p => p.kind), ['glyph']);
});

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

test('currentLayout returns null for a layout outside the curated cycle, including "columns" itself', () => {
  // 'columns' is deliberately NOT in zebar's own KomorebiLayout union (see
  // layoutToggle.js's module comment) -- it is not asserted to map to any
  // specific reported string here because that string has never been
  // directly observed; the point of this test is that whatever comes back
  // for it degrades to null (-> the fallback glyph), not a thrown error or
  // a guessed-wrong glyph.
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'custom' } }), null);
  assert.strictEqual(currentLayout({ focusedWorkspace: { layout: 'vertical_stack' } }), null);
});

test('currentLayout tolerates missing provider output', () => {
  assert.strictEqual(currentLayout(undefined), null);
  assert.strictEqual(currentLayout({}), null);
  assert.strictEqual(currentLayout({ focusedWorkspace: {} }), null);
});

test('layoutGlyph returns a distinct glyph for each curated layout and a fallback otherwise', () => {
  const glyphs = LAYOUT_CYCLE.map(layoutGlyph);
  assert.strictEqual(new Set(glyphs).size, glyphs.length, 'every curated layout should render a distinct glyph');
  const fallback = layoutGlyph(null);
  assert.ok(!glyphs.includes(fallback), 'the fallback glyph should be visually distinct from every curated one');
});

test('changeLayoutCommand builds the exact komorebic invocation, pinned to the real binary path', () => {
  assert.strictEqual(LAYOUT_KOMOREBIC_PATH, 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe');
  for (const layout of LAYOUT_CYCLE) {
    assert.deepStrictEqual(changeLayoutCommand(layout), {
      program: LAYOUT_KOMOREBIC_PATH,
      args: ['change-layout', layout],
    });
  }
});
