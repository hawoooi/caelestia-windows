# Wallpaper-Driven Theming Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command extracts a Material You palette from the current Wallpaper Engine wallpaper and regenerates the colors of yasb, tacky-borders, WezTerm and starship.

**Architecture:** PowerShell scripts orchestrate matugen. matugen renders four templates from a wallpaper-derived palette into temp files; the scripts validate each, move them into their live locations, reload the consuming app, and roll back on failure. The 27KB `styles.css` is converted to a template mechanically and gated on a byte-identical round-trip.

**Tech Stack:** Windows PowerShell 5.1, matugen (Rust), Pester 5, Wallpaper Engine CLI, git.

**Spec:** `docs/superpowers/specs/2026-08-04-wallpaper-theming-pipeline-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Windows PowerShell 5.1 only.** PowerShell 7 is not installed. No `&&`, no `||`, no ternary, no `??`. Use `;` and `if ($?) { }`.
- **All file writes use:** `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`. **Never** `Set-Content -Encoding UTF8` or `Out-File` — they emit a BOM, and a BOM makes yasb refuse the file with only "could not be read" in the log.
- **Never write directly to a live config.** Render to temp, validate, then move.
- **Dark mode is pinned.** matugen always runs with `--mode dark`.
- **Generated files stay tracked** in their own repos. Do not add `styles.css` to any `.gitignore`.
- **yasb reload:** `& "C:\Program Files\yasb\yasbc.exe" reload`, then wait ~8 seconds before checking `~/.config/yasb/yasb.log`.
- **matugen template syntax:** the examples in this plan use the documented v4 syntax (`{{colors.primary.default.hex}}`, `{{colors.surface.default.rgba | set_alpha: 0.8}}`). matugen v4 replaced the older Tera engine with a custom one. **Task 1 captures ground truth from the installed binary into `docs/matugen-reference.md`. If it disagrees with this plan, the reference file wins** — correct the template syntax in later tasks accordingly.
- **Commit after every task.**

---

### Task 1: Toolchain and spike findings

Resolves the five unknowns from the spec. Unknown #1 (BOM) can change the design, so nothing else starts until this lands.

**Files:**
- Create: `docs/matugen-reference.md`
- Create: `docs/spikes.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/matugen-reference.md` (authoritative role names, scheme names, format names, filter syntax, BOM behavior) and `docs/spikes.md` (answers to unknowns 2–5). Every later task reads the reference file before writing a template.

- [ ] **Step 1: Install the Rust toolchain**

```powershell
Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
& "$env:TEMP\rustup-init.exe" -y --default-toolchain stable --profile minimal
```

Then open a new shell so `PATH` picks up `~/.cargo/bin`.

- [ ] **Step 2: Verify Rust, then install matugen**

```powershell
cargo --version
cargo install matugen
matugen --version
```

Expected: a version at or above 4.1.0. This build takes several minutes.

- [ ] **Step 3: Install Pester 5**

The system ships Pester 3.4.0, whose syntax differs from Pester 5 (`Should Be` vs `Should -Be`). All tests in this plan are Pester 5.

```powershell
Install-Module Pester -MinimumVersion 5.0.0 -Scope CurrentUser -Force -SkipPublisherCheck
Import-Module Pester -MinimumVersion 5.0.0
(Get-Module Pester).Version
```

Expected: 5.x.

- [ ] **Step 4: Capture matugen's real role list and syntax**

Pick any wallpaper preview as a probe image and dump the palette as JSON:

```powershell
$probe = Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960" -Recurse -Filter "preview.jpg" | Select-Object -First 1 -ExpandProperty FullName
matugen image $probe --mode dark --json hex | Out-File "$env:TEMP\palette-probe.json"
matugen --help
```

Record in `docs/matugen-reference.md`: every role name that appears in the JSON, the accepted `--json` format values, the scheme-type values `--help` lists, and the exact filter syntax for alpha. Note whether the installed version uses `{{ }}` with `| filter: arg` or something else.

- [ ] **Step 5: Answer Unknown #1 — does matugen emit a BOM?**

```powershell
"body: {{colors.primary.default.hex}}" | Set-Content "$env:TEMP\bomtest.tmpl" -Encoding ascii
@"
[templates.bomtest]
input_path = '$env:TEMP\bomtest.tmpl'
output_path = '$env:TEMP\bomtest.out'
"@ | Set-Content "$env:TEMP\bomtest.toml" -Encoding ascii

matugen image $probe --mode dark --config "$env:TEMP\bomtest.toml"

$bytes = [System.IO.File]::ReadAllBytes("$env:TEMP\bomtest.out")
"First 3 bytes: {0:X2} {1:X2} {2:X2}" -f $bytes[0], $bytes[1], $bytes[2]
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { "BOM PRESENT - pipeline needs a strip step" } else { "No BOM" }
```

Record the result in `docs/matugen-reference.md`. **If a BOM is present, Task 8 must strip it before the yasb file is moved into place.**

- [ ] **Step 6: Record Unknown #4 — RESOLVED IN PRE-FLIGHT, do not re-investigate**

`getWallpaper` **does not work.** Verified 2026-08-04 against both `wallpaper32.exe` and `wallpaper64.exe`, with and without `-monitor 0`, and with stdout redirected to a file via `Start-Process`. It returns empty every time.

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

The value is a wallpaper *asset* path (`scene.pkg`, or `project.json` for some types), and `preview.jpg` sits in the same folder — so `Resolve-PreviewImage` works on it unchanged.

**Critical caveat:** PowerShell 5.1's `ConvertFrom-Json` **throws** on this file (`Cannot process argument because the value of argument "name" is not valid` — the file contains an empty or duplicate key). Do not use it. Extract with a regex instead; Task 9 specifies one.

Also record: the running process here is **`wallpaper32.exe`**, not `wallpaper64.exe`. Both exist on disk. Task 9 detects which is live at runtime rather than hardcoding.

Copy this finding into `docs/spikes.md` verbatim. No investigation needed.

- [ ] **Step 7: Answer Unknown #5 — preview image coverage**

```powershell
$root = "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960"
$dirs = Get-ChildItem $root -Directory
$withJpg = ($dirs | Where-Object { Test-Path (Join-Path $_.FullName "preview.jpg") }).Count
$withGif = ($dirs | Where-Object { Test-Path (Join-Path $_.FullName "preview.gif") }).Count
"total=$($dirs.Count) jpg=$withJpg gif=$withGif"
$dirs | Where-Object { -not (Test-Path (Join-Path $_.FullName "preview.jpg")) } | Select-Object -ExpandProperty Name
```

Record the counts and list any wallpapers with no `preview.jpg`.

- [ ] **Step 8: Record Unknown #3 — CLOSED AS N/A, do not investigate**

tacky-borders **is not installed on this machine.** Verified 2026-08-04: its config and a 450KB log exist at `~/.config/tacky-borders/`, but no executable is present in scoop, `Program Files`, `Program Files (x86)`, or `LocalAppData`, and no process is running.

Consequences, already reflected in later tasks:

- Task 5 still builds the template — it only needs the existing `config.yaml` as a base, which is present. The template is ready if tacky-borders is reinstalled.
- Unknown #3 (reload mechanism) stays **unresolved**. Record it as such.
- Task 8's tacky-borders log check is **conditional** on the process running.

Write this into `docs/spikes.md` and move on.

- [ ] **Step 9: Answer Unknown #2 — does WezTerm reload on an included file?**

```powershell
'return { surface = "#ff0000" }' | Set-Content "$env:USERPROFILE\.config\palette-probe.lua" -Encoding ascii
```

Add a temporary `dofile` of that path to `.wezterm.lua`, confirm WezTerm picks it up, then change only `palette-probe.lua` and observe whether WezTerm reloads. Record whether touching `.wezterm.lua` is required. Remove the temporary code afterward.

- [ ] **Step 10: Write both documents and commit**

`docs/matugen-reference.md` holds the role list, syntax, format values and BOM finding. `docs/spikes.md` holds unknowns 2–5 with the evidence gathered.

```powershell
cd C:\Users\PC\Documents\git\setup
git add docs/matugen-reference.md docs/spikes.md
git commit -m "docs: resolve pipeline unknowns and capture matugen reference"
```

---

### Task 2: Color literal inventory tool

**Files:**
- Create: `scripts/Get-ColorLiterals.ps1`
- Create: `tests/Get-ColorLiterals.Tests.ps1`
- Create: `tests/fixtures/sample.css`
- Create: `state/yasb-inventory.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `Get-ColorLiterals.ps1` exposing `Get-ColorLiterals -Path <string>`, returning an array of `[PSCustomObject]@{ Literal = <string>; Count = <int> }` sorted by `Count` descending. Task 3 consumes this output.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/sample.css`:

```css
.a { color: #cba6f7; background: rgba(17, 17, 27, 0.8); }
.b { color: #CBA6F7; border: 1px solid #313244; }
.c { background: rgba(17,17,27,0.8); color: #f38ba8; }
```

Note the deliberate traps: `#cba6f7` and `#CBA6F7` are the same color in different case, and the two `rgba(...)` differ only by whitespace.

- [ ] **Step 2: Write the failing test**

`tests/Get-ColorLiterals.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot\..\scripts\Get-ColorLiterals.ps1"
    $script:fixture = "$PSScriptRoot\fixtures\sample.css"
}

Describe "Get-ColorLiterals" {
    It "finds every distinct color" {
        $r = Get-ColorLiterals -Path $script:fixture
        $r.Count | Should -Be 4
    }

    It "treats hex case-insensitively and counts both uses" {
        $r = Get-ColorLiterals -Path $script:fixture
        ($r | Where-Object { $_.Literal -eq '#cba6f7' }).Count | Should -Be 2
    }

    It "normalizes whitespace inside rgba() and counts both uses" {
        $r = Get-ColorLiterals -Path $script:fixture
        ($r | Where-Object { $_.Literal -eq 'rgba(17,17,27,0.8)' }).Count | Should -Be 2
    }

    It "sorts by count descending" {
        $r = Get-ColorLiterals -Path $script:fixture
        $r[0].Count | Should -BeGreaterOrEqual $r[-1].Count
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
Invoke-Pester tests/Get-ColorLiterals.Tests.ps1 -Output Detailed
```

Expected: FAIL — the script file does not exist.

- [ ] **Step 4: Write the implementation**

`scripts/Get-ColorLiterals.ps1`:

```powershell
function Get-ColorLiterals {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $text = [System.IO.File]::ReadAllText($Path)
    $counts = @{}

    $hexPattern = '#[0-9a-fA-F]{6}\b'
    foreach ($m in [regex]::Matches($text, $hexPattern)) {
        $key = $m.Value.ToLowerInvariant()
        if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
    }

    $rgbaPattern = 'rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)'
    foreach ($m in [regex]::Matches($text, $rgbaPattern)) {
        $key = ($m.Value -replace '\s+', '').ToLowerInvariant()
        if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
    }

    $counts.GetEnumerator() |
        ForEach-Object { [PSCustomObject]@{ Literal = $_.Key; Count = $_.Value } } |
        Sort-Object -Property Count -Descending
}
```

- [ ] **Step 5: Run the test to verify it passes**

```powershell
Invoke-Pester tests/Get-ColorLiterals.Tests.ps1 -Output Detailed
```

Expected: 4 passed.

- [ ] **Step 6: Run it against the real stylesheet**

```powershell
. .\scripts\Get-ColorLiterals.ps1
$inv = Get-ColorLiterals -Path "$env:USERPROFILE\.config\yasb\styles.css"
$inv | Format-Table -AutoSize
"unique literals: $($inv.Count)"
$json = $inv | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText("$PWD\state\yasb-inventory.json", $json, (New-Object System.Text.UTF8Encoding($false)))
```

Expected: roughly 25 unique literals. If it is wildly higher (say over 60), stop and report — the stylesheet may use color formats the patterns miss (named colors, 3-digit hex, `hsl()`), and the patterns need extending before proceeding.

- [ ] **Step 7: Commit**

```powershell
git add scripts/Get-ColorLiterals.ps1 tests/ state/yasb-inventory.json
git commit -m "feat: add color literal inventory tool"
```

---

### Task 3: Mapping file and the round-trip gate

The gate that makes the `styles.css` migration provably lossless. Build it before any real template.

**Files:**
- Create: `scripts/New-Template.ps1`
- Create: `scripts/Test-Roundtrip.ps1`
- Create: `tests/Roundtrip.Tests.ps1`
- Create: `matugen/mapping.json`

**Interfaces:**
- Consumes: `Get-ColorLiterals` from Task 2.
- Produces:
  - `New-Template -SourcePath <string> -MappingPath <string> -OutputPath <string>` — writes a matugen template.
  - `Test-Roundtrip -SourcePath <string> -TemplatePath <string> -MappingPath <string>` — returns `$true` only when reversing the mapping reproduces the source byte-for-byte.
  - `matugen/mapping.json` — object keyed by normalized literal, each value `{ "expression": "<matugen expression>" }`.

- [ ] **Step 1: Write the mapping fixture**

`tests/fixtures/sample-mapping.json`:

```json
{
  "#cba6f7":                { "expression": "{{colors.primary.default.hex}}" },
  "#313244":                { "expression": "{{colors.outline_variant.default.hex}}" },
  "#f38ba8":                { "expression": "{{colors.error.default.hex}}" },
  "rgba(17,17,27,0.8)":     { "expression": "{{colors.surface_container.default.rgba | set_alpha: 0.8}}" }
}
```

- [ ] **Step 2: Write the failing test**

`tests/Roundtrip.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot\..\scripts\New-Template.ps1"
    . "$PSScriptRoot\..\scripts\Test-Roundtrip.ps1"
    $script:src     = "$PSScriptRoot\fixtures\sample.css"
    $script:mapping = "$PSScriptRoot\fixtures\sample-mapping.json"
    $script:tmpl    = "$env:TEMP\sample.css.tmpl"
}

Describe "New-Template + Test-Roundtrip" {
    It "produces a template containing no raw color literals" {
        New-Template -SourcePath $script:src -MappingPath $script:mapping -OutputPath $script:tmpl
        $t = [System.IO.File]::ReadAllText($script:tmpl)
        $t | Should -Not -Match '#[0-9a-fA-F]{6}\b'
        $t | Should -Not -Match 'rgba?\(\s*\d+'
    }

    It "round-trips byte-identically" {
        New-Template -SourcePath $script:src -MappingPath $script:mapping -OutputPath $script:tmpl
        Test-Roundtrip -SourcePath $script:src -TemplatePath $script:tmpl -MappingPath $script:mapping | Should -BeTrue
    }

    It "fails the round-trip when the template is corrupted" {
        New-Template -SourcePath $script:src -MappingPath $script:mapping -OutputPath $script:tmpl
        $t = [System.IO.File]::ReadAllText($script:tmpl)
        [System.IO.File]::WriteAllText($script:tmpl, ($t -replace '\.a', '.zzz'), (New-Object System.Text.UTF8Encoding($false)))
        Test-Roundtrip -SourcePath $script:src -TemplatePath $script:tmpl -MappingPath $script:mapping | Should -BeFalse
    }
}
```

The third test matters most: it proves the gate can actually detect damage rather than always returning true.

- [ ] **Step 3: Run the test to verify it fails**

```powershell
Invoke-Pester tests/Roundtrip.Tests.ps1 -Output Detailed
```

Expected: FAIL — neither script exists.

- [ ] **Step 4: Implement `New-Template.ps1`**

```powershell
function New-Template {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$MappingPath,
        [Parameter(Mandatory)][string]$OutputPath
    )

    $text = [System.IO.File]::ReadAllText($SourcePath)
    $map  = Get-Content $MappingPath -Raw | ConvertFrom-Json

    foreach ($prop in $map.PSObject.Properties) {
        $literal    = $prop.Name
        $expression = $prop.Value.expression

        if ($literal.StartsWith('#')) {
            # Case-insensitive: the stylesheet mixes #cba6f7 and #CBA6F7.
            # The lookahead stops a 6-digit literal from matching INSIDE a longer
            # hex run. Without it, #ABCDEF12 with a mapped #abcdef becomes
            # "{{expr}}12" -- the alpha suffix is orphaned onto the expression,
            # and because Test-Roundtrip's normalization shared the same flaw,
            # both sides corrupted symmetrically and the gate returned true.
            # Get-ColorLiterals guards the same case with \b.
            $pattern = [regex]::Escape($literal) + '(?![0-9a-fA-F])'
            $text = [regex]::Replace($text, $pattern, $expression, 'IgnoreCase')
        }
        else {
            # rgba(): the mapping key is whitespace-stripped, the source may not be.
            $loose = [regex]::Escape($literal) -replace ',', '\s*,\s*' -replace '\\\(', '\(\s*' -replace '\\\)', '\s*\)'
            $text = [regex]::Replace($text, $loose, $expression, 'IgnoreCase')
        }
    }

    [System.IO.File]::WriteAllText($OutputPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}
```

- [ ] **Step 5: Implement `Test-Roundtrip.ps1`**

```powershell
function Test-Roundtrip {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$TemplatePath,
        [Parameter(Mandatory)][string]$MappingPath
    )

    $source   = [System.IO.File]::ReadAllText($SourcePath)
    $template = [System.IO.File]::ReadAllText($TemplatePath)
    $map      = Get-Content $MappingPath -Raw | ConvertFrom-Json

    # Reverse the mapping: every expression becomes its original literal.
    foreach ($prop in $map.PSObject.Properties) {
        $template = $template.Replace($prop.Value.expression, $prop.Name)
    }

    # Normalize the source the same way the mapping keys were normalized,
    # so case and whitespace differences do not register as damage.
    foreach ($prop in $map.PSObject.Properties) {
        $literal = $prop.Name
        if ($literal.StartsWith('#')) {
            # Same lookahead as New-Template, for the same reason. These two
            # patterns MUST stay identical: if they diverge, or if both share a
            # flaw, corruption cancels out symmetrically and the gate passes
            # code it should reject.
            $source = [regex]::Replace($source, ([regex]::Escape($literal) + '(?![0-9a-fA-F])'), $literal, 'IgnoreCase')
        }
        else {
            $loose = [regex]::Escape($literal) -replace ',', '\s*,\s*' -replace '\\\(', '\(\s*' -replace '\\\)', '\s*\)'
            $source = [regex]::Replace($source, $loose, $literal, 'IgnoreCase')
        }
    }

    if ($source -ceq $template) { return $true }

    # Report the first divergence so failures are diagnosable.
    $min = [Math]::Min($source.Length, $template.Length)
    for ($i = 0; $i -lt $min; $i++) {
        if ($source[$i] -cne $template[$i]) {
            $from = [Math]::Max(0, $i - 40)
            Write-Warning "Diverges at offset ${i}:"
            Write-Warning "  source:   ...$($source.Substring($from, [Math]::Min(80, $source.Length - $from)))"
            Write-Warning "  template: ...$($template.Substring($from, [Math]::Min(80, $template.Length - $from)))"
            break
        }
    }
    if ($source.Length -ne $template.Length) {
        Write-Warning "Length differs: source=$($source.Length) template=$($template.Length)"
    }
    return $false
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```powershell
Invoke-Pester tests/Roundtrip.Tests.ps1 -Output Detailed
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```powershell
git add scripts/New-Template.ps1 scripts/Test-Roundtrip.ps1 tests/
git commit -m "feat: add template generator and byte-identical round-trip gate"
```

---

### Task 4: yasb styles.css template

The riskiest single change. Nothing here is hand-edited.

**Files:**
- Create: `matugen/mapping.json`
- Create: `matugen/templates/yasb.styles.css`
- Read: `state/yasb-inventory.json` (Task 2)
- Read: `docs/matugen-reference.md` (Task 1)

**Interfaces:**
- Consumes: `New-Template`, `Test-Roundtrip` (Task 3); the inventory from Task 2.
- Produces: `matugen/mapping.json` covering every literal in the inventory, and `matugen/templates/yasb.styles.css`.

- [ ] **Step 1: Read the reference and the inventory**

```powershell
Get-Content docs/matugen-reference.md
Get-Content state/yasb-inventory.json | ConvertFrom-Json | Format-Table -AutoSize
```

Use only role names that appear in `docs/matugen-reference.md`. The names below are the expected Material You roles but **must** be checked against that file.

- [ ] **Step 2: Write `matugen/mapping.json`**

One entry per literal in the inventory. Assign roles using the semantics documented in `~/.config/yasb/CLAUDE.md` under "Theme conventions":

| Catppuccin | Role there | Material You role |
|---|---|---|
| `#1e1e2e` base | chip borders, chip text | `surface` |
| `rgba(17,17,27,0.8)` mantle | utility chip fill | `surface_container` + alpha |
| `#313244` surface0 | utility chip border | `outline_variant` |
| `#cdd6f4` text | utility chip text | `on_surface` |
| `#cba6f7` mauve | memory chip, popup accent, selection | `primary` |
| `#f38ba8` red | cpu chip | `error` |
| `#fab387` peach | gpu chip | `tertiary` |
| `#89dceb` sky | disk chip | `secondary` |
| `#f5c2e7` pink | media chip | `primary_container` |

Skeleton — extend to cover **every** literal in the inventory:

```json
{
  "#1e1e2e":            { "expression": "{{colors.surface.default.hex}}" },
  "#313244":            { "expression": "{{colors.outline_variant.default.hex}}" },
  "#cdd6f4":            { "expression": "{{colors.on_surface.default.hex}}" },
  "#cba6f7":            { "expression": "{{colors.primary.default.hex}}" },
  "#f38ba8":            { "expression": "{{colors.error.default.hex}}" },
  "#fab387":            { "expression": "{{colors.tertiary.default.hex}}" },
  "#89dceb":            { "expression": "{{colors.secondary.default.hex}}" },
  "#f5c2e7":            { "expression": "{{colors.primary_container.default.hex}}" },
  "rgba(17,17,27,0.8)": { "expression": "{{colors.surface_container.default.rgba | set_alpha: 0.8}}" }
}
```

- [ ] **Step 3: Verify the mapping is complete**

```powershell
$inv = Get-Content state/yasb-inventory.json -Raw | ConvertFrom-Json
$map = Get-Content matugen/mapping.json -Raw | ConvertFrom-Json
$mapped = $map.PSObject.Properties.Name
$missing = $inv | Where-Object { $mapped -notcontains $_.Literal }
if ($missing) { $missing | Format-Table -AutoSize; throw "Unmapped literals: $($missing.Count)" } else { "All literals mapped." }
```

Expected: "All literals mapped." Do not continue otherwise.

- [ ] **Step 4: Generate the template**

```powershell
. .\scripts\New-Template.ps1
New-Template -SourcePath "$env:USERPROFILE\.config\yasb\styles.css" `
             -MappingPath ".\matugen\mapping.json" `
             -OutputPath  ".\matugen\templates\yasb.styles.css"
```

- [ ] **Step 5: Run the gate**

```powershell
. .\scripts\Test-Roundtrip.ps1
$ok = Test-Roundtrip -SourcePath "$env:USERPROFILE\.config\yasb\styles.css" `
                     -TemplatePath ".\matugen\templates\yasb.styles.css" `
                     -MappingPath  ".\matugen\mapping.json"
if (-not $ok) { throw "GATE FAILED - do not proceed" } else { "GATE PASSED" }
```

Expected: `GATE PASSED`. On failure the warnings name the exact offset; fix the mapping — never the template by hand — and regenerate.

- [ ] **Step 6: Confirm no literals survived**

```powershell
$t = [System.IO.File]::ReadAllText(".\matugen\templates\yasb.styles.css")
[regex]::Matches($t, '#[0-9a-fA-F]{6}\b').Count
[regex]::Matches($t, 'rgba?\(\s*\d+').Count
```

Expected: `0` and `0`.

- [ ] **Step 7: Commit**

```powershell
git add matugen/mapping.json matugen/templates/yasb.styles.css
git commit -m "feat: templatize yasb styles.css, round-trip verified"
```

---

### Task 5: tacky-borders template

**Files:**
- Create: `matugen/templates/tacky-borders.yaml`
- Read: `~/.config/tacky-borders/config.yaml`

**Interfaces:**
- Consumes: role names from `docs/matugen-reference.md`.
- Produces: `matugen/templates/tacky-borders.yaml`.

- [ ] **Step 1: Back up the live config as the template base**

```powershell
New-Item -ItemType Directory -Force -Path ".\state\last-good" | Out-Null
Copy-Item "$env:USERPROFILE\.config\tacky-borders\config.yaml" ".\matugen\templates\tacky-borders.yaml"
Copy-Item "$env:USERPROFILE\.config\tacky-borders\config.yaml" ".\state\last-good\tacky-config.yaml"
```

The backup filename is `tacky-config.yaml`, not `tacky-borders.yaml` — `Apply-Theme` (Task 8) keys `state/last-good/` by the *staged* filename, and the staged name is `tacky-config.yaml`.

- [ ] **Step 2: Replace the color blocks**

Edit `matugen/templates/tacky-borders.yaml`. The existing structure is a 4-stop active gradient, a 2-stop inactive gradient, and three komorebi colors. Replace only those values, leaving every comment and all animation/effect settings untouched:

```yaml
  active_color:
    colors:
      - "{{colors.surface_dim.default.hex}}"
      - "{{colors.primary_container.default.hex}}"
      - "{{colors.primary.default.hex}}"
      - "{{colors.inverse_primary.default.hex}}"

  inactive_color:
    colors:
      - "{{colors.surface_container.default.hex}}"
      - "{{colors.outline_variant.default.hex}}"

  komorebi_colors:
    stack_color: "{{colors.tertiary.default.hex}}"
    monocle_color: "{{colors.secondary.default.hex}}"
    floating_color: "{{colors.error_container.default.hex}}"
```

If `surface_dim` or `inverse_primary` are absent from `docs/matugen-reference.md`, substitute the nearest role that is present and note the substitution in a YAML comment.

- [ ] **Step 3: Verify no literals remain in the color blocks**

```powershell
$t = [System.IO.File]::ReadAllText(".\matugen\templates\tacky-borders.yaml")
# Comments legitimately contain example hex values; check only uncommented lines.
($t -split "`n") | Where-Object { $_ -notmatch '^\s*#' -and $_ -match '#[0-9a-fA-F]{6}' }
```

Expected: no output.

- [ ] **Step 4: Commit**

```powershell
git add matugen/templates/tacky-borders.yaml state/last-good/tacky-config.yaml
git commit -m "feat: templatize tacky-borders colors"
```

---

### Task 6: WezTerm palette integration

`.wezterm.lua` is 14KB of hand-maintained config and is **not** templated. It gains a guarded read of a small generated file.

**Files:**
- Create: `matugen/templates/palette.lua`
- Modify: `~/.wezterm.lua`

**Interfaces:**
- Consumes: role names from `docs/matugen-reference.md`.
- Produces: `~/.config/palette.lua` at runtime, a Lua table with keys `surface`, `on_surface`, `primary`, `ansi` (8 entries), `brights` (8 entries).

- [ ] **Step 1: Write `matugen/templates/palette.lua`**

```lua
-- Generated by matugen. Do not edit.
return {
  surface    = "{{colors.surface.default.hex}}",
  on_surface = "{{colors.on_surface.default.hex}}",
  primary    = "{{colors.primary.default.hex}}",
  ansi = {
    "{{colors.surface.default.hex}}",
    "{{colors.error.default.hex}}",
    "{{colors.tertiary.default.hex}}",
    "{{colors.secondary.default.hex}}",
    "{{colors.primary.default.hex}}",
    "{{colors.primary_container.default.hex}}",
    "{{colors.secondary_container.default.hex}}",
    "{{colors.on_surface_variant.default.hex}}",
  },
  brights = {
    "{{colors.outline.default.hex}}",
    "{{colors.error_container.default.hex}}",
    "{{colors.tertiary_container.default.hex}}",
    "{{colors.inverse_primary.default.hex}}",
    "{{colors.inverse_primary.default.hex}}",
    "{{colors.primary_container.default.hex}}",
    "{{colors.secondary_container.default.hex}}",
    "{{colors.on_surface.default.hex}}",
  },
}
```

Substitute any role absent from `docs/matugen-reference.md` and note it in a comment.

- [ ] **Step 2: Add the guarded read to `.wezterm.lua`**

**Read the existing file before editing.** It does not use `config.colors`. It defines named schemes in `config.color_schemes` (line ~11) and selects one with `config.color_scheme = THEME` (line ~99). Register a generated scheme the same way rather than introducing `config.colors`, which would sit in an awkward precedence relationship with the named scheme already set.

Insert **after** line ~99 (`config.color_scheme = THEME`), so the generated scheme wins when present:

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

`pcall` means a missing or malformed palette leaves WezTerm on `THEME` rather than failing to start.

**Do not touch the focus handler** (`window:set_config_overrides`, line ~234). It overrides only opacity and window decorations, and `set_config_overrides` affects solely the keys present in its table — colors are unaffected by it.

**Reload requires touching `.wezterm.lua` itself** — confirmed in Task 1: editing only the `dofile`'d include produced no reload after 20+ seconds, while touching the main file picked up the pending change in ~5 seconds. `Apply-Theme` already does this.

- [ ] **Step 3: Test the failure path first**

With no `~/.config/palette.lua` present, launch WezTerm. Expected: it starts normally on its built-in colors, no error dialog.

- [ ] **Step 4: Test the success path — IN ISOLATION**

⚠️ **Do not write a test palette to `~/.config/palette.lua`.** That is the live path the running config reads, and `automatically_reload_config` defaults to `true`, so the user's active terminal picks it up within seconds. This happened once already: a red test palette hijacked the live session mid-task.

Test against a throwaway config instead, so nothing touches the live one:

```powershell
$sandbox = "$env:TEMP\wezterm-t6"
New-Item -ItemType Directory -Force -Path $sandbox | Out-Null

# A copy of the real config, pointed at a sandboxed palette path.
$cfg = (Get-Content "$env:USERPROFILE\.wezterm.lua" -Raw).Replace(
  'os.getenv("USERPROFILE") .. "/.config/palette.lua"',
  '"' + ($sandbox -replace '\\','/') + '/palette.lua"')
[System.IO.File]::WriteAllText("$sandbox\wezterm.lua", $cfg, (New-Object System.Text.UTF8Encoding($false)))

@'
return {
  surface = "#ff0000", on_surface = "#00ff00", primary = "#0000ff",
  ansi = {"#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888"},
  brights = {"#999999","#aaaaaa","#bbbbbb","#cccccc","#dddddd","#eeeeee","#ffffff","#000000"},
}
'@ | Set-Content "$sandbox\palette.lua" -Encoding ascii

# Spawn a window using ONLY the sandbox config. Screenshot it, then close it.
& "C:\Program Files\WezTerm\wezterm.exe" --config-file "$sandbox\wezterm.lua" start
```

Verify by screenshotting that spawned window. **Close the window you spawned and delete `$sandbox` when done.** The live `~/.config/palette.lua` is written for the first time by `Apply-Theme` in Task 8, not here.

Launch WezTerm. Expected: a red background. Verify by screenshotting the window (PowerShell `System.Drawing` `CopyFromScreen` to a PNG under `$env:TEMP`, then read the PNG) — do not automate clicks or SendKeys, a human is at this machine.

Task 1 established that WezTerm will **not** notice a change to `palette.lua` alone; touching `.wezterm.lua` is what triggers the reload. Confirm that here.

- [ ] **Step 5: Clean up and commit**

```powershell
Remove-Item "$env:USERPROFILE\.config\palette.lua"
git add matugen/templates/palette.lua
git commit -m "feat: add wezterm palette template and guarded config read"
```

Commit the `.wezterm.lua` change in its own location — it is not inside this repo.

---

### Task 7: starship template

**Files:**
- Create: `matugen/templates/starship.toml`
- Read: `~/.config/starship.toml`

**Interfaces:**
- Consumes: role names from `docs/matugen-reference.md`.
- Produces: `matugen/templates/starship.toml`.

- [ ] **Step 1: Inventory the colors in the live config**

```powershell
. .\scripts\Get-ColorLiterals.ps1
Get-ColorLiterals -Path "$env:USERPROFILE\.config\starship.toml" | Format-Table -AutoSize
Select-String -Path "$env:USERPROFILE\.config\starship.toml" -Pattern 'style\s*=' | Select-Object -ExpandProperty Line
```

starship styles often use named colors (`bold green`) rather than hex. Those are out of scope for `Get-ColorLiterals` — list them from the second command and convert them to hex expressions by hand in Step 2.

- [ ] **Step 2: Build the template**

```powershell
Copy-Item "$env:USERPROFILE\.config\starship.toml" ".\matugen\templates\starship.toml"
Copy-Item "$env:USERPROFILE\.config\starship.toml" ".\state\last-good\starship.toml"
```

Then replace each style color, for example:

```toml
[directory]
style = "bold {{colors.primary.default.hex}}"

[git_branch]
style = "bold {{colors.tertiary.default.hex}}"

[character]
success_symbol = "[❯]({{colors.primary.default.hex}})"
error_symbol   = "[❯]({{colors.error.default.hex}})"
```

- [ ] **Step 3: Verify the rendered result parses**

Render manually with a probe palette and check starship accepts it:

```powershell
$probe = Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960" -Recurse -Filter "preview.jpg" | Select-Object -First 1 -ExpandProperty FullName
@"
[config]

[templates.starship]
input_path = '$PWD\matugen\templates\starship.toml'
output_path = '$env:TEMP\starship-probe.toml'
"@ | Set-Content "$env:TEMP\probe.toml" -Encoding ascii
matugen image $probe --mode dark --prefer saturation --config "$env:TEMP\probe.toml"
$env:STARSHIP_CONFIG = "$env:TEMP\starship-probe.toml"
starship prompt
$env:STARSHIP_CONFIG = $null
```

Expected: a rendered prompt, exit code 0, no parse errors.

- [ ] **Step 4: Commit**

```powershell
git add matugen/templates/starship.toml state/last-good/starship.toml
git commit -m "feat: templatize starship prompt colors"
```

---

### Task 8: matugen config and Apply-Theme

**Files:**
- Create: `matugen/config.toml`
- Create: `scripts/Apply-Theme.ps1`
- Create: `tests/ApplyTheme.Tests.ps1`

**Interfaces:**
- Consumes: all four templates (Tasks 4–7); BOM finding from Task 1.
- Produces: `Apply-Theme.ps1` exposing `Apply-Theme -Image <string> [-Scheme <string>] [-DryRun]`, returning `[PSCustomObject]@{ Success = <bool>; Failed = <string[]> }`. Task 9 calls it.

- [ ] **Step 1: Write `matugen/config.toml`**

Output paths point at a temp staging directory, **not** at live configs. `Apply-Theme` moves files into place only after validation.

**A top-level `[config]` table is mandatory**, even when empty. Without it matugen fails with a cryptic `missing field \`config\`` error (found in Task 1).

```toml
[config]

[templates.yasb]
input_path = 'C:\Users\PC\Documents\git\setup\matugen\templates\yasb.styles.css'
output_path = 'C:\Users\PC\Documents\git\setup\state\staging\styles.css'

[templates.tacky]
input_path = 'C:\Users\PC\Documents\git\setup\matugen\templates\tacky-borders.yaml'
output_path = 'C:\Users\PC\Documents\git\setup\state\staging\tacky-config.yaml'

[templates.wezterm]
input_path = 'C:\Users\PC\Documents\git\setup\matugen\templates\palette.lua'
output_path = 'C:\Users\PC\Documents\git\setup\state\staging\palette.lua'

[templates.starship]
input_path = 'C:\Users\PC\Documents\git\setup\matugen\templates\starship.toml'
output_path = 'C:\Users\PC\Documents\git\setup\state\staging\starship.toml'
```

- [ ] **Step 2: Write the failing test**

`tests/ApplyTheme.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot\..\scripts\Apply-Theme.ps1"
    $script:probe = Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960" -Recurse -Filter "preview.jpg" | Select-Object -First 1 -ExpandProperty FullName
}

Describe "Apply-Theme" {
    It "aborts when the image does not exist" {
        $r = Apply-Theme -Image "C:\does\not\exist.jpg"
        $r.Success | Should -BeFalse
    }

    It "-DryRun writes nothing to live configs" {
        $before = (Get-Item "$env:USERPROFILE\.config\yasb\styles.css").LastWriteTimeUtc
        Apply-Theme -Image $script:probe -DryRun
        (Get-Item "$env:USERPROFILE\.config\yasb\styles.css").LastWriteTimeUtc | Should -Be $before
    }

    It "-DryRun still renders all four staging files" {
        Apply-Theme -Image $script:probe -DryRun
        foreach ($f in 'styles.css','tacky-config.yaml','palette.lua','starship.toml') {
            Test-Path "$PSScriptRoot\..\state\staging\$f" | Should -BeTrue
        }
    }

    It "renders staging files without a BOM" {
        Apply-Theme -Image $script:probe -DryRun
        $b = [System.IO.File]::ReadAllBytes("$PSScriptRoot\..\state\staging\styles.css")
        ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) | Should -BeFalse
    }
}

Describe "Test-StagedFile" {
    It "rejects a file with an unrendered template expression" {
        $p = "$env:TEMP\unrendered.lua"
        Set-Content $p 'return { surface = "{{colors.primary.default.hex}}" }' -Encoding ascii
        Test-StagedFile -Name 'wezterm' -Path $p | Should -BeFalse
    }

    It "rejects palette.lua with unbalanced braces" {
        $p = "$env:TEMP\unbalanced.lua"
        Set-Content $p 'return { surface = "#112233",' -Encoding ascii
        Test-StagedFile -Name 'wezterm' -Path $p | Should -BeFalse
    }

    It "rejects palette.lua with a non-hex value" {
        $p = "$env:TEMP\nonhex.lua"
        Set-Content $p 'return { surface = "not-a-color" }' -Encoding ascii
        Test-StagedFile -Name 'wezterm' -Path $p | Should -BeFalse
    }

    It "accepts a well-formed palette.lua" {
        $p = "$env:TEMP\good.lua"
        Set-Content $p 'return { surface = "#112233", on_surface = "#445566" }' -Encoding ascii
        Test-StagedFile -Name 'wezterm' -Path $p | Should -BeTrue
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
Invoke-Pester tests/ApplyTheme.Tests.ps1 -Output Detailed
```

Expected: FAIL — `Apply-Theme.ps1` does not exist.

- [ ] **Step 4: Implement `Apply-Theme.ps1`**

```powershell
$script:Root    = Split-Path $PSScriptRoot -Parent
$script:Staging = Join-Path $script:Root "state\staging"
$script:LastGood= Join-Path $script:Root "state\last-good"
$script:Yasbc   = "C:\Program Files\yasb\yasbc.exe"

$script:Targets = @(
    @{ Name='yasb';     Staged='styles.css';       Live="$env:USERPROFILE\.config\yasb\styles.css" }
    @{ Name='tacky';    Staged='tacky-config.yaml';Live="$env:USERPROFILE\.config\tacky-borders\config.yaml" }
    @{ Name='wezterm';  Staged='palette.lua';      Live="$env:USERPROFILE\.config\palette.lua" }
    @{ Name='starship'; Staged='starship.toml';    Live="$env:USERPROFILE\.config\starship.toml" }
)

function Remove-Bom {
    param([Parameter(Mandatory)][string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        [System.IO.File]::WriteAllBytes($Path, $bytes[3..($bytes.Length - 1)])
    }
}

function Test-StagedFile {
    <#
      Pre-move validation. Returns $true if the staged file looks usable.
      yasb and tacky-borders have no offline validator, so they are checked
      after the move via their logs instead.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path
    )

    $text = [System.IO.File]::ReadAllText($Path)

    # An unresolved template expression means matugen silently skipped a role.
    if ($text -match '\{\{') {
        Write-Warning "$Name still contains an unrendered '{{' expression"
        return $false
    }

    switch ($Name) {
        'wezterm' {
            # Structural check, not a full Lua parse: no interpreter is installed.
            if ($text -notmatch '(?s)^\s*--.*?return\s*\{' -and $text -notmatch '(?s)^\s*return\s*\{') {
                Write-Warning "palette.lua does not open with a return table"
                return $false
            }
            $open  = ([regex]::Matches($text, '\{')).Count
            $close = ([regex]::Matches($text, '\}')).Count
            if ($open -ne $close) {
                Write-Warning "palette.lua has unbalanced braces ($open open, $close close)"
                return $false
            }
            # Every quoted value should be a hex color.
            foreach ($m in [regex]::Matches($text, '"([^"]*)"')) {
                if ($m.Groups[1].Value -notmatch '^#[0-9a-fA-F]{6}$') {
                    Write-Warning "palette.lua has a non-hex value: $($m.Groups[1].Value)"
                    return $false
                }
            }
            return $true
        }
        'starship' {
            $prev = $env:STARSHIP_CONFIG
            $env:STARSHIP_CONFIG = $Path
            & starship prompt | Out-Null
            $code = $LASTEXITCODE
            $env:STARSHIP_CONFIG = $prev
            if ($code -ne 0) {
                Write-Warning "starship rejected the generated config (exit $code)"
                return $false
            }
            return $true
        }
        default { return $true }
    }
}

function Get-LogTail {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][long]$Offset)
    if (-not (Test-Path $Path)) { return '' }
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    $fs.Seek($Offset, 'Begin') | Out-Null
    $sr = New-Object System.IO.StreamReader($fs)
    $tail = $sr.ReadToEnd()
    $sr.Close(); $fs.Close()
    return $tail
}

function Apply-Theme {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Image,
        [string]$Scheme = 'scheme-tonal-spot',
        [switch]$DryRun
    )

    $failed = @()

    if (-not (Test-Path $Image)) {
        Write-Warning "Image not found: $Image"
        return [PSCustomObject]@{ Success = $false; Failed = @('preflight') }
    }
    if (-not (Get-Command matugen -ErrorAction SilentlyContinue)) {
        Write-Warning "matugen is not on PATH"
        return [PSCustomObject]@{ Success = $false; Failed = @('preflight') }
    }

    New-Item -ItemType Directory -Force -Path $script:Staging, $script:LastGood | Out-Null

    # --prefer is REQUIRED for scripted use. Many images yield multiple
    # candidate source colors; without a preference matugen tries to prompt,
    # detects no terminal, and fails. Verified in Task 1: gif previews (70% of
    # this library) fail without it and succeed with it.
    matugen image $Image --mode dark --type $Scheme --prefer saturation --config (Join-Path $script:Root "matugen\config.toml")
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "matugen failed with exit code $LASTEXITCODE"
        return [PSCustomObject]@{ Success = $false; Failed = @('matugen') }
    }

    foreach ($t in $script:Targets) {
        $staged = Join-Path $script:Staging $t.Staged
        if (-not (Test-Path $staged)) {
            Write-Warning "matugen did not produce $($t.Staged)"
            $failed += $t.Name
            continue
        }
        Remove-Bom -Path $staged
        if (-not (Test-StagedFile -Name $t.Name -Path $staged)) { $failed += $t.Name }
    }
    if ($failed.Count -gt 0) { return [PSCustomObject]@{ Success = $false; Failed = $failed } }

    if ($DryRun) {
        Write-Host "DryRun: rendered to $script:Staging, nothing moved."
        return [PSCustomObject]@{ Success = $true; Failed = @() }
    }

    # Snapshot current live files before touching anything.
    foreach ($t in $script:Targets) {
        if (Test-Path $t.Live) { Copy-Item $t.Live (Join-Path $script:LastGood $t.Staged) -Force }
    }

    # Mark both logs BEFORE copying — tacky-borders may react to its config
    # changing on disk, without waiting for an explicit reload.
    $yasbLog  = "$env:USERPROFILE\.config\yasb\yasb.log"
    $tackyLog = "$env:USERPROFILE\.config\tacky-borders\tacky-borders.log"
    $yasbMark  = 0; $tackyMark = 0
    if (Test-Path $yasbLog)  { $yasbMark  = (Get-Item $yasbLog).Length }
    if (Test-Path $tackyLog) { $tackyMark = (Get-Item $tackyLog).Length }

    foreach ($t in $script:Targets) {
        Copy-Item (Join-Path $script:Staging $t.Staged) $t.Live -Force
    }

    & $script:Yasbc reload | Out-Null
    Start-Sleep -Seconds 8

    $pattern = '(?i)error|critical|invalid|could not be read'
    if ((Get-LogTail -Path $yasbLog -Offset $yasbMark) -match $pattern) { $failed += 'yasb' }

    # tacky-borders is not installed here (see docs/spikes.md, unknown #3).
    # Only trust its log when the process is actually running, otherwise the
    # tail is stale output from a previous session and means nothing.
    if (Get-Process -Name 'tacky-borders' -ErrorAction SilentlyContinue) {
        if ((Get-LogTail -Path $tackyLog -Offset $tackyMark) -match $pattern) { $failed += 'tacky' }
    }

    if ($failed.Count -gt 0) {
        Write-Warning "Rejected by: $($failed -join ', '). Rolling back all targets."
        foreach ($t in $script:Targets) {
            $backup = Join-Path $script:LastGood $t.Staged
            if (Test-Path $backup) { Copy-Item $backup $t.Live -Force }
        }
        & $script:Yasbc reload | Out-Null
        return [PSCustomObject]@{ Success = $false; Failed = $failed }
    }

    # Force WezTerm to notice the new palette (see docs/spikes.md, unknown #2).
    if (Test-Path "$env:USERPROFILE\.wezterm.lua") {
        (Get-Item "$env:USERPROFILE\.wezterm.lua").LastWriteTime = Get-Date
    }

    return [PSCustomObject]@{ Success = $true; Failed = @() }
}
```

If Task 1 Step 8 found that tacky-borders needs an explicit restart, add it after the copy loop. If Task 1 Step 9 found WezTerm reloads on included files, the touch above is harmless but can be removed.

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
Invoke-Pester tests/ApplyTheme.Tests.ps1 -Output Detailed
```

Expected: 8 passed.

- [ ] **Step 6: Apply for real and inspect the bar**

```powershell
. .\scripts\Apply-Theme.ps1
$probe = Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960" -Recurse -Filter "preview.jpg" | Select-Object -First 1 -ExpandProperty FullName
Apply-Theme -Image $probe
```

Then **look at the bar**. Per `~/.config/yasb/CLAUDE.md`, a clean log does not mean it rendered correctly. Screenshot the top ~36px and check chip padding, glyphs and contrast.

- [ ] **Step 7: Commit**

```powershell
git add matugen/config.toml scripts/Apply-Theme.ps1 tests/ApplyTheme.Tests.ps1
git commit -m "feat: add matugen config and Apply-Theme with validation and rollback"
```

---

### Task 9: Switch-Wallpaper

**Files:**
- Create: `scripts/Switch-Wallpaper.ps1`
- Create: `tests/SwitchWallpaper.Tests.ps1`

**Interfaces:**
- Consumes: `Apply-Theme` (Task 8); the resolved `getWallpaper` finding from Task 1 Step 6; the preview-coverage finding from Task 1 Step 7.
- Produces:
  - `Get-WallpaperEngineExe` — path of the running WE binary, or `$null`.
  - `Get-CurrentWallpaper [-ConfigPath <string>]` — current wallpaper asset path with backslashes, or `$null`.
  - `Resolve-PreviewImage -ProjectJson <string>` — sibling preview image path, or `$null`.
  - `Switch-Wallpaper -Wallpaper <string> -Scheme <string> -DryRun`, plus `state/current.json` with `{ wallpaper, preview, appliedUtc }`.

- [ ] **Step 1: Write the failing test**

`tests/SwitchWallpaper.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot\..\scripts\Switch-Wallpaper.ps1"
}

Describe "Resolve-PreviewImage" {
    It "prefers preview.jpg" {
        $d = Join-Path $env:TEMP "wp-test-1"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Set-Content (Join-Path $d "preview.jpg") "x"
        Set-Content (Join-Path $d "preview.gif") "x"
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -Be (Join-Path $d "preview.jpg")
    }

    It "falls back to preview.gif" {
        $d = Join-Path $env:TEMP "wp-test-2"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Set-Content (Join-Path $d "preview.gif") "x"
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -Be (Join-Path $d "preview.gif")
    }

    It "returns null when neither exists" {
        $d = Join-Path $env:TEMP "wp-test-3"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -BeNullOrEmpty
    }
}

Describe "Get-CurrentWallpaper" {
    It "extracts the file path from a selectedwallpapers block" {
        $p = "$env:TEMP\we-config-1.json"
        @'
{
  "general" : { "file" : "C:/decoy/should-not-match.pkg" },
  "wallpaperconfig" : {
    "selectedwallpapers" : {
      "MON1" : { "file" : "C:/Steam/workshop/content/431960/123/scene.pkg" }
    }
  }
}
'@ | Set-Content $p -Encoding ascii
        Get-CurrentWallpaper -ConfigPath $p | Should -Be "C:\Steam\workshop\content\431960\123\scene.pkg"
    }

    It "returns null when there is no selectedwallpapers block" {
        $p = "$env:TEMP\we-config-2.json"
        '{ "general" : { "file" : "C:/x.pkg" } }' | Set-Content $p -Encoding ascii
        Get-CurrentWallpaper -ConfigPath $p | Should -BeNullOrEmpty
    }

    It "returns null when the config file is missing" {
        Get-CurrentWallpaper -ConfigPath "C:\does\not\exist.json" | Should -BeNullOrEmpty
    }

    It "reads the real Wallpaper Engine config" {
        $real = Get-CurrentWallpaper
        $real | Should -Not -BeNullOrEmpty
        Test-Path $real | Should -BeTrue
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
Invoke-Pester tests/SwitchWallpaper.Tests.ps1 -Output Detailed
```

Expected: FAIL — the script does not exist.

- [ ] **Step 3: Implement `Switch-Wallpaper.ps1`**

```powershell
. (Join-Path $PSScriptRoot "Apply-Theme.ps1")

$script:WeDir     = "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine"
$script:WeConfig  = Join-Path $script:WeDir "config.json"

function Get-WallpaperEngineExe {
    <#
      Returns the path of whichever Wallpaper Engine binary is actually
      running. This machine runs wallpaper32; both exist on disk, and the
      CLI talks to the live process, so hardcoding either one is wrong.
    #>
    [CmdletBinding()]
    param()

    $proc = Get-Process -Name 'wallpaper32', 'wallpaper64' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { return $null }
    return (Join-Path $script:WeDir "$($proc.ProcessName).exe")
}

function Get-CurrentWallpaper {
    <#
      Reads the live wallpaper path from Wallpaper Engine's own config.json.

      The `-control getWallpaper` CLI command returns nothing on this system
      (verified against both binaries, with -monitor, and with stdout
      redirected). config.json is updated live and is the reliable source.

      ConvertFrom-Json CANNOT be used: PowerShell 5.1 throws
      'the value of argument "name" is not valid' on this file. Hence regex.
    #>
    [CmdletBinding()]
    param([string]$ConfigPath = $script:WeConfig)

    if (-not (Test-Path $ConfigPath)) { return $null }
    $text = [System.IO.File]::ReadAllText($ConfigPath)

    # Narrow to the selectedwallpapers block so we do not match "file" keys
    # belonging to unrelated settings elsewhere in the config.
    $blockMatch = [regex]::Match($text, '"selectedwallpapers"\s*:\s*\{')
    if (-not $blockMatch.Success) { return $null }

    # Walk braces from the block open to find its matching close.
    $start = $blockMatch.Index + $blockMatch.Length - 1
    $depth = 0; $end = -1
    for ($i = $start; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
    }
    if ($end -lt 0) { return $null }

    $block = $text.Substring($start, $end - $start + 1)
    $fileMatch = [regex]::Match($block, '"file"\s*:\s*"([^"]+)"')
    if (-not $fileMatch.Success) { return $null }

    # Values use forward slashes; normalize for Split-Path and Test-Path.
    return $fileMatch.Groups[1].Value -replace '/', '\'
}

function Resolve-PreviewImage {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ProjectJson)

    $dir = Split-Path $ProjectJson -Parent
    foreach ($name in 'preview.jpg', 'preview.gif', 'preview.png') {
        $p = Join-Path $dir $name
        if (Test-Path $p) { return $p }
    }
    return $null
}
```

Task 1 measured the real coverage across 57 installed wallpapers: **~70% are gif-only** (no `preview.jpg`) and **2 have no preview asset at all**. So the gif branch is the common path, not an edge case — and matugen handles gifs fine given `--prefer` (verified). The `$null` return for the 2 uncovered wallpapers is handled by the caller, which warns and leaves the theme unchanged.

```powershell

function Switch-Wallpaper {
    [CmdletBinding()]
    param(
        [string]$Wallpaper,
        [string]$Scheme = 'scheme-tonal-spot',
        [switch]$DryRun
    )

    $we = Get-WallpaperEngineExe
    if (-not $we) {
        Write-Warning "Wallpaper Engine is not running. Start it first."
        return
    }

    $before = Get-CurrentWallpaper

    if ($Wallpaper) {
        & $we -control openWallpaper -file $Wallpaper
    } else {
        & $we -control nextWallpaper
    }

    # config.json is written asynchronously after the wallpaper changes.
    # Poll for the value to change rather than guessing a fixed sleep.
    $current = $before
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $current = Get-CurrentWallpaper
        if ($current -and $current -ne $before) { break }
    }

    if (-not $current) {
        Write-Warning "Could not read the current wallpaper from $script:WeConfig"
        return
    }
    if ($current -eq $before -and -not $Wallpaper) {
        Write-Warning "Wallpaper did not change (playlist may hold a single item). Re-theming anyway."
    }

    $preview = Resolve-PreviewImage -ProjectJson $current
    if (-not $preview) {
        Write-Warning "No preview image beside $current - theme unchanged."
        return
    }

    $result = Apply-Theme -Image $preview -Scheme $Scheme -DryRun:$DryRun

    if ($result.Success -and -not $DryRun) {
        $state = [PSCustomObject]@{
            wallpaper  = $current
            preview    = $preview
            appliedUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json
        $out = Join-Path (Split-Path $PSScriptRoot -Parent) "state\current.json"
        [System.IO.File]::WriteAllText($out, $state, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Applied theme from $preview"
    }

    return $result
}
```

Adjust the `getWallpaper` capture to match the Task 1 Step 6 finding if it differs.

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
Invoke-Pester tests/SwitchWallpaper.Tests.ps1 -Output Detailed
```

Expected: 7 passed. The last one ("reads the real Wallpaper Engine config") requires Wallpaper Engine to be running.

- [ ] **Step 5: Test end to end**

```powershell
. .\scripts\Switch-Wallpaper.ps1
Switch-Wallpaper -DryRun
Switch-Wallpaper
Get-Content .\state\current.json
```

Expected: the wallpaper advances, the bar re-colors, `current.json` names the new wallpaper. Look at the bar — do not rely on the log alone.

- [ ] **Step 6: Run the whole suite**

```powershell
Invoke-Pester tests/ -Output Detailed
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/Switch-Wallpaper.ps1 tests/SwitchWallpaper.Tests.ps1 state/current.json
git commit -m "feat: add wallpaper switcher with theme application"
```

---

### Task 10: Documentation

**Files:**
- Create: `CLAUDE.md`
- Create: `README.md`
- Modify: `~/.config/yasb/CLAUDE.md`

**Interfaces:**
- Consumes: findings from every prior task.
- Produces: nothing consumed by code.

- [ ] **Step 1: Write `CLAUDE.md` for this repo**

Cover: the stack table, the pipeline flow, the BOM constraint, PowerShell 5.1 constraints, how to add a new theme target, how to re-run the round-trip gate after `styles.css` changes upstream, and the resolved answers to all five unknowns.

- [ ] **Step 2: Write `README.md`**

Short: what this does, prerequisites (Rust toolchain, matugen, Wallpaper Engine running), the two commands, and a note that keybinds are unassigned — with the free keys from `~/.config/whkdrc` listed (`alt + w` and `ctrl + alt + w` are both free; `alt + shift + w` is retile).

- [ ] **Step 3: Repoint the bar's left section from GlazeWM to komorebi**

GlazeWM was stopped and komorebi started during pre-flight, but `~/.config/yasb/config.yaml` still lists GlazeWM widgets in the bar layout, so the left section renders nothing.

Line ~35-37 currently reads:

```yaml
        - "glazewm_workspaces"
        - "glazewm_tiling_direction"
        - "glazewm_binding_mode"
```

The file **already defines** `komorebi_workspaces` (line ~173) and `komorebi_active_layout` (line ~132). Replace the layout entries with:

```yaml
        - "komorebi_workspaces"
        - "komorebi_active_layout"
```

There is no komorebi equivalent of `glazewm_binding_mode`; drop it rather than substituting something.

Then reload and verify — per that repo's `CLAUDE.md`, a clean log is not proof:

```powershell
& "C:\Program Files\yasb\yasbc.exe" reload
Start-Sleep -Seconds 8
Select-String -Path "$env:USERPROFILE\.config\yasb\yasb.log" -Pattern "error|critical|invalid" | Select-Object -Last 5
```

Screenshot the top 36px and confirm workspace numbers render. **Do not write `config.yaml` with `Set-Content -Encoding UTF8`** — the BOM makes yasb refuse it.

- [ ] **Step 4: Fix the stale yasb CLAUDE.md**

`~/.config/yasb/CLAUDE.md` currently states "Komorebi is **not installed**" and that GlazeWM drives the bar. Both are wrong since the komorebi migration. Correct:

- The stack table: komorebi replaces GlazeWM; `~/komorebi.json` and `~/.config/whkdrc` are its config.
- The line telling readers to ignore komorebi widgets — they render now.
- The claim that the `komorebic.exe is not recognized` warning is expected — it is not.
- Add a section stating `styles.css` is **generated** from `setup/matugen/templates/yasb.styles.css`, that hand-edits are overwritten on the next wallpaper switch, and that color changes belong in `setup/matugen/mapping.json`.

- [ ] **Step 4b: Record the `.wezterm.lua` edits in a tracked file**

`~/.wezterm.lua` is **not under version control** (the home directory is not a git repo), yet Task 6 made two changes there that the pipeline depends on. If that file is ever restored from a backup or rebuilt, the WezTerm integration breaks with no trace of why.

Create `docs/wezterm-integration.md` recording, precisely enough to reapply from scratch:

1. **The generated-scheme block**, inserted after `config.color_scheme = THEME` (~line 99) — the `pcall(dofile, ...)` guard, registration into `config.color_schemes["Matugen"]`, and the reassignment of `config.color_scheme`. Include the actual code.
2. **The focus-handler fix** — that `local scheme = config.color_schemes[THEME]` must become
   `local scheme = config.color_schemes[config.color_scheme] or config.color_schemes[THEME]`,
   **and why**: the `window-focus-changed` handler assigns `overrides.colors` from `scheme`, so reading `THEME` directly makes the generated palette revert to the static theme on the first focus change. This presents as "theming randomly stopped working" and is hard to diagnose after the fact.
3. **Ordering constraint** — the generated-scheme block must run *before* the `local scheme = ...` line.
4. **Testing note** — never write a test palette to `~/.config/palette.lua`; `automatically_reload_config` defaults to `true` and it will hijack the live session. Use a sandboxed config via `--config-file` (see Task 6 Step 4).
5. **Validation note** — `wezterm ... show-keys` returns **exit 0 even on a broken config**, silently falling back to defaults. Check for a known marker string in the output instead of trusting the exit code.

- [ ] **Step 5: Commit both repos**

```powershell
cd C:\Users\PC\Documents\git\setup
git add CLAUDE.md README.md
git commit -m "docs: add repo guide and readme"

cd $env:USERPROFILE\.config\yasb
git add CLAUDE.md config.yaml
git commit -m "fix: repoint bar to komorebi widgets, correct stale GlazeWM docs"
```

---

## Verification

After Task 10, confirm:

- [ ] `Invoke-Pester tests/ -Output Detailed` — all pass
- [ ] `Switch-Wallpaper` twice in a row produces two visibly different bar colorings
- [ ] Corrupting `matugen/templates/yasb.styles.css` (insert `{{colors.nonexistent.default.hex}}`) makes `Apply-Theme` fail and roll back, leaving a working bar
- [ ] `git status` clean in both `setup` and `~/.config/yasb`
- [ ] `~/.config/yasb/CLAUDE.md` no longer claims komorebi is absent
