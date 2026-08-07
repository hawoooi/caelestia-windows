// Pure data shaping for the top hover dashboard. DOM-free and provider-free,
// so the parts with real edge cases -- month grids that straddle two months,
// leap years, weeks that start on Monday -- are assertable in
// tests/js/dashboardData.test.mjs instead of being eyeballed once and trusted.
//
// The panel itself (dashboard/dashboard.js) does the rendering and owns the
// providers; nothing here touches either.

// --- hover geometry -------------------------------------------------------

/**
 * Decides whether an observed `mouseleave` from the hot zone is a real
 * departure or a spurious one.
 *
 * This is not defensive padding -- it is load-bearing, and the live event log
 * shows why. 18ms after the trigger posts "open", the panel window opens ON
 * TOP of it, and the trigger receives a `mouseleave` with the pointer still
 * at y=12 inside its own 16px height. Treated as real, that leave would
 * close the panel in the same breath as opening it. A pointer reported ABOVE
 * or INSIDE a window whose top edge is the top of the screen has not left it;
 * only a departure downward, into the desktop, is real.
 *
 * @param {{y: number}} point - pointer position in the window's client space.
 * @param {number} height - the window's height in the same space.
 * @returns {boolean} true if the pointer genuinely left.
 */
export function isRealDeparture(point, height) {
  if (!point || !Number.isFinite(point.y)) return true;
  return point.y >= height;
}

// --- komorebi windows -----------------------------------------------------

// komorebi nests windows differently depending on the layout in force
// (containers of windows, plus separate floating/monocle/maximized slots), so
// a single path finds windows in some layouts and silently misses them in
// others. Collect from every shape rather than guessing which one is live.
export function collectWindows(workspace) {
  if (!workspace) return [];
  const found = [];
  for (const container of workspace.tilingContainers ?? []) {
    for (const w of container.windows ?? []) found.push(w);
  }
  for (const w of workspace.floatingWindows ?? []) found.push(w);
  if (workspace.monocleContainer?.windows) found.push(...workspace.monocleContainer.windows);
  if (workspace.maximizedWindow) found.push(workspace.maximizedWindow);
  return found;
}

// --- calendar -------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(monthIndex) {
  return MONTHS[monthIndex] ?? '';
}

// A 6x7 grid of the weeks around a date, Monday-first.
//
// Monday-first is not cosmetic here: JS getDay() is Sunday=0, so every index
// in this function is shifted, and getting it wrong silently offsets the whole
// month by a day -- the kind of bug that looks right in one month and wrong in
// the next. Six rows always, so the panel's height never changes as the user
// pages through months.
//
// Every cell carries which month it belongs to, so the caller can dim the
// leading and trailing days without recomputing anything.
export function calendarGrid(date) {
  const year = date.getFullYear();
  const month = date.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  // getDay(): Sun=0..Sat=6. Monday-first column index: Mon=0..Sun=6.
  const leading = (firstOfMonth.getDay() + 6) % 7;

  const start = new Date(year, month, 1 - leading);
  const today = new Date();
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
        isToday: isSameDay(cursor, today),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// --- formatting -----------------------------------------------------------

// "1h 23m", "3d 4h", "12m". Uptime arrives from the host provider in
// milliseconds. Days appear only once there are any, and seconds never do --
// a dashboard that reports uptime to the second is noise.
export function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// SI units, matching the disk provider's own siValue/siUnit convention and the
// network panel's rates, so one desktop does not quote GB in one place and GiB
// in another.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} kB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes < 1e12) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e12).toFixed(1)} TB`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

// mm:ss for track positions.
//
// The unit is SECONDS. That is not a guess and not the obvious answer: zebar
// documents no unit for MediaSession's startTime/endTime/position in either
// the zpack schema or the vendored bundle. It was pinned empirically against
// a live session in this repo's Task 8 -- {startTime: 0, endTime: 180,
// position: 49}, where 180 is only sensible as a 3-minute track -- and the
// finding is recorded at length in bar/entries/media.js. Do not "fix" this to
// milliseconds or 100ns ticks.
export function formatTrackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- the prompt line ------------------------------------------------------

// The signature element's content: the machine describing itself. Returns an
// ordered list of {key, value} pairs, with anything unavailable OMITTED rather
// than rendered as a blank or a dash -- a status line with holes in it reads
// as broken, and every field here can legitimately be missing (no weather
// provider, no network, a komorebi that has not reported yet).
export function promptFields(out, { hostname = null } = {}) {
  const fields = [];
  const push = (key, value) => { if (value !== null && value !== undefined && value !== '') fields.push({ key, value }); };

  const layout = out?.komorebi?.focusedWorkspace?.layout;
  push('komorebi', layout ? `[${layout}]` : null);

  push('up', formatUptime(out?.host?.uptime));

  const iface = out?.network?.defaultInterface;
  if (iface) {
    const mbps = Number(iface.transmitSpeed);
    // The provider reports an unknown link rate as u64::MAX, which arrives
    // here as an absurd float rather than null.
    if (Number.isFinite(mbps) && mbps > 0 && mbps < 1e12) push('net', `${Math.round(mbps / 1e6)} Mbps`);
  }

  const weather = out?.weather;
  if (weather && Number.isFinite(Number(weather.celsiusTemp))) {
    push('', `${Math.round(weather.celsiusTemp)}°C`);
  }

  return { hostname: hostname ?? out?.host?.hostname ?? null, fields };
}
