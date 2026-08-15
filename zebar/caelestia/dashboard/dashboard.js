// The top hover dashboard: four panes (Dashboard, Media, Performance,
// Workspaces) hanging from the top edge of the screen.
//
// **ONE WINDOW, which owns both the hot zone and the panel.**
//
// Closed, this window is a 16px strip across the top centre. Hovering it
// grows it downward to the full panel; leaving shrinks it back. The width
// and the top-left corner never change -- only the height.
//
// That is the dock's design (dock/dock.js). It replaced a two-window
// arrangement -- a separate `dashtrigger` widget owning the hot zone and
// messaging this one over widget-channel.js -- which failed in a way worth
// recording, because it looked reasonable and was not:
//
//   Both windows were `top_most` and both covered the same 16px strip, and
//   Windows gives NO ordering guarantee between two top_most windows. When
//   the trigger won hit-testing, this window received no `mouseenter` at
//   all -- so nothing held the panel open, and any stray event closed it.
//   The event log showed it plainly: opens with no `panel enter` following.
//   Reported as "the top bar hover still sometimes doesn't work", with the
//   dock -- one window since the day it was written -- never affected.
//
// One window cannot lose a handoff it does not make. The pointer that
// triggers the open is already inside the element that keeps it open.
//
// **Why a resize is safe here when it broke the dock.** The dock's original
// oscillation came from a resize that changed the window's geometry RELATIVE
// TO THE POINTER, so the cursor fell outside and hover collapsed. This window
// grows downward from a fixed top-left corner at a fixed width, so a pointer
// resting in the top 16px is inside it in BOTH states -- there is nothing for
// the resize to invalidate. The close path additionally verifies `:hover`
// before acting on any `mouseleave`, because this window HAS been observed
// reporting pointer positions outside its own bounds.
//
// The frame's top band (edges/edges.js) still posts an open over the channel,
// because it is `top_most` too and can win hit-testing over the strip's upper
// 8px. It only ever opens; this window owns closing.

import * as zebar from '../bar/vendor/zebar.js';
import { createChannel, DASH_CMD_KEY, DASH_ACK_KEY } from '../widget-channel.js';
// Deliberately NOT importing fullscreen.js: this widget does not poll for
// fullscreen. The trigger polls once and broadcasts the answer -- see the
// channel subscriber in init().
import { focusWorkspaceCommand } from '../komorebi-commands.js';
import { createNetStats, formatRate } from '../net-stats.js';
import { createGpuStats } from '../gpu-stats.js';
import { createMediaArt } from '../media-art.js';
// The panel's width is shared with the hot zones that open it -- they must
// match exactly, so one constant owns it.
import { PANEL_W } from '../dash-hotzone.js';
import {
  formatUptime,
  formatBytes,
  formatPercent,
  formatTrackTime,
  promptFields,
  collectWindows,
  shouldOpen,
} from '../dashboard-data.js';

// --- geometry -------------------------------------------------------------

// The panel's size. Fixed rather than measured: the panes have different
// natural heights, so measuring would resize the window on every tab switch
// -- which is exactly the geometry change that breaks hover.
//
// So the WINDOW is sized once, to the tallest pane, and the PANEL inside it
// is content-height (the stage aligns it to flex-start). Switching to a
// shorter tab shrinks the visible panel without touching the window at all;
// the leftover window area is transparent.
//
// **Measure this at the real width, never while parked.** The window sits at
// 1x1 when closed, and measuring there reports the layout wrapped to one pixel
// -- the prompt line alone came back as 195px tall instead of 36px, which sent
// this number the wrong way entirely. Open the panel, hold the cursor on the
// trigger, and measure then.
//
// Measured that way after the v2 sparkline pass: dashboard 481px (still the
// tallest by far), tabs and prompt included. 500 leaves slack for a two-line
// track title and for the Now Playing tile expanding out of its idle state.
//
// Every pixel of window BELOW the panel is a transparent but click-dead strip
// over the user's desktop, so this is kept close to the real height rather
// than padded generously. An earlier 470 clipped the quick actions; 520 left
// 99px of dead zone. If a pane grows, this number moves with it.
export { PANEL_W };
export const PANEL_H = 500;

// The window's CLOSED height: just the hot-zone strip. Same 16px the separate
// trigger widget used to occupy, so this costs no dead space that was not
// already spent -- 8px under the frame's top band, 8px in the wallpaper gap,
// and komorebi's windows start at y=21.
export const STRIP_H = 16;

// The inverse-arc fillets either side of the panel's top corners, so the panel
// reads as carved out of the frame's top band rather than pasted over it --
// the same concave corner the four screen corners use, and the same radius.
//
// They have to be painted OUTSIDE the panel's own box, so the window is wider
// than the panel by this much on each side. The panel stays PANEL_W; only the
// window grows.
export const ARCH_W = 16;
export const WINDOW_W = PANEL_W + ARCH_W * 2;

// How long the pointer may be over neither surface before the panel closes.
// Long enough to cross the seam between the trigger and the panel without
// losing it; short enough that a deliberate exit feels immediate.
export const CLOSE_DELAY_MS = 260;

// How long the pointer must rest in the strip before the panel opens. The top
// edge is on the path to every tab and title bar, so opening on contact would
// be an ambush.
export const OPEN_DELAY_MS = 220;

// --- providers ------------------------------------------------------------

// Owned by this widget, not shared with the bar: each Zebar widget is its own
// document, so there is nothing to share. The bar polls its own copies.
const providers = zebar.createProviderGroup({
  date: { type: 'date', formatting: 'EEE d MMM yyyy' },
  komorebi: { type: 'komorebi' },
  host: { type: 'host' },
  cpu: { type: 'cpu' },
  memory: { type: 'memory' },
  disk: { type: 'disk' },
  network: { type: 'network' },
  audio: { type: 'audio' },
  media: { type: 'media' },
  weather: { type: 'weather' },
});

const $ = (id) => document.getElementById(id);

// Why this log exists rather than being
// debug leftovers: hover faults here are timing-dependent and invisible, and
// the dock's identical log is the only thing that ever diagnosed one.
const EVENT_LOG_MAX = 60;
window.__dashEvents = [];
function logEvent(what, detail) {
  window.__dashEvents.push(`${new Date().toISOString().slice(11, 23)} ${what}${detail ? ' ' + detail : ''}`);
  if (window.__dashEvents.length > EVENT_LOG_MAX) window.__dashEvents.shift();
}

let out = {};
let isOpen = false;

// Two shell-backed helpers behind the System tile, plus album art.
//
// **These keep sampling while the panel is closed, at a slower cadence.**
//
// Direct user request: "The menu takes a while to load when opened, is it
// possible to keep the stats running even when it is not active to show more
// immediately". It was: the tile went up showing "--" for GPU and for both
// network rates, and only filled in a second later.
//
// The delay was not process startup, which is ~100ms. It is that a RATE cannot
// be measured from one reading. net-stats.exe reports cumulative byte
// counters, so throughput is the difference between two samples -- with no
// previous sample there is nothing to subtract, and the first render after
// opening had no rate to show by definition. Stopping the poll on close threw
// that baseline away every single time, guaranteeing the blank second on every
// open. CPU, RAM, disk and the clock never had this problem because they come
// from zebar providers that emit continuously regardless of this panel.
//
// So the poll never stops now, it changes GEAR: every second while open,
// every five while closed. And it keeps RENDERING while closed, which is the
// other half -- the DOM is already correct before the window is ever sized, so
// there is nothing to fill in.
//
// On the cost, which is the reason it was open-only to begin with: each sample
// is two process spawns, and a helper that outlives its parent zebar inherits
// zebar's listening socket on port 6124, after which every later start binds
// nothing and the whole desktop paints blank. That risk is real and this pack
// has lost two sessions to it. But it is not avoided by this timer: the same
// fullscreen-detect.exe is already polled once a second by the bar, all four
// corners, all three edges and the dock. Against that, 0.4
// spawns a second while idle is not a new class of cost, and the mitigations
// that actually matter are the in-flight guard in each helper and the reap in
// Restart-ZebarWidgets, both of which are already in place.
const shell = zebar.shellExec ? zebar : null;
const netStats = createNetStats(shell);
const gpuStats = createGpuStats(shell);
const mediaArt = createMediaArt(shell);

// Open: fast enough that a download visibly moves the number.
//
// Closed: as rare as it can be while still doing its one job. **This was 5s
// and is now 15s, and the idle sample no longer touches the GPU at all** --
// see sampleSystem. Together that is one spawn per 15s instead of two per 5s,
// a six-fold cut.
//
// The reason is a crash, and the honest version of it is: zebar.exe faulted
// once (0xc0000409, a CRT fail-fast in ucrtbase.dll) nine minutes after this
// background poll first went live, and that is the ONLY zebar fault in this
// machine's entire Application event log. That is a correlation, not a proven
// cause -- but "the one time it ever crashed was minutes after I made it spawn
// two processes every five seconds forever" is not a coincidence worth
// assuming. The spawn rate came down accordingly, without giving up what the
// warm poll is for.
const SYSTEM_POLL_OPEN_MS = 1000;
const SYSTEM_POLL_IDLE_MS = 15000;

let systemTimer = null;
let systemCadence = null;

async function sampleSystem() {
  // While closed, ONLY the network is sampled. That is not a compromise -- it
  // is the only reading that actually needs to be kept warm.
  //
  // A rate is the difference between two counter readings, so without a
  // previous sample there is no rate to show at all; that is the entire cause
  // of the blank second this poll exists to remove. The GPU has no such
  // problem: it is a single-shot read that returns in ~100ms, and the panel
  // takes ~380ms to open (220ms dwell, then the slide), so a sample fired the
  // moment the open message arrives has already landed by the time anyone can
  // see the tile. Sampling it every 15s while nobody is looking bought
  // nothing and cost a process spawn each time.
  const full = isOpen;
  const [net, gpu] = await Promise.all([
    netStats.sample(),
    full ? gpuStats.sample() : Promise.resolve(null),
  ]);
  if (net) latestNet = net;
  if (gpu) latestGpu = gpu;
  recordHistory();
  // Rendered even while closed. This is what makes the panel correct the
  // moment it appears rather than a moment after.
  renderSystem();
}

// Switches cadence without dropping the baseline. Deliberately NOT a
// stop/start pair: netStats.reset() would discard the previous sample, which
// is the very thing being kept warm.
function setSystemPoll(intervalMs) {
  if (systemCadence === intervalMs && systemTimer !== null) return;
  systemCadence = intervalMs;
  if (systemTimer !== null) clearInterval(systemTimer);
  sampleSystem();
  systemTimer = setInterval(sampleSystem, intervalMs);
}

// --- rendering: the dashboard pane ---------------------------------------

function renderPrompt() {
  const el = $('prompt');
  if (!el) return;
  const { hostname, fields } = promptFields(out);
  el.textContent = '';

  const span = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };

  if (hostname) el.appendChild(span('prompt__host', hostname));
  for (const f of fields) {
    if (el.childNodes.length) el.appendChild(span('prompt__sep', '~'));
    if (f.key) el.appendChild(span('prompt__k', f.key));
    el.appendChild(span('prompt__v', f.value));
  }
}

function renderClock() {
  const now = out.date?.now ? new Date(out.date.now) : new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const clock = $('clock');
  if (clock) {
    // Rebuild only the text node, leaving the seconds span in place, so the
    // element is not recreated 60 times a minute.
    clock.firstChild.nodeValue = `${hh}:${mm}`;
    $('clockSecs').textContent = `:${ss}`;
  }
  const date = $('clockDate');
  if (date) date.textContent = out.date?.formatted ?? '';
}

// The System tile: CPU / GPU / RAM / DISK load, and live network throughput.
//
// Direct user feedback that shaped it: "try to incorperate wifi up/down speed
// and cpu/gpu/ram into the dashboard instead if sound volume and those
// meaningless bars". Volume went because it already lives in the bar's own
// pill and panel, and it is not a machine-load reading like the others.
//
// The bars went too, in the v2 pass. A full-width bar spends its whole width
// restating the numeral beside it; a sparkline spends the same width on the
// one thing the numeral cannot say -- whether this reading is a spike or a
// plateau. Drawing it is only honest because the panel samples continuously in
// the background now (see setSystemPoll) rather than starting from nothing on
// every open.
//
// Rates keep numbers rather than bars for a different reason: throughput has
// no ceiling, so a bar has no scale to be a fraction OF.
let latestNet = null;   // { rates: { down, up } } from net-stats.exe
let latestGpu = null;   // { usage, temperature, usedBytes, totalBytes }

// How many samples the sparklines show. The cadence behind them is not
// constant -- 1s while the panel is open, 5s while closed -- so this is "the
// last 60 readings", not a fixed span of time. That is a deliberate trade: a
// fixed span would mean either polling fast while closed (which is the cost
// this design avoids) or throwing away the idle history entirely (which is the
// blank-on-open problem it was built to fix).
const HISTORY = 60;

const history = { cpu: [], gpu: [], ram: [], disk: [], down: [], up: [] };

function pushHistory(key, value) {
  const series = history[key];
  if (!series) return;
  // A missing reading holds the previous value rather than dropping to zero: a
  // failed nvidia-smi call is not the GPU going idle, and drawing it as a
  // cliff would be a lie.
  const v = Number.isFinite(value) ? value : (series.length ? series[series.length - 1] : 0);
  series.push(v);
  while (series.length > HISTORY) series.shift();
}

// Records one sample of everything the sparklines draw. Called from
// sampleSystem so all six series share a timeline, whatever the cadence.
function recordHistory() {
  pushHistory('cpu', out.cpu?.usage);
  pushHistory('gpu', latestGpu ? latestGpu.usage : undefined);
  pushHistory('ram', out.memory?.usage);
  const disk = primaryDisk();
  pushHistory('disk', disk && Number.isFinite(disk.totalSpace?.bytes) && Number.isFinite(disk.availableSpace?.bytes)
    ? (1 - disk.availableSpace.bytes / disk.totalSpace.bytes) * 100
    : undefined);
  pushHistory('down', latestNet?.rates ? latestNet.rates.down : undefined);
  pushHistory('up', latestNet?.rates ? latestNet.rates.up : undefined);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds a sparkline as an <svg> element.
 *
 * Drawn in a 100x26 viewBox with preserveAspectRatio="none", so it stretches
 * to whatever width the grid column ends up being without the caller needing
 * to measure anything -- which matters because this panel must never measure
 * its own layout at open time (the window is 1x1 until then, and measuring
 * there reports everything wrapped to one pixel).
 */
function sparkline(values, { max = 100 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 26');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  if (!values || values.length < 2) return svg;

  const ceiling = max > 0 ? max : 1;
  const n = values.length;
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 26 - Math.max(0, Math.min(1, v / ceiling)) * 24 - 1;

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');

  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('class', 'spark__area');
  area.setAttribute('d', `${d} L100,26 L0,26 Z`);

  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('class', 'spark__line');
  line.setAttribute('d', d);

  svg.append(area, line);
  return svg;
}

// The disk provider PRE-CONVERTS its sizes and exposes siValue/siUnit.
// Recomputing from `bytes` is the documented trap here -- it produced figures
// that disagreed with every other disk readout on the desktop.
function primaryDisk() {
  const disks = out.disk?.disks;
  if (!Array.isArray(disks) || !disks.length) return null;
  return disks.find((d) => /^C:/i.test(d.mountPoint ?? '')) ?? disks[0];
}

function gpuDetail() {
  if (!latestGpu) return null;
  const bits = [];
  if (Number.isFinite(latestGpu.temperature)) bits.push(`${Math.round(latestGpu.temperature)}\u00B0C`);
  if (Number.isFinite(latestGpu.usedBytes) && Number.isFinite(latestGpu.totalBytes)) {
    bits.push(`${formatBytes(latestGpu.usedBytes)} of ${formatBytes(latestGpu.totalBytes)}`);
  }
  return bits.length ? bits.join('  \u00B7  ') : null;
}

function renderSystem() {
  const host = $('metrics');
  if (host) {
    const disk = primaryDisk();
    const diskUsed = disk && Number.isFinite(disk.totalSpace?.bytes) && Number.isFinite(disk.availableSpace?.bytes)
      ? (1 - disk.availableSpace.bytes / disk.totalSpace.bytes) * 100
      : null;

    const rows = [
      {
        key: 'CPU', series: 'cpu', value: out.cpu?.usage,
        // NOT frequency. Read live over CDP, zebar's cpu provider reports
        // { frequency: 0, vendor: '' } on this machine, so a GHz figure
        // renders a confident "0.0 GHz". Core counts come back populated.
        detail: out.cpu ? `${out.cpu.physicalCoreCount} cores  \u00B7  ${out.cpu.logicalCoreCount} threads` : null,
      },
      {
        key: 'GPU', series: 'gpu', value: latestGpu ? latestGpu.usage : null,
        // Absent, not zero, where nvidia-smi is missing -- gpu-stats.js
        // explains why this is NVIDIA-only on purpose.
        absent: !gpuStats.available,
        detail: gpuDetail(),
      },
      {
        key: 'RAM', series: 'ram', value: out.memory?.usage,
        detail: out.memory
          ? `${formatBytes(out.memory.usedMemory) ?? '--'} of ${formatBytes(out.memory.totalMemory) ?? '--'}`
          : null,
      },
      {
        key: 'DISK', series: 'disk', value: diskUsed, absent: !disk,
        detail: disk ? `${Math.round(disk.availableSpace?.siValue ?? 0)}${disk.availableSpace?.siUnit ?? ''} free` : null,
      },
    ].filter((r) => !r.absent);

    // The one accent on this pane, and it is earned rather than pinned to a
    // fixed row: it follows whichever metric is currently busiest.
    let hottest = null;
    for (const r of rows) {
      if (Number.isFinite(r.value) && (!hottest || r.value > hottest.value)) hottest = r;
    }

    host.textContent = '';
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = row === hottest ? 'metric is-hot' : 'metric';

      const k = document.createElement('div');
      k.className = 'metric__k';
      k.textContent = row.key;

      const v = document.createElement('div');
      v.className = 'metric__v';
      if (Number.isFinite(row.value)) {
        v.textContent = String(Math.round(row.value));
        const u = document.createElement('small');
        u.textContent = '%';
        v.appendChild(u);
      } else {
        v.textContent = '--';
      }

      const spark = document.createElement('div');
      spark.className = 'metric__spark';
      spark.appendChild(sparkline(history[row.series]));

      el.append(k, v, spark);
      if (row.detail) {
        const d = document.createElement('div');
        d.className = 'metric__detail';
        d.textContent = row.detail;
        el.appendChild(d);
      }
      host.appendChild(el);
    }
  }

  // Network. Both directions are scaled to the same ceiling as each other's
  // own peak rather than a shared one -- upload is routinely two orders of
  // magnitude smaller than download, and a shared scale would flatten it to a
  // dead line along the bottom.
  setRate($('netDown'), latestNet?.rates ? latestNet.rates.down : null);
  setRate($('netUp'), latestNet?.rates ? latestNet.rates.up : null);
  drawNetSpark($('netDownSpark'), history.down);
  drawNetSpark($('netUpSpark'), history.up);
}

function drawNetSpark(el, series) {
  if (!el) return;
  el.textContent = '';
  const peak = series.length ? Math.max(...series) : 0;
  el.appendChild(sparkline(series, { max: peak * 1.15 }));
}

function setRate(el, bytesPerSecond) {
  if (!el) return;
  const text = formatRate(bytesPerSecond);
  el.textContent = '';
  if (!text || text === '--') { el.textContent = '--'; return; }
  // "4.6 kB/s" -> number + unit, so the unit can be dimmed and shrunk without
  // the numeral reflowing.
  const space = text.indexOf(' ');
  if (space === -1) { el.textContent = text; return; }
  el.appendChild(document.createTextNode(text.slice(0, space)));
  const u = document.createElement('small');
  u.textContent = text.slice(space + 1);
  el.appendChild(u);
}

// --- rendering: media -----------------------------------------------------

const PLAY_GLYPH = '\uF04B';
const PAUSE_GLYPH = '\uF04C';

function renderMedia() {
  const s = out.media?.currentSession;
  const title = s?.title ?? '';
  const artist = s?.artist ?? '';
  const album = s?.albumTitle ?? '';
  const playing = Boolean(s?.isPlaying);

  const pos = Number(s?.position);
  const end = Number(s?.endTime);
  const pct = Number.isFinite(pos) && Number.isFinite(end) && end > 0
    ? Math.max(0, Math.min(100, (pos / end) * 100))
    : 0;

  applyArt(title, artist);

  // Silence should not cost a whole column: idle collapses the art to a chip
  // and hides the scrubber, per the v2 design.
  const npTile = $('npTile');
  if (npTile) npTile.classList.toggle('is-idle', !s || !title);

  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const width = (id) => { const el = $(id); if (el) el.style.width = `${pct}%`; };

  // The compact tile on the Dashboard pane...
  set('npTitle', title || 'Nothing playing');
  set('npArtist', artist);
  set('npPos', formatTrackTime(pos));
  set('npDur', formatTrackTime(end));
  width('npFill');

  // ...and the full Media pane.
  set('mediaTitle', title || 'Nothing playing');
  set('mediaAlbum', album);
  set('mediaArtist', artist);
  set('mediaPos', formatTrackTime(pos));
  set('mediaDur', formatTrackTime(end));
  width('mediaFill');
  set('mediaSource', s?.sourceAppName ?? '');

  for (const id of ['npToggle', 'mediaToggle']) {
    const btn = $(id);
    if (!btn) continue;
    const icon = btn.querySelector('i');
    if (icon) icon.textContent = playing ? PAUSE_GLYPH : PLAY_GLYPH;
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    btn.disabled = !s;
  }
}

// Album art, from tools/media-art.exe -- zebar's media provider has no
// artwork field at all (verified against the vendored bundle), which is why a
// helper exists. Direct user report: "it still can't fetch the current playing
// media image (this was possible in my previous yasb bar)".
//
// The cache read is synchronous and happens on every render; the fetch happens
// at most once per track. Both art elements are driven together so the compact
// tile and the Media pane never disagree.
function applyArt(title, artist) {
  if (!title) { showArt(null); return; }

  const cached = mediaArt.cached(title, artist);
  if (cached !== undefined) { showArt(cached); return; }

  // Not asked yet. Show nothing while it is in flight rather than leaving the
  // PREVIOUS track's cover up, which would be confidently wrong.
  showArt(null);
  mediaArt.fetch(title, artist).then((url) => {
    // The song may have changed while this was in flight. Re-read the current
    // track rather than trusting the closure.
    const now = out.media?.currentSession;
    if (!now || now.title !== title) return;
    if (url) showArt(url);
  }).catch(() => { /* fail soft: keep the placeholder */ });
}

function showArt(dataUrl) {
  for (const id of ['npArt', 'mediaArt']) {
    const el = $(id);
    if (!el) continue;
    if (dataUrl) {
      el.classList.remove('art--empty');
      el.style.backgroundImage = `url("${dataUrl}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else if (!el.classList.contains('art--empty')) {
      el.classList.add('art--empty');
      el.style.backgroundImage = '';
      const i = document.createElement('i');
      i.className = 'fa-solid';
      i.textContent = '\uF001';
      el.replaceChildren(i);
    }
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-media]');
  if (!btn) return;
  const m = out.media;
  if (!m) return;
  if (btn.dataset.media === 'toggle') m.togglePlayPause?.();
  else if (btn.dataset.media === 'next') m.next?.();
  else if (btn.dataset.media === 'prev') m.previous?.();
});

// --- rendering: performance ----------------------------------------------

// A ring, drawn as an SVG arc. r=74 in a 168 viewBox gives a circumference of
// 2*pi*74 = 465, which is the dasharray the mockup fixed; the offset is the
// unfilled remainder.
const RING_CIRCUMFERENCE = 465;

function gaugeTile(label, { value, display, unit, footKey, footValue }) {
  const tile = document.createElement('div');
  tile.className = 'tile perf__tile';

  const gauge = document.createElement('div');
  gauge.className = 'gauge';
  gauge.innerHTML = `<svg viewBox="0 0 168 168" aria-hidden="true">
      <circle class="gauge__bg"  cx="84" cy="84" r="74"></circle>
      <circle class="gauge__val" cx="84" cy="84" r="74"
              stroke-dasharray="${RING_CIRCUMFERENCE}"
              stroke-dashoffset="${Math.round(RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, value ?? 0))))}"></circle>
    </svg>`;

  const num = document.createElement('div');
  num.className = 'gauge__num';
  num.textContent = display;
  if (unit) {
    const u = document.createElement('span');
    u.style.fontSize = '16px';
    u.textContent = unit;
    num.appendChild(u);
  }
  gauge.appendChild(num);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'perf__body';
  const lab = document.createElement('div');
  lab.className = 'label';
  lab.textContent = label;
  const foot = document.createElement('div');
  foot.className = 'perf__foot';
  const k = document.createElement('span');
  k.textContent = footKey;
  const v = document.createElement('b');
  v.textContent = footValue;
  foot.append(k, v);
  bodyEl.append(lab, foot);

  tile.append(gauge, bodyEl);
  return tile;
}

function statTile(value, unit, key) {
  const tile = document.createElement('div');
  tile.className = 'tile stat';
  const v = document.createElement('div');
  v.className = 'stat__v';
  v.textContent = value;
  if (unit) {
    const u = document.createElement('span');
    u.style.fontSize = '13px';
    u.textContent = unit;
    v.appendChild(u);
  }
  const k = document.createElement('div');
  k.className = 'stat__k';
  k.textContent = key;
  tile.append(v, k);
  return tile;
}


function renderPerformance() {
  const pane = $('perfPane');
  const strip = $('perfStrip');
  if (!pane || !strip) return;

  const cpuUsage = out.cpu?.usage;
  const memUsage = out.memory?.usage;
  const disk = primaryDisk();

  pane.textContent = '';

  // No GPU provider exists on this build of zebar, so the mockup's GPU ring
  // becomes a CPU-frequency ring rather than a fabricated reading. A gauge
  // showing a number nobody measured is worse than one fewer gauge.
  pane.appendChild(gaugeTile('CPU', {
    value: Number.isFinite(cpuUsage) ? cpuUsage / 100 : 0,
    display: formatPercent(cpuUsage) ?? '--',
    footKey: 'Cores',
    footValue: out.cpu?.physicalCoreCount != null ? String(out.cpu.physicalCoreCount) : '--',
  }));

  pane.appendChild(gaugeTile('Memory', {
    value: Number.isFinite(memUsage) ? memUsage / 100 : 0,
    display: formatPercent(memUsage) ?? '--',
    footKey: 'In use',
    footValue: formatBytes(out.memory?.usedMemory) ?? '--',
  }));

  const diskUsed = disk && Number.isFinite(disk.totalSpace?.bytes) && Number.isFinite(disk.availableSpace?.bytes)
    ? 1 - disk.availableSpace.bytes / disk.totalSpace.bytes
    : 0;
  pane.appendChild(gaugeTile('Storage', {
    value: diskUsed,
    display: formatPercent(diskUsed * 100) ?? '--',
    footKey: 'Free',
    footValue: disk ? `${Math.round(disk.availableSpace?.siValue ?? 0)}${disk.availableSpace?.siUnit ?? ''}` : '--',
  }));

  strip.textContent = '';
  const iface = out.network?.defaultInterface;
  // Same reason as the dashboard pane: this provider's frequency reads 0.
  strip.appendChild(statTile(
    out.cpu?.logicalCoreCount != null ? String(out.cpu.logicalCoreCount) : '--', '', 'CPU threads'));
  strip.appendChild(statTile(
    formatBytes(out.memory?.totalMemory) ?? '--', '', 'Memory total'));
  strip.appendChild(statTile(
    iface?.transmitSpeed && iface.transmitSpeed < 1e12
      ? String(Math.round(iface.transmitSpeed / 1e6)) : '--', 'Mbps', 'Link rate'));
  strip.appendChild(statTile(formatUptime(out.host?.uptime) ?? '--', '', 'Uptime'));
}

// --- rendering: workspaces ------------------------------------------------

function renderWorkspaces() {
  const pane = $('wsPane');
  if (!pane) return;

  // `currentWorkspaces` is the provider's own list for the monitor this
  // widget is on -- the same field the bar's workspace buttons use, so the
  // two agree by construction. There is no `focusedMonitorIndex` on this
  // provider; indexing allMonitors by one silently yields undefined.
  const workspaces = out.komorebi?.currentWorkspaces ?? [];
  const focusedName = out.komorebi?.focusedWorkspace?.name;

  pane.textContent = '';
  if (!workspaces.length) {
    const none = document.createElement('div');
    none.className = 'tile__none';
    none.textContent = 'komorebi has not reported yet';
    pane.appendChild(none);
    return;
  }

  workspaces.forEach((ws, i) => {
    const cell = document.createElement('button');
    cell.className = 'ws__cell';
    if (ws.name === focusedName) cell.setAttribute('data-focused', '');
    cell.dataset.wsIndex = String(i);

    const n = document.createElement('span');
    n.className = 'ws__n';
    // The workspace's own name if it has one, else its 1-based index zero-
    // padded -- komorebi numbers from 0 internally but every keybind in
    // ~/.config/whkdrc is 1-based, so showing the internal index would
    // disagree with the key the user actually presses.
    n.textContent = ws.name ?? String(i + 1).padStart(2, '0');

    const windows = collectWindows(ws);
    if (!windows.length) {
      const empty = document.createElement('span');
      empty.className = 'ws__empty';
      empty.textContent = 'Empty';
      cell.append(n, empty);
    } else {
      const apps = document.createElement('span');
      apps.className = 'ws__apps';
      for (const w of windows.slice(0, 8)) {
        const chip = document.createElement('span');
        chip.className = 'ws__app';
        chip.title = w.title ?? w.exe ?? '';
        // One letter, from the executable, matching the mockup's density.
        chip.textContent = (w.exe ?? '?').replace(/\.exe$/i, '').charAt(0).toUpperCase();
        apps.appendChild(chip);
      }
      cell.append(n, apps);
    }

    pane.appendChild(cell);
  });
}

$('wsPane')?.addEventListener('click', (e) => {
  const cell = e.target.closest?.('.ws__cell');
  if (!cell) return;
  const idx = Number(cell.dataset.wsIndex);
  if (!Number.isInteger(idx)) return;
  // The komorebi provider is READ-ONLY -- it exposes no focus method, unlike
  // the glazewm one. So this shells out, using the exact command builder the
  // bar's own workspace buttons use: `focus-workspace` takes a zero-indexed
  // POSITION, never the displayed name (the two only look alike because this
  // config happens to name workspaces after their position).
  const cmd = focusWorkspaceCommand(idx);
  try {
    zebar.shellExec(cmd.program, cmd.args);
  } catch (err) {
    console.error('dashboard: could not focus workspace', idx, err);
  }
});

// --- quick actions --------------------------------------------------------

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const REPO = 'C:\\Users\\PC\\Documents\\git\\setup';

// Each action is one exact command line. They are matched by an argsRegex in
// zpack.json that admits these strings and nothing else, so this list and
// that regex are a matched pair -- adding an action here without widening the
// regex fails at runtime with a privilege error, which is the safe direction.
// The first three call the SAME hotkey entry points ~/.config/whkdrc binds to
// alt+w and ctrl+alt+w, rather than the underlying scripts: those files exist
// precisely so a caller does not have to know that Switch-Wallpaper.ps1 must
// be dot-sourced and then invoked. Pressing the key and clicking the button
// now run byte-identical commands.
const ACTIONS = {
  wallpaper: { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-next-wallpaper.ps1`] },
  retheme:   { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-retheme.ps1`] },
  reload:    { program: PS, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\hotkey-reload-widgets.ps1`] },
  lock:      { program: 'C:\\Windows\\System32\\rundll32.exe', args: ['user32.dll,LockWorkStation'] },
  sleep:     { program: 'C:\\Windows\\System32\\rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] },
  power:     { program: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '0'] },
};

// The three that cannot be undone need a second click. `confirm()` is not an
// option: a modal dialog steals focus from this window, which closes the
// panel underneath it. So the button arms itself and disarms on a timeout.
const DESTRUCTIVE = new Set(['lock', 'sleep', 'power']);
const ARM_MS = 3000;
let armed = null;
let armTimer = null;

function disarm() {
  if (armTimer) clearTimeout(armTimer);
  armTimer = null;
  if (armed) armed.classList.remove('is-arming');
  armed = null;
}

$('acts')?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.act');
  if (!btn) return;
  const action = ACTIONS[btn.dataset.act];
  if (!action) return;

  if (DESTRUCTIVE.has(btn.dataset.act) && armed !== btn) {
    disarm();
    armed = btn;
    btn.classList.add('is-arming');
    armTimer = setTimeout(disarm, ARM_MS);
    return;
  }
  disarm();

  try {
    zebar.shellExec(action.program, action.args);
  } catch (err) {
    console.error('quick action failed', btn.dataset.act, err);
  }
});

// --- tabs -----------------------------------------------------------------

const tabs = [...document.querySelectorAll('.tab')];
const panes = [...document.querySelectorAll('.pane')];

function showPane(name) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of panes) {
    if (p.dataset.pane === name) p.setAttribute('data-active', '');
    else p.removeAttribute('data-active');
  }
}
for (const t of tabs) t.addEventListener('click', () => showPane(t.dataset.tab));

// --- open / close ---------------------------------------------------------

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  // This instance's own monitor, read from the window's STARTING position --
  // before anything below moves it. The preset places this widget at
  // top_left (0,0) with monitorSelection `all`, so each instance starts at
  // its own monitor's origin. The preset and this line are a matched pair:
  // changing the preset's anchor silently breaks multi-monitor placement
  // rather than the visible layout. (layoutmenu/menu.js documents the two
  // better-looking APIs that do not exist on zebar 3.3.1.)
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('dashboard: could not read starting position', e);
  }
  const monitor = { x: origin.x, y: origin.y, width: window.screen.width };

  // The window is never MOVED and never changes width. Closed it is the strip;
  // open it is the panel. Only the height changes, downward, from a fixed
  // top-left corner.
  //
  // That matters more than it looks. The dock's original oscillation came from
  // a resize that changed where the window was relative to the pointer, so the
  // cursor fell outside and hover collapsed. Here a pointer resting in the top
  // 16px is inside the window in BOTH states, so growing the panel cannot move
  // it out -- there is nothing for the resize to invalidate.
  async function setWindowHeight(height) {
    await win.setSize({ type: 'Physical', width: WINDOW_W, height });
  }

  // Place it once, at the panel's final x, and never touch position again.
  // Centre the WINDOW, so the panel inside it lands centred on the monitor
  // with its arches spilling into the margins either side.
  const left = monitor.x + Math.round((monitor.width - WINDOW_W) / 2);
  try {
    await win.setPosition({ type: 'Physical', x: left, y: monitor.y });
    await setWindowHeight(STRIP_H);
  } catch (e) {
    console.error('dashboard: could not place the window', e);
  }

  // Measuring before the vendored Font Awesome webfont has settled would size
  // the panel against fallback glyph metrics.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* proceed anyway */ }
  }

  // The panel is a fixed height regardless of the window, so the closed
  // transform always hides it completely -- a percentage transform against a
  // 16px window would only move it 16px.
  document.documentElement.style.setProperty('--panel-h', `${PANEL_H}px`);
  document.documentElement.style.setProperty('--panel-w', `${PANEL_W}px`);
  document.documentElement.style.setProperty('--arch-w', `${ARCH_W}px`);

  // Receive-only now. The frame's top band (edges/edges.js) still posts an
  // open, because it is `top_most` and can win hit-testing over this window's
  // strip -- Windows gives no ordering guarantee between two top_most windows.
  // Nothing is sent back; this window owns closing entirely.
  const channel = createChannel(localStorage, window, { sendKey: DASH_ACK_KEY, receiveKey: DASH_CMD_KEY });

  let pointerOver = false;
  let closeTimer = null;
  let fullscreen = false;

  function cancelClose() {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
  }

  async function open() {
    cancelClose();

    // NOT a bare `if (isOpen) return`. That was a latch that killed this
    // panel's hover for whole sessions: isOpen is set true and THEN a window
    // call is awaited, so a rejection left the flag claiming the panel was up
    // and every later hover returned here and did nothing.
    //
    // shouldOpen checks the flag against the window's own HEIGHT, which cannot
    // lie: closed is the strip, open is the panel. See dashboard-data.js.
    if (!shouldOpen({ isOpen, fullscreen, innerHeight: window.innerHeight, stripHeight: STRIP_H })) return;
    isOpen = true;

    try {
      await setWindowHeight(PANEL_H);
      setSystemPoll(SYSTEM_POLL_OPEN_MS);

      // Two frames, not one. A single rAF can land before the compositor has
      // taken the new height, which starts the slide from the wrong geometry
      // and reads as a snap rather than a slide.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add('is-open');
      }));
      logEvent('opened');
    } catch (e) {
      // Release the flag: a transient failure must cost one missed hover, not
      // every future one.
      isOpen = false;
      logEvent('open FAILED', e && e.message ? e.message : String(e));
      console.error('dashboard: open failed, released the open flag', e);
    }
  }

  async function close() {
    cancelClose();
    if (!isOpen) return;
    isOpen = false;
    disarm();
    setSystemPoll(SYSTEM_POLL_IDLE_MS);
    document.body.classList.remove('is-open');

    // Shrink only after the slide has finished, or the panel vanishes from
    // under its own animation.
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (isOpen) return;
    showPane('dashboard');
    try {
      await setWindowHeight(STRIP_H);
    } catch (e) {
      logEvent('shrink FAILED', e && e.message ? e.message : String(e));
      console.error('dashboard: shrink failed', e);
    }
    logEvent('closed');
  }

  function reconsider() {
    logEvent('reconsider', `over=${pointerOver} open=${isOpen}`);
    if (pointerOver) { cancelClose(); return; }
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;

      // VERIFY BEFORE CLOSING. `mouseleave` cannot be taken at face value on
      // this window -- with the cursor held perfectly still it has reported
      // positions outside the window's own bounds (`x=486 y=524` in a
      // 1140x520 window). So the leave is a hint to re-check, and the engine's
      // own hover state is the arbiter. One check at the decision point, not a
      // poll.
      if (document.body.matches(':hover')) {
        pointerOver = true;
        logEvent('close cancelled', 'still hovered');
        return;
      }
      logEvent('close fired');
      close();
    }, CLOSE_DELAY_MS);
  }

  // THE HOVER, and the whole point of the single-window design.
  //
  // There is no handoff. The strip and the panel are the same window, so the
  // pointer that triggers the open is already inside the element that keeps it
  // open -- no second window has to agree about where the pointer is, and no
  // z-order race can leave both believing it left.
  //
  // The two-window version failed exactly there: the trigger window won
  // hit-testing in the 16px strip, so the panel received no `mouseenter` at
  // all, nothing held it open, and any stray event closed it. Reported as
  // "the top bar hover still sometimes doesn't work", with the dock -- which
  // has always been one window -- unaffected.
  let dwell = null;
  document.body.addEventListener('mouseenter', () => {
    logEvent('enter', `h=${window.innerHeight}`);
    cancelClose();
    pointerOver = true;
    if (isOpen || fullscreen) return;
    if (dwell !== null) clearTimeout(dwell);
    // A dwell so that merely crossing the top edge does not fling the panel
    // open; the top of the screen is on the path to every tab and title bar.
    dwell = setTimeout(() => {
      dwell = null;
      if (!pointerOver || fullscreen) return;
      open().catch((e) => console.error('dashboard: open rejected', e));
    }, OPEN_DELAY_MS);
  });

  document.body.addEventListener('mouseleave', (e) => {
    logEvent('leave', `y=${e.clientY} h=${window.innerHeight}`);
    if (dwell !== null) { clearTimeout(dwell); dwell = null; }
    pointerOver = false;
    reconsider();
  });

  // The frame's top band can win hit-testing over this window's strip, so it
  // opens the panel too. It never closes it -- once open, this window covers
  // everything the band does and its own hover is the authority.
  channel.subscribe((msg) => {
    if (!msg || msg.source !== 'trigger') return;

    if (msg.fullscreen) {
      fullscreen = true;
      document.body.classList.add('fullscreen-hidden');
      pointerOver = false;
      close();
      return;
    }
    fullscreen = false;
    document.body.classList.remove('fullscreen-hidden');

    if (msg.open) {
      logEvent('open from band');
      open().catch((e) => console.error('dashboard: open rejected', e));
    } else {
      // The band lost the pointer. If it went into this window, our own
      // mouseenter has already set pointerOver and reconsider will keep it
      // open; if it did not, this is what closes a panel the user opened from
      // the band and then walked away from without ever entering.
      reconsider();
    }
  });

  // Render on every provider emission. Cheap enough at this size, and it
  // keeps the panel correct while it is open without a second timer; the
  // date provider ticks once a second, which drives the clock.
  // Start sampling immediately, at the idle cadence, so the first open of a
  // session is populated too -- not just opens after the first.
  setSystemPoll(SYSTEM_POLL_IDLE_MS);

  providers.onOutput((next) => {
    out = next;
    renderPrompt();
    renderClock();
    renderSystem();
    renderMedia();
    // The hidden panes are still rendered: a tab switch must not show a
    // frame of stale or empty content while waiting for the next emission.
    renderPerformance();
    renderWorkspaces();
  });
}

init().catch((e) => console.error('dashboard: init failed', e));
