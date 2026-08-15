// Pure data shaping for the top hover dashboard. DOM-free and provider-free,
// so the parts with real edge cases are assertable in
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

// --- open-state recovery --------------------------------------------------

/**
 * Decides whether an open request should be honoured, given what the panel
 * BELIEVES its state to be and what the window actually is.
 *
 * `isOpen` is a belief, and beliefs desync from reality. The specific way it
 * happened here: `open()` sets isOpen = true and then awaits two window
 * geometry calls; if either rejects, the function dies with the flag left
 * claiming the panel is up. Every later hover then returned early and the top
 * hover was dead for the rest of the session -- while the dock, which never
 * resizes its window and so has no call that can fail, kept working. That
 * asymmetry is exactly how it was reported: "sometime the hover break
 * specifically the top bar the taskbar is still normal".
 *
 * So the flag is checked against the one thing that cannot lie: the window's
 * own width. Parked is 1px; open is the panel's width. If the flag says open
 * and the window says parked, the flag is wrong.
 *
 * @param {{isOpen: boolean, fullscreen: boolean, innerWidth: number, parkedWidth: number}} state
 * @returns {boolean} true if open() should proceed.
 */
export function shouldOpen({ isOpen, fullscreen, innerWidth, parkedWidth }) {
  if (fullscreen) return false;
  if (!isOpen) return true;
  // Believed open. Honour that only if the window agrees.
  if (!Number.isFinite(innerWidth)) return false;
  return innerWidth <= parkedWidth;
}
