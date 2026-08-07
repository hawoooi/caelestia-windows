import { register, create } from './registry.js';
import { statusRows } from '../../status-catalogue.js';
import { STATUS_CMD_KEY, STATUS_ACK_KEY, createChannel } from '../../widget-channel.js';

// Change 1 (lower-cluster restyle): Caelestia's visual language groups
// related lower-bar items onto ONE elevated rounded surface, not one boxed
// chip per icon -- the user explicitly rejected the "yasb-style separate
// chips" reading twice (see style.css's own comment on `.status-cluster`).
//
// Direct user feedback, this pass: "can you work on status bar icons that
// gets encapsulated like these wifi and volume icons ... remember to
// implement option for icons to get pinned to this bar or live inside a
// dropdown." So the cluster is no longer a fixed pair of child entries. It
// now renders whatever `status.pinned` in bar.config.json lists, from the
// shared catalogue (../../status-catalogue.js), and grows a trailing
// chevron that opens the rest in a dropdown -- the `statusmenu` flyout
// widget, same second-window machinery the layout menu uses because a Zebar
// widget still cannot paint outside its own 52px window.
//
// `vesktop` stays a fixed member of the cluster rather than a catalogue
// entry: it is a notification badge backed by a shellExec poll with its own
// lifecycle, not a provider readout, and folding it into the pure catalogue
// would give that module a process-spawning dependency. See
// ../../status-catalogue.js's own note.
//
// The chevron is only rendered when `status.dropdown` is non-empty -- this
// bar's standing rule (style.css's `.bar-btn` comment) is that anything
// that looks interactive must actually be interactive, so an overflow
// affordance that opens an empty panel would be exactly the lie that rule
// exists to prevent.

// FA6 Free Solid: chevron-right () collapsed, chevron-left ()
// while open -- the panel opens to the RIGHT of the bar, so the glyph points
// the way the panel will appear and then back toward the bar to close it.
// \uXXXX escapes, never pasted PUA glyphs (CLAUDE.md's Nerd Font rule).
export const CHEVRON_CLOSED = '\uF054';
export const CHEVRON_OPEN = '\uF053';

// Pure open/closed state for the dropdown, kept DOM-free and localStorage-
// free so it can be driven directly in tests -- same split as
// layoutToggle.js's createLayoutMenuController, and for the same reason.
export function createStatusMenuController() {
  let open = false;
  return {
    isOpen() { return open; },
    toggle() { open = !open; return open; },
    close() { const was = open; open = false; return was; },
    // The flyout acks every close it performs itself (its dismiss timer, a
    // click on its own surface, or the "I just restarted" message it posts
    // on startup). Anything arriving on that key means "the dropdown is not
    // open any more", whatever its payload -- there is nothing to validate
    // here the way the layout menu has to validate a selected layout name,
    // because this dropdown can never ask the bar to DO anything.
    applyAck() { const was = open; open = false; return was; },
  };
}

register('statusCluster', (ctx) => {
  const { statusConfig, shell } = ctx;
  const pinned = statusConfig?.pinned ?? [];
  const dropdown = statusConfig?.dropdown ?? [];

  const el = document.createElement('div');
  el.className = 'status-cluster';

  // Pinned catalogue icons, rebuilt from the row model on each tick.
  const pinnedEl = document.createElement('div');
  pinnedEl.className = 'status-icons';
  el.appendChild(pinnedEl);

  // vesktop keeps its own separately registered, separately tested factory
  // and its own DOM node -- composed via the registry's create(), never
  // duplicated here.
  const vesktop = create('vesktop', ctx);
  el.appendChild(vesktop.el);

  const controller = createStatusMenuController();
  const channel = createChannel(localStorage, window, {
    sendKey: STATUS_CMD_KEY,
    receiveKey: STATUS_ACK_KEY,
  });

  let toggle = null;
  if (dropdown.length > 0) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'status-more bar-btn fa-solid';
    toggle.textContent = CHEVRON_CLOSED;
    toggle.title = 'More status';
    el.appendChild(toggle);
  }

  // The bar window's origin, for converting the button's CSS-pixel rect into
  // the physical screen coordinates the flyout positions itself by. Read
  // once -- this window is docked to the left edge and never moves. Same
  // fail-soft default as layoutToggle.js.
  let winOrigin = { x: 0, y: 0 };
  if (shell && typeof shell.currentWidget === 'function') {
    Promise.resolve()
      .then(() => shell.currentWidget().tauriWindow.outerPosition())
      .then((pos) => { winOrigin = { x: pos.x, y: pos.y }; })
      .catch((e) => console.warn('statusCluster: could not read window position', e));
  }

  function anchor() {
    const rect = (toggle ?? el).getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    return {
      anchorX: Math.round(winOrigin.x + window.innerWidth * scale),
      anchorY: Math.round(winOrigin.y + (rect.top + rect.height / 2) * scale),
    };
  }

  // The most recent provider output, so the open dropdown can be refreshed
  // on every tick without the tick handler needing to know whether it is
  // open (update() below just calls postRows when it is).
  let lastOut = {};

  function postOpen() {
    channel.post({ open: true, rows: statusRows(dropdown, lastOut), ...anchor() });
  }
  function postClose() {
    channel.post({ open: false });
  }

  function syncToggleGlyph() {
    if (!toggle) return;
    const open = controller.isOpen();
    toggle.textContent = open ? CHEVRON_OPEN : CHEVRON_CLOSED;
    toggle.title = open ? 'Hide status' : 'More status';
  }

  function onDocumentClick(e) {
    if (toggle && e.target !== toggle && !toggle.contains(e.target)) {
      if (controller.close()) postClose();
      syncToggleGlyph();
      document.removeEventListener('click', onDocumentClick, true);
    }
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (controller.toggle()) {
        postOpen();
        document.addEventListener('click', onDocumentClick, true);
      } else {
        postClose();
        document.removeEventListener('click', onDocumentClick, true);
      }
      syncToggleGlyph();
    });

    channel.subscribe(() => {
      controller.applyAck();
      document.removeEventListener('click', onDocumentClick, true);
      syncToggleGlyph();
    });
  }

  function renderPinned(out) {
    const rows = statusRows(pinned, out);
    pinnedEl.replaceChildren(...rows.map((row) => {
      const d = document.createElement('div');
      d.className = 'status-icons__glyph fa-solid';
      d.textContent = row.glyph;
      // The pill has no room for a label, so the value lives in the tooltip
      // -- the one place a pinned icon can still say what it means.
      d.title = row.value ? `${row.label}: ${row.value}` : row.label;
      return d;
    }));
  }

  return {
    el,
    update(out) {
      lastOut = out;
      renderPinned(out);
      vesktop.update(out);
      // Live-refresh the open dropdown: cpu/memory move every tick, and a
      // panel frozen at its opening values would be actively misleading.
      if (controller.isOpen()) postOpen();
    },
  };
});
