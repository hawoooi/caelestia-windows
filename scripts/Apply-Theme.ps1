# matugen (installed via `cargo install matugen`, Task 1) does not live on the
# default PATH of a fresh, non-interactive PowerShell process -- only this
# session's own profile happens to prepend it. Any caller invoking this script
# from a fresh shell (a cron/scheduled task, a different terminal, CI, Task 9
# calling from elsewhere) would otherwise always hit the "matugen is not on
# PATH" preflight failure below. Prepend it defensively if it's missing.
if (-not (Get-Command matugen -ErrorAction SilentlyContinue)) {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path (Join-Path $cargoBin "matugen.exe")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

$script:Root        = Split-Path $PSScriptRoot -Parent
$script:Staging     = Join-Path $script:Root "state\staging"
$script:LastGood    = Join-Path $script:Root "state\last-good"
$script:LastGoodPrev= Join-Path $script:Root "state\last-good-prev"
$script:LastGoodNew = Join-Path $script:Root "state\last-good-new"
$script:Yasbc       = "C:\Program Files\yasb\yasbc.exe"

$script:Targets = @(
    @{ Name='yasb';     Staged='styles.css';       Live="$env:USERPROFILE\.config\yasb\styles.css" }
    @{ Name='tacky';    Staged='tacky-config.yaml';Live="$env:USERPROFILE\.config\tacky-borders\config.yaml" }
    @{ Name='wezterm';  Staged='palette.lua';      Live="$env:USERPROFILE\.config\palette.lua" }
    @{ Name='starship'; Staged='starship.toml';    Live="$env:USERPROFILE\.config\starship.toml" }
)

function Measure-CssBraces {
    <#
      Single-pass, string-aware brace counter for the yasb structural
      checks in Test-StagedFile.

      A regex-based comment stripper (`[regex]::Replace($text,
      '(?s)/\*.*?\*/', '')`, the first version of this fix) has no notion
      of string context. Given content like
      `.a { content: "/*"; color: red; ... .c { content: "*/"; } ... }`,
      it sees the FIRST `/*` (inside the `.a` rule's string literal) and
      the LAST `*/` (inside the `.c` rule's string literal) as one giant
      comment spanning both rules, strips everything between them --
      including genuinely live code -- and undercounts braces. `.a` is
      really unterminated (raw count 4 open / 3 close), but the stripped
      text looks balanced. That's a FALSE PASS on corrupt content -- the
      exact class of bug comment-stripping was added to close in the first
      place. Found by external review; not reachable through today's
      template (no `content:`/`url()` values in it), but latent in a
      general-purpose check.

      This tracks two mutually exclusive boolean states while scanning
      character by character -- InComment (entered on `/*`, exited on
      `*/`) and InString (entered on `'`/`"`, exited on the matching quote,
      respecting `\`-escapes) -- and only counts `{`/`}` when in neither.
      CSS comments do not nest, so a single boolean is sufficient for
      InComment; likewise CSS strings don't nest inside each other.

      Returns @{ Open = <int>; Close = <int>; UnterminatedComment = <bool> }.
      An unterminated `/*` (scanner still InComment at end of input) is
      itself suspicious -- truncation mid-comment -- and is surfaced so the
      caller can fail closed rather than silently treating the rest of a
      truncated file as "no braces found here".
    #>
    param([Parameter(Mandatory)][string]$Text)

    $open = 0
    $close = 0
    $inComment = $false
    $inString = $false
    $stringChar = [char]0
    $i = 0
    $len = $Text.Length

    while ($i -lt $len) {
        $c = $Text[$i]

        if ($inComment) {
            if ($c -eq '*' -and ($i + 1) -lt $len -and $Text[$i + 1] -eq '/') {
                $inComment = $false
                $i += 2
            } else {
                $i += 1
            }
            continue
        }

        if ($inString) {
            if ($c -eq '\' -and ($i + 1) -lt $len) {
                $i += 2  # skip the escaped character too
            } elseif ($c -eq $stringChar) {
                $inString = $false
                $i += 1
            } else {
                $i += 1
            }
            continue
        }

        # Not in a comment or string.
        if ($c -eq '/' -and ($i + 1) -lt $len -and $Text[$i + 1] -eq '*') {
            $inComment = $true
            $i += 2
            continue
        }
        if ($c -eq "'" -or $c -eq '"') {
            $inString = $true
            $stringChar = $c
            $i += 1
            continue
        }
        if ($c -eq '{') { $open++ }
        elseif ($c -eq '}') { $close++ }
        $i += 1
    }

    return @{ Open = $open; Close = $close; UnterminatedComment = $inComment }
}

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
      tacky-borders has no offline validator, so it is checked after the
      move via its log instead.

      yasb ALSO has no offline validator, but unlike tacky it cannot be
      checked after the move either: see docs/validation-limits.md. yasb's
      CSS loader only logs on file-read errors, and its bundled CSS parser
      does spec-mandated lenient error recovery, so content corruption is
      invisible to the post-copy log grep -- confirmed live (Task 8 report).
      The checks below are therefore the ONLY gate for yasb; they run
      pre-copy, deliberately, so a rejection here never touches a live file.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path,
        [string]$LastGoodDir = $script:LastGood
    )

    $text = [System.IO.File]::ReadAllText($Path)

    # An unresolved template expression means matugen silently skipped a role.
    if ($text -match '\{\{') {
        Write-Warning "$Name still contains an unrendered '{{' expression"
        return $false
    }

    switch ($Name) {
        'yasb' {
            # Structural checks only -- no offline QSS/CSS validator exists
            # (Qt's own parser doesn't surface content errors either; see
            # docs/validation-limits.md). Each check below was proven to
            # actually fire against real corruption, not just synthetic
            # fixtures -- see tests/ApplyTheme.Tests.ps1.

            # Count braces with Measure-CssBraces, a string-aware scanner --
            # NOT a regex comment-stripper. An earlier version of this
            # stripped /* ... */ via regex, which has no notion of string
            # context: `content: "/*"; ... content: "*/";` spanning two
            # separate rules would be seen as one giant comment, silently
            # deleting real code between them and producing a false PASS on
            # genuinely corrupt content -- found by external review. See
            # Measure-CssBraces's own doc comment for the full case.
            #
            # This also still catches the original Task 8 finding (a brace
            # hidden inside a real, non-string comment: deleted one closing
            # brace from `.cpu-widget .icon { ... }` and added a
            # compensating `}` inside `/* MEMORY */` -- raw count 175/175,
            # comment-aware count correctly reports 175/174).
            $counts = Measure-CssBraces -Text $text
            if ($counts.UnterminatedComment) {
                Write-Warning "styles.css has an unterminated /* comment -- truncated or corrupt"
                return $false
            }

            # Balanced braces: catches truncation and unterminated blocks.
            # This alone would have caught the Task 8 unterminated-block
            # corruption that the log check missed entirely.
            $open  = $counts.Open
            $close = $counts.Close
            if ($open -ne $close) {
                Write-Warning "styles.css has unbalanced braces ($open open, $close close)"
                return $false
            }

            $lastGoodPath = Join-Path $LastGoodDir 'styles.css'
            if (Test-Path $lastGoodPath) {
                $lastGoodItem = Get-Item $lastGoodPath
                $lastGoodText = [System.IO.File]::ReadAllText($lastGoodPath)
                $lastGoodCounts = Measure-CssBraces -Text $lastGoodText

                # Selector-count sanity: a palette swap only rewrites color
                # values, never adds/removes rules, so the number of rule
                # blocks (one `{` per selector prelude) should stay stable.
                # +-5% tolerance for incidental future template edits.
                # Comment-and-string-aware on both sides -- the real
                # state/last-good-prev/styles.css carries a multi-line
                # "Acrylic recipe" prose comment that could itself gain a
                # stray brace and skew this baseline if counted naively.
                $lastRuleCount = $lastGoodCounts.Open
                if ($lastRuleCount -gt 0) {
                    $ruleDelta = [math]::Abs($open - $lastRuleCount) / $lastRuleCount
                    if ($ruleDelta -gt 0.05) {
                        Write-Warning "styles.css rule count changed by $([math]::Round($ruleDelta * 100, 1))% ($lastRuleCount -> $open braces) -- more than the 5% tolerance"
                        return $false
                    }
                }

                # Size sanity: catches truncation and runaway duplication
                # that could coincidentally preserve rule count and balance.
                # +-20% tolerance. Deliberately stays on the RAW (comment-
                # included) byte length -- comments are legitimate file
                # content, and stripping them here would let comment-based
                # padding or truncation slip past this specific check; the
                # brace-balance and rule-count checks above already use the
                # comment-stripped text for what they measure.
                $size     = (Get-Item $Path).Length
                $lastSize = $lastGoodItem.Length
                if ($lastSize -gt 0) {
                    $sizeDelta = [math]::Abs($size - $lastSize) / $lastSize
                    if ($sizeDelta -gt 0.20) {
                        Write-Warning "styles.css size changed by $([math]::Round($sizeDelta * 100, 1))% ($lastSize -> $size bytes) -- more than the 20% tolerance"
                        return $false
                    }
                }
            }
            # else: no last-good baseline yet (first-ever apply) -- nothing
            # to compare against, so only the brace-balance check above applies.

            return $true
        }
        'wezterm' {
            # Structural check, not a full Lua parse: no interpreter is installed.
            if ($text -notmatch '(?s)^\s*--.*?return\s*\{' -and $text -notmatch '(?s)^\s*return\s*\{') {
                Write-Warning "palette.lua does not open with a return table"
                return $false
            }
            # Strip full-line Lua comments before the structural checks below.
            # The real Task 4 template has a header comment block containing
            # quoted English prose (e.g. "Monokai Pro Octagon") -- run the
            # brace-balance and hex-value checks over that raw text and every
            # real render is rejected as invalid, permanently. Only lines
            # actually part of the `return { ... }` table should be checked.
            $codeLines = $text -split "`r?`n" | Where-Object { $_ -notmatch '^\s*--' }
            $code = $codeLines -join "`n"

            $open  = ([regex]::Matches($code, '\{')).Count
            $close = ([regex]::Matches($code, '\}')).Count
            if ($open -ne $close) {
                Write-Warning "palette.lua has unbalanced braces ($open open, $close close)"
                return $false
            }
            # Every quoted value should be a hex color.
            foreach ($m in [regex]::Matches($code, '"([^"]*)"')) {
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

function Update-LastGood {
    <#
      Atomically promotes this run's staged output to state/last-good/,
      rotating the previous last-good into state/last-good-prev/.

      The first version of this did four independent per-file Copy-Item
      calls directly into last-good/last-good-prev. A crash or disk error
      between targets could leave the two directories holding a MIX of two
      theme generations across the four files -- an inconsistent baseline
      that would restore a Frankenstein theme if ever rolled back to.

      This version stages the whole new generation in state/last-good-new/
      first, then does the promotion as two directory renames:
      last-good -> last-good-prev, last-good-new -> last-good. A rename on
      the same volume is a single filesystem metadata update, not a byte
      copy, so it's effectively atomic -- the window of inconsistency
      shrinks from spanning eight file copies to two renames.

      Handles the first-run case where neither last-good nor
      last-good-prev exists yet: the "rotate old last-good to prev" rename
      is skipped when there's nothing to rotate.

      Also handles an INTERRUPTED PRIOR rotation: last-good absent but
      last-good-prev present (reachable without any tampering -- a crash
      between the two Rename-Item calls below, after last-good ->
      last-good-prev succeeds but before last-good-new -> last-good runs,
      leaves exactly this state). The first version of this removed
      last-good-prev unconditionally before checking whether last-good
      existed to replace it, so the next successful apply silently
      discarded that fallback with no warning -- found by external review.
      last-good-prev is only ever removed/replaced when last-good actually
      exists to be promoted into it; if last-good is missing but
      last-good-prev is present, last-good-prev is left alone and a
      warning is logged instead.

      Directories default to the real script-scope paths but can be
      overridden (StagingDir/LastGoodDir/LastGoodPrevDir/LastGoodNewDir),
      the same pattern Test-StagedFile uses for -LastGoodDir, so this can
      be exercised end-to-end against an isolated temp fixture in tests
      without ever touching the real state/last-good/.
    #>
    [CmdletBinding()]
    param(
        [string]$StagingDir      = $script:Staging,
        [string]$LastGoodDir     = $script:LastGood,
        [string]$LastGoodPrevDir = $script:LastGoodPrev,
        [string]$LastGoodNewDir  = $script:LastGoodNew
    )

    if (Test-Path $LastGoodNewDir) { Remove-Item $LastGoodNewDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $LastGoodNewDir | Out-Null
    foreach ($t in $script:Targets) {
        Copy-Item (Join-Path $StagingDir $t.Staged) (Join-Path $LastGoodNewDir $t.Staged) -Force
    }

    if (Test-Path $LastGoodDir) {
        # last-good exists and is about to be promoted into last-good-prev:
        # safe to discard whatever last-good-prev held.
        if (Test-Path $LastGoodPrevDir) { Remove-Item $LastGoodPrevDir -Recurse -Force }
        Rename-Item -Path $LastGoodDir -NewName (Split-Path $LastGoodPrevDir -Leaf)
    } elseif (Test-Path $LastGoodPrevDir) {
        # last-good is missing but last-good-prev exists: nothing to
        # rotate INTO it this run, so leave it exactly as-is rather than
        # deleting the one fallback that survived. This state is reachable
        # by an interrupted prior rotation (see doc comment above), not
        # just first-run.
        Write-Warning "last-good is missing but last-good-prev exists -- a prior rotation may have been interrupted. Leaving last-good-prev untouched."
    }
    # else: neither exists yet (genuine first-ever apply) -- nothing to do
    # here, last-good-prev correctly stays absent.

    Rename-Item -Path $LastGoodNewDir -NewName (Split-Path $LastGoodDir -Leaf)
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

    # last-good and last-good-prev are deliberately NOT pre-created here.
    # Update-LastGood manages their existence entirely via directory
    # renames (see its own comment) -- pre-creating empty directories would
    # only complicate that dance for no benefit. Test-StagedFile's yasb
    # check and the rollback loop below both use file-level Test-Path
    # against paths inside them, which is false whether the file or the
    # containing directory is missing, so neither needs the directory to
    # pre-exist.
    New-Item -ItemType Directory -Force -Path $script:Staging | Out-Null

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

    # NOTE: last-good is deliberately NOT refreshed here from current live
    # content. It used to be (a pre-copy snapshot-from-live), which meant an
    # undetected-bad apply became the new "last known good" baseline on the
    # very next run, silently destroying the only real safety net (found for
    # real in Task 8: an undetected-broken yasb stylesheet got snapshotted as
    # last-good by the following apply). last-good is now only refreshed
    # further down, after THIS run has passed every check -- pre-copy
    # structural validation AND the post-copy log check.

    # Mark both logs BEFORE copying -- tacky-borders may react to its config
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

    # Passed every check (pre-copy structural validation + post-copy log
    # check): only NOW is it safe to call this run's output "known good".
    # Rotate two generations atomically (see Update-LastGood) -- so a
    # single bad-but-undetected apply cannot, by itself, destroy the only
    # known-good copy, and a crash mid-rotation can't leave last-good
    # holding a mix of two theme generations across the four files.
    Update-LastGood

    # Force WezTerm to notice the new palette (see docs/spikes.md, unknown #2).
    if (Test-Path "$env:USERPROFILE\.wezterm.lua") {
        (Get-Item "$env:USERPROFILE\.wezterm.lua").LastWriteTime = Get-Date
    }

    return [PSCustomObject]@{ Success = $true; Failed = @() }
}
