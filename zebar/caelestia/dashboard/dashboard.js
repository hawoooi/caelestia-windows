// The top hover dashboard: four panes (Dashboard, Media, Performance,
// Workspaces) hanging from the top edge of the screen.
//
// **This widget does not own the hover that opens it.** dashtrigger/ does,
// and posts over widget-channel.js. The reason is the dock's hardest-won
// finding (dock/dock.js, and three failed fixes before the cause was found):
// ANY geometry change on a WebView2 window -- a resize OR a move -- clears
// the hover state under a stationary cursor, so a window that resizes itself
// to open cannot also be the thing that detects "the pointer is still here".
// It oscillates. The panel is far too large to leave permanently on screen
// the way the dock's 56px strip can be (a Zebar window swallows clicks across
// its whole footprint even when fully transparent), so the two jobs are split
// across two windows: a small static one that hovers reliably, and this one,
// which only has to keep itself open AFTER its geometry has settled.
//
// Closing is a two-source decision. The panel stays open while the pointer is
// over EITHER the trigger or the panel, and closes on a short delay once it
// is over neither -- so the gap the pointer crosses between them does not
// slam it shut.

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
export const PARKED = 1;

// How long the pointer may be over neither surface before the panel closes.
// Long enough to cross the seam between the trigger and the panel without
// losing it; short enough that a deliberate exit feels immediate.
export const CLOSE_DELAY_MS = 260;

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

// See dashtrigger/trigger.js for why this log exists rather than being
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
// corners, all three edges, the dock and the dashtrigger. Against that, 0.4
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

  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED, height: PARKED });
    await win.setPosition({ type: 'Physical', x: monitor.x, y: monitor.y });
  }
  await park();

  // Measuring before the vendored Font Awesome webfont has settled would size
  // the panel against fallback glyph metrics.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* proceed anyway */ }
  }

  const channel = createChannel(localStorage, window, { sendKey: DASH_ACK_KEY, receiveKey: DASH_CMD_KEY });

  let pointerOverTrigger = false;
  let pointerOverPanel = false;
  let closeTimer = null;
  let fullscreen = false;

  function cancelClose() {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
  }

  async function open() {
    cancelClose();

    // NOT a bare `if (isOpen) return`. That was a latch, and it killed this
    // panel's hover for whole sessions at a time.
    //
    // isOpen is set true and THEN two window geometry calls are awaited below.
    // If either rejects -- a transient Tauri IPC failure, which is rare but
    // not impossible -- this function dies with the flag still claiming the
    // panel is up, and it is called from the channel subscriber with no catch.
    // Every later hover then returned here immediately and did nothing, while
    // the trigger kept firing perfectly. Reported exactly that way: the top
    // hover breaks, the dock keeps working -- and the dock keeps working
    // because it never resizes its window, so it has no call that can fail.
    //
    // shouldOpen checks the flag against the window's own width, which cannot
    // lie: parked is 1px. See dashboard-data.js.
    if (!shouldOpen({ isOpen, fullscreen, innerWidth: window.innerWidth, parkedWidth: PARKED })) return;
    isOpen = true;

    try {
      const width = Math.min(PANEL_W, monitor.width);
      // Centred on this monitor, hanging from its top edge.
      await win.setSize({ type: 'Physical', width, height: PANEL_H });
      await win.setPosition({
        type: 'Physical',
        x: monitor.x + Math.round((monitor.width - width) / 2),
        y: monitor.y,
      });

    // The trigger's hover state is DEAD from this moment on, so stop
    // believing it.
    //
    // The open panel covers the trigger completely -- the trigger is
    // 1000..1560 x 0..16, the panel 710..1850 x 0..520 -- so the pointer that
    // was over the trigger is now over the panel, and the trigger receives a
    // `mouseleave` it cannot distinguish from a real one. (It correctly
    // suppresses that leave via isRealDeparture, because the pointer is still
    // inside its bounds; suppressing it is what makes the OPEN survive.) The
    // consequence is that the trigger can never report a departure while the
    // panel is up: it is occluded, so no further pointer events reach it.
    //
    // Left believed, `pointerOverTrigger` stays true forever and the panel
    // NEVER CLOSES -- observed live, and the reason this line exists. From
    // here the panel's own hover is the single authority, which is sound
    // precisely because it covers every pixel the trigger did.
    pointerOverTrigger = false;

    // The slide starts only after the geometry has settled. Starting it in
    // the same frame as the resize makes the first frames of the transition
    // land while the window is still the wrong size, which reads as a jump.
    setSystemPoll(SYSTEM_POLL_OPEN_MS);

    // Two frames, not one. The window was resized on the line above, and a
    // single rAF can land before the compositor has taken the new size --
    // which starts the slide from the wrong geometry and reads as a snap
    // rather than a slide. The second frame guarantees the browser has laid
    // out at the final size with the closed transform still applied, so the
    // transition has something real to animate FROM.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add('is-open');
      }));
      channel.post({ open: true });
    } catch (e) {
      // The panel is not up, so the flag must not claim it is -- that is the
      // latch described above. Releasing it means the next hover simply tries
      // again, which is the correct behaviour for a transient failure.
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
    // Back down to the idle cadence rather than stopping: the network
    // baseline has to survive the panel being closed, or the next open is
    // blank again for a second. See the note on the poll itself.
    setSystemPoll(SYSTEM_POLL_IDLE_MS);
    document.body.classList.remove('is-open');

    // Park only after the slide has finished, or the window vanishes from
    // under the animation and the panel appears to teleport away.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Re-check: the pointer may have come back during the slide out.
    if (isOpen) return;
    showPane('dashboard');
    try {
      await park();
    } catch (e) {
      // isOpen is already false here, so the next hover will re-open and
      // re-size regardless. Worth logging, not worth latching on.
      logEvent('park FAILED', e && e.message ? e.message : String(e));
      console.error('dashboard: park failed', e);
    }
    channel.post({ open: false });
  }

  function reconsider() {
    logEvent('reconsider', `trigger=${pointerOverTrigger} panel=${pointerOverPanel} open=${isOpen}`);
    if (pointerOverTrigger || pointerOverPanel) { cancelClose(); return; }
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;

      // VERIFY BEFORE CLOSING. `mouseleave` cannot be taken at face value on
      // this window, and the event log is what proved it: with the cursor held
      // perfectly still at client (570, 12), the panel received
      //
      //   panel leave x=486 y=524 rel=null inner=1140x520
      //
      // -- a fabricated position four pixels past its own bottom edge, for a
      // pointer that had not moved. It arrives roughly a second after opening,
      // every time, and it closed the panel out from under the user.
      //
      // So the leave is treated as a HINT to re-check rather than as fact, and
      // the engine's own hover state is the arbiter. This is a single check at
      // the moment of decision, NOT a poll: polling :hover was already tried
      // against the dock's oscillation and did not help there, and a per-tick
      // check would burn CPU for the whole time the panel is open.
      if (document.body.matches(':hover')) {
        pointerOverPanel = true;
        logEvent('close cancelled', 'still hovered');
        return;
      }
      logEvent('close fired');
      close();
    }, CLOSE_DELAY_MS);
  }

  channel.subscribe((msg) => {
    if (!msg || msg.source !== 'trigger') return;

    // Fullscreen arrives over the channel rather than from a second poller.
    // The trigger already runs fullscreen-detect.exe once a second; a second
    // copy in this widget would double the helper spawns for one shared
    // answer, and an orphaned helper inheriting zebar's listening socket is
    // the single worst failure mode this pack has (it paints NOTHING, under a
    // PID that no longer exists, and has been misdiagnosed as a WebView2
    // fault twice). One poller, one answer, broadcast.
    //
    // This closes REGARDLESS of pointer state -- unlike an ordinary
    // departure, which waits to see whether the pointer landed on the panel.
    if (msg.fullscreen) {
      fullscreen = true;
      document.body.classList.add('fullscreen-hidden');
      pointerOverPanel = false;
      pointerOverTrigger = false;
      close();
      return;
    }
    fullscreen = false;
    document.body.classList.remove('fullscreen-hidden');

    logEvent('msg from trigger', `open=${msg.open}`);
    pointerOverTrigger = Boolean(msg.open);
    if (msg.open) open().catch((e) => console.error('dashboard: open rejected', e));
    else reconsider();
  });

  // The panel's own hover. Only trustworthy because it is attached to a
  // window whose geometry has already settled by the time the pointer can
  // reach it -- see the header comment.
  document.body.addEventListener('mouseenter', () => {
    logEvent('panel enter');
    pointerOverPanel = true;
    cancelClose();
  });
  document.body.addEventListener('mouseleave', (e) => {
    logEvent('panel leave', `x=${e.clientX} y=${e.clientY} rel=${e.relatedTarget ? e.relatedTarget.nodeName : 'null'} inner=${window.innerWidth}x${window.innerHeight}`);
    pointerOverPanel = false;
    reconsider();
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
