// The status catalogue and the pinned/dropdown config split.
//
// Every fixture below is shaped from output READ LIVE off this machine's own
// zebar 3.3.1 providers over CDP (recorded in docs/zebar-bar.md), not from
// what the field names ought to be. That distinction is the whole point:
// this pack has twice shipped a bug from assuming a provider field's shape,
// so a test suite built on invented fixtures would agree with the code and
// still be wrong about reality.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  STATUS_ITEMS,
  STATUS_IDS,
  DEFAULT_STATUS_CONFIG,
  statusRow,
  statusRows,
  parseStatusConfig,
  volumeGlyph,
  batteryGlyph,
  primaryDisk,
} from '../../zebar/caelestia/status-catalogue.js';
import { createStatusMenuController } from '../../zebar/caelestia/bar/entries/statusCluster.js';

// --- fixtures (real shapes, trimmed) --------------------------------------

const OUT = {
  network: {
    defaultInterface: {
      friendlyName: 'Wi-Fi',
      type: 'wifi',
      ipv4Addresses: ['192.168.31.61/24'],
    },
  },
  audio: {
    defaultPlaybackDevice: {
      name: 'Headphones (High Definition Audio Device)',
      volume: 50,
      isMuted: false,
    },
  },
  cpu: { usage: 22.26464, logicalCoreCount: 12 },
  memory: { usage: 54.883205, usedMemory: 18768068608, totalMemory: 34196377600 },
  disk: {
    disks: [{
      mountPoint: 'C:\\',
      totalSpace: { siValue: 999.184920576, siUnit: 'GB' },
      availableSpace: { siValue: 352.107065344, siUnit: 'GB' },
    }],
  },
  battery: null,   // this desktop: the provider REJECTS with "No battery found."
};

// --- glyph selection ------------------------------------------------------

test('volume glyph honours isMuted independently of the level', () => {
  // The real bug this replaced: a device muted at 50% still reports
  // volume === 50, so a level-only check showed the loud speaker icon for a
  // machine making no sound.
  assert.notStrictEqual(volumeGlyph(50, true), volumeGlyph(50, false));
  assert.strictEqual(volumeGlyph(0, true), volumeGlyph(100, true), 'muted looks the same at any level');
});

test('volume glyph splits off/low/high by level when not muted', () => {
  const off = volumeGlyph(0, false);
  const low = volumeGlyph(30, false);
  const high = volumeGlyph(80, false);
  assert.strictEqual(volumeGlyph(50, false), low, 'boundary: 50 is still low');
  assert.strictEqual(volumeGlyph(51, false), high);
  assert.strictEqual(new Set([off, low, high]).size, 3, 'three distinct glyphs');
});

test('battery glyph descends through five distinct levels', () => {
  const seen = [100, 70, 50, 20, 5].map(batteryGlyph);
  assert.strictEqual(new Set(seen).size, 5);
});

test('every catalogue glyph is a single Font Awesome PUA codepoint', () => {
  // Guards the failure mode CLAUDE.md's Nerd Font rule exists for: a glyph
  // silently written as an empty string between drafting and the file write
  // renders as nothing at all and looks like a CSS problem.
  for (const id of STATUS_IDS) {
    const g = STATUS_ITEMS[id].glyph(OUT);
    assert.strictEqual(typeof g, 'string', `${id} glyph is not a string`);
    assert.strictEqual([...g].length, 1, `${id} glyph is not exactly one codepoint`);
    const cp = g.codePointAt(0);
    assert.ok(cp >= 0xe000 && cp <= 0xf8ff, `${id} glyph U+${cp.toString(16)} is outside the PUA`);
  }
});

// --- rows -----------------------------------------------------------------

test('network reports its interface name, and its address as detail', () => {
  const row = statusRow('network', OUT);
  assert.strictEqual(row.label, 'Network');
  assert.strictEqual(row.value, 'Wi-Fi');
  assert.strictEqual(row.detail, '192.168.31.61', 'CIDR suffix stripped');
});

test('network degrades to Disconnected rather than disappearing', () => {
  // Unlike every other item, "no network" is a state worth showing, not an
  // absence -- so network stays available() === true always.
  const row = statusRow('network', { network: { defaultInterface: null } });
  assert.ok(row);
  assert.strictEqual(row.value, 'Disconnected');
  assert.strictEqual(row.detail, null);
});

test('volume reports Muted instead of a percentage when muted', () => {
  const muted = { audio: { defaultPlaybackDevice: { name: 'X', volume: 50, isMuted: true } } };
  assert.strictEqual(statusRow('volume', muted).value, 'Muted');
  assert.strictEqual(statusRow('volume', OUT).value, '50%');
});

test('cpu and memory round their float usage to a whole percent', () => {
  assert.strictEqual(statusRow('cpu', OUT).value, '22%');
  assert.strictEqual(statusRow('memory', OUT).value, '55%');
  assert.strictEqual(statusRow('memory', OUT).detail, '18.8 / 34.2 GB');
});

test('disk uses the provider-supplied SI value, doing no unit maths itself', () => {
  // The provider already converts; recomputing from `bytes` here would risk
  // this module and the provider disagreeing about GB vs GiB.
  const row = statusRow('disk', OUT);
  assert.strictEqual(row.value, '352 GB free');
  assert.strictEqual(row.detail, 'C:\\ 999 GB');
});

test('disk prefers the system volume over whatever is listed first', () => {
  const multi = { disks: [
    { mountPoint: 'D:\\', totalSpace: { siValue: 1, siUnit: 'GB' }, availableSpace: { siValue: 1, siUnit: 'GB' } },
    { mountPoint: 'C:\\', totalSpace: { siValue: 2, siUnit: 'GB' }, availableSpace: { siValue: 2, siUnit: 'GB' } },
  ] };
  assert.strictEqual(primaryDisk(multi).mountPoint, 'C:\\');
  // ...but still shows something on a machine with no C: at all.
  assert.strictEqual(primaryDisk({ disks: [{ mountPoint: 'Z:\\' }] }).mountPoint, 'Z:\\');
  assert.strictEqual(primaryDisk({ disks: [] }), null);
  assert.strictEqual(primaryDisk(undefined), null);
});

test('a batteryless machine yields no battery row at all', () => {
  // The provider REJECTS here ("No battery found."), which the provider
  // group turns into a null entry. Rendering an empty battery row on a
  // desktop would be worse than rendering nothing.
  assert.strictEqual(statusRow('battery', OUT), null);
  assert.strictEqual(statusRow('battery', {}), null);
});

test('a battery-equipped machine does yield a row', () => {
  // Non-vacuity for the test above: proves the null came from availability,
  // not from the battery branch being broken outright.
  const laptop = { battery: { chargePercent: 87.4, state: 'discharging' } };
  const row = statusRow('battery', laptop);
  assert.strictEqual(row.value, '87%');
  assert.strictEqual(row.detail, 'discharging');
});

test('statusRows drops unavailable and unknown items, preserving order', () => {
  const rows = statusRows(['cpu', 'battery', 'nonexistent', 'memory'], OUT);
  assert.deepStrictEqual(rows.map((r) => r.id), ['cpu', 'memory']);
});

test('statusRows survives a completely empty provider map', () => {
  // Every tick before the first provider emission looks like this.
  assert.doesNotThrow(() => statusRows(STATUS_IDS, {}));
  assert.doesNotThrow(() => statusRows(STATUS_IDS, undefined));
  assert.deepStrictEqual(statusRows(undefined, OUT), []);
});

// --- config ---------------------------------------------------------------

test('a missing or malformed status block falls back to the shipped default', () => {
  for (const bad of [undefined, null, 'nope', 42, []]) {
    assert.deepStrictEqual(parseStatusConfig(bad), DEFAULT_STATUS_CONFIG);
  }
});

test('config honours an explicit split, including moving an icon to the dropdown', () => {
  // The actual feature: any icon can be pinned or dropped down.
  const cfg = parseStatusConfig({ pinned: ['cpu'], dropdown: ['network', 'volume'] });
  assert.deepStrictEqual(cfg, { pinned: ['cpu'], dropdown: ['network', 'volume'] });
});

test('an empty pinned list is honoured, not treated as "unset"', () => {
  // [] is falsy-ish in a lot of hand-rolled checks; "pin nothing, put it all
  // in the dropdown" is a legitimate configuration.
  const cfg = parseStatusConfig({ pinned: [], dropdown: ['cpu'] });
  assert.deepStrictEqual(cfg.pinned, []);
});

test('unknown icon ids are dropped without taking the rest of the config down', () => {
  const cfg = parseStatusConfig({ pinned: ['network', 'bogus'], dropdown: ['cpu', 17, null] });
  assert.deepStrictEqual(cfg.pinned, ['network']);
  assert.deepStrictEqual(cfg.dropdown, ['cpu']);
});

test('an icon listed in both lists is kept pinned and removed from the dropdown', () => {
  const cfg = parseStatusConfig({ pinned: ['network', 'cpu'], dropdown: ['cpu', 'memory'] });
  assert.deepStrictEqual(cfg.pinned, ['network', 'cpu']);
  assert.deepStrictEqual(cfg.dropdown, ['memory'], 'no icon renders twice');
});

test('one malformed list does not discard the other', () => {
  const cfg = parseStatusConfig({ pinned: 'not an array', dropdown: ['cpu'] });
  assert.deepStrictEqual(cfg.pinned, DEFAULT_STATUS_CONFIG.pinned);
  assert.deepStrictEqual(cfg.dropdown, ['cpu']);
});

test('the shipped default only references real catalogue ids', () => {
  for (const id of [...DEFAULT_STATUS_CONFIG.pinned, ...DEFAULT_STATUS_CONFIG.dropdown]) {
    assert.ok(STATUS_ITEMS[id], `default config references unknown id '${id}'`);
  }
});

// --- dropdown open/close state -------------------------------------------

test('the dropdown controller toggles, and any ack closes it', () => {
  const c = createStatusMenuController();
  assert.strictEqual(c.isOpen(), false);
  assert.strictEqual(c.toggle(), true);
  assert.strictEqual(c.toggle(), false);
  c.toggle();
  assert.strictEqual(c.applyAck({ closed: true }), true, 'reports it was open');
  assert.strictEqual(c.isOpen(), false);
  assert.strictEqual(c.applyAck({}), false, 'already closed');
});

test('close() reports whether it actually did anything', () => {
  const c = createStatusMenuController();
  assert.strictEqual(c.close(), false);
  c.toggle();
  assert.strictEqual(c.close(), true);
  assert.strictEqual(c.isOpen(), false);
});
