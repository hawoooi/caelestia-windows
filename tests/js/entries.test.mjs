import { test } from 'node:test';
import assert from 'node:assert';
import { splitClock } from '../../zebar/caelestia/bar/entries/clock.js';
import { workspaceState } from '../../zebar/caelestia/bar/entries/workspaces.js';
import { mediaLabel } from '../../zebar/caelestia/bar/entries/media.js';
import { windowTitle } from '../../zebar/caelestia/bar/entries/activeWindow.js';

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
