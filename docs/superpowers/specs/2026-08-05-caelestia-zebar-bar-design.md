# Caelestia-style Zebar Bar — Design

**Date:** 2026-08-05
**Status:** Approved, not yet implemented
**Depends on:** the wallpaper theming pipeline (merged, `main`)

## Purpose

Replace yasb with a docked vertical bar in Zebar that reproduces
[caelestia-dots/shell](https://github.com/caelestia-dots/shell)'s bar, and prove the
morphing interaction that gives Caelestia its character.

This is phase 1 of a larger shell. Dashboard, launcher, sidebar, OSDs and
notifications are explicitly out of scope and get their own specs.

## Why yasb cannot do this

Verified against the installed build (`C:\Program Files\yasb\lib\library.zip`,
`core/validation/bar.pyc`): the accepted values for bar position are **`top`** and
**`bottom`** only. There is no left/right option, so a vertical bar is impossible.

Two further blockers: yasb styles with Qt Style Sheets, which support neither
transitions/keyframes (so nothing morphs) nor text rotation (so a vertical bar
could not render a readable window title).

Zebar renders in a native WebView2 — measured at **Chromium 151** on this machine —
so it has real CSS, the View Transitions API (111+), `linear()` easing and
`@property` (113+).

## Current state

| Thing | State |
|---|---|
| Zebar | Installed at `C:\Program Files\glzr.io\Zebar\`, currently dormant |
| Existing pack | `~/.glzr/zebar/goodenoughedit` — a compiled Vite `dist/`, **not** themeable |
| `settings.json` | `startupConfigs` points at the stock `gunturdwiap.good-enough`, not the local fork |
| yasb | Running, 13 widgets, themed by the pipeline |
| Theming pipeline | Merged to `main`; 4 targets, 72 tests, hotkeys bound |

**Zebar providers** (confirmed): audio, battery, cpu, date, disk, glazewm, host, ip,
keyboard, komorebi, media, memory, network, systray, weather. There is **no gpu
provider** and **no notifications provider**.

**`zpack.json` capabilities** (read from the local pack's schema): presets support
`anchor`, `offsetX/Y`, `width`, `height`, `monitorSelection`, `zOrder`, `transparent`,
`shownInTaskbar`, `focused`, `resizable`, **`dockToEdge`** (reserves screen space) and
**`privileges.shellCommands`**.

## What Caelestia's bar actually is

Read from
[`modules/bar/Bar.qml`](https://github.com/caelestia-dots/shell/blob/main/modules/bar/Bar.qml),
not inferred from screenshots:

- A vertical `ColumnLayout` with **uniform spacing** from design tokens
  (`Tokens.spacing.medium`), all entries centred horizontally
- Entries are **config-driven**, resolved through a `Repeater` + `DelegateChooser`
- Entry types include: spacer (flexible fill), logo, workspaces, active window,
  system tray, clock, status icons, power button
- The **spacer** creates top/middle/bottom grouping — there are no fixed regions
- `vPadding` from `Tokens.padding.large`; first and last entries carry margins
- The bar handles hover (driving popouts, which live in a separate `popouts/`
  directory) and scroll

It is **one continuous surface**, not a row of bordered chips. Rounded containers
appear only where something is grouped or active.

## Goals

- A docked vertical bar reproducing Caelestia's entry model and spacing
- Colours follow the wallpaper via the existing pipeline, with no new migration risk
- One morphing interaction (the media player) proving the fluid feel is reachable
- A script that installs every piece of untracked live config, idempotently
- yasb keeps running throughout — no window where the user has no bar

## Non-goals

- **Light mode.** Staying dark. Caelestia ships dark variants; the reference
  screenshot merely happened to be light. Avoids re-validating every contrast pair.
- **Scroll-to-adjust.** Caelestia scrolls the bar to change volume/brightness/
  workspace. Deferred by choice.
- **Dashboard, launcher, sidebar, OSDs, notifications.** Separate specs.
- **Taskbar theming and auto-hide.** Its own spec, after this one. Findings recorded
  under "Future phases" below.
- **Rendering application icons in the tray entry.** Confirmed unnecessary — Caelestia's
  demo does not show them on the vertical bar.
- **GPU, CPU, memory, disk, traffic entries.** Dropped with yasb. No gpu provider
  exists, and Caelestia's bar does not show system stats.
- **Retiring yasb in this phase.** Coexistence only; retirement is a later step.

## Decisions

**Plain HTML/CSS/JS, no build step.** Not for simplicity — for themeability. The
existing `goodenoughedit` pack is a compiled Vite `dist/` with CSS inlined into hashed
assets, which matugen cannot write into. Any bundled pack recreates the exact problem
that has kept Zebar unusable for theming.

**Colour lives only in a generated file.** matugen renders `theme.css` containing
nothing but custom properties. `style.css` is hand-written, tracked, and contains zero
colour literals — only `var(--…)` references.

This is a materially better position than yasb: there is no hand-tuned stylesheet to
migrate, no literal inventory, no mapping file, and **no round-trip gate needed**,
because layout and colour never share a file. Task 4's migration risk simply does not
exist here. The rest of the pipeline (staging, structural validation, rollback,
`last-good` rotation) applies unchanged.

**Config-driven entries**, mirroring `Bar.qml`'s `DelegateChooser`. Reordering is a
config edit, and `spacer` gets real semantics (`flex: 1`) rather than being a
hardcoded gap.

**Authored in the repo, junctioned into place.** Zebar only loads from
`~/.glzr/zebar/`. A directory junction gives live editing plus git tracking with no
sync step, and junctions do not require admin on Windows (unlike symlinks).

## Architecture

```
setup/zebar/caelestia/
  zpack.json
  bar/
    index.html
    style.css          # layout + tokens. Tracked. ZERO colours
    theme.css          # GENERATED by matugen. Custom properties only
    bar.js             # reads bar.config.json, renders entries
    bar.config.json    # the ordered entry list
    entries/           # one module per entry type
      logo.js  workspaces.js  activeWindow.js  media.js
      spacer.js  vesktop.js  tray.js  clock.js  statusIcons.js  power.js
scripts/
  Install-Config.ps1   # installs untracked live config, idempotently
```

`~/.glzr/zebar/caelestia` → directory junction → `setup/zebar/caelestia`.

### Geometry

```json
{ "anchor": "top_left", "width": "52px", "height": "100%",
  "transparent": true, "zOrder": "normal",
  "dockToEdge": { "enabled": true, "edge": "left", "windowMargin": "0px" } }
```

`dockToEdge` reserves the strip so komorebi tiles around it automatically — the same
mechanism that made yasb's top strip work once it re-registered its AppBar. No manual
`work_area_offset` needed.

### Tokens

In `style.css`, mirroring Caelestia's `Tokens.*`:

```css
:root {
  --space-sm: 4px;  --space-md: 8px;  --space-lg: 14px;
  --pad-lg: 12px;
  --radius-sm: 8px; --radius-lg: 18px; --radius-full: 999px;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --dur: 300ms;
}
```

Uniform `--space-md` between entries; `--pad-lg` at top and bottom.

### Entries

`bar.config.json`:

```json
{ "entries": ["logo", "workspaces", "activeWindow", "media",
              "spacer", "vesktop", "clock", "statusIcons", "power"] }
```

| Entry | Source | Notes |
|---|---|---|
| `logo` | static | Windows or custom glyph |
| `workspaces` | komorebi provider | active gets a filled rounded container |
| `activeWindow` | komorebi provider (see spike 2) | rotated, `writing-mode: vertical-rl` |
| `media` | media provider | rotated title/artist; click morphs open |
| `spacer` | — | `flex: 1` |
| `vesktop` | shellCommands → existing `vesktop-unread.exe` | **reused, not rewritten** |
| `clock` | date provider | stacked, hours over minutes |
| `statusIcons` | audio + network + battery | status-icon cluster. **Not** a general systray host — see unknown 1. Absorbs what was originally a separate `tray` entry |
| `power` | shellCommands | confirms before acting |

The Vesktop helper is reused as-is. Its hard part — reading Vesktop's window title via
`EnumWindows`, because `MainWindowTitle` goes blank once minimised to tray — is already
built, tested and documented in `~/.config/yasb/CLAUDE.md`.

### The media morph

```js
if (document.startViewTransition) {
  document.startViewTransition(() => bar.classList.toggle('media-open'));
} else {
  bar.classList.toggle('media-open');   // snaps; nothing breaks
}
```

`view-transition-name` on the media element lets the browser interpolate position,
size and border-radius automatically. The fallback path matters because a missing API
must degrade, not fail.

### `Install-Config.ps1`

Two mechanisms, because the targets differ in kind.

**Managed** — the repo owns the whole thing:

| Target | Action |
|---|---|
| `~/.glzr/zebar/caelestia` | directory junction → `setup/zebar/caelestia` |

**Patched** — the file belongs to the user; the repo owns a delimited block inside it:

```
# >>> caelestia-shell >>>
…
# <<< caelestia-shell <<<
```

| Target | Block |
|---|---|
| `~/.config/whkdrc` | the two theming hotkeys |
| `~/.wezterm.lua` | generated-scheme block + focus-handler fix |
| `~/.glzr/zebar/settings.json` | `startupConfigs` entry for our pack |

Behaviour: **idempotent** (re-running changes nothing), backs up to
`state/config-backup/<timestamp>/` before any write, `-DryRun` prints a diff and writes
nothing, `-Uninstall` strips the marked blocks and restores, and every write is
verified afterward.

Marker-based patching is what makes `.wezterm.lua` tractable: its focus-handler fix is
a one-line edit *inside* a 354-line file the user maintains. A file copy could never
reapply that; markers can. The comment prefix differs per format (`#` for whkdrc,
`--` for Lua, and `settings.json` needs structural JSON editing rather than markers).

## Theming integration

The pipeline gains a fifth target:

- `matugen/config.toml` gains a `[templates.zebar]` entry rendering
  `templates/zebar.theme.css` → `state/staging/theme.css`
- `Apply-Theme`'s `$script:Targets` gains a fifth row, so the staged file is validated,
  snapshotted into `state/pre-apply/`, copied to
  `setup/zebar/caelestia/bar/theme.css`, and covered by `last-good` rotation like every
  other target
- `Test-StagedFile` gains a `zebar` branch: balanced braces, no unresolved `{{`, and
  every declaration a custom property

**Reload:** pending unknown #4. If Zebar hot-reloads CSS on change, no reload step is
needed. If it does not, `Apply-Theme` gains a Zebar reload for this target — the same
shape as the `yasbc reload` call, and the same shape as touching `.wezterm.lua`.

Role choices reuse Task 4's validated pairings: `surface`/`on_surface` for the bar,
`primary`/`on_primary` for active/accent elements, `outline` for separators. Contrast
is already proven for these across four wallpapers.

## yasb coexistence

**Not a cutover.** Zebar docks left, yasb stays at top. komorebi tiles around both.
The vertical bar can be incomplete for as long as needed.

If the Zebar pack fails to load, yasb is still running — that is the rollback.

Retirement is a later, separate step: stop yasb, remove its `startup_commands` entry,
then drop its pipeline target. Its config repo stays untouched throughout.

## Unknowns

Front-loaded, as Task 1 was, because each could change the design. Two are already
settled by the user.

**1. Systray rendering model — RESOLVED, no longer a risk.**
The bar does **not** need to render application icons. Caelestia's own demo does not
show them on the vertical bar. The `tray` entry is therefore a small status-icon
cluster, not a general systray host. This removes the only unknown that had no clean
fallback.

**2. Does the komorebi provider expose the focused window title? — OPEN, fallback confirmed.**
The user confirms yasb displays the active window title, which proves the data is
obtainable on this machine. Note this does **not** confirm the komorebi provider
supplies it — yasb uses its own Win32-based `active_window` widget, a different source.
So the spike still runs, but the fallback (`EnumWindows`, the same technique the
Vesktop helper uses) is known to work.

**3. Does `dockToEdge` reserve space that komorebi respects? — OPEN.**
Documented in the pack schema, unverified here. Fallback: a manual `work_area_offset`
in `komorebi.json`.

**4. Does Zebar hot-reload `theme.css` on change? — OPEN.**
Determines whether `Apply-Theme` needs a reload step for this target.

**5. Vesktop indicator — APPROACH SETTLED.**
Use the same mechanism yasb uses: poll the existing `vesktop-unread.exe` helper, here
via `privileges.shellCommands`. The helper is proven; only the polling wiring is new.

## Future phases (recorded, not in scope)

### Taskbar theming and auto-hide

Researched 2026-08-05; kept here so the findings are not lost. **Its own spec, after
this one.**

Both Windhawk stylers are **already installed** (`windows-11-taskbar-styler_1.8`,
`windows-11-start-menu-styler_1.6`). The taskbar styler's settings are scriptable
registry values under
`HKLM\SOFTWARE\Windhawk\Engine\Mods\windows-11-taskbar-styler\Settings`:
`theme` (currently empty), `styleConstants[N]`, `controlStyles[N].target`,
`controlStyles[N].styles[M]`, `themeResourceVariables[N]`. Indexed strings a script can
write palette colours into.

**The unsolved constraint: `HKLM` requires admin**, and this pipeline runs unelevated.
A wallpaper switch cannot update the taskbar without a UAC prompt each time. Three
candidate routes: loosen the ACL on that one key once (cleanest); a scheduled task
registered with highest privileges; or apply the taskbar theme once, manually, giving
up on it following the wallpaper.

Slide in/out is nearly free — Windows' native auto-hide already slides the taskbar; it
is a settings toggle, with Windhawk able to tune reveal behaviour on top.

This is deliberately kept out of the present spec: it is a different subsystem
(registry rather than files), shares no code with the bar, and carries an unsolved
elevation problem that would otherwise sit on the critical path of work that has none.

## Out of scope, recorded

Dashboard, launcher, sidebar, OSDs, notifications, scroll-to-adjust, light mode,
system-stat entries, GPU, and retiring yasb. Each is a later spec or a deliberate drop.

## References

- Caelestia shell — https://github.com/caelestia-dots/shell
- `Bar.qml` — https://github.com/caelestia-dots/shell/blob/main/modules/bar/Bar.qml
- Zebar — https://github.com/glzr-io/zebar
- View Transitions API — https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
- Existing pipeline spec — `docs/superpowers/specs/2026-08-04-wallpaper-theming-pipeline-design.md`
