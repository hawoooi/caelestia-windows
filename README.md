# Wallpaper-driven theming pipeline

Extracts a Material You palette from the current Wallpaper Engine wallpaper and regenerates the
colors of yasb, tacky-borders (if installed), WezTerm and starship from it — one command, no
per-app manual re-theming.

See `CLAUDE.md` for the full architecture, the PowerShell/BOM constraints, and how to add a new
theme target.

## Prerequisites

- **Windows PowerShell 5.1** (the version that ships with Windows — no PowerShell 7 install
  required or expected; the scripts are written against 5.1's syntax limits).
- **Rust toolchain + matugen**, installed via:
  ```powershell
  Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
  & "$env:TEMP\rustup-init.exe" -y --default-toolchain stable --profile minimal
  cargo install matugen
  ```
  matugen is installed to `~/.cargo/bin/matugen.exe`, which is not guaranteed to be on `PATH` in
  every shell — `scripts/Apply-Theme.ps1` adds it defensively if missing.
- **Wallpaper Engine running**, with a wallpaper selected. `Switch-Wallpaper` reads the current
  wallpaper from Wallpaper Engine's own `config.json` and needs the app's process alive to detect
  which binary (`wallpaper32.exe`/`wallpaper64.exe`) to drive.
- **Pester 5+** for the test suite (`Import-Module Pester -MinimumVersion 5.0.0` — this machine
  also has 3.4.0 installed, whose syntax the tests don't use).

## Commands

```powershell
# Theme from an explicit image, without touching the desktop wallpaper.
. .\scripts\Apply-Theme.ps1
Apply-Theme -Image "C:\path\to\some-image.jpg"

# Advance (or set) the actual wallpaper via Wallpaper Engine, then theme from it.
. .\scripts\Switch-Wallpaper.ps1
Switch-Wallpaper
```

Both accept `-DryRun` (renders and validates to `state/staging/`, copies nothing to a live
config) and `-Scheme <matugen-scheme-name>` (default `scheme-tonal-spot`). For `Switch-Wallpaper`,
`-DryRun` also does not touch Wallpaper Engine at all -- it does not advance or set the wallpaper,
and themes from whichever wallpaper is already current.

## Keybinds

**No keybinding is wired up yet.** `~/.config/whkdrc` (the komorebi hotkey daemon config on this
machine) has these keys free, confirmed by inspection of the current bindings:

- `alt + w` — free
- `ctrl + alt + w` — free

`alt + shift + w` is **already bound** to `komorebic retile` — do not reuse it for theming.

To wire one up, add a line to `~/.config/whkdrc` invoking a PowerShell command that dot-sources
and calls `Switch-Wallpaper`, then reload komorebi/whkd's config.

## Portability (M4)

**This repo is not relocatable as-is.** `matugen/config.toml` hardcodes every template's
`input_path`/`output_path` as an absolute Windows path
(`C:\Users\PC\Documents\git\setup\matugen\templates\...` /
`...\state\staging\...`) rather than anything relative to the config file's own location or the
current working directory. Cloning this repo to a different path, or onto a different machine
under a different username, means every `input_path`/`output_path` in `matugen/config.toml` needs
hand-editing to match before `Apply-Theme` will render correctly — matugen v4.1 has no documented
repo-relative or CWD-relative path substitution for `[templates.*]` entries (see
`docs/matugen-reference.md` for what its `[config]`/`[templates.*]` schema does support). Not
fixed here; recorded so a future move/clone isn't surprised by silent path failures.
