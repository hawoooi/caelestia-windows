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
}
