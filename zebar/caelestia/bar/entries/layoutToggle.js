import { register } from './registry.js';

// Change 3: a bar button that cycles komorebi's tiling layout. Curated,
// not the full komorebic change-layout enum -- verified LIVE against this
// machine's real komorebic.exe (not assumed): `change-layout <name>` for
// every value in LAYOUT_CYCLE below, then re-reading `komorebic state`,
// showed komorebi accepts and reports back each one with no error and no
// disruption to the running zebar bar (workspaces/active-window/clock kept
// rendering through every swap; zebar's own errors.log gained zero new
// lines across the whole test).
//
// 'columns' specifically needed the live check: it is NOT one of the eight
// strings zebar's own KomorebiLayout TypeScript union declares (checked
// directly against `zebar@3.3.1`'s shipped dist/index.d.ts, the same
// source that caught the isFocused/focusedContainerIndex mistake elsewhere
// in this pack -- see activeWindow.js/docs/zebar-bar.md): bsp |
// vertical_stack | horizontal_stack | ultrawide_vertical_stack | rows |
// grid | right_main_vertical_stack | custom. So while the CLI call itself
// is confirmed safe (tested live, above), what the PROVIDER reports back
// for a workspace whose layout is 'Columns' needed confirming too -- see
// PROVIDER_TO_CYCLE's own comment below for what that turned out to be,
// read live via CDP against the running widget, not inferred from the CLI.
export const LAYOUT_CYCLE = ['bsp', 'columns', 'rows', 'grid'];

// Task 3 (Font Awesome icons): these were raw Unicode box-drawing glyphs
// (BMP characters, survived typed raw -- see logo.js's own note) with no
// real relationship to Font Awesome. Now real Font Awesome Free 6.x Solid
// icons chosen for their layout-shape resemblance, confirmed present in
// Font Awesome's own metadata/icons.json for the 6.x release: \uF542
// (diagram-project, "Diagram Project" -- a branching tree/split shape for
// bsp, komorebi's own binary-space-partition layout), \uF0DB
// (table-columns, "Table Columns" -- vertical columns), \uF0C9 (bars,
// "Bars" -- three stacked horizontal bars, a literal "rows" shape),
// \uF00A (table-cells, "Table Cells" -- an even grid). FALLBACK_GLYPH
// (\uF84C, border-all, "Border All" -- a generic bordered-box "unknown
// layout" mark) is used for any provider report outside the curated four,
// per the module comment above.
const LAYOUT_GLYPHS = {
  bsp: '\uF542',
  columns: '\uF0DB',
  rows: '\uF0C9',
  grid: '\uF00A',
};
const FALLBACK_GLYPH = '\uF84C';

// Task 2 (feat/corner-overlays follow-up): normalises a provider-reported
// layout string before comparison -- lower-cases it and strips '-'/'_' so
// 'BSP', 'bsp', 'Bsp', 'right-main-vertical-stack' and
// 'right_main_vertical_stack' all compare equal. This was added
// defensively, in the same spirit as this file's own "already been bitten
// twice by assuming a provider field's shape" history (the invented
// `isFocused` field; this same gap). It turned out NOT to be live for
// bsp/rows/grid on this machine's actual zebar@3.3.1 build -- see
// PROVIDER_TO_CYCLE's own comment immediately below for what WAS found
// live -- but a future zebar/komorebi version silently changing that
// casing convention (the way `komorebic state`'s own raw CLI JSON already
// reports the unrelated field `layout.Default` as "BSP", capitalised)
// shouldn't be able to reintroduce this exact bug a third time.
export function normalizeLayoutString(reported) {
  return String(reported).toLowerCase().replace(/[-_]/g, '');
}

// What the ZEBAR PROVIDER itself puts in `focusedWorkspace.layout` was read
// LIVE (this task) via a CDP session attached to the running widget --
// window.__zebarDebugProviders.outputMap.komorebi.focusedWorkspace.layout,
// not inferred from `komorebic state`'s own CLI JSON, which is a
// differently-shaped, differently-cased field entirely (`layout: { Default:
// "BSP" }`, capitalised and nested under a variant tag -- confirmed by
// running `komorebic state` alongside the same CDP session). The provider's
// own field turned out to already be a flat, lower-case string matching
// zebar's KomorebiLayout TS union: `change-layout bsp` -> `"bsp"`,
// `change-layout rows` -> `"rows"`, `change-layout grid` -> `"grid"` --
// i.e. the CLI-vs-provider casing gap this module used to warn about was
// NOT the operative bug for these three; `currentLayout` already resolved
// 'bsp' correctly before this task's fix, and the observed tofu (see
// docs/zebar-bar.md) was entirely the separate `.bar-btn`/`.fa-solid` CSS
// cascade bug fixed in style.css, not a mapping miss.
//
// `change-layout columns` -> read back as exactly `"custom"` -- confirmed
// live, not the guess the pre-fix comment made. 'custom' is the SAME bucket
// every other layout outside zebar's confirmed 8-value union also falls
// into (vertical_stack, horizontal_stack, ultrawide_vertical_stack,
// right_main_vertical_stack all report their own literal names -- only
// 'columns' isn't a recognized union member at all, so it's the one CLI
// value that collapses to 'custom'). Mapping 'custom' -> 'columns' here is
// therefore a deliberate simplification, not a precise inverse of the CLI:
// 'columns' is the only 'custom'-bucket layout THIS BUTTON can ever set, so
// in normal use (only ever changed via this button, never a hotkey to one
// of the other custom-bucket layouts) the mapping is correct. If a layout
// is changed to e.g. vertical_stack by some other means, this button will
// show the columns glyph for it too -- a known, documented imprecision
// rather than a silent one, same as the fallback-glyph gap this file has
// always disclosed for anything else outside the curated four.
const PROVIDER_TO_CYCLE = {
  bsp: 'bsp',
  rows: 'rows',
  grid: 'grid',
  custom: 'columns',
};

// Reads the CURRENT layout from the komorebi provider's own workspace
// object -- never tracked in local state -- so the button stays correct
// even when the layout was last changed by hotkey rather than this button.
// Returns one of LAYOUT_CYCLE's own values, or null when the provider
// hasn't reported yet or reports something outside the curated cycle.
export function currentLayout(komorebi) {
  const reported = komorebi?.focusedWorkspace?.layout;
  if (typeof reported !== 'string') return null;
  return PROVIDER_TO_CYCLE[normalizeLayoutString(reported)] ?? null;
}

export function layoutGlyph(cycleKey) {
  return LAYOUT_GLYPHS[cycleKey] ?? FALLBACK_GLYPH;
}

// Cycles forward from the given cycle key. An unrecognized/null key (the
// provider hasn't reported, or reports a layout outside the curated four)
// starts the cycle at its first entry rather than throwing or no-op'ing.
export function nextLayout(cycleKey) {
  const idx = LAYOUT_CYCLE.indexOf(cycleKey);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % LAYOUT_CYCLE.length;
  return LAYOUT_CYCLE[nextIdx];
}

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
// had arranged, not just cosmetic. The menu below always fires at most one
// `change-layout` call, for the exact layout the user picked.

// Auto-dismiss timeout for the open menu. There is no reliable "click
// outside" INSIDE this widget's own 52px-wide window -- clicking away to
// the user's real work happens in a DIFFERENT OS window, whose clicks this
// widget's document never receives at all (the same click-routing wall
// docs/zebar-bar.md's "Known-incomplete: the media drawer" section already
// hit: pointer-events has no OS-level click-through effect on this
// Zebar/WebView2 build, and the inverse is also true -- this widget gets no
// signal when the user clicks a window that isn't it). A same-document
// "click outside the menu, still inside this widget" listener IS reliable
// (see onDocumentClick below) and is wired as a secondary dismiss path, but
// the timeout is the PRIMARY one, since the common case is the user picks a
// layout or clicks away to their actual work, not clicking bar padding.
// 6s was picked to comfortably outlast reading four glyphs and deciding,
// without leaving a stale open menu sitting over the vacant middle run for
// so long it reads as stuck.
const MENU_DISMISS_MS = 6000;

// Pure, DOM-free state machine for the menu: open/closed, which layout is
// currently tracked as "active" (for the menu's marker and the collapsed
// button's own glyph), and the no-redundant-call rule. Modelled on
// activeWindow.js's createIconController -- kept free of `document` and
// `shellExec` plumbing on purpose so open/close/select can be driven and
// asserted directly in tests/js/entries.test.mjs without a DOM.
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

    // Dismiss without choosing (timeout or click-outside). Returns whether
    // the menu was actually open, so callers can skip redundant DOM work.
    close() {
      const wasOpen = open;
      open = false;
      return wasOpen;
    },

    // Menu-item click. Always closes the menu (choosing ANY item, including
    // the already-active one, is a complete action). Fires `change-layout`
    // -- exactly once -- only when the picked layout differs from the
    // tracked current one; picking the active layout is a no-op, not a
    // redundant call. Returns { changed } so callers/tests can assert on
    // which branch ran without reaching into `shell` themselves.
    select(layout) {
      open = false;
      if (layout === current) {
        return { changed: false };
      }
      current = layout; // optimistic local update -- see module comment
      runChangeLayout(layout);
      return { changed: true };
    },
  };
}

register('layoutToggle', ({ shell }) => {
  // The DOM this entry now renders:
  //   <div class="layout-toggle-wrap">          <- inst.el; render.js adds
  //                                                 "entry" to THIS, sized
  //                                                 by the button alone
  //                                                 (the menu is
  //                                                 position: absolute, so
  //                                                 it contributes no box
  //                                                 to the wrap's own flex
  //                                                 size when collapsed --
  //                                                 collapsed, this entry
  //                                                 occupies exactly the
  //                                                 same footprint the bare
  //                                                 button used to)
  //     <div class="layout-menu">                <- absolutely positioned,
  //                                                  bottom: 100% of the
  //                                                  wrap -- expands UPWARD,
  //                                                  overlaying the vacant
  //                                                  middle run
  //                                                  (activeWindow + its two
  //                                                  spacers), never
  //                                                  shoving the bottom
  //                                                  group (clock /
  //                                                  statusCluster / power)
  //                                                  down or the top group
  //                                                  up
  //       <button class="layout-menu__item ...">  one per LAYOUT_CYCLE entry
  //       ...
  //     </div>
  //     <button class="layout-toggle ...">        <- unchanged glyph/title
  //                                                   contract: collapsed,
  //                                                   this still shows
  //                                                   exactly the current
  //                                                   layout's glyph, same
  //                                                   as before the menu
  //                                                   existed
  //   </div>
  const wrap = document.createElement('div');
  wrap.className = 'layout-toggle-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  // 'bar-btn' (style.css): the one shared clickable-affordance style,
  // applied here because this button has a real click handler below --
  // styled consistently with change 1's power button, per the brief.
  // 'fa-solid' (Task 3): every LAYOUT_GLYPHS/FALLBACK_GLYPH codepoint above
  // is a Font Awesome Free Solid glyph, rendered through the locally
  // vendored webfont.
  btn.className = 'layout-toggle bar-btn fa-solid';

  const menu = document.createElement('div');
  menu.className = 'layout-menu';

  const controller = createLayoutMenuController(shell);
  const items = new Map(); // layout key -> its menu button, for the active marker

  let dismissTimer = null;
  function clearDismissTimer() {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }
  function armDismissTimer() {
    clearDismissTimer();
    dismissTimer = setTimeout(() => {
      controller.close();
      syncOpenClass();
      document.removeEventListener('click', onDocumentClick, true);
    }, MENU_DISMISS_MS);
  }

  // Reliable ONLY for clicks that land inside this widget's own document
  // (see the module comment on MENU_DISMISS_MS for why a click on some
  // other OS window can never reach this handler at all). Registered only
  // while the menu is open, removed on every close path, so this never
  // becomes a permanent listener leaking across entry lifetimes.
  function onDocumentClick(e) {
    if (!wrap.contains(e.target)) {
      controller.close();
      syncOpenClass();
      clearDismissTimer();
      document.removeEventListener('click', onDocumentClick, true);
    }
  }

  function syncOpenClass() {
    wrap.classList.toggle('layout-toggle-wrap--open', controller.isOpen());
  }

  function renderActiveMarker() {
    const cur = controller.getCurrent();
    for (const [layout, itemEl] of items) {
      itemEl.classList.toggle('layout-menu__item--active', layout === cur);
    }
  }

  function renderButtonGlyph() {
    const cur = controller.getCurrent();
    btn.textContent = layoutGlyph(cur);
    btn.title = cur ? `Tiling layout: ${cur} (click to choose)` : 'Tiling layout (click to choose)';
  }

  LAYOUT_CYCLE.forEach((layout) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'layout-menu__item bar-btn fa-solid';
    item.textContent = layoutGlyph(layout);
    item.title = `Tiling layout: ${layout}`;
    item.addEventListener('click', () => {
      // select() always closes the menu and only fires change-layout when
      // this differs from the tracked current layout -- see
      // createLayoutMenuController's own doc comment.
      controller.select(layout);
      syncOpenClass();
      clearDismissTimer();
      document.removeEventListener('click', onDocumentClick, true);
      renderActiveMarker();
      renderButtonGlyph();
    });
    items.set(layout, item);
    menu.appendChild(item);
  });

  btn.addEventListener('click', () => {
    // Opening/closing the menu never calls change-layout -- toggle() only
    // ever flips the open/closed flag.
    const isOpen = controller.toggle();
    syncOpenClass();
    if (isOpen) {
      renderActiveMarker();
      armDismissTimer();
      document.addEventListener('click', onDocumentClick, true);
    } else {
      clearDismissTimer();
      document.removeEventListener('click', onDocumentClick, true);
    }
  });

  wrap.append(menu, btn);

  return {
    el: wrap,
    update(out) {
      controller.sync(currentLayout(out.komorebi));
      renderButtonGlyph();
      renderActiveMarker();
    },
  };
});
