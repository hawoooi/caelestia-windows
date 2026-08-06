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

# C1: Restart-ZebarWidgets (below) needs to read ~/.glzr/zebar/settings.json's
# startupConfigs to know EVERY pack/widget it must restart after killing
# zebar.exe, not just this pack's own bar. Get-ZebarStartupConfigs is defined
# in Install-Config.ps1 (I4's writer for the same file/field lives there
# too) -- dot-sourcing it here has no side effects at load time (it only
# defines functions) and keeps both the writer (Install-Config) and this
# reader (Apply-Theme) working off one shared parsing implementation instead
# of two that could drift apart.
. (Join-Path $PSScriptRoot "Install-Config.ps1")

$script:Staging     = Join-Path $script:Root "state\staging"
$script:LastGood    = Join-Path $script:Root "state\last-good"
$script:LastGoodPrev= Join-Path $script:Root "state\last-good-prev"
$script:LastGoodNew = Join-Path $script:Root "state\last-good-new"
# state/pre-apply/ is a SEPARATE snapshot from state/last-good/ -- see
# New-PreApplySnapshot's own comment. last-good is the last VALIDATED
# pipeline generation; pre-apply is whatever was live a moment ago,
# hand-edits included. Deliberately not reused/aliased with LastGood*.
$script:PreApply    = Join-Path $script:Root "state\pre-apply"
$script:ZebarExe    = "C:\Program Files\glzr.io\Zebar\zebar.exe"

# yasb and tacky-borders were retired as pipeline targets: yasb is replaced
# by the Zebar bar (docked left) and komorebi's own window borders now do
# the job tacky-borders' template was built for but never actually used
# (tacky-borders was never installed on this machine -- see CLAUDE.md).
# Their templates (matugen/templates/yasb.styles.css,
# matugen/templates/tacky-borders.yaml) are kept on disk, unwired from
# matugen/config.toml and from this list, so the work stays recoverable.
$script:Targets = @(
    @{ Name='wezterm';  Staged='palette.lua';      Live="$env:USERPROFILE\.config\palette.lua" }
    @{ Name='starship'; Staged='starship.toml';    Live="$env:USERPROFILE\.config\starship.toml" }
    # Unlike the two targets above, this one lives INSIDE the repo -- the
    # zebar pack is tracked, and theme.css is a committed generated
    # artifact (see Task 9 brief).
    @{ Name='zebar';    Staged='theme.css';        Live="$script:Root\zebar\caelestia\bar\theme.css" }
)

function Measure-CssBraces {
    <#
      Single-pass, string-aware brace counter used by Test-StagedFile's
      structural checks. F8: originally written for yasb's styles.css
      structural check; that target was retired along with tacky-borders
      (see CLAUDE.md's "The stack" table and "Window borders and gaps"
      section), and this function's only caller today is the 'zebar'
      branch of Test-StagedFile's switch, below.

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

      yasb and tacky-borders were retired as theming targets (see CLAUDE.md's
      "The stack" table and "Window borders and gaps" section) -- the
      -AcceptStructuralChange switch this function used to accept (I7)
      existed ONLY to bypass yasb's rule-count/size comparison against
      state/last-good/styles.css, which no longer exists as a check at all
      now that the 'yasb' case is gone. Removed along with it rather than
      left as dead, unreachable plumbing.

      F5: -LastGoodDir was removed from this function's parameters -- it
      existed only for that same retired yasb rule-count/size comparison
      and had been left unreferenced (no caller ever passed it) since that
      comparison was deleted. Update-LastGood has its own, unrelated,
      still-live -LastGoodDir parameter -- don't confuse the two.
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
        'zebar' {
            # theme.css is loaded directly by zebar/caelestia/bar/style.css,
            # which is held to a global invariant: ZERO colour literals,
            # only var(--...) references. That invariant only holds if the
            # generated file it depends on can NEVER carry anything but
            # custom-property declarations -- no selectors, no layout, no
            # literal rules that could quietly start being relied on. This
            # branch is what enforces that on the generated side.

            # Brace balance, reusing the same string-aware scanner the yasb
            # branch uses (see Measure-CssBraces's own comment) -- a naive
            # regex comment-stripper has the same false-pass exposure here
            # it does for styles.css.
            $counts = Measure-CssBraces -Text $text
            if ($counts.UnterminatedComment) {
                Write-Warning "theme.css has an unterminated /* comment -- truncated or corrupt"
                return $false
            }
            if ($counts.UnterminatedString) {
                Write-Warning "theme.css has an unterminated string literal -- truncated or corrupt"
                return $false
            }
            if ($counts.Open -ne $counts.Close) {
                Write-Warning "theme.css has unbalanced braces ($($counts.Open) open, $($counts.Close) close)"
                return $false
            }

            # The invariant: every non-blank line inside :root { } must be a
            # custom-property declaration (`--name: value;`). This is what
            # keeps layout out of the generated file -- a `color: red;` (or
            # any other literal CSS declaration) rendered into theme.css
            # would still be syntactically valid CSS and would still pass
            # every check above, but would violate the zero-colour-literal
            # contract style.css depends on. Reject it here, before it ever
            # reaches the live pack.
            $rootMatch = [regex]::Match($text, '(?s):root\s*\{(.*?)\}')
            if (-not $rootMatch.Success) {
                Write-Warning "theme.css has no :root { } block"
                return $false
            }
            foreach ($line in ($rootMatch.Groups[1].Value -split "`r?`n")) {
                $trimmed = $line.Trim()
                if ($trimmed.Length -eq 0) { continue }
                if ($trimmed -notmatch '^--[\w-]+\s*:') {
                    Write-Warning "theme.css has a non-custom-property declaration inside :root: '$trimmed'"
                    return $false
                }
            }
            return $true
        }
        default { return $true }
    }
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

      F2: also snapshots ~/komorebi.json here, even though it is NOT one of
      $script:Targets (it has no Staged/rendered counterpart of its own --
      Update-KomorebiBorderTheme mutates it directly, structurally, later
      in the run). Before this, every real target had a pre-apply recovery
      path except this one, hand-maintained file living outside any git
      repo -- the most asymmetric gap the review found. KomorebiJsonPath
      defaults to the real path but is overridable for isolated testing,
      same as everything else here.
    #>
    [CmdletBinding()]
    param(
        [array]$Targets          = $script:Targets,
        [string]$PreApplyDir     = $script:PreApply,
        [string]$KomorebiJsonPath = "$env:USERPROFILE\komorebi.json"
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
    if (Test-Path $KomorebiJsonPath) {
        Copy-Item $KomorebiJsonPath (Join-Path $PreApplyDir 'komorebi.json') -Force
    }
}

function Restore-PreApplySnapshot {
    <#
      The other half of New-PreApplySnapshot -- restores every target's
      live path from the pre-apply snapshot. See New-PreApplySnapshot's
      comment for why this is a separate directory from state/last-good/.

      F2: also restores ~/komorebi.json if a snapshot of it exists -- see
      New-PreApplySnapshot's own comment for why it's handled here despite
      not being one of $script:Targets.
    #>
    [CmdletBinding()]
    param(
        [array]$Targets          = $script:Targets,
        [string]$PreApplyDir     = $script:PreApply,
        [string]$KomorebiJsonPath = "$env:USERPROFILE\komorebi.json"
    )
    foreach ($t in $Targets) {
        $backup = Join-Path $PreApplyDir $t.Staged
        if (Test-Path $backup) { Copy-Item $backup $t.Live -Force }
    }
    $komorebiBackup = Join-Path $PreApplyDir 'komorebi.json'
    if (Test-Path $komorebiBackup) { Copy-Item $komorebiBackup $KomorebiJsonPath -Force }
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
      the same override-parameter pattern used throughout this file (see
      New-PreApplySnapshot/Restore-PreApplySnapshot's Targets/PreApplyDir/
      KomorebiJsonPath), so this can be exercised end-to-end against an
      isolated temp fixture in tests without ever touching the real
      state/last-good/. (F5: this docstring previously pointed at
      Test-StagedFile's own -LastGoodDir parameter as "the same pattern" --
      that parameter was unreferenced dead plumbing left over from yasb's
      retired rule-count/size check and has been removed; this is a
      different, still-live parameter on a different function.)

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

function Test-ZebarThemeChanged {
    <#
      Task 9 deferred minor, folded into C1's fix: gates the (now
      multi-widget, see Restart-ZebarWidgets below) zebar restart on
      theme.css having actually changed, instead of unconditionally
      killing/restarting EVERY autostarted Zebar widget on every single
      Apply-Theme run regardless of whether this pack's stylesheet moved at
      all. Reducing how often the restart fires directly reduces how often
      C1's failure mode (a killed widget that doesn't come back) can bite.

      Must be called BEFORE Copy-StagedToLive -- once that runs, LivePath
      is overwritten with StagedPath's content and every call would trivially
      report "unchanged".

      Returns $true (restart needed) when LivePath doesn't exist yet (first
      apply) or StagedPath is missing (fail toward restarting, not toward
      silently skipping a real change).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StagedPath,
        [Parameter(Mandatory)][string]$LivePath
    )

    if (-not (Test-Path $LivePath)) { return $true }
    if (-not (Test-Path $StagedPath)) { return $false }
    return ([System.IO.File]::ReadAllText($StagedPath)) -ne ([System.IO.File]::ReadAllText($LivePath))
}

function Restart-ZebarWidgets {
    <#
      C1: the previous version of this step did
      `Get-Process zebar | Stop-Process -Force`, unconditionally killing
      EVERY Zebar widget process on the machine -- not just this pack's --
      then started back up ONLY caelestia/bar. The code comment justified
      this by "only one widget is running today", which is true in this dev
      environment but false against the REAL, live
      ~/.glzr/zebar/settings.json, which autostarts a second pack
      (gunturdwiap.good-enough) alongside this one. Every real machine
      reboot -- which is also the documented WebView2 recovery step, so it
      WILL happen -- silently and permanently drops that other widget's bar
      the next time anything calls Apply-Theme, with no log entry anywhere.

      Fix: read settings.json's startupConfigs (via Install-Config.ps1's
      Get-ZebarStartupConfigs, dot-sourced at the top of this file -- one
      shared parser, since I4 writes the same field) and restart EVERY
      entry found there, not just this pack's own bar. A missing or
      unparseable settings file restarts only caelestia/bar and WARNS
      loudly rather than either silently doing nothing (leaving the whole
      bar dead) or throwing (which would abort a successful theme apply
      over a cosmetic bookkeeping read).

      Also fixes the "fire and forget" half of C1: `start-widget-preset`
      blocks the calling process for as long as that widget's window stays
      open (see docs/zebar-bar.md), so it can NEVER be waited on to
      completion -- but a start that fails outright (e.g. a bad/renamed
      pack ID, the "user without the caelestia junction" case the review
      called out) exits almost immediately with a nonzero code. Captured
      via -PassThru and checked after StartupWaitMs, surfacing that failure
      as a warning instead of the previous silent no-op.
    #>
    [CmdletBinding()]
    param(
        [string]$ZebarExe     = $script:ZebarExe,
        [string]$SettingsPath = (Join-Path $env:USERPROFILE ".glzr\zebar\settings.json"),
        [int]$StartupWaitMs   = 500
    )

    if (-not (Test-Path $ZebarExe)) {
        Write-Warning "zebar.exe not found at $ZebarExe -- theme.css was updated on disk but no running widget was reloaded"
        return
    }

    $ours = [PSCustomObject]@{ pack = 'caelestia'; widget = 'bar'; preset = 'default' }

    $configs = Get-ZebarStartupConfigs -Path $SettingsPath
    if ($null -eq $configs) {
        Write-Warning "Could not read or parse $SettingsPath -- restarting only caelestia/bar. Any OTHER autostarted Zebar widget will NOT come back until it is restarted manually."
        $toStart = @($ours)
    } else {
        $toStart = @($configs | Where-Object { $_.pack -and $_.widget })
        $haveOurs = [bool]($toStart | Where-Object { $_.pack -eq $ours.pack -and $_.widget -eq $ours.widget })
        if (-not $haveOurs) { $toStart += $ours }
    }

    Get-Process zebar -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds $StartupWaitMs

    foreach ($c in $toStart) {
        $preset = if ($c.preset) { $c.preset } else { 'default' }
        $proc = Start-Process -FilePath $ZebarExe -ArgumentList @(
            'start-widget-preset', '--pack', $c.pack, '--widget-name', $c.widget, '--preset', $preset
        ) -WindowStyle Hidden -PassThru

        # `start-widget-preset` blocks for as long as the widget window
        # stays open, so $proc can never be -Wait-ed on -- but a failed
        # start (bad pack ID, etc.) exits almost immediately. A short poll
        # is the only way to tell "started fine" from "failed silently"
        # without hanging Apply-Theme for the widget's entire lifetime.
        Start-Sleep -Milliseconds $StartupWaitMs
        if ($proc -and $proc.HasExited -and $proc.ExitCode -ne 0) {
            Write-Warning "start-widget-preset failed for pack '$($c.pack)' widget '$($c.widget)' (exit code $($proc.ExitCode)) -- that widget's bar did NOT restart. Check the pack name and that it exists under ~/.glzr/zebar."
        }
    }
}

function ConvertFrom-HexColor {
    <#
      Converts a "#RRGGBB" (or shorthand "#RGB") hex colour string into an
      {R;G;B} integer triplet. `komorebic border-colour` takes three
      DECIMAL integer arguments, not a hex string -- this is the one
      conversion point between matugen's hex output (and this repo's
      mapping conventions, which are hex throughout) and that CLI.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Hex)

    $h = $Hex.Trim().TrimStart('#')
    if ($h.Length -eq 3) {
        $h = ($h.ToCharArray() | ForEach-Object { "$_$_" }) -join ''
    }
    if ($h.Length -ne 6 -or $h -notmatch '^[0-9a-fA-F]{6}$') {
        throw "ConvertFrom-HexColor: '$Hex' is not a valid 3- or 6-digit hex colour"
    }
    return [PSCustomObject]@{
        R = [Convert]::ToInt32($h.Substring(0, 2), 16)
        G = [Convert]::ToInt32($h.Substring(2, 2), 16)
        B = [Convert]::ToInt32($h.Substring(4, 2), 16)
    }
}

function Set-KomorebiBorderColour {
    <#
      Runtime half of the border-colour update: calls
      `komorebic border-colour <R> <G> <B> --window-kind <kind>` against a
      LIVE komorebi process. This changes komorebi's in-memory config only
      -- it is lost on the next komorebi restart. Set-KomorebiBorderColours
      (persist, below) is the durable half of this pair, writing the same
      colours into komorebi.json's border_colours field.

      Fails SOFT, per this pipeline's own rule that a WM being down must
      never fail a theming run: both "komorebic isn't on PATH" and
      "komorebic is on PATH but komorebi.exe isn't running" (the CLI call
      itself errors or returns nonzero talking to a dead IPC pipe) are
      caught and turned into a warning, never a thrown exception.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int]$R,
        [Parameter(Mandatory)][int]$G,
        [Parameter(Mandatory)][int]$B,
        [Parameter(Mandatory)][ValidateSet('single', 'stack', 'monocle', 'unfocused', 'unfocused-locked', 'floating')][string]$WindowKind
    )

    if (-not (Get-Command komorebic -ErrorAction SilentlyContinue)) {
        Write-Warning "komorebic is not on PATH -- skipping runtime border-colour update for '$WindowKind'"
        return
    }
    try {
        & komorebic border-colour $R $G $B --window-kind $WindowKind 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "komorebic border-colour failed for window-kind '$WindowKind' (exit $LASTEXITCODE) -- komorebi may not be running"
        }
    } catch {
        Write-Warning "komorebic border-colour threw for window-kind '$WindowKind': $($_.Exception.Message)"
    }
}

function Set-KomorebiBorderColours {
    <#
      Persists border colours into komorebi.json's border_colours field, so
      a komorebi restart (reboot, crash, `komorebic stop`/`start`) keeps the
      themed colours instead of reverting to whatever was last saved on
      disk. Same structural parse/mutate/serialize pattern
      Set-ZebarStartupConfig (Install-Config.ps1) uses for settings.json --
      preserves every other top-level key (ignore_rules, monitors,
      animation, border_width, ...) untouched, and is idempotent
      (re-running with the same Colours produces the same border_colours
      content, updating in place rather than duplicating).

      komorebi's own schema.json (v0.1.41) documents border_colours.<kind>
      as `anyOf [Rgb, Hex]` -- an {r,g,b} object OR a "#RRGGBB" string are
      both valid. Writing hex strings here (matching matugen's own output
      format) avoids a redundant hex->int->JSON round trip; the runtime
      `komorebic border-colour` CLI call still needs R/G/B integers
      separately (see ConvertFrom-HexColor), since the CLI has no
      hex-accepting form.

      $Colours is a hashtable/PSCustomObject keyed by window-kind
      (single/stack/monocle/unfocused/floating/unfocused_locked -- JSON
      field names use underscores, NOT the CLI's hyphenated
      --window-kind values) -> "#RRGGBB" string. Only the keys present in
      $Colours are written; any kind not supplied is left as whatever it
      already was (or absent).

      F3/F4: `$obj` must be a genuine JSON object before anything below
      touches it. Two malformed-but-not-JSON-parse-error inputs were found
      by review to slip past ConvertFrom-Json with no exception at all:
      whitespace-only content and the literal `null`, both of which parse
      to PowerShell `$null` -- NOT a parse failure. Left unchecked,
      Get-Member/Add-Member against `$null` raise only NON-TERMINATING
      errors that nothing here catches, `$obj | ConvertTo-Json` on `$null`
      produces no output, and the final WriteAllText silently truncates
      the file to 0 bytes with no exception anywhere in the chain --
      verified locally: a 7-byte fixture became 0 bytes. A root-level JSON
      ARRAY is the same class of bug from the other direction: it parses
      fine to a non-null `Object[]`, but piping it into Add-Member/
      Get-Member enumerates and mutates (or non-terminating-errors on)
      EVERY element instead of the single container object this function
      assumes it's holding. Both are the same missing "is this the object
      I think it is?" check, so both are guarded together, immediately
      after the parse and before anything else runs.

      F2: the final write is also an ATOMIC replace (temp file + rename),
      not an in-place WriteAllText. WriteAllText truncates the destination
      before writing its new content -- an interrupt in that window
      (Ctrl-C, crash, power loss) leaves a truncated komorebi.json with no
      recovery path, since this file lives outside any git repo. Writing
      to a sibling temp file first and replacing atomically means the
      live file is either the old complete content or the new complete
      content, never a partial write.

      Uses `Move-Item -Force` for the rename rather than
      `[System.IO.File]::Replace` (the more obvious .NET API for this):
      `File.Replace` was tried first and reliably threw `ArgumentException:
      The path is not of a legal form` on this machine, tracing (via the
      inner exception) to `Path.NewNormalizePath`'s short-(8.3)-name
      expansion step -- reproducible even for two freshly-written,
      confirmed-`Test-Path`-true files in a plain, permission-normal
      directory, so not a real path-legality problem, just that API's
      short-name-expansion path failing in this environment. `Move-Item
      -Force` (backed by Win32 `MoveFileEx` with replace-existing, not the
      `ReplaceFile` API `File.Replace` uses) was verified to both replace
      the destination's content correctly AND remove the source, and is
      still a same-directory, same-volume, atomic rename either way.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Colours
    )

    if (-not (Test-Path $Path)) { throw "Set-KomorebiBorderColours: komorebi.json not found at $Path" }

    $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ($null -eq $obj) {
        throw "Set-KomorebiBorderColours: '$Path' parsed to `$null (empty, whitespace-only, or literal 'null' content) -- refusing to write, to avoid silently truncating the file"
    }
    if ($obj -isnot [System.Management.Automation.PSCustomObject]) {
        throw "Set-KomorebiBorderColours: '$Path' does not have a JSON OBJECT at its root (got $($obj.GetType().Name)) -- refusing to mutate every element as if it were the settings container"
    }
    if (-not (Get-Member -InputObject $obj -Name 'border_colours' -MemberType NoteProperty)) {
        $obj | Add-Member -NotePropertyName 'border_colours' -NotePropertyValue ([PSCustomObject]@{}) -Force
    }

    $entries = @{}
    if ($Colours -is [System.Collections.IDictionary]) {
        foreach ($k in $Colours.Keys) { $entries[$k] = $Colours[$k] }
    } else {
        foreach ($p in $Colours.PSObject.Properties) { $entries[$p.Name] = $p.Value }
    }

    foreach ($kind in $entries.Keys) {
        $value = $entries[$kind]
        if (-not (Get-Member -InputObject $obj.border_colours -Name $kind -MemberType NoteProperty)) {
            $obj.border_colours | Add-Member -NotePropertyName $kind -NotePropertyValue $value -Force
        } else {
            $obj.border_colours.$kind = $value
        }
    }

    $json = $obj | ConvertTo-Json -Depth 10
    if ([string]::IsNullOrEmpty($json)) {
        # Unreachable given the guards above (both would already have thrown),
        # kept as cheap defence in depth per the same finding -- ConvertTo-Json
        # is the one remaining step between a validated $obj and the write.
        throw "Set-KomorebiBorderColours: ConvertTo-Json produced no output for '$Path' -- refusing to write"
    }

    # F2: atomic replace -- write the new content to a sibling temp file, then
    # rename it over the real path. Both files live in the same directory (so
    # always the same volume), which makes the rename a single filesystem
    # metadata update rather than a byte copy -- there is no window in which
    # $Path exists but holds partial content.
    $tmpPath = Join-Path (Split-Path $Path -Parent) ("$(Split-Path $Path -Leaf).tmp-$PID-$(Get-Random)")
    [System.IO.File]::WriteAllText($tmpPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    try {
        Move-Item -Path $tmpPath -Destination $Path -Force
    } finally {
        if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue }
    }
}

function Update-KomorebiBorderTheme {
    <#
      Ties the border-colour role mapping (single->primary, stack->
      tertiary, monocle->secondary, unfocused->outline, floating->error --
      see matugen/templates/komorebi-colours.json, rendered by matugen
      alongside every other template but deliberately NOT one of
      $script:Targets: it has no live config of its own to copy/validate/
      roll back, it only exists to hand this function hex values without
      needing a second matugen invocation) to both halves of the
      border-colour update: the runtime CLI call (Set-KomorebiBorderColour,
      lost on restart) and the persisted komorebi.json write
      (Set-KomorebiBorderColours, survives a restart).

      Deliberately entirely fail-soft and isolated from the rest of
      Apply-Theme's success/failure signal: any problem here (matugen
      didn't render the staged colours file, komorebic missing, komorebi
      not running, a malformed komorebi.json) is a warning, never a thrown
      exception that could abort an otherwise-successful theme apply over
      what is, after all, a cosmetic accent on top of it.
    #>
    [CmdletBinding()]
    param(
        [string]$StagedColoursPath = (Join-Path $script:Staging 'komorebi-colours.json'),
        [string]$KomorebiJsonPath  = "$env:USERPROFILE\komorebi.json"
    )

    if (-not (Test-Path $StagedColoursPath)) {
        Write-Warning "komorebi-colours.json was not staged -- skipping border-colour update"
        return
    }
    $text = [System.IO.File]::ReadAllText($StagedColoursPath)
    if ($text -match '\{\{') {
        Write-Warning "komorebi-colours.json still contains an unrendered template expression -- skipping border-colour update"
        return
    }
    try {
        $colours = $text | ConvertFrom-Json
    } catch {
        Write-Warning "komorebi-colours.json could not be parsed -- skipping border-colour update: $($_.Exception.Message)"
        return
    }

    # CLI --window-kind uses hyphens; komorebi.json's border_colours uses
    # underscores -- irrelevant here since none of these five kind names
    # contain a hyphen either way. unfocused-locked/unfocused_locked is
    # intentionally not part of this mapping (no role was specified for it).
    $kindToHex = [ordered]@{
        single    = $colours.single
        stack     = $colours.stack
        monocle   = $colours.monocle
        unfocused = $colours.unfocused
        floating  = $colours.floating
    }
    foreach ($kind in @($kindToHex.Keys)) {
        if (-not $kindToHex[$kind]) {
            Write-Warning "komorebi-colours.json is missing a value for '$kind' -- skipping it"
            $kindToHex.Remove($kind)
            continue
        }
        # F1: validate the hex format HERE, per-kind, before either the
        # runtime loop or the persist call below ever sees it. Reproduced by
        # the reviewer with a template edited to use matugen's own documented
        # `.rgb` accessor instead of `.hex` for one role -- both are valid
        # matugen output, but ConvertFrom-HexColor only accepts hex, and
        # previously threw straight out of the runtime foreach with nothing
        # to catch it: the exception escaped Update-KomorebiBorderTheme,
        # escaped the unguarded call in Apply-Theme, and reached
        # Switch-Wallpaper with no try/catch either -- one bad colour value
        # could kill the whole run after three targets were already live and
        # last-good had rotated. Reusing ConvertFrom-HexColor's own
        # validation (rather than duplicating its regex here) means there is
        # exactly one definition of "valid hex" in this file.
        try {
            [void](ConvertFrom-HexColor -Hex $kindToHex[$kind])
        } catch {
            Write-Warning "komorebi-colours.json has a malformed colour value for '$kind' ('$($kindToHex[$kind])') -- skipping it: $($_.Exception.Message)"
            $kindToHex.Remove($kind)
        }
    }
    if ($kindToHex.Count -eq 0) {
        Write-Warning "komorebi-colours.json had no usable colour values -- skipping border-colour update entirely"
        return
    }

    if (-not (Get-Process komorebi -ErrorAction SilentlyContinue)) {
        Write-Warning "komorebi is not running -- skipping the runtime border-colour update (komorebi.json will still be updated so the next start picks up the colours)"
    } else {
        foreach ($kind in $kindToHex.Keys) {
            $rgb = ConvertFrom-HexColor -Hex $kindToHex[$kind]
            Set-KomorebiBorderColour -R $rgb.R -G $rgb.G -B $rgb.B -WindowKind $kind
        }
    }

    try {
        Set-KomorebiBorderColours -Path $KomorebiJsonPath -Colours $kindToHex
    } catch {
        Write-Warning "Failed to persist border colours into komorebi.json: $($_.Exception.Message)"
    }
}

function Apply-Theme {
    [CmdletBinding()]
    param(
        [string]$Image,
        [string]$Scheme = 'scheme-tonal-spot',
        [switch]$DryRun
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
    # only complicate that dance for no benefit. Test-StagedFile's checks
    # and the rollback loop below both use file-level Test-Path against
    # paths inside them, which is false whether the file or the containing
    # directory is missing, so neither needs the directory to pre-exist.
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
    # real in Task 8, back when yasb was still a target: an undetected-broken
    # stylesheet got snapshotted as last-good by the following apply).
    # last-good is now only refreshed further down, after THIS run has passed
    # every pre-copy structural validation check.

    # C2: snapshot what's ACTUALLY LIVE right now, separately from
    # last-good, immediately before it gets overwritten -- see
    # New-PreApplySnapshot's own comment for why this can't just be
    # last-good/. This is the source the rollback below restores from.
    New-PreApplySnapshot

    # Task 9 deferred minor (bundled into C1): must be computed BEFORE
    # Copy-StagedToLive -- once that runs, the zebar target's Live path is
    # overwritten with Staged's content and a post-copy comparison would
    # trivially always read "unchanged". See Test-ZebarThemeChanged's own
    # comment for why this gate exists: it reduces how often the (now
    # multi-widget) restart below fires at all.
    $zebarTarget  = $script:Targets | Where-Object { $_.Name -eq 'zebar' }
    $zebarChanged = Test-ZebarThemeChanged -StagedPath (Join-Path $script:Staging $zebarTarget.Staged) -LivePath $zebarTarget.Live

    try {
        Copy-StagedToLive
    } catch {
        # I4: a partial copy (some targets written, one failed) must not be
        # left standing -- restore everything from the pre-apply snapshot
        # taken a moment ago and bail out before Update-LastGood ever runs.
        Write-Warning "Copy to live config failed: $($_.Exception.Message). Rolling back all targets from the pre-apply snapshot."
        Restore-PreApplySnapshot
        return [PSCustomObject]@{ Success = $false; Failed = @('copy') }
    }

    # NOTE: yasb/tacky-borders' post-copy log-based checks (Test-YasbLogFailure,
    # the tacky-borders.log grep, and the 8-second yasbc-reload settle wait
    # they needed) were removed along with those two targets -- see
    # CLAUDE.md's "The stack" table and "Window borders and gaps" section.
    # wezterm/starship/zebar have no equivalent post-copy signal; their
    # pre-copy Test-StagedFile checks above (plus starship's real
    # `starship prompt` validation) are the only gate for them, same as
    # they always were.

    # Passed every pre-copy structural validation check: only NOW is it safe
    # to call this run's output "known good". Rotate two generations
    # atomically (see Update-LastGood) -- so a single bad-but-undetected
    # apply cannot, by itself, destroy the only known-good copy, and a crash
    # mid-rotation can't leave last-good holding a mix of two theme
    # generations across the targets.
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

    # Reload the zebar bar widget so it picks up the new theme.css.
    #
    # docs/zebar-reference.md (Step 4) found Zebar does NOT hot-reload CSS --
    # a running widget still showed the old colour 14+ seconds after the
    # stylesheet changed on disk. A later investigation found
    # start-widget-preset against an ALREADY-RUNNING widget of the same
    # pack/widget/preset is a no-op -- it neither reloads nor duplicates.
    # `zebar.exe --help` (re-checked for this task) confirms the CLI has no
    # lighter-weight verb either: only start-widget, start-widget-preset,
    # startup, query, publish exist -- no stop/reload/restart-in-place. The
    # only way to make a running widget notice a new stylesheet is to kill
    # the zebar.exe process and start it again.
    #
    # Deliberately placed HERE -- after Update-LastGood -- not immediately
    # after Copy-StagedToLive above. Restarting hands the widget whatever is
    # CURRENTLY on disk. If this apply were instead rejected by the
    # pre-copy validation loop and never reached this point, restarting
    # before that rejection would have shown a rejected theme.css for the
    # length of a restart. Restarting only once every check has passed
    # avoids that, and keeps the bar's downtime to the one restart a
    # successful apply actually needs (~500ms per widget,
    # Restart-ZebarWidgets' own sleep).
    #
    # C1: previously killed EVERY Zebar widget on the machine
    # (`Get-Process zebar | Stop-Process -Force`) and restarted ONLY
    # caelestia/bar -- justified by a comment claiming only one widget was
    # ever running, true in dev but false against the real
    # ~/.glzr/zebar/settings.json, which autostarts a second pack
    # (gunturdwiap.good-enough). See Restart-ZebarWidgets's own comment for
    # the fix: it restarts every startupConfigs entry, not just this one.
    #
    # Also gated on $zebarChanged (Task 9 deferred minor, folded into C1):
    # no point killing every autostarted widget on the machine for a
    # wezterm/starship-only theme apply that never touched theme.css.
    if ($zebarChanged) {
        Restart-ZebarWidgets
    } else {
        Write-Host "zebar theme.css did not change; skipping the widget restart."
    }

    # Force WezTerm to notice the new palette (see docs/spikes.md, unknown #2).
    if (Test-Path "$env:USERPROFILE\.wezterm.lua") {
        (Get-Item "$env:USERPROFILE\.wezterm.lua").LastWriteTime = Get-Date
    }

    # Update komorebi's window-border colours from this apply's palette.
    # Entirely fail-soft (see Update-KomorebiBorderTheme's own comment) --
    # never affects this function's own Success/Failed result. F1: wrapped
    # in try/catch as defence in depth on top of Update-KomorebiBorderTheme's
    # own internal per-kind hex validation -- this call was previously
    # unguarded, so ANY unanticipated exception from that function (not just
    # the malformed-hex case its own validation now catches) would have
    # escaped here, escaped Apply-Theme entirely, and reached
    # Switch-Wallpaper.ps1, which has no try/catch of its own either.
    try {
        Update-KomorebiBorderTheme
    } catch {
        Write-Warning "Update-KomorebiBorderTheme threw unexpectedly: $($_.Exception.Message). Border colours were not themed this run, but the rest of the apply succeeded."
    }

    return [PSCustomObject]@{ Success = $true; Failed = @() }
}
