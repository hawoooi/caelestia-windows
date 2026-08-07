// The panels flyout: ONE Zebar widget that renders whichever panel the bar
// asks for -- system tray, volume, network (and quick settings, later).
//
// Unlike statusmenu (a dumb readout the bar feeds finished rows to), this
// flyout OWNS its providers, because its panels are INTERACTIVE: a tray-icon
// click, a volume drag, a mute toggle. Those need the provider's own methods
// (systray onLeftClick, audio setVolume/setMute), which cannot be proxied over
// the localStorage channel -- only plain data crosses it. So the bar trigger
// sends nothing but "open panel <id> at <anchor>", and this widget reads the
// providers itself.
//
// Each panel is a BUILDER: build(out) constructs its DOM once and returns an
// update(out) that refreshes values in place. This matters for the volume
// slider -- rebuilding the panel on every provider tick would drop the slider
// mid-drag and flicker the icons -- so tick() updates, it does not rebuild.
//
// The 1x1-park / measure / resize dance and the monitor-capture-before-parking
// are copied from statusmenu/menu.js; see ../widget-channel.js and
// docs/zebar-bar.md for why a flyout is its own window and parks at 1x1.

import * as zebar from '../bar/vendor/zebar.js';
import { PANELS_CMD_KEY, PANELS_ACK_KEY, createChannel } from '../widget-channel.js';
import { menuPlacement, isAnchorOnMonitor } from '../flyout-placement.js';
import { STATUS_ITEMS } from '../status-catalogue.js';
import { createMixer, sessionsSignature } from '../audio-mixer.js';
import { createNetStats, formatRate, formatLink } from '../net-stats.js';
import {
  parseClockConfig, zoneRows, localTimeZone, formatZoneTime, formatZoneDate,
  formatOffset, zoneOffsetMinutes, availableTimeZones, convertZones,
  formatDifference, sameZone, offeredSpelling,
} from '../clock-zones.js';

// How often the per-app mixer is re-read while the volume panel is open.
// ONLY while it is open -- see stopMixerPoll. Core Audio has no push
// notification reachable from here, so this is a genuine poll, and this pack's
// hard-won rule is that a poll must not exist when nothing is looking at it.
const MIXER_POLL_MS = 1000;

// The network sampler needs at least one interval before it can report a
// rate at all, so it is quicker than the mixer -- the panel would otherwise
// show "--" for a noticeable beat after opening.
const NET_POLL_MS = 800;

export const MENU_DISMISS_MS = 8000;
export const PARKED_SIZE = 1;
export const FADE_MS = 300;   // keep in step with panels.css --dur

const panel = document.getElementById('panel');

// This flyout owns its providers. Systray (tray panel), audio (volume panel),
// network (network panel). More get added as their panels grow.
const providers = zebar.createProviderGroup({
  systray: { type: 'systray' },
  audio:   { type: 'audio' },
  network: { type: 'network' },
});

// The per-app mixer client. Owns non-overlap and icon caching; see
// ../audio-mixer.js.
const mixer = createMixer(zebar.shellExec ? zebar : null);

// The mixer poll is module-level so it can be stopped from anywhere a panel
// stops being visible -- closing the flyout AND switching to a different
// panel. A poll that outlives the panel it feeds is exactly the shape of bug
// (an unobserved recurring shellExec) that cost this pack two debugging
// sessions, so there is exactly one timer and every exit path clears it.
let mixerTimer = null;
function stopMixerPoll() {
  if (mixerTimer !== null) { clearInterval(mixerTimer); mixerTimer = null; }
}
function startMixerPoll(fn) {
  stopMixerPoll();
  fn(true);                                       // first pass fetches icons
  mixerTimer = setInterval(() => fn(false), MIXER_POLL_MS);
}

// Live network sampler. Same non-overlap + poll-only-while-open discipline
// as the mixer above; see ../net-stats.js.
const netStats = createNetStats(zebar.shellExec ? zebar : null);
let netTimer = null;
function stopNetPoll() {
  if (netTimer !== null) { clearInterval(netTimer); netTimer = null; }
  // Forget the previous sample, or reopening the panel would difference
  // against a minutes-old read and report the whole gap as a current rate.
  netStats.reset();
}
function startNetPoll(fn) {
  stopNetPoll();
  fn();
  netTimer = setInterval(fn, NET_POLL_MS);
}

// The clock panel repaints once a second so its seconds-free display still
// flips the minute at the same moment the bar's own clock does. Cheap (pure
// Intl formatting -- no process, no IO), but still stopped with every other
// per-panel timer when the panel goes away, on the same principle.
let clockTimer = null;
function stopClockTick() {
  if (clockTimer !== null) { clearInterval(clockTimer); clockTimer = null; }
}
function startClockTick(fn) {
  stopClockTick();
  fn();
  clockTimer = setInterval(fn, 1000);
}

// The `clock` block from bar.config.json, handed over by the bar trigger --
// this flyout never reads bar.config.json itself, so config travels with the
// open command like every other piece of state the bar owns. Null until the
// first open, which parseClockConfig turns into the shipped default.
let clockConfig = null;

// Lets a panel dismiss the whole flyout from inside a builder (the Wi-Fi
// button hands off to Windows' own picker, so keeping this open over the top
// of it would be wrong). Set by init().
let dismissFromPanel = () => {};

// Set by init() so a builder can ask the window to re-fit after its content
// changes height (an app row appearing, a rate label widening), without
// reaching into init's closure. No-op until then.
let onContentResized = () => {};

// --- tiny DOM helper ------------------------------------------------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// --- panel builders -------------------------------------------------------
// build(out) clears the panel, constructs its DOM, and returns an update(out)
// that refreshes it in place from a later provider tick.

function buildTray(out) {
  panel.replaceChildren();
  const head = el('div', 'panel-head');
  const count = el('span', 'sub');
  head.append(el('h3', null, 'Tray'), count);
  panel.append(head);
  const grid = el('div', 'tray-grid');
  panel.append(grid);

  let lastSig = '';
  function update(o) {
    const sys = o?.systray;
    const icons = Array.isArray(sys?.icons) ? sys.icons : [];
    count.textContent = `${icons.length} item${icons.length === 1 ? '' : 's'}`;

    // Rebuild the grid only when the icon SET actually changes (ids + hashes),
    // not on every provider emit -- otherwise the blob <img>s flicker and the
    // window refits needlessly.
    const sig = icons.map((i) => `${i.id}:${i.iconHash}`).join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    grid.replaceChildren();
    if (icons.length === 0) {
      grid.append(el('div', 'tray-empty', 'No tray icons'));
      return;
    }
    for (const icon of icons) {
      const tile = el('button', 'tile');
      tile.type = 'button';
      tile.title = icon.tooltip || '';
      const img = el('img');
      img.src = icon.iconUrl;               // blob: URL straight from the provider
      img.alt = icon.tooltip || 'tray icon';
      tile.append(img);
      const id = icon.id;
      tile.addEventListener('click', () => providers.outputMap.systray?.onLeftClick?.(id));
      tile.addEventListener('contextmenu', (e) => { e.preventDefault(); providers.outputMap.systray?.onRightClick?.(id); });
      tile.addEventListener('auxclick', (e) => { if (e.button === 1) providers.outputMap.systray?.onMiddleClick?.(id); });
      grid.append(tile);
    }
  }
  update(out);
  return update;
}

function buildVolume(out) {
  panel.replaceChildren();
  const head = el('div', 'panel-head');
  const dname = el('span', 'sub');
  head.append(el('h3', null, 'Volume'), dname);
  panel.append(head);

  const row = el('div', 'vol-master');
  const mute = el('button', 'vol-mute fa-solid');
  mute.type = 'button';
  const slider = el('input', 'vol-slider');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
  const val = el('span', 'vol-val');
  row.append(mute, slider, val);
  panel.append(row);

  // Suppress the tick's slider.value write while the user is dragging, or the
  // provider's slightly-stale value would fight the drag and make it stutter.
  let dragging = false;
  slider.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    providers.outputMap.audio?.setVolume?.(v);
    val.textContent = `${v}%`;              // optimistic; the tick confirms it
  });
  mute.addEventListener('click', () => {
    const dev = providers.outputMap.audio?.defaultPlaybackDevice;
    providers.outputMap.audio?.setMute?.(!(dev?.isMuted));
  });

  // --- per-application rows (tools/audio-mixer.exe) ----------------------
  //
  // Direct user feedback: "The volume panel is too basic. I want it to be more
  // like this", with the Windows/EarTrumpet per-app mixer. zebar's audio
  // provider only ever exposes the DEFAULT DEVICE (the master row above), so
  // everything below comes from the Core Audio helper instead.
  panel.append(el('div', 'vol-sep'));
  const apps = el('div', 'vol-apps');
  panel.append(apps);

  const rows = new Map();        // pid -> { root, img, name, slider, val, dragging }
  let lastSig = null;

  function appRow(session) {
    const root = el('div', 'vol-app');

    const img = el('img', 'vol-app__icon');
    img.alt = '';
    const name = el('span', 'vol-app__name');
    const slider = el('input', 'vol-slider');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    const val = el('span', 'vol-val');

    const meta = el('div', 'vol-app__meta');
    meta.append(img, name);
    root.append(meta, slider, val);

    const entry = { root, img, name, slider, val, dragging: false };

    // Same anti-fight rule as the master slider: a poll landing mid-drag must
    // not write the (slightly stale) helper value back into the thumb.
    slider.addEventListener('pointerdown', () => { entry.dragging = true; });
    window.addEventListener('pointerup', () => { entry.dragging = false; });
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      val.textContent = `${v}%`;                 // optimistic; the poll confirms
      mixer.setVolume(session.pid, v);
    });

    rows.set(session.pid, entry);
    return entry;
  }

  function renderSessions(sessions) {
    // Rebuild rows only when the session SET changes -- a rebuild mid-drag
    // would drop the slider being held, and the icons would flicker.
    const sig = sessionsSignature(sessions);
    if (sig !== lastSig) {
      lastSig = sig;
      const live = new Set(sessions.map((s) => s.pid));
      for (const [pid, entry] of rows) {
        if (!live.has(pid)) { entry.root.remove(); rows.delete(pid); }
      }
      for (const s of sessions) if (!rows.has(s.pid)) appRow(s);
      // Re-append in sorted order; appendChild moves existing nodes.
      for (const s of sessions) apps.append(rows.get(s.pid).root);
      apps.classList.toggle('vol-apps--empty', sessions.length === 0);
    }

    for (const s of sessions) {
      const entry = rows.get(s.pid);
      if (!entry) continue;
      if (entry.name.textContent !== s.display) entry.name.textContent = s.display;
      entry.root.title = `${s.display} (${s.process})`;
      const icon = s.icon ?? mixer.iconFor(s.pid);
      const src = icon ? `data:image/png;base64,${icon}` : '';
      if (src && entry.img.getAttribute('src') !== src) entry.img.setAttribute('src', src);
      entry.img.classList.toggle('vol-app__icon--missing', !src);
      const shown = s.muted ? 0 : s.volume;
      if (!entry.dragging) entry.slider.value = String(shown);
      const label = s.muted ? 'Muted' : `${s.volume}%`;
      if (entry.val.textContent !== label) entry.val.textContent = label;
    }
  }

  async function pollMixer(wantIcons) {
    const sessions = await mixer.refresh(wantIcons);
    if (sessions === null) return;               // dropped (in flight) or failed
    renderSessions(sessions);
    onContentResized();
  }

  startMixerPoll(pollMixer);

  function update(o) {
    const dev = o?.audio?.defaultPlaybackDevice;
    if (!dev) {
      dname.textContent = '';
      mute.textContent = STATUS_ITEMS.volume.glyph(o);
      val.textContent = '—';
      slider.disabled = true;
      return;
    }
    slider.disabled = false;
    dname.textContent = dev.name ? String(dev.name) : '';
    mute.textContent = STATUS_ITEMS.volume.glyph(o);
    mute.title = dev.isMuted ? 'Unmute' : 'Mute';
    const v = Math.round(dev.volume ?? 0);
    val.textContent = dev.isMuted ? 'Muted' : `${v}%`;
    if (!dragging) slider.value = String(v);
  }
  update(out);
  return update;
}

function buildNetwork(out) {
  panel.replaceChildren();
  const head = el('div', 'panel-head');
  head.append(el('h3', null, 'Network'));
  panel.append(head);

  const status = el('div', 'net-status');
  const glyph = el('span', 'net-glyph fa-solid');
  const txt = el('div', 'net-txt');
  const name = el('span', 'net-name');
  const detail = el('span', 'net-detail');
  txt.append(name, detail);
  status.append(glyph, txt);
  panel.append(status);

  // Live throughput (direct user feedback: "Add network stats like download
  // and upload in there"). These come from tools/net-stats.exe, NOT from the
  // zebar provider: its transmitSpeed/receiveSpeed are the negotiated LINK
  // RATE, not traffic (866700000 on this Wi-Fi 6E adapter is exactly 866.7
  // Mbps). Nothing in the provider counts bytes.
  const rates = el('div', 'net-rates');
  const downCell = el('div', 'net-rate');
  const downGlyph = el('span', 'net-rate__glyph fa-solid', '\uF063');   // arrow-down
  const downVal = el('span', 'net-rate__val', '--');
  downCell.append(downGlyph, downVal);
  const upCell = el('div', 'net-rate');
  const upGlyph = el('span', 'net-rate__glyph fa-solid', '\uF062');     // arrow-up
  const upVal = el('span', 'net-rate__val', '--');
  upCell.append(upGlyph, upVal);
  rates.append(downCell, upCell);
  panel.append(rates);

  // The escape hatch for everything this pack cannot do itself. Scanning for
  // networks needs Windows Location services (machine consent reads Deny here;
  // netsh reports an elevation error without it), so rather than ask the user
  // to loosen a privacy setting for a bar widget, this hands off to the OS
  // picker that already holds the permission.
  const actions = el('div', 'net-actions');
  const wifiBtn = el('button', 'net-btn');
  wifiBtn.type = 'button';
  wifiBtn.append(el('span', 'net-btn__glyph fa-solid', '\uF1EB'), el('span', null, 'Wi-Fi networks'));
  wifiBtn.title = 'Open the Windows network picker (scan, signal, connect)';
  wifiBtn.addEventListener('click', () => { netStats.openWifiSettings(); dismissFromPanel(); });
  actions.append(wifiBtn);
  panel.append(actions);

  async function pollStats() {
    const sample = await netStats.sample();
    if (!sample) return;
    // Prefer the helper's own name (the real SSID, via the Network List
    // Manager) over the zebar provider's, which reports the ADAPTER name
    // ("Wi-Fi") rather than the network's.
    if (sample.stats.name) {
      name.textContent = sample.stats.name;
      const bits = [sample.stats.ipv4, formatLink(sample.stats.linkBps)].filter(Boolean);
      detail.textContent = bits.join('  ·  ');
      detail.style.display = bits.length ? '' : 'none';
    }
    downVal.textContent = formatRate(sample.rates ? sample.rates.down : null);
    upVal.textContent = formatRate(sample.rates ? sample.rates.up : null);
    onContentResized();
  }

  startNetPoll(pollStats);

  function update(o) {
    glyph.textContent = STATUS_ITEMS.network.glyph(o);
    // Only used until the first helper sample lands, and as the fallback when
    // the helper cannot read an adapter at all.
    if (!name.textContent) {
      name.textContent = STATUS_ITEMS.network.value(o) || 'Disconnected';
      const d = STATUS_ITEMS.network.detail(o);
      detail.textContent = d || '';
      detail.style.display = d ? '' : 'none';
    }
  }
  update(out);
  return update;
}


function buildClock(out) {
  panel.replaceChildren();
  const local = localTimeZone();
  const zones = parseClockConfig(clockConfig).timezones;

  // --- local time, big -----------------------------------------------------
  const head = el('div', 'panel-head');
  // Shown through the configured spelling where there is one: the system
  // reports this machine's zone as `Asia/Saigon`, so the raw id would sit in
  // the header while the row right below it -- the same place -- reads "Ho Chi
  // Minh", which looks like two different zones.
  const localShown = offeredSpelling(zones, local) ?? local;
  head.append(el('h3', null, 'Clock'), el('span', 'sub', localShown.replace(/_/g, ' ')));
  panel.append(head);

  const now = el('div', 'clock-now');
  const nowTime = el('div', 'clock-now__time');
  const nowDate = el('div', 'clock-now__date');
  now.append(nowTime, nowDate);
  panel.append(now);

  // --- world clock ---------------------------------------------------------
  let zoneList = null;
  const zoneEls = new Map();
  if (zones.length) {
    panel.append(el('div', 'clock-sep'));
    zoneList = el('div', 'clock-zones');
    panel.append(zoneList);
    for (const tz of zones) {
      const row = el('div', 'clock-zone');
      const name = el('div', 'clock-zone__name');
      const time = el('div', 'clock-zone__time');
      const meta = el('div', 'clock-zone__meta');
      row.append(name, meta, time);
      row.title = tz;
      zoneList.append(row);
      zoneEls.set(tz, { name, time, meta });
    }
  }

  // --- converter -----------------------------------------------------------
  panel.append(el('div', 'clock-sep'));
  const conv = el('div', 'clock-conv');
  conv.append(el('div', 'clock-conv__title', 'Convert'));

  const allZones = availableTimeZones(zones);
  function zoneSelect(selected) {
    const s = el('select', 'clock-conv__zone');
    for (const tz of allZones) {
      const o = el('option', null, tz.replace(/_/g, ' '));
      o.value = tz;
      if (tz === selected) o.selected = true;
      s.append(o);
    }
    return s;
  }

  const whenRow = el('div', 'clock-conv__row');
  const dateInput = el('input', 'clock-conv__date');
  dateInput.type = 'date';
  const timeInput = el('input', 'clock-conv__time');
  timeInput.type = 'time';
  whenRow.append(dateInput, timeInput);

  // Both defaults are resolved through the OFFERED spelling and compared by
  // CANONICAL zone. Setting select.value to an alias the option list does not
  // contain leaves nothing selected, and comparing raw ids made both pickers
  // default to the same physical place under two names (local resolves to
  // Asia/Saigon here, while the configured spelling is Asia/Ho_Chi_Minh), so
  // the converter opened converting a zone to itself.
  const fromDefault = offeredSpelling(allZones, local) ?? local;
  const firstElsewhere = zones.find((tz) => !sameZone(tz, local));
  const toDefault = offeredSpelling(allZones, firstElsewhere ?? 'UTC') ?? 'UTC';

  const fromRow = el('div', 'clock-conv__row');
  fromRow.append(el('span', 'clock-conv__lbl', 'from'), zoneSelect(fromDefault));
  const toRow = el('div', 'clock-conv__row');
  toRow.append(el('span', 'clock-conv__lbl', 'to'), zoneSelect(toDefault));

  const result = el('div', 'clock-conv__result');
  const resultTime = el('div', 'clock-conv__result-time', '--:--');
  const resultMeta = el('div', 'clock-conv__result-meta', '');
  result.append(resultTime, resultMeta);

  conv.append(whenRow, fromRow, toRow, result);
  panel.append(conv);

  const fromSel = fromRow.querySelector('select');
  const toSel = toRow.querySelector('select');

  // Seeded with "now" in the local zone so the converter is answering a real
  // question the moment it opens, rather than sitting blank until filled in.
  function seedNow(d) {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: local, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d);
    const g = (type) => (p.find((x) => x.type === type) || {}).value;
    dateInput.value = g('year') + '-' + g('month') + '-' + g('day');
    timeInput.value = g('hour') + ':' + g('minute');
  }
  seedNow(new Date());

  function recompute() {
    const r = convertZones({
      dateStr: dateInput.value,
      timeStr: timeInput.value,
      fromZone: fromSel.value,
      toZone: toSel.value,
    });
    if (!r) {
      // A half-typed form must read as "not answered", never as a confident
      // wrong answer.
      resultTime.textContent = '--:--';
      resultMeta.textContent = '';
      onContentResized();
      return;
    }
    const day = r.dayOffset === 0 ? '' : (r.dayOffset > 0 ? ' (+1d)' : ' (-1d)');
    resultTime.textContent = r.time + day;
    resultMeta.textContent = r.date + '  ·  ' + formatDifference(r.differenceMinutes);
    onContentResized();
  }
  for (const input of [dateInput, timeInput, fromSel, toSel]) {
    input.addEventListener('input', recompute);
    input.addEventListener('change', recompute);
  }
  recompute();

  // Ticking the panel from the provider alone would only move it once a
  // minute AND only when the date provider emits; a panel showing a clock
  // must not visibly lag the bar it was opened from.
  function paintNow() {
    const d = new Date();
    nowTime.textContent = formatZoneTime(d, local);
    nowDate.textContent = formatZoneDate(d, local, { long: true });
    for (const [tz, refs] of zoneEls) {
      refs.name.textContent = zoneLabelOf(tz);
      refs.time.textContent = formatZoneTime(d, tz);
      const delta = Math.round((zoneOffsetMinutes(d, tz) - zoneOffsetMinutes(d, local)));
      refs.meta.textContent = formatOffset(zoneOffsetMinutes(d, tz)) + '  ·  ' + formatDifference(delta);
    }
  }
  function zoneLabelOf(tz) { return tz.split('/').pop().replace(/_/g, ' '); }

  startClockTick(paintNow);

  // The provider tick is still wired, so the panel stays correct even if the
  // interval is throttled while the window is backgrounded.
  function update() { paintNow(); }
  update(out);
  return update;
}

const BUILDERS = {
  tray: buildTray,
  volume: buildVolume,
  network: buildNetwork,
  clock: buildClock,
};

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('panels: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };

  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED_SIZE, height: PARKED_SIZE });
    await win.setPosition({ type: 'Physical', x: monitor.x, y: monitor.y });
  }
  await park();

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* measure anyway */ }
  }

  const channel = createChannel(localStorage, window, {
    sendKey: PANELS_ACK_KEY,
    receiveKey: PANELS_CMD_KEY,
  });

  let open = false;
  let currentPanel = null;
  let currentUpdate = null;    // update(out) for the panel currently built
  let dismissTimer = null;
  let anchor = { anchorX: 0, anchorY: 0 };
  let lastSize = { width: 0, height: 0 };

  function clearDismissTimer() {
    if (dismissTimer !== null) { clearTimeout(dismissTimer); dismissTimer = null; }
  }
  function armDismiss() {
    clearDismissTimer();
    dismissTimer = setTimeout(() => dismiss(), MENU_DISMISS_MS);
  }

  async function fit(force) {
    const rect = panel.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const placement = menuPlacement({
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY,
      panelWidth: Math.ceil(rect.width * scale),
      panelHeight: Math.ceil(rect.height * scale),
      monitor,
    });
    if (!force && placement.width === lastSize.width && placement.height === lastSize.height) {
      return;
    }
    lastSize = { width: placement.width, height: placement.height };
    await win.setSize({ type: 'Physical', width: placement.width, height: placement.height });
    await win.setPosition({ type: 'Physical', x: placement.x, y: placement.y });
  }

  // Lets a panel builder ask for a re-fit when its own content changes
  // size (the mixer gaining or losing an app row).
  onContentResized = () => { fit(false).catch((e) => console.warn('panels: could not resize', e)); };
  dismissFromPanel = () => { dismiss(); };

  function buildPanel(panelId) {
    const builder = BUILDERS[panelId];
    if (!builder) { console.warn('panels: unknown panel', panelId); return false; }
    // Switching panels must stop whatever the outgoing one was polling.
    stopMixerPoll();
    stopNetPoll();
    stopClockTick();
    currentPanel = panelId;
    currentUpdate = builder(providers.outputMap) || (() => {});
    return true;
  }

  async function openPanel(msg) {
    if (!buildPanel(msg.panel)) return;
    anchor = { anchorX: msg.anchorX, anchorY: msg.anchorY };
    open = true;
    await fit(true);
    document.body.classList.add('open');
    armDismiss();
  }

  async function closePanel(notify) {
    clearDismissTimer();
    if (!open) return;
    stopMixerPoll();
    stopNetPoll();
    stopClockTick();
    open = false;
    document.body.classList.remove('open');
    if (notify) channel.post({ closed: true });
    await new Promise((r) => setTimeout(r, FADE_MS));
    if (!open) {
      lastSize = { width: 0, height: 0 };
      currentPanel = null;
      currentUpdate = null;
      await park();
    }
  }

  function dismiss() { closePanel(true); }

  // Interacting with the panel keeps it alive. These panels are operated, not
  // glanced at, so -- unlike statusmenu -- an in-panel click must NOT dismiss;
  // only the inactivity timer (re-armed here) and the bar (posting close) do.
  panel.addEventListener('pointerdown', () => { if (open) armDismiss(); });

  // Live-refresh the open panel in place as providers tick, and resize if the
  // content changed size.
  providers.onOutput(() => {
    if (!open || !currentUpdate) return;
    currentUpdate(providers.outputMap);
    fit(false).catch((e) => console.warn('panels: could not resize', e));
  });

  channel.subscribe((msg) => {
    if (msg.open) {
      if (!isAnchorOnMonitor(monitor, msg.anchorX, msg.anchorY)) return;
      // Config travels with the open command (see clockConfig). Kept from the
      // last command that carried one, so a re-open that omits it does not
      // silently drop back to the defaults.
      if (msg.clock !== undefined) clockConfig = msg.clock;
      if (open && msg.panel === currentPanel) {
        // Re-open of the same panel: refresh anchor + content, keep it alive.
        anchor = { anchorX: msg.anchorX, anchorY: msg.anchorY };
        if (currentUpdate) currentUpdate(providers.outputMap);
        fit(false).catch((e) => console.warn('panels: could not resize', e));
        armDismiss();
        return;
      }
      // Fresh open, or switching to a different panel while open.
      openPanel(msg).catch((e) => console.warn('panels: could not open', e));
    } else {
      closePanel(false).catch((e) => console.warn('panels: could not close', e));
    }
  });

  channel.post({ closed: true });
}

init().catch((e) => console.error('panels failed to initialise', e));
