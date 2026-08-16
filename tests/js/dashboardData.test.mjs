import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatUptime,
  formatBytes,
  formatPercent,
  formatTrackTime,
  promptFields,
  isRealDeparture,
  collectWindows,
  shouldOpen,
} from '../../zebar/caelestia/dashboard-data.js';

test('formatUptime: minutes, hours, then days', () => {
  assert.equal(formatUptime(12 * 60000), '12m');
  assert.equal(formatUptime((60 + 23) * 60000), '1h 23m');
  assert.equal(formatUptime((3 * 1440 + 4 * 60) * 60000), '3d 4h');
});

test('formatUptime: zero is a valid uptime, junk is not', () => {
  assert.equal(formatUptime(0), '0m');
  assert.equal(formatUptime(-1), null);
  assert.equal(formatUptime(null), null);
  assert.equal(formatUptime(NaN), null);
  assert.equal(formatUptime('lots'), null);
});

test('formatBytes: SI steps', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(4600), '5 kB');
  assert.equal(formatBytes(2.4e6), '2 MB');
  assert.equal(formatBytes(352e9), '352.0 GB');
  assert.equal(formatBytes(3e12), '3.0 TB');
});

test('formatBytes rejects junk rather than printing NaN', () => {
  assert.equal(formatBytes(null), null);
  assert.equal(formatBytes(-5), null);
  assert.equal(formatBytes(undefined), null);
});

test('formatPercent rounds, and rejects junk', () => {
  assert.equal(formatPercent(41.6), '42%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(null), null);
});

// Seconds, per the empirical finding recorded in bar/entries/media.js -- the
// provider documents no unit anywhere.
test('formatTrackTime: seconds to mm:ss with a padded seconds field', () => {
  assert.equal(formatTrackTime(57), '0:57');
  assert.equal(formatTrackTime(317), '5:17');
  assert.equal(formatTrackTime(5), '0:05');
  assert.equal(formatTrackTime(0), '0:00');
  assert.equal(formatTrackTime(3661), '61:01');
});

test('formatTrackTime: an absent position is 0:00, never blank or NaN', () => {
  assert.equal(formatTrackTime(null), '0:00');
  assert.equal(formatTrackTime(undefined), '0:00');
  assert.equal(formatTrackTime(-1), '0:00');
});

test('promptFields omits what is missing instead of rendering holes', () => {
  const { hostname, fields } = promptFields({});
  assert.equal(hostname, null);
  assert.deepEqual(fields, []);
});

test('promptFields builds the signature line from whatever is available', () => {
  const { hostname, fields } = promptFields({
    host: { hostname: 'hwoi', uptime: (60 + 23) * 60000 },
    komorebi: { focusedWorkspace: { layout: 'bsp' } },
    network: { defaultInterface: { transmitSpeed: 702e6 } },
    weather: { celsiusTemp: 15.2 },
  });
  assert.equal(hostname, 'hwoi');
  assert.deepEqual(fields, [
    { key: 'komorebi', value: '[bsp]' },
    { key: 'up', value: '1h 23m' },
    { key: 'net', value: '702 Mbps' },
    { key: '', value: '15°C' },
  ]);
});

test('promptFields drops the u64::MAX link rate the network provider reports for an unknown speed', () => {
  const { fields } = promptFields({ network: { defaultInterface: { transmitSpeed: 18446744073709551615 } } });
  assert.deepEqual(fields, []);
});

test('promptFields drops a zero link rate rather than printing "0 Mbps"', () => {
  const { fields } = promptFields({ network: { defaultInterface: { transmitSpeed: 0 } } });
  assert.deepEqual(fields, []);
});

test('promptFields keeps a freezing temperature -- 0C is a reading, not a missing one', () => {
  const { fields } = promptFields({ weather: { celsiusTemp: 0 } });
  assert.deepEqual(fields, [{ key: '', value: '0°C' }]);
});

test('promptFields takes an explicit hostname over the provider', () => {
  assert.equal(promptFields({ host: { hostname: 'from-provider' } }, { hostname: 'override' }).hostname, 'override');
});

// --- hover geometry -------------------------------------------------------

test('isRealDeparture: a pointer still inside the zone has not left it', () => {
  // The live case this exists for: 18ms after the trigger posts "open", the
  // panel opens on top of it and the trigger gets a mouseleave with the
  // pointer unmoved at y=12 in a 16px window. Treating that as real would
  // close the panel in the same breath as opening it.
  assert.equal(isRealDeparture({ y: 12 }, 16), false);
  assert.equal(isRealDeparture({ y: 0 }, 16), false);
  assert.equal(isRealDeparture({ y: 15 }, 16), false);
});

test('isRealDeparture: leaving downward, into the desktop, is real', () => {
  assert.equal(isRealDeparture({ y: 16 }, 16), true);
  assert.equal(isRealDeparture({ y: 200 }, 16), true);
});

test('isRealDeparture: leaving upward is not real -- there is nothing above y=0', () => {
  assert.equal(isRealDeparture({ y: -5 }, 16), false);
});

test('isRealDeparture: an unreadable position closes rather than latching open', () => {
  // Fail toward closing: a panel stuck open over the desktop is far worse
  // than one that closes a beat early.
  assert.equal(isRealDeparture(null, 16), true);
  assert.equal(isRealDeparture({ y: NaN }, 16), true);
  assert.equal(isRealDeparture({}, 16), true);
});

// --- komorebi windows -----------------------------------------------------

test('collectWindows: gathers windows out of tiling containers', () => {
  const ws = { tilingContainers: [{ windows: [{ exe: 'a.exe' }, { exe: 'b.exe' }] }, { windows: [{ exe: 'c.exe' }] }] };
  assert.deepEqual(collectWindows(ws).map((w) => w.exe), ['a.exe', 'b.exe', 'c.exe']);
});

test('collectWindows: finds floating, monocle and maximized windows too', () => {
  // Each of these is a SEPARATE slot in komorebi's state; a reader that only
  // walks tilingContainers silently reports an occupied workspace as empty
  // in exactly the layouts that use them.
  assert.deepEqual(collectWindows({ floatingWindows: [{ exe: 'f.exe' }] }).map((w) => w.exe), ['f.exe']);
  assert.deepEqual(collectWindows({ monocleContainer: { windows: [{ exe: 'm.exe' }] } }).map((w) => w.exe), ['m.exe']);
  assert.deepEqual(collectWindows({ maximizedWindow: { exe: 'x.exe' } }).map((w) => w.exe), ['x.exe']);
});

test('collectWindows: combines every slot at once', () => {
  const ws = {
    tilingContainers: [{ windows: [{ exe: 't.exe' }] }],
    floatingWindows: [{ exe: 'f.exe' }],
    monocleContainer: { windows: [{ exe: 'm.exe' }] },
    maximizedWindow: { exe: 'x.exe' },
  };
  assert.deepEqual(collectWindows(ws).map((w) => w.exe), ['t.exe', 'f.exe', 'm.exe', 'x.exe']);
});

test('collectWindows: an empty or absent workspace yields an empty array, never a throw', () => {
  assert.deepEqual(collectWindows(null), []);
  assert.deepEqual(collectWindows(undefined), []);
  assert.deepEqual(collectWindows({}), []);
  assert.deepEqual(collectWindows({ tilingContainers: [{}] }), []);
  assert.deepEqual(collectWindows({ monocleContainer: {} }), []);
});

// --- open-state recovery --------------------------------------------------

test('shouldOpen: a closed panel opens', () => {
  assert.equal(shouldOpen({ isOpen: false, fullscreen: false, innerHeight: 16, stripHeight: 16 }), true);
});

test('shouldOpen: a genuinely open panel is not reopened', () => {
  assert.equal(shouldOpen({ isOpen: true, fullscreen: false, innerHeight: 500, stripHeight: 16 }), false);
});

test('shouldOpen: a panel that BELIEVES it is open but is still the strip reopens', () => {
  // The latch this exists for: open() sets isOpen = true, then awaits a window
  // resize. If that rejects, the flag is left claiming the panel is up while
  // the window is still 16px tall -- and every later hover returned early,
  // killing the top hover for the rest of the session.
  assert.equal(shouldOpen({ isOpen: true, fullscreen: false, innerHeight: 16, stripHeight: 16 }), true);
});

test('shouldOpen: fullscreen refuses regardless of state', () => {
  assert.equal(shouldOpen({ isOpen: false, fullscreen: true, innerHeight: 16, stripHeight: 16 }), false);
  assert.equal(shouldOpen({ isOpen: true, fullscreen: true, innerHeight: 16, stripHeight: 16 }), false);
});

test('shouldOpen: an unreadable height does not retrigger an open panel', () => {
  // Fail toward doing nothing: a spurious reopen would resize the window out
  // from under a pointer already resting on the panel.
  assert.equal(shouldOpen({ isOpen: true, fullscreen: false, innerHeight: NaN, stripHeight: 16 }), false);
});
