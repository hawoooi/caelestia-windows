import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePreview,
  previewCommand,
  createWindowPreviews,
  WINDOW_PREVIEW_PATH,
  PREVIEW_WIDTH,
} from '../../zebar/caelestia/window-preview.js';

const B64 = 'iVBORw0KGgo=';
const URL = `data:image/png;base64,${B64}`;

test('previewCommand passes the hwnd and width as strings', () => {
  const cmd = previewCommand(133078);
  assert.equal(cmd.program, WINDOW_PREVIEW_PATH);
  assert.deepEqual(cmd.args, ['133078', String(PREVIEW_WIDTH)]);
  assert.deepEqual(previewCommand(42, 200).args, ['42', '200']);
});

test('parsePreview builds a data URL', () => {
  assert.equal(parsePreview(B64), URL);
  assert.equal(parsePreview(`${B64}\r\n`), URL);
});

test('parsePreview treats no output as "no preview", which is ordinary', () => {
  // The tool prints nothing for every failure it knows about: window gone,
  // PrintWindow refused, capture came back a flat fill.
  assert.equal(parsePreview(''), null);
  assert.equal(parsePreview('   \n'), null);
  assert.equal(parsePreview(null), null);
  assert.equal(parsePreview(undefined), null);
});

test('parsePreview rejects non-base64 rather than rendering a broken image', () => {
  assert.equal(parsePreview('not base64!'), null);
  assert.equal(parsePreview('<html>error</html>'), null);
});

test('fetch captures once and then serves the cache', async () => {
  let calls = 0;
  const shell = { shellExec: async () => { calls++; return { stdout: B64 }; } };
  const p = createWindowPreviews(shell);
  assert.equal(await p.fetch(1), URL);
  assert.equal(await p.fetch(1), URL);
  assert.equal(calls, 1);
});

test('the cache EXPIRES -- a window\'s contents change, unlike its icon', async () => {
  let calls = 0;
  let clock = 1000;
  const shell = { shellExec: async () => { calls++; return { stdout: B64 }; } };
  const p = createWindowPreviews(shell, { ttlMs: 500, now: () => clock });

  await p.fetch(1);
  clock += 200;
  await p.fetch(1);
  assert.equal(calls, 1, 'still fresh');

  clock += 400;                 // now 600ms old, past the 500ms TTL
  assert.equal(p.cached(1), undefined, 'stale entries do not read as hits');
  await p.fetch(1);
  assert.equal(calls, 2, 're-captured after expiry');
});

test('a window that cannot be captured is remembered, but only for the TTL', async () => {
  let calls = 0;
  let clock = 0;
  const shell = { shellExec: async () => { calls++; return { stdout: '' }; } };
  const p = createWindowPreviews(shell, { ttlMs: 1000, now: () => clock });

  assert.equal(await p.fetch(7), null);
  assert.equal(await p.fetch(7), null);
  assert.equal(calls, 1, 'not re-probed on every hover');

  clock += 1500;
  await p.fetch(7);
  assert.equal(calls, 2, 'a window may become capturable again');
});

test('only one capture runs at a time', async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const shell = { shellExec: async () => { started++; await gate; return { stdout: B64 }; } };
  const p = createWindowPreviews(shell);

  const first = p.fetch(1);
  assert.equal(await p.fetch(2), undefined, 'refused, caller retries');
  assert.equal(started, 1);
  release();
  await first;
});

test('a nonzero exit is "no preview", not an unhandled rejection', async () => {
  const shell = { shellExec: async () => { throw new Error('exit 4'); } };
  assert.equal(await createWindowPreviews(shell).fetch(1), null);
});

test('cached() is synchronous and never spawns', () => {
  let calls = 0;
  const p = createWindowPreviews({ shellExec: async () => { calls++; return { stdout: '' }; } });
  assert.equal(p.cached(1), undefined);
  assert.equal(calls, 0);
});

test('the cache is bounded -- a long session cannot grow it without limit', async () => {
  let n = 0;
  const shell = { shellExec: async () => { n++; return { stdout: B64 }; } };
  const p = createWindowPreviews(shell, { maxEntries: 3 });
  for (let i = 1; i <= 5; i++) await p.fetch(i);
  // Each entry is a base64 screenshot worth tens of KB.
  assert.equal(p.cached(1), undefined);
  assert.equal(p.cached(2), undefined);
  assert.equal(p.cached(5), URL);
});

test('no shell resolves to null rather than throwing', async () => {
  assert.equal(await createWindowPreviews(null).fetch(1), null);
  assert.equal(await createWindowPreviews({}).fetch(1), null);
});
