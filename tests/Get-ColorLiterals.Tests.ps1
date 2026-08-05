BeforeAll {
    . "$PSScriptRoot\..\scripts\Get-ColorLiterals.ps1"
    $script:fixture = "$PSScriptRoot\fixtures\sample.css"
}

Describe "Get-ColorLiterals" {
    It "finds every distinct color" {
        $r = Get-ColorLiterals -Path $script:fixture
        $r.Count | Should -Be 5
    }

    It "treats hex case-insensitively and counts both uses" {
        $r = Get-ColorLiterals -Path $script:fixture
        ($r | Where-Object { $_.Literal -eq '#cba6f7' }).Count | Should -Be 2
    }

    It "emits hex literals lowercased even when uppercase appears first" {
        $r = Get-ColorLiterals -Path $script:fixture
        @($r | Where-Object { $_.Literal -ceq '#abcdef' }).Count | Should -Be 1
        @($r | Where-Object { $_.Literal -ceq '#ABCDEF' }).Count | Should -Be 0
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

Describe "The zebar bar's zero-color-literal invariant (I5)" {
    <#
      This is the branch's central invariant -- style.css (structure/layout
      only) must never regress into hardcoding a colour that belongs in
      theme.css (the matugen-generated palette). Before this test, only a
      hand-grep enforced it, and the erosion path is already live: see
      style.css's comment on `.vesktop--pinged` settling for var(--primary)
      because no red token exists yet. Machinery already existed
      (Get-ColorLiterals); it just had no caller pointed at the real file.
    #>
    BeforeAll {
        $script:styleCss = "$PSScriptRoot\..\zebar\caelestia\bar\style.css"
        $script:themeCss = "$PSScriptRoot\..\zebar\caelestia\bar\theme.css"
    }

    It "style.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:styleCss).Count | Should -Be 0
    }

    It "is non-vacuous: theme.css (which legitimately hardcodes the matugen palette) returns a nonzero count" {
        # Proves the check above can actually fail against a real file with
        # real colour literals in it -- theme.css is the one file in this
        # pack that is SUPPOSED to have them (it's the matugen-generated
        # palette style.css's var(--...) tokens point at), so if this ever
        # returned 0 it would mean Get-ColorLiterals itself silently broke,
        # not that theme.css became clean.
        @(Get-ColorLiterals -Path $script:themeCss).Count | Should -Be 7
    }
}
