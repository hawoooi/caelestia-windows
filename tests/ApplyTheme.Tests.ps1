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
        foreach ($f in 'styles.css', 'tacky-config.yaml', 'palette.lua', 'starship.toml') {
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
