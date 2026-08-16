BeforeAll {
    . "$PSScriptRoot\..\scripts\Set-FrameGeometry.ps1"
    $script:tmp = Join-Path $env:TEMP "frame-geometry-tests"
    $script:realZpack      = "$PSScriptRoot\..\zebar\caelestia\zpack.json"
    $script:realCornersCss = "$PSScriptRoot\..\zebar\caelestia\corners\corners.css"
    $script:realEdgesCss   = "$PSScriptRoot\..\zebar\caelestia\edges\edges.css"
}

Describe "ConvertFrom-PxString" {
    It "parses a plain px value" {
        ConvertFrom-PxString -Value '52px' | Should -Be 52
    }
    It "throws on a non-px unit (e.g. the bar's own 100% height)" {
        { ConvertFrom-PxString -Value '100%' } | Should -Throw
    }
}

Describe "Get-FrameGeometryTable (pure computation)" {
    It "matches this task's own target table exactly for T=8, R=16, bar=52px, screen=2560x1440 (no edges/left)" {
        $table = Get-FrameGeometryTable -Thickness 8 -Radius 16 -BarWidth 52 -ScreenWidth 2560 -ScreenHeight 1440

        # Left-frame-removal pass: edges/left is GONE (seven presets, not
        # eight); the two left corners are R (16) wide, not C (24) --
        # everything else (right corners, edges/right) is unchanged from
        # the previous (sixth) pass.
        $expected = @{
            'corners/top-left'     = @{ X = 52;   Y = 0;    W = 16; H = 24 }
            'corners/top-right'    = @{ X = 2536; Y = 0;    W = 24; H = 24 }
            'corners/bottom-left'  = @{ X = 52;   Y = 1416; W = 16; H = 24 }
            'corners/bottom-right' = @{ X = 2536; Y = 1416; W = 24; H = 24 }
            'edges/top'             = @{ X = 68;   Y = 0;    W = 2468; H = 8 }
            'edges/bottom'          = @{ X = 68;   Y = 1432; W = 2468; H = 8 }
            'edges/right'           = @{ X = 2552; Y = 24;   W = 8;    H = 1392 }
        }

        $table.Count | Should -Be 7
        ($table | Where-Object { $_.Widget -eq 'edges' -and $_.Preset -eq 'left' }) | Should -BeNullOrEmpty
        foreach ($row in $table) {
            $key = "$($row.Widget)/$($row.Preset)"
            $expected.ContainsKey($key) | Should -BeTrue -Because "unexpected preset $key"
            $e = $expected[$key]
            $row.OffsetX | Should -Be $e.X -Because "$key OffsetX"
            $row.OffsetY | Should -Be $e.Y -Because "$key OffsetY"
            $row.Width   | Should -Be $e.W -Because "$key Width"
            $row.Height  | Should -Be $e.H -Because "$key Height"
        }
    }

    It "keeps the two RIGHT corner widgets square (width == height == thickness + radius)" {
        $table = Get-FrameGeometryTable -Thickness 5 -Radius 12 -BarWidth 40 -ScreenWidth 1920 -ScreenHeight 1080
        $rightCorners = $table | Where-Object { $_.Widget -eq 'corners' -and $_.Preset -match 'right' }
        $rightCorners.Count | Should -Be 2
        foreach ($c in $rightCorners) {
            $c.Width  | Should -Be 17
            $c.Height | Should -Be 17
        }
    }

    It "makes the two LEFT corner widgets radius-wide (not thickness+radius) but thickness+radius tall" {
        $table = Get-FrameGeometryTable -Thickness 5 -Radius 12 -BarWidth 40 -ScreenWidth 1920 -ScreenHeight 1080
        $leftCorners = $table | Where-Object { $_.Widget -eq 'corners' -and $_.Preset -match 'left' }
        $leftCorners.Count | Should -Be 2
        foreach ($c in $leftCorners) {
            $c.Width  | Should -Be 12
            $c.Height | Should -Be 17
            $c.OffsetX | Should -Be 40 -Because "left corners stay flush with the bar's own right edge"
        }
    }

    It "anchors edges/top and edges/bottom flush against the left corners' own (narrower) right edge" {
        $table = Get-FrameGeometryTable -Thickness 8 -Radius 16 -BarWidth 52 -ScreenWidth 2560 -ScreenHeight 1440
        $topLeftCorner = $table | Where-Object { $_.Widget -eq 'corners' -and $_.Preset -eq 'top-left' }
        $topEdge = $table | Where-Object { $_.Widget -eq 'edges' -and $_.Preset -eq 'top' }
        $topEdge.OffsetX | Should -Be ($topLeftCorner.OffsetX + $topLeftCorner.Width)
    }
}

Describe "Set-FrameGeometry -- the invariant gap == totalPadding - thickness" {
    It "holds across several thickness values at the default 1:1 gap ratio" {
        foreach ($t in @(4, 8, 12, 20, 1)) {
            $summary = Set-FrameGeometry -Thickness $t -GapRatio 1.0 -Radius 16 -DryRun `
                -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
            $totalPadding = $summary.WorkspacePadding + $summary.ContainerPadding
            ($totalPadding - $t) | Should -Be $summary.Gap -Because "T=$t"
        }
    }

    It "holds for non-1:1 gap ratios too" {
        foreach ($ratio in @(0.5, 1.5, 2.0)) {
            $summary = Set-FrameGeometry -Thickness 8 -GapRatio $ratio -Radius 16 -DryRun `
                -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
            $totalPadding = $summary.WorkspacePadding + $summary.ContainerPadding
            ($totalPadding - 8) | Should -Be $summary.Gap -Because "ratio=$ratio"
        }
    }

    It "splits total padding so the two halves still sum back to the total" {
        $summary = Set-FrameGeometry -Thickness 7 -GapRatio 1.0 -Radius 16 -DryRun `
            -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
        ($summary.WorkspacePadding + $summary.ContainerPadding) | Should -Be $summary.TotalPadding
        $summary.WorkspacePadding | Should -BeGreaterOrEqual $summary.ContainerPadding
    }

    # THE CHECK THAT DID NOT EXIST, AND WHOSE ABSENCE IS THE WHOLE BUG.
    #
    # Every test above pins the gap AT THE FRAME. None of them pinned the gap
    # BETWEEN WINDOWS, so a 50/50 split of total padding sailed through while
    # putting 16px between windows and 8px at the frame -- a 2:1 mismatch,
    # confirmed on screen by measuring window borders (16px apart, 8px from
    # the bar and the bands) before it was fixed here.
    #
    # komorebi applies workspace padding once at the work-area edge and
    # container padding around every container, so:
    #     gap at the frame    = workspace + container - thickness
    #     gap between windows = 2 * container
    # The frame's premise is that every wallpaper gap is the same width, and
    # that requires BOTH to equal G.
    It "gives the same wallpaper gap between windows as at the frame" {
        foreach ($t in @(4, 8, 12, 16)) {
            $summary = Set-FrameGeometry -Thickness $t -GapRatio 1.0 -Radius 16 -DryRun `
                -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
            $atFrame = $summary.WorkspacePadding + $summary.ContainerPadding - $t
            $between = 2 * $summary.ContainerPadding
            $atFrame | Should -Be $summary.Gap -Because "thickness=$t, gap at the frame"
            $between | Should -Be $summary.Gap -Because "thickness=$t, gap between windows"
            $summary.InterWindowGap | Should -Be $between -Because "thickness=$t, reported value"
        }
    }

    It "reports the between-windows gap even when an odd gap cannot halve exactly" {
        # G=7 cannot split into two equal integers, so the between-windows gap
        # lands on 8, not 7. That is a real 1px miss and the summary must say
        # so rather than claiming the gaps match.
        $summary = Set-FrameGeometry -Thickness 7 -GapRatio 1.0 -Radius 16 -DryRun `
            -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
        $summary.Gap | Should -Be 7
        $summary.InterWindowGap | Should -Be 8
        ($summary.WorkspacePadding + $summary.ContainerPadding - 7) | Should -Be $summary.Gap
    }
}

Describe "Set-FrameGeometry -DryRun" {
    It "reads the bar's real width from zpack.json rather than hardcoding it" {
        $summary = Set-FrameGeometry -Thickness 8 -GapRatio 1.0 -Radius 16 -DryRun `
            -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
        $summary.BarWidth | Should -Be 52
    }

    It "for T=8/GapRatio=1/R=16 produces exactly this task's target table (end-to-end, not just the pure helper)" {
        $summary = Set-FrameGeometry -Thickness 8 -GapRatio 1.0 -Radius 16 -DryRun `
            -ZpackPath $script:realZpack -ScreenWidth 2560 -ScreenHeight 1440
        $summary.Gap | Should -Be 8
        $summary.CornerSize | Should -Be 24
        # 12/4, not 8/8: the split is derived from the GAP, so that 2*container
        # (the gap between windows) equals G, the same as the gap at the frame.
        $summary.WorkspacePadding | Should -Be 12
        $summary.ContainerPadding | Should -Be 4
        $summary.InterWindowGap | Should -Be 8
        $summary.Table.Count | Should -Be 7
        ($summary.Table | Where-Object { $_.Widget -eq 'edges' -and $_.Preset -eq 'left' }) | Should -BeNullOrEmpty
        ($summary.Table | Where-Object { $_.Widget -eq 'corners' -and $_.Preset -eq 'top-left' }).OffsetX | Should -Be 52
        ($summary.Table | Where-Object { $_.Widget -eq 'corners' -and $_.Preset -eq 'top-left' }).Width | Should -Be 16
        ($summary.Table | Where-Object { $_.Widget -eq 'edges' -and $_.Preset -eq 'top' }).OffsetX | Should -Be 68
        ($summary.Table | Where-Object { $_.Widget -eq 'edges' -and $_.Preset -eq 'top' }).Width | Should -Be 2468
    }

    It "writes nothing to zpack.json, either CSS file, or komorebi.json" {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null

        $zpackFixture   = Join-Path $script:tmp "zpack.json"
        $cornersFixture = Join-Path $script:tmp "corners.css"
        $edgesFixture   = Join-Path $script:tmp "edges.css"
        $komorebiFixture = Join-Path $script:tmp "komorebi.json"
        Copy-Item $script:realZpack $zpackFixture
        Copy-Item $script:realCornersCss $cornersFixture
        Copy-Item $script:realEdgesCss $edgesFixture
        [System.IO.File]::WriteAllText($komorebiFixture, '{ "default_workspace_padding": 8, "default_container_padding": 8, "other_key": "keep-me" }', (New-Object System.Text.UTF8Encoding($false)))

        $before = @{
            zpack    = [System.IO.File]::ReadAllText($zpackFixture)
            corners  = [System.IO.File]::ReadAllText($cornersFixture)
            edges    = [System.IO.File]::ReadAllText($edgesFixture)
            komorebi = [System.IO.File]::ReadAllText($komorebiFixture)
        }

        Set-FrameGeometry -Thickness 4 -GapRatio 1.5 -Radius 10 -DryRun `
            -ZpackPath $zpackFixture -CornersCssPath $cornersFixture -EdgesCssPath $edgesFixture `
            -KomorebiJsonPath $komorebiFixture -ScreenWidth 2560 -ScreenHeight 1440 | Out-Null

        [System.IO.File]::ReadAllText($zpackFixture)    | Should -Be $before.zpack
        [System.IO.File]::ReadAllText($cornersFixture)  | Should -Be $before.corners
        [System.IO.File]::ReadAllText($edgesFixture)    | Should -Be $before.edges
        [System.IO.File]::ReadAllText($komorebiFixture) | Should -Be $before.komorebi
    }
}

Describe "Set-FrameZpackGeometry" {
    BeforeEach {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
        $script:zpackFixture = Join-Path $script:tmp "zpack.json"
        Copy-Item $script:realZpack $script:zpackFixture
    }

    It "rewrites every matching preset's offset/width/height and preserves everything else" {
        $table = Get-FrameGeometryTable -Thickness 4 -Radius 10 -BarWidth 52 -ScreenWidth 1920 -ScreenHeight 1080
        Set-FrameZpackGeometry -Path $script:zpackFixture -Table $table

        $obj = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $corners = $obj.widgets | Where-Object { $_.name -eq 'corners' }
        $tl = $corners.presets | Where-Object { $_.name -eq 'top-left' }
        $tl.offsetX | Should -Be '52px'
        # Left-frame-removal pass: top-left is now R (10) wide, C (14) tall
        # -- not the uniform C x C square every corner used to be.
        $tl.width   | Should -Be '10px'
        $tl.height  | Should -Be '14px'
        $tr = $corners.presets | Where-Object { $_.name -eq 'top-right' }
        $tr.width   | Should -Be '14px'
        $tr.height  | Should -Be '14px'
        # Unrelated fields survive untouched.
        $corners.zOrder | Should -Be 'top_most'
        $corners.privileges.shellCommands.Count | Should -Be 1
        $bar = $obj.widgets | Where-Object { $_.name -eq 'bar' }
        $bar.presets[0].width | Should -Be '52px'
    }

    It "prunes a stale preset that's no longer in the table (e.g. a leftover edges/left from an older checkout)" {
        # Simulate an OLDER zpack.json (predating the left-frame-removal
        # pass) that still HAS an edges/left preset.
        $obj = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $edges = $obj.widgets | Where-Object { $_.name -eq 'edges' }
        $stale = [PSCustomObject]@{
            name = 'left'; anchor = 'top_left'
            offsetX = '52px'; offsetY = '24px'; width = '8px'; height = '1392px'
            monitorSelection = [PSCustomObject]@{ type = 'all' }
            dockToEdge = [PSCustomObject]@{ enabled = $false }
        }
        $edges.presets = @($edges.presets) + @($stale)
        [System.IO.File]::WriteAllText($script:zpackFixture, ($obj | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
        ((($obj.widgets | Where-Object { $_.name -eq 'edges' }).presets).name) | Should -Contain 'left'

        # Today's table (no edges/left row at all) must PRUNE it away, not
        # just leave it alone because it isn't a positional match.
        $table = Get-FrameGeometryTable -Thickness 8 -Radius 16 -BarWidth 52 -ScreenWidth 2560 -ScreenHeight 1440
        Set-FrameZpackGeometry -Path $script:zpackFixture -Table $table

        $obj2 = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $edges2 = $obj2.widgets | Where-Object { $_.name -eq 'edges' }
        ($edges2.presets | Where-Object { $_.name -eq 'left' }) | Should -BeNullOrEmpty
        ($edges2.presets.name | Sort-Object) -join ',' | Should -Be 'bottom,right,top'
    }

    It "appends a preset that doesn't exist yet instead of silently skipping it" {
        # Simulate an older zpack.json missing a preset the current table
        # expects (top-right, picked arbitrarily -- any corner works).
        $obj = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $corners = $obj.widgets | Where-Object { $_.name -eq 'corners' }
        $corners.presets = @($corners.presets | Where-Object { $_.name -ne 'top-right' })
        [System.IO.File]::WriteAllText($script:zpackFixture, ($obj | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

        $table = Get-FrameGeometryTable -Thickness 8 -Radius 16 -BarWidth 52 -ScreenWidth 2560 -ScreenHeight 1440
        Set-FrameZpackGeometry -Path $script:zpackFixture -Table $table

        $obj2 = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $corners2 = $obj2.widgets | Where-Object { $_.name -eq 'corners' }
        $tr = $corners2.presets | Where-Object { $_.name -eq 'top-right' }
        $tr | Should -Not -BeNullOrEmpty
        $tr.offsetX | Should -Be '2536px'
        $tr.dockToEdge.enabled | Should -Be $false
    }
}

Describe "Set-FrameCssVariable" {
    BeforeEach {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
        $script:cssFixture = Join-Path $script:tmp "corners.css"
        Copy-Item $script:realCornersCss $script:cssFixture
    }

    It "rewrites only the targeted custom property's value, leaving the rest of the file untouched" {
        $before = [System.IO.File]::ReadAllText($script:cssFixture)
        Set-FrameCssVariable -Path $script:cssFixture -Name 'frame-band' -ValuePx 4
        $after = [System.IO.File]::ReadAllText($script:cssFixture)

        $after | Should -Match '--frame-band:\s*4px;'
        $after | Should -Not -Match '--frame-band:\s*8px;'
        # corner-radius line untouched by the frame-band edit.
        ($after -match '--corner-radius:\s*16px;') | Should -BeTrue
        # Nothing else in the file changed length-wise by more than the
        # single digit substituted.
        [Math]::Abs($after.Length - $before.Length) | Should -BeLessOrEqual 1
    }

    It "throws when the named property does not exist in the file" {
        { Set-FrameCssVariable -Path $script:cssFixture -Name 'does-not-exist' -ValuePx 1 } | Should -Throw
    }
}

Describe "Set-KomorebiFramePadding" {
    BeforeEach {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
        $script:komFixture = Join-Path $script:tmp "komorebi.json"
    }

    It "updates both padding fields while preserving unrelated keys (e.g. ignore_rules)" {
        [System.IO.File]::WriteAllText($script:komFixture, '{ "default_workspace_padding": 20, "default_container_padding": 20, "ignore_rules": ["a", "b"], "border": true }', (New-Object System.Text.UTF8Encoding($false)))
        Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 8 -ContainerPadding 8 -Thickness 8

        $obj = [System.IO.File]::ReadAllText($script:komFixture) | ConvertFrom-Json
        $obj.default_workspace_padding | Should -Be 8
        $obj.default_container_padding | Should -Be 8
        $obj.ignore_rules.Count | Should -Be 2
        $obj.border | Should -Be $true
    }

    It "writes global_work_area_offset as -Thickness on left AND right" {
        # The left side has no frame band (the bar is the left side of the
        # frame), so without this offset its visible gap comes out a full
        # band wider than the other three -- the inconsistency the user
        # reported. `left` shifts the work area's origin, `right` shrinks
        # its width, and they are independent, so left == right ==
        # -Thickness pulls the left edge in without moving the right edge.
        [System.IO.File]::WriteAllText($script:komFixture, '{ "default_workspace_padding": 20, "default_container_padding": 20 }', (New-Object System.Text.UTF8Encoding($false)))
        Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 8 -ContainerPadding 8 -Thickness 8

        $obj = [System.IO.File]::ReadAllText($script:komFixture) | ConvertFrom-Json
        $obj.global_work_area_offset.left   | Should -Be -8
        $obj.global_work_area_offset.right  | Should -Be -8
        $obj.global_work_area_offset.top    | Should -Be 0
        $obj.global_work_area_offset.bottom | Should -Be 0
    }

    It "overwrites an existing global_work_area_offset rather than nesting or duplicating it" {
        [System.IO.File]::WriteAllText($script:komFixture, '{ "default_workspace_padding": 20, "default_container_padding": 20, "global_work_area_offset": { "left": -99, "top": 0, "right": -99, "bottom": 0 } }', (New-Object System.Text.UTF8Encoding($false)))
        Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 6 -ContainerPadding 6 -Thickness 4

        $obj = [System.IO.File]::ReadAllText($script:komFixture) | ConvertFrom-Json
        $obj.global_work_area_offset.left  | Should -Be -4
        $obj.global_work_area_offset.right | Should -Be -4
    }

    It "rejects content that parses to `$null (empty file) rather than truncating it" {
        [System.IO.File]::WriteAllText($script:komFixture, '', (New-Object System.Text.UTF8Encoding($false)))
        { Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 8 -ContainerPadding 8 -Thickness 8 } | Should -Throw
        # File must be untouched (still empty, not deleted/corrupted) -- the
        # guard fires before any write.
        (Get-Item $script:komFixture).Length | Should -Be 0
    }

    It "rejects a root-level JSON array" {
        [System.IO.File]::WriteAllText($script:komFixture, '[1,2,3]', (New-Object System.Text.UTF8Encoding($false)))
        { Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 8 -ContainerPadding 8 -Thickness 8 } | Should -Throw
    }

    It "writes via an atomic temp-file-then-rename, leaving no stray temp file behind" {
        [System.IO.File]::WriteAllText($script:komFixture, '{ "default_workspace_padding": 20, "default_container_padding": 20 }', (New-Object System.Text.UTF8Encoding($false)))
        Set-KomorebiFramePadding -Path $script:komFixture -WorkspacePadding 8 -ContainerPadding 8 -Thickness 8
        (Get-ChildItem $script:tmp -Filter "*.tmp-*").Count | Should -Be 0
    }
}

Describe "Set-FrameGeometry (non-DryRun, fixtures only, live komorebi calls mocked out)" {
    BeforeEach {
        if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
        $script:zpackFixture    = Join-Path $script:tmp "zpack.json"
        $script:cornersFixture  = Join-Path $script:tmp "corners.css"
        $script:edgesFixture    = Join-Path $script:tmp "edges.css"
        $script:komorebiFixture = Join-Path $script:tmp "komorebi.json"
        $script:backupRoot      = Join-Path $script:tmp "backup"
        Copy-Item $script:realZpack $script:zpackFixture
        Copy-Item $script:realCornersCss $script:cornersFixture
        Copy-Item $script:realEdgesCss $script:edgesFixture
        [System.IO.File]::WriteAllText($script:komorebiFixture, '{ "default_workspace_padding": 8, "default_container_padding": 8, "ignore_rules": ["keep-me"] }', (New-Object System.Text.UTF8Encoding($false)))

        # This is the one call in the whole function that talks to the REAL,
        # live komorebi process on this machine -- mocked here the same way
        # this repo's own ApplyTheme.Tests.ps1 mocks Set-KomorebiBorderColour
        # (see "calls the runtime border-colour update..." there), so
        # running this test suite never mutates the live desktop's actual
        # tiling padding as a side effect.
        Mock Update-KomorebiFramePaddingLive {}
    }

    It "writes all seven presets into zpack.json, with no edges/left" {
        Set-FrameGeometry -Thickness 8 -GapRatio 1.0 -Radius 16 `
            -ZpackPath $script:zpackFixture -CornersCssPath $script:cornersFixture -EdgesCssPath $script:edgesFixture `
            -KomorebiJsonPath $script:komorebiFixture -BackupRoot $script:backupRoot `
            -ScreenWidth 2560 -ScreenHeight 1440 | Out-Null

        $obj = [System.IO.File]::ReadAllText($script:zpackFixture) | ConvertFrom-Json
        $edges = ($obj.widgets | Where-Object { $_.name -eq 'edges' }).presets
        ($edges | Where-Object { $_.name -eq 'left' }) | Should -BeNullOrEmpty
        ($edges.name | Sort-Object) -join ',' | Should -Be 'bottom,right,top'
        $corners = ($obj.widgets | Where-Object { $_.name -eq 'corners' }).presets
        ($corners | Where-Object { $_.name -eq 'top-left' }).width | Should -Be '16px'
    }

    It "updates both CSS files' --frame-band, and corners.css's --corner-radius" {
        Set-FrameGeometry -Thickness 5 -GapRatio 1.0 -Radius 11 `
            -ZpackPath $script:zpackFixture -CornersCssPath $script:cornersFixture -EdgesCssPath $script:edgesFixture `
            -KomorebiJsonPath $script:komorebiFixture -BackupRoot $script:backupRoot `
            -ScreenWidth 2560 -ScreenHeight 1440 | Out-Null

        [System.IO.File]::ReadAllText($script:cornersFixture) | Should -Match '--frame-band:\s*5px;'
        [System.IO.File]::ReadAllText($script:cornersFixture) | Should -Match '--corner-radius:\s*11px;'
        [System.IO.File]::ReadAllText($script:edgesFixture)   | Should -Match '--frame-band:\s*5px;'
    }

    It "backs up komorebi.json before writing and updates its padding fields" {
        Set-FrameGeometry -Thickness 8 -GapRatio 1.0 -Radius 16 `
            -ZpackPath $script:zpackFixture -CornersCssPath $script:cornersFixture -EdgesCssPath $script:edgesFixture `
            -KomorebiJsonPath $script:komorebiFixture -BackupRoot $script:backupRoot `
            -ScreenWidth 2560 -ScreenHeight 1440 | Out-Null

        (Get-ChildItem $script:backupRoot -Filter "komorebi.json.bak-frame-geometry-*").Count | Should -Be 1
        $obj = [System.IO.File]::ReadAllText($script:komorebiFixture) | ConvertFrom-Json
        $obj.default_workspace_padding | Should -Be 12
        $obj.default_container_padding | Should -Be 4
        ($obj.ignore_rules -join ',') | Should -Be 'keep-me'
    }

    It "invokes the live-nudge function with the computed padding values, including an uneven split" {
        # T=8, GapRatio=0.375 -> G=3 -> P=11. The split is driven by the GAP,
        # not by half of P: container = round(3/2) = 2, workspace = 11 - 2 = 9.
        # Deliberately picked so the two paddings are far apart, which proves
        # the split is wired through end-to-end and would catch a swap.
        Set-FrameGeometry -Thickness 8 -GapRatio 0.375 -Radius 16 `
            -ZpackPath $script:zpackFixture -CornersCssPath $script:cornersFixture -EdgesCssPath $script:edgesFixture `
            -KomorebiJsonPath $script:komorebiFixture -BackupRoot $script:backupRoot `
            -ScreenWidth 2560 -ScreenHeight 1440 | Out-Null

        Should -Invoke Update-KomorebiFramePaddingLive -Times 1 -ParameterFilter {
            $WorkspacePadding -eq 9 -and $ContainerPadding -eq 2
        }
    }
}

Describe "Update-KomorebiFramePaddingLive (fail-soft)" {
    It "warns instead of throwing when komorebic is not on PATH" {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'komorebic' }
        $warnings = @()
        Update-KomorebiFramePaddingLive -WorkspacePadding 8 -ContainerPadding 8 -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'PATH'
    }

    It "warns instead of throwing when komorebi is not running" {
        Mock Get-Process { $null } -ParameterFilter { $Name -eq 'komorebi' }
        $warnings = @()
        Update-KomorebiFramePaddingLive -WorkspacePadding 8 -ContainerPadding 8 -WarningVariable warnings -WarningAction SilentlyContinue
        ($warnings -join ' ') | Should -Match 'not running'
    }
}
