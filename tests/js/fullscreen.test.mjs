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
