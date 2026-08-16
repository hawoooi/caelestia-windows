# Wallpaper-driven theming pipeline — working knowledge

One command extracts a Material You palette from the current Wallpaper Engine wallpaper and
regenerates the colors of WezTerm, starship, the Zebar sidebar, and komorebi's own window-border
colours. yasb and tacky-borders were **retired** as theming targets (see "The stack" and "Window borders and gaps" below) --
the Zebar bar (docked left) replaced yasb as the desktop's only bar, and komorebi's built-in window
borders (`border`/`border_style`/`border_colours` in `~/komorebi.json`) now do the job the
tacky-borders template was built for but never actually got to do (tacky-borders was never
installed on this machine). This file is the working knowledge for this repo, captured while
building it — read it before changing anything here.

## The stack

| Thing | Where |
|---|---|
| matugen (Rust, v4.1.0) | `~/.cargo/bin/matugen.exe`, installed via `cargo install matugen`. **Not on the default PATH of a fresh PowerShell process** — only this session's profile happens to prepend it. `Apply-Theme.ps1` defends against this itself (see below); any other caller needs the same guard or an explicit path. |
| matugen config | `matugen/config.toml` (this repo) — points every template at a staging output under `state/staging/`, never at a live config |
| matugen templates | `matugen/templates/*.{css,yaml,lua,toml,json}` (this repo) |
| color mapping | `matugen/mapping.json` (this repo) — keyed by normalized Catppuccin literal, each value an `{ "expression": "<matugen expr>" }`. Historical: this mapping was built for `yasb.styles.css`, which is no longer a rendered/live target (see the yasb row directly below); kept for the recovery procedure below. |
| yasb (v2.0.5) | `C:\Program Files\yasb\yasbc.exe`, config at `~/.config/yasb/` (its own git repo) — **retired as a theming target**, replaced by the Zebar bar (docked left). Still installed on disk; its process is no longer expected to be running, and `~/.config/yasb/` is never written to by this pipeline. |
| tacky-borders | config + log at `~/.config/tacky-borders/`, **not installed as an executable on this machine** (Task 1 finding, unchanged through Task 10) and **retired as a theming target** on top of that — komorebi's own borders replaced the job this template was built for. The template (`matugen/templates/tacky-borders.yaml`) is kept on disk, unwired from `matugen/config.toml` and from `$script:Targets`, in case it's ever wanted again. |
| WezTerm | `C:\Program Files\WezTerm\wezterm.exe` — config at `~/.wezterm.lua`, **not under version control** (home directory is not a git repo); the pipeline's two required edits there are recorded in `docs/wezterm-integration.md` because of this |
| starship | config at `~/.config/starship.toml` |
| Wallpaper Engine | `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\` — `wallpaper32.exe` or `wallpaper64.exe` (whichever is the live process; both exist on disk, this machine runs `wallpaper32.exe`) |
| Zebar (v3.3.1) | `C:\Program Files\glzr.io\Zebar\zebar.exe` — a vertical Caelestia-style bar docked left, and (since yasb's retirement) the **only** bar on the desktop. Pack source tracked at `zebar/caelestia/`, served to Zebar via a junction at `~/.glzr/zebar/caelestia`. The pack declares **nine** widgets -- `bar`, `corners`, `edges`, `layoutmenu`, `statusmenu`, `panels`, `dock`, `dockpreview`, `dashboard` -- each needing its own `startupConfigs` entry per preset (`Install-Config` writes them all). Full detail: `docs/zebar-bar.md`. |
| komorebi + whkd | `~/komorebi.json`, `~/.config/whkdrc` — the tiling WM driving the desktop (GlazeWM was replaced during this project's pre-flight; see `~/.config/yasb/CLAUDE.md`). Since the borders/yasb-retirement task, komorebi.json also carries `border: true`, `border_style: "Rounded"`, `border_width: 4`, `border_offset: 1`, `default_workspace_padding`/`default_container_padding` of **8/8**, a `global_work_area_offset` of `{left:-8, top:0, right:-8, bottom:0}`, and a themed `border_colours` object -- see "Window borders and gaps" and "The desktop frame" below. |
| Pester | 6.0.1 and 3.4.0 are both installed; **all tests in this repo are Pester 5+ syntax** (`Should -Be`, not `Should Be`) — `Import-Module Pester -MinimumVersion 5.0.0` before running the suite, or 3.4.0 loads by default and every test errors on syntax it doesn't recognize |

## The one time zebar has ever crashed, and the spawn discipline it bought

**2026-08-15, 13:57.** `zebar.exe` 3.3.1.0 faulted with `0xc0000409` (a CRT
fail-fast) in `ucrtbase.dll`. It is the **only** zebar fault in this machine's
entire Application event log, and it happened **nine minutes** after the
dashboard's background stats poll first went live -- a change that had just
made the widget spawn two helper processes (`net-stats.exe`, `nvidia-smi.exe`)
every five seconds, permanently.

That is a correlation, not a proven cause, and it should not be written up as
one. But "the only crash it has ever had arrived minutes after I made it spawn
two processes every five seconds forever" is not a coincidence worth assuming.

**What changed in response** (`zebar/caelestia/dashboard/dashboard.js`):

- idle cadence 5s -> **15s**
- the idle sample no longer touches the GPU at all -- **network only**

Together: one spawn per 15s instead of two per 5s, a **six-fold cut**, and no
visible cost. Verified live: GPU reads 48% within ~1.1s of the open gesture,
because a GPU read is single-shot (~100ms) and the panel takes ~380ms to open
(220ms dwell + slide), so a sample fired when the open message arrives has
landed before anyone can see the tile. Only the NETWORK genuinely needs to stay
warm -- a rate is the difference between two counter readings, so with no
previous sample there is no rate to show at all.

**The general rule this leaves behind:** anything polled while the panel is
CLOSED must justify itself against a process spawn. If a reading is single-shot
and fast, sample it on open instead. Note also that this pack already spawns
`fullscreen-detect.exe` ~10x/second across the bar, four corners, three edges,
the dock and the dashtrigger -- that is a genuine and unaddressed cost, and if
zebar faults again with no dashboard poll running, that is where to look next.

## Keybind latency, and two out-of-repo files that were changed for it

Reported as "komorebi sometimes lag with the keybinds and doesn't work when i
click the bar as well". Neither turned out to be a hard failure -- both paths
worked when tested directly -- but **every komorebi action was paying a
process-spawn tax twice over**, and whkd spawns its shell *synchronously*, so
that cost is also a window during which further presses queue behind it. That
is what made a quick run of workspace switches feel like it dropped one.

Measured on this machine, per `komorebic focus-workspace` call:

| path | cost |
|---|---|
| `powershell -c` + scoop shim (what whkd did) | **233 ms** |
| `cmd /c` + scoop shim | 122 ms |
| `cmd /c` + real binary | **104 ms** |
| scoop shim alone | 104 ms |
| real binary alone | **60 ms** |

A scoop shim is a launcher process in front of the real executable, so going
through it is two process creations instead of one. End-to-end after the fix
(keypress -> komorebi reporting the new workspace): **median 137 ms, worst 164
ms, 0 dropped over 8 presses**, and a burst of 8 back-to-back presses lands on
the right workspace.

**`~/.config/whkdrc` (not version controlled).** `.shell powershell` ->
`.shell cmd`, and all 49 `komorebic` invocations now use the full path to
`scoop\apps\komorebi\current\komorebic.exe` rather than resolving through the
shim on PATH. The two script bindings changed from `Start-Process powershell
-WindowStyle Hidden -ArgumentList ...` to cmd's `start "" /b powershell
-NoProfile ...` (still detached, so a theme apply does not block whkd), and
`alt + return` from `Start-Process cmd` to `start "" cmd`. Backup at
`~/.config/whkdrc.bak-before-cmd-shell`. **whkd must be restarted to pick up
whkdrc changes** -- it reads the file once at startup.

**`~/komorebi.json` (not version controlled).** Added `{kind: Exe, id:
zebar.exe}` to `ignore_rules`. `yasb.exe` was already there; yasb was retired
in favour of the zebar bar and **the ignore rule was never migrated**, so
komorebi had been treating the current bar as an ordinary window. Applied both
at runtime (`komorebic ignore-rule exe zebar.exe`, which needs no restart) and
persisted into the config, the same dual approach the border colours use.
Backup at `~/komorebi.json.bak-before-zebar-ignore`. **Honest caveat: a focus
test did not reproduce a failure from its absence** -- with the bar focused,
komorebi still reported the real window as focused and `cycle-focus` still
worked -- so this is a migration gap closed on correctness grounds, not a
proven cause of the reported symptom.

In-repo, `zebar/caelestia/komorebi-commands.js` moved to the same real-binary
path, so the bar's workspace buttons and the dashboard's workspace pane stop
paying the shim cost too. `KOMOREBIC_PATH` and the `shellCommands` allowlists
in `zpack.json` are a **matched pair** -- the allowlist matches the program
string literally, so changing one alone fails at runtime with a privilege
error, not a fallback.

## Window borders and gaps

komorebi has a full border CLI (`komorebic border enable|disable`, `border-style`, `border-width`,
`border-offset`, `border-colour <R> <G> <B> --window-kind <kind>` -- **RGB integers, not hex**).
`~/komorebi.json` was hand-edited (surgically -- parsed, mutated, re-serialized, never rewritten
wholesale, preserving all 20 `ignore_rules` entries and every other key) to turn this on
persistently: `border: true`, `border_style: "Rounded"`, `border_width: 4`, `border_offset: 1`,
`default_workspace_padding`/`default_container_padding` (5 -> 12 originally, **now 8/8** -- see
"The desktop frame" below, which owns those two values). Applied live via `komorebic stop` +
`komorebic start` (config is read at startup, not hot-reloaded); the padding half also has a
runtime CLI (`komorebic workspace-padding <mon> <ws> <n>` / `container-padding`) that avoids a
restart.

`Apply-Theme` now also themes the border colours every run, via `Update-KomorebiBorderTheme`
(`scripts/Apply-Theme.ps1`):

- matugen renders `matugen/templates/komorebi-colours.json` -> `state/staging/komorebi-colours.json`
  (`[templates.komorebi]` in `matugen/config.toml`) -- **not** one of `$script:Targets` (no live
  config of its own to copy/validate/roll back; it exists purely to hand this step hex values
  without a second matugen invocation).
- Role mapping: `single` (focused window) -> `surface_container_high`, `stack` ->
  `surface_container`, `monocle` -> `surface_container_high`, `unfocused` -> `surface`, `floating`
  -> `outline`. `unfocused_locked` is intentionally left unmapped (komorebi's own default).
  **These are SURFACE-family roles, not accents, on purpose** (direct user feedback): the borders
  sit immediately inside the desktop frame's own `var(--surface)` bands, so an accent border read as
  a clashing second frame. Focused stays one step lighter than its surroundings so the focus cue
  survives. Don't "restore" these to primary/tertiary/secondary/error.
- **Runtime**: `Set-KomorebiBorderColour` calls `komorebic border-colour <R> <G> <B> --window-kind
  <kind>` per role (hex converted to RGB ints via `ConvertFrom-HexColor`). This is **fail-soft** --
  if `komorebic` isn't on PATH or komorebi isn't running, it warns and Apply-Theme continues; a
  theming run must never fail because the WM is down.
- **Persisted**: `Set-KomorebiBorderColours` writes the same colours (as hex strings -- komorebi's
  schema.json accepts `border_colours.<kind>` as either an `{r,g,b}` object or a `"#RRGGBB"`
  string) into `~/komorebi.json`'s `border_colours` field, structurally (same
  parse-mutate-serialize pattern as `Set-ZebarStartupConfig` in `Install-Config.ps1`), so a
  komorebi restart (reboot, crash, `komorebic stop`/`start`) keeps the themed colours instead of
  reverting to whatever was last saved on disk. **This runs regardless of whether the runtime CLI
  call above succeeded** -- persistence and the live nudge are independent.
- **Guarded and atomic** (fix wave after review): the parsed komorebi.json content is rejected with
  a thrown exception -- caught by `Update-KomorebiBorderTheme`'s own try/catch, never escaping it --
  if it parses to `$null` (empty/whitespace/literal `null`) or to anything other than a JSON object
  (e.g. a root-level array), instead of silently truncating the file to 0 bytes the way an
  unguarded `Get-Member`/`Add-Member`/`ConvertTo-Json`/`WriteAllText($path, $null)` chain did
  before. The write itself is a temp-file-then-rename (`Move-Item -Force`, same directory/volume,
  atomic) rather than an in-place `WriteAllText`, so an interrupt can never leave a truncated
  `~/komorebi.json` on disk. `New-PreApplySnapshot`/`Restore-PreApplySnapshot` also snapshot
  `~/komorebi.json` into `state/pre-apply/` (see "Pipeline flow" above), even though it isn't one of
  `$script:Targets`, so it has a manual recovery path like every other target. Per-kind hex values
  that fail to parse (e.g. a template edited to emit matugen's `.rgb` accessor instead of `.hex` for
  one role) are warned about and skipped individually -- the other, well-formed kinds are still
  themed and persisted, and `Update-KomorebiBorderTheme` never throws out to its caller over one bad
  value. `Apply-Theme`'s own call to `Update-KomorebiBorderTheme` is additionally wrapped in
  try/catch as defence in depth.

## The Windows taskbar

`Update-WindowsAccentTheme` (`scripts/Apply-Theme.ps1`) themes the taskbar, Start menu and window
title bars from the wallpaper palette on every apply. Windows has **no supported API** for this --
the accent colour is a user setting, and the only route is the same HKCU keys the Settings app
writes, followed by a `WM_SETTINGCHANGE`/`ImmersiveColorSet` broadcast (`SendMessageTimeout` with
`SMTO_ABORTIFHUNG`, so one hung window cannot stall a theme apply). All HKCU -- no elevation, and
nothing outside this user account. An explorer restart would also work and is deliberately NOT
used: it closes every File Explorer window and blanks the taskbar, on every wallpaper change.

**Two encodings, three keys apart, in opposite byte orders.** Both were established by DECODING
this machine's own pre-existing values before writing anything, not taken from documentation:

| key | order | example (the old teal, RGB 0,215,215) |
|---|---|---|
| `Explorer\Accent\AccentColorMenu`, `StartColorMenu`, `DWM\AccentColor` | **ABGR** (0xAABBGGRR) | `0xFFD7D700` |
| `DWM\ColorizationColor`, `ColorizationAfterglow` | **ARGB** (0xAARRGGBB) | `0xC400D7D7` |
| `Explorer\Accent\AccentPalette` | 8 x **R,G,B,A** bytes (32 total) | entry 4 = the Start/taskbar shade |

Confusing the first two swaps red and blue -- a colour that is wrong but plausible, never obviously
broken. `ConvertTo-AbgrDword`/`ConvertTo-ArgbDword` are separate functions with separate tests
pinning both against those exact decoded values. Don't merge them.

The `AccentPalette` byte order and the meaning of entry 4 were confirmed the same way: the old
palette's entry 4 decoded to RGB(0,113,113) and `StartColorMenu` read `0xFF717100` -- the same
colour -- which is what identified entry 4 as the shade Windows paints the Start/taskbar surface
with.

**Mapping.** Deliberately splits accent from surface, which is what lets the taskbar match the bar
without turning every highlight in Windows monochrome:

- `AccentPalette` / `AccentColorMenu` / `DWM\AccentColor` -> `primary` (selection, focus, hover)
- `StartColorMenu` -> `surface_container` -- the one that actually paints the taskbar surface
- `ColorizationColor` / `Afterglow` -> `surface_container_high` (title bars, one step lighter,
  the same reasoning as the komorebi border mapping and deliberately consistent with it)
- `ColorPrevalence` is forced to 1 in both `DWM` and `Themes\Personalize`. It was 0 on this
  machine, and without it Windows ignores the accent for Start and the taskbar entirely -- the
  whole step would silently do nothing visible.

**Recovery.** A registry write has no equivalent of "the old bytes are still on disk until they are
replaced", which every file target in this pipeline relies on. `New-PreApplySnapshot` therefore
writes the previous values to `state/pre-apply/windows-accent.json` (binary as a hex string). That
file is the ONLY way back to the pre-pipeline taskbar colours, and they are a user setting this
pipeline did not create -- treat it accordingly.

**Verifying this is genuinely hard here, and the obvious approaches all fail:**

- `PrintWindow` on `Shell_TrayWnd` returns **solid black**. The Windows 11 taskbar is XAML/DWM
  composited and does not render that way, even with `PW_RENDERFULLCONTENT` (nFlags 2).
- The taskbar is in auto-hide mode, so only ~2px of it is ever on screen -- and **the desktop
  frame's own bottom band covers exactly those 2px**. A screen grab at y=1438 samples the `edges`
  widget (`var(--surface)`), not the taskbar. This is easy to mistake for a successful read.
- What DOES work: `DwmGetColorizationColor` is a live system read rather than an echo of the write,
  so it confirms Windows actually absorbed the change. DWM applies its own slight darkening --
  expect a near miss, not an exact match (`#252b2b` written -> `#212727` reported).
- Beyond that, the taskbar has to be seen by hovering it. Nothing in this repo can screenshot it.

**A consequence worth knowing:** on this desktop the taskbar is auto-hidden *and* its visible
sliver is covered by the frame, so this retheme mostly shows up in the Start menu, in title bars,
and while hovering the bottom edge -- not in normal use.

## The desktop frame (branch `feat/corner-overlays`, UNMERGED)

A Caelestia-style coloured frame around the desktop, plus a reworked bar. All of it lives on
`feat/corner-overlays`, which is ~20 commits ahead of `main` and **not merged** -- the user was
asked and had not answered. `docs/zebar-bar.md` is the full account; this is the orientation.

**Shape.** Solid `var(--surface)` (the bar's own colour) bands on **top, right and bottom only** --
the 52px bar is the left side of the frame. Four corner widgets paint a 90° inverse arc so the
content area reads as a rounded rectangle. Every piece is a separate `top_most` Zebar preset with
`dockToEdge` disabled, and all of them hide together when something goes fullscreen
(`tools/fullscreen-detect.exe`, polled from `fullscreen.js`).

**The one invariant that matters: all four wallpaper gaps must be equal.** Gap = komorebi's total
padding − band thickness. Top/right/bottom each spend the band out of that padding; the left side
has no band, so it needs `global_work_area_offset` to compensate. Current values: thickness 8,
gap 8, radius 16, padding 8/8, offset `{left:-8, top:0, right:-8, bottom:0}`.

**`scripts/Set-FrameGeometry.ps1` is the only supported way to retune** (`-Thickness -GapRatio
-Radius`, `-DryRun` to preview). It rewrites the zpack presets, the CSS custom properties, the
komorebi padding *and* the offset together. Hand-editing `zpack.json` alone silently breaks the
equal-gap invariant. Note the asymmetry: the padding half applies live, the offset half needs a
komorebi restart.

**Two traps that each cost a full debugging session:**

1. **`komorebic state` does not reflect `global_work_area_offset`.** With the offset demonstrably
   working, `work_area_size` still reads `{left:52,...}` and `work_area_offset` reads empty. Two
   passes concluded the feature was impossible from that evidence. The `komorebic
   global-work-area-offset` *CLI* genuinely is a no-op; the *config field* is not, and is read only
   at startup. **Verify by scanning screen pixels for where windows actually land**, never by
   reading state.
2. **A blank bar is almost never WebView2.** `fullscreen-detect.exe` (and now `app-icon.exe`) are
   shelled out on a poll; one outliving its parent zebar **inherits zebar's listening socket on
   port 6124**, so every later start fails to bind and paints nothing under a PID that no longer
   exists. Check `Get-NetTCPConnection -LocalPort 6124` and kill the orphan. `Restart-ZebarWidgets`
   now reaps both helpers first. **Never `Stop-Process msedgewebview2`** -- doing that once broke
   WebView2 machine-wide and needed a reboot.

**The bar** (`zebar/caelestia/bar/`, entries ordered by `bar.config.json`): logo, workspaces,
app icon + app name centred between two spacers, clock, a status pill, a layout menu, power.
Notable details:

- **Status icons are configurable, pinned or dropdown** (`status` block in `bar.config.json`;
  catalogue in `zebar/caelestia/status-catalogue.js`). Pinned ids render as glyphs in the pill;
  the rest open in the `statusmenu` flyout behind a chevron that only exists when that list is
  non-empty. `parseStatusConfig` never throws -- bad ids are dropped loudly, an id in both lists
  stays pinned. The old `statusIcons` entry was **deleted**, not left registered, so exactly one
  place decides what a status glyph means. Provider gotchas, all found live: the `battery` provider
  *rejects* ("No battery found.") rather than returning null on a batteryless machine; `audio`
  reports `isMuted` separately from `volume` (a 50%-but-muted device used to show the loud icon);
  the `disk` provider pre-converts sizes, so use `siValue`/`siUnit`, never recompute from `bytes`.

- **Icons are vendored Font Awesome Free 6** (`bar/vendor/fontawesome/`, no CDN). Beware: the bar's
  fallback font `0xProto Nerd Font` embeds Font Awesome **v4** at U+F000–U+F2E0, so a broken FA
  cascade *still renders* the low codepoints and only tofus the FA6-only ones. That is what made a
  `font: inherit` shorthand (which resets font-family) look like a font-loading problem.
- **`activeWindow` shows the app name only**, resolved from the komorebi provider's `exe` (a bare
  name, never a path) through an alias table, plus the real extracted executable icon via
  `tools/app-icon.exe`. That tool is cached per exe, timed out, non-overlapping, and reaped.
- **The layout control is a menu, not a cycle** -- cycling retiled the user's windows at every
  intermediate step. It now **opens sideways with text labels**, which it can only do by being a
  *second widget* (`zebar/caelestia/layoutmenu/`, `dockToEdge` disabled) -- a Zebar widget cannot
  paint outside its own 52px window, and both in-window escapes are closed on this build (widening
  the docked window moves komorebi's work area 1:1 and retiles; `pointer-events: none` gives no
  OS-level click-through). It **parks itself at 1x1 while closed and resizes to the panel on open**,
  because a transparent Zebar window swallows clicks across its whole footprint. The bar and the
  flyout talk over `localStorage` + `storage` events (`zebar/caelestia/layout-channel.js`) -- all
  widgets in the pack share one origin (`http://127.0.0.1:6124`, verified live), so this needs no
  new helper process and no new poll, which matters given trap 2. The flyout never runs `komorebic`
  itself; the bar owns that. Its active marker still goes stale on externally-driven layout changes:
  the komorebi provider never re-emits to a running widget, and no `komorebic` poller was added on
  purpose, per trap 2.
- **Every stylesheet must contain zero colour literals** -- `var(--…)` and `transparent` only,
  enforced by a Pester test. Colours arrive only through matugen-generated `theme.css`.

- **The dock's hover preview is a PASSIVE second widget** (`dockpreview`), not a taller dock. The
  dock's own window must never change shape -- growing it was tried and reverted (trap 2's cousin;
  `docs/zebar-bar.md`'s "Dock hover previews" has the full account). That a *separate* `top_most`
  window resizing above the dock is harmless was **measured** first: 5/5 treatment and 5/5 control
  trials, cursor integrity checked. **Two harness traps live here and both produced convincing
  false failures:** the real user moving the mouse mid-measurement, and `SetCursorPos` teleports
  (glide 4/5 vs jump 0/5 for the same target). Any hover test here must glide the cursor in steps
  and discard trials where `GetCursorPos` has drifted, or it is measuring itself. Related:
  `mouseleave` was observed firing 12ms after `mouseenter` with the pointer provably stationary,
  and no `mouseenter` can follow while the cursor does not move -- so the close decision re-checks
  `:hover` and a `mousemove` listener re-arms, rather than trusting the leave.

## Pipeline flow

```
Switch-Wallpaper.ps1
  -> Get-WallpaperEngineExe          (which WE binary is actually running)
  -> Get-CurrentWallpaper            (regex-read WE's own config.json; getWallpaper CLI is dead)
  -> Resolve-PreviewImage            (preview.jpg -> preview.gif -> preview.png -> $null)
  -> Apply-Theme.ps1
       -> matugen image <preview> --mode dark --type <scheme> --prefer saturation --config matugen/config.toml
       -> renders the 3 live targets (wezterm, starship, zebar) PLUS the non-target
          komorebi-colours.json into state/staging/ -- yasb/tacky-borders templates are no longer
          in matugen/config.toml, so nothing renders for them at all (see "The stack" above)
       -> Remove-Bom + Test-StagedFile on every staged TARGET file (pre-copy, structural, per-target)
       -> abort here if any target fails -- nothing live has been touched yet
       -> New-PreApplySnapshot: snapshot the CURRENTLY LIVE content of all 3 targets, PLUS
          ~/komorebi.json (F2 -- hand-maintained, outside any git repo, and not itself one of
          $script:Targets), into state/pre-apply/ (a directory SEPARATE from state/last-good/ --
          see below)
       -> state/last-good/ itself is NOT refreshed pre-copy -- it is only refreshed AFTER this
          run passes every pre-copy structural validation check, because a pre-copy refresh of
          last-good let an undetected-bad apply silently become the new "last-good" baseline on
          the very next run (found live in Task 8, back when yasb was still a target; see
          Apply-Theme.ps1's own comment above its `Update-LastGood` call for the full account)
       -> Copy-StagedToLive: copy staged files over the live configs (-ErrorAction Stop; a
          partial copy rolls back from state/pre-apply/ immediately)
       -> (yasb's post-copy yasb.log check and tacky-borders' log check were removed along with
          those two targets -- wezterm/starship/zebar have no equivalent post-copy signal; their
          pre-copy Test-StagedFile checks are the only gate, same as always. This also removed the
          8-second post-copy sleep yasb's log check needed to settle.)
       -> on success: Update-LastGood (atomic 2-generation rotation; a failed rotation warns
          rather than rolling back an already-good live apply)
       -> zebar reload, ONLY if theme.css actually changed: Stop-Process zebar (kills ALL running
          zebar widgets -- no per-widget reload verb exists), wait 500ms, Start-Process (never
          inline -- start-widget-preset blocks the caller) start-widget-preset --pack caelestia
          --widget-name bar --preset default. See docs/zebar-bar.md
       -> touch ~/.wezterm.lua
       -> Update-KomorebiBorderTheme: theme komorebi's window-border colours, both at runtime
          (`komorebic border-colour`, fail-soft) and persisted into ~/komorebi.json's
          border_colours field -- see "Window borders and gaps" above. Entirely fail-soft; never
          affects this run's own Success/Failed result.
       -> Update-WindowsAccentTheme: theme the Windows taskbar/Start/title bars from the same
          palette, by writing HKCU accent keys + broadcasting WM_SETTINGCHANGE. Also entirely
          fail-soft. See "The Windows taskbar" below.
  -> writes state/current.json ({ wallpaper, preview, appliedUtc }) -- also now the -Image
     fallback source: `Apply-Theme` with no -Image reads this file's `preview` field
```

**Two entry-point scripts:**

- `scripts/Apply-Theme.ps1` — `Apply-Theme -Image <path> [-Scheme <scheme-name>] [-DryRun]`. Themes
  from an explicit probe image. Does not touch Wallpaper Engine at all.
- `scripts/Switch-Wallpaper.ps1` — `Switch-Wallpaper [-Wallpaper <asset-path>] [-Scheme <scheme-name>] [-DryRun]`.
  Advances (or sets) the actual desktop wallpaper via Wallpaper Engine, resolves its preview image,
  then calls `Apply-Theme` on it. This is the one a keybinding should call (see `README.md` — no
  keybind is wired up yet).

Both accept `-DryRun`, which renders everything to `state/staging/` and validates it but copies
nothing to a live config. For `Switch-Wallpaper`, `-DryRun` additionally skips the Wallpaper Engine
control command (`openWallpaper`/`nextWallpaper`) entirely -- it themes from whatever wallpaper is
*already* current rather than advancing/setting it. Earlier in this project's history `-DryRun`
still issued that control command and changed the actual desktop wallpaper even though nothing was
copied to a live config file; fixed, see the final fix report's C1 for the full account.

## PowerShell 5.1 constraints

This machine has **no PowerShell 7**. Every script in this repo is 5.1-compatible:

- No `&&`, `||`, ternary (`?:`), or `??`. Use `;` and `if ($?) { }` instead.
- `ConvertFrom-Json` **throws** on Wallpaper Engine's `config.json` (`Cannot process argument
  because the value of argument "name" is not valid` — the file has an empty/duplicate key).
  `Get-CurrentWallpaper` reads it with a hand-rolled regex + brace-walk instead. Do not "fix" this
  back to `ConvertFrom-Json` without re-verifying the file no longer trips this.
- `matugen` is not guaranteed to be on `PATH` in a fresh shell (see stack table above).
  `Apply-Theme.ps1` prepends `~/.cargo/bin` defensively at the top of the file if `matugen` isn't
  already resolvable — keep that guard if the script is ever split up.

### The BOM rule

**All file writes in this pipeline use:**

```powershell
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
```

**Never** `Set-Content -Encoding UTF8` or `Out-File` for a config file. Both emit a UTF-8 BOM
(`EF BB BF`), and **yasb silently refuses a config or stylesheet with a BOM** — it logs only "could
not be read", not why, which reads exactly like an unrelated file-permissions problem. This was
verified experimentally (`~/.config/yasb/CLAUDE.md`'s own trap list), not assumed.

matugen itself does **not** emit a BOM in rendered template output (verified byte-for-byte, Task 1,
recorded in `docs/matugen-reference.md`) — `Remove-Bom` in `Apply-Theme.ps1` exists as a defensive
belt-and-braces step for staged output anyway, in case that ever changes or a future template
target introduces one through some other path, not because matugen has ever been observed to add
one.

### `--prefer` and `[config]` are both mandatory

- **`matugen image ... --prefer <value>` is required for every scripted/non-interactive call.**
  Without it, matugen throws `Multiple source colors found, no preference was inputted, and a
  terminal was not detected` whenever the probe image has more than one plausible dominant color —
  which is common, and empirically hits ~70% of this wallpaper library's `.gif`-only previews.
  `Apply-Theme.ps1` always passes `--prefer saturation`. Valid values: `darkness`, `lightness`,
  `saturation`, `less-saturation`, `value`, `closest-to-fallback` (`--source-color-index N` is the
  alternative, non-`--prefer` form).
- **`matugen/config.toml` must have a top-level `[config]` table, even empty.** `[templates.*]`
  sections alone produce `TOML parse error ... missing field 'config'` in v4.1.0 — `config` is a
  mandatory field of `ConfigFile`, even though every field *inside* `Config` is itself optional.
  Full details and the source confirmation: `docs/matugen-reference.md`.

## How to add a new theme target

1. Read `docs/matugen-reference.md` for the full role list, filter syntax (`{{ expr | filter: arg
   }}`, not Tera's `{% %}`), and format accessors (`.hex`, `.rgba`, `.hex_alpha`, etc.) before
   writing anything — matugen v4 has its own hand-rolled template engine, not Tera/Jinja2.
2. If the target's live config uses raw color literals that need to survive a mechanical,
   provably-lossless conversion (like `yasb/styles.css` did), use the round-trip machinery:
   - `Get-ColorLiterals -Path <live-config>` (Task 2) to inventory every distinct literal.
   - Add one entry per literal to a mapping file (see `matugen/mapping.json`'s shape), assigning
     each a Material You role/expression by hand, guided by the target's own theme-convention docs
     if it has any (e.g. `~/.config/yasb/CLAUDE.md`'s "Theme conventions" section).
   - `New-Template -SourcePath <live> -MappingPath <mapping> -OutputPath <template>` to generate
     the template.
   - `Test-Roundtrip -SourcePath <live> -TemplatePath <template> -MappingPath <mapping>` — **must**
     return `$true` before committing. It reverses every mapping expression back to its literal and
     diffs byte-for-byte against the live source. On failure it prints the exact divergence offset.
   - **If two different literals must map to the same Material role, their `expression` strings
     must still be textually distinct**, or `Test-Roundtrip` cannot invert the many-to-one mapping
     (it can only replace one expression string with one literal). The established trick is a
     harmless `set_alpha` nudge of a few thousandths (matugen rounds `rgba()` alpha to 1 decimal
     place before rendering, so `0.797`-`0.803` all render identically as `0.8` — see
     `docs/matugen-reference.md`'s "Why `matugen/mapping.json` has `set_alpha` values like
     0.797/0.801" section for the full reasoning and verification). Never "clean up" these nudged
     values back to a single shared value — that silently breaks the gate on the next run, not the
     render.
   - If the target has no meaningful raw-literal round trip (e.g. `tacky-borders.yaml`,
     `starship.toml`, `palette.lua` — small, hand-authored files with few color fields), skip the
     mapping/round-trip machinery and just replace color values directly with matugen expressions
     in a copy of the live config. Verify by manually rendering through a throwaway matugen config
     and confirming zero `{{` survives and (where possible) that the consuming app accepts the
     rendered file.
3. Add a `[templates.<name>]` entry to `matugen/config.toml`, `input_path` under
   `matugen/templates/`, `output_path` under `state/staging/` — **never** point `output_path` at a
   live config directly.
4. Add the target to `$script:Targets` in `scripts/Apply-Theme.ps1` (`Name`, `Staged`, `Live`).
5. Add a case to `Test-StagedFile`'s `switch ($Name)` block for any structural validation the
   target supports offline (see `docs/validation-limits.md` for what "structural" means and why
   it's the ceiling for a target with no real parser available — yasb's case there is the fullest
   worked example: brace-balance, unterminated-comment/string detection, rule-count and size
   sanity vs. `state/last-good/`). If the target has its own CLI that can validate a config file
   without side effects (like starship's `starship prompt`), prefer calling that over writing a
   hand-rolled structural check.
6. If the target needs an explicit reload/restart to notice its config changed (WezTerm needs
   `.wezterm.lua` itself touched, not just an included file — see `docs/spikes.md` unknown #2),
   add that step at the end of `Apply-Theme`, after the post-copy validation passes.
7. Add Pester tests under `tests/` following the existing `Describe "Test-StagedFile ..."` pattern
   — a check that has never been proven to reject anything is not a check (this project paid for
   that lesson at least twice — see `docs/validation-limits.md`'s account of the yasb brace-scanner
   iterations).

## Re-running the round-trip gate after `styles.css` changes upstream

**Retired along with yasb (see "The stack" above): `yasb.styles.css` is no longer a matugen
target at all** -- `[templates.yasb]` was removed from `matugen/config.toml` and the `'yasb'` row
from `$script:Targets` in `scripts/Apply-Theme.ps1`, so `Apply-Theme` never renders or copies it
anywhere anymore. This whole section, including the entire procedure below, is now purely
historical -- kept because `matugen/templates/yasb.styles.css` and `matugen/mapping.json` are
still on disk (unwired, not deleted, so the work is recoverable) and this is the only record of
how to rebuild the mapping/template pair if yasb is ever re-wired into the pipeline. **The
`-AcceptStructuralChange` switch this section describes (I7) was removed from both
`Test-StagedFile` and `Apply-Theme` when yasb's rule-count/size check went with it** -- it had no
other caller, so it would have been dead, unreachable plumbing otherwise. If yasb is ever
reinstated as a target, that switch would need to be re-added alongside its rule-count/size check,
not just uncommented.

**Do not follow the live-file procedure below against the CURRENT `~/.config/yasb/styles.css`
blindly — it is matugen-GENERATED output now, not hand-authored Catppuccin content.** Step 1 below
will find zero matches against `matugen/mapping.json`'s Catppuccin-literal keys, `New-Template`
will emit `template == source` (nothing to substitute), and `Test-Roundtrip` will trivially return
`$true` on a file with ~40 hardcoded literals and zero matugen expressions — a vacuous pass that
looks like the gate ran for real (I5 in the final fix report: this was discovered when the gate
could no longer be re-run at all, because the pre-migration source no longer exists anywhere in
this repo — live, `state/last-good/`, and `state/last-good-prev/` are all generated output).

To sanity-check that the gate mechanism itself (mapping.json + `New-Template` + `Test-Roundtrip`)
still works correctly **without** needing a live file that has genuinely drifted, use the recovered
pre-migration fixture instead — recovered byte-for-byte from `~/.config/yasb`'s own git history at
commit `f1e7db6` (the last commit before that repo's styles.css/tacky-borders/wezterm/starship
migration to matugen-templated output), checked in at `tests/fixtures/styles.css.catppuccin`, and
exercised by `tests/Roundtrip.Tests.ps1`'s `Describe "Real round-trip gate against the recovered
pre-migration Catppuccin fixture (I5)"` — run that Describe block any time the gate mechanism
itself is suspect:

```powershell
Import-Module Pester -MinimumVersion 5.0.0
Invoke-Pester tests\Roundtrip.Tests.ps1 -Output Detailed
```

**Only follow the procedure below when `~/.config/yasb/styles.css` has genuinely been hand-edited,
or a fresh yasb install has regenerated its own (non-matugen) default stylesheet** — i.e. step 1's
`$inv`/`$missing` diff is expected to find real new literals, not an empty set:

If `~/.config/yasb/styles.css` is ever hand-edited directly (it shouldn't be — see
`~/.config/yasb/CLAUDE.md`, "generated files" section — but if it happens, e.g. a fresh yasb
install regenerates a different default), the mapping/template pair in this repo goes stale and
needs rebuilding:

```powershell
# 1. Re-inventory the literals in the new live file.
. .\scripts\Get-ColorLiterals.ps1
$inv = Get-ColorLiterals -Path "$env:USERPROFILE\.config\yasb\styles.css"
$inv | Format-Table -AutoSize

# 2. Diff against the mapping already in matugen/mapping.json -- anything new needs an entry.
$map = Get-Content .\matugen\mapping.json -Raw | ConvertFrom-Json
$mapped = $map.PSObject.Properties.Name
$missing = $inv | Where-Object { $mapped -notcontains $_.Literal }
if ($missing) { $missing | Format-Table -AutoSize } else { "All literals already mapped." }

# 3. Add entries for any $missing literals to matugen/mapping.json by hand (role choice guided by
#    ~/.config/yasb/CLAUDE.md's "Theme conventions"; remember the set_alpha disambiguation-nudge
#    rule above if the chosen expression collides with an existing one).

# 4. Regenerate the template from the NEW live file.
. .\scripts\New-Template.ps1
New-Template -SourcePath "$env:USERPROFILE\.config\yasb\styles.css" `
             -MappingPath ".\matugen\mapping.json" `
             -OutputPath  ".\matugen\templates\yasb.styles.css"

# 5. Run the gate. Must print GATE PASSED before anything is committed.
. .\scripts\Test-Roundtrip.ps1
$ok = Test-Roundtrip -SourcePath "$env:USERPROFILE\.config\yasb\styles.css" `
                     -TemplatePath ".\matugen\templates\yasb.styles.css" `
                     -MappingPath  ".\matugen\mapping.json"
if (-not $ok) { throw "GATE FAILED - fix the mapping, never the template by hand, then regenerate" }

# 6. Confirm no literals survived in the new template.
$t = [System.IO.File]::ReadAllText(".\matugen\templates\yasb.styles.css")
[regex]::Matches($t, '#[0-9a-fA-F]{6}\b').Count   # expect 0
[regex]::Matches($t, 'rgba?\(\s*\d+').Count       # expect 0

# 7. Run the full suite (this also re-validates Apply-Theme's structural checks against the new
#    template) and, if it passes, apply for real and LOOK AT THE BAR -- a clean log is not proof
#    (see docs/validation-limits.md).
Invoke-Pester tests\ -Output Detailed
```

Whatever caused the drift (`state/last-good/styles.css` size/rule-count baseline in
`Test-StagedFile`'s yasb checks) will also need a fresh successful apply to re-baseline itself —
that happens automatically via `Update-LastGood` the next time `Apply-Theme` succeeds.

**This used to be circular** for a genuinely large intentional change (e.g. a maintainer adding
~9 rules to a 175-block template): the ±5%/±20% rule-count/size checks reject the apply for
drifting too far from the stale baseline, so `Apply-Theme` never succeeds, so `Update-LastGood`
never runs, so the baseline can never re-baseline itself — the remedy required the thing it was
supposed to fix. `Apply-Theme -AcceptStructuralChange` (threaded through to
`Test-StagedFile -AcceptStructuralChange`) breaks the cycle: it bypasses ONLY the rule-count/size
comparison against `state/last-good/` for that one apply (brace-balance and
unterminated-comment/string detection — the checks that actually catch corruption — still run in
full). Use it for exactly one apply after a deliberate structural template edit; if that apply
succeeds, `Update-LastGood` re-baselines normally and every apply after that is compared against
the new, larger baseline with the full ±5%/±20% tolerance back in effect.

## The five original unknowns — resolved answers

Full evidence for all five is in `docs/spikes.md` and `docs/matugen-reference.md`; this is the
short version.

1. **Does matugen emit a BOM in rendered output?** No — verified byte-for-byte
   (`docs/matugen-reference.md`). This does not change the project's own `WriteAllText`/no-BOM
   convention, which exists because of *other* tools (`Set-Content -Encoding UTF8`, etc.), not
   matugen.
2. **Does WezTerm reload on a change to a `dofile()`'d included file?** No. Only editing
   `.wezterm.lua` itself triggers a reload (confirmed: an included-file-only edit produced no
   reload after 20+ seconds; touching the main file picked it up in ~5 seconds). `Apply-Theme`
   rewrites `.wezterm.lua`'s own bytes unchanged (bumping mtime) as its last step for this reason.
3. **tacky-borders reload mechanism?** Unresolved, and closed as N/A rather than answered: the
   application **is not installed** on this machine (config + a stale log exist, no executable, no
   running process). The template is still built (`matugen/templates/tacky-borders.yaml`) and
   ready if tacky-borders is reinstalled; its post-copy log check in `Apply-Theme` is conditional
   on the process actually running, so a reinstalled-but-never-reloaded tacky-borders won't produce
   false confidence from a stale log tail.
4. **Does `getWallpaper` work, and what's the reliable current-wallpaper source?** `getWallpaper`
   does not work — verified against both `wallpaper32.exe`/`wallpaper64.exe`, with and without
   `-monitor`, with redirected stdout; always empty. The reliable source is Wallpaper Engine's own
   `config.json` (`wallpaperconfig.selectedwallpapers.*.file`), read via regex because
   `ConvertFrom-Json` throws on that file in PowerShell 5.1. Also resolved: the live process on
   this machine is `wallpaper32.exe`, not `wallpaper64.exe` — `Get-WallpaperEngineExe` detects
   which one is actually running rather than hardcoding either.
5. **Preview image coverage across the wallpaper library?** Checked all 57 installed wallpapers:
   15 (26%) have `preview.jpg`, 40 (70%) have only `preview.gif`, and 2 (4%) have neither
   (`2589058527` and `3625569802` — one has only a `debug.log`, the other is empty; both look like
   broken/incomplete Workshop downloads). `Resolve-PreviewImage` falls back `preview.jpg` ->
   `preview.gif` -> `preview.png` -> `$null`; the `$null` case is handled by the caller
   (`Switch-Wallpaper` warns and leaves the theme unchanged rather than crashing). matugen decodes
   GIF previews fine given `--prefer` (verified live, not just assumed from the `image` crate's
   stated format support).

## Validation limits — what this pipeline can and can't catch

`docs/validation-limits.md` is the full account (worth reading in full before touching
`Test-StagedFile`). **yasb and tacky-borders are retired as theming targets** (see "The stack"
above) -- the account below of their validation ceiling is kept as historical record (the same
"structural, not semantic" ceiling applies to every remaining target, including zebar) but no
longer describes anything this pipeline actively renders or copies. The short version: yasb and
tacky-borders had **no offline CSS/QSS validator**, and yasb's own bundled parser did
spec-mandated lenient error recovery, so a clean `yasb.log` after reload was **not** proof the
stylesheet rendered correctly — this was observed live, not theorized (a deliberately corrupted
stylesheet deployed with a clean log and a visibly broken bar). The structural checks in
`Test-StagedFile` (brace balance via a string/comment-aware scanner, unterminated-comment/string
detection, and for yasb specifically, rule-count and size sanity against `state/last-good/`) catch
every corruption *shape* that's been tried against them, but they cannot catch a structurally
valid file with semantically wrong *content* (right role, wrong color; a typo'd property name).
**Visual confirmation — screenshot the bar — remains the real gate for that gap**, after every
real (non-`-DryRun`) apply.
