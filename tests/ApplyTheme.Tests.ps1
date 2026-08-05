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
}
