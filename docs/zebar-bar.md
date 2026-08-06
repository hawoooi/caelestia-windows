# Caelestia-style Zebar bar — working knowledge

A second, vertical bar docked to the left edge of the primary monitor, built as a Zebar pack and
themed by the same matugen pipeline documented in `CLAUDE.md`. It runs **alongside** yasb (which
stays docked at the top) — this is an addition, not a replacement. Read this before changing
anything under `zebar/`.

**Status of this feature as of Task 10: the bar's code is complete and committed, but WebView2 is
currently broken on this machine (see "Troubleshooting: WebView2 renders nothing" below), so the
bar's own visual output has not been re-confirmed since Task 8. The media drawer/panel is
explicitly NOT shipped as a working feature — see "Known-incomplete: the media drawer" below.**

## The stack

| Thing | Where |
|---|---|
| Zebar (v3.3.1) | `C:\Program Files\glzr.io\Zebar\zebar.exe` — CLI-only interaction, no GUI installer/manager on this machine |
| Pack source (tracked) | `zebar/caelestia/` in this repo |
| Pack as Zebar sees it | `~/.glzr/zebar/caelestia` — a directory **junction** to the repo path above, not a copy (see below) |
| Vendored zebar JS module | `zebar/caelestia/bar/vendor/zebar.js` — bundled, offline, matches the installed runtime version (3.3.1) |
| Entry framework | `zebar/caelestia/bar/entries/registry.js` + `entries/*.js` |
| Layout config | `zebar/caelestia/bar/bar.config.json` — ordered list of entry type names |
| Styling | `zebar/caelestia/bar/style.css` (structure/layout, zero color literals) + `theme.css` (matugen-generated palette, committed) |
| Theming input | `matugen/templates/zebar.theme.css` → `matugen/config.toml`'s `[templates.zebar]` → `zebar/caelestia/bar/theme.css` (this is the one matugen target that renders **inside the repo**, since the pack is tracked) |
| Junction/hotkey installer | `Install-Config` in `scripts/Install-Config.ps1` |

## Pack layout, and why it's buildless

```
zebar/caelestia/
  zpack.json                 -- pack + widget manifest, one widget ("bar")
  bar/
    index.html                -- loads theme.css, then style.css, then bar.js as a module
    bar.js                     -- wires providers, reads bar.config.json, renders entries
    bar.config.json            -- { "entries": [...] } -- the only thing that decides layout
    style.css                  -- structure/layout only, zero color literals
    theme.css                  -- matugen-generated :root custom properties, committed
    drawer.js                  -- toggleDrawer() -- View Transitions morph helper (see below)
    entries/
      registry.js              -- register/create/knownTypes/clear
      index.js                 -- imports every entry module, registering its type
      logo.js, workspaces.js, activeWindow.js, media.js, clock.js,
      statusIcons.js, vesktop.js, power.js
    vendor/
      zebar.js                 -- vendored, bundled zebar@3.3.1 (no CDN, no bare imports)
```

There is **no build step** for the pack itself — every file under `bar/` is served as-is by
Zebar's internal asset server. The only thing that ever needed a real bundler was the vendored
`zebar.js` module itself (see "The vendored zebar bundle" below); once that one file exists on
disk, `bar.js` imports it with a plain relative `import * as zebar from './vendor/zebar.js'` and
everything else is plain ESM/HTML/CSS, editable and re-servable with nothing more than a Zebar
restart. This matters because `caching.defaultDuration: 0` in `zpack.json` and the junction (next
section) mean an edit to any file here reaches the served pack immediately — the only thing that
does **not** update live is the running widget's already-loaded page (see "No hot reload").

### `includeFiles` must be `["*"]`

`zpack.json`'s widget declares `"includeFiles": ["*"]`. This is not cosmetic. Zebar's internal
asset server only serves files a widget's `includeFiles` glob actually covers — omit it (it's
optional in the schema, so nothing warns you) or scope it too narrowly, and `htmlPath` itself
404s with a full-page Rocket "404: Not Found" error, even though the pack is found and starts
without error in `errors.log`. This is completely undocumented in `zpack-schema.json` and cost a
dedicated investigation (`docs/zebar-reference.md`'s opening section) to pin down. If a future
widget is added to this pack, its `includeFiles` needs the same treatment.

## The junction, and why not a copy

`~/.glzr/zebar/caelestia` is a directory **junction** (`Install-Config` → `Set-ManagedJunction` in
`scripts/Install-Config.ps1`) pointing at this repo's `zebar/caelestia/`, not a copy of it.

Two hard requirements forced this:

1. **`--pack` takes a pack *ID*, never a filesystem path**, and the pack directory must live
   directly under `~/.glzr/zebar`. A raw absolute path (`--pack "C:\...\zebar\caelestia"`) fails
   outright with `Failed to open widgets: No widget pack found for '<path>'` in `errors.log` — it
   is looked up by name in `~/.glzr/zebar`, not resolved as a location. This was confirmed by
   trying the raw path first and getting exactly that error (`docs/zebar-reference.md`).
2. Editing the tracked pack in the repo must reach the actually-served pack with no manual copy
   step, so the theming pipeline (matugen renders straight into
   `zebar/caelestia/bar/theme.css`) and any manual edit both take effect after a restart with no
   separate deploy step.

A junction satisfies both: `~/.glzr/zebar/caelestia` is a real directory as far as Zebar's lookup
is concerned (it lives directly under `~/.glzr/zebar`), but its content is the repo's own files.
`Set-ManagedJunction` refuses to touch `LinkPath` if something already there is a **real**
directory rather than a junction (`throw`s rather than deleting it) — this guards the
pre-existing, unrelated `~/.glzr/zebar/goodenoughedit` pack (and would guard any future
non-junction directory at the same path) from being silently destroyed by a careless
re-run. `Install-Config -Uninstall` removes the junction (`Remove-Item`, not a recursive delete —
critically, deleting a junction with the wrong tool follows it into the target and can destroy the
repo; `Set-ManagedJunction`/the uninstall path in `Install-Config` both use the junction-safe
removal path) and leaves the repo and any real directories untouched.

## Starting, stopping, and reloading — the CLI mechanics

```powershell
"C:\Program Files\glzr.io\Zebar\zebar.exe" start-widget-preset --pack caelestia --widget-name bar --preset default
```

Several non-obvious behaviors, all verified empirically across Tasks 1–9:

- **`start-widget-preset` blocks the calling process** — it does not fork/daemonize; the CLI
  invocation *is* the running service for as long as the widget is open. Never invoke it inline
  from a script that needs to continue (like `Apply-Theme.ps1`'s reload step) — launch it via
  `Start-Process ... -WindowStyle Hidden` instead, or the calling script hangs.
- **Calling it again against an already-running widget of the same pack/widget/preset is a
  no-op.** No new process, no reload, no error — same PID, same start time, stale content still
  showing. This was discovered by accident in Task 4 and confirmed deliberately again in Task 9.
  To actually reload, you must fully stop the process and start a fresh one:
  ```powershell
  Get-Process zebar -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  Start-Process -FilePath $zebarExe -ArgumentList @(
      'start-widget-preset', '--pack', 'caelestia', '--widget-name', 'bar', '--preset', 'default'
  ) -WindowStyle Hidden
  ```
  This is exactly what `Apply-Theme.ps1`'s zebar reload step does. **There is no per-widget reload
  verb** in this Zebar build (`zebar.exe --help` lists only `start-widget`, `start-widget-preset`,
  `startup`, `query`, `publish`) — stopping the process kills *every* Zebar widget running at the
  time (including the unrelated pre-existing `goodenoughedit`/`gunturdwiap.good-enough` packs, if
  they happen to be open), not just this pack's.
- **Zebar does not hot-reload CSS (or anything else).** A running widget was left open for 14+
  seconds after editing its stylesheet on disk and never picked up the change; only a full
  stop/start cycle showed the new colors (`docs/zebar-reference.md`, Step 4). Build an explicit
  restart into any tooling that edits pack files while a widget might be running — don't assume
  Zebar notices.
- **Shell-privilege denials are invisible in `errors.log`.** If a widget's JS calls
  `zebar.shellExec(...)` for a program/args combination not covered by that widget's
  `privileges.shellCommands` allowlist, the call rejects with a JS-thrown error
  (`Command '...' failed: ...`) that only ever surfaces inside the page's own JS (a caught
  exception, or an uncaught one visible only via devtools/UI Automation) — `errors.log` gains
  **no new line** for a denial. A denied command and an allowed command whose entry legitimately
  produces no visible output look identical from the log alone. If a shell-backed entry (like
  `vesktop`) is ever reported as "just doesn't show anything", don't trust the log to rule out a
  silently-denied privilege — temporarily render the caught error's text instead (see Task 7's
  report for the exact technique used to prove this).

## The entry registry, and how to add an entry type

`entries/registry.js` is a tiny in-memory factory map:

```js
register(type, factory)   // factory: (ctx) => { el, update(providerOutput) }
create(type, ctx)         // throws on an unknown type
knownTypes()
clear()                   // test-only
```

`entries/index.js` imports every entry module (which each call `register(...)` for their own type
as a side effect of being imported) and additionally registers the trivial `spacer` type inline
(a flex-filling, contentless div — `flex: 1 1 auto`, used to push the clock/status/power cluster
to the bottom of the strip). `bar.js` reads `bar.config.json`'s `entries` array (via
`entries/render.js`'s `parseBarConfig`, not a bare `fetch(...).json()` — see below) and renders it
via `entries/render.js`'s `renderEntries(entries, ctx, container, create)`, which calls
`create(type, ctx)` for each name in order inside its own per-entry try/catch, appends each
successfully-created `.el` to `#bar`, and on every provider tick calls every instance's
`update(providerOutputMap)` inside a (separate) try/catch — one entry throwing, whether during
construction or on a later tick, never takes down any other entry.

**Both failure modes below were real, not hypothetical** (see `tests/js/render.test.mjs`, added
after review):

- `create(type, ctx)` **throws** on an unknown type (`registry.js`) — a name in
  `bar.config.json` with no matching `register(...)` call (e.g. the "add an entry" workflow below
  with its import step skipped) used to abort the entire render loop partway through, leaving
  every entry after the bad one — and `#bar` itself, if the throw happened on the first iteration
  — never appended. `renderEntries` guards construction per-entry: a bad/unknown type is skipped
  (logged via `console.error`) and every other configured entry still renders.
- `bar.config.json` **failing to parse** (malformed JSON) used to throw out of `bar.js`'s
  top-level `await fetch(...).then(r => r.json())`, failing the whole module before anything
  rendered. `parseBarConfig` fetches as text and parses explicitly with its own try/catch,
  degrading to an empty `entries: []` (still a blank bar, but a recoverable, logged one) instead of
  a script that never runs at all.

Per this branch's own finding, none of the `console.error` calls above reach `errors.log` — JS
errors inside a Zebar widget's page are invisible there (same limitation `vesktop`'s
`shellExec` denials hit, described elsewhere in this file). There is currently no way to see these
messages except a devtools/UI Automation session against the live widget.

**To add a new entry type:**

1. Write `zebar/caelestia/bar/entries/<name>.js`. Export any pure logic function separately (for
   unit testing without a DOM — see every existing entry for the pattern, e.g. `splitClock`,
   `workspaceState`, `mediaLabel`, `pingState`, `windowTitle`). Call
   `register('<name>', (ctx) => ({ el, update(out) { ... } }))` at module scope.
2. Add `import './<name>.js';` to `entries/index.js`.
3. Add `"<name>"` to `bar.config.json`'s `entries` array, in the position you want it rendered.
4. Add any structural CSS the entry needs to `style.css`, using only `var(--...)` tokens — see the
   zero-color-literal rule below.
5. Write Node tests for the pure logic function(s) in `tests/js/entries.test.mjs`
   (`node --test`, not `node --test tests/js/` — see the mechanics note below). Construction and
   config-parsing behavior shared by every entry type (an unknown type, a malformed
   `bar.config.json`) lives in `tests/js/render.test.mjs` instead, against `entries/render.js`.

`ctx` currently carries `{ providers, shell }` (`providers` is the `createProviderGroup(...)`
instance from `bar.js`; `shell` is the whole `zebar` module if `zebar.shellExec` exists, else
`null` — entries that need `shellExec` call `shell.shellExec(program, args)`, **not**
`shell.exec(...)`; there is no `.exec` method — `shellExec` is a top-level named export of the
`zebar` module itself, confirmed by grepping the vendored bundle).

### `node --test tests/js/` doesn't work on this machine

Passing a bare directory to `node --test` makes Node 22.16.0 on this Windows setup treat it as a
CommonJS module entry point (`MODULE_NOT_FOUND`) rather than a test-discovery root. Use one of:

```powershell
node --test tests/js/entries.test.mjs   # explicit file
node --test                             # auto-discovers *.test.mjs anywhere under cwd
```

## The komorebi provider's window-focus shape

`out.komorebi.focusedWorkspace.tilingContainers[]` is an array of `{ id, windows }` — focus is
flagged at the **workspace** level (`focusedWorkspace.focusedContainerIndex` selects which
*container* has focus) but **not** at the per-window level within a container. Checked directly
against the `zebar` npm package's `dist/index.d.ts` at both 3.0.3 and 3.3.1: `KomorebiContainer`
is exactly `{ id: string, windows: KomorebiWindow[] }` at both versions — there is no
`focusedWindowIndex` or equivalent field to read. Raw komorebi itself does track a
per-container-focused-window index (`komorebic state`'s own `windows.focused`), but zebar's
provider never forwards it. `entries/activeWindow.js`'s `windowTitle()` therefore reads
`windows[0]` unconditionally — this is not an unverified guess or a fallback for a misnamed field,
it is the only option the provider exposes, and it's also correct for the overwhelmingly common
single-window-per-container case.

## The `style.css` / `theme.css` split

`index.html` loads `theme.css` **before** `style.css`. `theme.css` is matugen-generated output — a
bare `:root { --name: value; }` block of custom properties (`--surface`, `--on-surface`,
`--on-surface-variant`, `--primary`, `--on-primary`, `--outline`, `--surface-container`), rendered
from `matugen/templates/zebar.theme.css` by `Apply-Theme.ps1` and committed like any other
generated pipeline artifact (this is the one matugen target whose live path is *inside* the repo,
since the pack itself is tracked).

`style.css` holds **every** structural/layout rule — flex layout, sizing, padding, border-radius,
font, transitions — and is required to contain **zero color literals**: no `#rrggbb`, no
`rgb(...)`/`rgba(...)`, no `hsl(...)`. Every visual color in `style.css` is a `var(--...)`
reference into whatever `theme.css` currently defines. This was verified at every task from Task 3
onward with `grep -inE '#[0-9a-f]{3,8}\b|rgb\(|rgba\(|hsl\('` against the file (expected: no
matches / exit 1), and is also gated mechanically by `Apply-Theme.ps1`'s `Test-StagedFile` zebar
branch, which rejects any staged `theme.css` containing a non-`--custom-property` declaration
inside `:root {}` (e.g. a literal `color: red;`) before it ever reaches the live file.

**This invariant now has an automated test, not just a hand-grep** (final review, I5):
`tests\Get-ColorLiterals.Tests.ps1`'s `"The zebar bar's zero-color-literal invariant"` Describe
block runs the already-existing `Get-ColorLiterals` (`scripts\Get-ColorLiterals.ps1`, written for
the yasb migration) against the real `style.css` and asserts a count of exactly 0, with a
non-vacuousness check against `theme.css` (asserts 7 — the seven matugen-rendered properties)
proving the check can actually detect literals when they're present. The erosion path is real, not
hypothetical: `style.css`'s `.vesktop--pinged` rule already settles for `var(--primary)` because no
red token exists in `theme.css` — the next entry that needs a color this palette doesn't have is
one hex literal away from silently breaking this test.

**Why this is the reason the target has no migration risk:** unlike yasb's `styles.css` (which
started as ~40 hand-authored Catppuccin literals and needed a whole mapping/round-trip machinery —
see `CLAUDE.md` — to migrate losslessly to matugen expressions), `zebar/caelestia/bar/style.css`
was authored from day one with only `var(--...)` references and never contained a literal to
migrate away from. Adding zebar as a theming target (Task 9) required nothing more than a new
seven-property template and a `Test-StagedFile` case — no `Get-ColorLiterals`/`New-Template`/
`Test-Roundtrip` machinery was needed, because there was nothing to round-trip.

## Reloading zebar after a theme apply

`Apply-Theme.ps1`'s zebar reload step (added Task 9) runs **after** every other post-copy check
has passed (the yasb log check, `Update-LastGood`), not immediately after copying `theme.css` into
place — restarting hands the widget whatever is on disk *right now*, so restarting before a
possible rollback could show a rejected theme for the length of one restart cycle and then need a
second restart to fix. Restarting only once every check has passed keeps downtime to exactly one
restart per successful apply.

The restart (`Restart-ZebarWidgets` in `Apply-Theme.ps1`) unconditionally kills every running
`zebar.exe` process (see "no per-widget reload verb" above) — that part genuinely has no
alternative given this Zebar build's CLI surface. **What changed (final review, C1):** it used to
start back up *only* `caelestia/bar`, on the theory that it's the only Zebar widget ever running.
That's true in this dev environment but false against the real
`~/.glzr/zebar/settings.json`, which autostarts a second pack (`gunturdwiap.good-enough`) — every
real reboot (which is also this doc's own prescribed WebView2 recovery step, so it *will* happen)
silently and permanently dropped that other widget's bar the next time anything called
`Apply-Theme`, with no log entry anywhere to explain why. `Restart-ZebarWidgets` now reads
`settings.json`'s `startupConfigs` (via `Install-Config.ps1`'s `Get-ZebarStartupConfigs` — the same
reader I4's writer, `Set-ZebarStartupConfig`, keeps in sync — see "Installing/uninstalling" below)
and restarts **every** entry found there, not just this pack's own bar; a missing or unparseable
settings file falls back to restarting only `caelestia/bar` and warns loudly rather than either
silently doing nothing or throwing. Each `start-widget-preset` launch is also checked for an
immediate nonzero exit (via `-PassThru` and a short poll — it can never be `-Wait`-ed on to
completion, since the process blocks for as long as that widget's window stays open) instead of
being fired and forgotten, surfacing a failed start (e.g. a renamed/missing pack) as a warning.

The whole restart is also now gated on `theme.css` having **actually changed**
(`Test-ZebarThemeChanged`, compared against the live file *before* it gets overwritten by the
copy) — a yasb/wezterm/starship-only apply that never touches zebar's palette no longer kills every
autostarted Zebar widget on the machine for no reason.

## Nerd Font glyphs: use `\uXXXX` escapes, not raw pasted characters

Raw Private-Use-Area Nerd Font glyphs (icon-font code points used for status icons) silently
became **empty strings** when typed as literal characters and written to a file during this
project (Task 5) — some layer between drafting and the file write dropped the non-BMP-adjacent PUA
codepoints; ordinary BMP glyphs (`◆` U+25C6, `⏻` U+23FB) survived fine typed raw. The fix: write
any new PUA glyph via a literal `\uXXXX` JavaScript escape sequence, then **read the file back**
(e.g. `JSON.stringify` the relevant line) to confirm the bytes are actually there — don't trust
that what you typed is what landed on disk.

## The vendored zebar bundle

`zebar/caelestia/bar/vendor/zebar.js` is `zebar@3.3.1`, bundled with esbuild — chosen specifically
to match the installed runtime's version (3.3.1), not the `3.0.3` that `https://esm.sh/zebar@3.0`
resolves to and that an early spike used just to prove bundling was possible at all. The npm
package's raw `dist/index.js` uses bare-specifier ESM imports (`zod`, `luxon`, `@tauri-apps/api`,
etc.) that a plain `<script type="module">` cannot resolve without a bundler or import map — this
is why esm.sh exists as a resolver for it, and why offline vendoring needs an actual build step,
not a file download.

To regenerate it (e.g. to bump the vendored version to match a future Zebar runtime upgrade), from
any scratch directory:

```powershell
npm install zebar@3.3.1 esbuild --no-save
echo "export * from 'zebar';" > entry.mjs
node_modules/.bin/esbuild entry.mjs --bundle --format=esm --platform=browser --outfile=zebar.bundle.js
```

Verify the output has zero remaining top-level `import` statements (`grep -c "^import "` → 0) and
that `createProviderGroup`, `shellExec`, and `shellSpawn` are present, then copy the result
verbatim to `zebar/caelestia/bar/vendor/zebar.js`. It's ~438 KB. Swap the version number in the
`npm install` line if targeting a different release; always re-check the runtime version currently
installed (`~/.glzr/zebar/settings.json`'s schema reference, or `zebar.exe --version` if available)
before vendoring, since the npm package's shipped `dist/index.d.ts` types can lag the actual
running app's output shape (confirmed once already: the runtime returns `role`/`subrole`/
`iconPath` on komorebi windows that the `3.0.3` npm types didn't declare).

## Known-incomplete: the media drawer

**The media drawer/panel does NOT work as a user-facing feature on this build, and should not be
described as shipped.** The code exists, is unit-tested, and was confirmed correct in isolation —
but the feature as a whole cannot currently be reached by a real user click without either
shrinking usability or creating a real problem. This is worth understanding in detail before
anyone is tempted to "finish" it by just widening the window.

### What exists and is correct

- `zebar/caelestia/bar/drawer.js` — `toggleDrawer(barEl, open)`, using
  `document.startViewTransition` when available and falling back to a direct class toggle
  otherwise. Both paths were verified to actually run and produce a correct result (the fallback
  was exercised by explicitly stubbing `document.startViewTransition = undefined` before
  triggering it).
- `entries/media.js`'s panel markup, real media-session data rendering (title/artist/transport
  buttons/`formatMediaTime`), and its click handler wiring `toggleDrawer`.
- The `.media-panel` / `.media-panel__*` / view-transition CSS in `style.css`.
- All of the above were exercised with **real, live session data** and real screenshots while the
  window was temporarily and deliberately widened for verification purposes only (see below) —
  this is not "written but never run" code.

### Why it isn't wired up as a real, clickable feature

Two premises the design depended on both turned out to be false on this Zebar/WebView2/Tauri
combination (v3.3.1 runtime), discovered by actually doing the verification the drawer's design
called for, not assumed:

1. **`pointer-events: none` does not give OS-level click-through on this platform.** It is a
   DOM-internal routing hint — it tells the page "don't dispatch events to this element, look
   further down the DOM" — it has no effect on which *OS window* Windows' compositor delivers a
   click to. Sampling `WindowFromPoint` across a temporarily-widened transparent region (with
   `pointer-events: none` active on `body`, exactly as committed) showed **every point across the
   full width still resolved to the Zebar window itself**, never to whatever was really tiled
   underneath (VS Code, in the test). A genuinely click-through native window needs a window-level
   mechanism (Win32 `WS_EX_TRANSPARENT`, or Tauri's `set_ignore_cursor_events`) that is not present
   in zebar's public JS API surface (`configSchemas, createProvider, createProviderGroup,
   currentWidget, shellExec, shellSpawn, startWidget, startWidgetPreset` — no window-transparency
   toggle).
2. **`dockToEdge`'s work-area reservation is tied 1:1 to the widget's actual window width**, with
   no decoupling lever anywhere in the zpack schema. Widening the preset's `width` from `52px` to
   `340px` grew komorebi's `work_area_size.left` reservation by exactly the same 288px delta — not
   just the visible bar, the *entire* window footprint. The obvious-looking escape hatch (a
   negative `dockToEdge.windowMargin` to cancel the extra width back out of the reservation) does
   not decouple them either — it was tried and it collapsed the real on-screen window to zero
   width instead (the whole bar disappeared), which is strictly worse than the original problem.

Given both, actually shipping the widened window as originally designed would have created a real
288px-wide input-swallowing dead zone directly over whatever the user has tiled there — clicks
meant for VS Code/Chrome/etc. would silently go to zebar instead. That's a worse regression than
not having the drawer at all, so **the widget stays at 52px and the panel is unreachable by a real
click in the shipped configuration.**

### Suggested path for a future task

The only architecture that satisfies both "52px reservation" and "a genuinely wider visible panel"
identified so far is **a second, separate zpack widget window**, with `dockToEdge` disabled
entirely (so it reserves no work area and isn't tiled by komorebi — `shownInTaskbar:false` plus
`transparent:true` already makes the existing bar untileable with no `komorebi.json` ignore-rule
needed, so a second such window should behave the same way without touching `komorebi.json`).
Trade-offs to plan for if this is picked up:

- It is a materially bigger change than editing the existing pack's files — a new HTML/JS entry
  point, and some form of cross-window state sync (open/close signal, current media data) between
  the two windows.
- It would **not** get genuine View Transitions morphing between the pill and the panel — View
  Transitions don't span two separate documents/windows. At best, a coordinated-but-separate open
  animation (e.g. both windows fading/sliding in sync) could approximate it.

## Known-minor gaps (final review, not fixed — documented instead)

- **`workspaces.js`'s buttons are not clickable (M3).** Each workspace button renders with
  `cursor: pointer` and `.workspace`'s CSS looks interactive, but there is no click handler at
  all — clicking a workspace button in the bar does nothing; workspace switching still has to
  happen some other way (komorebi's own hotkeys, etc.). Wiring this would need the komorebi
  provider to expose (or `shellExec` to reach) a "focus workspace by name" command, plus adding it
  to `zpack.json`'s `privileges.shellCommands` allowlist — not attempted here because it can't be
  visually/functionally verified while WebView2 is broken on this machine (see below), and a
  privilege-allowlist change is exactly the kind of edit that's cheap to get subtly wrong (see the
  `power` warning immediately below).
- **`--outline` and `--surface-container` are generated but unused.** `matugen/templates/
  zebar.theme.css` renders all seven properties into `theme.css`; `style.css` only ever references
  `--surface`, `--on-surface`, `--on-surface-variant`, `--primary`, `--on-primary` (M4). Not
  necessarily wrong — the layout may simply not need a second background tier or an outline color
  yet — but recorded so a future pass doesn't assume they're wired up somewhere non-obvious, and so
  removing them from the template isn't done under the mistaken belief that they're dead weight
  with no future use in mind.

**Wiring `power.js` for real, when that's picked up:** it currently only does
`console.warn('power action not yet wired')` behind a `confirm()` guard — no `shellExec` call
exists yet, and `zpack.json`'s `privileges.shellCommands` allowlist has no shutdown binary in it.
When it is wired, the allowlist entry's `argsRegex` **must** be pinned to the exact expected
argument string (e.g. `^/s /t 0$` for `shutdown.exe`), never a permissive pattern like `.*` — an
over-broad `argsRegex` on a shutdown binary is the most dangerous single edit anyone could make to
this file: it would let *any* JS running in this widget's page shut the machine down with whatever
arguments it likes, not just the one confirm-gated button this pack ships.

## Troubleshooting: WebView2 renders nothing (`about:blank`)

**Symptom:** the Zebar widget window opens, holds its position and its komorebi work-area
reservation correctly, and Windows' own hit-testing routes clicks to it correctly — but nothing
visibly renders. UI Automation shows a `Document` node with no children and a `Pane` literally
named `"about:blank"`; re-querying after several seconds shows no change (this isn't lazy
accessibility-tree population, it's a genuinely failed navigation).

**Cause:** this is an **environmental WebView2 problem on this specific machine**, triggered by
running `Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force` (done
during Task 8's cleanup, intending to reset just this pack's WebView2 state) — this force-kills
**every** WebView2 process on the machine, including shared infrastructure other apps depend on,
not just Zebar's. **Never run `Stop-Process` against `msedgewebview2` again for any reason.**

**Confirmed NOT the cause:** it is not anything in this pack's own code — the pre-existing,
untouched `gunturdwiap.good-enough`/`goodenoughedit` pack shows the identical `about:blank`
symptom, and every file this project's tasks touched (`media.js`, `drawer.js`, `style.css`,
`zpack.json`) was confirmed unchanged in content between an earlier successful run this same
session and the point the regression appeared.

**Remediations tried that did NOT fix it** (so don't re-try these expecting a different result
without a machine-state change first):

- Clearing the pack's own WebView2 cache (`%AppData%\zebar\webview-cache\caelestia`).
- Clearing zebar's shared app-level WebView2 profile (`%LocalAppData%\com.glzr.zebar\EBWebView`).
- Forcing software rendering (`--disable-gpu`).
- Multiple full `zebar.exe` stop/start cycles, including with generous (45s) waits.
- Checking Application/Defender event logs and Crashpad for crash evidence (none found — the
  processes are alive and `Responding: True`, they're just not painting/navigating).

**What actually clears it:** the state survives a `zebar.exe` process restart and even a full
profile wipe, which points at something in the user's WebView2 **session** rather than any file on
disk. The known-working fixes are a **user sign-out/sign-in, or a full reboot** — neither has been
performed yet as of Task 9/10 because doing so would kill the very WezTerm/VS Code session these
tasks run inside of. Recommended action: next time it's convenient to sign out or reboot, do so,
then re-verify the bar renders and re-screenshot it — nothing about the code needs to change first,
it's a pure environment-recovery step.

**What stays safe even in this broken state** (verified directly, not assumed): the komorebi
work-area reservation (`left: 52`), and real OS-level hit-testing (`WindowFromPoint` at the
strip's x-coordinates still resolves to the Zebar window; points past it resolve to whatever's
really tiled there) — both are independent of WebView2's rendering pipeline and were reconfirmed
*during* the degraded-rendering state.

## Coexistence with yasb

Both bars run as independent processes and reserve independent slices of the monitor's work area —
yasb at the top (`work_area_size.top`), zebar at the left (`work_area_size.left`). Neither knows
about the other; komorebi is the only thing that combines both reservations into one usable work
area for tiled windows. See the Task 10 coexistence check below for what was actually confirmed on
this machine.

## Corner overlays (rounded content corners)

`corner-overlays` added a second widget, `corners`, to `zpack.json` (see `zebar/caelestia/corners/`):
four small 28x28px windows, one per screen corner, each painting a `var(--surface)`-colored
radial-gradient wedge that fades to fully transparent toward the content region, giving the
illusion of a rounded corner where the bar meets the content and at the two outer screen corners.

**Why not one full-screen overlay.** Proven earlier on this build: `pointer-events: none` does
**not** give OS-level click-through on Zebar's WebView2/Tauri windows (see "Known-incomplete: the
media drawer" above) — `WindowFromPoint` returns the Zebar window across the whole transparent
region regardless of CSS. A full-screen transparent overlay would make the entire desktop
unclickable. Four small per-corner widgets instead keep the click-dead footprint to
4 x 28x28 = 3,136px^2, confirmed (by direct `WindowFromPoint` sampling, corner-overlays' own
verification) to sit exactly on the wallpaper/gap between the bar/screen edge and the tiled
content — never on any real window.

**Geometry.** The content region's corner (where a tiled window's own edge sits, given
`default_workspace_padding`/`default_container_padding` = 20 each, from `~/komorebi.json`) is at
`(bar_width + 40, 40)` for the left corners and `(screen_width - 40, 40)` / `(*, screen_height -
40)` for the right/bottom ones (52 + 20 + 20 = 92 measured on this machine, matching real tiled
window rects observed via `komorebic state`, off by only the ~5px native border decoration).
Each 28px corner widget is positioned so its corner nearest the content touches that point exactly
and it extends outward into the 40px gap toward the bar/screen edge — comfortably inside the gap
(28 < 40), never overlapping the bar or a real window.

**`offsetX`/`offsetY` sign convention (undocumented, found the hard way).** For every anchor,
positive `offsetX` shifts the window **right** and positive `offsetY` shifts it **down** — the
anchor only decides the window's position when the offset is `0` (e.g. `top_right` at offset 0
sits flush with the screen's right edge). This means a `top_right`/`bottom_right`/`bottom_left`
preset that needs to move the window *inward*, toward the screen center, needs a **negative**
offset on the axis nearest its anchored edge — `offsetX: "12px"` on a `top_right` preset does not
move the window 12px in from the right edge, it moves it 12px **further right, off-screen**. Confirmed
by starting all four corner presets and reading back their actual `GetWindowRect` via a P/Invoke
probe; the fix is baked into `zpack.json`'s current offsets (`top-right`/`bottom-right` use
negative `offsetX`, `bottom-left`/`bottom-right` use negative `offsetY`) — don't "simplify" them
back to all-positive without re-verifying against real window rects.

**Which corner am I? (`corners.js`/`classify.js`).** All four presets share one `htmlPath`
(`corners/index.html`), so a running instance has no static way to know which corner it is. It
finds out at runtime instead: `classifyCorner(x, y, screenWidth, screenHeight)`
(`zebar/caelestia/corners/classify.js`, pure and unit-tested — `tests/js/corners.test.mjs`) compares
its own `outerPosition()` (via `currentWidget().tauriWindow`, vendored zebar/Tauri API) against
half the screen's width/height and adds a `corner--<name>` class to `<body>`, which `corners.css`
uses to pick the correctly-oriented gradient. This is intentionally geometry-derived rather than a
hardcoded preset-name-to-corner map, so a future geometry change can't silently leave a widget
painting the wrong corner.

**Reservation: confirmed zero.** `dockToEdge: { enabled: false }` on every corner preset. Verified
directly: `komorebic state`'s `work_area_size` read `{ left: 52, top: 0, right: 2508, bottom: 1440
}` before the corner widgets existed, immediately after starting them for the first time, and again
after a full `Restart-ZebarWidgets` stop/start cycle — unchanged in every case.

**Startup registration needed a real fix, not just four `Install-Config` calls.**
`~/.glzr/zebar/settings.json`'s `startupConfigs` entries were previously deduplicated by
`(pack, widget)` alone (`Set-ZebarStartupConfig`, `scripts/Install-Config.ps1`) — fine while every
widget only ever had one autostarted preset, but the `corners` widget needs **four** entries under
the same `pack`+`widget` (one per preset/corner). Matching was widened to
`(pack, widget, preset)`; every existing caller (`caelestia/bar/default`) is unaffected since it
never registered more than one preset per widget anyway. `Remove-ZebarStartupConfig` deliberately
stayed matched on `(pack, widget)` only, so uninstalling clears all four corner entries in one
call. `Apply-Theme.ps1`'s `Restart-ZebarWidgets` had a latent same-slug log-file collision fixed
alongside this: its per-widget log filename used to be `pack-widget` only, which four
same-pack-same-widget startup entries would all collide on — since `start-widget-preset` blocks for
as long as its window is open, the second corner's `Start-Process -RedirectStandardOutput` would be
opening a log file the first corner's still-running process already holds open. The slug is now
`pack-widget-preset`.

**A `top_most` z-order overlaps fullscreen games — not mitigated.** Corners use `zOrder: "top_most"`
per this feature's own spec (the existing `bar` widget uses `"normal"`). Zebar's CLI
(`zebar.exe --help`) and both `zpack-schema.json`/`settings-schema.json` were checked for any
fullscreen-aware auto-hide option — there is none. VALORANT (in `~/komorebi.json`'s
`ignore_rules`) is only excluded from *tiling*; nothing stops a `top_most` Zebar window from
painting over a borderless-fullscreen game window (DXGI *exclusive* fullscreen, if the game uses
it, bypasses the desktop compositor entirely and would hide it regardless, but that mode isn't
guaranteed and wasn't tested — the game was deliberately not launched to verify this, per this
feature's own safety constraints). Worst case is cosmetic (a 28x28px corner decal in gameplay's
extreme screen corners), not input-swallowing, since the corner widgets' click-dead footprint is
confirmed tiny and off any window — but this is a real, unmitigated risk worth knowing about before
relying on this bar setup during a match.

## Desktop frame (edge strips)

`corner-overlays` follow-up: the four corner arc widgets render correctly on their own (confirmed
by screenshot), but nothing connected them -- they read as four floating wedges rather than a
frame. Two changes closed that gap, both on top of the same "top_most, `dockToEdge: { enabled:
false }`, small click-dead footprint" approach corner-overlays already established.

**The arcs gained an actual stroke first.** The original per-corner rule was a single
`radial-gradient` fading `var(--surface)` to transparent -- a filled wedge, not a bordered line, so
there was no consistent-width "line" for a straight edge to visually continue. `corners.css` now
sizes each corner's `#corner::before` to `corner-size + corner-border-width` and gives it a real
`border: ... solid var(--primary)` with the corner radius set to the box's own full size (so the
whole box becomes curve, no straight run left inside the 28x28 window) -- the browser's own
border+radius renderer keeps that stroke a true constant `--corner-border-width` (4px, matching
`komorebi.json`'s own `border_width`) the entire way to the widget's edge, unlike a radial-gradient
ring, which was tried first and empirically confirmed to taper to a point well before reaching the
widget's own tangent corners (a radial gradient has no ring-width control independent of how much
of the box the circle sweeps through). `--corner-size` itself (the transparent hole's reach) is
unchanged -- see `corners.css`'s own comment block for the exact radius arithmetic that keeps the
fill/stroke/hole all on one shared curve.

**Then a fifth widget, `edges`, fills the straight runs between the arcs.** Unlike `corners/` (one
shared HTML/CSS/JS, four presets that classify their own corner at runtime because all four are
geometrically identical modulo rotation), every `edges` preset is already a different, fixed shape
-- there is nothing left to decide at runtime, so `edges/index.html`/`edges.css` has no JS at all:
each window's entire visible area is just a flat `var(--primary)` fill at whatever width/height
zpack.json gave that preset.

**Why the left edge is only two 12px stubs, not a fourth long strip.** The bar (`caelestia/bar`,
52px wide) already forms the frame's left edge visually -- a parallel vertical strip along the
bar's own right edge would be redundant. What the bar does NOT cover is the ~12px gap between its
own right edge (x=52) and each of the two left corner widgets (which start at x=64, by the same
"comfortably inside the 40px gap" margin corner-overlays used for every corner). Two short
`bar-link-*` presets close exactly that gap, one per left corner; the top, right and bottom edges
have no such gap to close (their neighboring corners already reach flush to the strip).

**Geometry, measured on this machine's 2560x1440 screen (`GetWindowRect`, not calculated from
`komorebic state`'s work area alone -- see below for why):**

| Preset | Rect (screen px) | Connects |
|---|---|---|
| `top` | `(92,12)-(2520,16)` | top-left arc <-> top-right arc |
| `right` | `(2544,40)-(2548,1400)` | top-right arc <-> bottom-right arc |
| `bottom` | `(92,1424)-(2520,1428)` | bottom-left arc <-> bottom-right arc |
| `bar-link-top` | `(52,36)-(64,40)` | bar's right edge <-> top-left arc |
| `bar-link-bottom` | `(52,1400)-(64,1404)` | bar's right edge <-> bottom-left arc |

Every strip is `--corner-border-width` (4px) thick, matching the arc stroke. All five use anchor
`top_left` with a purely positive `offsetX`/`offsetY` pair -- deliberately sidestepping the signed-
offset gotcha corner-overlays hit (see below), since a `top_left`-anchored offset is always the
window's literal absolute screen position, in both axes, regardless of which edge of the screen the
strip ends up nearest to.

The 92/2520/12/1424/etc. constants above are the corner widgets' own already-placed edges (`64+28`,
`2520`, `12+4`, `1428-4`, ...) rather than anything independently derived from
`default_workspace_padding`/`default_container_padding`; corner-overlays' own placement was already
verified against real tiled-window rects (`docs/zebar-bar.md`'s pre-existing "Geometry" note under
Corner overlays), so anchoring the new strips to the corners' own measured `GetWindowRect` output
(via a P/Invoke `EnumWindows`/`GetWindowRect` probe, not hand-derived from the work-area rect) is
one fewer place these numbers could drift from what's actually on screen. `work_area_size` was
re-read before and after (`{left:52, top:0, right:2508, bottom:1440}`, unchanged in both) to
confirm `dockToEdge: { enabled: false }` really does reserve nothing for all five new presets, the
same check corner-overlays ran for its four.

**Visual result (screenshotted at 6x-16x nearest-neighbour zoom, all four corners plus both
junctions at the top-left corner individually):** the arc and the strip it meets share the same
color, thickness and screen row/column with no visible gap, jog, or thickness change at any of the
six junctions (four corner-to-long-strip, two corner-to-bar-link) -- confirmed by direct pixel
inspection, not just eyeballing (`--surface` `#0f1416` and `--primary` `#87d1ea` both sampled
exactly at their expected coordinates before the strips existed, to confirm the arc's own fill/hole
geometry first). One minor artifact: a single stray lighter pixel is visible just above the
bottom-left corner's arc in a wide screenshot crop, consistent with WebView2/compositor antialiasing
at a window-to-window seam rather than a geometry error -- it did not reappear in the tight
zoomed-in junction crops and is not treated as a defect.

**Registration.** Like `corners`, every `edges` preset needs its own `startupConfigs` entry (same
`pack`+`widget`, five different `preset` values) or it will not survive a reboot --
`Install-Config`'s `$edgePresets` list and `Remove-ZebarStartupConfig`'s existing
match-by-`pack`+`widget` (already widget-granular, not preset-granular, from corner-overlays) cover
this the same way they cover `corners`.

**Same unmitigated risks as corner-overlays, now covering slightly more screen area.** `top_most`
z-order with no fullscreen-aware auto-hide (worst case is a thin cosmetic line across the top,
right, bottom, or two small stubs near the bar, not input-swallowing); click-dead footprint grows by
the five strips' combined area (`2428*4 + 4*1360 + 2428*4 + 12*4 + 12*4` = 24,960px^2) on top of
corner-overlays' existing `4*28*28` = 3,136px^2, all of it confirmed (via `WindowFromPoint` +
`GetAncestor(GA_ROOT)` sampled across every strip) to resolve to the zebar `edges` window itself,
never to a tiled content window.

## Desktop frame correction + fullscreen auto-hide (direct user feedback)

Four corrections against the shipped desktop frame (corner-overlays + desktop-frame), from direct
user feedback after looking at it live:

1. **Colour: `var(--primary)` (cyan) -> `var(--surface)`, solid fill, no stroke.** Both
   `corners.css` and `edges.css` used `var(--primary)` (the desktop-frame follow-up's bordered-arc
   design added a `var(--primary)` stroke so the arc had a "line" to visually continue into the
   edge strips, which were themselves a `var(--primary)` fill). The user wants the frame to read as
   one continuous surface with the bar, not an accent-coloured outline -- both files now use
   `var(--surface)` and there is no border/stroke anywhere; `corners.css`'s `--corner-border-width`
   variable (only ever used by the stroke) is gone.
2. **Dropped `bar-link-top`/`bar-link-bottom`.** The bar already forms the frame's left edge; only
   top/right/bottom strips are wanted. Removed from `zpack.json`'s `edges` widget presets and from
   `Install-Config.ps1`'s `$edgePresets`. This leaves a small (~12x4px) unfilled gap at each left
   corner between the bar's own right edge and the corner arc -- the direct, accepted consequence of
   "you only need it for the top and bottom and right sides", not an oversight. **`Install-Config`'s
   non-Uninstall branch now explicitly prunes ALL existing `caelestia/edges` `startupConfigs`
   entries before re-adding the current three** (`Remove-ZebarStartupConfig` then re-`Set-`), or the
   two removed presets would have kept autostarting forever from a stale `settings.json` entry --
   `Set-ZebarStartupConfig` alone only ever adds/updates a matching triple, it never removes one
   that's no longer requested. Run live on this machine's real `~/.glzr/zebar/settings.json`; the
   two stale entries are confirmed gone (re-read after running).
3. **The arc: reverted to a true 90-degree quarter-circle cut-out, not the bordered-box "blob with a
   stroke" the user was reacting to.** `corners.css` is back to (a corrected, re-explained version
   of) its original corner-overlays construction: a `radial-gradient` hard-stopped at
   `var(--corner-size)` from the widget's own content-facing corner -- transparent within that
   radius, `var(--surface)` beyond it. Worked through the geometry by hand to confirm this is
   genuinely a 90-degree sweep, not a semicircle: the circle's centre sits exactly at one corner of
   the (square) widget, so only one quarter of its 360 degrees ever crosses the visible area at all
   -- the two adjacent widget corners are exactly tangent to it, the far corner is
   `corner_size*sqrt(2)` away and irrelevant. Because `--corner-size` (28px) equals the widget's own
   side length, the transparent (hole) region actually covers the *majority* of the small widget
   (~78.5% by area) and the solid `var(--surface)` fill is a small curved wedge hugging the true
   outer screen corner -- this is not a bug, it's exactly "the solid region between the outer screen
   corner and a quarter-circle cut-out, the inner edge curving away toward where windows sit" as
   described. Verified both visually (screenshots below) and by direct pixel sampling
   (`CopyFromScreen`) at the widget's own corner, its content-facing interior, and the adjoining edge
   strip -- the wedge samples `#0F1416` (`--surface`, exact), the hole samples the wallpaper's own
   colour underneath (not a stray fill), and there is zero `#87D1EA` (`--primary`) anywhere in the
   frame.
4. **Fullscreen auto-hide.** Zebar has no built-in fullscreen awareness -- re-confirmed against
   `zebar.exe --help`, `zpack-schema.json` and `settings-schema.json`, same conclusion
   corner-overlays' own "unmitigated risk" note already recorded. Detection is now self-implemented:
   a small Win32 C# helper, `zebar/caelestia/tools/fullscreen-detect.cs` (compiled to
   `fullscreen-detect.exe`, same `csc.exe` build step as `~/.config/yasb/scripts/vesktop-unread.cs`),
   prints `1` when `GetForegroundWindow()`'s rect exactly equals `GetMonitorInfo`'s monitor bounds
   for the monitor it's on, AND the foreground window's owning process isn't named `zebar` (excludes
   every widget this pack runs -- bar, corner arcs, edge strips are all the same `zebar.exe`
   process, confirmed live: starting all 8 widgets produced only ONE `zebar.exe` process, since only
   the first-launched `start-widget-preset` call becomes the long-running Rocket-server/window-host
   and every later call hands its window off to it and exits -- see the `Creating window widget-N`
   log lines in `state/zebar-logs/caelestia-bar-default.out.log`). Prints nothing on any internal
   error (fail soft) or when not fullscreen.

   `zebar/caelestia/fullscreen.js` is the shared poller (`startFullscreenWatch(shell, onChange,
   intervalMs)`, ~1s default -- faster than `vesktop.js`'s 5s poll, since visible desktop furniture
   flickering wrong is more noticeable than an unread badge lagging), imported independently by
   `bar/bar.js`, `corners/corners.js`, and a new `edges/edges.js` (edges previously had no JS at all
   -- see `edges/index.html`). Each toggles its own `<body>`'s `fullscreen-hidden` class, which each
   widget's own stylesheet turns into `display: none` on the content div. `zpack.json` gained a
   `privileges.shellCommands` entry for the helper's exact path (`argsRegex: "^$"`, no arguments) on
   all three widgets (`bar` already had a `privileges` block for `vesktop-unread.exe`/`komorebic`;
   `corners`/`edges` gained their first `privileges` block for this). `isFullscreenState` (the pure
   stdout-parsing predicate) and `startFullscreenWatch`'s fail-soft/no-shellExec paths are unit
   tested (`tests/js/fullscreen.test.mjs`); the Win32 rect-matching logic inside the `.cs` helper
   itself is not unit-testable from Node, so it was verified live instead, per this task's own
   safety constraint against launching a real game/app fullscreen: a temporary borderless
   `System.Windows.Forms.Form`, sized and positioned to exactly cover the primary monitor, created
   and destroyed by a throwaway PowerShell script (never a real fullscreen app), confirmed the
   helper prints `1` while that window is foreground and nothing otherwise. The full pack-level
   behaviour was then confirmed live too, the same way: with the frame reloaded and running, pixel
   samples of the corner wedge, the top edge strip, and the bar's own interior all read pure black
   (i.e. fully transparent, showing straight through to the deliberately non-topmost test window
   behind them) while the test window was foreground and exactly covered the monitor, and all three
   read back to their normal `var(--surface)` colour within ~3s of the test window closing.

   **Hiding the content is not the same as removing the window.** Every widget's window (bar,
   4 corners, 3 edges) keeps existing, keeps its `zOrder: top_most`, and keeps whatever click-dead
   footprint it already had (see corner-overlays' and desktop-frame's own footprint accounting
   above) -- `display: none` on the inner content div makes an already-transparent window paint
   nothing, it does not close the window, minimize it, or give it OS-level click-through (proven
   impossible on this Zebar/WebView2 build already, see "Known-incomplete: the media drawer"). This
   is stated plainly per this task's own instructions, not implied to be more than it is: a
   fullscreened game still has a handful of small dead click zones sitting over it, just invisible
   ones instead of a visible cyan/surface-coloured decal.

**Visual result (screenshotted top-left and bottom-right corners at 4-6x nearest-neighbour zoom):**
the frame now reads as one solid `var(--surface)` band curving through a clean quarter-circle wedge
at each screen corner into the adjoining strip, with no cyan, no stroke outline, and no filled blob
-- confirmed by both eye and direct pixel sampling. The intentional small gap at each left corner
(bar-link removal, point 2 above) is visible as a thin sliver of wallpaper between the bar's own
right edge and the corner wedge -- expected, not a defect.

## Corner-radius + bar-junction gap fix (direct user feedback, third pass)

Two more corrections against the shipped desktop frame, from direct user feedback comparing it
side-by-side against a Caelestia reference screenshot: the "expected, not a defect" sliver noted
just above turned out not to be acceptable after all once there was a reference to compare
against, and the 28px radius read as a tiny nub next to the reference's generous, clearly rounded
curve.

1. **Radius: 28px -> 36px.** `corners.css`'s `--corner-size` and every `corners` preset's
   `width`/`height` in `zpack.json` grew from 28 to 36 together (they must stay equal -- see
   `corners.css`'s own geometry comment on why the square invariant is what keeps the arc's two
   tangent points landing exactly on the box's far edges). 36 was picked from the user's own
   suggested 24-40px range, mid-to-upper end, to read as "generous" without the corner box eating
   too far into the 40px gap between the bar/screen edge and the tiled content region.
2. **The two left corners now start flush with the bar, not 12px into the gap.** The `top-left`/
   `bottom-left` presets' `offsetX` changed from `64px` (`bar_width(52) + 12px` inset, the same
   convention every other corner still uses) to `52px` -- the bar's own right edge exactly. This
   closes the ~12x4px sliver of bare wallpaper the previous "Dropped `bar-link-top`/
   `bar-link-bottom`" correction (above) had left as an accepted trade-off. The fix is the widget
   itself extending, per this task's explicit instruction, **not** a reintroduced bar-link stub --
   the square's far corner (the solid-wedge tip diagonally opposite the content-facing corner) now
   sits exactly on the bar's edge instead of 12px away from it, so the wedge's own fill closes the
   gap rather than a separate rectangle bridging it. The two right corners (`top-right`/
   `bottom-right`) keep their existing `-12px` inset -- the user's complaint was specifically about
   the bar junction, not the general 12px gap convention used everywhere else (screen edge to
   frame), so that convention was left alone on all three other sides.

**Every `edges` preset was re-derived from the new corner geometry, not left alone.** Each
corner's far tangent point (where the solid wedge fill tapers to zero width, the point every
adjoining strip must start flush against) moved when the radius and the left corners' `offsetX`
changed, so the strips would have shown a step or a gap against the old, now-stale tangent points
otherwise:

| Preset | Old rect (28px radius) | New rect (36px radius, left corners flush) |
|---|---|---|
| `top-left` corner | `(64,12)-(92,40)` | `(52,12)-(88,48)` |
| `top-right` corner | `(2520,12)-(2548,40)` | `(2512,12)-(2548,48)` |
| `bottom-left` corner | `(64,1400)-(92,1428)` | `(52,1392)-(88,1428)` |
| `bottom-right` corner | `(2520,1400)-(2548,1428)` | `(2512,1392)-(2548,1428)` |
| `top` edge | `(92,12)-(2520,16)` | `(88,12)-(2512,16)` |
| `right` edge | `(2544,40)-(2548,1400)` | `(2544,48)-(2548,1392)` |
| `bottom` edge | `(92,1424)-(2520,1428)` | `(88,1424)-(2512,1428)` |

`offsetY`/height on the `top`/`bottom` edges and `offsetX`/width on the `right` edge are unchanged
-- those axes never depended on the radius or the left-corner flush change (see the strip-vs-box
tangent-point arithmetic worked through in the corresponding commit; the short version is the
strip's own thickness axis is independent of the corner box's size, only its length/position along
the frame is not).

**Click-dead footprint (`WindowFromPoint` + `GetAncestor(GA_ROOT)`, same method corner-overlays
and desktop-frame used, re-run against the new rects above, 5x5 grid per rect, 2560x1440 screen):**
every sampled point across all four corners and three edges resolved to `zebar.exe`, none to a
tiled window. Corners alone: `4 * 36*36` = 5,184px² (up from 3,136px²). Edges alone: `2424*4 +
4*1344 + 2424*4` = 24,768px² (down slightly from 24,960px², since the strips got shorter as the
corner boxes widened). Combined total: 29,952px² (up from 28,096px², a net growth of 1,856px²).
`work_area_size` re-read before and after via `komorebic state`: `{left:52, top:0, right:2508,
bottom:1440}`, unchanged -- `dockToEdge: { enabled: false }` still reserves nothing on any preset.

**Visual result (screenshotted all four corners at 6-10x nearest-neighbour zoom, tight crop on the
bar/top-left junction specifically):** the bar's dark column and the top-left corner's solid wedge
are now pixel-continuous at x=52 for the corner's full height -- no wallpaper sliver at any sampled
row. The curve itself is visibly larger and smoother than the old 28px nub, and all four corners
still meet their adjoining top/right/bottom strip with no gap or thickness jump, mirrored
correctly on the right-hand corners.

## Frame flush-to-edge correction (band thickness == komorebi padding, fourth pass)

Direct user feedback against the shipped 44px-frame from the previous pass, compared side-by-side
against a Caelestia reference screenshot: the frame was rendering as a **4px hairline inset 12px
from the screen edge**, leaving a 12px band of bare wallpaper visible outside it everywhere. The
reference instead shows a **solid band running from the screen edge all the way to the content**,
the same colour and visual weight as the left bar -- "the border between the edge of the screen and
the arc". This pass makes the frame flush on every edge it touches and ties its thickness directly
to a real number already in `~/komorebi.json` instead of an arbitrary pixel value.

**The governing idea: band thickness == komorebi's own padding.** `~/komorebi.json`'s
`default_workspace_padding` and `default_container_padding` are both `20`. A tiled window's outer
edge sits exactly `20px` in from the work area edge (or the bar's own right edge, on the left side).
Sizing the frame band to exactly `20px` and placing it flush against the screen/bar edge makes the
frame fill that gap precisely -- it can never cover a tiled window's interior, because the interior
starts exactly where the band ends. Content corner radius is a separate, independently-tunable
constant, `--corner-radius: 24px` (`corners.css`'s own `:root` block) -- picked to read close to the
reference's curve at this frame thickness; not derived from any komorebi value. Each corner widget's
own window size is therefore `--frame-band + --corner-radius` = `20 + 24` = **44x44** on both axes.

**Geometry (measured on this machine's 2560x1440 screen via a `GetWindowRect` P/Invoke probe against
every running `caelestia` widget process, all anchor `top_left` with purely positive absolute
offsets -- same offset-sign-trap avoidance corner-overlays' and desktop-frame's own strips already
used):**

| Preset | Rect (screen px, `GetWindowRect`) | width x height |
|---|---|---|
| `corners/top-left` | `(52,0)-(96,44)` | 44x44 |
| `corners/top-right` | `(2516,0)-(2560,44)` | 44x44 |
| `corners/bottom-left` | `(52,1396)-(96,1440)` | 44x44 |
| `corners/bottom-right` | `(2516,1396)-(2560,1440)` | 44x44 |
| `edges/top` | `(96,0)-(2516,20)` | 2420x20 |
| `edges/right` | `(2540,44)-(2560,1396)` | 20x1352 |
| `edges/bottom` | `(96,1420)-(2516,1440)` | 2420x20 |

Every rect above was read back live, not just computed from `zpack.json` -- this task's own explicit
instruction, and consistent with how every prior geometry pass in this file was verified. All seven
line up exactly with no gap or overlap: `edges/top`'s left edge (96) is `corners/top-left`'s right
edge; `edges/right`'s top edge (44) is `corners/top-right`'s bottom edge; and so on around the frame.
`komorebic state`'s `work_area_size` was re-read before and after this pass: `{left:52, top:0,
right:2508, bottom:1440}`, unchanged -- `dockToEdge: { enabled: false }` on every preset still
reserves nothing.

**The arc technique is unchanged, only its placement and the hole's size relative to the widget
changed.** Every corner is still one `radial-gradient` rule on `#corner`, hard-stopped at a fixed
radius from the widget's own content-facing corner (`corners.css`'s `body.corner--*` rules) --
transparent within `--corner-radius` of that corner, solid `var(--surface)` beyond it. The only
difference from the prior (36x36, hole == whole widget) design is that the hole's radius
(`--corner-radius`, 24px) is now smaller than the widget's own size (44px), which is what leaves the
extra `--frame-band` (20px) of guaranteed-solid margin on the widget's two screen/bar-facing sides.
Worked through by hand and confirmed by direct pixel sampling (`CopyFromScreen`, 1px steps across
each 44x44 corner window): the transparent region is exactly the set of points within 24px of the
widget's content-facing corner, which is provably identical to painting three separate pieces (a
`--frame-band`-thick top-or-bottom band, a `--frame-band`-thick left-or-right band, and a
`--corner-radius`-square arc box in the remaining corner) -- see `corners.css`'s own comment for the
short proof. All four corners were sampled this way (not just top-left) and all four mirror
correctly.

**Visual result (screenshotted top-left and bottom-right corners at 5x nearest-neighbour zoom, plus
1px-step pixel sampling across all four corner windows and every edge strip):** the dark
`var(--surface)` band (`#0F1416`, sampled exact) runs unbroken from the physical screen edge and
from the bar's own right edge, through a smooth, mathematically-verified 90-degree arc, into the
content region -- zero wallpaper visible anywhere in the frame, and zero gap or colour mismatch at
any of the seven corner-to-edge junctions (sampled directly on both sides of each seam). The initial
screenshot crop looks mostly non-`--surface` at a glance because the band is now thin (20px) relative
to a wide crop -- the majority of any wide crop is legitimately real desktop content beyond the frame,
not the frame itself; pixel sampling (not just the screenshot) is what actually confirms the band's
own pixels are correct.

**Click-dead footprint grew substantially -- this is a genuine, real regression, not a rounding
error.** Every pixel inside any corner or edge widget's window rect swallows clicks regardless of
its own CSS transparency (Zebar has no OS-level click-through on this WebView2/Tauri build -- see
corner-overlays' own "Why not one full-screen overlay" note), so the footprint is the sum of the
widget rects themselves, not just their painted pixels:

- Corners: `4 * 44*44` = 7,744px² (up from 5,184px²).
- Edges: `2420*20 * 2 + 20*1352` = 96,800 + 27,040 = 123,840px² (up from 24,768px²).
- **Total: 131,584px²**, up from the prior pass's 29,952px² -- **a net increase of 101,632px² (about
  4.4x)**, almost entirely from the edge strips' thickness growing 4px -> 20px (a 5x multiplier
  across a perimeter that barely changed length). This is the real cost of matching the reference's
  visual weight and deserves to be weighed plainly, not minimised.

**How much of that now sits on a tiled window, specifically (measured, not estimated).** The
corner widgets' own far corner is designed to land exactly on a tiled window's own outer corner (see
"the governing idea" above) -- so the concern is whether they land *on top of* it (dead clicks where
a user would expect the window to be interactive) rather than merely *beside* it (dead clicks in
what was already-dead padding). Measured directly against this machine's real, live tiled windows
(`komorebic state`'s per-window `rect`, cross-checked with `WindowFromPoint` + `GetAncestor(GA_ROOT)`
sampled at and around each corner):

| Corner | Widget's content corner | Real window's corner (from `komorebic state`) |
|---|---|---|
| top-left | `(96,44)` | `(97,45)` |
| top-right | `(2516,44)` | `(2515,45)` |
| bottom-left | `(96,1396)` | `(97,1395)` |
| bottom-right | `(2516,1396)` | `(2515,1395)` |

Every corner widget's rect is **adjacent to, not overlapping**, the real tiled window's rect on this
machine's current layout -- off by a consistent 1px, which `WindowFromPoint` sampling showed is
occupied by komorebi's own themed border window (`class` prefixed `komoborder-`, from this repo's
window-border theming feature -- see CLAUDE.md's "Window borders and gaps"), not bare window content
or wallpaper. `WindowFromPoint(97,45)` (1px past every corner widget's edge, into the window itself)
resolved to `wezterm-gui`/`chrome` (the real tiled window), never to `zebar`; every point actually
inside a corner widget's own rect, including its fully-transparent disc pixels, resolved to `zebar`
as expected. **Measured overlap with tiled-window interiors: ~0px²** -- better than this task's own
worst-case estimate of `4 * 24*24` = 2,304px² (which assumed the corner's whole content-facing
sub-box would land on the window; in practice the tangent point lands within 1px of the window's
real corner instead, with komorebi's own border window absorbing the seam). This was checked against
both windows on the currently-focused workspace (a two-pane split) at all four corners, not just one
sample point. It is not proven to hold for every possible tiling layout on this machine (a
differently-shaped split could, in principle, place a window's corner slightly closer to the work
area edge than `default_workspace_padding` alone would suggest) -- only that it holds for the layout
this pass actually measured against, live.

**Bottom line for the user to weigh:** the frame is now visually flush and matches the reference,
but costs a real, measured ~101,632px² more click-dead screen area than the previous 4px-hairline
design, almost entirely in the (previously mostly-empty, now much thicker) edge strips rather than at
the corners -- the corners' own overlap with actual window interiors remains close to zero, measured
live, not just assumed.

## No left band on the left corners (fifth pass, direct user feedback)

The previous pass's 44x44 left corner widgets (`corners/top-left`, `corners/bottom-left`) painted
`var(--surface)` across their FULL 44px width whenever a point fell outside the `--corner-radius`
(24px) hole -- including the left 20px of the widget, which sits directly on top of the bar (the
bar's own right edge is at x=52, flush with the corner widget's left edge). The user's explicit
instruction is that the bar itself forms the left side of the frame, so that left-hand paint was
never wanted at all: for `y` in the arc's own top/bottom band range it produced a redundant strip
sitting on top of the bar (harmless, since bar and frame are the same colour), but for `y` past the
band -- inside the widget's own 24px-radius arc region but still left of where the arc's transparent
hole reached the widget's own left edge -- that same solid paint continued for the widget's full
44px height range down to `y=44`, then stopped dead, because nothing below the widget (no left edge
strip exists, by design -- see `edges.css`) continued it. The visible result was a rectangular
step: dark extending out to `x=72` (52 + 20) for `y` in `[20,44]`, snapping back to `x=52` for
`y>44` -- confirmed by eye in a 5x zoomed screenshot of the top-left corner, not just by pixel
sampling (a corrupted-but-clean-looking earlier pass in this project's history is the reason this
task insisted on actually looking at the image, not just sampling colour at a few points).

**The fix is a single-axis width change, nothing else.** `corners/top-left` and
`corners/bottom-left` shrink from 44px to `--corner-radius` (24px) wide in `zpack.json` -- exactly
zero left-band term, not just a smaller one -- while staying 44px (`--frame-band + --corner-radius`)
tall, since their top-or-bottom band is real and unaffected. `corners.css`'s gradient rules
(`at bottom right` / `at top right`) are percentage-based against the widget's own box, so they
re-center on the new, narrower box automatically; no CSS values changed, only the widget dimensions
in `zpack.json`. `edges/top` and `edges/bottom` re-anchor to the left corners' new, closer tangent
point: `offsetX` 96 -> 76, width 2420 -> 2440 (the two right-hand-corner-facing numbers -- `right`
edge and every corner preset's own `offsetY`/height -- are unchanged, since none of those depend on
the left corners' width).

**Geometry (measured live via `GetWindowRect` against every running `caelestia` widget process,
2560x1440 screen, all anchor `top_left` with positive absolute offsets, `dockToEdge: { enabled:
false }` on every preset):**

| Preset | Rect (screen px, `GetWindowRect`) | width x height |
|---|---|---|
| `corners/top-left` | `(52,0)-(76,44)` | 24x44 |
| `corners/top-right` | `(2516,0)-(2560,44)` | 44x44 |
| `corners/bottom-left` | `(52,1396)-(76,1440)` | 24x44 |
| `corners/bottom-right` | `(2516,1396)-(2560,1440)` | 44x44 |
| `edges/top` | `(76,0)-(2516,20)` | 2440x20 |
| `edges/right` | `(2540,44)-(2560,1396)` | 20x1352 |
| `edges/bottom` | `(76,1420)-(2516,1440)` | 2440x20 |

`corners/top-left`'s right edge (76) is `edges/top`'s left edge; `edges/top`'s right edge (2516) is
`corners/top-right`'s left edge; same pattern bottom and on the right-hand side -- all seven line up
with no gap or overlap. `corners/top-left`'s and `corners/bottom-left`'s own LEFT edge is x=52 for
their full height, flush with the bar's right edge, with no widening below y=44 or above y=1396 --
the bar itself (x in `[0,52]`, full screen height) is what makes x=52 continuous outside the corner
widgets' own y-ranges, same as it always was; nothing about this pass changes the bar. `komorebic
state`'s `work_area_size` was re-read before and after: `{left:52, top:0, right:2508, bottom:1440}`,
unchanged.

**Click-dead footprint, recomputed:**

- Corners: `2 * 24*44 + 2 * 44*44` = 2,112 + 3,872 = 5,984px² (down from 7,744px², since the two
  left corners each shed 20*44 = 880px²).
- Edges: `2440*20 * 2 + 20*1352` = 97,600 + 27,040 = 124,640px² (up from 123,840px², since `top`/
  `bottom` each gained 20*20 = 400px² of length to stay flush against the narrower left corners).
- **Total: 130,624px²**, down from the previous pass's 131,584px² -- a net decrease of 960px²
  (2,112+3,872 corners lost 1,760px² combined, edges gained 800px² combined, net -960). This pass
  is a shape fix, not primarily a footprint change -- the small net decrease is incidental, not the
  point of the fix.

**Visual result (screenshotted top-left and bottom-left corners at 5x nearest-neighbour zoom,
crops `x:0-140,y:0-110` and `x:0-140,y:1330-1440`):** the step is gone -- the dark frame now reads
as one continuous edge: solid from the physical screen top/bottom edge, curving smoothly through a
90-degree arc, then straight down (or up) the bar's own right edge at x=52 with no jog, notch, or
discontinuity at the corner-to-bar junction, top or bottom. The two right corners are visually
unchanged (still 44x44, still keep their right-hand band) and were re-checked at the same zoom to
confirm this pass didn't disturb them.

## Installing/uninstalling

```powershell
. .\scripts\Install-Config.ps1
Install-Config -DryRun            # prints what would be patched/junctioned/registered, touches nothing
Install-Config                    # patches ~/.config/whkdrc's caelestia-shell block, creates the junction,
                                   # AND registers caelestia/bar in ~/.glzr/zebar/settings.json's startupConfigs
Install-Config -Uninstall         # removes the whkdrc block, the junction, and the startupConfigs entry; repo untouched
```

`.wezterm.lua` is deliberately **not** one of `Install-Config`'s targets — see
`docs/wezterm-integration.md` for why (that config is live, working, and outside version control;
re-patching it here just to prove the mechanism risks breaking the terminal this very session runs
in).

**`~/.glzr/zebar/settings.json`'s `startupConfigs` (final review, I4):** the original spec listed
this as a third patched target alongside whkdrc and the junction; it shipped with only the other
two, so the bar had **no autostart at all** — after a reboot (this doc's own prescribed WebView2
recovery step), the bar would never come back on its own. `Set-ZebarStartupConfig`/
`Remove-ZebarStartupConfig` (`scripts\Install-Config.ps1`) now patch it with a **structural JSON
edit** (parse/mutate/serialize), not a marker block — `settings.json` is Zebar's own config with
its own schema and no comment syntax to hang a marker on. Every other `startupConfigs` entry (in
particular the pre-existing `gunturdwiap.good-enough` autostart) and any other top-level field
(`$schema`) are preserved untouched; matching is by `pack`+`widget`, so re-running `Install-Config`
updates this pack's entry in place rather than duplicating it. `Apply-Theme.ps1`'s
`Restart-ZebarWidgets` (see above) reads this same field via a shared reader,
`Get-ZebarStartupConfigs`, so both the writer and the restart logic can never drift apart on what
`startupConfigs` means.

**`-Uninstall -DryRun` really did delete the junction (final review, I1):** the `-DryRun` guard
used to sit only on the install branch (`elseif (-not $DryRun)`); `-Uninstall -DryRun` fell
straight through to a real, unconditional `Remove-Item` on the junction, while the per-target loop
above printed `"would patch ..."` and this very doc (and `README.md`) promised `-DryRun` "touches
nothing". Fixed by making the whole junction/`startupConfigs` step — both directions — share one
`-DryRun` guard. `Install-Config` also gained override parameters for every real path
(`-WhkdrcPath`, `-JunctionLink`, `-JunctionTarget`, `-BackupRoot`, `-ZebarSettingsPath`, all
defaulting to the real locations) — previously every path was hardcoded, which is exactly why this
bug shipped with nothing able to exercise the function against a throwaway fixture instead of the
real machine. `tests\InstallConfig.Tests.ps1` now runs `Install-Config` itself (all four
DryRun/Uninstall combinations) against isolated temp fixtures, not just its `Set-PatchedBlock`/
`Set-ManagedJunction` primitives.
