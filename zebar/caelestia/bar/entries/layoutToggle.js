import { register } from './registry.js';
import {
  LAYOUT_CYCLE,
  currentLayout,
  layoutGlyph,
  layoutLabel,
  nextLayout,
  normalizeLayoutString,
} from '../../layouts.js';
import { CMD_KEY, ACK_KEY, createChannel } from '../../layout-channel.js';

// The layout metadata this module used to own (LAYOUT_CYCLE, the Font
// Awesome glyph table, the provider->cycle mapping and its live-verified
// history) moved to ../../layouts.js when the menu became a second widget
// window, which needs the same table. Re-exported here unchanged so this
// module stays the single import site for everything layout-related in the
// bar, and so tests/js/entries.test.mjs keeps importing from one place.
export {
  LAYOUT_CYCLE,
  currentLayout,
  layoutGlyph,
  layoutLabel,
  nextLayout,
  normalizeLayoutString,
};

export const KOMOREBIC_PATH = 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe';

export function changeLayoutCommand(layout) {
  return { program: KOMOREBIC_PATH, args: ['change-layout', layout] };
}

// nextLayout()/LAYOUT_CYCLE's ordering are kept exported (and still tested,
// see tests/js/entries.test.mjs) even though the click handler below no
// longer calls nextLayout() at all -- direct user feedback: "can we make
// the switch button a menu instead of blindly toggling as it messes up my
// windows." Cycling forward one step at a time meant reaching a layout N
// steps away required N intermediate `change-layout` calls, and komorebi
// retiles every real window on EACH one -- destructive to whatever the user
// had arranged, not just cosmetic. The menu always fires at most one
// `change-layout` call, for the exact layout the user picked.
//
// Follow-up, also direct user feedback: "can you change the layout changer
// button so that it opens horizontally to the side with text stating which
// mode is which instead of vertically?" The menu's DOM used to live inside
// this entry, expanding upward inside the bar's own 52px-wide window --
// upward because sideways was impossible, not because it was better. It now
// lives in a SEPARATE Zebar widget (../../layoutmenu/) that can paint beside
// the bar, driven over ../../layout-channel.js. See that module's comment
// for why a second window is the only way to get a pixel outside the bar on
// this build, and docs/zebar-bar.md's "The horizontal layout menu" for the
// whole account.
//
// What stayed here on purpose: the komorebic call, the tracked current
// layout, and the "picking the active layout is a no-op" rule. The flyout
// reports a click and nothing more, so there is still exactly one place
// that decides whether a `change-layout` actually happens.

// Pure, DOM-free state machine for the menu: open/closed, which layout is
// currently tracked as "active" (for the flyout's marker and the bar
// button's own glyph), and the no-redundant-call rule. Kept free of
// `document`, `shellExec` and localStorage plumbing on purpose so
// open/close/select can be driven and asserted directly in
// tests/js/entries.test.mjs without a DOM.
//
// **Honesty about live vs. not** (docs/zebar-bar.md's own finding, "the
// komorebi provider's `layout` field does not appear to re-emit live" --
// confirmed live, three layouts, zero re-emissions across 3-10s each): the
// zebar komorebi provider only reports a workspace's layout at CONNECT
// time; it does not push a fresh value while the widget keeps running and
// the layout changes underneath it, whether via `komorebic change-layout`
// run externally or a hotkey. Re-reading the provider on every tick
// (the OLD code's `currentLayout(out.komorebi)` in update(), called fresh
// every time) would therefore just keep re-reading the SAME stale
// connect-time value forever -- which, with a menu, is actively harmful:
// it would silently overwrite the "active" marker back to a stale layout
// the instant after the user picked a different one through this exact
// menu, on the very next provider tick. `sync()` below establishes the
// tracked baseline from the provider only ONCE (the first non-null read,
// i.e. connect time) and never again -- from then on, `current` moves ONLY
// in response to a user's own `select()` call, which is the one thing this
// pack CAN make genuinely accurate for every user-driven pick without
// adding a per-tick `komorebic` shell-out (explicitly ruled out -- this
// pack has already lost two debugging sessions to an orphaned shellExec
// helper, `fullscreen-detect.exe`, inheriting zebar's own listening socket;
// see fullscreen.js's doc comment). A layout changed by hotkey while this
// widget keeps running will still show stale in the menu's marker until the
// widget restarts -- documented, not silently papered over.
export function createLayoutMenuController(shell) {
  let open = false;
  let current = null;

  function runChangeLayout(layout) {
    if (!shell || typeof shell.shellExec !== 'function') {
      console.warn('layoutToggle: no shell handle in ctx, cannot run komorebic');
      return;
    }
    const { program, args } = changeLayoutCommand(layout);
    // Fail soft, same pattern as workspaces.js's focus-workspace click: a
    // rejected/failed shellExec warns to console and never throws out of
    // the click handler (which runs outside bar.js's per-entry try/catch).
    shell.shellExec(program, args).catch((e) => {
      console.warn(`change-layout ${layout} failed`, e);
    });
  }

  return {
    isOpen() { return open; },
    getCurrent() { return current; },

    // Called on every provider tick with currentLayout(out.komorebi). See
    // the module comment above for why this only ever establishes the
    // baseline once, never overwrites a user's own pick.
    sync(providerLayout) {
      if (current === null && providerLayout !== null) {
        current = providerLayout;
      }
    },

    // Main-button click: opens or closes the menu. Never touches `shell`,
    // never changes `current` -- opening/closing the menu must never itself
    // change the layout.
    toggle() {
      open = !open;
      return open;
    },

    // Dismiss without choosing (the flyout timed out, or a click landed
    // elsewhere in the bar). Returns whether the menu was actually open, so
    // callers can skip redundant work.
    close() {
      const wasOpen = open;
      open = false;
      return wasOpen;
    },

    // Menu-item click, relayed from the flyout widget. Always closes the
    // menu (choosing ANY item, including the already-active one, is a
    // complete action). Fires `change-layout` -- exactly once -- only when
    // the picked layout differs from the tracked current one; picking the
    // active layout is a no-op, not a redundant call. Returns { changed }
    // so callers/tests can assert on which branch ran without reaching into
    // `shell` themselves.
    select(layout) {
      open = false;
      if (layout === current) {
        return { changed: false };
      }
      current = layout; // optimistic local update -- see module comment
      runChangeLayout(layout);
      return { changed: true };
    },

    // Handles an ack posted by the flyout widget: either a pick, or a
    // close-without-choosing (its dismiss timer, a click on its own
    // padding, or the "I just restarted and am definitely closed" message
    // it posts on startup). Unknown layout names are treated as a plain
    // close rather than passed through to `komorebic` -- the flyout is a
    // separate document and anything arriving over localStorage is treated
    // as untrusted input, not as a value this module chose.
    applyAck(ack) {
      const picked = ack && ack.selected;
      if (typeof picked === 'string' && LAYOUT_CYCLE.includes(picked)) {
        return this.select(picked);
      }
      this.close();
      return { changed: false };
    },
  };
}

register('layoutToggle', ({ shell }) => {
  // The DOM this entry renders is a single button again -- the menu itself
  // is ../../layoutmenu/, a separate widget window. Collapsed (which is now
  // the only state this entry has) it shows exactly the current layout's
  // glyph, same as it always has.
  const btn = document.createElement('button');
  btn.type = 'button';
  // 'bar-btn' (style.css): the one shared clickable-affordance style.
  // 'fa-solid': every glyph in ../../layouts.js is a Font Awesome Free Solid
  // codepoint, rendered through the locally vendored webfont.
  btn.className = 'layout-toggle bar-btn fa-solid';

  const controller = createLayoutMenuController(shell);
  const channel = createChannel(localStorage, window, { sendKey: CMD_KEY, receiveKey: ACK_KEY });

  // The bar's own window position, needed to convert the button's CSS-pixel
  // rect into the physical screen coordinates the flyout positions itself
  // by. Read once: this window is docked to the left edge and never moves.
  // Fail-soft to the origin, which is where the docked bar actually is on
  // this machine -- a wrong-but-plausible anchor beats no menu at all.
  let winOrigin = { x: 0, y: 0 };
  if (shell && typeof shell.currentWidget === 'function') {
    Promise.resolve()
      .then(() => shell.currentWidget().tauriWindow.outerPosition())
      .then((pos) => { winOrigin = { x: pos.x, y: pos.y }; })
      .catch((e) => console.warn('layoutToggle: could not read window position', e));
  }

  function anchor() {
    const rect = btn.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    return {
      // Right edge of the bar window, not of the button: the flyout should
      // clear the whole 52px strip, not just the 32px circle centred in it.
      anchorX: Math.round(winOrigin.x + window.innerWidth * scale),
      anchorY: Math.round(winOrigin.y + (rect.top + rect.height / 2) * scale),
    };
  }

  function postOpen() {
    channel.post({ open: true, current: controller.getCurrent(), ...anchor() });
  }

  function postClose() {
    channel.post({ open: false });
  }

  // Reliable ONLY for clicks that land inside this widget's own document.
  // A click on some other OS window never reaches this handler at all --
  // that is what the flyout's own dismiss timer is for. Registered only
  // while the menu is open and removed on every close path, so it never
  // becomes a permanent listener leaking across entry lifetimes.
  function onDocumentClick(e) {
    if (e.target !== btn && !btn.contains(e.target)) {
      if (controller.close()) postClose();
      document.removeEventListener('click', onDocumentClick, true);
    }
  }

  function renderButtonGlyph() {
    const cur = controller.getCurrent();
    btn.textContent = layoutGlyph(cur);
    btn.title = cur
      ? `Tiling layout: ${layoutLabel(cur)} (click to choose)`
      : 'Tiling layout (click to choose)';
  }

  btn.addEventListener('click', () => {
    // Opening/closing the menu never calls change-layout -- toggle() only
    // ever flips the open/closed flag.
    if (controller.toggle()) {
      postOpen();
      document.addEventListener('click', onDocumentClick, true);
    } else {
      postClose();
      document.removeEventListener('click', onDocumentClick, true);
    }
  });

  channel.subscribe((ack) => {
    controller.applyAck(ack);
    document.removeEventListener('click', onDocumentClick, true);
    renderButtonGlyph();
  });

  return {
    el: btn,
    update(out) {
      controller.sync(currentLayout(out.komorebi));
      renderButtonGlyph();
    },
  };
});
