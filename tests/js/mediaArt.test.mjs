import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArt,
  trackKey,
  artCommand,
  createMediaArt,
  MEDIA_ART_PATH,
} from '../../zebar/caelestia/media-art.js';

const B64 = 'iVBORw0KGgo=';

test('artCommand is pinned to the tool and takes no arguments', () => {
  assert.equal(artCommand().program, MEDIA_ART_PATH);
  assert.deepEqual(artCommand().args, []);
});

test('parseArt splits the three tab-separated fields into a data URL', () => {
  const r = parseArt(`Retrace\tEe\t${B64}\n`);
  assert.equal(r.title, 'Retrace');
  assert.equal(r.artist, 'Ee');
  assert.equal(r.dataUrl, `data:image/png;base64,${B64}`);
});

test('parseArt handles an empty artist without losing the image', () => {
  const r = parseArt(`Some Podcast\t\t${B64}`);
  assert.equal(r.artist, '');
  assert.equal(r.dataUrl, `data:image/png;base64,${B64}`);
});

test('parseArt treats no output as "no art", which is an ordinary outcome', () => {
  // The tool prints nothing for every failure it knows about, and plenty of
  // real tracks simply have no cover.
  assert.equal(parseArt(''), null);
  assert.equal(parseArt('\n'), null);
  assert.equal(parseArt(null), null);
  assert.equal(parseArt(undefined), null);
});

test('parseArt rejects malformed lines rather than rendering a broken image', () => {
  assert.equal(parseArt('no tabs at all'), null);
  assert.equal(parseArt('title\tartist'), null);          // missing the image
  assert.equal(parseArt('title\tartist\t'), null);        // empty image
  assert.equal(parseArt('title\tartist\tnot base64!'), null);
});

test('trackKey ignores case and whitespace differences between metadata sources', () => {
  // Players are not consistent about either between what they report to the
  // provider and what they report to SMTC; a stricter key would re-fetch the
  // same cover forever.
  assert.equal(trackKey('Retrace', 'Ee'), trackKey('  retrace ', 'EE'));
  assert.equal(trackKey('A  B', 'x'), trackKey('a b', 'X'));
  assert.notEqual(trackKey('Retrace', 'Ee'), trackKey('Retrace', 'Other'));
});

test('trackKey survives absent metadata', () => {
  assert.equal(trackKey(null, undefined), trackKey('', ''));
});

test('fetch asks the tool once per track, then serves the cache', async () => {
  let calls = 0;
  const shell = { shellExec: async () => { calls++; return { stdout: `T\tA\t${B64}` }; } };
  const art = createMediaArt(shell);

  assert.equal(await art.fetch('T', 'A'), `data:image/png;base64,${B64}`);
  assert.equal(await art.fetch('T', 'A'), `data:image/png;base64,${B64}`);
  assert.equal(await art.fetch('t', ' a '), `data:image/png;base64,${B64}`);
  // The panel re-renders once a second; one spawn per render is the pattern
  // that has twice orphaned a helper onto zebar's listening socket.
  assert.equal(calls, 1);
});

test('a track with no art is asked once, not once per render, forever', async () => {
  let calls = 0;
  const shell = { shellExec: async () => { calls++; return { stdout: '' }; } };
  const art = createMediaArt(shell);
  assert.equal(await art.fetch('Silent', 'X'), null);
  assert.equal(await art.fetch('Silent', 'X'), null);
  assert.equal(calls, 1);
});

test('a nonzero exit is "no art", not an unhandled rejection', async () => {
  const shell = { shellExec: async () => { throw new Error('exit 2'); } };
  const art = createMediaArt(shell);
  assert.equal(await art.fetch('T', 'A'), null);
});

test('an answer that arrives for a DIFFERENT track is not shown for this one', async () => {
  // The song changed while the fetch was in flight. The tool echoes back the
  // track its image is actually for, which is the only way to tell.
  const shell = { shellExec: async () => ({ stdout: `NewSong\tNewArtist\t${B64}` }) };
  const art = createMediaArt(shell);

  const result = await art.fetch('OldSong', 'OldArtist');
  assert.equal(result, undefined, 'must not attribute the cover to the asked-for track');
  // The old track stays unasked, so the next render retries it...
  assert.equal(art.cached('OldSong', 'OldArtist'), undefined);
  // ...and the cover is filed under the track it really belongs to.
  assert.equal(art.cached('NewSong', 'NewArtist'), `data:image/png;base64,${B64}`);
});

test('only one fetch is in flight at a time', async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const shell = { shellExec: async () => { started++; await gate; return { stdout: `T\tA\t${B64}` }; } };
  const art = createMediaArt(shell);

  const first = art.fetch('T', 'A');
  assert.equal(await art.fetch('Other', 'B'), undefined);
  assert.equal(started, 1);
  release();
  await first;
});

test('cached() is a synchronous read that never spawns anything', () => {
  let calls = 0;
  const art = createMediaArt({ shellExec: async () => { calls++; return { stdout: '' }; } });
  assert.equal(art.cached('T', 'A'), undefined);
  assert.equal(calls, 0);
});

test('the cache is bounded -- a long playlist cannot grow it without limit', async () => {
  let n = 0;
  const shell = { shellExec: async () => { n++; return { stdout: `T${n}\tA\t${B64}` }; } };
  const art = createMediaArt(shell, { maxEntries: 3 });
  for (let i = 1; i <= 5; i++) await art.fetch(`T${i}`, 'A');
  // Each entry is a base64 image worth ~100KB, so the oldest must fall out.
  assert.equal(art.cached('T1', 'A'), undefined);
  assert.equal(art.cached('T2', 'A'), undefined);
  assert.equal(art.cached('T5', 'A'), `data:image/png;base64,${B64}`);
});

test('no shell at all resolves to null rather than throwing', async () => {
  assert.equal(await createMediaArt(null).fetch('T', 'A'), null);
  assert.equal(await createMediaArt({}).fetch('T', 'A'), null);
});
