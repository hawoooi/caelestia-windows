import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findEvkeyIcon, evkeyMode, stripAccents, modeLabel, EVKEY_PREFIX,
} from '../../zebar/caelestia/evkey-state.js';

// The exact string this machine's tray reports, copied from a live systray
// provider dump rather than typed from memory.
const LIVE_ENGLISH = 'EVKey - Kích để mở bàn phím Tiếng Việt';

test('the live tooltip means ENGLISH, because it offers to switch to Vietnamese', () => {
  // The inversion is the whole point: the tooltip names the action, not the
  // state. Reading it as the state gives an indicator that is confidently
  // backwards in both directions.
  assert.equal(evkeyMode(LIVE_ENGLISH), 'en');
});

test('offering to switch to English means it is currently VIETNAMESE', () => {
  assert.equal(evkeyMode('EVKey - Kích để mở bàn phím Tiếng Anh'), 'vi');
});

test('accents are irrelevant to the match', () => {
  // The same tooltip has been seen precomposed and decomposed; a reader on a
  // different code page can also strip them entirely.
  assert.equal(evkeyMode('EVKey - Kich de mo ban phim Tieng Viet'), 'en');
  assert.equal(evkeyMode('EVKey - Kich de mo ban phim Tieng Anh'), 'vi');
});

test('an English-language tooltip works too', () => {
  assert.equal(evkeyMode('EVKey - Click to open Vietnamese keyboard'), 'en');
  assert.equal(evkeyMode('EVKey - Click to open English keyboard'), 'vi');
});

test('an unreadable tooltip is null, never a guess', () => {
  // null means "unknown" and the bar renders nothing. A default would put a
  // wrong flag on a widget whose entire job is telling you which mode you are
  // typing in.
  assert.equal(evkeyMode('EVKey'), null);
  assert.equal(evkeyMode('EVKey - something else entirely'), null);
  assert.equal(evkeyMode(''), null);
  assert.equal(evkeyMode(null), null);
  assert.equal(evkeyMode(undefined), null);
  assert.equal(evkeyMode(42), null);
});

test('a tooltip naming BOTH languages is unknown, not a precedence contest', () => {
  // Ambiguity means the tooltip is not the shape this was built against.
  // Picking one would be indistinguishable from an actual reading.
  assert.equal(evkeyMode('EVKey - Tieng Viet / Tieng Anh'), null);
});

test('stripAccents handles Vietnamese d-with-stroke, which is not a combining mark', () => {
  assert.equal(stripAccents('để'), 'de');
  assert.equal(stripAccents('Đường'), 'Duong');
  assert.equal(stripAccents('Tiếng Việt'), 'Tieng Viet');
  assert.equal(stripAccents(null), '');
});

test('findEvkeyIcon picks EVKey out of a real tray', () => {
  const systray = { icons: [
    { tooltip: 'PowerToys v0.91.1' },
    { tooltip: 'EarTrumpet: 50% - Headphones (HDAUDIO)' },
    { tooltip: LIVE_ENGLISH },
    { tooltip: 'Wallpaper Engine' },
  ] };
  assert.equal(findEvkeyIcon(systray).tooltip, LIVE_ENGLISH);
});

test('findEvkeyIcon returns null rather than throwing on junk', () => {
  assert.equal(findEvkeyIcon(null), null);
  assert.equal(findEvkeyIcon({}), null);
  assert.equal(findEvkeyIcon({ icons: null }), null);
  assert.equal(findEvkeyIcon({ icons: [null, undefined, {}, { tooltip: 5 }] }), null);
  assert.equal(findEvkeyIcon({ icons: [{ tooltip: 'Ollama' }] }), null,
    'EVKey simply not running');
});

test('the prefix is what identifies the entry', () => {
  assert.equal(EVKEY_PREFIX, 'EVKey');
  assert.ok(LIVE_ENGLISH.startsWith(EVKEY_PREFIX));
});

test('modeLabel is empty for unknown, so the bar renders nothing', () => {
  assert.equal(modeLabel('vi'), 'VI');
  assert.equal(modeLabel('en'), 'EN');
  assert.equal(modeLabel(null), '');
  assert.equal(modeLabel('xx'), '');
});
