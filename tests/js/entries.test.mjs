import { test } from 'node:test';
import assert from 'node:assert';
import { splitClock } from '../../zebar/caelestia/bar/entries/clock.js';
import { workspaceState, focusWorkspaceCommand, KOMOREBIC_PATH } from '../../zebar/caelestia/bar/entries/workspaces.js';
import { mediaLabel, formatMediaTime } from '../../zebar/caelestia/bar/entries/media.js';
import { windowTitle } from '../../zebar/caelestia/bar/entries/activeWindow.js';
import { pingState } from '../../zebar/caelestia/bar/entries/vesktop.js';
import { statusIconParts } from '../../zebar/caelestia/bar/entries/statusIcons.js';

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

test('windowTitle reads the title of the focused container\'s first window', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 1,
      tilingContainers: [
        { id: 'a', windows: [{ title: 'Other' }] },
        { id: 'b', windows: [{ title: 'VS Code' }] },
      ],
    },
  };
  assert.strictEqual(windowTitle(komorebi), 'VS Code');
});

test('windowTitle returns empty string when there are no tiling containers yet', () => {
  // This is the normal first frame before komorebi has reported any state,
  // not an edge case -- tilingContainers may be undefined or [].
  assert.strictEqual(windowTitle({ focusedWorkspace: { tilingContainers: [] } }), '');
  assert.strictEqual(windowTitle({ focusedWorkspace: {} }), '');
  assert.strictEqual(windowTitle(undefined), '');
});

test('windowTitle returns empty string when the focused container has no windows', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 0,
      tilingContainers: [{ id: 'a', windows: [] }],
    },
  };
  assert.strictEqual(windowTitle(komorebi), '');
});

test('windowTitle returns empty string when focusedContainerIndex is out of range', () => {
  const komorebi = {
    focusedWorkspace: {
      focusedContainerIndex: 5,
      tilingContainers: [{ id: 'a', windows: [{ title: 'Solo' }] }],
    },
  };
  assert.strictEqual(windowTitle(komorebi), '');
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

test('statusIconParts emits the disconnected glyph (U+F127) when offline', () => {
  const parts = statusIconParts({ online: false, volume: null, battery: null });
  assert.strictEqual(parts[0].text.codePointAt(0), 0xF127);
});

test('statusIconParts emits the volume-up glyph (U+F028) for nonzero volume and marks it "glyph"', () => {
  const parts = statusIconParts({ online: true, volume: 40, battery: null });
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[1].kind, 'glyph');
  assert.strictEqual(parts[1].text.codePointAt(0), 0xF028);
});

test('statusIconParts emits the muted glyph (U+F026) at zero volume', () => {
  const parts = statusIconParts({ online: true, volume: 0, battery: null });
  assert.strictEqual(parts[1].text.codePointAt(0), 0xF026);
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
