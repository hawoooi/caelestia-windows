// Time, date and timezone logic for the clock panel. Direct user feedback:
// "work on the time widget, when i press on it it should also show the clock
// time date as well. timezones also. It would be nice if there was also a tool
// that allows me to convert to another timezone built in".
//
// Pure and DOM-free, so every case that is awkward to reproduce by hand --
// a zone on a half-hour offset, a conversion across a DST boundary, a
// conversion that lands on a different calendar day -- is assertable in
// tests/js/clockZones.test.mjs. The DOM half lives in panels/panels.js.
//
// No native helper here, unlike the audio and network panels: `Intl` already
// has the full IANA timezone database, including historical and future DST
// rules, and it is the same database Windows itself is updated against. Adding
// a helper would mean shipping a second, worse copy of it.

// Shown when bar.config.json has no `clock` block. A deliberately small,
// recognisable spread rather than a guess at where the user works: UTC as the
// neutral reference, then the three financial centres most schedules are
// quoted against.
export const DEFAULT_TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

// `Intl` is the authority on what a valid zone is -- there is no useful list to
// validate against by hand, and the set changes with the ICU data the runtime
// ships. A bad zone throws a RangeError from the DateTimeFormat constructor,
// so this is the only reliable check.
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

// The IANA database carries aliases, and they matter here more than they look
// like they should. Verified live rather than assumed:
//
//   Asia/Ho_Chi_Minh -> Asia/Saigon      Asia/Kolkata -> Asia/Calcutta
//   Etc/UTC          -> UTC              America/New_York -> (itself)
//
// and, on this machine, `localTimeZone()` resolves to `Asia/Saigon` while the
// obvious thing to put in bar.config.json is `Asia/Ho_Chi_Minh`. Comparing
// those two as strings says "different zones", which produced a converter
// whose two pickers defaulted to the same physical place under two names and
// therefore converted nothing. Compare canonical forms, never raw ids.
export function canonicalTimeZone(tz) {
  try {
    return Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone || tz;
  } catch (e) {
    return tz;
  }
}

export function sameZone(a, b) {
  return canonicalTimeZone(a) === canonicalTimeZone(b);
}

// Never throws, never lets one bad entry cost the whole list -- the same
// degrade-loudly contract parseBarConfig and parseStatusConfig already follow,
// and for the same reason: this is read at startup and a throw means no panel
// at all rather than one missing row.
export function parseClockConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { timezones: [...DEFAULT_TIMEZONES] };
  }
  if (raw.timezones === undefined) return { timezones: [...DEFAULT_TIMEZONES] };
  if (!Array.isArray(raw.timezones)) {
    console.error('bar.config.json: clock.timezones must be an array; using the default list');
    return { timezones: [...DEFAULT_TIMEZONES] };
  }
  const seen = new Set();
  const timezones = [];
  for (const tz of raw.timezones) {
    if (!isValidTimeZone(tz)) {
      console.error(`bar.config.json: unknown timezone '${tz}' in clock.timezones`);
      continue;
    }
    // Deduped by CANONICAL form, so listing both Asia/Ho_Chi_Minh and
    // Asia/Saigon yields one row, not two identical ones. The first spelling
    // wins, so the configured name is what gets displayed.
    const key = canonicalTimeZone(tz);
    if (seen.has(key)) continue;
    seen.add(key);
    timezones.push(tz);
  }
  return { timezones };
}

// Splits an instant into the calendar fields a given zone would show for it.
// `formatToParts` is used rather than string parsing because the part ORDER is
// locale-dependent and the separators are not stable.
//
// hourCycle 'h23' is load-bearing: without it, `hour12: false` renders midnight
// as hour "24" in en-US, which silently becomes the next day when fed back
// into Date.UTC. That is the classic off-by-one-day timezone bug.
function partsIn(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

// Minutes east of UTC for a zone AT A GIVEN INSTANT. Not a constant per zone:
// it changes across DST, which is exactly why every conversion below takes a
// reference instant rather than caching an offset.
export function zoneOffsetMinutes(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare against the instant truncated to the second, since the parts have
  // no sub-second component.
  const actual = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asIfUtc - actual) / 60000);
}

// "+07:00", "-04:30", "+00:00". Minutes, not hours, because plenty of zones
// are on :30 or :45 offsets (India, Nepal, Chatham) and rounding to hours
// would quietly mis-state them.
export function formatOffset(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// The trailing segment of an IANA id, tidied: "America/New_York" -> "New York".
// The full id is kept available separately for the tooltip -- it is precise but
// too long and too technical for a row label.
export function zoneLabel(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return '';
  const tail = timeZone.split('/').pop();
  return tail.replace(/_/g, ' ');
}

export function formatZoneTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function formatZoneDate(date, timeZone, { long = false } = {}) {
  return new Intl.DateTimeFormat('en-GB', long
    ? { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

// How many calendar days a zone is ahead of / behind the reference zone at a
// given instant -- the "+1" / "-1" a world clock needs so 23:00 Tuesday in one
// column and 07:00 Wednesday in another is not silently confusing.
export function dayOffset(date, timeZone, referenceZone) {
  const a = partsIn(date, timeZone);
  const b = partsIn(date, referenceZone);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((da - db) / 86400000);
}

// One row of the world clock.
export function zoneRow(date, timeZone, referenceZone) {
  if (!isValidTimeZone(timeZone)) return null;
  return {
    zone: timeZone,
    label: zoneLabel(timeZone),
    time: formatZoneTime(date, timeZone),
    date: formatZoneDate(date, timeZone),
    offset: formatOffset(zoneOffsetMinutes(date, timeZone)),
    dayOffset: referenceZone ? dayOffset(date, timeZone, referenceZone) : 0,
  };
}

export function zoneRows(date, timezones, referenceZone) {
  if (!Array.isArray(timezones)) return [];
  return timezones.map((tz) => zoneRow(date, tz, referenceZone)).filter(Boolean);
}

// --- the converter --------------------------------------------------------

// Turns a WALL-CLOCK reading in one zone into the UTC instant it refers to.
//
// This is the part that is genuinely easy to get wrong. There is no direct
// "parse this local time in that zone" API, so the instant is found by
// treating the fields as UTC, measuring how far off that guess is in the
// target zone, and correcting. The correction is applied TWICE because the
// offset itself depends on the instant: a first guess that lands on the other
// side of a DST boundary yields a different offset than the corrected instant
// does, and a single pass would be an hour out for readings near the change.
export function wallClockToInstant({ year, month, day, hour, minute }, timeZone) {
  if (!isValidTimeZone(timeZone)) return null;
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMinutes(new Date(guess), timeZone);
  let ts = guess - firstOffset * 60000;
  const secondOffset = zoneOffsetMinutes(new Date(ts), timeZone);
  if (secondOffset !== firstOffset) ts = guess - secondOffset * 60000;
  return new Date(ts);
}

// Parses the <input type="date"> / <input type="time"> pair the panel uses.
// Returns null rather than a partially-filled object, so a half-typed form
// cannot produce a confidently wrong answer.
export function parseDateTimeFields(dateStr, timeStr) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  const d = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!d || !t) return null;
  const fields = {
    year: Number(d[1]), month: Number(d[2]), day: Number(d[3]),
    hour: Number(t[1]), minute: Number(t[2]),
  };
  if (fields.month < 1 || fields.month > 12) return null;
  if (fields.day < 1 || fields.day > 31) return null;
  if (fields.hour > 23 || fields.minute > 59) return null;
  return fields;
}

// The whole conversion: a wall-clock reading in `fromZone` rendered in
// `toZone`. Returns null for anything unusable rather than guessing.
export function convertZones({ dateStr, timeStr, fromZone, toZone }) {
  const fields = parseDateTimeFields(dateStr, timeStr);
  if (!fields) return null;
  const instant = wallClockToInstant(fields, fromZone);
  if (!instant || !isValidTimeZone(toZone)) return null;

  const fromOffset = zoneOffsetMinutes(instant, fromZone);
  const toOffset = zoneOffsetMinutes(instant, toZone);
  return {
    instant,
    time: formatZoneTime(instant, toZone),
    date: formatZoneDate(instant, toZone),
    offset: formatOffset(toOffset),
    // Difference between the two zones at that instant, which is what people
    // actually want to know ("they're 12 hours ahead").
    differenceMinutes: toOffset - fromOffset,
    dayOffset: dayOffset(instant, toZone, fromZone),
  };
}

// "12h ahead", "5h 30m behind", "same time" -- the sentence a converter should
// lead with. Half-hour zones are why this is not just a division.
export function formatDifference(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes === 0) return 'same time';
  const ahead = minutes > 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return `${parts.join(' ')} ${ahead ? 'ahead' : 'behind'}`;
}

// The zone list offered by the converter's pickers.
//
// `Intl.supportedValuesOf('timeZone')` is the right source -- 418 zones here --
// but it returns only CANONICAL ids, and that is not the same set as "the ids
// people actually use". Checked live rather than assumed: the list contains
// neither `UTC` (canonicalised to `Etc/UTC`) nor `Asia/Ho_Chi_Minh`
// (canonicalised to `Asia/Saigon`) -- i.e. it would have omitted both the
// neutral reference and this machine's own zone, which are the two entries a
// converter is most likely to want.
//
// So the canonical list is a STARTING POINT that local, UTC and every
// configured zone are merged into, not the answer on its own. The merge also
// covers the fallback case where the API is missing entirely (it is a
// relatively recent addition), which is why it is unconditional.
export function availableTimeZones(configured = []) {
  // canonical id -> the spelling to OFFER for it. Later writes win, so the
  // user's own configured spelling replaces the canonical one: someone who
  // wrote Asia/Ho_Chi_Minh sees that, not Asia/Saigon.
  const byCanonical = new Map();
  const add = (tz) => {
    if (!isValidTimeZone(tz)) return;
    byCanonical.set(canonicalTimeZone(tz), tz);
  };
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      for (const tz of Intl.supportedValuesOf('timeZone')) add(tz);
    }
  } catch (e) { /* the merge below still yields a usable list */ }
  add('UTC');
  add(localTimeZone());
  for (const tz of configured) add(tz);
  return [...byCanonical.values()].sort();
}

// The spelling this list offers for a zone -- used to pre-select a picker,
// where setting select.value to an alias the list does not contain would
// silently leave nothing selected.
export function offeredSpelling(zones, tz) {
  const canonical = canonicalTimeZone(tz);
  return zones.find((z) => canonicalTimeZone(z) === canonical) ?? null;
}
