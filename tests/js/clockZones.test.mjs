// Timezone maths for the clock panel. Every case here is one that is painful
// to reproduce by hand and silently plausible when wrong: DST boundaries,
// half-hour offsets, midnight rolling the date, and conversions that land on a
// different calendar day.
//
// Node and the widget share the same ICU database, so these assertions are
// checking THIS code, not the browser's timezone data.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  DEFAULT_TIMEZONES,
  isValidTimeZone,
  parseClockConfig,
  zoneOffsetMinutes,
  formatOffset,
  zoneLabel,
  formatZoneTime,
  formatZoneDate,
  dayOffset,
  zoneRow,
  zoneRows,
  wallClockToInstant,
  parseDateTimeFields,
  convertZones,
  formatDifference,
  availableTimeZones,
  localTimeZone,
  canonicalTimeZone,
  sameZone,
  offeredSpelling,
} from '../../zebar/caelestia/clock-zones.js';

// --- validation / config --------------------------------------------------

test('zone validity is decided by Intl, not by a hand-kept list', () => {
  assert.strictEqual(isValidTimeZone('Asia/Ho_Chi_Minh'), true);
  assert.strictEqual(isValidTimeZone('UTC'), true);
  assert.strictEqual(isValidTimeZone('Not/AZone'), false);
  assert.strictEqual(isValidTimeZone(''), false);
  assert.strictEqual(isValidTimeZone(null), false);
  assert.strictEqual(isValidTimeZone(42), false);
});

test('a missing or malformed clock block falls back to the default zones', () => {
  for (const bad of [undefined, null, 'nope', 7, []]) {
    assert.deepStrictEqual(parseClockConfig(bad).timezones, DEFAULT_TIMEZONES);
  }
  assert.deepStrictEqual(parseClockConfig({}).timezones, DEFAULT_TIMEZONES);
  assert.deepStrictEqual(parseClockConfig({ timezones: 'UTC' }).timezones, DEFAULT_TIMEZONES);
});

test('configured zones are honoured, with bad and duplicate entries dropped', () => {
  const cfg = parseClockConfig({
    timezones: ['Asia/Ho_Chi_Minh', 'Not/AZone', 'UTC', 'Asia/Ho_Chi_Minh', 99],
  });
  assert.deepStrictEqual(cfg.timezones, ['Asia/Ho_Chi_Minh', 'UTC']);
});

test('an empty list is honoured rather than replaced by the default', () => {
  // "show no world clock, just the local time" is a legitimate configuration.
  assert.deepStrictEqual(parseClockConfig({ timezones: [] }).timezones, []);
});

// --- offsets --------------------------------------------------------------

const JAN = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));   // northern winter
const JUL = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));   // northern summer

test('offsets are read at an instant, because DST moves them', () => {
  // London is UTC+0 in January and UTC+1 in July. A cached per-zone offset
  // would be an hour wrong for half the year.
  assert.strictEqual(zoneOffsetMinutes(JAN, 'Europe/London'), 0);
  assert.strictEqual(zoneOffsetMinutes(JUL, 'Europe/London'), 60);
  // New York: -5 then -4.
  assert.strictEqual(zoneOffsetMinutes(JAN, 'America/New_York'), -300);
  assert.strictEqual(zoneOffsetMinutes(JUL, 'America/New_York'), -240);
  // Zones without DST stay put.
  assert.strictEqual(zoneOffsetMinutes(JAN, 'Asia/Ho_Chi_Minh'), 420);
  assert.strictEqual(zoneOffsetMinutes(JUL, 'Asia/Ho_Chi_Minh'), 420);
});

test('half- and quarter-hour offsets survive formatting', () => {
  // Rounding offsets to whole hours would quietly mis-state these.
  assert.strictEqual(formatOffset(zoneOffsetMinutes(JAN, 'Asia/Kolkata')), '+05:30');
  assert.strictEqual(formatOffset(zoneOffsetMinutes(JAN, 'Asia/Kathmandu')), '+05:45');
  assert.strictEqual(formatOffset(zoneOffsetMinutes(JAN, 'America/St_Johns')), '-03:30');
});

test('offset formatting covers sign and zero', () => {
  assert.strictEqual(formatOffset(0), '+00:00');
  assert.strictEqual(formatOffset(420), '+07:00');
  assert.strictEqual(formatOffset(-270), '-04:30');
  assert.strictEqual(formatOffset(NaN), '');
});

// --- labels / rendering ---------------------------------------------------

test('zone labels are the readable tail of the IANA id', () => {
  assert.strictEqual(zoneLabel('America/New_York'), 'New York');
  assert.strictEqual(zoneLabel('Asia/Ho_Chi_Minh'), 'Ho Chi Minh');
  assert.strictEqual(zoneLabel('UTC'), 'UTC');
  assert.strictEqual(zoneLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.strictEqual(zoneLabel(''), '');
});

test('times render as 24h in the zone asked for', () => {
  // 12:00 UTC is 19:00 in Ho Chi Minh and 07:00 in New York (winter).
  assert.strictEqual(formatZoneTime(JAN, 'UTC'), '12:00');
  assert.strictEqual(formatZoneTime(JAN, 'Asia/Ho_Chi_Minh'), '19:00');
  assert.strictEqual(formatZoneTime(JAN, 'America/New_York'), '07:00');
});

test('midnight renders as 00:00 and does not roll the date forward', () => {
  // The h23-vs-h24 trap: with hour12:false, en-US renders midnight as "24",
  // which becomes the NEXT day when fed back through Date.UTC. That would
  // shift every offset and conversion involving midnight by a full day.
  const midnightUtc = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));
  assert.strictEqual(formatZoneTime(midnightUtc, 'UTC'), '00:00');
  assert.strictEqual(zoneOffsetMinutes(midnightUtc, 'UTC'), 0);
  assert.ok(formatZoneDate(midnightUtc, 'UTC').includes('15'));
});

test('day offset marks zones on a different calendar day', () => {
  // 23:00 UTC is already the next day in Tokyo, and still the same day in NY.
  const lateUtc = new Date(Date.UTC(2026, 0, 15, 23, 0, 0));
  assert.strictEqual(dayOffset(lateUtc, 'Asia/Tokyo', 'UTC'), 1);
  assert.strictEqual(dayOffset(lateUtc, 'America/New_York', 'UTC'), 0);
  // And behind, going the other way.
  const earlyUtc = new Date(Date.UTC(2026, 0, 15, 2, 0, 0));
  assert.strictEqual(dayOffset(earlyUtc, 'America/New_York', 'UTC'), -1);
});

test('a row carries everything the panel renders, and a bad zone yields null', () => {
  const row = zoneRow(JAN, 'Asia/Tokyo', 'UTC');
  assert.strictEqual(row.zone, 'Asia/Tokyo');
  assert.strictEqual(row.label, 'Tokyo');
  assert.strictEqual(row.time, '21:00');
  assert.strictEqual(row.offset, '+09:00');
  assert.strictEqual(zoneRow(JAN, 'Not/AZone', 'UTC'), null);
});

test('zoneRows drops invalid entries and survives a non-array', () => {
  assert.deepStrictEqual(zoneRows(JAN, ['UTC', 'Not/AZone'], 'UTC').map((r) => r.zone), ['UTC']);
  assert.deepStrictEqual(zoneRows(JAN, undefined, 'UTC'), []);
});

// --- wall clock -> instant ------------------------------------------------

test('a wall-clock reading resolves to the right instant', () => {
  // 09:00 in Ho Chi Minh (UTC+7) is 02:00 UTC.
  const i = wallClockToInstant({ year: 2026, month: 1, day: 15, hour: 9, minute: 0 }, 'Asia/Ho_Chi_Minh');
  assert.strictEqual(i.toISOString(), '2026-01-15T02:00:00.000Z');
});

test('a reading just after a DST spring-forward is not an hour out', () => {
  // This is why the offset correction runs twice. US DST starts 2026-03-08.
  // 03:00 EDT that morning is 07:00 UTC; a single-pass correction would use
  // the pre-transition -05:00 offset and land an hour wrong.
  const i = wallClockToInstant({ year: 2026, month: 3, day: 8, hour: 3, minute: 0 }, 'America/New_York');
  assert.strictEqual(i.toISOString(), '2026-03-08T07:00:00.000Z');
  assert.strictEqual(formatZoneTime(i, 'America/New_York'), '03:00', 'round trips');
});

test('a reading just after the autumn fall-back round trips too', () => {
  // 2026-11-01, clocks go back. 01:30 is ambiguous; whichever instant is
  // chosen must at least render back as 01:30 in that zone.
  const i = wallClockToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
  assert.strictEqual(formatZoneTime(i, 'America/New_York'), '01:30');
});

test('an invalid zone or incomplete fields yields null', () => {
  assert.strictEqual(wallClockToInstant({ year: 2026, month: 1, day: 1, hour: 0, minute: 0 }, 'Not/AZone'), null);
  assert.strictEqual(wallClockToInstant({ year: NaN, month: 1, day: 1, hour: 0, minute: 0 }, 'UTC'), null);
});

// --- field parsing --------------------------------------------------------

test('date and time fields parse only in the exact input format', () => {
  assert.deepStrictEqual(parseDateTimeFields('2026-01-15', '09:30'),
    { year: 2026, month: 1, day: 15, hour: 9, minute: 30 });
  // A half-typed form must not produce a confidently wrong answer.
  for (const [d, t] of [['', '09:30'], ['2026-01-15', ''], ['15/01/2026', '09:30'],
                        ['2026-01-15', '9:30'], ['2026-13-15', '09:30'],
                        ['2026-01-15', '25:00'], [null, null]]) {
    assert.strictEqual(parseDateTimeFields(d, t), null, `expected null for ${d} ${t}`);
  }
});

// --- conversion -----------------------------------------------------------

test('converts a wall-clock reading between zones', () => {
  const r = convertZones({
    dateStr: '2026-01-15', timeStr: '09:00',
    fromZone: 'Asia/Ho_Chi_Minh', toZone: 'Europe/London',
  });
  assert.strictEqual(r.time, '02:00');
  assert.strictEqual(r.offset, '+00:00');
  assert.strictEqual(r.differenceMinutes, -420, 'London is 7h behind in January');
  assert.strictEqual(formatDifference(r.differenceMinutes), '7h behind');
});

test('a conversion that crosses midnight reports the day shift', () => {
  // 09:00 Tokyo on the 15th is 19:00 New York on the 14th.
  const r = convertZones({
    dateStr: '2026-01-15', timeStr: '09:00',
    fromZone: 'Asia/Tokyo', toZone: 'America/New_York',
  });
  assert.strictEqual(r.time, '19:00');
  assert.strictEqual(r.dayOffset, -1, 'the previous day');
  assert.ok(r.date.includes('14'));
});

test('conversion honours DST on the target side', () => {
  // Same 09:00 Ho Chi Minh reading in January vs July: London shifts by an
  // hour because of British Summer Time, though Ho Chi Minh never moves.
  const jan = convertZones({ dateStr: '2026-01-15', timeStr: '09:00', fromZone: 'Asia/Ho_Chi_Minh', toZone: 'Europe/London' });
  const jul = convertZones({ dateStr: '2026-07-15', timeStr: '09:00', fromZone: 'Asia/Ho_Chi_Minh', toZone: 'Europe/London' });
  assert.strictEqual(jan.time, '02:00');
  assert.strictEqual(jul.time, '03:00');
});

test('converting a zone to itself is a no-op', () => {
  const r = convertZones({ dateStr: '2026-01-15', timeStr: '09:00', fromZone: 'UTC', toZone: 'UTC' });
  assert.strictEqual(r.time, '09:00');
  assert.strictEqual(r.differenceMinutes, 0);
  assert.strictEqual(formatDifference(0), 'same time');
});

test('an unusable conversion request yields null, never a plausible guess', () => {
  const base = { dateStr: '2026-01-15', timeStr: '09:00', fromZone: 'UTC', toZone: 'UTC' };
  assert.strictEqual(convertZones({ ...base, toZone: 'Not/AZone' }), null);
  assert.strictEqual(convertZones({ ...base, fromZone: 'Not/AZone' }), null);
  assert.strictEqual(convertZones({ ...base, timeStr: '' }), null);
  assert.strictEqual(convertZones({}), null);
});

test('differences read naturally, including half-hour zones', () => {
  assert.strictEqual(formatDifference(720), '12h ahead');
  assert.strictEqual(formatDifference(-330), '5h 30m behind');
  assert.strictEqual(formatDifference(45), '45m ahead');
  assert.strictEqual(formatDifference(0), 'same time');
});

test('India to Nepal is the 15-minute case', () => {
  const r = convertZones({
    dateStr: '2026-01-15', timeStr: '12:00',
    fromZone: 'Asia/Kolkata', toZone: 'Asia/Kathmandu',
  });
  assert.strictEqual(r.time, '12:15');
  assert.strictEqual(formatDifference(r.differenceMinutes), '15m ahead');
});

// --- picker list ----------------------------------------------------------

test('the converter list merges configured zones into the canonical list', () => {
  // Intl.supportedValuesOf returns CANONICAL ids only. Verified live: its 418
  // entries include neither `UTC` (canonical `Etc/UTC`) nor `Asia/Ho_Chi_Minh`
  // (canonical `Asia/Saigon`) -- the two a converter here most needs. Using it
  // raw would silently omit the user's own zone from the picker.
  const zones = availableTimeZones(['Asia/Ho_Chi_Minh']);
  assert.ok(zones.length > 100, `expected the full list, got ${zones.length}`);
  assert.ok(zones.includes('Asia/Ho_Chi_Minh'), 'a configured zone must be offered');
  assert.ok(zones.includes('UTC'), 'UTC must always be offered');
  // The local PLACE must be reachable, but not necessarily under its raw id:
  // local resolves to Asia/Saigon here while the configured spelling is
  // Asia/Ho_Chi_Minh, and the list deliberately offers one entry per place
  // using the configured spelling. Reachability is the real requirement.
  assert.ok(offeredSpelling(zones, localTimeZone()), 'the local zone must be reachable');
  assert.ok(zones.every(isValidTimeZone), 'every offered zone must be valid');
  assert.deepStrictEqual(zones, [...zones].sort(), 'sorted for a usable picker');
  assert.strictEqual(new Set(zones).size, zones.length, 'no duplicates');
});

// --- canonical zone identity ----------------------------------------------
//
// Aliases are the reason the converter shipped, briefly, defaulting both of
// its pickers to the same physical place. All verified live against this
// runtime's ICU data, not assumed.

test('aliases canonicalise to the same zone', () => {
  assert.strictEqual(canonicalTimeZone('Asia/Ho_Chi_Minh'), canonicalTimeZone('Asia/Saigon'));
  assert.strictEqual(canonicalTimeZone('Etc/UTC'), canonicalTimeZone('UTC'));
  assert.strictEqual(canonicalTimeZone('Asia/Kolkata'), canonicalTimeZone('Asia/Calcutta'));
  assert.notStrictEqual(canonicalTimeZone('Europe/London'), canonicalTimeZone('America/New_York'));
});

test('sameZone compares places, not spellings', () => {
  assert.strictEqual(sameZone('Asia/Ho_Chi_Minh', 'Asia/Saigon'), true);
  assert.strictEqual(sameZone('UTC', 'Etc/UTC'), true);
  assert.strictEqual(sameZone('Europe/London', 'Europe/Paris'), false);
});

test('the same place listed under two names yields one row', () => {
  const cfg = parseClockConfig({ timezones: ['Asia/Ho_Chi_Minh', 'Asia/Saigon', 'UTC', 'Etc/UTC'] });
  assert.deepStrictEqual(cfg.timezones, ['Asia/Ho_Chi_Minh', 'UTC'], 'first spelling wins');
});

test('the picker offers each place once, preferring the configured spelling', () => {
  const zones = availableTimeZones(['Asia/Ho_Chi_Minh']);
  assert.ok(zones.includes('Asia/Ho_Chi_Minh'));
  assert.ok(!zones.includes('Asia/Saigon'), 'the alias must not appear alongside it');
  const canonicals = zones.map(canonicalTimeZone);
  assert.strictEqual(new Set(canonicals).size, canonicals.length, 'one entry per place');
});

test('offeredSpelling maps a zone onto the entry the picker actually has', () => {
  // Setting select.value to a spelling absent from the option list silently
  // selects nothing, which is how the "from" picker ended up blank.
  const zones = availableTimeZones(['Asia/Ho_Chi_Minh']);
  assert.strictEqual(offeredSpelling(zones, 'Asia/Saigon'), 'Asia/Ho_Chi_Minh');
  assert.strictEqual(offeredSpelling(zones, 'Etc/UTC'), 'UTC');
  assert.ok(zones.includes(offeredSpelling(zones, localTimeZone())));
  assert.strictEqual(offeredSpelling(zones, 'Not/AZone'), null);
});
