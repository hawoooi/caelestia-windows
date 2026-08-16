# WezTerm integration — untracked-file edits

`~/.wezterm.lua` is **not under version control** — the home directory is not a git repo. Task 6
made two changes there that the theming pipeline depends on, and Task 10's original submission
already applies both (verified live against the current file, 2026-08-05). If this file is ever
restored from a backup, rebuilt from scratch, or hand-reverted, the WezTerm leg of the pipeline
silently breaks with no trace of why unless someone finds this document. Reapply from here.

Both edits live in the same file, `C:\Users\PC\.wezterm.lua` (354 lines as of this writing).

**Task 9 note:** `Install-Config` (`scripts/Install-Config.ps1`) patches marker-delimited blocks
into a few user-owned dotfiles (currently `whkdrc`, for the two theming hotkeys), but `.wezterm.lua`
is deliberately **not** one of its `$targets`. Both edits below are already applied and live, and
re-patching a working 354-line config that this very session's terminal runs under -- just to prove
`Set-PatchedBlock` also works on it -- risks breaking that terminal for no real benefit. This
document is the manual-reapply path instead: if `.wezterm.lua` is ever restored from a backup,
rebuilt from scratch, or hand-reverted, redo sections 1 and 2 below by hand.

## 1. The generated-scheme block

Inserted **immediately after** `config.color_scheme = THEME` (line 99 in the current file). Exact
code, confirmed present verbatim in the live file (lines 101-115):

```lua
---------------------------------------------------------------------------------
-- Generated palette (matugen). Falls through to THEME when absent.
---------------------------------------------------------------------------------

local ok, p = pcall(dofile, os.getenv("USERPROFILE") .. "/.config/palette.lua")
if ok and p then
  config.color_schemes["Matugen"] = {
    background = p.surface,
    foreground = p.on_surface,
    cursor_bg  = p.primary,
    ansi       = p.ansi,
    brights    = p.brights,
  }
  config.color_scheme = "Matugen"
end
```

`~/.config/palette.lua` is written by `Apply-Theme.ps1` from `matugen/templates/palette.lua`
(this repo) on every successful theme apply; it does not exist until the pipeline has run at
least once. `pcall(dofile, ...)` means a missing or malformed palette file leaves WezTerm on the
static `THEME` scheme rather than failing to start — the `ok and p` guard only registers and
switches to the `"Matugen"` scheme when the file loaded successfully and returned a table.

## 2. The focus-handler fix

`.wezterm.lua` has a pre-existing "Dim when unfocused" feature (`window-focus-changed` handler,
around line 309 in the current file) that recomputes `overrides.colors` from a `scheme` local and
calls `window:set_config_overrides(overrides)` on every focus change. That local **must** read the
currently-active scheme, not the literal static theme name:

```lua
local scheme = config.color_schemes[config.color_scheme] or config.color_schemes[THEME]
```

confirmed present at line 279 in the live file, with this comment directly above it (lines 274-278):

```lua
-- Resolve whichever scheme is actually active (the generated "Matugen" scheme
-- when a palette loaded, THEME otherwise), NOT the literal THEME string --
-- the Matugen block above runs first and reassigns config.color_scheme, so
-- reading THEME unconditionally here would silently override the generated
-- palette's colors back to THEME on the first focus change.
```

**The wrong version** (what Task 6 originally shipped, and what a naive reapply might reintroduce)
is:

```lua
local scheme = config.color_schemes[THEME]
```

### Why this matters

`config.color_schemes[THEME]` reads the **literal** `THEME` string (`"Monokai Pro Octagon"` in the
current file) unconditionally — it ignores whether the generated-scheme block above ever switched
`config.color_scheme` to `"Matugen"`. `scheme` feeds `PALETTE_FULL`/`PALETTE_FADED`
(`palette(amount)`, computed once from `scheme.background`/`.foreground`/`.ansi`/`.brights`), which
the `window-focus-changed` handler assigns to `overrides.colors` on **every** focus change. Since
config overrides win over `config.color_scheme` regardless of which named scheme is nominally
active, the wrong version means: the window starts on the generated Matugen palette (because
`config.color_scheme = "Matugen"` took effect at load), but the **very first focus change** —
clicking into the window, alt-tabbing to it, anything — overwrites `overrides.colors` with colors
computed from the static `THEME` scheme instead, and the generated palette is gone for the rest of
that window's life.

This presents as **"theming randomly stopped working"** — the palette is visibly correct
immediately after a theme apply (because no focus change has happened yet), then reverts the
moment the user clicks anywhere, with no error, no log entry, and no obvious connection to the
"working correctly a second ago" theming pipeline. It is hard to diagnose after the fact precisely
because the failure is time-delayed and looks unrelated to the thing that actually caused it.

Verified fixed (Task 6, fix round 1): a spawned sandbox WezTerm window held the generated palette
across focused -> unfocused -> refocused screenshots, never reverting to `THEME`'s blue-gray.

## 3. Ordering constraint

**The generated-scheme block (item 1) must run *before* the `local scheme = ...` line (item 2).**
The fix in item 2 depends on `config.color_scheme` already holding its final value
(`"Matugen"` or still `THEME`) by the time that line executes — Lua runs the file top to bottom, so
the generated-scheme block's `config.color_scheme = "Matugen"` reassignment (or its absence, if the
palette file didn't load) must have already happened. In the current file this holds because the
generated-scheme block sits at lines 101-115 and the focus-handler's `scheme` local is at line 279,
well after. If either block is ever moved, re-verify this ordering by inspection — don't assume it.

## 4. Testing note — never write to the live palette path

**Never write a test palette to `~/.config/palette.lua`.** That is the live path the running
config reads via `dofile`, and `automatically_reload_config` defaults to `true` (not overridden
anywhere in this file) and watches `.wezterm.lua` itself — so any edit that touches `.wezterm.lua`
while a test palette sits at the live path will reload **every** WezTerm window pointed at the
default config, including the human's actual session, not just a throwaway test window. This
happened once already during Task 6: a red test palette briefly hijacked the live terminal
mid-task.

Use a sandboxed config instead (the method from Task 6 Step 4, reused and re-verified in fix round
1):

```powershell
$sandbox = "$env:TEMP\wezterm-t6"
New-Item -ItemType Directory -Force -Path $sandbox | Out-Null

# A copy of the real config, pointed at a sandboxed palette path instead of the live one.
$cfg = (Get-Content "$env:USERPROFILE\.wezterm.lua" -Raw).Replace(
  'os.getenv("USERPROFILE") .. "/.config/palette.lua"',
  '"' + ($sandbox -replace '\\','/') + '/palette.lua"')
[System.IO.File]::WriteAllText("$sandbox\wezterm.lua", $cfg, (New-Object System.Text.UTF8Encoding($false)))

# Confirm the substitution actually took effect before trusting it -- don't assume .Replace() matched.
Select-String -Path "$sandbox\wezterm.lua" -Pattern 'dofile'

@'
return {
  surface = "#ff0000", on_surface = "#00ff00", primary = "#0000ff",
  ansi = {"#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888"},
  brights = {"#999999","#aaaaaa","#bbbbbb","#cccccc","#dddddd","#eeeeee","#ffffff","#000000"},
}
'@ | Set-Content "$sandbox\palette.lua" -Encoding ascii

# Spawn a NEW, isolated window using ONLY the sandbox config.
& "C:\Program Files\WezTerm\wezterm-gui.exe" --config-file "$sandbox\wezterm.lua"
```

Verify with a screenshot of the spawned window (PowerShell `System.Drawing` `CopyFromScreen`), then
close that window and delete `$sandbox` when done. The real `~/.config/palette.lua` should only
ever be written by `Apply-Theme.ps1`, never by hand during testing.

## 5. Validation note — `show-keys` exit code is not reliable

`wezterm --config-file <path> show-keys` returns **exit 0 even on a broken config** — tested with a
deliberate syntax error (`return config config config +++`); it exited 0 with empty stderr and
silently fell back to WezTerm's bare built-in keybindings (no error surfaced anywhere, and the
file's own custom keybinding was missing from the output). Do not trust the exit code as a
correctness signal, and do not pipe the output through something like `Select-Object -First N`
either — that closes the native process's stdout pipe early and can itself produce a spurious
non-zero exit unrelated to config validity.

**The reliable check:** run `show-keys` unpiped/untruncated and grep its output for a known,
distinctive marker that only appears if the whole file executed successfully end-to-end — in this
file, the custom `EmitEvent("toggle-titlebar")` keybinding line. If the script fails to parse or
errors anywhere (including inside the `pcall`/`dofile` block from item 1), WezTerm silently reverts
to bare defaults and that marker disappears from the output. Its presence is a real, content-based
signal; the exit code alone is not.

```powershell
$out = & "C:\Program Files\WezTerm\wezterm.exe" --config-file "$env:USERPROFILE\.wezterm.lua" show-keys
$out -match 'toggle-titlebar'   # $true only if the full config actually executed
```

## 6. The PowerShell profile — the other untracked file in this path

`C:\Users\PC\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`. Untracked for the same
reason `~/.wezterm.lua` is: the home directory is not a git repo.

**Why it exists.** starship was a fully working theming target that nothing ever displayed. The
binary was installed (1.20.1, `C:\Program Files\starship\bin\starship.exe`, on PATH), the config at
`~/.config/starship.toml` was valid and was being regenerated from the wallpaper palette by every
`Apply-Theme` run — and there was **no profile at any of the four `$PROFILE` paths**, so
`starship init` never ran and the prompt was plain PowerShell. Reported as "starship isn't on".

Worth knowing for diagnosis: `starship prompt` renders the themed prompt on demand, so the config
being correct proves nothing about whether the shell is using it. The two failure modes look
identical from the config side. Check `Test-Path $PROFILE` (all four variants — `$PROFILE |
Get-Member -MemberType NoteProperty`) before touching the theme.

**Shape.** WezTerm launches `powershell.exe -NoLogo` (`config.default_prog`, no `-NoProfile`), so
this file loads. It initialises starship only for an interactive prompt, gated on the command line
not carrying `-Command`/`-File`/`-EncodedCommand`: `powershell.exe -File foo.ps1` also runs in
`ConsoleHost`, and would otherwise pay a starship process spawn per invocation to build a prompt
nobody sees. This repo's own scripts pass `-NoProfile` and never reach it, but not every caller
does. The gate fails in the harmless direction — a misread session gets a plain prompt.

It also pins `$env:STARSHIP_CONFIG` explicitly rather than relying on starship's default lookup, so
the prompt uses the file `Apply-Theme` actually writes.

**Verified end to end**, not just by rendering the config: `'prompt' | powershell.exe -NoLogo`
drives a real profile load with `-Command` absent, so the interactive branch genuinely runs, and
the output carries the themed SGR sequences. Written with the repo's usual no-BOM convention (byte
check: `23 20 50`, not `EF BB BF`).

**Glyphs.** The config uses Nerd Font powerline separators and icons; WezTerm's font is
`CartographCF Nerd Font`, so they render. A non-Nerd font here would show tofu, not a theming bug.

## 7. `starship config` opens an editor — never run it

It launches `$EDITOR` and blocks until the editor closes. Run against a machine with no `EDITOR`
set, it opened Notepad on the user's desktop and hung the session until the command timed out.
Use `starship prompt` / `starship explain` (both read-only and both print) or just read
`~/.config/starship.toml` directly. `EDITOR`, `VISUAL` and `git core.editor` are now all set to
`"C:\Program Files\Sublime Text\subl.exe" -w` — the `-w` matters, or the calling tool sees an
instant exit and an unedited file.

## 8. The starship template: glyphs must be `\uXXXX` escapes, and the font is Nerd Fonts **v2**

`matugen/templates/starship.toml` is the Catppuccin Powerline preset with the Catppuccin palette
swapped for matugen roles. Two things about it are easy to get wrong and both were, once.

**Raw private-use characters do not survive.** The previous version pasted the glyphs in literally,
and every character in the BMP private-use area (U+E000–U+F8FF) was gone by the time anyone looked:
the powerline separators had become empty `[]`, and the Windows, git-branch, clock and language
icons had vanished. Only the 4-byte Material Design glyphs and one U+2588 FULL BLOCK survived —
which is exactly why the prompt rendered as hard colour blocks with nothing between them. Reported
as "this looks too blocky"; the blocks were never the problem, the *missing transitions* were.

Every glyph is now a `\uXXXX` escape, which is plain ASCII and cannot be stripped that way. TOML
makes this workable: **basic** strings (`"..."`, `"""..."""`) support `\uXXXX`, **literal** strings
(`'...'`) do not. Two consequences:

- Anything carrying a glyph must be a basic string. `[time]`'s `format` was converted for this.
- Inside a basic string only `\b \t \n \f \r \" \ \uXXXX \UXXXXXXXX` are legal, so `\(` is a parse
  error. `[python]`'s format needs `\(` and `\)`, so it stays a **literal** string — it carries no
  glyph of its own, so it loses nothing.

`scripts/../tmp/escape.mjs`-style conversion is mechanical, but it must refuse to run if any
literal string contains a non-ASCII character, or the escape lands somewhere it will be read as six
characters.

**The font is a Nerd Fonts v2 build**, and the upstream preset assumes v3. `CartographCF Nerd Font`
(`~/.wezterm.lua`) puts Material Design Icons at U+F500–U+FD46; v3 puts them at U+F0001–U+F1AF0. So
the preset's OS symbols (U+F0548 for Ubuntu and friends), its Documents/Music/Developer directory
substitutions, and its `cmd_duration` icon are all **absent here** and would render as tofu. Those
were replaced with Font Awesome 4 codepoints (U+F000–U+F2E0), which both v2 and v3 carry.

Check a codepoint against the font's own `cmap` before using it — and then **render it and look**,
because presence proves nothing about what it draws. `U+F6E2` is the Font Awesome 6 ghost the bar
uses (`bar/entries/logo.js`) and it *is* in this font's cmap — where it draws the **Dropbox** logo,
because that codepoint falls inside v2's Material Design block.

**The ghost is U+F79F** (`nf-mdi-ghost`), so the prompt wears the same mark as the bar's top logo.
It was found by rendering the whole U+F500–U+FD46 range as a contact sheet and reading the
alphabetical order: it sits between `gender-transgender` (U+F79E) and `gift` (U+F7A0).

**Verifying the prompt.** `starship prompt` emits SGR truecolour sequences; reading them as text
cannot distinguish a rendered separator from a missing one. `tmp/RenderPrompt.ps1` parses
`38;2;r;g;b` / `48;2;r;g;b` and paints each run in the terminal's own font, producing an image of
what the terminal would actually show. Two PowerShell traps it hit, both silent:

- `` `e `` is PowerShell **6+**. On 5.1 the SGR regex matches nothing and the whole prompt arrives
  as one unstyled run — indistinguishable from starship emitting no colour. Use `[char]27`.
- PowerShell variable names are **case-insensitive**, so a loop-local `$w` overwrote the image
  width `$W`. The bitmap came out 18px wide, which also looks like "starship emitted nothing".
