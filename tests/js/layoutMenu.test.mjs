// Covers the pieces that made the layout menu a SECOND Zebar widget: the
// cross-window message channel, the flyout's placement maths, and the bar
// controller's handling of an ack posted by a document it does not control.
//
// What is deliberately NOT covered here, because it cannot be: whether the
// panel actually lands beside the bar, and whether measuring it inside a
// 1x1 window returns its true size. Both are properties of a real WebView2
// window, not of this code -- they were verified live against the running
// widget over CDP (see docs/zebar-bar.md, "The horizontal layout menu"),
// which is the same division of labour every other visual behaviour in this
// pack has.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  CMD_KEY,
  ACK_KEY,
  nextToken,
  encodeMessage,
  decodeMessage,
  createChannel,
} from '../../zebar/caelestia/widget-channel.js';
import {
  GAP_PX,
  SLIDE_PX,
  menuPlacement,
  isAnchorOnMonitor,
} from '../../zebar/caelestia/flyout-placement.js';
import { LAYOUT_CYCLE, layoutLabel } from '../../zebar/caelestia/layouts.js';
import { createLayoutMenuController } from '../../zebar/caelestia/bar/entries/layoutToggle.js';

// --- layout-channel -------------------------------------------------------

test('every layout-channel message carries a distinct token', () => {
  // Not cosmetic: `storage` events are only delivered to other windows when
  // setItem actually CHANGES the stored value. Opening the menu twice from
  // the same button, with the same current layout, would otherwise encode
  // byte-identically the second time and the flyout would never hear about
  // it.
  const a = encodeMessage({ open: true, anchorX: 60, anchorY: 1370 });
  const b = encodeMessage({ open: true, anchorX: 60, anchorY: 1370 });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(nextToken(), nextToken());
});

test('encodeMessage round trips its payload through decodeMessage', () => {
  const msg = decodeMessage(encodeMessage({ open: true, current: 'grid', anchorX: 60, anchorY: 12 }));
  assert.strictEqual(msg.open, true);
  assert.strictEqual(msg.current, 'grid');
  assert.strictEqual(msg.anchorX, 60);
  assert.strictEqual(msg.anchorY, 12);
});

test('decodeMessage returns null for anything that is not a JSON object', () => {
  // Both sides read whatever is sitting in a shared, origin-wide
  // localStorage key -- including a value left over from an older version
  // of this pack, or one a user poked in by hand from a devtools console.
  for (const bad of [null, undefined, '', 'not json', '[1,2,3]', 'null', '42', '"a string"']) {
    assert.strictEqual(decodeMessage(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('the two channel keys are distinct, so a sender never hears its own message', () => {
  assert.notStrictEqual(CMD_KEY, ACK_KEY);
});

function fakeStorage() {
  const map = new Map();
  return {
    map,
    setItem(k, v) { map.set(k, v); },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
  };
}

function fakeTarget() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, fn) { if (type === 'storage') listeners.push(fn); },
    removeEventListener(type, fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    emit(key, newValue) { for (const fn of [...listeners]) fn({ key, newValue }); },
  };
}

test('createChannel posts on its send key and only listens on its receive key', () => {
  const storage = fakeStorage();
  const target = fakeTarget();
  const channel = createChannel(storage, target, { sendKey: CMD_KEY, receiveKey: ACK_KEY });

  channel.post({ open: true });
  assert.strictEqual(storage.getItem(ACK_KEY), null);
  assert.strictEqual(decodeMessage(storage.getItem(CMD_KEY)).open, true);

  const seen = [];
  channel.subscribe((msg) => seen.push(msg));
  target.emit(CMD_KEY, encodeMessage({ open: false }));   // its own send key -- ignored
  target.emit(ACK_KEY, encodeMessage({ closed: true, selected: 'rows' }));
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].selected, 'rows');
});

test('createChannel drops undecodable messages instead of calling the handler', () => {
  const target = fakeTarget();
  const channel = createChannel(fakeStorage(), target, { sendKey: CMD_KEY, receiveKey: ACK_KEY });
  let calls = 0;
  channel.subscribe(() => { calls += 1; });
  target.emit(ACK_KEY, 'not json at all');
  target.emit(ACK_KEY, null);
  assert.strictEqual(calls, 0);
});

test('createChannel unsubscribes cleanly', () => {
  const target = fakeTarget();
  const channel = createChannel(fakeStorage(), target, { sendKey: CMD_KEY, receiveKey: ACK_KEY });
  let calls = 0;
  const off = channel.subscribe(() => { calls += 1; });
  off();
  target.emit(ACK_KEY, encodeMessage({ closed: true }));
  assert.strictEqual(calls, 0);
  assert.strictEqual(target.listeners.length, 0);
});

test('createChannel.post never throws when storage rejects the write', () => {
  const hostile = { setItem() { throw new Error('QuotaExceededError'); } };
  const channel = createChannel(hostile, fakeTarget(), { sendKey: CMD_KEY, receiveKey: ACK_KEY });
  // post() runs straight out of a click handler, which has no try/catch
  // above it -- a throw here would leave the button visibly dead.
  assert.doesNotThrow(() => channel.post({ open: true }));
});

// --- placement ------------------------------------------------------------

const MON = { x: 0, y: 0, width: 2560, height: 1440 };

test('the panel clears the bar and reserves its slide slack', () => {
  const p = menuPlacement({ anchorX: 52, anchorY: 720, panelWidth: 300, panelHeight: 90, monitor: MON });
  // Window starts SLIDE_PX left of where the panel finally sits, because
  // the panel lives at `left: SLIDE_PX` inside it.
  assert.strictEqual(p.x, 52 + GAP_PX - SLIDE_PX);
  assert.strictEqual(p.x + SLIDE_PX, 52 + GAP_PX, 'panel itself must sit GAP_PX clear of the bar');
  assert.strictEqual(p.width, 300 + SLIDE_PX);
  assert.strictEqual(p.height, 90);
});

test('the panel is vertically centred on the button', () => {
  const p = menuPlacement({ anchorX: 52, anchorY: 720, panelWidth: 300, panelHeight: 90, monitor: MON });
  assert.strictEqual(p.y + 90 / 2, 720);
});

test('a button near the bottom edge does not push the panel off-screen', () => {
  // This is the real case, not a hypothetical: layoutToggle sits second
  // from the bottom of a bar that runs to the bottom of the screen, so a
  // naive centre would put roughly half the panel below y = 1440.
  const p = menuPlacement({ anchorX: 52, anchorY: 1420, panelWidth: 300, panelHeight: 90, monitor: MON });
  assert.strictEqual(p.y + p.height, MON.height);
  assert.ok(p.y >= MON.y);
});

test('a button near the top edge does not push the panel above the screen', () => {
  const p = menuPlacement({ anchorX: 52, anchorY: 10, panelWidth: 300, panelHeight: 90, monitor: MON });
  assert.strictEqual(p.y, MON.y);
});

test('clamping is relative to the monitor, not to the desktop origin', () => {
  // A second monitor to the right has a nonzero origin; clamping against 0
  // would fling the panel to the primary monitor's top edge.
  const right = { x: 2560, y: 0, width: 1920, height: 1080 };
  const p = menuPlacement({ anchorX: 2612, anchorY: 1070, panelWidth: 300, panelHeight: 90, monitor: right });
  assert.strictEqual(p.y + p.height, right.y + right.height);
  assert.strictEqual(p.x, 2612 + GAP_PX - SLIDE_PX);
});

test('isAnchorOnMonitor keeps each flyout instance to its own monitor', () => {
  const right = { x: 2560, y: 0, width: 1920, height: 1080 };
  assert.strictEqual(isAnchorOnMonitor(MON, 52, 720), true);
  assert.strictEqual(isAnchorOnMonitor(MON, 2612, 720), false);
  assert.strictEqual(isAnchorOnMonitor(right, 2612, 720), true);
  assert.strictEqual(isAnchorOnMonitor(right, 52, 720), false);
  // Exclusive upper bound: x = 2560 belongs to the right monitor only.
  assert.strictEqual(isAnchorOnMonitor(MON, 2560, 0), false);
  assert.strictEqual(isAnchorOnMonitor(right, 2560, 0), true);
});

// --- the bar controller's half of the protocol ---------------------------

function fakeShell() {
  const calls = [];
  return { calls, shellExec: (program, args) => { calls.push({ program, args }); return Promise.resolve(); } };
}

test('an ack naming a different layout fires exactly one change-layout', () => {
  const shell = fakeShell();
  const c = createLayoutMenuController(shell);
  c.sync('bsp');
  c.toggle();
  const r = c.applyAck({ closed: true, selected: 'grid' });
  assert.deepStrictEqual(r, { changed: true });
  assert.strictEqual(shell.calls.length, 1);
  assert.deepStrictEqual(shell.calls[0].args, ['change-layout', 'grid']);
  assert.strictEqual(c.getCurrent(), 'grid');
  assert.strictEqual(c.isOpen(), false);
});

test('an ack naming the already-active layout changes nothing', () => {
  const shell = fakeShell();
  const c = createLayoutMenuController(shell);
  c.sync('bsp');
  c.toggle();
  assert.deepStrictEqual(c.applyAck({ closed: true, selected: 'bsp' }), { changed: false });
  assert.strictEqual(shell.calls.length, 0);
  assert.strictEqual(c.isOpen(), false);
});

test('a close-without-choosing ack just closes', () => {
  const shell = fakeShell();
  const c = createLayoutMenuController(shell);
  c.sync('bsp');
  c.toggle();
  assert.strictEqual(c.isOpen(), true);
  assert.deepStrictEqual(c.applyAck({ closed: true, selected: null }), { changed: false });
  assert.strictEqual(shell.calls.length, 0);
  assert.strictEqual(c.isOpen(), false);
  assert.strictEqual(c.getCurrent(), 'bsp');
});

test('an ack naming a layout outside the curated cycle never reaches komorebic', () => {
  // The ack arrives over localStorage from a different document. Anything
  // that is not one of the four names this pack ships is treated as a plain
  // close, not passed through to a shell command.
  const shell = fakeShell();
  const c = createLayoutMenuController(shell);
  c.sync('bsp');
  for (const hostile of ['; rm -rf /', 'vertical_stack', 42, {}, true]) {
    c.toggle();
    assert.deepStrictEqual(c.applyAck({ closed: true, selected: hostile }), { changed: false });
    assert.strictEqual(c.isOpen(), false);
  }
  assert.strictEqual(shell.calls.length, 0);
  assert.strictEqual(c.getCurrent(), 'bsp');
});

test('a malformed ack object does not throw', () => {
  const c = createLayoutMenuController(fakeShell());
  assert.doesNotThrow(() => c.applyAck({}));
  assert.doesNotThrow(() => c.applyAck(null));
});

// --- labels ---------------------------------------------------------------

test('every layout in the cycle has a human-readable label for the menu', () => {
  // The whole point of the flyout ("text stating which mode is which") --
  // a layout added to LAYOUT_CYCLE without a label would silently render
  // as "Unknown" next to a correct icon.
  for (const layout of LAYOUT_CYCLE) {
    const label = layoutLabel(layout);
    assert.notStrictEqual(label, 'Unknown', `${layout} has no label`);
    assert.ok(label.length > 0);
  }
  assert.strictEqual(layoutLabel('nonexistent'), 'Unknown');
});
