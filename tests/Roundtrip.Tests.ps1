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

    It "detects a 6-digit literal masquerading inside a longer hex run (#ABCDEF12)" {
        # Regression for the missing-\b defect: an unbounded hex pattern lets
        # a mapping for "#abcdef" partially match inside an 8-digit value
        # like "#ABCDEF12", orphaning the "12" onto the expression. This
        # hand-crafts exactly that corrupted template (what the pre-fix
        # New-Template produced) and checks Test-Roundtrip's verdict
        # directly, independent of New-Template's current behavior.
        $hexSrc  = "$env:TEMP\hex-boundary.css"
        $hexMap  = "$env:TEMP\hex-boundary-mapping.json"
        $hexTmpl = "$env:TEMP\hex-boundary.css.tmpl"

        [System.IO.File]::WriteAllText($hexSrc, ".x { color: #ABCDEF12; }", (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($hexMap, '{ "#abcdef": { "expression": "{{colors.secondary.default.hex}}" } }', (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($hexTmpl, ".x { color: {{colors.secondary.default.hex}}12; }", (New-Object System.Text.UTF8Encoding($false)))

        Test-Roundtrip -SourcePath $hexSrc -TemplatePath $hexTmpl -MappingPath $hexMap | Should -BeFalse
    }

    It "New-Template leaves a longer hex run untouched, and the roundtrip is genuinely clean" {
        # Companion to the test above: with the \b fix, New-Template must not
        # substitute at all here (the value isn't the mapped 6-digit color),
        # and the real, unmodified roundtrip must be True -- not a
        # coincidentally-True false positive.
        $hexSrc  = "$env:TEMP\hex-boundary2.css"
        $hexMap  = "$env:TEMP\hex-boundary2-mapping.json"
        $hexTmpl = "$env:TEMP\hex-boundary2.css.tmpl"

        [System.IO.File]::WriteAllText($hexSrc, ".x { color: #ABCDEF12; }", (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($hexMap, '{ "#abcdef": { "expression": "{{colors.secondary.default.hex}}" } }', (New-Object System.Text.UTF8Encoding($false)))

        New-Template -SourcePath $hexSrc -MappingPath $hexMap -OutputPath $hexTmpl
        $t = [System.IO.File]::ReadAllText($hexTmpl)
        $t | Should -BeExactly ".x { color: #ABCDEF12; }"
        Test-Roundtrip -SourcePath $hexSrc -TemplatePath $hexTmpl -MappingPath $hexMap | Should -BeTrue
    }

    It "catches order-dependent corruption when one expression contains another key's literal text" {
        # Regression/documentation for the ordering constraint noted in
        # New-Template.ps1: substitutions apply sequentially to the evolving
        # text, so an expression must never contain another mapping key's
        # literal text. This is a deliberately pathological mapping (real
        # matugen expressions never contain "#hex" text) that proves
        # Test-Roundtrip catches the corruption if the constraint is ever
        # violated, rather than relying on it never happening.
        $ordSrc  = "$env:TEMP\ordering.css"
        $ordMap  = "$env:TEMP\ordering-mapping.json"
        $ordTmpl = "$env:TEMP\ordering.css.tmpl"

        [System.IO.File]::WriteAllText($ordSrc, ".y { color: #111111; border-color: #222222; }", (New-Object System.Text.UTF8Encoding($false)))
        $ordMapJson = @'
{
  "#111111": { "expression": "PREFIX #222222 SUFFIX" },
  "#222222": { "expression": "{{colors.foo.default.hex}}" }
}
'@
        [System.IO.File]::WriteAllText($ordMap, $ordMapJson, (New-Object System.Text.UTF8Encoding($false)))

        New-Template -SourcePath $ordSrc -MappingPath $ordMap -OutputPath $ordTmpl
        Test-Roundtrip -SourcePath $ordSrc -TemplatePath $ordTmpl -MappingPath $ordMap | Should -BeFalse
    }
}
