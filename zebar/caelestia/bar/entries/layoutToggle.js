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
// for a workspace whose layout is 'Columns' is unconfirmed -- most likely
// it lands in the 'custom' bucket. PROVIDER_TO_CYCLE below only maps the
// three cycle values that ARE in the confirmed union (bsp/rows/grid);
// 'columns' (and every other unrecognized/'custom' report) falls through
// to FALLBACK_GLYPH rather than guessing a specific glyph for a shape
// that's never been directly observed.
export const LAYOUT_CYCLE = ['bsp', 'columns', 'rows', 'grid'];

const LAYOUT_GLYPHS = {
  bsp: '◨',
  columns: '▥',
  rows: '▤',
  grid: '▦',
};
const FALLBACK_GLYPH = '▧';

// What the CLI's `change-layout` argument spells vs. what the PROVIDER
// reports back in `focusedWorkspace.layout` are two different spellings
// (kebab-case CLI argument vs. snake_case provider string) -- the same gap
// workspaces.js already documents between komorebic's zero-indexed
// `focus-workspace` target and the workspace *name* the buttons display.
const PROVIDER_TO_CYCLE = {
  bsp: 'bsp',
  rows: 'rows',
  grid: 'grid',
};

// Reads the CURRENT layout from the komorebi provider's own workspace
// object -- never tracked in local state -- so the button stays correct
// even when the layout was last changed by hotkey rather than this button.
// Returns one of LAYOUT_CYCLE's own values, or null when the provider
// hasn't reported yet or reports something outside the curated cycle
// (including, most likely, 'columns' itself -- see the module comment).
export function currentLayout(komorebi) {
  const reported = komorebi?.focusedWorkspace?.layout;
  if (typeof reported !== 'string') return null;
  return PROVIDER_TO_CYCLE[reported] ?? null;
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

register('layoutToggle', ({ shell, providers }) => {
  const el = document.createElement('button');
  el.type = 'button';
  // 'bar-btn' (style.css): the one shared clickable-affordance style,
  // applied here because this button has a real click handler below --
  // styled consistently with change 1's power button, per the brief.
  el.className = 'layout-toggle bar-btn';

  el.addEventListener('click', () => {
    if (!shell) {
      console.warn('layoutToggle: no shell handle in ctx, cannot run komorebic');
      return;
    }
    // Reads the live provider output at CLICK time, not a value captured
    // by update()'s closure -- avoids ever acting on a stale layout if a
    // hotkey changed it between the last tick and this click.
    const out = providers?.outputMap ?? {};
    const cur = currentLayout(out.komorebi) ?? 'bsp';
    const next = nextLayout(cur);
    const { program, args } = changeLayoutCommand(next);
    // Fail soft, same pattern as workspaces.js's focus-workspace click: a
    // rejected/failed shellExec warns to console and never throws out of
    // the click handler (which runs outside bar.js's per-entry try/catch).
    shell.shellExec(program, args).catch((e) => {
      console.warn(`change-layout ${next} failed`, e);
    });
  });

  return {
    el,
    update(out) {
      const cur = currentLayout(out.komorebi);
      el.textContent = layoutGlyph(cur);
      el.title = cur ? `Tiling layout: ${cur} (click to cycle)` : 'Tiling layout (click to cycle)';
    },
  };
});
