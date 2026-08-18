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
| cava (1.0.0) | `C:\Users\PC\AppData\Local\cava\cava.exe`, per-user MSI (`cava_win_x64_install.msi`) from the upstream GitHub release — **not in scoop, and there is no winget on this machine**. The installer appends its directory to the **User** PATH, so `cava` does not resolve in shells that were already open. Config at `~/.config/cava/config` (13 KB, **hand-owned, not version controlled, never written by this pipeline**); the only pipeline-owned thing there is `theme = 'wallpaper'` in its `[color]` section, which points it at `~/.config/cava/themes/wallpaper` — a theming target. See "cava" below. |
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

**That conversion had come undone, and the two script bindings were dead.**
Found while adding the cava binds: `alt + w` (next wallpaper) and `ctrl + alt + w`
(retheme) were back to `Start-Process powershell -WindowStyle Hidden
-ArgumentList ...` while `.shell` was still `cmd` -- and cmd has no
`Start-Process`, so both hotkeys did nothing at all (`cmd /c Start-Process ...`
-> "'Start-Process' is not recognized"). Repaired to the `start "" /b powershell
-NoProfile -ExecutionPolicy Bypass -File "..."` form this section already
documents. Backup at `~/.config/whkdrc.bak-before-cava-binds`. **The lesson is
that whkdrc is out of version control and silently drifts** -- when touching it,
re-check that every binding's syntax matches the `.shell` in force, and test the
exact command line through `cmd /c` before trusting it, because whkd reports
nothing when a binding's command is bad.

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

**`foobar2000.exe` is also in `ignore_rules`** (added 2026-08-18), so both foobar
instances float rather than tile. The player's own top bar was briefly made
frameless via `foo_ui_wizard`, and dragging an 8px caption rim while komorebi
tried to tile the window was unusable; the frame was reverted and the window
excluded from tiling. Applied at runtime *and* persisted, the same dual approach
the border colours use. Backup at `~/komorebi.json.bak-before-foobar-ignore`.
Full account: `docs/foobar2000-briefing.md`.

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

## cava

A terminal audio visualiser, themed from the wallpaper like everything else. Installed as a
per-user MSI (see "The stack"). Everything below was established on this machine, from cava's own
source or by running it -- not from its README, which describes the Linux build.

**Why the bars were white before any of this existed.** Every key in the generated config's
`[color]` block ships commented out, so `foreground = default` -- and "default" is not a colour, it
tells cava to emit no colour escape at all and let the terminal's own foreground stand. WezTerm's
foreground is `on_surface`, a near-white. Nothing was broken; cava had never been told a colour.

**The theming seam is a THEME FILE, not the config.** `[color] theme = '<name>'` loads
`~/.config/cava/themes/<name>` -- a small colour-only file. So the pipeline owns
`matugen/templates/cava.theme` -> `state/staging/cava.theme` -> `~/.config/cava/themes/wallpaper`,
and the 13 KB config next to it (sensitivity, bar count, output mode, shader choice) stays
hand-owned and is never written. The live theme file deliberately has **no extension**: cava builds
the path as `themes/<name>` verbatim, the same shape as the `solarized_dark`/`tricolor` themes it
ships with. Theme paths always resolve under `%USERPROFILE%\.config\cava\themes\` regardless of
where `-p` points the config.

**Named colours ride the WezTerm palette; hex does not.** For the eight named colours cava emits a
plain `\033[3Xm`, so the *terminal* chooses the pixels -- and `matugen/templates/palette.lua`
already derives every ANSI slot from the wallpaper (`blue` = `primary`, `cyan`/`green` =
`tertiary`, `yellow` = `secondary`, `red`/`magenta` = `error`). A single named colour therefore
follows the wallpaper for free, with no template and no target at all. **Gradients are the reason
that is not enough**: cava accepts only hex for `gradient_color_N`, which is what forced the
templated theme file. Hex becomes true 24-bit `\033[38;2;r;g;bm`.

**What the theme actually is.** A recreation of `catppuccin/cava`'s gradient
(github.com/catppuccin/cava) in this palette. Catppuccin sweeps eight stops at one tone, a pure hue
walk from calm floor to hot peak; that SHAPE is what is copied. Only three stops are used --
`primary` -> `tertiary` -> `error` -- because matugen synthesises just four accent hues from one
wallpaper (palette.lua's header records the same ceiling), and the fourth, `secondary`, is the
dominant hue desaturated, which renders a muddy grey-cyan across the lower third where the bars
spend most of their time. Both versions were rendered side by side and looked at before that was
decided. Three stops costs nothing in smoothness: cava interpolates linearly in RGB between
consecutive stops, one colour per terminal line. `error` is the stop that keeps the peak hot --
it is red in every palette matugen builds, whatever the wallpaper.

**Windows-specific traps, all confirmed against cava's own `config.c`:**

- **This build has no ncurses.** `method = ncurses` exits with "cava was built without ncurses
  support". Output is `noncurses` (default) or `sdl_glsl`. That is *why* hex works cleanly -- the
  config's warning about needing "a terminal that can change color definitions" describes the
  ncurses path, which does not exist here.
- **Input is hard-locked to WASAPI.** Setting any `[input] method` is a fatal error ("on windows
  changing input method is not supported"). Loopback capture needs no configuration at all.
- **The config is read by `GetPrivateProfileString`, the Win32 INI API -- not iniparser.** That API
  honours only `;` as a comment marker. cava's own shipped config uses `#` and gets away with it
  only because those lines happen to contain no `=`; a `#` comment WITH an `=` would be parsed as a
  key. The template uses `;` throughout and `Test-StagedFile`'s `cava` case rejects any `#` line.
- **A bad theme file stops cava from starting**, unlike every other target here, where a bad write
  is cosmetic. Hence the fuller structural check: `[color]` present, `gradient = 1`, stops numbered
  1..N contiguously (cava stops reading at the first gap), between 2 and 8 of them (it divides by
  `gradient_count - 1`, and `MAX_GRADIENT_COLOR_DEFS` is 8), and every non-`gradient` value a
  quoted 6-digit hex.

**EVERY KEY cava DOCUMENTS IS DEAD ON THIS BUILD.** `cava -h` prints the full list -- Left/Right
for bar count, Up/Down for sensitivity, `r` reload config, `c` reload colours, `f`/`b` cycle
colours, `o` orientation, `q` quit -- and **none of them do anything here**, including `q`, so the
window has to be closed or Ctrl-C'd. That help text is shared across platforms. In cava 1.0.0's
`cava.c` the variable the key `switch` reads is assigned in exactly two places: one guarded
`#ifdef NCURSES` (this build has no ncurses -- see above) and one guarded `#ifndef _WIN32`. The
whole switch is therefore unreachable on Windows. Confirmed against the `1.0.0` tag specifically,
not master, and falsified by feeding 200 `q` keystrokes on stdin and watching cava keep running.
**Do not write "press `r` to reload" anywhere.** This was told to the user twice before it was
checked.

**`live-config = 1` is the only runtime path, and it is enabled** in `~/.config/cava/config`. cava
polls that file's mtime and size every frame and re-runs its entire config load on a change --
which re-reads the theme file too. Measured with a control arm: bar count moved 8 -> 16 mid-run
with it on and stayed at 8 with it off. Two consequences:

- **Editing the config IS the keybind.** `scripts/hotkey-cava-bars.ps1 -Adjust more|fewer` steps
  `bar_width` in that file (min 1, max 12) and a running cava re-lays out within a frame; bound to
  `alt + shift + s` / `alt + shift + a` in `~/.config/whkdrc`, mirroring the existing `alt + s` /
  `alt + a` pair. It moves `bar_width`, not `bars`, for the same reason cava's own dead key handler
  did (`case 68: p.bar_width++`): a pinned `bars = N` makes cava REFUSE TO START in any pane too
  narrow for N, which is no way to behave when a global hotkey has no idea how wide the pane is.
  Verified end to end by screenshotting one cava process before and after the hotkey fired --
  ~20 bars to ~35, never restarted.
- **A wallpaper change still cannot reach a running cava**, because live-config watches the
  *config* file and the pipeline writes the *theme* file. The fix is for `Apply-Theme` to touch
  `~/.config/cava/config` after the copy -- exactly the trick already used on `~/.wezterm.lua`,
  which has the same "only notices its own file" behaviour. **Offered and not yet wired up.**

**Verifying it.** cava's `[output] method = raw` with `raw_target = /dev/stdout` and
`data_format = ascii` prints bar heights as numbers, so audio capture can be proved without looking
at anything: 0/49 frames non-zero during silence, 53/65 with a sound playing. Colour cannot be
checked that way -- redirecting stdout leaves cava with a console width of 0 ("window is too narrow
for number of bars set, maximum is 0") and it renders nothing. Launch it in a plain `cmd` console
and screenshot that; do NOT spawn a WezTerm window for it, because `wezterm start` may attach to
the existing GUI process and killing what it returns can take the session's own terminal with it.

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
gap 8, radius 16, padding **12/4**, offset `{left:-8, top:0, right:-8, bottom:0}`.

**The invariant covers the gaps BETWEEN windows too, and for a long time it silently did not.**
The padding was 8/8, an even 50/50 split of the total, and every check in
`tests/SetFrameGeometry.Tests.ps1` pinned only the gap at the frame -- which the split does not
affect. The gap between windows is `2 × container_padding`, which the split is entirely
responsible for, so the desktop ran at **16px between windows against 8px at the frame**, a 2:1
mismatch nobody's test could see. Reported as "padding between windows are uneven" and confirmed
by pixel-scanning a screen row (wallpaper visible for 8px at the bar, 16px between window
borders), not from `komorebic state`. The two formulas:

```
gap at the frame    = workspace_padding + container_padding - thickness   (= G, split-independent)
gap between windows = 2 * container_padding                              (= all split)
```

`Set-FrameGeometry` now derives the split from **G**, not from P: `container = round(G/2)`,
`workspace = P - container`. Total padding is unchanged, so the offset and every zpack/CSS value
stay exactly as they were -- only the split moves, and no komorebi restart is needed. An odd G
cannot halve exactly, so the between-windows gap lands on the nearest even number; the summary
reports `InterWindowGap` and `-DryRun` prints both gaps side by side rather than letting a 1px
miss pass silently. **If you retune the frame, check both numbers, not just the frame gap.**

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

## The starship prompt, and one belief that was wrong for a long time

`scripts/Show-PromptCandidates.ps1` prints every candidate in
`state/prompt-candidates/` into a real terminal with real colour and the real font -- a prompt
rendered into a transcript loses the colour, and rendered as a PNG is not the terminal. Candidates
1-8 come from `scripts/build-prompt-candidates.mjs`, 9-10 (agnoster) from
`scripts/build-agnoster.mjs`. They are PREVIEW configs with the palette baked in as literal hex,
so they render truthfully **and must never be installed as-is** -- a literal palette stops
following the wallpaper. The chosen design gets ported into `matugen/templates/starship.toml`,
where the hex becomes `{{colors.*}}`. The script refuses `-Apply` and says exactly this.

**`cell_width = 0.9` does NOT clip powerline separators.** Candidates 1-8 were all designed under
the stated constraint that `~/.wezterm.lua`'s `cell_width = 0.9` squeezes `U+E0B0` into the
doubled chevrons the user once reported as "weird shapes on the arrows". That was **inferred and
never tested**. Tested at last by rendering agnoster in a real WezTerm at the live setting and
zooming in: the separators are clean solid triangles, no doubling, no seam. The earlier artifact
belonged to a different glyph -- the catppuccin-powerline preset also uses the ROUND caps
`U+E0B4`/`U+E0B6`, a different shape with a different cell fit. **`cell_width` does not need
changing and no design needs to avoid `U+E0B0`.** What IS wrong at 0.9 is agnoster's own git glyph
`U+E0A0`, which renders as a thin spindly mark; `U+F418` is the same icon drawn properly and is
verified present in CartographCF's cmap.

**Powerline arrows have one rule: every arrow must be drawn by a module that knows BOTH sides of
it**, because its colours are `fg = block on its left`, `bg = block on its right`. A closing arrow
placed in `[character]` breaks this -- starship has no conditional styling and no way to ask "did
that module render", so `[character]` cannot know which block came last, and the arrow came out in
the branch colour while sitting against the status block. Agnoster's git is therefore **one block
in one colour**, with the closing arrow owned by `git_status` (rendered unwrapped, so inside a repo
it always renders and is always last). Verify by dumping the raw escapes and checking each
`U+E0B0`'s preceding SGR pair, not by eye. A consequence worth accepting: outside a git repo no
closing arrow is drawn at all, which is a shorter silhouette but never a wrong colour. A second
consequence: agnoster's green-when-clean/yellow-when-dirty cannot be expressed at all, and the
two-block approximation that tried to was abandoned precisely because it made the closing arrow
undecidable.

## Pipeline flow

```
Switch-Wallpaper.ps1
  -> Get-WallpaperEngineExe          (which WE binary is actually running)
  -> Get-CurrentWallpaper            (regex-read WE's own config.json; getWallpaper CLI is dead)
  -> Resolve-PreviewImage            (preview.jpg -> preview.gif -> preview.png -> $null)
  -> Apply-Theme.ps1
       -> matugen image <preview> --mode dark --type <scheme> --prefer saturation --config matugen/config.toml
       -> renders the 4 live targets (wezterm, starship, cava, zebar) PLUS the non-target
          komorebi-colours.json into state/staging/ -- yasb/tacky-borders templates are no longer
          in matugen/config.toml, so nothing renders for them at all (see "The stack" above)
       -> Remove-Bom + Test-StagedFile on every staged TARGET file (pre-copy, structural, per-target)
       -> abort here if any target fails -- nothing live has been touched yet
       -> New-PreApplySnapshot: snapshot the CURRENTLY LIVE content of all 4 targets, PLUS
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
- **Capturing a UTF-8 program's stdout needs `[Console]::OutputEncoding` set to UTF-8 FIRST.**
  PowerShell 5.1 decodes a native program's output using `[Console]::OutputEncoding`, which
  defaults to the OEM code page (437/850 here), *not* UTF-8. Every multi-byte glyph then arrives
  shattered into its individual bytes reinterpreted as OEM characters. Confirmed at codepoint
  level against `starship prompt`: `U+F418 U+276F` (git branch, chevron) became
  `U+2229 U+00C9 U+00FF U+0393 U+00A5 U+00BB` — on screen, `∩Éÿ` and `Γ¥»`. **It looks exactly
  like a missing-font problem and is not one**: the bytes are already wrong before anything is
  asked to draw them, so no font, terminal or config change can fix it downstream. Set it, and
  restore it afterwards — it is the caller's console, not the script's.
- **`` `e `` is PowerShell 6+**, so ANSI escapes must be written `[char]27` here. A `` `e ``
  regex silently matches nothing rather than erroring, which reads as "the program emitted no
  colour".
- **Variable names are case-insensitive**: `$w` and `$W` are the same variable. A loop-local
  `$w` once overwrote an image width `$W` and produced an 18px-wide screenshot that looked like
  a rendering failure.

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
