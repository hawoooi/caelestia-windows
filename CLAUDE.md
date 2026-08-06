# Wallpaper-driven theming pipeline — working knowledge

One command extracts a Material You palette from the current Wallpaper Engine wallpaper and
regenerates the colors of WezTerm, starship, the Zebar sidebar, and komorebi's own window-border
colours. yasb and tacky-borders were **retired** as theming targets (see "Retiring yasb" below) --
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
| color mapping | `matugen/mapping.json` (this repo) — keyed by normalized Catppuccin literal, each value an `{ "expression": "<matugen expr>" }`. Historical: this mapping was built for `yasb.styles.css`, which is no longer a rendered/live target (see "Retiring yasb"); kept for the recovery procedure below. |
| yasb (v2.0.5) | `C:\Program Files\yasb\yasbc.exe`, config at `~/.config/yasb/` (its own git repo) — **retired as a theming target** (see "Retiring yasb"). Still installed on disk; its process is no longer expected to be running, and `~/.config/yasb/` is never written to by this pipeline. |
| tacky-borders | config + log at `~/.config/tacky-borders/`, **not installed as an executable on this machine** (Task 1 finding, unchanged through Task 10) and **retired as a theming target** on top of that — komorebi's own borders replaced the job this template was built for. The template (`matugen/templates/tacky-borders.yaml`) is kept on disk, unwired from `matugen/config.toml` and from `$script:Targets`, in case it's ever wanted again. |
| WezTerm | `C:\Program Files\WezTerm\wezterm.exe` — config at `~/.wezterm.lua`, **not under version control** (home directory is not a git repo); the pipeline's two required edits there are recorded in `docs/wezterm-integration.md` because of this |
| starship | config at `~/.config/starship.toml` |
| Wallpaper Engine | `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\` — `wallpaper32.exe` or `wallpaper64.exe` (whichever is the live process; both exist on disk, this machine runs `wallpaper32.exe`) |
| Zebar (v3.3.1) | `C:\Program Files\glzr.io\Zebar\zebar.exe` — a vertical Caelestia-style bar docked left, and (since yasb's retirement) the **only** bar on the desktop. Pack source tracked at `zebar/caelestia/`, served to Zebar via a junction at `~/.glzr/zebar/caelestia`. Full detail: `docs/zebar-bar.md`. |
| komorebi + whkd | `~/komorebi.json`, `~/.config/whkdrc` — the tiling WM driving the desktop (GlazeWM was replaced during this project's pre-flight; see `~/.config/yasb/CLAUDE.md`). Since the borders/yasb-retirement task, komorebi.json also carries `border: true`, `border_style: "Rounded"`, `border_width: 4`, `border_offset: 1`, increased `default_workspace_padding`/`default_container_padding` (12/12, up from 5/5), and a themed `border_colours` object -- see "Window borders and gaps" below. |
| Pester | 6.0.1 and 3.4.0 are both installed; **all tests in this repo are Pester 5+ syntax** (`Should -Be`, not `Should Be`) — `Import-Module Pester -MinimumVersion 5.0.0` before running the suite, or 3.4.0 loads by default and every test errors on syntax it doesn't recognize |

## Window borders and gaps

komorebi has a full border CLI (`komorebic border enable|disable`, `border-style`, `border-width`,
`border-offset`, `border-colour <R> <G> <B> --window-kind <kind>` -- **RGB integers, not hex**).
`~/komorebi.json` was hand-edited (surgically -- parsed, mutated, re-serialized, never rewritten
wholesale, preserving all 20 `ignore_rules` entries and every other key) to turn this on
persistently: `border: true`, `border_style: "Rounded"`, `border_width: 4`, `border_offset: 1`,
`default_workspace_padding`/`default_container_padding` raised from 5 to 12. Applied live via
`komorebic stop` + `komorebic start` (config is read at startup, not hot-reloaded).

`Apply-Theme` now also themes the border colours every run, via `Update-KomorebiBorderTheme`
(`scripts/Apply-Theme.ps1`):

- matugen renders `matugen/templates/komorebi-colours.json` -> `state/staging/komorebi-colours.json`
  (`[templates.komorebi]` in `matugen/config.toml`) -- **not** one of `$script:Targets` (no live
  config of its own to copy/validate/roll back; it exists purely to hand this step hex values
  without a second matugen invocation).
- Role mapping: `single` (focused window) -> `primary`, `stack` -> `tertiary`, `monocle` ->
  `secondary`, `unfocused` -> `outline`, `floating` -> `error`. `unfocused_locked` is intentionally
  left unmapped (komorebi's own default).
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
          in matugen/config.toml, so nothing renders for them at all (see "Retiring yasb")
       -> Remove-Bom + Test-StagedFile on every staged TARGET file (pre-copy, structural, per-target)
       -> abort here if any target fails -- nothing live has been touched yet
       -> New-PreApplySnapshot: snapshot the CURRENTLY LIVE content of all 3 targets into
          state/pre-apply/ (a directory SEPARATE from state/last-good/ -- see below)
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
