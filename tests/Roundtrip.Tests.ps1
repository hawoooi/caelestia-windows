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

Describe "Real round-trip gate against the recovered pre-migration Catppuccin fixture (I5)" {
    <#
      I5: CLAUDE.md documents a "re-run the round-trip gate" recovery
      procedure for when ~/.config/yasb/styles.css drifts from the
      mapping/template pair, but as of this fix wave that procedure could
      no longer actually be exercised: the pre-migration Catppuccin
      styles.css it needs to diff against does not exist ANYWHERE in this
      repo -- live, state/last-good/, and state/last-good-prev/ are all
      matugen-GENERATED output now, not the original hand-authored source.
      Following the documented steps against the current live file finds
      zero matches against matugen/mapping.json's Catppuccin-literal keys,
      New-Template emits `template == source` (nothing to substitute), and
      Test-Roundtrip trivially returns $true on a file with ~40 hardcoded
      literals and zero matugen expressions -- a vacuous pass on a gate
      that looks like it ran for real.

      Recovered the real source from yasb's OWN git history
      (~/.config/yasb is a separate git repo) at commit f1e7db6, the last
      commit before the styles.css/tacky-borders/wezterm/starship
      migration to matugen-templated output -- confirmed pre-migration by
      the absence of any {{ }} expression and the presence of the
      Catppuccin literals matugen/mapping.json's keys are built from
      (#cba6f7 etc). Copied byte-for-byte (sha256 verified against the git
      blob) into tests/fixtures/styles.css.catppuccin.

      This test runs the REAL gate -- New-Template then Test-Roundtrip --
      against that fixture using the REAL matugen/mapping.json, mirroring
      CLAUDE.md's documented steps 4-5 exactly, so the gate mechanism
      itself can be regression-tested at any time without needing a live
      styles.css that has genuinely drifted.

      Deliberately regenerates the template at test time rather than
      diffing the fixture against the checked-in
      matugen/templates/yasb.styles.css directly: this repo's git config
      has core.autocrlf=true and no .gitattributes pins CSS as LF, so the
      checked-in template's WORKING-TREE line endings (CRLF, from a real
      git checkout) do not necessarily match the fixture's (whatever the
      current working tree happens to have -- LF as committed here).
      Regenerating from the fixture at test time means both sides of the
      comparison always derive their line-ending convention from the same
      on-disk file, so this test's result cannot depend on git checkout
      settings on whatever machine runs it.
    #>
    BeforeAll {
        $script:catppuccinFixture = "$PSScriptRoot\fixtures\styles.css.catppuccin"
        $script:realMapping       = "$PSScriptRoot\..\matugen\mapping.json"
        $script:regenTemplate     = "$env:TEMP\yasb.styles.css.i5-regen"
    }

    It "the recovered fixture is genuinely pre-migration (sanity check on the fixture itself)" {
        Test-Path $script:catppuccinFixture | Should -BeTrue
        $text = [System.IO.File]::ReadAllText($script:catppuccinFixture)
        $text | Should -Not -Match '\{\{'
        $text | Should -Match '#cba6f7'
    }

    It "New-Template + the real gate pass against the recovered fixture with the real mapping.json" {
        New-Template -SourcePath $script:catppuccinFixture -MappingPath $script:realMapping -OutputPath $script:regenTemplate
        $ok = Test-Roundtrip -SourcePath $script:catppuccinFixture -TemplatePath $script:regenTemplate -MappingPath $script:realMapping
        $ok | Should -BeTrue
    }

    It "the regenerated template has no surviving raw color literals" {
        New-Template -SourcePath $script:catppuccinFixture -MappingPath $script:realMapping -OutputPath $script:regenTemplate
        $t = [System.IO.File]::ReadAllText($script:regenTemplate)
        $t | Should -Not -Match '#[0-9a-fA-F]{6}\b'
        $t | Should -Not -Match 'rgba?\(\s*\d+'
    }

    It "the checked-in matugen/templates/yasb.styles.css matches a fresh regeneration from the fixture, ignoring line-ending differences" {
        # Extra assurance beyond the gate test above: not just THAT some
        # regeneration passes, but that the artifact actually shipped in
        # this repo is still faithful to the recovered source.
        New-Template -SourcePath $script:catppuccinFixture -MappingPath $script:realMapping -OutputPath $script:regenTemplate
        $regen   = ([System.IO.File]::ReadAllText($script:regenTemplate)) -replace "`r`n", "`n"
        $shipped = ([System.IO.File]::ReadAllText("$PSScriptRoot\..\matugen\templates\yasb.styles.css")) -replace "`r`n", "`n"
        $regen | Should -BeExactly $shipped
    }
}
