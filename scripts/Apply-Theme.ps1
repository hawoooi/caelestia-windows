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
# state/pre-apply/ is a SEPARATE snapshot from state/last-good/ -- see
# New-PreApplySnapshot's own comment. last-good is the last VALIDATED
# pipeline generation; pre-apply is whatever was live a moment ago,
# hand-edits included. Deliberately not reused/aliased with LastGood*.
$script:PreApply    = Join-Path $script:Root "state\pre-apply"
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

      Returns @{ Open = <int>; Close = <int>; UnterminatedComment = <bool>;
      UnterminatedString = <bool> }.

      An unterminated `/*` (scanner still InComment at end of input) is
      itself suspicious -- truncation mid-comment -- and is surfaced so the
      caller can fail closed rather than silently treating the rest of a
      truncated file as "no braces found here". The same applies to an
      unterminated quote: without UnterminatedString, an unclosed `"` (or
      `'`) swallows every real `{`/`}` from that point to EOF as "inside a
      string", and if what's left happens to balance, a genuinely corrupt
      file passes. Found live by external review:
      `.a{...} .b{...} .c[title="unterminated` + newline + `{ color: green;
      }` -- the unterminated `"unterminated` swallows the rest of `.c`'s
      selector and the next real rule's opening `{`, leaving Open=2/Close=2
      (coincidentally balanced) and UnterminatedComment=$false. Confirmed
      empirically against the pre-fix code before this flag existed:
      `Test-StagedFile` returned `$true` on it, both with no baseline and
      with a baseline hand-tuned to also match on size and rule count.
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

    return @{ Open = $open; Close = $close; UnterminatedComment = $inComment; UnterminatedString = $inString }
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
        [string]$LastGoodDir = $script:LastGood,
        # I7: bypasses the yasb rule-count/size comparison against
        # last-good below. The +-5%/+-20% tolerances assume a palette swap
        # never adds/removes rules -- a maintainer genuinely adding ~9 rules
        # to a 175-block file (an intentional, legitimate structural
        # change) is otherwise rejected FOREVER, because every future apply
        # keeps comparing against the same stale last-good baseline that
        # can never pass (CLAUDE.md's old remedy for this was circular: it
        # says the baseline "re-baselines automatically... the next time
        # Apply-Theme succeeds", but Apply-Theme can't succeed BECAUSE the
        # baseline rejects it). Passing this switch for one apply skips
        # only the rule-count/size comparison (brace-balance and
        # unterminated-comment/string checks -- the ones that actually
        # catch corruption -- still run); if that apply then succeeds,
        # Update-LastGood re-baselines normally and subsequent applies are
        # compared against the new, larger baseline.
        [switch]$AcceptStructuralChange
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
            if ($counts.UnterminatedString) {
                Write-Warning "styles.css has an unterminated string literal -- truncated or corrupt"
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
                if (-not $AcceptStructuralChange) {
                    $lastRuleCount = $lastGoodCounts.Open
                    if ($lastRuleCount -gt 0) {
                        $ruleDelta = [math]::Abs($open - $lastRuleCount) / $lastRuleCount
                        if ($ruleDelta -gt 0.05) {
                            Write-Warning "styles.css rule count changed by $([math]::Round($ruleDelta * 100, 1))% ($lastRuleCount -> $open braces) -- more than the 5% tolerance (pass -AcceptStructuralChange if this is an intentional template edit)"
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
                            Write-Warning "styles.css size changed by $([math]::Round($sizeDelta * 100, 1))% ($lastSize -> $size bytes) -- more than the 20% tolerance (pass -AcceptStructuralChange if this is an intentional template edit)"
                            return $false
                        }
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
            # I3: without this guard, starship missing from PATH raises a
            # non-terminating "term not recognized" error from `&`, which
            # leaves $LASTEXITCODE at whatever it was BEFORE this call --
            # in the real Apply-Theme flow, 0, from matugen's own preceding
            # success check. That stale 0 reads as "starship accepted the
            # config", silently passing validation for a target that was
            # never actually checked at all. Fail closed instead.
            if (-not (Get-Command starship -ErrorAction SilentlyContinue)) {
                Write-Warning "starship is not on PATH -- cannot validate starship.toml, failing closed"
                return $false
            }
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
        'tacky' {
            # I2: tacky-borders has no offline validator and no CLI to
            # dry-run a config against (same ceiling as yasb -- see
            # docs/validation-limits.md), so this is a structural sanity
            # check, not a real YAML parse. Previously fell through to the
            # `default` case below, i.e. zero validation at all -- verified
            # that a completely garbage staged file ("totally: garbage`n
            # not even: [yaml") passed unconditionally before this fix.
            $requiredKeys = 'watch_config_changes', 'enable_logging', 'rendering_backend', 'global', 'window_rules'
            foreach ($key in $requiredKeys) {
                if ($text -notmatch "(?m)^$([regex]::Escape($key)):") {
                    Write-Warning "tacky-config.yaml is missing expected top-level key '$key'"
                    return $false
                }
            }
            # Balanced quotes: an odd count of un-escaped quote characters
            # means a value's quoting broke mid-render (e.g. a truncated
            # matugen expression), which YAML has to reject or misparse.
            $dq = ([regex]::Matches($text, '(?<!\\)"')).Count
            if ($dq % 2 -ne 0) {
                Write-Warning "tacky-config.yaml has an unbalanced double-quote count ($dq)"
                return $false
            }
            $sq = ([regex]::Matches($text, "(?<!\\)'")).Count
            if ($sq % 2 -ne 0) {
                Write-Warning "tacky-config.yaml has an unbalanced single-quote count ($sq)"
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

function Test-YasbLogFailure {
    <#
      I1: the post-copy yasb.log check used to grep the whole log tail for
      '(?i)error|critical|invalid|could not be read' -- a pattern that
      matches ANY widget's log output, not just CSS/stylesheet-loading
      failures. yasb.log carries every widget's own errors on the same
      timeline (traffic_manager JSON errors, glazewm_client websocket
      reconnects, a KeyError from an unrelated callback -- all observed for
      real in the live log, 7 matching lines with zero relation to
      styles.css). Any one of those landing in the 8-second post-copy
      window triggered a full four-target rollback for a stylesheet that
      was never actually the problem.

      Narrowed to the one signal documented (docs/validation-limits.md) as
      actually specific to CSS loading: yasb's CSSProcessor logs
      "CSSProcessor Error '%s': %s" specifically on a file-level read
      failure (missing file, permission denied -- see
      CSSProcessor._read_css_file in that doc). Matching on "CSSProcessor"
      keeps the log check able to catch the one failure class it CAN see
      (docs/validation-limits.md: "kept as a secondary signal... must
      never again be the only signal") while eliminating the false-positive
      class that made it a liability instead. Chose narrowing the pattern
      over making the check warn-only, specifically so it can still
      trigger a real rollback for the failure it's actually able to detect
      -- a warn-only check that never rejects anything is not a check
      (this project's own stated principle, docs/validation-limits.md).

      tacky-borders' log check is NOT narrowed the same way: it is not
      shared across dozens of widgets the way yasb.log is (tacky-borders
      logs only its own activity), so the false-positive class this fixes
      doesn't apply there.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$LogTail)
    return $LogTail -match '(?i)CSSProcessor'
}

function New-PreApplySnapshot {
    <#
      C2: snapshots the CURRENT live content of every target into a
      SEPARATE state/pre-apply/ directory, immediately before Apply-Theme's
      copy loop overwrites them.

      This is deliberately NOT state/last-good/. last-good is the last
      VALIDATED PIPELINE generation (see Apply-Theme's own comment above
      its Update-LastGood call) -- it is refreshed only after a full
      successful apply, not before every apply. A live file can drift from
      that baseline between applies with nothing wrong at all: e.g. a hand
      edit to ~/.config/starship.toml, which is not itself a git repo and
      has no history of its own. If a LATER apply fails post-copy and rolls
      back from last-good, that hand edit is gone -- overwritten with the
      pipeline's own prior output, not restored to what was actually live.
      This snapshot exists so rollback restores exactly what was live a
      moment ago, hand edits included.

      Targets/PreApplyDir default to the real script-scope values but can
      be overridden for isolated testing, the same pattern
      Test-StagedFile/Update-LastGood use.
    #>
    [CmdletBinding()]
    param(
        [array]$Targets     = $script:Targets,
        [string]$PreApplyDir = $script:PreApply
    )
    if (Test-Path $PreApplyDir) { Remove-Item $PreApplyDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $PreApplyDir | Out-Null
    foreach ($t in $Targets) {
        if (Test-Path $t.Live) {
            Copy-Item $t.Live (Join-Path $PreApplyDir $t.Staged) -Force
        }
        # else: no live file yet for this target (first-ever apply) --
        # nothing to snapshot. Restore-PreApplySnapshot's Test-Path guard
        # correctly no-ops for it too; same first-run limitation
        # state/last-good/-based rollback always had, not a regression.
    }
}

function Restore-PreApplySnapshot {
    <#
      The other half of New-PreApplySnapshot -- restores every target's
      live path from the pre-apply snapshot. See New-PreApplySnapshot's
      comment for why this is a separate directory from state/last-good/.
    #>
    [CmdletBinding()]
    param(
        [array]$Targets     = $script:Targets,
        [string]$PreApplyDir = $script:PreApply
    )
    foreach ($t in $Targets) {
        $backup = Join-Path $PreApplyDir $t.Staged
        if (Test-Path $backup) { Copy-Item $backup $t.Live -Force }
    }
}

function Copy-StagedToLive {
    <#
      I4: copies every staged target over its live path. Wrapped with
      -ErrorAction Stop so a mid-loop failure (disk full, permission
      denied, a live path locked by another process) throws immediately
      instead of the previous behaviour -- Copy-Item failures are
      non-terminating by default, and with no try/catch and
      $ErrorActionPreference never set, a failure partway through this
      loop would print a red error and carry straight on to the next
      target, and then to the post-copy checks and a possible
      Update-LastGood promotion, all against a LIVE state that is a mix of
      old and new content across the four targets with nothing having
      caught it.

      Targets/StagingDir default to the real script-scope values but can be
      overridden for isolated testing (same pattern as
      Test-StagedFile/Update-LastGood/New-PreApplySnapshot).
    #>
    [CmdletBinding()]
    param(
        [array]$Targets    = $script:Targets,
        [string]$StagingDir = $script:Staging
    )
    foreach ($t in $Targets) {
        Copy-Item (Join-Path $StagingDir $t.Staged) $t.Live -Force -ErrorAction Stop
    }
}

function Resolve-ImageFromState {
    <#
      I6: state/current.json is written by Switch-Wallpaper on every
      successful (non-DryRun) apply -- { wallpaper, preview, appliedUtc } --
      specifically so Apply-Theme can be re-run (e.g. after a template or
      mapping change, per CLAUDE.md's "How to add a new theme target")
      without re-querying Wallpaper Engine. Previously nothing ever read
      it back -- write-only state carrying information nobody could use.
      This is the read side of that contract: falls back to its `preview`
      field when Apply-Theme is called with no -Image.
    #>
    [CmdletBinding()]
    param([string]$CurrentJsonPath = (Join-Path $script:Root "state\current.json"))

    if (-not (Test-Path $CurrentJsonPath)) { return $null }
    $text = [System.IO.File]::ReadAllText($CurrentJsonPath)
    try {
        $obj = $text | ConvertFrom-Json
    } catch {
        Write-Warning "state\current.json could not be parsed: $($_.Exception.Message)"
        return $null
    }
    if (-not $obj.preview) { return $null }
    return $obj.preview
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

      I4: every Copy-Item/Rename-Item below now passes -ErrorAction Stop.
      Previously none of them did, all failures were non-terminating, and
      nothing caught them -- so e.g. a staged file missing for one target
      (Copy-Item fails, prints a red error, loop continues to the next
      target regardless) still went on to run BOTH renames and promote an
      INCOMPLETE last-good-new -- missing that one target's file -- to
      last-good, silently orphaning the previous good generation's content
      for it. -ErrorAction Stop turns that into a terminating exception
      that propagates out of this function before either rename runs,
      leaving the existing last-good (if any) completely untouched. The
      caller (Apply-Theme) wraps its call to this function in try/catch and
      surfaces the failure as a warning rather than crashing -- the live
      theme, if this is reached, has already been copied and validated
      successfully; only the last-good bookkeeping failed, which does not
      warrant rolling back a good live apply.
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
        Copy-Item (Join-Path $StagingDir $t.Staged) (Join-Path $LastGoodNewDir $t.Staged) -Force -ErrorAction Stop
    }

    if (Test-Path $LastGoodDir) {
        # last-good exists and is about to be promoted into last-good-prev:
        # safe to discard whatever last-good-prev held.
        if (Test-Path $LastGoodPrevDir) { Remove-Item $LastGoodPrevDir -Recurse -Force }
        Rename-Item -Path $LastGoodDir -NewName (Split-Path $LastGoodPrevDir -Leaf) -ErrorAction Stop
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

    Rename-Item -Path $LastGoodNewDir -NewName (Split-Path $LastGoodDir -Leaf) -ErrorAction Stop
}

function Apply-Theme {
    [CmdletBinding()]
    param(
        [string]$Image,
        [string]$Scheme = 'scheme-tonal-spot',
        [switch]$DryRun,
        [switch]$AcceptStructuralChange
    )

    $failed = @()

    if (-not $Image) {
        # I6: re-render without an explicit probe image by falling back to
        # state/current.json's `preview` -- see Resolve-ImageFromState.
        $Image = Resolve-ImageFromState
        if (-not $Image) {
            Write-Warning "-Image not given and state\current.json has no usable 'preview' to fall back to"
            return [PSCustomObject]@{ Success = $false; Failed = @('preflight') }
        }
        Write-Host "No -Image given; falling back to state\current.json's preview: $Image"
    }

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
        if (-not (Test-StagedFile -Name $t.Name -Path $staged -AcceptStructuralChange:$AcceptStructuralChange)) { $failed += $t.Name }
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

    # C2: snapshot what's ACTUALLY LIVE right now, separately from
    # last-good, immediately before it gets overwritten -- see
    # New-PreApplySnapshot's own comment for why this can't just be
    # last-good/. This is the source the rollback below restores from.
    New-PreApplySnapshot

    # Mark both logs BEFORE copying -- tacky-borders may react to its config
    # changing on disk, without waiting for an explicit reload.
    $yasbLog  = "$env:USERPROFILE\.config\yasb\yasb.log"
    $tackyLog = "$env:USERPROFILE\.config\tacky-borders\tacky-borders.log"
    $yasbMark  = 0; $tackyMark = 0
    if (Test-Path $yasbLog)  { $yasbMark  = (Get-Item $yasbLog).Length }
    if (Test-Path $tackyLog) { $tackyMark = (Get-Item $tackyLog).Length }

    try {
        Copy-StagedToLive
    } catch {
        # I4: a partial copy (some targets written, one failed) must not be
        # left standing -- restore everything from the pre-apply snapshot
        # taken a moment ago and bail out before the post-copy checks or
        # Update-LastGood ever run.
        Write-Warning "Copy to live config failed: $($_.Exception.Message). Rolling back all targets from the pre-apply snapshot."
        Restore-PreApplySnapshot
        & $script:Yasbc reload | Out-Null
        return [PSCustomObject]@{ Success = $false; Failed = @('copy') }
    }

    & $script:Yasbc reload | Out-Null
    Start-Sleep -Seconds 8

    # I1: narrowed from a blanket error|critical|invalid|could not be read
    # grep (which matches ANY widget's log output, not just CSS-loading
    # failures -- see Test-YasbLogFailure's own comment) to the one signal
    # documented as actually specific to yasb's stylesheet loader.
    if (Test-YasbLogFailure -LogTail (Get-LogTail -Path $yasbLog -Offset $yasbMark)) { $failed += 'yasb' }

    # tacky-borders is not installed here (see docs/spikes.md, unknown #3).
    # Only trust its log when the process is actually running, otherwise the
    # tail is stale output from a previous session and means nothing. Not
    # narrowed like yasb's check above -- tacky-borders logs only its own
    # activity, not dozens of unrelated widgets, so the false-positive class
    # I1 fixes for yasb doesn't apply here.
    $pattern = '(?i)error|critical|invalid|could not be read'
    if (Get-Process -Name 'tacky-borders' -ErrorAction SilentlyContinue) {
        if ((Get-LogTail -Path $tackyLog -Offset $tackyMark) -match $pattern) { $failed += 'tacky' }
    }

    if ($failed.Count -gt 0) {
        Write-Warning "Rejected by: $($failed -join ', '). Rolling back all targets."
        Restore-PreApplySnapshot
        & $script:Yasbc reload | Out-Null
        return [PSCustomObject]@{ Success = $false; Failed = $failed }
    }

    # Passed every check (pre-copy structural validation + post-copy log
    # check): only NOW is it safe to call this run's output "known good".
    # Rotate two generations atomically (see Update-LastGood) -- so a
    # single bad-but-undetected apply cannot, by itself, destroy the only
    # known-good copy, and a crash mid-rotation can't leave last-good
    # holding a mix of two theme generations across the four files.
    try {
        Update-LastGood
    } catch {
        # I4: the live theme above already copied and validated
        # successfully -- that's not in question here. Only the last-good
        # bookkeeping failed (e.g. a mid-rotation disk error), which does
        # NOT warrant rolling back a good live apply; surface it loudly
        # instead of leaving it silently orphaned, since it means the next
        # apply's structural baseline (and any future rollback) is still
        # working off the PREVIOUS generation until a future apply succeeds.
        Write-Warning "Update-LastGood failed: $($_.Exception.Message). The live theme applied successfully, but state\last-good was NOT refreshed."
    }

    # Force WezTerm to notice the new palette (see docs/spikes.md, unknown #2).
    if (Test-Path "$env:USERPROFILE\.wezterm.lua") {
        (Get-Item "$env:USERPROFILE\.wezterm.lua").LastWriteTime = Get-Date
    }

    return [PSCustomObject]@{ Success = $true; Failed = @() }
}
