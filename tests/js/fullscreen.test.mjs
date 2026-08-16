import { test } from 'node:test';
import assert from 'node:assert';
import { isFullscreenState, startFullscreenWatch } from '../../zebar/caelestia/fullscreen.js';

test('isFullscreenState: "1" means fullscreen', () => {
  assert.strictEqual(isFullscreenState('1'), true);
});

test('isFullscreenState: empty output (fail-soft / not-fullscreen) means not fullscreen', () => {
  assert.strictEqual(isFullscreenState(''), false);
  assert.strictEqual(isFullscreenState('   \n'), false);
});

test('isFullscreenState: trims whitespace the helper process may add around stdout', () => {
  assert.strictEqual(isFullscreenState('1\r\n'), true);
  assert.strictEqual(isFullscreenState('  1  '), true);
});

test('isFullscreenState: any other output is treated as not-fullscreen, not an error', () => {
  assert.strictEqual(isFullscreenState('0'), false);
  assert.strictEqual(isFullscreenState('garbage'), false);
});

test('startFullscreenWatch: returns null and never calls onChange when there is no shellExec', () => {
  let called = false;
  const id = startFullscreenWatch(null, () => { called = true; }, 999999);
  assert.strictEqual(id, null);
  assert.strictEqual(called, false);
});

test('startFullscreenWatch: returns null when the shell object has no shellExec function', () => {
  const id = startFullscreenWatch({}, () => {}, 999999);
  assert.strictEqual(id, null);
});

test('startFullscreenWatch: polls immediately and reports true on "1" output', async () => {
  const shell = { shellExec: async () => ({ stdout: '1' }) };
  const results = [];
  const id = startFullscreenWatch(shell, (v) => results.push(v), 999999);
  // Let the fire-and-forget initial poll()'s microtasks/promise resolve.
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearInterval(id);
  assert.deepStrictEqual(results, [true]);
});

test('startFullscreenWatch: fails soft (reports false, does not throw) when shellExec rejects', async () => {
  const shell = { shellExec: async () => { throw new Error('privilege denied'); } };
  const results = [];
  const id = startFullscreenWatch(shell, (v) => results.push(v), 999999);
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearInterval(id);
  assert.deepStrictEqual(results, [false]);
});

// Task 3 (feat/corner-overlays follow-up): a real fullscreen-detect.exe
// instance outlived its parent zebar and inherited zebar's own listening
// socket on port 6124, so every later zebar start failed to bind the port
// -- see docs/zebar-bar.md's troubleshooting section. These two tests cover
// the two JS-side guards added against that recurring: a poll that never
// settles must not (a) hang the caller forever or (b) block every future
// poll forever once it's given up on.

test('startFullscreenWatch: abandons a hung probe after timeoutMs and reports false (fail-soft)', async () => {
  // shellExec's returned promise never settles -- simulates the real
  // incident, a fullscreen-detect.exe process that never exits.
  const shell = { shellExec: () => new Promise(() => {}) };
  const results = [];
  // intervalMs huge (never fires a second real tick within the test window),
  // timeoutMs tiny so the test doesn't have to wait long.
  const id = startFullscreenWatch(shell, (v) => results.push(v), 999999, 20);
  await new Promise((resolve) => setTimeout(resolve, 60));
  clearInterval(id);
  assert.deepStrictEqual(results, [false], 'a hung probe must be abandoned (fail-soft to not-fullscreen), not awaited forever');
});

test('startFullscreenWatch: never starts a new poll while the previous one is still outstanding', async () => {
  let callCount = 0;
  let releaseFirst;
  const firstCallGate = new Promise((resolve) => { releaseFirst = resolve; });
  const shell = {
    shellExec: async () => {
      callCount += 1;
      if (callCount === 1) {
        // Block the first call open until the test explicitly releases it,
        // while faster interval ticks fire underneath.
        await firstCallGate;
      }
      return { stdout: '' };
    },
  };
  // Interval fires far faster than the first call resolves -- without the
  // in-flight guard this would launch several overlapping shellExec calls
  // (exactly the shape of bug that piled up an orphanable child process).
  const id = startFullscreenWatch(shell, () => {}, 5, 999999);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.strictEqual(callCount, 1, 'a second poll must not start while the first is still outstanding');
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(id);
  assert.ok(callCount >= 2, 'polling must resume once the outstanding probe settles');
});
