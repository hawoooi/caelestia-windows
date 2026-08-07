// Layout metadata shared by the bar's collapsed layout button
// (bar/entries/layoutToggle.js) and the horizontal flyout widget that now
// renders the menu itself (layoutmenu/menu.js). It lives at the PACK root,
// alongside fullscreen.js, for the same reason that file does: two separate
// Zebar widget windows import it, so it cannot live under bar/entries/.
//
// Everything here was previously inside bar/entries/layoutToggle.js and is
// moved verbatim (comments included) rather than rewritten -- the history
// below is the evidence for why each mapping is what it is, and it is the
// only record of which parts were confirmed live versus inferred.
//
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

// Human-readable names for the flyout menu (direct user feedback: "can you
// change the layout changer button so that it opens horizontally to the
// side with text stating which mode is which"). The collapsed bar button
// stays glyph-only -- it has 52px to work with -- so these are used ONLY by
// layoutmenu/menu.js, plus the collapsed button's `title` tooltip.
//
// 'BSP' is kept as the acronym rather than expanded to "Binary space
// partition": it is what komorebi's own CLI, config and documentation call
// this layout, so expanding it here would be inventing a name the rest of
// the system never uses. The other three are title-cased versions of the
// same `komorebic change-layout` arguments.
const LAYOUT_LABELS = {
  bsp: 'BSP',
  columns: 'Columns',
  rows: 'Rows',
  grid: 'Grid',
};
const FALLBACK_LABEL = 'Unknown';

// Task 2 (feat/corner-overlays follow-up): normalises a provider-reported
// layout string before comparison -- lower-cases it and strips '-'/'_' so
// 'BSP', 'bsp', 'Bsp', 'right-main-vertical-stack' and
// 'right_main_vertical_stack' all compare equal. This was added
// defensively, in the same spirit as this module's own "already been bitten
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
// LIVE via a CDP session attached to the running widget --
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
// 'bsp' correctly before that task's fix, and the observed tofu (see
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

export function layoutLabel(cycleKey) {
  return LAYOUT_LABELS[cycleKey] ?? FALLBACK_LABEL;
}

// Cycles forward from the given cycle key. An unrecognized/null key (the
// provider hasn't reported, or reports a layout outside the curated four)
// starts the cycle at its first entry rather than throwing or no-op'ing.
//
// Kept (and still tested) even though nothing in the shipped click path
// calls it any more -- see layoutToggle.js's own note on why the cycle
// became a menu.
export function nextLayout(cycleKey) {
  const idx = LAYOUT_CYCLE.indexOf(cycleKey);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % LAYOUT_CYCLE.length;
  return LAYOUT_CYCLE[nextIdx];
}
