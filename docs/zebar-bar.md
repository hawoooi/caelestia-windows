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
