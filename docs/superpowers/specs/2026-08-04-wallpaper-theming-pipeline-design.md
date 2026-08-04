# Wallpaper-Driven Theming Pipeline — Design

**Date:** 2026-08-04
**Status:** Approved, not yet implemented
**Scope:** Phase 1 of a Caelestia-inspired Windows desktop. Phase 2 (web control
panel) is deliberately excluded and gets its own spec.

## Purpose

Changing the wallpaper should re-theme the desktop. One command extracts a
Material You palette from the current Wallpaper Engine wallpaper and regenerates
the colors of the bar, window borders, terminal, and shell prompt.

This is the behavior [caelestia](https://github.com/caelestia-dots/caelestia)
has on Hyprland. Caelestia itself cannot be ported — its shell is Quickshell/QML
on Wayland — so this rebuilds the *behavior* from Windows-native parts.

## Current state

Inventory taken 2026-08-04. This machine already has most of a tiling setup.

| Component | State |
|---|---|
| komorebi | BSP, 9 workspaces, 5px gaps, animation EaseOutCubic/200ms/144fps, `border: false` |
| whkd | `~/.config/whkdrc`, Alt-based binds ported from GlazeWM |
| yasb | The bar. Own git repo at `~/.config/yasb` with `CLAUDE.md`, 14KB `config.yaml`, 27KB `styles.css` |
| tacky-borders | `~/.config/tacky-borders/config.yaml`, 4-stop gradients + komorebi stack/monocle/floating colors |
| WezTerm | `~/.wezterm.lua`, 14KB |
| starship | `~/.config/starship.toml`, 5.5KB |
| Wallpaper Engine | `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine`, workshop content present |
| Windhawk | Installed |
| Zebar | Installed but dormant — `settings.json` points at the stock `gunturdwiap.good-enough` pack, not the local `goodenoughedit` fork |
| Display | Single 2560×1440 |

Toolchains: **Node v22.16.0** present. **No Python, no Rust, no PowerShell 7**
(`whkdrc` correctly uses `powershell`, not `pwsh`).

Current theme is Catppuccin Mocha, hardcoded throughout `styles.css`. The
`theme.json` in the yasb repo is download metadata for the "Pillbox" theme, not
an indirection layer.

### Note on `~/.config/yasb/CLAUDE.md`

That file is stale. It states "Komorebi is **not installed**" and that GlazeWM
drives the bar. Since the komorebi migration both are wrong. Correcting it is in
scope for this work, because it will otherwise mislead.

## Goals

- One command: wallpaper changes, palette regenerates, four configs update, everything reloads.
- The same command re-themeable without changing wallpaper, for template iteration.
- A failed generate never leaves a broken desktop.
- Migrating 27KB of hand-tuned CSS provably loses nothing.

## Non-goals

- Light mode. Pinned to dark. Revisit later as a flag, not a design constraint.
- Windhawk / Notification Center theming. Its XAML lives in mod settings, not a
  templatable file; needs a different mechanism.
- Zebar. Dormant, and the local pack is a compiled Vite `dist/`.
- yasb `config.yaml` (widget layout). Only `styles.css` is templated.
- Keybinds. The scripts are the interface; binding them in `whkdrc` is a
  documented post-install step.

## Decisions

**Catppuccin Mocha is retired.** The full palette regenerates per wallpaper
rather than deriving only an accent. Chosen deliberately over the lower-risk
accent-only option.

**matugen, via `cargo install`.** No Windows binary is published — latest release
(v4.1.0) ships only a Linux tarball — so this requires installing the Rust
toolchain (~1.5GB) and building from source.

Chosen over Google's `@material/material-color-utilities` (npm, no new toolchain)
because matugen ships a templating engine with piping, conditionals, filters and
arithmetic. The four targets need alpha and lightness variants of the same role —
yasb's CSS is full of `rgba(17,17,27,0.8)` — and hand-rolling that filter layer
was estimated at 300–400 lines of engine to own and maintain.

Worth recording: matugen is not MCU. It wraps `material-colors`, a third-party
Rust port. Both implement the same algorithm; matugen is two hops from Google's
reference implementation.

**`setup` is a pipeline repo, not an umbrella dotfiles repo.** It holds the
engine, templates and scripts, and writes generated output into existing config
locations. `~/.config/yasb` keeps its own repo, history and `CLAUDE.md`. Nothing
moves, no symlinks, no Developer Mode requirement.

**Generated files stay tracked in their own repos.** `styles.css` is *not*
gitignored. If it were and a generate failed, there would be no stylesheet at
all. Tracked, every theme switch is a reviewable diff and git always holds a
working version. The template is the source of truth; the rendered file is a
committed artifact.

## Architecture

```
setup/
  matugen/
    config.toml              # template -> destination map
    mapping.json             # source color -> Material You role (see Migration)
    templates/
      yasb.styles.css
      tacky-borders.yaml
      palette.lua            # consumed by .wezterm.lua
      starship.toml
  scripts/
    Switch-Wallpaper.ps1     # advance wallpaper, then re-theme
    Apply-Theme.ps1          # re-theme current wallpaper only
    Get-ColorLiterals.ps1    # dev tool for the migration
  state/
    current.json             # last wallpaper path + seed color
    last-good/               # rollback copies of all four outputs
  CLAUDE.md
```

### Data flow

```
Switch-Wallpaper.ps1
   |
   +- preflight: WE running? matugen on PATH?
   |
   +- wallpaper64.exe -control nextWallpaper
   +- wallpaper64.exe -control getWallpaper   -> ...\431960\<id>\project.json
   +- resolve preview: preview.jpg -> preview.gif -> desktop screenshot
   |
   +- matugen image <preview> --config setup\matugen\config.toml --mode dark
   |     -> render to temp, not to live paths
   |
   +- per target: validate -> move into place -> reload
   |     ~/.config/yasb/styles.css          yasbc reload
   |     ~/.config/tacky-borders/config.yaml   (reload TBD - spike)
   |     ~/.config/palette.lua               (touch .wezterm.lua - spike)
   |     ~/.config/starship.toml             no reload needed
   |
   +- on success: write state/current.json (wallpaper path + seed color),
   |              refresh state/last-good/
   |
   +- on any failure: restore state/last-good, reload, report which target broke
```

`state/current.json` is what lets `Apply-Theme.ps1` re-render without asking
Wallpaper Engine again, and what a later UI reads to show the active palette.

`Apply-Theme.ps1` is the same flow minus the `nextWallpaper` step. Split out
because template iteration needs re-render without cycling wallpapers.

### Script interface

Both scripts take `-Wallpaper <path>`, `-Scheme <type>`, `-DryRun`. `-DryRun`
renders to temp and diffs against live, writing nothing.

`-Scheme` is matugen's *scheme type* (`tonal-spot`, `vibrant`, `expressive`,
`content`, `neutral`, `monochrome`, `rainbow`, `fruit-salad`) — not light/dark,
which is separately pinned to `--mode dark` per Non-goals.

## The migration

Migrating 27KB of `styles.css` is the main risk. `~/.config/yasb/CLAUDE.md`
documents failures that a hand-rewrite would reproduce: a BOM makes yasb refuse
the file with no useful error, icon glyphs vanish when passed through edit tools,
and a clean log does not mean the bar renders correctly.

So the migration is mechanical, with a hard gate:

1. **Inventory.** `Get-ColorLiterals.ps1` scans `styles.css` and reports every
   unique hex and `rgba()` literal with use counts. Expect roughly 25 unique
   values across ~600 uses.
2. **Map.** Each unique color is assigned a Material You role once, by hand, in
   `mapping.json`. ~25 decisions, not 600.
3. **Generate.** The template is produced by substitution from the mapping. No
   hand-editing of 27KB.
4. **Gate.** Render the template with the *Catppuccin* values injected back in
   and diff against the original `styles.css`. **Byte-identical, or stop.** Only
   after that passes does a wallpaper-derived palette go in.

Same procedure for `.wezterm.lua` and `starship.toml`, both far smaller.

### WezTerm integration

`.wezterm.lua` is not templated. It gains a guarded read of a generated file, so
the 14KB config stays hand-maintained:

```lua
local ok, p = pcall(dofile, os.getenv("USERPROFILE") .. "/.config/palette.lua")
if ok then
  config.colors = {
    background = p.surface,
    foreground = p.on_surface,
    cursor_bg  = p.primary,
    ansi = p.ansi, brights = p.brights,
  }
end
```

`pcall` means a missing or malformed palette leaves WezTerm on its built-in
colors rather than failing to start.

## Failure handling

**Nothing writes directly to a live config.** Render to temp, validate, move into
place. `state/last-good/` holds the last known-good copy of all four outputs plus
the palette JSON.

**Preflight aborts change nothing.** Wallpaper Engine not running, `matugen`
absent, or preview unresolvable → message and exit.

| Target | Validation |
|---|---|
| yasb | `yasbc reload`, wait ~8s, grep `yasb.log` for `error\|critical\|invalid\|could not be read` |
| tacky-borders | same pattern against `tacky-borders.log` |
| WezTerm | parse-check generated Lua before it lands |
| starship | render one prompt; non-zero exit = bad |

Any failure restores `last-good`, reloads, and reports the failing target.

**Encoding.** All writes go through
`[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`.
Never `Set-Content -Encoding UTF8`, which adds a BOM.

## Unknowns to resolve before building

These are cheap to test and none changes the architecture — only the last step of
the script.

1. **Does matugen emit a BOM?** Test first. If it does, the pipeline needs a
   strip step. This is the one unknown that could affect the design.
2. **Does WezTerm reload when a `dofile`'d include changes?** It watches
   `.wezterm.lua`; whether that extends to included files is unverified. Likely
   fix: a matugen hook that touches `.wezterm.lua`.
3. **How does tacky-borders reload?** It may watch its config or need a restart.
4. **Does `getWallpaper` return on stdout?** The CLI is documented as returning
   the path; the mechanism is not. Everything downstream depends on capturing it.
5. **Is `preview.jpg` present for all installed wallpapers?** Near-universal but
   not guaranteed; the fallback chain needs to be exercised.

## Out of scope: Phase 2

A local web control panel (`webui/`, Node, bound to `127.0.0.1`) with tabs for
Wallpaper, Palette, Layout and Bar. Separate spec, after this ships.

Carried forward as a constraint: the Bar tab writes yasb's `config.yaml`, which
fails silently in several documented ways. It will need surgical key-level edits
with validate-and-auto-revert, never a whole-file rewrite.

## References

- matugen — https://github.com/InioX/matugen
- Wallpaper Engine CLI — https://help.wallpaperengine.io/en/functionality/cli.html
- material-color-utilities — https://github.com/material-foundation/material-color-utilities
- komorebi — https://komorebi.lgug2z.com/
- caelestia — https://github.com/caelestia-dots/caelestia
