# Spike findings - wallpaper-driven theming pipeline

Captured 2026-08-04 on this machine (branch `feat/theming-pipeline`). These answer the five
open unknowns from the design spec. Unknown #1 (matugen BOM behavior) is recorded in
`docs/matugen-reference.md` instead, since it's about matugen output format, not a pipeline spike.

## Unknown #2 - does WezTerm reload on an included file?

**Answer: WezTerm live-reloads the whole config when `.wezterm.lua` itself changes, on every
already-open window, with no restart needed - but it does NOT detect changes to a file that
`.wezterm.lua` only `dofile()`s. Touching `.wezterm.lua` is required.**

### Method

1. Created `~/.config/palette-probe.lua`: `return { surface = "#ff0000" }`.
2. Added a temporary block to `~/.wezterm.lua` (after `config.color_scheme = THEME`):

   ```lua
   local palette_probe = dofile(wezterm.home_dir .. "/.config/palette-probe.lua")
   wezterm.on("format-window-title", function()
     return "PROBE:" .. palette_probe.surface
   end)
   ```

   `palette_probe` is captured once, at config-load time, and deliberately *not* re-`dofile`'d
   inside the title callback - so the OS window title only changes when WezTerm actually reloads
   the whole config, not merely because the callback re-runs (it runs on every title-bar repaint
   regardless of reload state, so it had to reference an already-resolved value to be a valid
   signal).

3. **First attempt used `config.colors = { background = palette_probe.surface }` instead**,
   checking pixel color via a screenshot. This gave a false negative: this machine's
   `~/.wezterm.lua` already has an unfocused-window dimming feature
   (`wezterm.on("window-focus-changed", ...)` around line 293) that recomputes
   `overrides.colors` from the active color scheme and calls
   `window:set_config_overrides(overrides)` on every focus-changed event - which fires
   immediately on window creation/focus and unconditionally overwrites any static
   `config.colors` override. Screenshots repeatedly showed the unchanged theme background
   (`#282a3a`, confirmed by sampling pixel RGB via .NET `Bitmap.GetPixel`) even right after
   editing the file and even in a brand-new window, which looked like "reload isn't happening"
   but was actually "reload happened, then an unrelated focus handler immediately clobbered the
   color override." **This is a real trap for Task 9: any future runtime palette hook must not
   rely on a static `config.colors` table if this focus-changed handler survives; it needs to
   feed into `scheme`/`PALETTE_FULL`/`PALETTE_FADED` (computed at load time from
   `config.color_schemes[THEME]`) instead, or the focus handler will overwrite it on the very
   next focus change.** Switched to the window-title approach above, which isn't touched by that
   handler, to get a clean signal.

4. Also worth recording: this WezTerm build (`wezterm 20240203-110809-5046fc22`) has no `--reload`
   or config-reload CLI subcommand (`wezterm cli --help` / `wezterm --help` checked) - reload is
   only driven by the file watcher or the `ReloadConfiguration` key action.

### Results (window titles read via `Get-Process wezterm-gui | select MainWindowTitle`, no
screenshots needed once titles were used as the signal)

| Step | Action | Result |
|---|---|---|
| 1 | Added the probe block to `.wezterm.lua` (edit #1) | All 3 open windows (2 pre-existing, 1 freshly spawned to double-check) immediately showed title `PROBE:#ff0000` - confirmed live reload works on save, including on windows that were already running before the edit. |
| 2 | Edited **only** `palette-probe.lua`, changing `"#ff0000"` -> `"#00ff00"`; did **not** touch `.wezterm.lua` | Waited 20+ seconds. All windows still showed `PROBE:#ff0000` (stale). **No reload was triggered.** |
| 3 | Made a trivial edit to `.wezterm.lua` itself (changed one comment line) | Within ~5 seconds, all windows updated to `PROBE:#00ff00` - the new value from step 2 was picked up as soon as the main file was touched. |
| 4 | Restored `.wezterm.lua` from a pre-edit backup, removed `palette-probe.lua` | Titles reverted to their normal defaults (`powershell.exe` / actual tab title) within seconds - reconfirms live reload in both directions. |

### Implication for Task 9

The regenerated palette file (whatever Task 9 calls it, e.g. a WezTerm colors module written by
matugen) will **not** be picked up just by rewriting it. Task 9 must also touch/rewrite
`.wezterm.lua` itself (even a no-op rewrite of its existing bytes changes its mtime) as the last
step of every theme-apply run, or WezTerm will keep rendering the previous palette until the user
manually reloads (default keybinding) or the main file changes for an unrelated reason. A safe,
cheap way to do this without hand-editing the human's file: read `.wezterm.lua`, write the exact
same bytes back via `[System.IO.File]::WriteAllText(...)` (bumping mtime without changing
content), immediately after the palette include file is rewritten.

## Unknown #3 - tacky-borders reload mechanism: CLOSED AS N/A

tacky-borders **is not installed on this machine.** Verified 2026-08-04: its config and a 450KB
log exist at `~/.config/tacky-borders/`, but no executable is present in scoop, `Program Files`,
`Program Files (x86)`, or `LocalAppData`, and no process is running.

Consequences, already reflected in later tasks:

- Task 5 still builds the template - it only needs the existing `config.yaml` as a base, which is
  present. The template is ready if tacky-borders is reinstalled.
- Unknown #3 (reload mechanism) stays **unresolved**. Recorded as such here.
- Task 8's tacky-borders log check is **conditional** on the process running.

## Unknown #4 - does `getWallpaper` work, and what's the reliable current-wallpaper source?

`getWallpaper` **does not work.** Verified 2026-08-04 against both `wallpaper32.exe` and
`wallpaper64.exe`, with and without `-monitor 0`, and with stdout redirected to a file via
`Start-Process`. It returns empty every time.

**The replacement, verified working:** Wallpaper Engine's own `config.json` at
`C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\config.json`
is updated live and contains:

```
"wallpaperconfig" : {
    "selectedwallpapers" : {
        "<monitor-id>" : { "file" : "C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3441873795/scene.pkg" }
    }
}
```

The value is a wallpaper *asset* path (`scene.pkg`, or `project.json` for some types), and
`preview.jpg` sits in the same folder - so `Resolve-PreviewImage` works on it unchanged.

**Critical caveat:** PowerShell 5.1's `ConvertFrom-Json` **throws** on this file
(`Cannot process argument because the value of argument "name" is not valid` - the file contains
an empty or duplicate key). Do not use it. Extract with a regex instead; Task 9 specifies one.

Also recorded: the running process here is **`wallpaper32.exe`**, not `wallpaper64.exe`. Both
exist on disk. Task 9 detects which is live at runtime rather than hardcoding.

## Unknown #5 - preview image coverage

Checked every wallpaper directory under
`C:\Program Files (x86)\Steam\steamapps\workshop\content\431960`:

```
total=57 jpg=15 gif=40
```

- 15 of 57 wallpapers (26%) have `preview.jpg` directly.
- 40 of 57 (70%) have only `preview.gif` (no `preview.jpg`).
- **2 of 57 (4%) have neither** `preview.jpg` nor `preview.gif`:
  - `2589058527` - contains only a `debug.log`, no scene/project asset files at all. Looks like a
    broken/incomplete Workshop download.
  - `3625569802` - completely empty directory.

### Implication for later tasks

`Resolve-PreviewImage` (or whatever step turns a wallpaper asset path into a probe image for
matugen) **cannot assume `preview.jpg` exists**. The large `.gif`-only population (70%) means the
resolver needs an explicit `preview.jpg` -> `preview.gif` fallback (matugen's `image` subcommand
needs a static raster it can decode - confirm at implementation time whether matugen can decode
GIF directly via its `image` crate dependency (v0.25.10, which does support GIF), or whether the
first frame needs to be extracted first). And it must have a final fallback (skip theming /
report an error / use the last-known-good palette) for the 2 directories with no preview asset at
all, otherwise the pipeline breaks outright when the user happens to have one of those two
wallpapers selected.
