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

        It "is idempotent" {
            $target = Join-Path $script:tmp "target2"; New-Item -ItemType Directory -Force -Path $target | Out-Null
            $link   = Join-Path $script:tmp "link2"
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Out-Null
            Set-ManagedJunction -LinkPath $link -TargetPath $target | Should -BeTrue
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
}
