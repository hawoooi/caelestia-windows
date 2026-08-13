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
import {
  formatUptime,
  formatBytes,
  formatPercent,
  formatTrackTime,
  promptFields,
  collectWindows,
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
// Measured that way after the calendar was dropped: dashboard 421px (still the
// tallest -- media 300, performance 281, workspaces 301), tabs and prompt
// included. 440 leaves slack for a two-line track title.
//
// Every pixel of window BELOW the panel is a transparent but click-dead strip
// over the user's desktop, so this is kept close to the real height rather
// than padded generously. An earlier 470 clipped the quick actions; 520 left
// 99px of dead zone. If a pane grows, this number moves with it.
export const PANEL_W = 1140;
export const PANEL_H = 440;
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

// Three shell-backed helpers, all polled ONLY while the panel is open.
//
// That is the whole discipline here. Each of these is a process spawn, and a
// helper that outlives its parent zebar inherits zebar's listening socket on
// port 6124 -- after which every later start binds nothing and the entire
// desktop paints blank, under a PID that no longer exists. This pack has lost
// two debugging sessions to exactly that. A panel that is closed 99% of the
// time must not be spawning anything 100% of the time, so every timer below is
// started on open and cleared on close (the same pattern panels/panels.js
// established for its own mixer and network polls).
const shell = zebar.shellExec ? zebar : null;
const netStats = createNetStats(shell);
const gpuStats = createGpuStats(shell);
const mediaArt = createMediaArt(shell);

// 1000ms: fast enough that a download visibly moves the number, slow enough
// that two spawns a second is the ceiling for the whole panel.
const SYSTEM_POLL_MS = 1000;
let systemTimer = null;

function stopSystemPoll() {
  if (systemTimer !== null) { clearInterval(systemTimer); systemTimer = null; }
  // Forget the last network sample. Differencing against a minutes-old read
  // on reopen would average the entire gap into one bogus "current" rate.
  netStats.reset();
  latestNet = null;
  latestGpu = null;
}

async function sampleSystem() {
  // Both are independent and both fail soft to null, so they run together
  // rather than one after the other.
  const [net, gpu] = await Promise.all([netStats.sample(), gpuStats.sample()]);
  if (net) latestNet = net;
  if (gpu) latestGpu = gpu;
  renderSystem();
}

function startSystemPoll() {
  stopSystemPoll();
  sampleSystem();
  systemTimer = setInterval(sampleSystem, SYSTEM_POLL_MS);
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

// The System tile: live network throughput, and CPU / GPU / RAM load.
//
// Direct user feedback replacing what was here: "try to incorperate wifi
// up/down speed and cpu/gpu/ram into the dashboard instead if sound volume and
// those meaningless bars". Volume is gone -- it already lives in the bar's
// pill and its panel, so it was duplicated here, and it is not a machine-load
// reading like the other two were pretending to be.
//
// Rates are numbers, not bars: throughput has no ceiling, so a bar has no
// scale to be a fraction OF, which is precisely what made the old ones
// meaningless. The three loads are percentages, which do have a ceiling, so
// they keep a bar.
let latestNet = null;   // { rates: { down, up } } from net-stats.exe
let latestGpu = null;   // { usage, temperature, usedBytes, totalBytes }

function renderSystem() {
  const down = $('netDown');
  const up = $('netUp');
  if (down && up) {
    // formatRate already returns "4.6 kB/s"; the unit is split onto its own
    // span so it can be set smaller without the number reflowing.
    setRate(down, latestNet?.rates ? latestNet.rates.down : null);
    setRate(up, latestNet?.rates ? latestNet.rates.up : null);
  }

  const host = $('mixRows');
  if (!host) return;

  const disk = primaryDisk();
  const diskUsed = disk && Number.isFinite(disk.totalSpace?.bytes) && Number.isFinite(disk.availableSpace?.bytes)
    ? (1 - disk.availableSpace.bytes / disk.totalSpace.bytes) * 100
    : null;

  // Each row carries the raw figure behind its percentage. "68%" on its own
  // does not say whether that is 11GB or 22GB, and this column is now wide
  // enough to answer that -- which is the point of giving the panel the space
  // the calendar was using.
  const rows = [
    {
      key: 'CPU',
      value: out.cpu?.usage,
      // NOT frequency. Read live over CDP, zebar's cpu provider reports
      // { frequency: 0, vendor: '' } on this machine -- sysinfo cannot get a
      // clock speed here -- so a GHz figure renders a confident "0.0 GHz".
      // Core counts come back populated, and do not change.
      detail: out.cpu
        ? `${out.cpu.physicalCoreCount} cores  \u00B7  ${out.cpu.logicalCoreCount} threads`
        : null,
    },
    // The GPU row is absent rather than zero on a machine with no nvidia-smi
    // -- see gpu-stats.js for why this is NVIDIA-only on purpose.
    {
      key: 'GPU',
      value: latestGpu ? latestGpu.usage : null,
      absent: !gpuStats.available,
      detail: gpuDetail(),
    },
    {
      key: 'RAM',
      value: out.memory?.usage,
      detail: out.memory
        ? `${formatBytes(out.memory.usedMemory) ?? '--'} of ${formatBytes(out.memory.totalMemory) ?? '--'}`
        : null,
    },
    {
      key: 'DISK',
      value: diskUsed,
      absent: !disk,
      detail: disk
        ? `${Math.round(disk.availableSpace?.siValue ?? 0)}${disk.availableSpace?.siUnit ?? ''} free`
        : null,
    },
  ];

  host.textContent = '';
  for (const row of rows) {
    if (row.absent) continue;

    const el = document.createElement('div');
    el.className = 'mix__row';

    const k = document.createElement('div');
    k.className = 'mix__k';
    k.textContent = row.key;

    const track = document.createElement('div');
    track.className = 'mix__track';
    const fill = document.createElement('div');
    fill.className = 'mix__fill';
    fill.style.width = `${Math.max(0, Math.min(100, Math.round(row.value ?? 0)))}%`;
    track.appendChild(fill);

    const val = document.createElement('div');
    val.className = 'mix__val';
    val.textContent = Number.isFinite(row.value) ? `${Math.round(row.value)}%` : '--';

    el.append(k, track, val);
    if (row.detail) {
      const d = document.createElement('div');
      d.className = 'mix__detail';
      d.textContent = row.detail;
      el.appendChild(d);
    }
    host.appendChild(el);
  }
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

function setRate(el, bytesPerSecond) {
  const text = formatRate(bytesPerSecond);
  el.textContent = '';
  if (!text || text === '--') { el.textContent = '--'; return; }
  // "4.6 kB/s" -> number + unit, so the unit can be dimmed and shrunk.
  const space = text.indexOf(' ');
  if (space === -1) { el.textContent = text; return; }
  el.appendChild(document.createTextNode(text.slice(0, space)));
  const u = document.createElement('span');
  u.className = 'sys__netu';
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

// The disk provider PRE-CONVERTS its sizes and exposes siValue/siUnit.
// Recomputing from `bytes` is the documented trap here -- it produced figures
// that disagreed with every other disk readout on the desktop.
function primaryDisk() {
  const disks = out.disk?.disks;
  if (!Array.isArray(disks) || !disks.length) return null;
  return disks.find((d) => /^C:/i.test(d.mountPoint ?? '')) ?? disks[0];
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
    if (isOpen || fullscreen) return;
    isOpen = true;

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
    startSystemPoll();

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
  }

  async function close() {
    cancelClose();
    if (!isOpen) return;
    isOpen = false;
    disarm();
    // Stop spawning helpers the moment the panel is on its way out -- see the
    // note on the poll itself. Doing it here rather than after the slide means
    // a fast open/close cycle cannot leave a timer running behind a panel that
    // is already gone.
    stopSystemPoll();
    document.body.classList.remove('is-open');

    // Park only after the slide has finished, or the window vanishes from
    // under the animation and the panel appears to teleport away.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Re-check: the pointer may have come back during the slide out.
    if (isOpen) return;
    showPane('dashboard');
    await park();
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
    if (msg.open) open();
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
