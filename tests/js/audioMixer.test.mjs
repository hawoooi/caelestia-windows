// The client side of tools/audio-mixer.exe. The helper's stdout is another
// process's output -- it can be empty, truncated mid-write if the process is
// killed, or absent entirely when no default device exists -- so every one of
// these cases has to degrade rather than throw out of a provider tick or a
// slider drag.
//
// The fixture below is REAL output captured from the built helper on this
// machine, not invented.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  MIXER_PATH,
  listCommand,
  setVolumeCommand,
  setMuteCommand,
  parseSessions,
  sortSessions,
  sessionsSignature,
  createMixer,
} from '../../zebar/caelestia/audio-mixer.js';

const REAL = '{"sessions":['
  + '{"pid":5924,"process":"LEDKeeper2","display":"LEDKeeper2","volume":100,"muted":false,"system":false},'
  + '{"pid":20728,"process":"chrome","display":"Google Chrome","volume":53,"muted":false,"system":false},'
  + '{"pid":15824,"process":"vesktop","display":"Vesktop","volume":30,"muted":false,"system":false},'
  + '{"pid":0,"process":"System","display":"System Sounds","volume":100,"muted":false,"system":true}'
  + ']}';

// --- command construction -------------------------------------------------
//
// These must keep matching the argsRegex registered in zpack.json:
//   ^(list( --no-icons)?|set \d{1,7} \d{1,3}|mute \d{1,7} [01])$
// A builder that drifts out of that gets rejected at the privilege layer with
// no useful error, so the shapes are pinned here.

const ARGS_REGEX = /^(list( --no-icons)?|set \d{1,7} \d{1,3}|mute \d{1,7} [01])$/;
const joined = (cmd) => cmd.args.join(' ');

test('every command this module can emit satisfies the registered argsRegex', () => {
  const commands = [
    listCommand(true),
    listCommand(false),
    setVolumeCommand(20728, 53),
    setVolumeCommand(1, 0),
    setVolumeCommand(9999999, 100),
    setMuteCommand(20728, true),
    setMuteCommand(20728, false),
  ];
  for (const cmd of commands) {
    assert.strictEqual(cmd.program, MIXER_PATH);
    assert.match(joined(cmd), ARGS_REGEX, `rejected: ${joined(cmd)}`);
  }
});

test('volume is clamped and rounded before it can reach the command line', () => {
  // The slider is 0-100, but the value also arrives from arithmetic and from
  // an optimistic UI update. Out-of-range or fractional values would fail the
  // argsRegex rather than doing something wrong, but clamping is the honest
  // fix.
  assert.strictEqual(joined(setVolumeCommand(5, 150)), 'set 5 100');
  assert.strictEqual(joined(setVolumeCommand(5, -20)), 'set 5 0');
  assert.strictEqual(joined(setVolumeCommand(5, 53.7)), 'set 5 54');
  assert.strictEqual(joined(setVolumeCommand(5, NaN)), 'set 5 0');
  assert.match(joined(setVolumeCommand(5, 150)), ARGS_REGEX);
});

// --- parsing --------------------------------------------------------------

test('parses real helper output', () => {
  const sessions = parseSessions(REAL);
  assert.strictEqual(sessions.length, 4);
  const chrome = sessions.find((s) => s.process === 'chrome');
  assert.strictEqual(chrome.pid, 20728);
  assert.strictEqual(chrome.display, 'Google Chrome');
  assert.strictEqual(chrome.volume, 53);
  assert.strictEqual(chrome.muted, false);
  assert.strictEqual(chrome.system, false);
  assert.strictEqual(chrome.icon, null, 'no icon field in a --no-icons read');
});

test('malformed, empty and truncated output all degrade to no sessions', () => {
  // Truncation is the realistic one: the helper is killed mid-write when the
  // panel closes during a poll.
  const truncated = REAL.slice(0, 120);
  for (const bad of ['', '   ', 'not json', truncated, '{}', '{"sessions":null}', '[]', null, undefined, 42]) {
    assert.deepStrictEqual(parseSessions(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

test('individual malformed sessions are dropped, not the whole list', () => {
  const mixed = '{"sessions":[{"pid":1,"process":"a","volume":10},null,{"nope":true},{"pid":2,"process":"b","volume":20}]}';
  assert.deepStrictEqual(parseSessions(mixed).map((s) => s.pid), [1, 2]);
});

test('a session missing its display name falls back to the process name', () => {
  const s = parseSessions('{"sessions":[{"pid":7,"process":"foo","volume":5}]}')[0];
  assert.strictEqual(s.display, 'foo');
  assert.strictEqual(s.muted, false);
  assert.strictEqual(s.system, false);
});

test('out-of-range volumes from the helper are clamped on the way in too', () => {
  const s = parseSessions('{"sessions":[{"pid":7,"process":"foo","volume":9001}]}')[0];
  assert.strictEqual(s.volume, 100);
});

// --- ordering / signature -------------------------------------------------

test('sessions sort stably, with system sounds last', () => {
  const sorted = sortSessions(parseSessions(REAL));
  assert.deepStrictEqual(sorted.map((s) => s.display),
    ['Google Chrome', 'LEDKeeper2', 'Vesktop', 'System Sounds']);
  // Sorting must not depend on input order -- rows would jump under the
  // cursor between polls otherwise.
  const reversed = sortSessions([...parseSessions(REAL)].reverse());
  assert.deepStrictEqual(sorted.map((s) => s.pid), reversed.map((s) => s.pid));
});

test('the signature tracks the session SET, not their volumes', () => {
  // Rebuilding rows on a volume change would drop a slider mid-drag, so the
  // signature must be blind to levels and mute state.
  const a = parseSessions(REAL);
  const b = parseSessions(REAL.replace('"volume":53', '"volume":7').replace('"muted":false', '"muted":true'));
  assert.strictEqual(sessionsSignature(a), sessionsSignature(b));

  const fewer = a.filter((s) => s.pid !== 20728);
  assert.notStrictEqual(sessionsSignature(a), sessionsSignature(fewer));
});

// --- the client controller ------------------------------------------------

function fakeShell(stdoutFor) {
  const calls = [];
  return {
    calls,
    shellExec(program, args) {
      calls.push(args.join(' '));
      const out = stdoutFor ? stdoutFor(args.join(' ')) : REAL;
      if (out === null) return Promise.reject(new Error('exit 1'));
      return Promise.resolve({ stdout: out, stderr: '', exitCode: 0 });
    },
  };
}

test('the first refresh asks for icons and later ones do not', async () => {
  const shell = fakeShell();
  const mixer = createMixer(shell);
  await mixer.refresh(true);
  await mixer.refresh(false);
  assert.deepStrictEqual(shell.calls, ['list', 'list --no-icons']);
});

test('icons are cached across polls that do not carry them', async () => {
  const withIcon = REAL.replace('"system":false},{"pid":15824', '"system":false,"icon":"AAAB"},{"pid":15824');
  const shell = fakeShell((args) => (args === 'list' ? withIcon : REAL));
  const mixer = createMixer(shell);

  const first = await mixer.refresh(true);
  assert.strictEqual(first.find((s) => s.pid === 20728).icon, 'AAAB');

  const second = await mixer.refresh(false);
  assert.strictEqual(second.find((s) => s.pid === 20728).icon, 'AAAB', 're-attached from cache');
  assert.strictEqual(mixer.iconFor(20728), 'AAAB');
});

test('icons for processes that have gone away are forgotten', async () => {
  const withIcon = REAL.replace('"system":false},{"pid":15824', '"system":false,"icon":"AAAB"},{"pid":15824');
  const gone = '{"sessions":[{"pid":1,"process":"x","display":"X","volume":1,"muted":false,"system":false}]}';
  let stage = 0;
  const shell = fakeShell(() => (stage++ === 0 ? withIcon : gone));
  const mixer = createMixer(shell);
  await mixer.refresh(true);
  assert.strictEqual(mixer.iconFor(20728), 'AAAB');
  await mixer.refresh(false);
  assert.strictEqual(mixer.iconFor(20728), null, 'cache must not grow forever');
});

test('refreshes never overlap', async () => {
  // A slider drag plus a 1s poll can otherwise put several helper processes in
  // flight at once, each enumerating Core Audio. This pack has already lost
  // two debugging sessions to an unsupervised shellExec helper.
  let resolve;
  const gate = new Promise((r) => { resolve = r; });
  let running = 0, maxConcurrent = 0;
  const shell = {
    async shellExec() {
      running++; maxConcurrent = Math.max(maxConcurrent, running);
      await gate;
      running--;
      return { stdout: REAL, stderr: '', exitCode: 0 };
    },
  };
  const mixer = createMixer(shell);
  const a = mixer.refresh(true);
  const dropped = await mixer.refresh(false);   // resolves immediately as null
  assert.strictEqual(dropped, null, 'the second refresh is dropped, not queued');
  resolve();
  await a;
  assert.strictEqual(maxConcurrent, 1);
});

test('a rejected helper call yields null rather than throwing', async () => {
  // Nonzero exit is the helper's documented "nothing to report" (no session,
  // no default device), which is a normal outcome, not an error.
  const mixer = createMixer(fakeShell(() => null));
  assert.strictEqual(await mixer.refresh(true), null);
  await assert.doesNotReject(() => mixer.setVolume(1, 50));
});

test('a missing shell handle degrades instead of throwing', async () => {
  const mixer = createMixer(null);
  assert.strictEqual(await mixer.refresh(true), null);
  await assert.doesNotReject(() => mixer.setVolume(1, 50));
  await assert.doesNotReject(() => mixer.setMute(1, true));
});

test('writes are not blocked by an in-flight refresh', async () => {
  // The user dragging a slider must never be dropped in favour of a poll.
  let resolve;
  const gate = new Promise((r) => { resolve = r; });
  const calls = [];
  const shell = {
    async shellExec(_p, args) {
      calls.push(args.join(' '));
      if (args[0] === 'list') await gate;
      return { stdout: REAL, stderr: '', exitCode: 0 };
    },
  };
  const mixer = createMixer(shell);
  const pending = mixer.refresh(true);
  await mixer.setVolume(20728, 42);
  assert.ok(calls.includes('set 20728 42'), 'the write went through during a refresh');
  resolve();
  await pending;
});
