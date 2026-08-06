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
        $before = (Get-Item "$env:USERPROFILE\.config\starship.toml").LastWriteTimeUtc
        Apply-Theme -Image $script:probe -DryRun
        (Get-Item "$env:USERPROFILE\.config\starship.toml").LastWriteTimeUtc | Should -Be $before
    }

    It "yasb's live config is never touched -- retired as a theming target" {
        # yasb and tacky-borders were retired as pipeline targets in favour
        # of the Zebar bar and komorebi's own window borders. ~/.config/yasb
        # is explicitly out of scope for this repo to ever write to again
        # (see CLAUDE.md) -- this proves it, rather than merely asserting it
        # by omission.
        $yasbCss = "$env:USERPROFILE\.config\yasb\styles.css"
        if (-not (Test-Path $yasbCss)) {
            Set-ItResult -Skipped -Because "~/.config/yasb/styles.css does not exist on this machine"
            return
        }
        $before = (Get-Item $yasbCss).LastWriteTimeUtc
        Apply-Theme -Image $script:probe -DryRun
        (Get-Item $yasbCss).LastWriteTimeUtc | Should -Be $before
    }

    It "-DryRun renders the three remaining target staging files, plus the non-target komorebi-colours.json" {
        Apply-Theme -Image $script:probe -DryRun
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css', 'komorebi-colours.json') {
            Test-Path "$PSScriptRoot\..\state\staging\$f" | Should -BeTrue
        }
    }

    It "no longer renders styles.css or tacky-config.yaml -- yasb/tacky retired as targets" {
        Apply-Theme -Image $script:probe -DryRun
        foreach ($f in 'styles.css', 'tacky-config.yaml') {
            Test-Path "$PSScriptRoot\..\state\staging\$f" | Should -BeFalse
        }
    }

    It "renders staging files without a BOM" {
        Apply-Theme -Image $script:probe -DryRun
        $b = [System.IO.File]::ReadAllBytes("$PSScriptRoot\..\state\staging\theme.css")
        ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) | Should -BeFalse
    }
}

Describe "Apply-Theme targets (yasb/tacky retirement)" {
    It "does not include yasb or tacky as theming targets" {
        $script:Targets.Name | Should -Not -Contain 'yasb'
        $script:Targets.Name | Should -Not -Contain 'tacky'
    }

    It "still includes wezterm, starship and zebar" {
        $script:Targets.Name | Should -Contain 'wezterm'
        $script:Targets.Name | Should -Contain 'starship'
        $script:Targets.Name | Should -Contain 'zebar'
    }

    It "has exactly three targets" {
        $script:Targets.Count | Should -Be 3
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
        # Post yasb/tacky retirement, $script:Targets (and therefore every
        # file Update-LastGood actually rotates) is palette.lua/
        # starship.toml/theme.css -- three files, not the original five.
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotStaging $f), "NEW-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    AfterEach {
        Remove-Item $script:rotRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "promotes staged content to last-good on first run, with no last-good-prev created" {
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        (Get-Content (Join-Path $script:rotLastGood 'palette.lua') -Raw).Trim() | Should -Be 'NEW-palette.lua'
        Test-Path $script:rotLastGoodPrev | Should -BeFalse
        Test-Path $script:rotLastGoodNew | Should -BeFalse
    }

    It "rotates an existing last-good into last-good-prev and promotes the new generation, for all three files" {
        New-Item -ItemType Directory -Force -Path $script:rotLastGood | Out-Null
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGood $f), "OLD-$f", (New-Object System.Text.UTF8Encoding($false)))
        }

        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            (Get-Content (Join-Path $script:rotLastGood $f) -Raw).Trim() | Should -Be "NEW-$f"
            (Get-Content (Join-Path $script:rotLastGoodPrev $f) -Raw).Trim() | Should -Be "OLD-$f"
        }
        Test-Path $script:rotLastGoodNew | Should -BeFalse
    }

    It "a second rotation replaces last-good-prev rather than accumulating a third generation" {
        New-Item -ItemType Directory -Force -Path $script:rotLastGood | Out-Null
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGood $f), 'GEN1', (New-Object System.Text.UTF8Encoding($false)))
        }

        # rotation 1: GEN1 (last-good) -> last-good-prev; staged NEW-* -> last-good
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        # stage a third generation and rotate again
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotStaging $f), "GEN3-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew

        (Get-Content (Join-Path $script:rotLastGood 'palette.lua') -Raw).Trim() | Should -Be 'GEN3-palette.lua'
        (Get-Content (Join-Path $script:rotLastGoodPrev 'palette.lua') -Raw).Trim() | Should -Be 'NEW-palette.lua'
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
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            [System.IO.File]::WriteAllText((Join-Path $script:rotLastGoodPrev $f), "SURVIVOR-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        Test-Path $script:rotLastGood | Should -BeFalse  # simulating the interrupted state

        $warnings = @()
        Update-LastGood -StagingDir $script:rotStaging -LastGoodDir $script:rotLastGood -LastGoodPrevDir $script:rotLastGoodPrev -LastGoodNewDir $script:rotLastGoodNew -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'last-good-prev'

        # last-good-prev must survive, untouched, with its original content.
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
            (Get-Content (Join-Path $script:rotLastGoodPrev $f) -Raw).Trim() | Should -Be "SURVIVOR-$f"
        }
        # This run's staged content is still promoted to last-good normally.
        (Get-Content (Join-Path $script:rotLastGood 'palette.lua') -Raw).Trim() | Should -Be 'NEW-palette.lua'
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

    It "F2: also snapshots and restores komorebi.json, which has no entry in script:Targets at all" {
        # komorebi.json is hand-maintained, lives outside any git repo, and
        # (unlike palette.lua/starship.toml/theme.css) has no Live/Staged
        # entry in $script:Targets at all -- before this fix it had no
        # pre-apply recovery path whatsoever, unlike every other target.
        $komorebiPath = Join-Path $script:preRoot 'komorebi.json'
        [System.IO.File]::WriteAllText($komorebiPath, 'HAND-MAINTAINED-KOMOREBI', (New-Object System.Text.UTF8Encoding($false)))

        New-PreApplySnapshot -Targets $script:preTargets -PreApplyDir $script:preSnapDir -KomorebiJsonPath $komorebiPath
        Test-Path (Join-Path $script:preSnapDir 'komorebi.json') | Should -BeTrue

        # Simulate Update-KomorebiBorderTheme writing new (bad) content.
        [System.IO.File]::WriteAllText($komorebiPath, 'BAD-NEW-BORDER-COLOURS', (New-Object System.Text.UTF8Encoding($false)))

        Restore-PreApplySnapshot -Targets $script:preTargets -PreApplyDir $script:preSnapDir -KomorebiJsonPath $komorebiPath
        (Get-Content $komorebiPath -Raw).Trim() | Should -Be 'HAND-MAINTAINED-KOMOREBI'
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
        # Stage only 1 of the 3 real target files (post yasb/tacky
        # retirement, $script:Targets is palette.lua/starship.toml/
        # theme.css) -- omit starship.toml and theme.css, simulating a disk
        # error / missing render partway through.
        foreach ($f in 'palette.lua') {
            [System.IO.File]::WriteAllText((Join-Path $script:ilStaging $f), "NEW-$f", (New-Object System.Text.UTF8Encoding($false)))
        }
        # Existing last-good baseline that must survive untouched if this
        # run's promotion fails.
        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
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

        foreach ($f in 'palette.lua', 'starship.toml', 'theme.css') {
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

Describe "Test-StagedFile no longer accepts -AcceptStructuralChange (I7 retired with yasb)" {
    It "does not expose an -AcceptStructuralChange parameter" {
        (Get-Command Test-StagedFile).Parameters.Keys | Should -Not -Contain 'AcceptStructuralChange'
    }
}

Describe "Apply-Theme no longer accepts -AcceptStructuralChange (I7 retired with yasb)" {
    It "does not expose an -AcceptStructuralChange parameter" {
        (Get-Command Apply-Theme).Parameters.Keys | Should -Not -Contain 'AcceptStructuralChange'
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

Describe "ConvertFrom-HexColor" {
    It "converts a 6-digit hex string to an R/G/B integer triplet" {
        $rgb = ConvertFrom-HexColor -Hex '#FF8040'
        $rgb.R | Should -Be 255
        $rgb.G | Should -Be 128
        $rgb.B | Should -Be 64
    }

    It "works without a leading '#'" {
        $rgb = ConvertFrom-HexColor -Hex '336699'
        $rgb.R | Should -Be 51
        $rgb.G | Should -Be 102
        $rgb.B | Should -Be 153
    }

    It "expands a 3-digit shorthand hex string" {
        $rgb = ConvertFrom-HexColor -Hex '#0F0'
        $rgb.R | Should -Be 0
        $rgb.G | Should -Be 255
        $rgb.B | Should -Be 0
    }

    It "is case-insensitive" {
        $rgb = ConvertFrom-HexColor -Hex '#abcdef'
        $rgb.R | Should -Be 171
        $rgb.G | Should -Be 205
        $rgb.B | Should -Be 239
    }

    It "throws on a value that is not a valid hex colour" {
        { ConvertFrom-HexColor -Hex 'not-a-color' } | Should -Throw
    }
}

Describe "Set-KomorebiBorderColours (persist border colours into komorebi.json)" {
    BeforeEach {
        $script:kbcPath = "$env:TEMP\komorebi-bordercolours-test-$PID-$(Get-Random).json"
        # A trimmed-down but realistic fixture: real top-level keys that
        # MUST survive untouched, including an ignore_rules array (the
        # real ~/komorebi.json's most hand-maintained section) with more
        # than one entry, so a naive "rebuild the object" implementation
        # that drops or reorders entries would be caught.
        $fixture = @'
{
  "$schema": "https://raw.githubusercontent.com/LGUG2Z/komorebi/v0.1.41/schema.json",
  "default_workspace_padding": 5,
  "default_container_padding": 5,
  "border": false,
  "ignore_rules": [
    { "kind": "Exe", "id": "yasb.exe", "matching_strategy": "Equals" },
    { "kind": "Title", "id": "[Pp]icture.in.[Pp]icture", "matching_strategy": "Regex" }
  ],
  "monitors": [ { "workspaces": [ { "name": "1", "layout": "BSP" } ] } ]
}
'@
        [System.IO.File]::WriteAllText($script:kbcPath, $fixture, (New-Object System.Text.UTF8Encoding($false)))
    }
    AfterEach {
        Remove-Item $script:kbcPath -Force -ErrorAction SilentlyContinue
    }

    It "adds a border_colours object with the supplied hex values" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC'; stack = '#112233' }
        $obj = [System.IO.File]::ReadAllText($script:kbcPath) | ConvertFrom-Json
        $obj.border_colours.single | Should -Be '#AABBCC'
        $obj.border_colours.stack | Should -Be '#112233'
    }

    It "preserves every other top-level key, including the full ignore_rules array" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' }
        $obj = [System.IO.File]::ReadAllText($script:kbcPath) | ConvertFrom-Json
        $obj.default_workspace_padding | Should -Be 5
        $obj.default_container_padding | Should -Be 5
        $obj.border | Should -Be $false
        $obj.ignore_rules.Count | Should -Be 2
        $obj.ignore_rules[0].id | Should -Be 'yasb.exe'
        $obj.ignore_rules[1].id | Should -Be '[Pp]icture.in.[Pp]icture'
        $obj.monitors[0].workspaces[0].name | Should -Be '1'
    }

    It "is idempotent -- re-running with the same colours updates in place rather than duplicating" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' }
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' }
        $obj = [System.IO.File]::ReadAllText($script:kbcPath) | ConvertFrom-Json
        ($obj.border_colours.PSObject.Properties | Where-Object Name -eq 'single').Count | Should -Be 1
        $obj.border_colours.single | Should -Be '#AABBCC'
    }

    It "updates an existing border_colours entry rather than leaving the old value" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#111111' }
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#222222' }
        $obj = [System.IO.File]::ReadAllText($script:kbcPath) | ConvertFrom-Json
        $obj.border_colours.single | Should -Be '#222222'
    }

    It "throws when the target file does not exist" {
        { Set-KomorebiBorderColours -Path "$env:TEMP\does-not-exist-$PID.json" -Colours @{ single = '#AABBCC' } } | Should -Throw
    }

    It "writes without a BOM" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' }
        $b = [System.IO.File]::ReadAllBytes($script:kbcPath)
        ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) | Should -BeFalse
    }

    It "does not leave a stray temp file behind after a successful write (F2: atomic replace)" {
        Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' }
        $dir = Split-Path $script:kbcPath -Parent
        $leaf = Split-Path $script:kbcPath -Leaf
        Get-ChildItem $dir -Filter "*$leaf*.tmp*" -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
    }

    It "throws instead of silently truncating the file when the content is whitespace-only (F3)" {
        # A whitespace-only file parses to `$null` via ConvertFrom-Json (verified: no
        # exception raised), NOT malformed JSON that would already throw on its own.
        # Before the fix, execution continued past this point: Get-Member/Add-Member on
        # `$null` raise only NON-TERMINATING errors (nothing here catches them),
        # ConvertTo-Json on `$null` produces no output, and
        # WriteAllText(path, $null) truncates the file to 0 bytes with NO exception at
        # all -- verified locally: a 7-byte fixture became 0 bytes. The fix must throw
        # before ever reaching the write.
        [System.IO.File]::WriteAllText($script:kbcPath, "   `r`n  ", (New-Object System.Text.UTF8Encoding($false)))
        $before = [System.IO.File]::ReadAllBytes($script:kbcPath)
        { Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' } } | Should -Throw
        $after = [System.IO.File]::ReadAllBytes($script:kbcPath)
        $after.Length | Should -Be $before.Length
        $after.Length | Should -Not -Be 0
    }

    It "throws instead of silently truncating the file when the content is the literal 'null' (F3)" {
        [System.IO.File]::WriteAllText($script:kbcPath, 'null', (New-Object System.Text.UTF8Encoding($false)))
        $before = [System.IO.File]::ReadAllBytes($script:kbcPath)
        { Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' } } | Should -Throw
        $after = [System.IO.File]::ReadAllBytes($script:kbcPath)
        $after.Length | Should -Be $before.Length
        $after.Length | Should -Not -Be 0
    }

    It "throws instead of treating every element as a member container when the JSON root is an array (F4)" {
        # ConvertFrom-Json on a root-level array yields an Object[], not a
        # PSCustomObject -- Add-Member against that would (pre-fix) silently
        # attach border_colours to EVERY element via PowerShell's pipeline
        # member-enumeration behaviour, or fail non-terminating and then
        # truncate the file the same way the null case does.
        [System.IO.File]::WriteAllText($script:kbcPath, '[{"a":1},{"b":2}]', (New-Object System.Text.UTF8Encoding($false)))
        $before = [System.IO.File]::ReadAllBytes($script:kbcPath)
        { Set-KomorebiBorderColours -Path $script:kbcPath -Colours @{ single = '#AABBCC' } } | Should -Throw
        $after = [System.IO.File]::ReadAllBytes($script:kbcPath)
        $after.Length | Should -Be $before.Length
        $after.Length | Should -Not -Be 0
    }
}

Describe "Set-KomorebiBorderColour (runtime CLI, fail soft)" {
    It "fails soft (warns, does not throw) when komorebic is not on PATH" {
        $komorebicCmd = Get-Command komorebic -ErrorAction SilentlyContinue
        if (-not $komorebicCmd) {
            Set-ItResult -Skipped -Because "komorebic is not installed on this machine"
            return
        }
        $komorebicDir = Split-Path $komorebicCmd.Source -Parent
        $prevPath = $env:PATH
        $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $komorebicDir.TrimEnd('\') }) -join ';'
        try {
            (Get-Command komorebic -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
            # NOTE: -WarningVariable must be bound on a DIRECT call, not inside
            # a `{ ... } | Should -Not -Throw` scriptblock -- a scriptblock
            # introduces its own scope, so a variable it populates via
            # -WarningVariable never becomes visible to this outer $warnings.
            # Calling directly also proves "does not throw" just as well: an
            # uncaught exception here would fail this It block on its own.
            $warnings = @()
            Set-KomorebiBorderColour -R 1 -G 2 -B 3 -WindowKind single -WarningVariable warnings -WarningAction SilentlyContinue
            # F7: 'PATH' alone is also satisfied by CommandNotFoundException's own
            # message text, so this assertion would pass even if the PATH guard at
            # the top of Set-KomorebiBorderColour were deleted entirely (the `&
            # komorebic ...` call below it would then throw that exception message,
            # which itself contains the word "PATH"). Match the guard's own warning
            # text instead, which only appears if the guard actually fired.
            ($warnings -join ' ') | Should -Match 'skipping runtime border-colour'
        } finally {
            $env:PATH = $prevPath
        }
    }

    It "warns instead of throwing when the komorebic call itself fails (mocked)" {
        Mock komorebic { $global:LASTEXITCODE = 1 }
        $warnings = @()
        Set-KomorebiBorderColour -R 1 -G 2 -B 3 -WindowKind stack -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'stack'
    }

    It "calls komorebic border-colour with the exact R/G/B and --window-kind arguments (mocked)" {
        Mock komorebic { $global:LASTEXITCODE = 0 }
        Set-KomorebiBorderColour -R 10 -G 20 -B 30 -WindowKind monocle
        Should -Invoke komorebic -Times 1 -ParameterFilter {
            $args -join ' ' -match 'border-colour 10 20 30' -and ($args -join ' ') -match '--window-kind monocle'
        }
    }
}

Describe "Update-KomorebiBorderTheme (orchestrates runtime + persisted border-colour updates)" {
    BeforeEach {
        $script:ukbtRoot = "$env:TEMP\ukbt-test-$PID-$(Get-Random)"
        New-Item -ItemType Directory -Force -Path $script:ukbtRoot | Out-Null
        $script:ukbtKomorebiJson = Join-Path $script:ukbtRoot 'komorebi.json'
        [System.IO.File]::WriteAllText($script:ukbtKomorebiJson, '{ "border": false, "ignore_rules": [ { "kind": "Exe", "id": "yasb.exe" } ] }', (New-Object System.Text.UTF8Encoding($false)))
        $script:ukbtColoursPath = Join-Path $script:ukbtRoot 'komorebi-colours.json'
    }
    AfterEach {
        Remove-Item $script:ukbtRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It "warns and makes no changes when the staged colours file was never rendered" {
        $warnings = @()
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'not staged'
        $obj = [System.IO.File]::ReadAllText($script:ukbtKomorebiJson) | ConvertFrom-Json
        (Get-Member -InputObject $obj -Name 'border_colours' -MemberType NoteProperty) | Should -BeNullOrEmpty
    }

    It "warns and makes no changes when the staged colours file still has an unrendered template expression" {
        [System.IO.File]::WriteAllText($script:ukbtColoursPath, '{ "single": "{{colors.primary.default.hex}}" }', (New-Object System.Text.UTF8Encoding($false)))
        $warnings = @()
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'unrendered'
        $obj = [System.IO.File]::ReadAllText($script:ukbtKomorebiJson) | ConvertFrom-Json
        (Get-Member -InputObject $obj -Name 'border_colours' -MemberType NoteProperty) | Should -BeNullOrEmpty
    }

    It "warns and makes no changes when the staged colours file is not valid JSON" {
        [System.IO.File]::WriteAllText($script:ukbtColoursPath, 'not json at all', (New-Object System.Text.UTF8Encoding($false)))
        $warnings = @()
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'could not be parsed'
    }

    It "still persists into komorebi.json when komorebi is not running, after warning" {
        [System.IO.File]::WriteAllText($script:ukbtColoursPath, '{ "single": "#AABBCC", "stack": "#112233", "monocle": "#334455", "unfocused": "#556677", "floating": "#EE0000" }', (New-Object System.Text.UTF8Encoding($false)))
        Mock Get-Process { $null } -ParameterFilter { $Name -eq 'komorebi' }
        $warnings = @()
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'not running'
        $obj = [System.IO.File]::ReadAllText($script:ukbtKomorebiJson) | ConvertFrom-Json
        $obj.border_colours.single | Should -Be '#AABBCC'
        $obj.border_colours.floating | Should -Be '#EE0000'
        # The pre-existing ignore_rules entry must survive untouched.
        $obj.ignore_rules[0].id | Should -Be 'yasb.exe'
    }

    It "calls the runtime border-colour update for every mapped kind when komorebi IS running (mocked)" {
        [System.IO.File]::WriteAllText($script:ukbtColoursPath, '{ "single": "#AABBCC", "stack": "#112233", "monocle": "#334455", "unfocused": "#556677", "floating": "#EE0000" }', (New-Object System.Text.UTF8Encoding($false)))
        Mock Get-Process { [PSCustomObject]@{ Id = 1 } } -ParameterFilter { $Name -eq 'komorebi' }
        Mock Set-KomorebiBorderColour {}
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson
        Should -Invoke Set-KomorebiBorderColour -Times 5
        Should -Invoke Set-KomorebiBorderColour -Times 1 -ParameterFilter { $WindowKind -eq 'single' -and $R -eq 170 -and $G -eq 187 -and $B -eq 204 }
    }

    It "F1: does not throw and still themes the other kinds when one value is malformed (e.g. a .rgb accessor used instead of .hex)" {
        # Reproduced by the reviewer with a template edited to use matugen's
        # documented `.rgb` accessor instead of `.hex` for one role -- both
        # accessors are legitimate matugen output, but ConvertFrom-HexColor only
        # accepts hex. Before the fix this threw out of the runtime-update
        # foreach, uncaught, aborting BOTH the runtime update and the
        # komorebi.json persistence for every other (perfectly valid) kind too.
        [System.IO.File]::WriteAllText($script:ukbtColoursPath, '{ "single": "rgb(135,209,234)", "stack": "#112233", "monocle": "#334455", "unfocused": "#556677", "floating": "#EE0000" }', (New-Object System.Text.UTF8Encoding($false)))
        Mock Get-Process { [PSCustomObject]@{ Id = 1 } } -ParameterFilter { $Name -eq 'komorebi' }
        Mock Set-KomorebiBorderColour {}
        # NOTE (same pitfall as Set-KomorebiBorderColour's PATH test above):
        # -WarningVariable must be bound on a DIRECT call, not inside a
        # `{ ... } | Should -Not -Throw` scriptblock, or the outer $warnings
        # never gets populated. Calling directly proves "does not throw"
        # just as well -- an uncaught exception here fails this It on its own.
        $warnings = @()
        Update-KomorebiBorderTheme -StagedColoursPath $script:ukbtColoursPath -KomorebiJsonPath $script:ukbtKomorebiJson -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'single'
        # The four well-formed kinds must still be themed, both halves.
        Should -Invoke Set-KomorebiBorderColour -Times 4
        Should -Invoke Set-KomorebiBorderColour -Times 0 -ParameterFilter { $WindowKind -eq 'single' }
        $obj = [System.IO.File]::ReadAllText($script:ukbtKomorebiJson) | ConvertFrom-Json
        $obj.border_colours.stack | Should -Be '#112233'
        (Get-Member -InputObject $obj.border_colours -Name 'single' -MemberType NoteProperty) | Should -BeNullOrEmpty
    }
}

Describe "Apply-Theme -DryRun leaves ~/komorebi.json untouched" {
    It "does not modify komorebi.json (the border-theming step never runs under -DryRun)" {
        $komorebiJson = "$env:USERPROFILE\komorebi.json"
        if (-not (Test-Path $komorebiJson)) {
            Set-ItResult -Skipped -Because "~/komorebi.json does not exist on this machine"
            return
        }
        $before = (Get-Item $komorebiJson).LastWriteTimeUtc
        Apply-Theme -Image $script:probe -DryRun
        (Get-Item $komorebiJson).LastWriteTimeUtc | Should -Be $before
    }
}
