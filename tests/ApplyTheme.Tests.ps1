BeforeAll {
    . "$PSScriptRoot\..\scripts\Apply-Theme.ps1"
    $script:probe = Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960" -Recurse -Filter "preview.jpg" | Select-Object -First 1 -ExpandProperty FullName

    # M1: state/staging/* persists across Pester runs (nothing clears it
    # between sessions). Without this, the three "-DryRun ..." tests below
    # could pass vacuously off a PREVIOUS session's leftover staging files
    # even if Apply-Theme silently failed to render anything this run --
    # they only check Test-Path/file existence, not that THIS invocation
    # produced them. Starting from a guaranteed-empty staging dir means
    # those assertions can only pass if this test run's own Apply-Theme
    # call actually wrote the files.
    $script:stagingDir = "$PSScriptRoot\..\state\staging"
    if (Test-Path $script:stagingDir) {
        Get-ChildItem $script:stagingDir -File | Remove-Item -Force -ErrorAction SilentlyContinue
    }
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

Describe "Test-StagedFile yasb structural checks" {
    BeforeAll {
        # Isolated last-good fixture -- never touches the real
        # state/last-good/ directory, so these tests can't corrupt it.
        $script:yasbLastGoodDir = "$env:TEMP\yasb-lastgood-test-$PID"
        New-Item -ItemType Directory -Force -Path $script:yasbLastGoodDir | Out-Null
        [System.IO.File]::WriteAllText(
            (Join-Path $script:yasbLastGoodDir 'styles.css'),
            '.a { color: red; } .b { color: blue; } .c { color: green; }',
            (New-Object System.Text.UTF8Encoding($false))
        )
    }

    AfterAll {
        Remove-Item $script:yasbLastGoodDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "rejects styles.css with unbalanced braces" {
        $p = "$env:TEMP\yasb-unbalanced.css"
        Set-Content $p '.a { color: red;' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:yasbLastGoodDir | Should -BeFalse
    }

    It "rejects styles.css whose rule count deviates more than 5% from last-good" {
        $p = "$env:TEMP\yasb-rulecount.css"
        # last-good has 3 rule blocks; this stages only 1 -- an unterminated
        # or truncated render collapses rule count exactly like this.
        Set-Content $p '.a { color: red; }' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:yasbLastGoodDir | Should -BeFalse
    }

    It "rejects styles.css whose size deviates more than 20% from last-good" {
        $p = "$env:TEMP\yasb-size.css"
        # Same rule count (3) and balanced braces as last-good, but bloated
        # well past the 20% size tolerance -- catches runaway duplication
        # that coincidentally preserves rule count and brace balance.
        $padding = '/*' + ('x' * 500) + '*/'
        Set-Content $p ".a { color: red; $padding } .b { color: blue; } .c { color: green; }" -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:yasbLastGoodDir | Should -BeFalse
    }

    It "accepts a well-formed styles.css within tolerance of last-good" {
        $p = "$env:TEMP\yasb-good.css"
        Set-Content $p '.a { color: orange; } .b { color: purple; } .c { color: cyan; }' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:yasbLastGoodDir | Should -BeTrue
    }

    It "accepts styles.css when no last-good baseline exists yet" {
        $p = "$env:TEMP\yasb-nobaseline.css"
        Set-Content $p '.a { color: orange; }' -Encoding ascii
        $emptyDir = "$env:TEMP\yasb-lastgood-empty-$PID"
        New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
        try {
            Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $emptyDir | Should -BeTrue
        } finally {
            Remove-Item $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It "rejects styles.css where a comment-hidden brace masks an unterminated rule (reviewer's exact construction)" {
        # Deleted the closing brace from rule .a -- unterminated, precisely
        # the failure class the brace-balance check exists to catch -- then
        # added one compensating '}' inside an unrelated comment. Raw brace
        # count is balanced (3 open, 3 close); only counting braces AFTER
        # stripping comments reveals the real 3-open/2-close imbalance. This
        # is the external reviewer's exact construction against the real
        # template (delete a `}` from `.cpu-widget .icon { ... }`, add a
        # compensating `}` inside `/* MEMORY */`), reproduced at fixture
        # scale. Deliberately points at a last-good dir that doesn't exist,
        # so only the brace-balance check is in play -- isolating exactly
        # the property this test exists to prove, with no interference from
        # the (unrelated, already-covered) rule-count/size checks.
        $p = "$env:TEMP\yasb-comment-masked.css"
        Set-Content $p '/* MEMORY } */ .a { color: red; .b { color: blue; } .c { color: green; }' -Encoding ascii
        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeFalse
    }

    It "rejects the reviewer's string-context attack: a comment stripper would mistake two string literals for one giant comment" {
        # .a is genuinely unterminated (no closing brace at all). Its `/*`
        # sits inside a STRING value (`content: "/*"`), and a `*/`-looking
        # string value sits inside .c two rules later (`content: "*/"`). A
        # regex comment-stripper with no notion of string context (the
        # first version of this fix) treats the span from the first literal
        # `/*` to the next literal `*/` as one comment and deletes
        # everything between -- including .b's entire rule and part of .a/
        # .c -- which coincidentally rebalances the count and produces a
        # FALSE PASS on content that is genuinely corrupt. This is the
        # reviewer's exact construction.
        #
        # Proven against the pre-fix logic directly (not just asserted):
        # raw (unstripped) count is 4 open / 3 close -- confirming .a really
        # is broken. The OLD `[regex]::Replace($text, '(?s)/\*.*?\*/', '')`
        # approach reduces that to 2 open / 2 close (balanced -- the bug).
        # The fixed Measure-CssBraces-based check must report the true
        # 4/3 imbalance and reject.
        $p = "$env:TEMP\yasb-string-context-attack.css"
        $attack = @'
.a { content: "/*"; color: red;
.b { color: blue; }
.c { content: "*/"; color: green; }
.d { color: purple; }
'@
        Set-Content $p $attack -Encoding ascii

        # Confirm the raw text really is unbalanced and the old approach
        # really would have masked it, so this test is proven non-vacuous
        # against the specific pre-fix implementation it replaces.
        $rawOpen  = ([regex]::Matches($attack, '\{')).Count
        $rawClose = ([regex]::Matches($attack, '\}')).Count
        $rawOpen | Should -Not -Be $rawClose
        $oldStripped = [regex]::Replace($attack, '(?s)/\*.*?\*/', '')
        $oldOpen  = ([regex]::Matches($oldStripped, '\{')).Count
        $oldClose = ([regex]::Matches($oldStripped, '\}')).Count
        $oldOpen | Should -Be $oldClose  # the old approach's false-pass condition

        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeFalse
    }

    It "accepts a legitimate file where CSS comment-like text appears inside real string values" {
        # `content: "/*"` and `content: "*/"` are ordinary, valid CSS string
        # values -- not comment delimiters -- and the file is fully
        # well-formed (every rule opened and closed). A naive stripper that
        # doesn't understand string context could still misparse this; the
        # string-aware scanner must not.
        $p = "$env:TEMP\yasb-legit-comment-like-string.css"
        Set-Content $p '.a { content: "/*"; color: red; } .b { color: blue; } .c { content: "*/"; color: green; }' -Encoding ascii
        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeTrue
    }

    It "rejects a file with an unterminated /* comment" {
        # The comment never closes -- everything after it, including a
        # real rule, is swallowed. Treated as suspicious/truncated and
        # rejected rather than silently ignoring the rest of the file.
        $p = "$env:TEMP\yasb-unterminated-comment.css"
        Set-Content $p '.a { color: red; } /* this comment never closes .b { color: blue; }' -Encoding ascii
        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeFalse
    }

    It "rejects the reviewer's unterminated-string construction (double-quote, coincidentally balanced)" {
        # Reviewer's exact reproduction: .a{...} and .b{...} are complete
        # (2 open, 2 close), but .c's selector has an unterminated `"` that
        # swallows the newline and the NEXT real rule's `{ color: green; }`
        # as string content -- never counted, never closed. The visible
        # brace count is a coincidental 2/2 balance on a genuinely corrupt
        # file. Proven against the pre-UnterminatedString implementation
        # directly below before asserting the fix rejects it.
        $attack = @'
.a{...} .b{...} .c[title="unterminated
{ color: green; }
'@
        $p = "$env:TEMP\yasb-unterminated-string-dquote.css"
        Set-Content $p $attack -Encoding ascii

        # Confirm the pre-fix condition: Open/Close balanced, no
        # UnterminatedComment -- the exact state that made the old
        # (UnterminatedString-blind) check return $true.
        $counts = Measure-CssBraces -Text $attack
        $counts.Open | Should -Be $counts.Close
        $counts.UnterminatedComment | Should -BeFalse
        $counts.UnterminatedString | Should -BeTrue  # this is what the fix adds

        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeFalse
    }

    It "rejects an unterminated single-quoted string, same shape as the double-quote case" {
        $attack = @'
.a{...} .b{...} .c[title='unterminated
{ color: green; }
'@
        $p = "$env:TEMP\yasb-unterminated-string-squote.css"
        Set-Content $p $attack -Encoding ascii

        $counts = Measure-CssBraces -Text $attack
        $counts.Open | Should -Be $counts.Close
        $counts.UnterminatedComment | Should -BeFalse
        $counts.UnterminatedString | Should -BeTrue

        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeFalse
    }

    It "accepts a control file with well-formed, properly closed quoted strings" {
        # Same shape of content (quoted string values) as the two rejection
        # cases above, but every quote actually closes -- must not be
        # over-rejected by the new UnterminatedString check.
        $p = "$env:TEMP\yasb-wellformed-strings.css"
        Set-Content $p ".a { content: 'well-formed'; color: red; } .b { content: `"also fine`"; color: blue; }" -Encoding ascii
        $noBaseline = "$env:TEMP\yasb-lastgood-nonexistent-$PID"
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $noBaseline | Should -BeTrue
    }
}

Describe "Update-LastGood atomic rotation" {
    BeforeEach {
        # Fully isolated fixture, sibling directories under one temp root
        # (Rename-Item requires same-parent renames) -- never touches the
        # real state/last-good/ or state/last-good-prev/.
        $script:rotRoot         = "$env:TEMP\rotation-test-$PID-$(Get-Random)"
        $script:rotStaging      = Join-Path $script:rotRoot 'staging'
        $script:rotLastGood     = Join-Path $script:rotRoot 'last-good'
        $script:rotLastGoodPrev = Join-Path $script:rotRoot 'last-good-prev'
        $script:rotLastGoodNew  = Join-Path $script:rotRoot 'last-good-new'
        New-Item -ItemType Directory -Force -Path $script:rotStaging | Out-Null
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotStaging $f), "NEW-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    AfterEach {
        Remove-Item $script:rotRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "promotes staged content to last-good on first run, with no last-good-prev created" {
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        (Get-Content (Join-Path $script:rotLastGood 'styles.css') -Raw).Trim() | Should -Be 'NEW-styles.css'
        Test-Path $script:rotLastGoodPrev | Should -BeFalse
        Test-Path $script:rotLastGoodNew | Should -BeFalse
    }

    It "rotates an existing last-good into last-good-prev and promotes the new generation, for all four files" {
        New-Item -ItemType Directory -Force -Path $script:rotLastGood | Out-Null
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGood $f), "OLD-$f", (New-Object System.Text.UTF8Encoding($false)))
        }

        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            (Get-Content (Join-Path $script:rotLastGood $f) -Raw).Trim() | Should -Be "NEW-$f"
            (Get-Content (Join-Path $script:rotLastGoodPrev $f) -Raw).Trim() | Should -Be "OLD-$f"
        }
        Test-Path $script:rotLastGoodNew | Should -BeFalse
    }

    It "a second rotation replaces last-good-prev rather than accumulating a third generation" {
        New-Item -ItemType Directory -Force -Path $script:rotLastGood | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $script:rotLastGood 'styles.css'), 'GEN1', (New-Object System.Text.UTF8Encoding($false)))
        foreach ($f in 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGood $f), 'GEN1', (New-Object System.Text.UTF8Encoding($false)))
        }

        # rotation 1: GEN1 (last-good) -> last-good-prev; staged NEW-* -> last-good
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        # stage a third generation and rotate again
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotStaging $f), "GEN3-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        (Get-Content (Join-Path $script:rotLastGood 'styles.css') -Raw).Trim() | Should -Be 'GEN3-styles.css'
        (Get-Content (Join-Path $script:rotLastGoodPrev 'styles.css') -Raw).Trim() | Should -Be 'NEW-styles.css'
    }

    It "leaves no last-good-new directory behind after a successful rotation" {
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew
        Test-Path $script:rotLastGoodNew | Should -BeFalse
    }

    It "leaves last-good-prev untouched when last-good is absent (interrupted prior rotation), instead of destroying it" {
        # Reachable without any tampering: a crash between the two
        # Rename-Item calls inside Update-LastGood -- after last-good ->
        # last-good-prev succeeds but before last-good-new -> last-good
        # runs -- leaves exactly this state: last-good absent,
        # last-good-prev populated. The first version of this removed
        # last-good-prev unconditionally before checking whether last-good
        # existed to replace it, silently discarding the one surviving
        # fallback on the next successful apply. Found by external review.
        New-Item -ItemType Directory -Force -Path $script:rotLastGoodPrev | Out-Null
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGoodPrev $f), "SURVIVOR-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        Test-Path $script:rotLastGood | Should -BeFalse  # simulating the interrupted state

        $warnings = @()
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'last-good-prev'

        # last-good-prev must survive, untouched, with its original content.
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            (Get-Content (Join-Path $script:rotLastGoodPrev $f) -Raw).Trim() | Should -Be "SURVIVOR-$f"
        }
        # This run's staged content is still promoted to last-good normally.
        (Get-Content (Join-Path $script:rotLastGood 'styles.css') -Raw).Trim() | Should -Be 'NEW-styles.css'
    }
}

Describe "Pre-apply snapshot and rollback (C2)" {
    <#
      C2: rollback used to restore from state/last-good/, which is the last
      VALIDATED PIPELINE generation -- not necessarily what was live a
      moment before this apply. A live file hand-edited outside the
      pipeline (e.g. ~/.config/starship.toml -- ~/.config is not a git
      repo) would be silently destroyed by a last-good-based rollback if a
      later apply failed post-copy. New-PreApplySnapshot/
      Restore-PreApplySnapshot snapshot the CURRENT live content into a
      SEPARATE state/pre-apply/ directory immediately before the copy
      loop, and rollback restores from there instead -- last-good/
      last-good-prev keep their existing validated-generation-rotation
      meaning unchanged (Task 8's fix is not being undone).

      Isolated fixture, same override-parameter pattern as
      Test-StagedFile/Update-LastGood -- never touches the real
      state/pre-apply/ or any real live config path.
    #>
    BeforeEach {
        $script:preRoot      = "$env:TEMP\preapply-test-$PID-$(Get-Random)"
        $script:preLiveDir   = Join-Path $script:preRoot 'live'
        $script:preSnapDir   = Join-Path $script:preRoot 'pre-apply'
        $script:preLastGood  = Join-Path $script:preRoot 'last-good'
        New-Item -ItemType Directory -Force -Path $script:preLiveDir  | Out-Null
        New-Item -ItemType Directory -Force -Path $script:preLastGood | Out-Null

        # Fixture targets pointing at temp "live" files instead of the real
        # ~/.config/* paths, and a "last-good" holding DIFFERENT content
        # than live -- exactly the situation the finding describes: a live
        # file that has drifted from the last validated pipeline
        # generation (e.g. a hand-edit).
        $script:preTargets = @(
            @{ Name='yasb';     Staged='styles.css';        Live=(Join-Path $script:preLiveDir 'styles.css') }
            @{ Name='starship'; Staged='starship.toml';     Live=(Join-Path $script:preLiveDir 'starship.toml') }
        )
        foreach ($t in $script:preTargets) {
            [System.IO.File]::WriteAllText($t.Live, "HAND-EDITED-$($t.Staged)", (New-Object System.Text.UTF8Encoding($false)))
            [System.IO.File]::WriteAllText((Join-Path $script:preLastGood $t.Staged), "PIPELINE-GENERATION-$($t.Staged)", (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    AfterEach {
        Remove-Item $script:preRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "snapshots and restores the HAND-EDITED live content, not the last-good pipeline generation" {
        # Snapshot what's live right now (the hand-edited content).
        New-PreApplySnapshot -Targets $script:preTargets -PreApplyDir $script:preSnapDir

        # Simulate a bad apply: live gets overwritten with new (bad)
        # content, exactly like Apply-Theme's copy loop does before its
        # post-copy checks run.
        foreach ($t in $script:preTargets) {
            [System.IO.File]::WriteAllText($t.Live, "BAD-NEW-APPLY-$($t.Staged)", (New-Object System.Text.UTF8Encoding($false)))
        }

        # Roll back.
        Restore-PreApplySnapshot -Targets $script:preTargets -PreApplyDir $script:preSnapDir

        foreach ($t in $script:preTargets) {
            $restored = (Get-Content $t.Live -Raw).Trim()
            $restored | Should -Be "HAND-EDITED-$($t.Staged)"
            # The whole point of C2: rollback must NOT have pulled from
            # last-good instead -- the last-good fixture is deliberately
            # DIFFERENT content ('PIPELINE-GENERATION-*'), so if rollback
            # source ever regresses back to last-good, this assertion
            # catches it immediately.
            $restored | Should -Not -Be "PIPELINE-GENERATION-$($t.Staged)"
        }
    }

    It "does not snapshot a target with no live file yet (first-ever apply), and restoring leaves it untouched" {
        $freshTargets = @(
            @{ Name='yasb'; Staged='styles.css'; Live=(Join-Path $script:preLiveDir 'never-existed.css') }
        )
        New-PreApplySnapshot -Targets $freshTargets -PreApplyDir $script:preSnapDir
        Test-Path (Join-Path $script:preSnapDir 'never-existed.css') | Should -BeFalse

        # A bad apply still writes SOMETHING to live even on a first run.
        [System.IO.File]::WriteAllText($freshTargets[0].Live, 'BAD-FIRST-APPLY', (New-Object System.Text.UTF8Encoding($false)))
        Restore-PreApplySnapshot -Targets $freshTargets -PreApplyDir $script:preSnapDir
        # No backup existed, so restore is a no-op -- the bad content is
        # left in place (same first-run limitation state/last-good/ always
        # had; not a regression introduced by this fix).
        (Get-Content $freshTargets[0].Live -Raw).Trim() | Should -Be 'BAD-FIRST-APPLY'
    }
}

Describe "Test-YasbLogFailure (I1)" {
    It "does NOT match real unrelated widget noise captured from the live yasb.log" {
        # Captured verbatim from ~/.config/yasb/yasb.log -- exactly the 7
        # lines that matched the old blanket 'error|critical|invalid|could
        # not be read' pattern, none of them anything to do with
        # styles.css. Under the old pattern, ANY one of these landing in
        # the 8-second post-copy window triggered a full four-target
        # rollback for a problem that was never in the stylesheet.
        $noise = @(
            "2026-07-28 20:30:30,853 [ERROR] [MainThread] [root/traffic_manager.py:163]: Error loading traffic data for interface auto: Expecting value: line 1 column 1 (char 0)",
            "2026-08-01 18:56:59,929 [ERROR] [MainThread] [root/base.py:126]: Failed to execute callback of type 'toggle_cpu_menu' with args: []",
            "KeyError: 'toggle_cpu_menu'",
            "2026-08-04 19:31:09,584 [WARNING] [MainThread] [glazewm_client/client.py:134]: WebSocket error: SocketError.RemoteHostClosedError. Reconnecting..."
        ) -join "`n"

        # Prove the OLD pattern really would have false-positived on this,
        # so this test is non-vacuous against the code it replaces.
        $oldPattern = '(?i)error|critical|invalid|could not be read'
        $noise | Should -Match $oldPattern

        Test-YasbLogFailure -LogTail $noise | Should -BeFalse
    }

    It "matches yasb's documented CSSProcessor file-read failure message" {
        # Per docs/validation-limits.md: CSSProcessor._read_css_file logs
        # "CSSProcessor Error '%s': %s" specifically on a file-level read
        # error -- the one failure class the post-copy log check can
        # actually see for yasb.
        $line = "2026-08-05 12:00:00,000 [ERROR] [MainThread] [core/utils/css_processor.py:42]: CSSProcessor Error 'styles.css': could not be read"
        Test-YasbLogFailure -LogTail $line | Should -BeTrue
    }

    It "returns false on an empty tail" {
        Test-YasbLogFailure -LogTail '' | Should -BeFalse
    }
}

Describe "Test-StagedFile tacky structural checks (I2)" {
    BeforeAll {
        $script:goodTacky = @'
watch_config_changes: True
enable_logging: True
rendering_backend: V2
global:
  border_width: 3
  active_color: "#ffffff"
window_rules:
  - match: Class
    name: "Windows.UI.Core.CoreWindow"
    enabled: False
'@
    }

    It "accepts a well-formed tacky config with all required top-level keys" {
        $p = "$env:TEMP\tacky-good.yaml"
        [System.IO.File]::WriteAllText($p, $script:goodTacky, (New-Object System.Text.UTF8Encoding($false)))
        Test-StagedFile -Name 'tacky' -Path $p | Should -BeTrue
    }

    It "rejects total garbage with none of the expected top-level keys (verified: the old default-case check accepted this unconditionally)" {
        $p = "$env:TEMP\tacky-garbage.yaml"
        $garbage = "totally: garbage`nnot even: [yaml"
        [System.IO.File]::WriteAllText($p, $garbage, (New-Object System.Text.UTF8Encoding($false)))
        Test-StagedFile -Name 'tacky' -Path $p | Should -BeFalse
    }

    It "rejects a config missing one required top-level key" {
        $p = "$env:TEMP\tacky-missing-key.yaml"
        $missing = $script:goodTacky -replace '(?m)^window_rules:.*', '' # drop window_rules and its body isn't fully stripped, but the top-level key line itself is gone
        [System.IO.File]::WriteAllText($p, $missing, (New-Object System.Text.UTF8Encoding($false)))
        Test-StagedFile -Name 'tacky' -Path $p | Should -BeFalse
    }

    It "rejects an unbalanced double-quote count" {
        $p = "$env:TEMP\tacky-badquote.yaml"
        $bad = $script:goodTacky -replace 'active_color: "#ffffff"', 'active_color: "#ffffff'
        [System.IO.File]::WriteAllText($p, $bad, (New-Object System.Text.UTF8Encoding($false)))
        Test-StagedFile -Name 'tacky' -Path $p | Should -BeFalse
    }
}

Describe "Test-StagedFile starship PATH guard (I3)" {
    It "fails closed when starship is not resolvable on PATH, instead of silently passing on a stale exit code" {
        $starshipCmd = Get-Command starship -ErrorAction SilentlyContinue
        if (-not $starshipCmd) {
            Set-ItResult -Skipped -Because "starship is not installed on this machine, so the guard this test proves can't be exercised against the real binary"
            return
        }
        $starshipDir = Split-Path $starshipCmd.Source -Parent
        $prevPath = $env:PATH
        $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $starshipDir.TrimEnd('\') }) -join ';'
        try {
            # Sanity: confirm starship really is unresolvable now, or this
            # test would silently prove nothing.
            (Get-Command starship -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty

            # Reproduces the exact bug mechanism: a prior successful
            # command (standing in for matugen's own success check at
            # Apply-Theme.ps1:~656) leaves $LASTEXITCODE at 0 before
            # Test-StagedFile's starship case ever runs.
            $global:LASTEXITCODE = 0
            $p = "$env:TEMP\starship-nopath.toml"
            [System.IO.File]::WriteAllText($p, '[character]', (New-Object System.Text.UTF8Encoding($false)))

            Test-StagedFile -Name 'starship' -Path $p | Should -BeFalse
        } finally {
            $env:PATH = $prevPath
        }
    }
}

Describe "Update-LastGood aborts cleanly on a partial copy, instead of promoting an incomplete generation (I4)" {
    BeforeEach {
        $script:ilRoot         = "$env:TEMP\il4-test-$PID-$(Get-Random)"
        $script:ilStaging      = Join-Path $script:ilRoot 'staging'
        $script:ilLastGood     = Join-Path $script:ilRoot 'last-good'
        $script:ilLastGoodPrev = Join-Path $script:ilRoot 'last-good-prev'
        $script:ilLastGoodNew  = Join-Path $script:ilRoot 'last-good-new'
        New-Item -ItemType Directory -Force -Path $script:ilStaging  | Out-Null
        New-Item -ItemType Directory -Force -Path $script:ilLastGood | Out-Null
        # Stage only 3 of the 4 real target files -- omit starship.toml,
        # simulating a disk error / missing render partway through.
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua') {
            [System.IO.File]::WriteAllText((Join-Path $script:ilStaging $f), "NEW-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        # Existing last-good baseline that must survive untouched if this
        # run's promotion fails.
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            [System.IO.File]::WriteAllText((Join-Path $script:ilLastGood $f), "OLD-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    AfterEach {
        Remove-Item $script:ilRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "throws instead of silently continuing past the missing file" {
        { Update-LastGood -StagingDir $script:ilStaging -LastGoodDir $script:ilLastGood -LastGoodPrevDir $script:ilLastGoodPrev -LastGoodNewDir $script:ilLastGoodNew } | Should -Throw
    }

    It "leaves the existing last-good completely untouched -- no rotation happened at all" {
        try {
            Update-LastGood -StagingDir $script:ilStaging -LastGoodDir $script:ilLastGood -LastGoodPrevDir $script:ilLastGoodPrev -LastGoodNewDir $script:ilLastGoodNew
        } catch { }

        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
            (Get-Content (Join-Path $script:ilLastGood $f) -Raw).Trim() | Should -Be "OLD-$f"
        }
        Test-Path $script:ilLastGoodPrev | Should -BeFalse
    }
}

Describe "Resolve-ImageFromState (I6)" {
    It "returns null when state/current.json does not exist" {
        Resolve-ImageFromState -CurrentJsonPath "$env:TEMP\does-not-exist-current-$PID.json" | Should -BeNullOrEmpty
    }

    It "returns null when the file has no 'preview' field" {
        $p = "$env:TEMP\current-nopreview-$PID.json"
        [System.IO.File]::WriteAllText($p, '{ "wallpaper": "C:\\some\\wallpaper.pkg" }', (New-Object System.Text.UTF8Encoding($false)))
        Resolve-ImageFromState -CurrentJsonPath $p | Should -BeNullOrEmpty
    }

    It "returns null when the file is not valid JSON, without throwing" {
        $p = "$env:TEMP\current-badjson-$PID.json"
        [System.IO.File]::WriteAllText($p, 'not json at all {{{', (New-Object System.Text.UTF8Encoding($false)))
        { Resolve-ImageFromState -CurrentJsonPath $p } | Should -Not -Throw
        Resolve-ImageFromState -CurrentJsonPath $p | Should -BeNullOrEmpty
    }

    It "returns the preview path from a well-formed current.json" {
        $p = "$env:TEMP\current-good-$PID.json"
        [System.IO.File]::WriteAllText($p, '{ "wallpaper": "C:\\w.pkg", "preview": "C:\\w\\preview.jpg", "appliedUtc": "2026-01-01T00:00:00Z" }', (New-Object System.Text.UTF8Encoding($false)))
        Resolve-ImageFromState -CurrentJsonPath $p | Should -Be "C:\w\preview.jpg"
    }

    It "Apply-Theme with no -Image falls back to the real state/current.json's preview (previously write-only state read by nothing)" {
        # Uses the REAL state/current.json -- read-only, and -DryRun
        # guarantees no live config is touched regardless of what image
        # gets resolved.
        $real = Resolve-ImageFromState
        if (-not $real -or -not (Test-Path $real)) {
            Set-ItResult -Skipped -Because "state/current.json's preview does not currently point at an existing file on this machine"
            return
        }
        $r = Apply-Theme -DryRun
        $r.Success | Should -BeTrue
    }
}

Describe "Test-StagedFile -AcceptStructuralChange bypasses only the rule-count/size comparison (I7)" {
    BeforeAll {
        $script:lastGoodDir = "$env:TEMP\yasb-lastgood-i7-$PID"
        New-Item -ItemType Directory -Force -Path $script:lastGoodDir | Out-Null
        [System.IO.File]::WriteAllText(
            (Join-Path $script:lastGoodDir 'styles.css'),
            '.a { color: red; } .b { color: blue; } .c { color: green; }',
            (New-Object System.Text.UTF8Encoding($false))
        )
    }

    AfterAll {
        Remove-Item $script:lastGoodDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "still rejects for rule-count drift without the switch (regression control)" {
        $p = "$env:TEMP\yasb-i7-rulecount-off.css"
        Set-Content $p '.a { color: red; }' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:lastGoodDir | Should -BeFalse
    }

    It "accepts the same rule-count drift when -AcceptStructuralChange is passed" {
        $p = "$env:TEMP\yasb-i7-rulecount-on.css"
        Set-Content $p '.a { color: red; }' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:lastGoodDir -AcceptStructuralChange | Should -BeTrue
    }

    It "accepts size drift when -AcceptStructuralChange is passed" {
        $p = "$env:TEMP\yasb-i7-size-on.css"
        $padding = '/*' + ('x' * 500) + '*/'
        Set-Content $p ".a { color: red; $padding } .b { color: blue; } .c { color: green; }" -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:lastGoodDir -AcceptStructuralChange | Should -BeTrue
    }

    It "does NOT bypass brace-balance -- -AcceptStructuralChange only narrows the rule-count/size comparison, not corruption checks" {
        $p = "$env:TEMP\yasb-i7-stillcorrupt.css"
        Set-Content $p '.a { color: red;' -Encoding ascii
        Test-StagedFile -Name 'yasb' -Path $p -LastGoodDir $script:lastGoodDir -AcceptStructuralChange | Should -BeFalse
    }
}

Describe "Test-StagedFile zebar branch" {
    It "accepts a well-formed custom-property block" {
        $p = "$env:TEMP\zt-good.css"
        Set-Content $p ":root {`n  --surface: #0e1416;`n  --primary: #83d2e5;`n}" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeTrue
    }
    It "rejects an unrendered expression" {
        $p = "$env:TEMP\zt-unrendered.css"
        Set-Content $p ":root { --surface: {{colors.surface.default.hex}}; }" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
    It "rejects unbalanced braces" {
        $p = "$env:TEMP\zt-brace.css"
        Set-Content $p ":root { --surface: #0e1416;" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
    It "rejects a non-custom-property declaration" {
        $p = "$env:TEMP\zt-decl.css"
        Set-Content $p ":root {`n  color: red;`n}" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
}

Describe "Test-ZebarThemeChanged (C1 / Task 9 deferred minor: gate the zebar restart on a real change)" {
    BeforeEach {
        $script:tztRoot = "$env:TEMP\tzt-test-$PID-$(Get-Random)"
        New-Item -ItemType Directory -Force -Path $script:tztRoot | Out-Null
    }
    AfterEach {
        Remove-Item $script:tztRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "returns true when the live file does not exist yet (first-ever apply must still restart)" {
        $staged = Join-Path $script:tztRoot "staged.css"
        [System.IO.File]::WriteAllText($staged, ":root { --a: 1; }", (New-Object System.Text.UTF8Encoding($false)))
        Test-ZebarThemeChanged -StagedPath $staged -LivePath (Join-Path $script:tztRoot "live.css") | Should -BeTrue
    }

    It "returns false when staged content is byte-identical to live -- the restart should be skipped" {
        $staged = Join-Path $script:tztRoot "staged.css"
        $live   = Join-Path $script:tztRoot "live.css"
        [System.IO.File]::WriteAllText($staged, ":root { --a: 1; }", (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($live, ":root { --a: 1; }", (New-Object System.Text.UTF8Encoding($false)))
        Test-ZebarThemeChanged -StagedPath $staged -LivePath $live | Should -BeFalse
    }

    It "returns true when staged content differs from live" {
        $staged = Join-Path $script:tztRoot "staged.css"
        $live   = Join-Path $script:tztRoot "live.css"
        [System.IO.File]::WriteAllText($staged, ":root { --a: 2; }", (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($live, ":root { --a: 1; }", (New-Object System.Text.UTF8Encoding($false)))
        Test-ZebarThemeChanged -StagedPath $staged -LivePath $live | Should -BeTrue
    }
}

Describe "Restart-ZebarWidgets (C1)" {
    <#
      C1: the old code did `Get-Process zebar | Stop-Process -Force` then
      started ONLY caelestia/bar back up -- killing every autostarted Zebar
      widget on the machine (e.g. the real ~/.glzr/zebar/settings.json's
      gunturdwiap.good-enough) and never bringing the others back. Every
      test below mocks Get-Process/Stop-Process/Start-Process/Start-Sleep so
      NO real process on this machine is ever touched -- the fake zebar.exe
      path is only used to satisfy the Test-Path preflight check.
    #>
    BeforeAll {
        $script:rzFakeExe = "$env:TEMP\rz-fake-zebar-$PID.exe"
        [System.IO.File]::WriteAllText($script:rzFakeExe, "fake", (New-Object System.Text.UTF8Encoding($false)))
    }
    AfterAll {
        Remove-Item $script:rzFakeExe -Force -ErrorAction SilentlyContinue
    }
    BeforeEach {
        Mock Start-Sleep {}
        # An empty scriptblock emits NOTHING to the pipeline -- matching
        # real Get-Process's "no matching process" behavior, where Stop-
        # Process downstream simply runs zero times. `return $null` (the
        # first version of this mock) instead emits one $null object,
        # which Stop-Process's pipeline binding rejects outright.
        Mock Get-Process {}
        Mock Stop-Process {}
        Mock Start-Process { return [PSCustomObject]@{ HasExited = $false; ExitCode = 0 } }
    }

    It "restarts EVERY startupConfigs entry, not just caelestia/bar" {
        $settings = "$env:TEMP\rz-settings-multi-$PID.json"
        '{ "startupConfigs": [ { "pack": "gunturdwiap.good-enough", "widget": "main", "preset": "default" } ] }' |
            Set-Content $settings -Encoding utf8

        Restart-ZebarWidgets -ZebarExe $script:rzFakeExe -SettingsPath $settings -StartupWaitMs 1

        Should -Invoke Start-Process -Times 1 -ParameterFilter { $ArgumentList -contains 'gunturdwiap.good-enough' }
        Should -Invoke Start-Process -Times 1 -ParameterFilter { $ArgumentList -contains 'caelestia' }
        Should -Invoke Start-Process -Times 2
    }

    It "kills the existing zebar.exe process before restarting anything" {
        # A real running zebar process, standing in for one that's genuinely
        # open (Get-Process returning nothing -- the default BeforeEach mock
        # -- is indistinguishable from Stop-Process legitimately running
        # zero times against zero matches, so this test needs Get-Process to
        # actually hand back something to prove Stop-Process gets it).
        Mock Get-Process { return [PSCustomObject]@{ Id = 99999; ProcessName = 'zebar' } }
        $settings = "$env:TEMP\rz-settings-empty-$PID.json"
        '{ "startupConfigs": [] }' | Set-Content $settings -Encoding utf8
        Restart-ZebarWidgets -ZebarExe $script:rzFakeExe -SettingsPath $settings -StartupWaitMs 1
        Should -Invoke Stop-Process -Times 1
    }

    It "falls back to restarting only caelestia/bar, with a warning, when settings.json is missing" {
        $settings = "$env:TEMP\rz-settings-missing-$PID.json"
        Remove-Item $settings -Force -ErrorAction SilentlyContinue
        $warnings = @()
        Restart-ZebarWidgets -ZebarExe $script:rzFakeExe -SettingsPath $settings -StartupWaitMs 1 -WarningVariable warnings -WarningAction SilentlyContinue
        Should -Invoke Start-Process -Times 1
        Should -Invoke Start-Process -ParameterFilter { $ArgumentList -contains 'caelestia' }
        ($warnings -join ' ') | Should -Match 'caelestia'
    }

    It "falls back to restarting only caelestia/bar, with a warning, when settings.json is unparseable" {
        $settings = "$env:TEMP\rz-settings-badjson-$PID.json"
        [System.IO.File]::WriteAllText($settings, "not json {{{", (New-Object System.Text.UTF8Encoding($false)))
        $warnings = @()
        Restart-ZebarWidgets -ZebarExe $script:rzFakeExe -SettingsPath $settings -StartupWaitMs 1 -WarningVariable warnings -WarningAction SilentlyContinue
        Should -Invoke Start-Process -Times 1
        ($warnings -join ' ') | Should -Match 'caelestia'
    }

    It "does not touch any process when zebar.exe itself is not found, and warns instead" {
        $settings = "$env:TEMP\rz-settings-noexe-$PID.json"
        '{ "startupConfigs": [] }' | Set-Content $settings -Encoding utf8
        $warnings = @()
        Restart-ZebarWidgets -ZebarExe "$env:TEMP\does-not-exist-zebar-$PID.exe" -SettingsPath $settings -WarningVariable warnings -WarningAction SilentlyContinue
        Should -Invoke Stop-Process -Times 0
        Should -Invoke Start-Process -Times 0
        ($warnings -join ' ') | Should -Match 'not found'
    }

    It "surfaces a warning when start-widget-preset exits immediately with a nonzero code, instead of firing-and-forgetting" {
        Mock Start-Process { return [PSCustomObject]@{ HasExited = $true; ExitCode = 1 } }
        $settings = "$env:TEMP\rz-settings-fail-$PID.json"
        '{ "startupConfigs": [] }' | Set-Content $settings -Encoding utf8
        $warnings = @()
        Restart-ZebarWidgets -ZebarExe $script:rzFakeExe -SettingsPath $settings -StartupWaitMs 1 -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'caelestia'
    }
}
