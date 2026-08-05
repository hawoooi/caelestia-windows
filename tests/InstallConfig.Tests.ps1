BeforeAll {
    . "$PSScriptRoot\..\scripts\Install-Config.ps1"
    $script:tmp = Join-Path $env:TEMP "installcfg-tests"
}

# NOTE: Pester 6.0.1 rejects a BeforeEach declared directly at file/container
# root ("Each test setup is not supported in root"). The brief's BeforeEach
# is wrapped in this outer Describe so it still runs before every It below
# (Pester applies a Describe-scoped BeforeEach to all nested Describes),
# preserving the original per-test fresh-tmp-dir behavior unchanged.
Describe "Install-Config primitives" {
    BeforeEach {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
    }

    Describe "Set-PatchedBlock" {
        It "appends a block when the marker is absent" {
            $f = Join-Path $script:tmp "a.conf"
            [System.IO.File]::WriteAllText($f, "existing line`n", (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
            $t = [System.IO.File]::ReadAllText($f)
            $t | Should -Match 'existing line'
            $t | Should -Match '# >>> caelestia >>>'
            $t | Should -Match 'hello'
            $t | Should -Match '# <<< caelestia <<<'
        }

        It "is idempotent -- running twice produces identical content" {
            $f = Join-Path $script:tmp "b.conf"
            [System.IO.File]::WriteAllText($f, "keep`n", (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
            $once = [System.IO.File]::ReadAllText($f)
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
            [System.IO.File]::ReadAllText($f) | Should -BeExactly $once
        }

        It "replaces existing block content without touching the rest" {
            $f = Join-Path $script:tmp "c.conf"
            [System.IO.File]::WriteAllText($f, "before`n", (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'v1' -CommentPrefix '#'
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'v2' -CommentPrefix '#'
            $t = [System.IO.File]::ReadAllText($f)
            $t | Should -Match 'before'
            $t | Should -Match 'v2'
            $t | Should -Not -Match 'v1'
            ([regex]::Matches($t, '>>> caelestia >>>')).Count | Should -Be 1
        }

        It "writes without a BOM" {
            $f = Join-Path $script:tmp "d.conf"
            [System.IO.File]::WriteAllText($f, "x`n", (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'y' -CommentPrefix '#'
            $b = [System.IO.File]::ReadAllBytes($f)
            ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) | Should -BeFalse
        }

        It "supports a Lua comment prefix" {
            $f = Join-Path $script:tmp "e.lua"
            [System.IO.File]::WriteAllText($f, "return {}`n", (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'local x = 1' -CommentPrefix '--'
            [System.IO.File]::ReadAllText($f) | Should -Match '-- >>> caelestia >>>'
        }
    }

    Describe "Remove-PatchedBlock" {
        It "removes the block and leaves surrounding content byte-identical" {
            $f = Join-Path $script:tmp "f.conf"
            $orig = "line one`nline two`n"
            [System.IO.File]::WriteAllText($f, $orig, (New-Object System.Text.UTF8Encoding($false)))
            Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'temp' -CommentPrefix '#'
            Remove-PatchedBlock -Path $f -Marker 'caelestia' -CommentPrefix '#'
            [System.IO.File]::ReadAllText($f) | Should -BeExactly $orig
        }

        It "is a no-op when the marker is absent" {
            $f = Join-Path $script:tmp "g.conf"
            $orig = "untouched`n"
            [System.IO.File]::WriteAllText($f, $orig, (New-Object System.Text.UTF8Encoding($false)))
            Remove-PatchedBlock -Path $f -Marker 'caelestia' -CommentPrefix '#'
            [System.IO.File]::ReadAllText($f) | Should -BeExactly $orig
        }
    }

    Describe "Set-ManagedJunction" {
        It "creates a junction pointing at the target" {
            $target = Join-Path $script:tmp "target"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "link"
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Should -BeTrue
            (Get-Item $link).LinkType | Should -Be 'Junction'
        }

        It "is idempotent -- the second call is a true no-op, not a delete-and-recreate that happens to return `$true (M1)" {
            # The old test only asserted the return value, which is `$true`
            # on BOTH the early-return (real no-op) path AND the
            # delete-and-recreate path -- it would pass even if idempotence
            # were silently broken. CreationTime survives an early return
            # but changes when the reparse point is deleted and remade, so
            # comparing it before/after actually distinguishes the two.
            $target = Join-Path $script:tmp "target2"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "link2"
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Out-Null
            $before = (Get-Item $link -Force).CreationTime
            Start-Sleep -Milliseconds 50
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Should -BeTrue
            (Get-Item $link -Force).CreationTime | Should -Be $before
        }

        It "repoints a junction aimed at the wrong target" {
            $t1 = Join-Path $script:tmp "t1"; New-Item -ItemType Directory -Force -Path $t1 | Out-Null
            $t2 = Join-Path $script:tmp "t2"; New-Item -ItemType Directory -Force -Path $t2 | Out-Null
            $link = Join-Path $script:tmp "link3"
            Set-ManagedJunction -LinkPath $link -TargetPath $t1 | Out-Null
            Set-ManagedJunction -LinkPath $link -TargetPath $t2 | Should -BeTrue
            (Get-Item $link).Target | Should -Be $t2
        }

        It "refuses to replace a real directory that is not a junction" {
            $real = Join-Path $script:tmp "realdir"; New-Item -ItemType Directory -Force -Path $real | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $real "keep.txt"), "data", (New-Object System.Text.UTF8Encoding($false)))
            $target = Join-Path $script:tmp "t3"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            { Set-ManagedJunction -LinkPath $real -TargetPath $target } | Should -Throw
            Test-Path (Join-Path $real "keep.txt") | Should -BeTrue
        }
    }

    Describe "Install-Config (I1: -Uninstall -DryRun must touch nothing)" {
        <#
          Install-Config previously hardcoded every real target path
          ($env:USERPROFILE\.config\whkdrc, ~/.glzr/zebar/caelestia, ...)
          with no override parameters, which is exactly why this bug shipped
          undetected -- there was no way to exercise the function at all
          without writing to the real machine. Paths are now parameters
          (defaulting to the real locations for production use), which is
          what makes the fixture-based tests below possible.
        #>
        It "does NOT delete an existing junction when -Uninstall -DryRun is passed" {
            $target = Join-Path $script:tmp "ic-target"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "ic-link"
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Out-Null
            Test-Path $link | Should -BeTrue

            Install-Config -Uninstall -DryRun `
                -WhkdrcPath (Join-Path $script:tmp "ic-whkdrc.conf") `
                -JunctionLink $link -JunctionTarget $target `
                -BackupRoot (Join-Path $script:tmp "ic-backup") `
                -ZebarSettingsPath (Join-Path $script:tmp "ic-settings.json")

            Test-Path $link | Should -BeTrue
            (Get-Item $link -Force).LinkType | Should -Be 'Junction'
        }

        It "a real (non-DryRun) -Uninstall DOES remove the junction, proving the -DryRun test above is not vacuous" {
            $target = Join-Path $script:tmp "ic-target2"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "ic-link2"
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Out-Null

            Install-Config -Uninstall `
                -WhkdrcPath (Join-Path $script:tmp "ic-whkdrc2.conf") `
                -JunctionLink $link -JunctionTarget $target `
                -BackupRoot (Join-Path $script:tmp "ic-backup2") `
                -ZebarSettingsPath (Join-Path $script:tmp "ic-settings2.json")

            Test-Path $link | Should -BeFalse
        }

        It "-DryRun (install direction) still writes nothing -- whkdrc untouched and no junction created" {
            $whkdrc = Join-Path $script:tmp "ic-whkdrc3.conf"
            [System.IO.File]::WriteAllText($whkdrc, "original`n", (New-Object System.Text.UTF8Encoding($false)))
            $target = Join-Path $script:tmp "ic-target3"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "ic-link3"

            Install-Config -DryRun `
                -WhkdrcPath $whkdrc -JunctionLink $link -JunctionTarget $target `
                -BackupRoot (Join-Path $script:tmp "ic-backup3") `
                -ZebarSettingsPath (Join-Path $script:tmp "ic-settings3.json")

            (Get-Content $whkdrc -Raw) | Should -Be "original`n"
            Test-Path $link | Should -BeFalse
        }

        It "a real (non-DryRun) install DOES patch whkdrc and create the junction" {
            $whkdrc = Join-Path $script:tmp "ic-whkdrc4.conf"
            [System.IO.File]::WriteAllText($whkdrc, "original`n", (New-Object System.Text.UTF8Encoding($false)))
            $target = Join-Path $script:tmp "ic-target4"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "ic-link4"

            Install-Config `
                -WhkdrcPath $whkdrc -JunctionLink $link -JunctionTarget $target `
                -BackupRoot (Join-Path $script:tmp "ic-backup4") `
                -ZebarSettingsPath (Join-Path $script:tmp "ic-settings4.json")

            (Get-Content $whkdrc -Raw) | Should -Match 'caelestia-shell'
            Test-Path $link | Should -BeTrue
        }
    }

    Describe "Get-ZebarStartupConfigs / Set-ZebarStartupConfig / Remove-ZebarStartupConfig (I4)" {
        It "Get-ZebarStartupConfigs returns `$null when the file does not exist" {
            Get-ZebarStartupConfigs -Path (Join-Path $script:tmp "does-not-exist.json") | Should -BeNullOrEmpty
        }

        It "Get-ZebarStartupConfigs returns `$null (not throw) on unparseable JSON" {
            $p = Join-Path $script:tmp "zs-bad.json"
            [System.IO.File]::WriteAllText($p, "not json {{{", (New-Object System.Text.UTF8Encoding($false)))
            { Get-ZebarStartupConfigs -Path $p } | Should -Not -Throw
            Get-ZebarStartupConfigs -Path $p | Should -BeNullOrEmpty
        }

        It "Set-ZebarStartupConfig adds an entry while preserving an existing one (e.g. the real gunturdwiap.good-enough autostart)" {
            $p = Join-Path $script:tmp "zs-existing.json"
            [System.IO.File]::WriteAllText($p, (@'
{
  "$schema": "https://example/settings-schema.json",
  "startupConfigs": [
    { "pack": "gunturdwiap.good-enough", "widget": "main", "preset": "default" }
  ]
}
'@), (New-Object System.Text.UTF8Encoding($false)))

            Set-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar' -Preset 'default'

            $configs = Get-ZebarStartupConfigs -Path $p
            $configs.Count | Should -Be 2
            @($configs | Where-Object { $_.pack -eq 'gunturdwiap.good-enough' }).Count | Should -Be 1
            @($configs | Where-Object { $_.pack -eq 'caelestia' -and $_.widget -eq 'bar' }).Count | Should -Be 1
        }

        It "Set-ZebarStartupConfig is idempotent -- calling it twice does not duplicate the entry" {
            $p = Join-Path $script:tmp "zs-idempotent.json"
            Set-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar' -Preset 'default'
            Set-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar' -Preset 'default'
            (Get-ZebarStartupConfigs -Path $p).Count | Should -Be 1
        }

        It "Set-ZebarStartupConfig creates the file (and parent directory) when neither exists yet" {
            $p = Join-Path $script:tmp "zs-fresh\nested\settings.json"
            Test-Path $p | Should -BeFalse
            Set-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar' -Preset 'default'
            $configs = Get-ZebarStartupConfigs -Path $p
            $configs.Count | Should -Be 1
            $configs[0].pack | Should -Be 'caelestia'
        }

        It "Remove-ZebarStartupConfig removes only the matching entry, leaving others untouched" {
            $p = Join-Path $script:tmp "zs-remove.json"
            Set-ZebarStartupConfig -Path $p -Pack 'gunturdwiap.good-enough' -Widget 'main' -Preset 'default'
            Set-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar' -Preset 'default'

            Remove-ZebarStartupConfig -Path $p -Pack 'caelestia' -Widget 'bar'

            $configs = Get-ZebarStartupConfigs -Path $p
            $configs.Count | Should -Be 1
            $configs[0].pack | Should -Be 'gunturdwiap.good-enough'
        }

        It "Remove-ZebarStartupConfig is a no-op when the file does not exist" {
            { Remove-ZebarStartupConfig -Path (Join-Path $script:tmp "zs-noexist.json") -Pack 'caelestia' -Widget 'bar' } | Should -Not -Throw
        }

        It "Install-Config (non-Uninstall) registers caelestia/bar in ZebarSettingsPath's startupConfigs" {
            $settings = Join-Path $script:tmp "ic-zs-settings.json"
            Install-Config `
                -WhkdrcPath (Join-Path $script:tmp "ic-zs-whkdrc.conf") `
                -JunctionLink (Join-Path $script:tmp "ic-zs-link") `
                -JunctionTarget (New-Item -ItemType Directory -Force -Path (Join-Path $script:tmp "ic-zs-target")).FullName `
                -BackupRoot (Join-Path $script:tmp "ic-zs-backup") `
                -ZebarSettingsPath $settings

            $configs = Get-ZebarStartupConfigs -Path $settings
            @($configs | Where-Object { $_.pack -eq 'caelestia' -and $_.widget -eq 'bar' }).Count | Should -Be 1
        }

        It "Install-Config -Uninstall removes caelestia/bar from ZebarSettingsPath's startupConfigs" {
            $settings = Join-Path $script:tmp "ic-zs-settings2.json"
            Set-ZebarStartupConfig -Path $settings -Pack 'gunturdwiap.good-enough' -Widget 'main' -Preset 'default'
            Set-ZebarStartupConfig -Path $settings -Pack 'caelestia' -Widget 'bar' -Preset 'default'

            Install-Config -Uninstall `
                -WhkdrcPath (Join-Path $script:tmp "ic-zs-whkdrc2.conf") `
                -JunctionLink (Join-Path $script:tmp "ic-zs-link2") `
                -JunctionTarget (New-Item -ItemType Directory -Force -Path (Join-Path $script:tmp "ic-zs-target2")).FullName `
                -BackupRoot (Join-Path $script:tmp "ic-zs-backup2") `
                -ZebarSettingsPath $settings

            $configs = Get-ZebarStartupConfigs -Path $settings
            @($configs | Where-Object { $_.pack -eq 'caelestia' }).Count | Should -Be 0
            @($configs | Where-Object { $_.pack -eq 'gunturdwiap.good-enough' }).Count | Should -Be 1
        }
    }
}
