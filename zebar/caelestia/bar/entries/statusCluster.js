import { register } from './registry.js';
import { statusRows } from '../../status-catalogue.js';
import { STATUS_CMD_KEY, STATUS_ACK_KEY, PANELS_CMD_KEY, PANELS_ACK_KEY, createChannel } from '../../widget-channel.js';

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

// FA6 Free Solid gauge-high (U+F625) -- a performance/monitor gauge for the
// system-stats dropdown (cpu/memory/disk/battery). Deliberately NOT a chevron:
// the tray trigger below now owns the > / < chevrons, so a chevron here would
// make the two adjacent controls look identical. Static glyph -- the panel
// appearing is the open/close feedback, and the title still toggles.
// \uXXXX escape, verified present in the vendored fa-solid webfont.
export const MONITOR_GLYPH = '\uF625';

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

  // vesktop USED to be composed in here. It now has its own group (see
  // entries/discord.js) on direct user feedback -- one pill per kind of thing,
  // and a single app's live notification count is not a system readout like
  // the pinned wifi/volume glyphs beside it. The factory is unchanged and
  // still composed via create(), just from there instead of here.

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
    toggle.textContent = MONITOR_GLYPH;
    toggle.title = 'System stats';
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

  // --- panel triggers -------------------------------------------------------
  // Pinned glyphs that map to a panel (network -> the network panel, volume ->
  // the volume panel) become clickable: a click opens that panel in the shared
  // `panels` flyout, anchored beside the glyph. This is separate from the
  // dropdown chevron above -- that drives the statusmenu readout (cpu/mem/...),
  // this drives the interactive panels. A pinned glyph with no panel stays a
  // plain, non-interactive readout, so the affordance never lies.
  const PANEL_FOR = { network: 'network', volume: 'volume' };
  const panelsChannel = createChannel(localStorage, window, {
    sendKey: PANELS_CMD_KEY,
    receiveKey: PANELS_ACK_KEY,
  });
  let openPanel = null;

  function glyphAnchor(node) {
    const rect = node.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    return {
      anchorX: Math.round(winOrigin.x + window.innerWidth * scale),
      anchorY: Math.round(winOrigin.y + (rect.top + rect.height / 2) * scale),
    };
  }
  function onPanelDocClick(e) {
    // Clicks inside the pill's pinned row switch panels (handled by the glyph's
    // own listener); a click anywhere else closes.
    if (!pinnedEl.contains(e.target)) {
      if (openPanel !== null) { openPanel = null; panelsChannel.post({ open: false }); renderPinned(lastOut); }
      document.removeEventListener('click', onPanelDocClick, true);
    }
  }
  function togglePanel(panelId, node) {
    if (openPanel === panelId) {
      openPanel = null;
      panelsChannel.post({ open: false });
      document.removeEventListener('click', onPanelDocClick, true);
    } else {
      openPanel = panelId;
      panelsChannel.post({ open: true, panel: panelId, ...glyphAnchor(node) });
      document.addEventListener('click', onPanelDocClick, true);
    }
    renderPinned(lastOut);
  }
  // The flyout acks a real close (its dismiss timer, or the "I just restarted"
  // message it posts on startup). Any ack means "not open any more" -- clear
  // the active tint and the stuck flag, matching how the chevron handles its
  // own ack above.
  panelsChannel.subscribe(() => {
    if (openPanel !== null) {
      openPanel = null;
      document.removeEventListener('click', onPanelDocClick, true);
      renderPinned(lastOut);
    }
  });

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
    toggle.textContent = MONITOR_GLYPH;
    toggle.title = open ? 'Hide system stats' : 'System stats';
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
      const panelId = PANEL_FOR[row.id];
      // A pinned glyph that maps to a panel is a real button (clickable
      // affordance, honest per style.css's .bar-btn rule); one that does not
      // stays a plain readout div.
      const node = document.createElement(panelId ? 'button' : 'div');
      node.className = 'status-icons__glyph fa-solid' + (panelId ? ' status-icons__glyph--btn' : '');
      node.textContent = row.glyph;
      // The pill has no room for a label, so the value lives in the tooltip
      // -- the one place a pinned icon can still say what it means.
      node.title = row.value ? `${row.label}: ${row.value}` : row.label;
      if (panelId) {
        node.type = 'button';
        if (openPanel === panelId) node.classList.add('is-active');
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePanel(panelId, node);
        });
      }
      return node;
    }));
  }

  return {
    el,
    update(out) {
      lastOut = out;
      renderPinned(out);
      // Live-refresh the open dropdown: cpu/memory move every tick, and a
      // panel frozen at its opening values would be actively misleading.
      if (controller.isOpen()) postOpen();
    },
  };
});
