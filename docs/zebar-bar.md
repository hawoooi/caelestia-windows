# Caelestia-style Zebar bar — working knowledge

A second, vertical bar docked to the left edge of the primary monitor, built as a Zebar pack and
themed by the same matugen pipeline documented in `CLAUDE.md`. It runs **alongside** yasb (which
stays docked at the top) — this is an addition, not a replacement. Read this before changing
anything under `zebar/`.

**Status of this feature as of Task 10: the bar's code is complete and committed, but WebView2 is
currently broken on this machine (see "Troubleshooting: WebView2 renders nothing" below), so the
bar's own visual output has not been re-confirmed since Task 8. The media drawer/panel is
explicitly NOT shipped as a working feature — see "Known-incomplete: the media drawer" below.
Since `feat/corner-overlays`, the `media` bar entry itself is also disabled (removed from
`bar.config.json`, not deleted) — see "The `media` entry is disabled by config" below, a separate,
config-level concern from the drawer's own unreachability.**

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
      logo.js, workspaces.js, layoutToggle.js, activeWindow.js, media.js, clock.js,
      statusIcons.js, vesktop.js, statusCluster.js, power.js
      -- layoutToggle.js and statusCluster.js added by the lower-cluster
         restyle / tiling-layout-control pass -- see "Lower-cluster restyle,
         app-name-only activeWindow, tiling-layout control" below.
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

## The `media` entry is disabled by config (direct user feedback)

**Separate concern from the drawer's own unreachability above.** The drawer/panel was already
known-unshippable (see above); independently of that, the top-line `media` *pill* itself —
`entries/media.js`'s `el`, the one showing a track title down the middle of the bar, not the
`.media-panel` drawer — was still rendering in the strip and scrolling/clipping a long title
(observed live: `TORONTONIANS PLAY VALORAN…`) through the vertical column. Direct user feedback:
*"I think media status shouldn't be here. disable it for now."*

**The fix is config-only, not code deletion.** `"media"` was removed from `bar.config.json`'s
`entries` array (`zebar/caelestia/bar/bar.config.json`) — `entries/render.js`'s `renderEntries`
only ever constructs the types listed there (see "The entry registry" above), so an entry type
that's registered but not listed simply never gets created or appended; nothing needs to be
unregistered or wrapped in a feature flag for this to take effect. `entries/media.js`,
`entries/index.js`'s `import './media.js'` (which is what keeps the `'media'` type registered and
available), `drawer.js`, and every `.media`/`.media-panel*` rule in `style.css` are all left
exactly as they were — "for now" means this is reversible in one line, not a deletion.

**Nothing else assumed a `media` element between the spacer and the clock.** Checked: no CSS
adjacency/sibling selector (`+`, `~`, `:nth-child`) in `style.css` references entry position or
count; `entries/registry.js`'s `create()`/`knownTypes()` don't require every registered type to be
used; `bar.js`'s `providers` still declares a `media: { type: 'media' }` provider (left running —
harmless, since nothing reads `out.media` now that the entry that read it isn't constructed) and
its own per-entry `try`/`catch` in the tick loop and in `renderEntries` never assumed a fixed entry
count or shape to begin with (see "The entry registry" above — that resilience was already the
point of I3). No test asserts the literal contents of `bar.config.json`'s `entries` array either
(checked `tests/js/*.test.mjs`), so none needed updating for this change.

**How to re-enable it:** add `"media"` back into `bar.config.json`'s `entries` array, in whatever
position is wanted (it doesn't have to go back between the two `activeWindow` spacers — see "Centre
the app name..." note below for why there are two now), then restart the widget
(`Restart-ZebarWidgets`). The drawer/panel itself will still be unreachable by a real click even
once the pill is back (see "Known-incomplete: the media drawer" above) — re-enabling the entry only
restores the scrolling title pill, not a working drawer.

## vesktop icon/count stacked vertically (direct user feedback)

A screenshot of the shipped `.status-cluster` pill showed the Discord glyph
(`.vesktop__icon`) and the unread count (`.vesktop__count`) laid out side by side
(`flex-direction: row`), crowding each other against the 52px bar's own edges. Direct user
feedback: *"i think this discord icon could be laid vertically if it helps."*

`style.css`'s `.vesktop` rule flipped from `flex-direction: row` to `column` — glyph on top,
count below, both still centred via `align-items: center; justify-content: center` on the bar's
vertical axis. No JS change: `entries/vesktop.js` already appends the icon before the count
(`el.append(icon, count)`), so the existing DOM order became the existing top-to-bottom order
for free. `gap` stayed the existing `var(--space-sm)` token — the same one `.status-cluster` and
`.status-icons` already use between their own stacked rows — rather than inventing a new spacing
value, per the brief's explicit ask to match the rest of the bar's rhythm. `min-height:
var(--icon-box)` (a square-box leftover from the row layout) was dropped since stacked content is
naturally taller than one icon row; `min-width: var(--icon-box)` stayed, so vesktop's column keeps
the same horizontal footprint as `.status-icons__glyph`'s own box inside the shared pill. The
badge/colour treatment (`.vesktop--pinged { color: var(--primary); font-weight: 700; }`) is
untouched.

## Centre the app name in the vacant space (direct user feedback)

With `media` disabled (see above), the run between the top group (`logo`, `workspaces`,
`layoutToggle`) and the bottom group (`clock`, `statusCluster`, `power`) is now a large empty gap
— `activeWindow` used to sit flush directly under `layoutToggle`, at the top of that gap, not
centred within it. Direct user feedback: *"put the app name on the middle of the vacant space
between the top and bottom."*

**The fix is a second `spacer`, not a pixel offset.** `bar.config.json`'s `entries` array is now
`["logo", "workspaces", "layoutToggle", "spacer", "activeWindow", "spacer", "clock",
"statusCluster", "power"]` — one `.entry--spacer` (`flex: 1 1 auto`, already used elsewhere in this
file to push the lower cluster to the bottom of the strip) immediately before `activeWindow` and
another immediately after it. `#bar` is `display: flex; flex-direction: column`, so the two
spacers — both empty, both `flex: 1 1 auto`, so both grow from the same zero content-basis — split
whatever vertical space is left over between the two groups exactly evenly, landing `activeWindow`
in the middle of that space regardless of how tall either group currently is (workspace count,
clock width, whether vesktop is showing a badge). This was the user's own suggested approach and
is deliberately not a hardcoded pixel offset computed from the top/bottom groups' current
heights — a pixel value would be correct only until either group's height changed, where the flex
split is correct by construction. The top group still sits flush at the top (nothing precedes it
to push it down) and the bottom group still sits flush at the bottom (nothing follows `power` to
push it up), exactly as before — only the middle run changed.

`activeWindow`'s existing ellipsis truncation (`entries/activeWindow.js`'s `appName()` backstop at
`MAX_LEN`, plus `style.css`'s `.active-window` `overflow: hidden; text-overflow: ellipsis;
white-space: nowrap;`) is unaffected by sitting between two flex spacers instead of one — the
element itself has no `flex` property of its own, so it keeps its own intrinsic (capped) size
regardless of how the surrounding spacers grow; verified with a long unaliased exe name run through
the same render path (see the Verify section of this change's own report for the screenshot).

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
- **`--outline` is generated but unused; `--surface-container`/`--surface-container-high` are now
  both wired (M4, updated).** `--surface-container` backs the lower-cluster's `.status-cluster`
  pill (see below); `--surface-container-high` was added specifically for the hover/press circle
  behind actually-clickable lower-bar items (`.bar-btn:hover`/`:active` in `style.css`) — eight
  properties now render into `theme.css` (`matugen/templates/zebar.theme.css`), not seven; the
  zero-color-literal test's non-vacuousness check (`tests\Get-ColorLiterals.Tests.ps1`) was updated
  from 7 to 8 accordingly. `--outline` alone remains unused — recorded so a future pass doesn't
  assume it's wired up somewhere non-obvious, and so removing it isn't done under the mistaken
  belief it has no future use in mind.

**Wiring `power.js` for real, when that's picked up:** it currently only does
`console.warn('power action not yet wired')` behind a `confirm()` guard — no `shellExec` call
exists yet, and `zpack.json`'s `privileges.shellCommands` allowlist has no shutdown binary in it.
When it is wired, the allowlist entry's `argsRegex` **must** be pinned to the exact expected
argument string (e.g. `^/s /t 0$` for `shutdown.exe`), never a permissive pattern like `.*` — an
over-broad `argsRegex` on a shutdown binary is the most dangerous single edit anyone could make to
this file: it would let *any* JS running in this widget's page shut the machine down with whatever
arguments it likes, not just the one confirm-gated button this pack ships.

## Troubleshooting: the bar renders nothing

**Check this FIRST, before suspecting WebView2:** an orphaned `fullscreen-detect.exe` holding
port 6124 is a confirmed, real cause of "the bar renders nothing" on this machine, and has already
cost **two separate agents roughly an hour each** misdiagnosing it as the WebView2 problem
described further down this section. A five-second check settles which one you're looking at —
see "Cause (confirmed, check this first)" immediately below — before spending any time on the
WebView2 remediations at the bottom of this section, which do NOT apply to this failure mode and
will not fix it.

### Cause (confirmed, check this first): an orphaned `fullscreen-detect.exe` holding port 6124

**Symptom:** identical to the WebView2 symptom below from the outside — the widget window(s) open,
hold their position and komorebi work-area reservation correctly, but nothing visibly renders.
The distinguishing signal is in the log, not the screen: `state\zebar-logs\<slug>.out.log` (or
`.err.log`) for the run shows `Asset server failed during runtime: Bind(Os { code: 10048, kind:
AddrInUse, ... })` — zebar's own internal Rocket asset server (the one that serves
`http://127.0.0.1:6124/...`, see "Pack layout" above) failed to bind its port, so it never served
`index.html` at all. **Check this before anything else**: `Get-NetTCPConnection -LocalPort 6124`.
If a PID shows up there and `Get-Process -Id <that PID>` returns nothing, or returns a
`fullscreen-detect` process, that confirms this cause.

**Root cause:** `fullscreen.js`'s `startFullscreenWatch` polls a tiny helper,
`tools/fullscreen-detect.exe`, roughly once a second via `shellExec` (see "Fullscreen auto-hide"
above). That helper is a short-lived child process launched via Windows' `CreateProcess` — and,
critically, `CreateProcess` by default can inherit the **launching process's own open handles**,
including a listening socket, unless the caller explicitly marks that handle non-inheritable or
passes `bInheritHandles=FALSE`. When zebar itself is killed (a normal `Restart-ZebarWidgets`
stop/start cycle, or any crash) while a `fullscreen-detect.exe` child is still alive, that child
can be left holding an inherited duplicate of zebar's own port-6124 listening socket handle. The
process itself does nothing with that handle — it never listens on it, it's just an incidental
open handle from inheritance — but as long as the process is alive, the socket stays bound at the
OS level. The next zebar start then fails to bind port 6124 at all, because something (a process
Windows still considers alive, even though it isn't zebar and isn't doing anything useful with the
handle) is still holding it. Corroborating evidence found live during this task: querying
`Get-NetTCPConnection -LocalPort 9222` (a CDP remote-debugging port opened the same way, for
unrelated diagnostic purposes) during this same investigation showed **two different PIDs**
simultaneously reporting `Listen` state on the identical port — the same inherited-duplicate-handle
shape of bug, observed on a second, unrelated port, from the same process tree.

**Fix: kill the orphaned `fullscreen-detect.exe`, never touch `msedgewebview2`.**
`Get-Process fullscreen-detect | Stop-Process -Force` releases the inherited handle and frees the
port immediately; killing WebView2 (see below) does nothing for this cause and only trades one
outage for a much longer one. `scripts/Apply-Theme.ps1`'s `Restart-ZebarWidgets` now does this
reap automatically, every restart, before starting any widget back up — see "Reloading zebar after
a theme apply" above and the function's own doc comment. If port 6124 is *still* held after that
automatic reap (e.g. by something other than `fullscreen-detect.exe`), `Restart-ZebarWidgets` now
warns with the exact holding PID and process name instead of the widgets simply failing to bind in
silence.

`fullscreen.js` was also hardened against the underlying pattern that let a probe outlive its
parent in the first place: each poll now races against a timeout (default 2s) so a hung probe is
abandoned rather than awaited forever, and a new poll is never started while the previous one is
still outstanding (an `inFlight` guard) — see that file's own doc comment and
`tests/js/fullscreen.test.mjs` for the two tests covering this directly. Neither change can
force-terminate the underlying Win32 process (`shellExec` exposes no handle for that, unlike
`shellSpawn`+`shellKill`); they only stop this module's own polling loop from ever compounding a
single hung probe into a pile of them, and the `Restart-ZebarWidgets` reap is the actual cleanup
for a process that does end up orphaned regardless.

### A separate, historical cause: a genuine WebView2 session problem (`about:blank`)

**This is a different failure mode from the one above and does NOT apply if `Get-NetTCPConnection
-LocalPort 6124` showed the port already held before zebar even started** — check that first.
Kept here because it is a real failure this pack hit once, and the remediations below remain
correct advice *for this specific cause*, not for the port-6124 orphan above.

**Symptom:** the Zebar widget window opens, holds its position and its komorebi work-area
reservation correctly, and Windows' own hit-testing routes clicks to it correctly — but nothing
visibly renders. UI Automation shows a `Document` node with no children and a `Pane` literally
named `"about:blank"`; re-querying after several seconds shows no change (this isn't lazy
accessibility-tree population, it's a genuinely failed navigation). Zebar's own log does **not**
show the `Bind(Os { code: 10048, kind: AddrInUse, ... })` line the port-6124 orphan above produces
— the asset server bound its port fine; the WebView2 navigation itself is what failed.

**Cause:** this is an **environmental WebView2 problem on this specific machine**, triggered by
running `Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force` (done
during Task 8's cleanup, intending to reset just this pack's WebView2 state) — this force-kills
**every** WebView2 process on the machine, including shared infrastructure other apps depend on,
not just Zebar's. **Never run `Stop-Process` against `msedgewebview2` again for any reason** —
killing an orphaned `fullscreen-detect.exe` (see above) is fine and expected; killing
`msedgewebview2` is not, and is unrelated to fixing the port-6124 cause.

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
disk. The known-working fixes are a **user sign-out/sign-in, or a full reboot**. Recommended
action: next time it's convenient to sign out or reboot, do so, then re-verify the bar renders and
re-screenshot it — nothing about the code needs to change first, it's a pure environment-recovery
step. (This was, in fact, a full reboot's worth of the machine's uptime ago as of this task — the
bar renders again, and this project's own port-6124 remote-debugging session used to diagnose the
Font Awesome/layout bugs elsewhere in this doc is itself live proof WebView2 on this machine is
currently healthy.)

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

## Thinner frame, equal gaps, left band (direct user feedback, sixth pass)

Three complaints against the fifth pass's shipped frame (20px band, 24px radius, no left band),
from direct user feedback:

1. **20px read as too heavy.** The band needed to be visibly thinner.
2. **The wallpaper gap between the frame and the tiled content was whatever was left over from
   komorebi's own padding after the band ate into it** -- never a value anyone actually chose. It
   needed to be an explicit, tunable quantity, not an accident of arithmetic.
3. **The left gap was visibly unequal to the other three.** Root cause: top/right/bottom each lose
   the band's own thickness out of komorebi's padding budget (band flush against the screen/bar
   edge, content starting `padding - band` further in), but the left side had no band at all -- the
   bar (52px) stood in for one -- so its visible gap was a full band thicker than the other three.

**The fix, all driven by one new script, `scripts/Set-FrameGeometry.ps1`:**

- **Thickness dropped to `T = 8px`** (from 20px).
- **An explicit gap ratio** (`-GapRatio`, default `1.0`) makes the wallpaper gap `G = round(T *
  GapRatio)` a first-class, tunable quantity rather than a leftover. At the default 1:1 ratio,
  `G = T = 8px`.
- **komorebi's own padding is derived FROM the band+gap, not the other way around**:
  `P = T + G`, split `workspace = ceil(P/2)`, `container = floor(P/2)` (both `8` at the defaults,
  since `P = 16` splits evenly). This makes the invariant `gap == komorebi_total_padding - band`
  hold **by construction**, on every side, not just approximately.
- **A real left band was added** (`edges/left`, new preset alongside top/right/bottom) rather than
  trying to shrink the bar itself. This is the actual fix for complaint 3: once every side has a
  real `--frame-band`-thick band eating into komorebi's padding, all four sides lose the same
  amount and the invariant holds identically on the left as everywhere else. The two left corner
  widgets go back to being `--frame-band + --corner-radius` square on BOTH axes (same footprint the
  right-hand corners always had), reversing the fifth pass's "no left-band term" shrink -- see
  `corners.css`'s own `:root` comment for the full before/after account.
- **Content corner radius dropped to `R = 16px`** (from 24px), picked together with the thinner
  band rather than independently, to keep the arc reading proportionate at the new, thinner weight.

**Corner size is now uniform on every corner: `C = T + R = 24px` square**, unlike the fifth pass
(where the two left corners were `R`-wide only). The paint technique itself did not change --
still one `radial-gradient` per corner (`corners.css`'s `body.corner--*` rules), hard-stopped at
`--corner-radius` from the widget's own content-facing corner -- because with every corner back to
a square `T+R` footprint, the same three-piece equivalence proof (two `T`-thick bands + an `R`x`R`
arc box) the fourth pass established for the right-hand corners now applies identically to all
four.

**Geometry, derived by `Set-FrameGeometry.ps1` from the screen size (`System.Windows.Forms.Screen`)
and the bar's own width (read from `zpack.json`, never hardcoded a second time) and confirmed live
via `GetWindowRect` against every running `caelestia` widget process, 2560x1440 screen, `T=8`,
`GapRatio=1` (`G=8`), `R=16` (`C=24`):**

| Preset | Rect (screen px, `GetWindowRect`) | width x height |
|---|---|---|
| `corners/top-left` | `(52,0)-(76,24)` | 24x24 |
| `corners/top-right` | `(2536,0)-(2560,24)` | 24x24 |
| `corners/bottom-left` | `(52,1416)-(76,1440)` | 24x24 |
| `corners/bottom-right` | `(2536,1416)-(2560,1440)` | 24x24 |
| `edges/top` | `(76,0)-(2536,8)` | 2460x8 |
| `edges/bottom` | `(76,1432)-(2536,1440)` | 2460x8 |
| `edges/left` (**new**) | `(52,24)-(60,1416)` | 8x1392 |
| `edges/right` | `(2552,24)-(2560,1416)` | 8x1392 |

All eight rects line up with no gap or overlap (`corners/top-left`'s right edge (76) is
`edges/top`'s left edge; `edges/left`'s top edge (24) is `corners/top-left`'s bottom edge, and its
bottom edge (1416) is `corners/bottom-left`'s top edge; same pattern at every other junction, on
both the left and right sides). `komorebic state`'s
`work_area_size` was re-read before and after: `{left:52, top:0, right:2508, bottom:1440}`,
unchanged -- `dockToEdge: { enabled: false }` on every corner/edge preset still reserves nothing.
`~/komorebi.json`'s `default_workspace_padding`/`default_container_padding` are both `8` (down from
20), applied live via `komorebic workspace-padding`/`container-padding` per workspace as well as
persisted to disk, per `Set-FrameGeometry.ps1`'s own contract (see below).

**The four gaps, measured two independent ways, both confirming exact equality:**

1. **Direct pixel-colour-boundary scan** (`Bitmap.GetPixel` along a line crossing each side, away
   from any corner): every side shows the identical three-band pattern -- `--surface` (`#0F1416`,
   the frame's own paint) for exactly 8px, then the wallpaper's own colour (revealed through the
   transparent gap) for **exactly 8px**, then komorebi's own themed border (`#899296`, the
   `unfocused` role's colour, since neither pane was focused at measurement time), then the tiled
   window's real content. Measured at `x=1000` (top, gap = y8-y15), `y=700` (right, gap =
   x2544-x2551), `x=1000` (bottom, gap = y1424-y1431), and `x=60-67` (left, gap = exactly 8 pixels
   between the band's end at x=60 and komorebi's border at x=68) -- **all four gaps are exactly
   8px**, matching `G` to the pixel.
2. **`komorebic state`'s own window rects** (the tiled application's rect, not komorebi's border
   window): a consistent **13px** on all four sides (left/top/right/bottom), also exactly equal.
   The extra 5px on top of the design's 8px is komorebi's own border decoration
   (`border_offset: 1` + `border_width: 4` = 5px, from `~/komorebi.json`'s pre-existing border
   theming -- see CLAUDE.md's "Window borders and gaps") straddling the true padding boundary
   outside the application's own window rect. Confirmed directly: the `komoborder-*` window class's
   own `GetWindowRect` sits exactly at the design boundary (`(68,16)-(1298,1424)` for the left pane
   in the layout measured, `(1314,16)-(2544,1424)` for the right pane) -- i.e. **zero** discrepancy
   between the intended 8px gap and where komorebi's own border actually renders; the 13px number is
   purely an artifact of measuring against the app's own window rect instead of the true tiling
   boundary. Either measurement is internally consistent across all four sides, which is the actual
   invariant this pass exists to fix.

**Visual result (screenshotted top-left corner at `x:40-110,y:0-70` and the full left edge at
`x:40-110,y:600-700`, both 8x nearest-neighbour zoom):** the dark `--surface` band runs unbroken
from the bar's own interior straight through the corner widget and down the entire left edge --
bar and frame are visually one continuous surface, exactly as intended. Past the band, an even
strip of bare wallpaper is visible (the `G=8px` gap), curving smoothly through the corner's
90-degree arc at the top and running as a straight parallel strip down the rest of the left edge,
with komorebi's own thin grey border visible just before the tiled window's real content starts.
No jog, step, or thickness change anywhere along the curve or the straight run, and the gap reads
visually even compared to the top edge.

**Click-dead footprint, recomputed** (`4 * 24*24` corners + `2460*8*2 + 8*1392*2` edges):

- Corners: `4 * 24*24` = 2,304px² (down from 5,984px²).
- Edges: `2460*8 * 2 + 8*1392 * 2` = 39,360 + 22,272 = 61,632px² (down from 124,640px², even after
  adding the new `edges/left` strip, because the band's own thickness fell from 20px to 8px --
  a 2.5x reduction per strip more than offsets one extra strip).
- **Total: 63,936px²**, down from the fifth pass's 130,624px² -- **a reduction of 66,688px² (about
  51%)**, the sharpest drop of any pass in this file's history, driven almost entirely by the
  thickness cut (20px -> 8px) rather than the left-band addition (which by itself would have grown
  the footprint).

## The tunability knob: `Set-FrameGeometry.ps1`

`scripts/Set-FrameGeometry.ps1` is the **only supported way** to retune the frame's thickness, gap,
or radius. Hand-editing `zpack.json` alone (or `corners.css`/`edges.css` alone, or
`~/komorebi.json` alone) will silently break the `gap == komorebi_total_padding - band` invariant
this whole pass exists to establish -- the four files have to move together, and this script is the
one place that does the arithmetic once and writes it everywhere.

```powershell
. .\scripts\Set-FrameGeometry.ps1
Set-FrameGeometry -DryRun                                    # prints the computed 8-preset table + padding split, writes nothing
Set-FrameGeometry -Thickness 8 -GapRatio 1.0 -Radius 16       # the current defaults, applied for real
Set-FrameGeometry -Thickness 12 -GapRatio 0.5 -Radius 20      # example retune: thicker band, half-thickness gap, bigger radius
```

What a real (non-`-DryRun`) run does, in order:

1. Reads the bar's real width from `zpack.json` and the primary monitor's real size from
   `System.Windows.Forms.Screen` -- never a hardcoded `52`/`2560`/`1440` a second time.
2. Computes `G = round(T * GapRatio)`, `P = T + G`, `workspace = ceil(P/2)`, `container = floor(P/2)`.
3. Rewrites all eight `corners`/`edges` presets in `zebar/caelestia/zpack.json` (structural
   parse/mutate/serialize, same family of pattern as `Set-ZebarStartupConfig` --
   `scripts/Install-Config.ps1`) from the formulas in "Geometry" above. A preset with no existing
   match (e.g. `edges/left` against an older, pre-this-pass `zpack.json`) is appended, not skipped.
4. Rewrites `--frame-band`/`--corner-radius` in `corners/corners.css` and `--frame-band` in
   `edges/edges.css` (a documentation/parity property there -- see that file's own `:root`
   comment -- not read by any paint rule, since each `edges` preset's real thickness comes from its
   own `zpack.json` width/height, same as always).
5. Backs up `~/komorebi.json` (into `state/config-backup/komorebi.json.bak-frame-geometry-<stamp>`)
   and then surgically updates `default_workspace_padding`/`default_container_padding`, using the
   **exact** parse -> mutate -> serialize -> temp-file -> `Move-Item -Force` pattern
   `Set-KomorebiBorderColours` (`scripts/Apply-Theme.ps1`) established, including its guard against
   content that parses to `$null` (empty/whitespace/literal `null`) or to a non-object.
6. Applies the new padding live, per workspace, via `komorebic workspace-padding`/
   `container-padding` -- enumerated from `komorebic state`'s own monitor/workspace list, not a
   hardcoded "9 workspaces on monitor 0". Entirely fail-soft (`komorebic` missing from PATH, or
   komorebi not running, warns and returns) -- `~/komorebi.json` is already updated by step 5 by the
   time this runs, so a dead komorebi still picks up the new padding on its next start.

This does **not** restart Zebar or touch `~/.glzr/zebar/settings.json` itself -- run
`Restart-ZebarWidgets` (`scripts/Apply-Theme.ps1`) afterward to make a running bar pick up the new
`zpack.json`/CSS (Zebar has no hot reload -- see "Starting, stopping, and reloading" above), and
`Install-Config` if a brand-new preset (like `edges/left`, the first time this pass's script runs
against an older checkout) needs registering into `startupConfigs` so it survives a reboot.

Covered by `tests/SetFrameGeometry.Tests.ps1`: the computed table for the current defaults
(`-Thickness 8 -GapRatio 1 -Radius 16`) is asserted against this section's own target table
byte-for-byte, the `gap == totalPadding - thickness` invariant is checked across several thickness
and gap-ratio values (including non-1:1 ratios and an intentionally odd total-padding value, to
exercise the `ceil`/`floor` split asymmetrically), and the live `komorebic` calls are mocked out
(same technique `tests/ApplyTheme.Tests.ps1` already uses for `Set-KomorebiBorderColour`) so running
the suite never mutates the real machine's live tiling padding as a side effect.

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

## Lower-cluster restyle, app-name-only activeWindow, tiling-layout control

Three related changes on `feat/corner-overlays`, none of which touch `corners/`, `edges/`,
`zpack.json`'s frame presets, or `Set-FrameGeometry.ps1` (that work is finished and out of scope
here).

### 1. Lower bar cluster (`clock`/`statusCluster`/`power`)

The lower half previously rendered `clock`, `statusIcons`, and `vesktop` as three independent bare
entries with no shared container, at a glyph size (~14px, inherited from `#bar`'s 16px font) that
read as undersized on a 52px-wide bar. The user twice rejected a "pills" reading that meant
per-icon boxed chips (yasb's own visual language) — what Caelestia actually does is group related
items onto ONE elevated rounded surface.

- **`entries/statusCluster.js`** (new) composes the *existing*, still separately registered and
  unit-tested `statusIcons`/`vesktop` factories via `registry.js`'s own `create()` — it does not
  duplicate `statusIconParts()`/`pingState()`. `bar.config.json`'s `statusIcons`/`vesktop` entries
  were replaced with one `statusCluster` entry; `power` stays a separate top-level entry, per the
  brief ("power stays visually separate at the very bottom, as its own circular button").
- **`.status-cluster`** (`style.css`): `background: var(--surface-container)`,
  `border-radius: var(--radius-full)` (999px), uniform `gap`/`padding` from the existing spacing
  tokens. `--icon-size` (18px), `--icon-box` (28px, the passive glyph box), and `--hit-size` (32px,
  the clickable circular hit/hover target) were added to the existing `:root` token block rather
  than inlining new magic numbers.
- **`.bar-btn`**: the one shared clickable-affordance class (circular `var(--surface-container-high)`
  hover background, `transform: scale(0.92)` on `:active`). Applied ONLY to `power` (already had a
  real click handler — a `confirm()` dialog) and the new `layoutToggle` (below, real `change-layout`
  click handler) — never to `statusIcons`/`vesktop`, which have no click handler at all. The user has
  complained before that bar buttons do nothing on click; the same principle in reverse — a hover
  affordance on something inert — was avoided deliberately.
- **`--surface-container-high`** did not previously exist in `theme.css` — added to
  `matugen/templates/zebar.theme.css` (`{{colors.surface_container_high.default.hex}}`, the same
  matugen role already used, retired, in `matugen/mapping.json` for yasb) and regenerated via a real
  `Apply-Theme` run (colors otherwise unchanged: same probe image, same palette). `theme.css` now
  renders 8 custom properties, not 7 — `tests\Get-ColorLiterals.Tests.ps1`'s non-vacuousness check
  was updated to match (see "Known-minor gaps" above).
- **Clock**: `font-variant-numeric: tabular-nums lining-nums` (digits share one fixed width, so
  "23"→"22" never jitters the stacked HH/MM column) and `font-weight: 600`, deliberately heavier than
  the icons' default 400.

### 2. `activeWindow`: app name only, derived from `exe`

Previously rendered the focused window's full `title`, which routinely overflowed the 52px vertical
strip's 240px max-height column mid-string (the observed case: `imation movie "Before you`, a
fragment of a much longer real title).

`entries/activeWindow.js`'s container/focus-selection logic — `focusedWorkspace.focusedContainerIndex`
→ that container's `windows[0]` (there is no per-window focus flag or within-container focused-index
field anywhere in zebar's own `KomorebiWindow`/`KomorebiContainer` types at 3.3.1, see this file's
existing "The komorebi provider's window-focus shape" section above) — is **unchanged**, renamed
`focusedWindow()` and returning the window object instead of its title string, so `appName()` can
read whichever field it needs. `KomorebiWindow.exe: string | null` was confirmed directly against
`zebar@3.3.1`'s own shipped `dist/index.d.ts` (not assumed, and not the same npm package the
`isFocused` mistake elsewhere in this pack came from guessing against) and against a live
`komorebic state` capture taken during this task, which showed real, populated `exe` values on every
window (`wezterm-gui.exe`, `vesktop.exe`, `chrome.exe`, `explorer.exe`, `foobar2000.exe`).

`appName(exe)` (`entries/activeWindow.js`): strips a trailing `.exe` (case-insensitively), maps the
lower-cased result through a small alias table (`wezterm-gui`→WezTerm, `code`→VS Code,
`explorer`→Explorer, `chrome`→Chrome, `msedge`→Edge), and falls back to the stripped name unchanged
when there's no alias — never to the window title, which the function's own signature (`exe` only,
no `title` parameter) makes structurally impossible, not just a runtime choice. A 14-character
backstop truncation (`…` suffix) guards a genuinely long, unaliased exe name, independent of
`.active-window`'s existing CSS `text-overflow: ellipsis` (which, in a fixed-max-height vertical
writing-mode column, clips wherever the box ends rather than guaranteeing a visible ellipsis — the
exact mechanism behind the original mid-string-fragment bug).

### 3. Tiling-layout control (`layoutToggle`)

A new bar entry (`entries/layoutToggle.js`), placed on the bar itself between `workspaces` and
`activeWindow` in `bar.config.json` (`["logo","workspaces","layoutToggle","activeWindow",...]`),
per the user's explicit requirement that this be a bar control, not a hotkey or menu.

**Design: a button cycling a curated 4-layout list** (`LAYOUT_CYCLE = ['bsp', 'columns', 'rows',
'grid']`), read against the real current layout from the komorebi provider's own workspace object
(`out.komorebi.focusedWorkspace.layout`) on every tick — never tracked in local state — so the
button's glyph stays correct even when the layout was last changed by hotkey. The click handler
independently re-reads `ctx.providers.outputMap` at click time (not a value captured in `update()`'s
closure), so it can never act on a stale layout either.

**`columns` needed a live check, not an assumption.** It is confirmed present on this machine's real
`komorebic.exe` (`change-layout --help` lists it, distinct from `bsp`), but it is **not** one of the
eight strings zebar's own `KomorebiLayout` TypeScript union declares at 3.3.1 (`bsp | vertical_stack
| horizontal_stack | ultrawide_vertical_stack | rows | grid | right_main_vertical_stack | custom`) —
checked directly against the same shipped `dist/index.d.ts` used for `exe` above, the type source
that already once caught a real bug in this pack (the `isFocused` field that never existed — see
"The komorebi provider's window-focus shape"). Live-tested during this task, cautiously and with the
end state restored: `change-layout bsp|columns|rows|grid|vertical-stack` were each run in turn
against the real `komorebic.exe`, with `komorebic state` re-read after each to confirm komorebi
itself accepted and reported the change, `zebar`'s `errors.log` checked for new lines (none), and
the running bar screenshotted mid-sequence (workspaces/active-window/media/clock all still
rendering) to confirm the live provider subscription wasn't disrupted. Ended back on `bsp`, per this
task's own safety constraint. Given the CLI-side round-trip is confirmed safe but what the *provider*
reports back for a `Columns` workspace is not (most likely `custom`, per the union above, but never
directly observed), `currentLayout()`'s `PROVIDER_TO_CYCLE` map only translates the three provider
strings that ARE in the confirmed union (`bsp`/`rows`/`grid`); an unrecognized report — including,
most likely, `columns` itself — degrades to `null` → the fallback glyph (`▧`), never a guessed-wrong
specific one. This is a deliberate asymmetry (the CLI command list and the provider-read map are not
mirror images of each other) and is commented as such in `layoutToggle.js`, not left implicit.

**Privilege widening (`zpack.json`, `bar` widget only):** the existing `komorebic.exe` allowlist
entry's `argsRegex` widened from `^focus-workspace \d$` to
`^(focus-workspace \d|change-layout (bsp|columns|rows|grid))$` — an anchored alternation covering
exactly `focus-workspace <digit>` (pre-existing, `workspaces.js`) and `change-layout` with exactly
the four curated values (new, `layoutToggle.js`), and nothing else — no `flip-layout`, no
`vertical-stack`/`horizontal-stack`/other layouts this button never calls, no catch-all.

Styled consistently with change 1: `layout-toggle bar-btn` (same circular hover/press affordance).
Hides with the rest of the bar on fullscreen automatically, with no extra code — it is just another
child of `#bar`, and `body.fullscreen-hidden #bar { display: none; }` (pre-existing, see "Nerd Font
glyphs"/fullscreen-auto-hide sections above) hides the whole bar including every entry inside it.

### Verification notes

Both `node --test` (70 tests, up from 53 — new coverage for `appName`, `focusedWindow`,
`LAYOUT_CYCLE`/`currentLayout`/`nextLayout`/`layoutGlyph`/`changeLayoutCommand` in
`tests/js/entries.test.mjs`) and the Pester suite (156 tests, unchanged count — one assertion value
updated from 7 to 8) were run green after every change. `statusCluster`'s DOM composition (no pure
branching logic of its own worth a `node --test` case, consistent with how `spacer`'s equally
trivial factory in `entries/index.js` is untested) was instead exercised directly against a minimal
hand-rolled `document.createElement` stub during this task (not committed — a throwaway
verification script), confirming it appends exactly the `statusIcons`/`vesktop` children and that
`update()` forwards to both.

## Left-frame removal, arcs moved in, equal four-sided gap (seventh pass, direct user feedback)

Direct user feedback against the sixth pass's shipped frame ("the elements on this have an extra
space from the border on the side makes everything feel uncentered" / "is it possible to remove
the extra border on the left and move the arcs in?"). Root cause: the bar is 52px and its own
contents are centred within that 52px, but the sixth pass's `edges/left` band (8px, at screen
`x 52..60`) is the same `--surface` colour as the bar, so the eye reads a 60px-wide surface with
the bar's contents sitting 4px left of that wider surface's own centre. Deleting the band makes the
visual surface and the content box the same 52px again, fixing the off-centre read structurally.

**`edges/left` is gone.** Not hidden, not zero-sized -- the preset itself no longer exists in
`zebar/caelestia/zpack.json`, in `~/.glzr/zebar/settings.json`'s `startupConfigs` (pruned by
`Install-Config`'s existing prune-then-re-add pattern, `$edgePresets` shrunk back to
`@('top', 'right', 'bottom')`), or in `Set-FrameGeometry.ps1`'s own `Get-FrameGeometryTable`, which
now returns exactly seven rows, not eight (`Set-FrameZpackGeometry` also gained real pruning: any
preset already in `zpack.json` on a widget the table touches, whose name is no longer in the table,
is now deleted -- previously the function could only update-in-place or append, never remove, which
would have left a stale `edges/left` behind forever on a machine that already had one).

**The two LEFT corner widgets shrink from `T+R` (24px) to `R` (16px) wide**, staying `T+R` (24px)
tall -- the fifth pass's "no left band" shape, reapplied at this pass's own thinner `T=8`/`R=16`
values rather than the fifth pass's old `T=20`/`R=24` ones. The two RIGHT corners and `edges/right`
are completely unchanged. The gradient paint rule in `corners.css` needed **zero changes** -- `at
bottom right`/`at top right` are percentage-based against each widget's own box, so a narrower box
re-centres the same hard-stopped-circle math automatically (worked through by hand: for the
narrower left corner, the same fixed-radius circle still produces a clean `--frame-band`-thick top
(or bottom) band followed by a `--corner-radius`-tall arc region, never a distorted ellipse -- see
`corners.css`'s own `:root` comment for the full account).

**Geometry (screen 2560x1440, `T=8`, `R=16`, `C=T+R=24`, bar width `B=52`), computed by
`Set-FrameGeometry.ps1`'s `Get-FrameGeometryTable` and confirmed live via `GetWindowRect` against
every running `caelestia` widget process after a full restart:**

| Preset | OffsetX | OffsetY | Width | Height |
|---|---|---|---|---|
| `corners/top-left` | 52px | 0px | **16px** | 24px |
| `corners/top-right` | 2536px | 0px | 24px | 24px |
| `corners/bottom-left` | 52px | 1416px | **16px** | 24px |
| `corners/bottom-right` | 2536px | 1416px | 24px | 24px |
| `edges/top` | **68px** | 0px | **2468px** | 8px |
| `edges/bottom` | **68px** | 1432px | **2468px** | 8px |
| `edges/right` | 2552px | 24px | 8px | 1392px |

`edges/top`/`edges/bottom`'s new formula: `OffsetX = B + R` (68 = 52 + 16, the left corner's own
narrower right edge), `Width = (W - C) - (B + R)` (2468 = 2536 - 68, flush against the right
corner's own left edge). Confirmed live: `komorebic state`'s `work_area_size` re-read before and
after this pass's restart, `{left:52, top:0, right:2508, bottom:1440}`, unchanged -- none of this
touches the bar's own `dockToEdge` reservation.

### The work-area-offset trick -- how it eventually DID ship

**This section's original conclusion was wrong, and is kept below only as a record of how the wrong
conclusion was reached.** The offset works. It ships. All four gaps are 8px.

What actually happened: `global_work_area_offset` has to be set in `~/komorebi.json` and is read
**only at komorebi startup** -- the `komorebic global-work-area-offset` CLI genuinely is a no-op
(exits `0`, changes nothing), so attempt 1 below was a correct observation of the *CLI*, wrongly
generalised to the *feature*. The value that works is `{ "left": -8, "top": 0, "right": -8,
"bottom": 0 }`, applied by `Set-KomorebiFramePadding` in `scripts/Set-FrameGeometry.ps1` as
`left == right == -Thickness`. `left` shifts the work area's origin; `right` shrinks its **width**;
the two are independent (komorebic's own `--help` says "set right to left * 2 to maintain right
padding"). So `-8` on both moves the left edge in by 8 while leaving the right edge exactly at 2560.

**The trap that cost two passes:** komorebi **never reflects this back**. After a restart with the
offset in place and demonstrably in effect, `komorebic state` still reports
`monitors[0].work_area_size` as `{left:52, top:0, right:2508, bottom:1440}` and
`monitors[0].work_area_offset` as *empty*. Reading those fields tells you nothing. **Verify by
measuring where tiled windows actually land** -- scan a horizontal line of screen pixels across the
left edge and find the colour transitions. Measured after the change, at `y=700`:

| side | band | wallpaper gap | komorebi border |
|---|---|---|---|
| top | `y 0..7` | `y 8..15` | `y 16..18` |
| left | bar `x 0..51` | `x 52..59` | `x 60..62` |
| right | `x 2552..2559` | `x 2544..2551` | `x 2541..2543` |
| bottom | `y 1432..1439` | `y 1424..1431` | `y 1421..1423` |

All four gaps 8px. Changing the frame thickness via `Set-FrameGeometry` rewrites the offset to match,
so the invariant survives retuning -- but **komorebi must be restarted** (`komorebic stop`, then
`komorebic start --config "$env:USERPROFILE\komorebi.json"`) for a changed offset to take effect,
unlike the padding half, which applies live via `komorebic workspace-padding`/`container-padding`.

### Historical: why the offset was first believed NOT to work

Without a left band, the left gap (bar's right edge at x=52 to a tiled window's own outer edge) is
komorebi's **full** `default_workspace_padding + default_container_padding` (16px at this pass's
values), while the other three sides each still lose their own `--frame-band` (8px) out of that same
16px budget, leaving an 8px gap -- reintroducing the exact "left gap wider than the other three"
complaint the sixth pass was built to fix. To make all four gaps 8px without a left band, tiled
content would need to start at screen `x=60` (52 + 8), which means komorebi's **work area left**
needs to become **44** (60 minus the 16px padding budget) -- 8px *less* than the bar's 52px
`dockToEdge` reservation, i.e. the work area needs to extend 8px further left than the bar's own
right edge.

Both candidate mechanisms for this were tried live, in order, per this pass's own instructions, and
**both failed** -- this pass ships with the honest, unequal result, not a faked one:

1. **`komorebic global-work-area-offset -- -8 0 0 0`** (the `--` is required -- without it clap
   parses `-8` as an unrecognized flag, `error: unexpected argument '-8' found`). This command
   exits `0` with no error for a negative left value, but produces **no observable effect
   whatsoever**: `komorebic state`'s `global_work_area_offset` field never appears in the output at
   all (not `null`, simply absent from the JSON), `monitors[0].work_area_size` stayed exactly
   `{left:52, ..., right:2508, ...}` before and after (re-checked after an explicit `komorebic
   retile` too, in case the value only takes effect on the next retile -- no change), and a REAL
   tiled window's rect (`wezterm-gui`, a genuine already-tiled window on this desktop, read via a
   `GetWindowRect` P/Invoke probe, not `komorebic state`'s own window list) stayed at the identical
   `x=65` (its content start, `work area left 52 + padding 8 + komorebi's own 5px border decoration`
   -- see the sixth pass's own account of this same 13px-vs-8px discrepancy) both before and after
   the command. Conclusion: on this komorebi build (schema `v0.1.41`), a negative
   `global-work-area-offset` is silently accepted syntactically but not applied to tiling --
   whether that's clamping to zero, a no-op for negative values specifically, or something else was
   not distinguishable from the outside, but the practical result is the same: **no effect**, not
   "ignored with an error" and not "applied as requested". The command was reset to `0 0 0 0`
   afterward to leave no dangling half-applied state.
2. **Zebar `dockToEdge.windowMargin: "-8px"` on the bar's own `default` preset.** This DID change
   `komorebic state`'s `work_area_size` (`left` dropped from 52 to 44, exactly as hoped) -- but it
   also shrank the bar's own **visible OS window** from 52px to 36px wide (confirmed via
   `GetWindowRect` against the actual `Zebar - caelestia / bar` window, not just the AppBar
   reservation), i.e. a negative `windowMargin` is not a pure "reservation minus N" lever -- it
   subtracts from the widget's own rendered width too, at what looks like double the requested
   magnitude (52 - 2*8 = 36). This is the same class of failure this file's own "Known-incomplete:
   the media drawer" section already recorded for a much larger negative margin (which collapsed
   the bar to zero width) -- confirmed again here at a small, otherwise-plausible-looking `-8px`.
   Shipping this would have violated this task's own explicit "bar width stays 52px" constraint, so
   it was reverted (`windowMargin` back to `"0px"`) immediately after the measurement.

**The conclusion drawn at the time -- "the left gap ships at 16px, both mechanisms are dead ends" --
was wrong.** Attempt 1's observation was accurate but over-generalised: the *CLI* is a no-op, the
*config field* is not. Attempt 2's finding about `windowMargin` stands and is still a real dead end.
The lesson worth keeping: `komorebic state`'s `work_area_size`/`work_area_offset` are useless as
evidence here -- they do not change even when the offset is working. Measure pixels, not state.
See the section above for what shipped.

### Vendored Font Awesome icons

Every ad-hoc glyph in the bar (Nerd Font Private-Use-Area codepoints rendered through the system
"0xProto Nerd Font", and a handful of raw Unicode symbols) was replaced with real Font Awesome Free
6.x icons, vendored locally under `zebar/caelestia/bar/vendor/fontawesome/` -- webfonts plus a local
`@font-face` (`fontawesome.css`), no CDN, matching this pack's existing offline-first stance (the
same rationale `zebar.js` itself is vendored for -- see "The vendored zebar bundle" above).

**Licence.** Font Awesome Free is dual/triple-licensed: icons under CC BY 4.0 (attribution
required), fonts under SIL OFL 1.1, and any code (none of which is used here -- no JS/SVG kit, no
build step) under MIT. `zebar/caelestia/bar/vendor/fontawesome/LICENSE.txt` is the licence text
vendored verbatim from the same `6.x` release the webfonts came from
(`github.com/FortAwesome/Font-Awesome`); this doc's own attribution: icons are Font Awesome Free by
Fontawesome, https://fontawesome.com, licensed under CC BY 4.0 (icons), SIL OFL 1.1 (fonts), MIT
(code). Only the **Free** tier was used -- no Pro icon, no Pro webfont file, nothing requiring a
licence this user doesn't hold.

**Two separate webfonts, two separate `font-family` names** -- `fontawesome.css`'s own `:root`-
adjacent comment explains why these can't be merged: `fa-solid-900.woff2` backs "Font Awesome 6
Free" (weight 900, every icon except one), `fa-brands-400.woff2` backs "Font Awesome 6 Brands"
(weight 400, brand marks only -- Discord, for vesktop). Requesting a brand glyph through the Solid
font (or vice versa) silently renders nothing, the same class of "looks fine until you actually
look" bug this repo's Nerd-Font-PUA history already had once (see "Nerd Font glyphs" above) -- every
codepoint below was written as a literal `\uXXXX` JS escape and read back after writing, per that
same established discipline, not pasted as a raw character.

| Bar element | Icon | Codepoint | Font |
|---|---|---|---|
| wifi, connected | `wifi` | U+F1EB | Solid |
| wifi, disconnected | `plug-circle-xmark` | U+E560 | Solid |
| volume, muted (0) | `volume-off` | U+F026 | Solid |
| volume, low (1-50) | `volume-low` | U+F027 | Solid |
| volume, high (51-100) | `volume-high` | U+F028 | Solid |
| power button | `power-off` | U+F011 | Solid |
| layout toggle -- bsp | `diagram-project` | U+F542 | Solid |
| layout toggle -- columns | `table-columns` | U+F0DB | Solid |
| layout toggle -- rows | `bars` | U+F0C9 | Solid |
| layout toggle -- grid | `table-cells` | U+F00A | Solid |
| layout toggle -- unrecognized/fallback | `border-all` | U+F84C | Solid |
| vesktop unread mark | `discord` | U+F392 | Brands |
| logo | `diamond` | U+F219 | Solid |
| media transport -- previous | `backward-step` | U+F048 | Solid |
| media transport -- play | `play` | U+F04B | Solid |
| media transport -- pause | `pause` | U+F04C | Solid |
| media transport -- next | `forward-step` | U+F051 | Solid |

Font Awesome Free 6.x has no dedicated "wifi-slash"/"wifi-off" solid glyph (confirmed against Font
Awesome's own `metadata/icons.json` for the `6.x` release, not guessed) -- `plug-circle-xmark`
stands in for "disconnected", the same idea the old Nerd-Font mapping used (a different,
non-wifi-specific "broken connection" glyph) but now a real, confirmed-present Free icon rather
than a codepoint carried over from an old Nerd-Font-as-FA4.7 mapping. Volume gained a real
three-tier muted/low/high split (`entries/statusIcons.js`'s `volumeGlyph`) driven by the actual
level, replacing the previous binary "some sound vs. off" check.

`entries/vesktop.js` previously rendered ONLY the unread count as plain text, with no icon at all --
it now renders a Discord mark beside the count (two child `<span>`s, `.vesktop__icon`/
`.vesktop__count`, not a single text node, since the two pieces need different font-families).

Sizing stays consistent with the bar-polish pass's ~18px (`--icon-size`) target and every icon stays
optically centred in the 52px strip -- `.logo` and `.media-panel__transport button` gained explicit
`font-size: var(--icon-size)` rules (previously unstyled/inherited), `.vesktop` changed from a
single centred glyph box to a small flex row holding the two new children.

`tests\Get-ColorLiterals.Tests.ps1` gained a fourth file under the zero-colour-literal check
(`fontawesome.css` -- `@font-face` declarations and a shared font-metrics reset only, no fills of
its own). `node --test` gained two new cases for `volumeGlyph`'s three-tier boundary behaviour;
every other icon-bearing entry (`logo.js`, `power.js`, `vesktop.js`, `media.js`'s transport buttons)
has no pure branching logic of its own worth a node test, consistent with how `statusCluster`'s DOM
composition and `spacer`'s trivial factory are already untested elsewhere in this file.

**Live on-screen visual confirmation of this pass could not be completed at the time.** Restarting
the bar to load the new files (unavoidable — Zebar has no hot reload, see "Starting, stopping, and
reloading" above) hit a `state/zebar-logs/caelestia-bar-default.out.log` line reading `Asset server
failed during runtime: Bind(Os { code: 10048, kind: AddrInUse, ... })` on every fresh restart
attempted during this task, with `Get-NetTCPConnection -LocalPort 6124` showing that port held by a
PID that `Get-Process`/`tasklist` both confirmed no longer existed. At the time this was recorded
under "Troubleshooting: WebView2 renders nothing" and treated as the same environmental WebView2
session problem this file had already hit once before. **A later task (see "Font Awesome cascade
fix, layout-provider normalisation, and the port-6124 orphan (eighth pass)" below) identified the
real, different cause: an orphaned `fullscreen-detect.exe` process, not WebView2 at all** — see the
"Troubleshooting" section's now-corrected top entry for the full account and the fix. This
paragraph is left as historical record of how the symptom first presented, not as still-accurate
guidance — follow the corrected "Troubleshooting" section instead.

## Font Awesome cascade fix, layout-provider normalisation, and the port-6124 orphan (eighth pass)

The bar renders again (see "Troubleshooting" above for how the port-6124 orphan that had been
blocking it was found and killed). With it actually visible, this pass fixed two real, confirmed
bugs the previous (unverifiable) pass had shipped, plus hardened the root cause of the outage
itself so it recurs less easily.

### 1. Font Awesome icons were rendering through Nerd Font's FA4 glyphs, not the vendored FA6 webfont

**Symptom:** `layoutToggle`'s button rendered as an empty tofu box; every other icon (logo, wifi,
volume, power) looked correct. That split was the tell — Nerd Fonts embed Font Awesome **v4**
glyphs in the U+F000–U+F2E0 PUA range, so any icon whose FA6 codepoint happens to coincide with an
FA4 glyph at the same codepoint (diamond U+F219, wifi U+F1EB, volume-high U+F028, power-off
U+F011 — all unchanged shapes between FA4 and FA6) would look right even when rendered through the
wrong font entirely. `layoutToggle`'s codepoints (`diagram-project` U+F542, fallback `border-all`
U+F84C) sit above FA4's range and have no Nerd Font glyph to fall back to, so they alone showed
tofu.

**Diagnosed empirically, via a live CDP session** (not guessed): `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
= '--remote-debugging-port=9222'` set before a `Restart-ZebarWidgets` cycle opens a Chrome DevTools
Protocol port on the widget's own WebView2 process (two separate WebView2 "root" browser processes
exist per running zebar — one per pack profile plus one shared app-level profile — both pick up the
env var and race for the same port; killing the non-`webview-cache\caelestia` one resolves the
collision and leaves a clean single target). Findings, in order:

- `document.fonts.status` was `"loaded"` and `document.fonts.check('900 16px "Font Awesome 6
  Free"')`/`check('400 16px "Font Awesome 6 Brands"')` both returned `true` — the vendored webfonts
  genuinely load; this was never a network/404/wrong-format problem.
- Canvas `measureText` against a genuine Unicode noncharacter (U+FDD0, permanently unassigned in
  every font) as a "missing glyph" baseline showed all nine codepoints the task needed to verify
  (U+F219, U+F011, U+F1EB, U+F028, U+F542, U+F84C, U+F0DB, U+F0C9, U+F00A) render at a distinct,
  nonzero advance width in `"Font Awesome 6 Free"` — the vendored `fa-solid-900.woff2` is not a
  subset missing these glyphs; re-vendoring was never necessary.
- `getComputedStyle(...).fontFamily` on the live DOM was the decisive test: `.logo` and
  `.status-icons__glyph` (never combined with `.bar-btn`) correctly resolved to `"Font Awesome 6
  Free"`. `.layout-toggle` and `.power` (both `bar-btn fa-solid`) resolved to `'"0xProto Nerd
  Font", monospace'` — the exact wrong font the tofu theory predicted.

**Root cause:** `style.css`'s `.bar-btn` rule used the `font: inherit;` **shorthand**, which resets
*every* font sub-property (family, weight, style, variant, stretch, line-height) to the parent's
computed value — not just the properties the author meant to normalise. `.fa-solid`/`.fa-brands`
(`vendor/fontawesome/fontawesome.css`, loaded *before* `style.css` in `index.html`) has the exact
same specificity (one class selector) as `.bar-btn`, so on a source-order tiebreak `.bar-btn`'s
later declaration won, silently reverting `font-family`/`font-weight` back to `#bar`'s inherited
`"0xProto Nerd Font", monospace` for every button carrying both classes (`power`, `layoutToggle`).
A **second**, worse instance of the identical bug existed in `.media-panel__transport button`
(the media drawer's prev/play/next buttons, `entries/media.js`) — there the `button` type selector
makes it *strictly higher specificity* than `.fa-solid`, so it would have won regardless of
stylesheet order, and because the media panel is appended to `document.body` (a sibling of `#bar`,
not a descendant), the inherited fallback there wasn't even Nerd Font — CDP confirmed
`getComputedStyle` read the bare browser default (`system-ui, "Segoe UI", ...`), so those three
buttons would have shown pure tofu (no Nerd Font fallback at all) the moment the drawer became
reachable by a real click.

**Fix:** removed the `font: inherit;` line from both rules in `style.css`, keeping only the
`font-size` override each actually needs — `.fa-solid`/`.fa-brands` already supplies
`font-family`/`font-weight`/`font-style`/`font-variant`/`line-height`, and with the competing
declaration gone entirely, cascade order/specificity no longer matters. **Confirmed live, not just
by reasoning:** re-querying `getComputedStyle` after the fix and a real restart showed every
`.fa-solid`/`.fa-brands` element resolving to the correct Font Awesome family, and a fresh
screenshot (below) shows `layoutToggle` rendering a real glyph, zero tofu anywhere on the bar.

### 2. `layoutToggle`'s provider-layout comparison hardened, `columns` now gets a real glyph

The pre-fix code's own comment guessed the tofu might be `FALLBACK_GLYPH`, caused by
`komorebic state`'s CLI JSON reporting the layout as `"BSP"` (capitalised, nested under
`layout.Default`) against a lowercase-keyed `PROVIDER_TO_CYCLE` map. **Read live, per this pack's
own established discipline of never trusting a provider field's shape without checking** (this
pack has already been bitten twice — the invented `isFocused` field, and this same CLI-vs-provider
spelling gap for a different field): a temporary `window.__zebarDebugProviders = providers;` line
in `bar.js`, removed again after use, exposed `bar.js`'s own `createProviderGroup` output to the
same CDP session used for the Font Awesome diagnosis above. Result:
**`focusedWorkspace.layout` was already a flat, lower-case `"bsp"` for the real live BSP
layout** — the CLI-vs-provider casing gap the pre-fix comment worried about was NOT actually live
for `bsp`/`rows`/`grid` on this zebar@3.3.1 build; the tofu was entirely the CSS bug above, not a
mapping miss.

Cycling the real layout live via `komorebic change-layout <name>` (bsp -> columns -> rows -> grid ->
back to bsp, per this task's own safety constraint to end on BSP) and re-reading the same debug
provider after each change confirmed the full picture: `rows` -> `"rows"`, `grid` -> `"grid"`, and
**`columns` -> `"custom"`** — the same bucket every OTHER layout outside zebar's 8-value
`KomorebiLayout` union also falls into (`vertical_stack`, `horizontal_stack`,
`ultrawide_vertical_stack`, `right_main_vertical_stack` all report their own literal names; only
`columns` isn't a recognised union member, so it's the one CLI value that collapses to `custom`).

`layoutToggle.js` changes: `PROVIDER_TO_CYCLE` gained `custom: 'columns'` (giving `columns` the
real `table-columns` glyph it already had defined but could never reach, instead of always falling
to `FALLBACK_GLYPH`) — documented as a deliberate simplification, not a precise inverse of the CLI,
since `custom` is ambiguous with every other non-union layout; a `PROVIDER_TO_CYCLE` lookup and a
new `normalizeLayoutString()` helper (lower-case + strip `-`/`_`) were added defensively so a future
zebar/komorebi version reintroducing real casing drift (which `komorebic state`'s own CLI JSON
already exhibits for the unrelated `layout.Default` field) can't silently reintroduce this exact bug
a third time. `tests/js/entries.test.mjs` gained direct coverage of both the live-confirmed mapping
and the defensive normalisation (case/`-`/`_` variants of every curated value).

### 3. The port-6124 orphan itself (`fullscreen-detect.exe`) — hardened against recurrence

Covered in full in the "Troubleshooting" section above (the actual root cause of "the bar renders
nothing", corrected there in place of the old, wrong WebView2 lead) and in `fullscreen.js`'s own
doc comment. Summary: `startFullscreenWatch` now (a) never starts a new poll while the previous one
is still outstanding, and (b) races each poll against a 2s timeout so a hung probe is abandoned
rather than awaited forever — both covered by new tests in `tests/js/fullscreen.test.mjs`.
`Restart-ZebarWidgets` (`scripts/Apply-Theme.ps1`) now reaps any surviving `fullscreen-detect.exe`
before starting widgets back up, and warns with the exact holding PID/process name if port 6124 is
still held after that reap — covered by new tests in `tests/ApplyTheme.Tests.ps1`.

### Verification

Both `node --test` (77 tests, up from 72) and the Pester suite (165 tests, up from 160) run green.
Live, on-screen confirmation (finally possible with the bar actually rendering): screenshots of
`x:0-56,y:0-560` and `x:0-56,y:950-1440` at 3x zoom show every icon as a real glyph — logo, all
nine workspace numbers, `layoutToggle` (now a real `diagram-project` glyph, not tofu), the
`activeWindow` app name, the status-cluster pill (wifi/volume/vesktop), and the power button.
Changing the tiling layout live via `komorebic change-layout` (behind the button's own back, per
this task's instructions) and re-screenshotting confirmed `layoutToggle`'s glyph follows the real
layout, ending back on BSP's `diagram-project` glyph per the safety constraint to leave the desktop
on BSP.

## Focused-app icon (`tools/app-icon.cs`)

`feat/corner-overlays` follow-up, direct user ask: put the focused application's own icon next to
its name in `activeWindow`. Read literally, per the brief: the REAL icon of the running executable,
not a hand-mapped Font Awesome brand glyph — a brand table covers Chrome and Discord and then falls
over on WezTerm, foobar2000, and everything else on this machine, none of which have an FA brand
icon at all.

### The tool

`zebar/caelestia/tools/app-icon.cs`, compiled to `app-icon.exe` with the same `csc.exe` /
doc-comment-documents-its-own-rebuild-command convention `tools/fullscreen-detect.cs` and
`~/.config/yasb/scripts/vesktop-unread.cs` already use on this machine:

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /optimize+ ^
    /out:app-icon.exe /r:System.Drawing.dll app-icon.cs
```

(needs `/r:System.Drawing.dll` — the other two tools don't, since they only call `user32.dll`
P/Invokes; this one also decodes/re-encodes a bitmap.)

**Input is an exe NAME, never a path** (`chrome.exe`, not a Program Files path) — matching what the
komorebi provider actually gives (see below). The tool resolves that name to a real path ITSELF, by
enumerating `Process.GetProcessesByName(...)` for a currently-running process with that name and
reading its own `MainModule.FileName` (skipping any match that throws, e.g. an
access-denied/higher-privilege/different-session process, and trying the next one) — it never
assumes a fixed install directory. This pack has already been bitten twice by assuming a provider
field's shape without checking it first (the invented `isFocused` on `KomorebiWindow`; the
CLI-vs-provider layout-casing gap, both documented elsewhere in this file) — resolving via a live
process rather than guessing a Program Files/AppData layout avoids a third instance of the same
mistake class.

**Output**: a base64-encoded PNG on stdout, extracted via `Icon.ExtractAssociatedIcon` (the same
shell-standard icon Explorer/Alt-Tab shows — native resolution, confirmed live at 32x32 for every
exe tested: chrome.exe, wezterm-gui.exe, foobar2000.exe, vesktop.exe, explorer.exe). Prints nothing
and exits non-zero on ANY failure (bad/missing arg, no matching process, every matching process
inaccessible, no icon resource, ...) — same fail-soft contract `fullscreen-detect.exe` already
established (never throw a stack trace at the caller; silence means "couldn't do it, fall back").
32x32 was judged plenty for this bar's ~18px CSS-rendered glyph (CSS scales down, see
`--icon-size`); jumbo-icon (`SHGetImageList`/`IImageList`, 48-256px) COM interop was judged not
worth the added risk for a target this small.

### What the komorebi provider actually gives (verified, not assumed)

**A bare exe name, not a path.** `KomorebiWindow.exe: string | null` — already confirmed earlier in
this file ("The komorebi provider's window-focus shape") against both zebar's own shipped
`dist/index.d.ts` and a live `komorebic state` capture: real, populated values look like
`"wezterm-gui.exe"`, `"vesktop.exe"`, `"chrome.exe"`, `"explorer.exe"`, `"foobar2000.exe"` — never a
full path, never with the executable's own display name (`WezTerm.exe` is never seen; it's always
the literal process image name). `entries/activeWindow.js` already reads this field for
`appName()`; the icon extraction reuses the exact same `focusedWindow(out.komorebi)?.exe` value, no
new provider read.

### Registered privilege, tight regex

`zpack.json`'s `bar` widget (the only widget that renders `activeWindow` — `corners`/`edges` don't
need this privilege and don't get it) gained one `privileges.shellCommands` entry:

```json
{
  "program": "C:\\Users\\PC\\Documents\\git\\setup\\zebar\\caelestia\\tools\\app-icon.exe",
  "argsRegex": "^[\\w.\\-]+\\.exe$"
}
```

Anchored (`^...$`), and matches an exe filename and nothing else — no path separators, no shell
metacharacters, no wildcard. Deliberately NOT loosened to a catch-all per the brief's own explicit
instruction; the existing `komorebic.exe` entry's own comment elsewhere in this pack (about the
unwired `power` shutdown binary) already makes the case for why an over-broad `argsRegex` on any
allowlisted shell command is the single most dangerous kind of edit to this file — this entry
follows that same discipline.

### Caching discipline — never repeats the port-6124 bug

`fullscreen-detect.exe` once outlived its parent zebar process, inherited zebar's own LISTENING
SOCKET on port 6124 via Win32 handle inheritance, and left the bar rendering nothing for two full
debugging sessions before the real cause was found (see "Troubleshooting" above). `app-icon.exe` is
shelled out the exact same way (`shellExec`, a short-lived `CreateProcess` child), so it carries the
identical risk class. `entries/activeWindow.js` applies the same three disciplines
`fullscreen.js`'s `startFullscreenWatch` already established for its own poll:

- **Cached aggressively, keyed on the (lower-cased) focused exe name** — `fetchIcon`'s `cache`
  parameter is a `Map<string, string|null>` that remembers BOTH successes (a `data:image/png;...`
  URL) and failures (`null`) forever, so an exe with no extractable icon is never re-probed every
  time it regains focus, and an exe already resolved is never re-probed on every provider tick.
  `createIconController`'s `update(exe, onResolve)` checks `normalized === currentExe` FIRST, before
  touching `shell` or the cache at all — an unchanged focused app returns immediately with **zero**
  work done, not even a cache lookup. This is the property the brief called out explicitly ("must
  not spawn a process on every provider tick") — covered directly by
  `tests/js/entries.test.mjs`'s `'createIconController: repeated ticks with the SAME focused exe
  never shell out again'`, which drives six ticks for one exe and asserts exactly one `shellExec`
  call.
- **Never starts a second `app-icon.exe` while one is outstanding** — an `inFlight` boolean guard in
  `createIconController`, identical in shape to `fullscreen.js`'s own `inFlight` guard. Covered by
  `'createIconController: never starts a second app-icon.exe call while one is still outstanding'`,
  which moves focus away and back while the first probe is deliberately held open and asserts the
  call count stays at 1.
- **Every call is raced against a 2s timeout** (`ICON_TIMEOUT_MS`, `Promise.race` against a
  `setTimeout` rejection) — a hung probe is abandoned (resolves `null`, falls back to the glyph)
  rather than awaited forever, exactly mirroring `fullscreen.js`'s own default `timeoutMs`. Covered
  by `'fetchIcon abandons a hung probe after timeoutMs and fails soft'`.

`Restart-ZebarWidgets` (`scripts/Apply-Theme.ps1`) now reaps any surviving `app-icon.exe` in the
SAME step it already reaps `fullscreen-detect.exe` (`Get-Process fullscreen-detect, app-icon`, one
combined check rather than a second bespoke one — see that function's own doc comment), before
starting any widget back up, and folds it into the same port-6124-held warning if the port is still
occupied after the reap.

### Layout: icon upright, above the name, pair still centred

The bar is vertical; `activeWindow`'s name has always rendered with `writing-mode: vertical-rl`.
"Next to the name" means adjacent in reading order — the icon BEFORE the text, i.e. above it in the
vertical flow — and the icon itself must stay upright, never inheriting the name's rotation.

`entries/activeWindow.js`'s `register('activeWindow', ...)` factory now builds three DOM nodes
instead of one: an outer `.active-window` container (still the element `entries/render.js` adds the
shared `.entry` class to — `display: flex; flex-direction: column; align-items: center` is already
exactly "icon above name, both centred" for free), an `.active-window__icon` box holding EITHER an
`<img class="active-window__icon-img">` (the real extracted PNG) OR a
`<span class="active-window__icon-fallback fa-solid">` (the neutral fallback glyph, always present
in the DOM, `display`-toggled by JS — see below), and `.active-window__name` (the div that now
carries the `writing-mode: vertical-rl` rule the whole `.active-window` container used to carry
directly). Neither the container nor the icon box has any `writing-mode` of its own, so the icon —
whichever of the two children is currently visible — stays upright regardless of the name rotating
beneath it. The two `spacer` entries either side of `activeWindow` in `bar.config.json` are
untouched and still split the vacant run evenly; they centre the WHOLE `activeWindow` element by its
total rendered size, and don't care how many DOM nodes are inside it.

**Fallback glyph**: Font Awesome Free 6 Solid `window-maximize` (`\uF2D0`), per the brief's explicit
ask ("a neutral Font Awesome Solid glyph ... rather than leaving a gap or a broken image"). Shown
whenever extraction fails, times out, or the shell privilege isn't available — AND as the default
state before the very first probe for a newly-focused app resolves (so there's never a blank gap
while a probe is in flight, only ever a brief neutral-glyph flash before the real icon swaps in).
The name (`appName(exe)`) is read and rendered completely independently of icon state — a failed
icon extraction never blanks or hides the name.

### A real bug found and fixed during live verification (not caught by the unit tests)

The first live restart showed the app name rendering correctly but **no icon and no fallback glyph
at all** — just empty space above the name, for every focused app tested. The unit tests (which
mock `shell`/DOM state directly, not the CSS cascade) had no way to catch this, because the bug was
purely a CSS/JS interaction:

`showImage()`/`showFallback()` originally toggled visibility by setting `el.style.display = ''` to
"show" an element — this works for elements with NO conflicting stylesheet rule (the existing
pattern elsewhere in this pack, e.g. `el.style.display = name ? '' : 'none'` on `.active-window`
itself, which has no CSS `display` rule to fall back to). But `.active-window__icon-img`'s CSS DOES
carry an explicit `display: none` default (so a bare `<img>` with no `src` attribute yet never
flashes a broken-image glyph before JS runs on the very first paint). Clearing an INLINE style with
`''` doesn't erase that stylesheet rule — it just stops overriding it, so the cascade fell straight
back to `display: none` and the image could never become visible, no matter how many times
`showImage()` ran with a perfectly good `data:` URL. (The fallback glyph SHOULD have still shown
whenever extraction genuinely failed, since its own CSS carries no conflicting `display` rule — but
for every app actually tested live, extraction succeeded, so `showImage()` ran, hid the fallback
correctly, and then silently failed to reveal the image, leaving nothing visible at all.)

Fix: both functions now set an EXPLICIT, non-empty `display` value on BOTH elements every time
(`'none'` / `'inline-block'` for the image, `'none'` / `'inline'` for the fallback) — never `''`.
Re-verified live after the fix (see Verification below): real icons now render for every app tested.
This also served as an accidental, useful confirmation that the `\uF2D0` codepoint guess for
`window-maximize` was correct — proven by deliberately pointing `ICON_TOOL_PATH` at a nonexistent
exe for one restart cycle (forcing every extraction to fail) and confirming the fallback glyph
rendered as a real, correct-looking window icon, then reverting the path and restarting again.

### Verification

Both `node --test` (89 tests, up from 77 — 12 new: `iconCacheKey`, `fetchIcon`'s caching/
timeout/fail-soft behavior, and `createIconController`'s no-repeat-shell-out/no-overlap/fallback
coverage) and the Pester suite (167 tests, unchanged — no PowerShell-level behavior changed except
`Restart-ZebarWidgets`'s reap list, already covered by the existing `fullscreen-detect.exe` reap
tests via PowerShell's own array-`-eq` semantics matching the mock's `-ParameterFilter`) run green.

Live, on-screen confirmation via `Restart-ZebarWidgets` + `komorebic eager-focus <exe>` (a real WM
focus command, not simulated input) + `CopyFromScreen` screenshots at 6x zoom of the
`activeWindow` region, for three different focused apps:

- **WezTerm** (`wezterm-gui.exe`): WezTerm's real dark rounded-square `$W` mark, upright, directly
  above the vertical "WezTerm" text.
- **Chrome** (`chrome.exe`): the real four-color Chrome circle, upright, above "Chrome".
- **foobar2000** (`foobar2000.exe`): foobar2000's real white fox-mask icon, upright, above the
  unaliased "foobar2000" text (confirming `appName`'s fallback-to-stripped-name path still renders
  correctly alongside a real icon).

Each app's icon is visibly distinct and correctly matches that application — not a shared/generic
glyph. A fourth screenshot (deliberate `ICON_TOOL_PATH` breakage, see above) confirmed the
`window-maximize` fallback glyph renders cleanly (no broken-image icon, name stays visible) when
extraction genuinely fails. A full-strip screenshot after the fix confirmed the icon+name pair still
sits centred in the vacant run between the top and bottom groups, with the bar still 52px wide.

## Bottom group flush to the bar's own bottom padding, and `layoutToggle` moved down (direct user feedback)

Two small, unrelated fixes bundled into one pass because both were about the bottom of the bar.
Direct user feedback: *"the bottom part of the left bar isn't fully aligned to the bottom"* and
*"add an icon (on the bottom part of the left bar) that i can click on to change the tiling
settings in komorebi"* (the second one already existed near the top as `layoutToggle` — this was a
move, not a new entry).

### The `--taskbar-h` reserve was stale, not load-bearing

`#bar`'s padding used to be `var(--pad-lg) 0 calc(var(--pad-lg) + var(--taskbar-h))` with
`--taskbar-h: 48px` — a reserve added on the theory that the native Windows taskbar
(`Shell_TrayWnd`) sits full-width above `zOrder: "normal"` windows and would occlude/intercept
clicks on the bar's last entry (`power`) otherwise. That theory no longer matches this machine: the
taskbar is in **auto-hide** mode, and its real rect is `(0,1438)-(2560,1486)` on a 1440px-tall
screen — only the top 2px of it is ever actually on screen. 48px was being reserved for something
that isn't there, which is exactly why the bottom group (clock/status-cluster/layoutToggle/power)
was floating well above the bar's own bottom edge instead of sitting flush the way the top group
(`logo`) sits flush against `--pad-lg`.

**Decision on `--taskbar-h` itself: kept, dropped to `0px`, not deleted.** `#bar`'s padding rule
still reads `var(--pad-lg) 0 calc(var(--pad-lg) + var(--taskbar-h))` unchanged — only the variable's
own value changed, from `48px` to `0px`, with a comment on the variable explaining why. This keeps
one single, named lever to restore a reserve later (auto-hide is a user-toggled Windows setting on
this machine, not a fixed property of the environment — if it's ever turned off, the taskbar goes
back to occluding the bottom of the bar) without needing the padding `calc` itself rewritten; bump
`--taskbar-h` back up and the same shorthand does the right thing again. Deleting the variable and
its use entirely was the other option considered and rejected for this reason — this isn't dead
code, it's a documented zero.

**Verified via direct pixel measurement, not just eyeballing the screenshot.** `CopyFromScreen` at
1x scale over the bar's full height (`x:0-56, y:0-1440`), sampling column `x=28` for the first
non-background row from the top and the last non-background row from the bottom (background =
`--surface`, sampled at `(2,5)`, tolerance 12 per channel): first ink at row **12** from the top
(matches `--pad-lg`, 12px, exactly), last ink **20px** from the bottom edge. The 12px-vs-20px
asymmetry is glyph geometry, not a CSS asymmetry: `power`'s icon is centred inside a 32px
(`--hit-size`) circular hit-box (`.bar-btn`) whose own bottom edge sits exactly `--pad-lg` (12px)
above the window's bottom edge, but the Font Awesome glyph's visible ink doesn't fill that box
edge-to-edge — `logo` has no such wrapping hit-box, so its ink sits closer to its own padding edge.
The padding rule itself is symmetric by construction now (`padding-top: 12px`,
`padding-bottom: calc(12px + 0px) = 12px`) — confirmed from the CSS, not inferred from the pixel
measurement alone.

### The stated hover/auto-hide trade-off: checked, and it does not appear to bite

The task brief flagged a known trade-off to check: with the group flush to the bottom, does the
`power` button now sit inside the ~2px strip where an auto-hidden taskbar reveals on hover, such
that hovering the button pops the taskbar up? **Geometrically, no, with about a 10px margin**: the
`power` button's own 32px hit-box has its bottom edge at screen `y ≈ 1428` (`1440 - 12` padding),
while `Shell_TrayWnd`'s on-screen reveal strip is `y: 1438-1440` — a real, measured 2px band right
at the screen's bottom edge, ~10px below where the button's hit-box actually ends. The button was
not pushed all the way to the physical screen edge; `--pad-lg` (12px) still sits between it and the
taskbar's reveal zone, same as it always did for the top group against the top edge.

**This was checked by geometry and pixel measurement, not by an actual hover** — this task's own
safety rules forbid mouse automation (`CopyFromScreen` only, no `SendKeys`, no simulated clicks), so
a real hover-and-observe test was not possible in this pass. If a future pass has a human available
to literally hover the button and watch for the taskbar reveal, that would be the strictly stronger
confirmation; the geometric argument above is the best available evidence without one, and it points
away from the trade-off actually manifesting.

### `layoutToggle` moved into the bottom group

`bar.config.json`'s `entries` array changed from
`["logo", "workspaces", "layoutToggle", "spacer", "activeWindow", "spacer", "clock", "statusCluster", "power"]`
to
`["logo", "workspaces", "spacer", "activeWindow", "spacer", "clock", "statusCluster", "layoutToggle", "power"]`
— `layoutToggle` moved from right after `workspaces` (top group) to right before `power` (bottom
group), per the user's ask that a *control* (change tiling layout) live where the bar's other
controls live, not among the top-group status readouts. This is a config-only reorder: no change to
`entries/layoutToggle.js` itself, no new entry type, no second control. It already had the
`bar-btn fa-solid` treatment (hover/press circle, real Font Awesome glyph) from the earlier
lower-cluster restyle, so nothing needed restyling to look consistent with `power` and the
`.status-cluster` pill above it — moving it was sufficient. No CSS in this pack keys off entry
position/adjacency (`+`, `~`, `:nth-child` — checked, none exist), and no test asserts the literal
contents of `bar.config.json`'s `entries` array, so nothing else needed updating for the move
itself.

### A real, pre-existing limitation found while verifying the move: the komorebi provider's `layout` field does not appear to re-emit live

Verifying "does the glyph follow a layout change" (the brief's own ask) surfaced something worth
recording separately from the move itself, since it affects how much this button can be trusted
going forward: **cycling the actual komorebi layout via `komorebic change-layout <name>` while the
widget stayed running did not change the rendered glyph**, across three different target layouts
(`bsp`, `grid`, `rows`), each given 3-10 seconds to propagate, confirmed both by eye and by the
screenshots' own file hashes differing only in incidental antialiasing noise around the unrelated
clock/pill, not in the icon's shape. `state/zebar-logs/caelestia-bar-default.out.log` corroborates
this at the Rust provider level: exactly **one** `"type":"komorebi"` provider-emission log line for
the entire widget lifetime, timestamped at start-up, with no further emission after any of the three
`change-layout` calls.

**But a fresh connection does read the live layout correctly**: setting the layout to `columns` via
CLI *before* restarting the widget (`Restart-ZebarWidgets`), then again to `bsp` before a further
restart, produced two more screenshots with visibly different, correctly-mapped glyphs (a
"table-columns" pair of bars for `columns`, a "diagram-project" branching-tree glyph for `bsp`) —
both clearly distinct from the grid-of-dots glyph seen mid-session. So `currentLayout`/`layoutGlyph`
(`entries/layoutToggle.js`) are not broken — they correctly read and map whatever the provider hands
them at connect time. What doesn't seem to work, at least in this session, is the provider pushing a
*fresh* value while the widget keeps running and the layout changes underneath it — the button
reflects the layout as of the last widget start/reconnect, not truly live. This was true before this
task's move (the move never touched `entries/layoutToggle.js`'s logic or `bar.js`'s provider setup)
and is documented here rather than silently worked around, since "reflects the live layout" was an
existing claim in this file and in the task brief that this verification pass couldn't confirm as
still true. A future pass investigating this should look at whether zebar's own komorebi provider
subscribes to komorebi's event stream at all versus polling on some interval this build never
reaches, before assuming the bug is anywhere in this pack's own code.

### Verification

`node --test` (89 tests, unchanged — no JS logic changed, only `bar.config.json`'s entry order and
`style.css`'s padding/comment text) and the Pester suite (167 tests, unchanged — no PowerShell
changed) both still pass. `Restart-ZebarWidgets` was used for every reload in this pass (never a
manual `Stop-Process`/`Start-Process` pair), which also exercises its `startupConfigs`-driven
multi-widget restart (`bar` + 4 `corners` presets + 3 `edges` presets) and its `fullscreen-detect.exe`
port-6124 reap on every call — no orphaned holder was found at any point in this pass. Live
confirmation: `CopyFromScreen` screenshots of the bottom strip (`x:0-56, y:1200-1440`, 4x) show
`clock` → `.status-cluster` (wifi/volume) → `layoutToggle` → `power` stacked flush to the bottom with
even `--space-md` rhythm between them, `layoutToggle` rendering a real, non-tofu Font Awesome glyph
(confirmed to actually change across a fresh-connection layout change, per the finding above) with
the same circular hover/press affordance `power` has. A full-strip screenshot (`x:0-56, y:0-1440`,
2x) reconfirmed the `1922852` app-icon-next-to-name change (WezTerm's real `$W` mark, upright, above
the vertical "WezTerm" text) still renders correctly and stays centred in the vacant run between the
top and bottom groups — unaffected by this pass, as expected, since neither change touched
`activeWindow` or its surrounding spacers.
