// The launcher: a search box at the bottom of the screen that opens on the
// Windows key, finds applications, and switches to a command palette on a `>`
// prefix. Direct user request, modelled on the Caelestia shell's own launcher.
//
// **The two things that make this possible were measured before it was built,
// because both looked likely to be impossible.**
//
// 1. *A Zebar widget can hold keyboard focus -- but only from outside.* The
//    window's own `setFocus` is refused: "Command plugin:window|set_focus not
//    allowed by ACL". That ACL governs the webview's JS, not the OS, and these
//    windows do NOT carry WS_EX_NOACTIVATE (exstyle 0x188 = TOOLWINDOW |
//    TOPMOST | WINDOWEDGE). An external SetForegroundWindow therefore works:
//    verified by sending real keystrokes through SendInput and reading them
//    back out of an <input>. So the helper focuses; the widget never tries to.
//
// 2. *A window parked at 1x1 can still be focused,* and `window.onfocus` fires
//    in the page when it happens. That is the entire open signal -- no polling,
//    no new helper process per tick, no IPC channel. It matters: this pack
//    already spawns fullscreen-detect.exe ~10x/second across nine widgets, and
//    the standing rule is that anything polled while nothing is on screen has
//    to justify itself against a process spawn.
//
// The helper finds this window by Zebar's OWN title, "Zebar - caelestia /
// launcher" -- Zebar names every widget window that way, so nothing here has
// to rename anything. (An earlier probe reported every window as titled "Z";
// that was a P/Invoke marshalling bug reading UTF-16 as ANSI, not a real
// finding.)
//
// Geometry is owned entirely by this file, exactly like every other flyout in
// the pack. The helper only ever focuses.

import * as zebar from '../bar/vendor/zebar.js';
import {
  COMMANDS, parseQuery, rank, moveSelection,
  listAppsCommand, appIconsCommand, parseAppList, parseIcons, appFolder,
  launchCommand, isSafeAppPath,
} from '../launcher-data.js';

// Where the window sits while closed. 1x1 rather than hidden because Zebar
// exposes no visibility toggle, and a transparent Zebar window still swallows
// every click inside its footprint -- a launcher-sized dead zone across the
// bottom of the screen would be intolerable.
export const PARKED_SIZE = 1;

// The panel's width, fixed. Deriving it from content would make the box
// breathe as results change length, which is exactly what a search field must
// not do while you are typing into it.
export const PANEL_W = 820;

// The fillets either side of the panel's bottom corners, and the amount the
// WINDOW is wider than the panel on each side to hold them.
//
// The panel sits FLUSH with the bottom of the screen -- direct user feedback,
// "I want the start menu to slide out connected to the bottom of the screen
// but why is it floating?".
//
// It was briefly raised to rest on the dock's top edge instead, which is what
// "floating" refers to: 56px of wallpaper under a panel that is supposed to be
// attached to the screen edge. Connected to the edge is the whole point -- it
// is what makes the slide read as the panel coming OUT of the edge rather than
// merely appearing near it, and it is what gives the arches a frame band to
// fillet into.
//
// Keep in step with launcher.css's --arch-w.
export const ARCH_W = 16;

// Matches launcher.css's --dur. The window must not shrink back until the
// slide-out has actually played, or the panel vanishes on its first frame
// instead of sliding away.
export const SLIDE_MS = 190;

// Rows shown at once. Beyond this the list is not more useful, it is just
// taller -- and the whole point of ranked matching is that the answer is in
// the first few.
export const MAX_ROWS = 8;

// After opening, ignore `blur` for this long. Growing and repositioning the
// window immediately after it is focused can produce a transient blur, and
// acting on it would close the launcher on the same gesture that opened it.
// This pack has been bitten by exactly this shape of fabricated event before
// (the dock's mouseleave firing 12ms after mouseenter with the pointer
// provably stationary), so the blur handler ALSO re-checks document.hasFocus()
// rather than trusting the event.
export const BLUR_GRACE_MS = 250;

// The application list is cheap to rebuild (measured: 70ms for 254 Start Menu
// entries) but not free, and it only changes when something is installed. This
// is long enough that repeated opens are instant and short enough that a newly
// installed app appears without a restart.
export const APP_CACHE_MS = 5 * 60 * 1000;

const panel = document.getElementById('panel');
const resultsEl = document.getElementById('results');
const inputEl = document.getElementById('input');
const closeEl = document.getElementById('close');

const shell = zebar.shellExec ? zebar : null;

let apps = [];
let appsAt = 0;
let appsInFlight = false;
const iconCache = new Map();   // path -> dataUrl | null ("no icon" is cached too)
let iconInFlight = false;
let iconWanted = null;         // the latest requested set, picked up when the current fetch ends

let entries = [];
let selected = 0;

async function loadApps(force) {
  if (!shell || appsInFlight) return;
  if (!force && apps.length && Date.now() - appsAt < APP_CACHE_MS) return;
  appsInFlight = true;
  try {
    const cmd = listAppsCommand();
    const res = await shell.shellExec(cmd.program, cmd.args);
    const parsed = parseAppList(res && res.stdout);
    if (parsed.length) { apps = parsed; appsAt = Date.now(); }
  } catch (e) {
    console.warn('launcher: could not list applications', e);
  } finally {
    appsInFlight = false;
  }
}

// Icons ONLY for the rows currently on screen, in ONE process.
//
// Measured on this machine: all 254 icons take 11.9 seconds (~47ms each, since
// ExtractAssociatedIcon resolves each shortcut and loads its target's icon),
// against 237ms for the eight that are actually visible. Fetching them all up
// front would make the launcher unusable; fetching them one process at a time
// would break this pack's spawn discipline. Both are avoided by asking for the
// visible set together.
// A request arriving while one is already running REPLACES the pending set
// rather than being dropped. Dropping it is what the first version did, and
// the symptom was subtle: type a query while the previous set's icons are
// still being extracted and the new rows keep their placeholders forever,
// because nothing ever asks again. Only the LATEST set is worth fetching --
// the rows in between are already off screen.
async function fetchIcons(paths) {
  if (!shell) return;
  iconWanted = paths;
  if (iconInFlight) return;
  iconInFlight = true;
  try {
    while (iconWanted) {
      const want = iconWanted;
      iconWanted = null;
      const missing = want.filter((p) => p && !iconCache.has(p));
      if (!missing.length) continue;
      try {
        const cmd = appIconsCommand(missing);
        const res = await shell.shellExec(cmd.program, cmd.args);
        const map = parseIcons(res && res.stdout);
        for (const p of missing) iconCache.set(p, map[p] ?? null);
      } catch (e) {
        // Remember the failure, or every keystroke re-probes the same paths.
        for (const p of missing) iconCache.set(p, null);
      }
      paintIcons();
    }
  } finally {
    iconInFlight = false;
  }
}

function paintIcons() {
  for (const img of resultsEl.querySelectorAll('.launcher__icon')) {
    const src = iconCache.get(img.dataset.path);
    if (src) { img.src = src; img.classList.remove('launcher__icon--missing'); }
  }
}

function render() {
  const { mode, term } = parseQuery(inputEl.value);
  entries = mode === 'command'
    ? rank(COMMANDS, term, { limit: MAX_ROWS })
    : rank(apps, term, { limit: MAX_ROWS });
  if (selected >= entries.length) selected = 0;

  resultsEl.textContent = '';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'launcher__row';
    row.classList.toggle('launcher__row--selected', i === selected);
    row.dataset.index = String(i);

    if (mode === 'command') {
      const glyph = document.createElement('span');
      glyph.className = 'launcher__glyph fa-solid';
      glyph.textContent = entry.glyph;
      row.appendChild(glyph);
    } else {
      const img = document.createElement('img');
      img.className = 'launcher__icon launcher__icon--missing';
      img.alt = '';
      img.dataset.path = entry.path;
      const cached = iconCache.get(entry.path);
      if (cached) { img.src = cached; img.classList.remove('launcher__icon--missing'); }
      row.appendChild(img);
    }

    const text = document.createElement('span');
    text.className = 'launcher__text';
    const name = document.createElement('span');
    name.className = 'launcher__name';
    name.textContent = entry.name;
    const detail = document.createElement('span');
    detail.className = 'launcher__detail';
    detail.textContent = mode === 'command' ? entry.detail : appFolder(entry.path);
    text.append(name, detail);
    row.appendChild(text);

    resultsEl.appendChild(row);
  }

  document.body.classList.toggle('no-matches', entries.length === 0);
  if (mode === 'app') fetchIcons(entries.map((e) => e.path));
  return mode;
}

function scrollSelectedIntoView() {
  const row = resultsEl.children[selected];
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

function select(delta) {
  if (!entries.length) return;
  selected = moveSelection(selected, delta, entries.length);
  for (let i = 0; i < resultsEl.children.length; i++) {
    resultsEl.children[i].classList.toggle('launcher__row--selected', i === selected);
  }
  scrollSelectedIntoView();
}

async function init() {
  const win = zebar.currentWidget().tauriWindow;

  // The monitor this instance belongs to, from its STARTING position before
  // anything below moves it -- the same matched pair with the zpack preset
  // every flyout here relies on: anchor top_left at offset (0,0), so
  // outerPosition() at this exact moment IS the monitor's origin.
  let origin = { x: 0, y: 0 };
  try {
    const pos = await win.outerPosition();
    origin = { x: pos.x, y: pos.y };
  } catch (e) {
    console.warn('launcher: could not read starting position', e);
  }
  const monitor = {
    x: origin.x,
    y: origin.y,
    width: window.screen.width,
    height: window.screen.height,
  };
  // One source of truth for the panel width: JS owns it, CSS reads it and
  // centres the panel inside the wider window.
  document.documentElement.style.setProperty('--panel-w', `${PANEL_W}px`);
  document.documentElement.style.setProperty('--arch-w', `${ARCH_W}px`);

  const scale = window.devicePixelRatio || 1;
  const px = (n) => Math.round(n * scale);

  let open = false;
  let openedAt = 0;

  async function park() {
    await win.setSize({ type: 'Physical', width: PARKED_SIZE, height: PARKED_SIZE });
    await win.setPosition({ type: 'Physical', x: monitor.x, y: monitor.y });
  }
  await park();

  // Resized to the panel's real height on every render, because the panel is
  // as tall as the number of results. Measured from the DOM rather than
  // computed from row counts, so the CSS stays the single source of truth for
  // padding and row height.
  async function fit() {
    const height = Math.ceil(panel.getBoundingClientRect().height);
    if (height < 20) return;    // a collapsed measurement is never worth applying
    // The window is the panel's height exactly -- it is the viewport the panel
    // slides into, so vertical slack would show as a gap under the panel -- and
    // an arch WIDER on each side, which is where the corner fillets paint.
    const winH = px(height);
    const winW = px(PANEL_W + ARCH_W * 2);
    await win.setSize({ type: 'Physical', width: winW, height: winH });
    await win.setPosition({
      type: 'Physical',
      x: monitor.x + Math.round((monitor.width - winW) / 2),
      // FLUSH with the bottom of the screen, overlapping the frame's own band,
      // the way the dashboard sits flush against the top. Nothing between the
      // panel and the edge it slides out of.
      y: monitor.y + monitor.height - winH,
    });
  }

  // Two frames, not one. The first lets the browser lay out and PAINT the
  // just-resized window with the panel still translated below it; the second
  // guarantees that paint has been committed before the class flips. A single
  // rAF gets coalesced with the style change often enough to matter, and the
  // transition is then skipped entirely. This is the same double-rAF the
  // dashboard uses for its slide, and for the same reason.
  const twoFrames = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function show() {
    if (open) return;
    open = true;
    openedAt = Date.now();
    inputEl.value = '';
    selected = 0;

    // ORDER IS THE WHOLE TRICK, and getting it wrong is why this popped
    // instead of sliding: the window has to be at its FINAL size and position
    // before `.open` is added. The class starts a CSS transition immediately,
    // so adding it while the window is still parked at 1x1 plays the entire
    // slide inside a one-pixel window -- by the time the window is resized the
    // animation has already finished, and all that is left to see is the panel
    // appearing fully formed.
    //
    // Measuring at 1x1 is safe here even though the panel is width:100%: every
    // row has a fixed height and its text is `white-space: nowrap`, so the
    // panel's height is a function of the row COUNT, never of the width it is
    // measured at. That is not luck -- it is why the rows are fixed-height.
    render();
    try { await fit(); } catch (e) { console.warn('launcher: could not size the panel', e); }
    await twoFrames();
    if (!open) return;                    // dismissed during the resize
    document.body.classList.add('open');

    inputEl.focus();
    inputEl.select();
    // Refresh the list AFTER the panel is up: the first open of a session pays
    // 70ms for it, and doing that before painting would show an empty panel
    // for exactly as long. init() warms it at startup so this is normally a
    // no-op and the panel does not visibly grow after opening.
    await loadApps(false);
    if (open) { render(); await fit().catch(() => {}); }
  }

  async function hide() {
    if (!open) return;
    open = false;
    document.body.classList.remove('open');
    // Let the slide-out actually play before the window shrinks out from
    // under it; shrinking first makes the panel vanish rather than slide.
    await new Promise((r) => setTimeout(r, SLIDE_MS));
    if (!open) await park().catch((e) => console.warn('launcher: could not park', e));
  }

  async function activate() {
    const entry = entries[selected];
    if (!entry) return;
    const { mode } = parseQuery(inputEl.value);
    await hide();
    if (!shell) return;
    try {
      if (mode === 'command') {
        await shell.shellExec(entry.run.program, entry.run.args);
      } else if (isSafeAppPath(entry.path)) {
        const cmd = launchCommand(entry.path);
        await shell.shellExec(cmd.program, cmd.args);
      }
    } catch (e) {
      console.warn('launcher: could not run entry', entry.name, e);
    }
  }

  // THE OPEN SIGNAL. The helper foregrounds this window; the OS focus event is
  // all the notification needed. See this file's header for why that is the
  // whole IPC story.
  window.addEventListener('focus', () => {
    show().catch((e) => console.error('launcher: could not open', e));
  });

  window.addEventListener('blur', () => {
    // Never trust a blur here. Growing and moving the window right after it is
    // focused can produce a transient one, and acting on it would close the
    // launcher on the gesture that opened it. Both guards are needed: the
    // grace period covers the open, and the hasFocus() re-check covers
    // everything after it.
    if (!open) return;
    if (Date.now() - openedAt < BLUR_GRACE_MS) return;
    setTimeout(() => {
      if (open && !document.hasFocus()) {
        hide().catch((e) => console.warn('launcher: could not close', e));
      }
    }, 40);
  });

  inputEl.addEventListener('input', () => {
    selected = 0;
    render();
    fit().catch(() => {});
  });

  inputEl.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        hide().catch(() => {});
        break;
      case 'ArrowDown':
        e.preventDefault();
        select(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        select(-1);
        break;
      case 'Tab':
        // Tab moves the selection rather than leaving the field -- there is
        // nowhere else in this window worth tabbing to, and losing the caret
        // would strand the launcher.
        e.preventDefault();
        select(e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        e.preventDefault();
        activate().catch((err) => console.warn('launcher: activate failed', err));
        break;
      default:
        break;
    }
  });

  resultsEl.addEventListener('click', (e) => {
    const row = e.target.closest ? e.target.closest('.launcher__row') : null;
    if (!row) return;
    selected = Number(row.dataset.index) || 0;
    activate().catch(() => {});
  });

  closeEl.addEventListener('click', () => { hide().catch(() => {}); });

  // Warm the list once at startup, off the critical path, so the very first
  // open is as fast as every later one.
  loadApps(true).catch(() => {});
}

init().catch((e) => console.error('launcher failed to initialise', e));
