BeforeAll {
    . "$PSScriptRoot\..\scripts\Switch-Wallpaper.ps1"
}

Describe "Resolve-PreviewImage" {
    It "prefers preview.jpg" {
        $d = Join-Path $env:TEMP "wp-test-1"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Set-Content (Join-Path $d "preview.jpg") "x"
        Set-Content (Join-Path $d "preview.gif") "x"
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -Be (Join-Path $d "preview.jpg")
    }

    It "falls back to preview.gif" {
        $d = Join-Path $env:TEMP "wp-test-2"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Set-Content (Join-Path $d "preview.gif") "x"
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -Be (Join-Path $d "preview.gif")
    }

    It "returns null when neither exists" {
        $d = Join-Path $env:TEMP "wp-test-3"
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Resolve-PreviewImage -ProjectJson (Join-Path $d "project.json") | Should -BeNullOrEmpty
    }
}

Describe "Get-CurrentWallpaper" {
    It "extracts the file path from a selectedwallpapers block" {
        $p = "$env:TEMP\we-config-1.json"
        @'
{
  "general" : { "file" : "C:/decoy/should-not-match.pkg" },
  "wallpaperconfig" : {
    "selectedwallpapers" : {
      "MON1" : { "file" : "C:/Steam/workshop/content/431960/123/scene.pkg" }
    }
  }
}
'@ | Set-Content $p -Encoding ascii
        Get-CurrentWallpaper -ConfigPath $p | Should -Be "C:\Steam\workshop\content\431960\123\scene.pkg"
    }

    It "returns null when there is no selectedwallpapers block" {
        $p = "$env:TEMP\we-config-2.json"
        '{ "general" : { "file" : "C:/x.pkg" } }' | Set-Content $p -Encoding ascii
        Get-CurrentWallpaper -ConfigPath $p | Should -BeNullOrEmpty
    }

    It "returns null when the config file is missing" {
        Get-CurrentWallpaper -ConfigPath "C:\does\not\exist.json" | Should -BeNullOrEmpty
    }

    It "reads the real Wallpaper Engine config" {
        $real = Get-CurrentWallpaper
        $real | Should -Not -BeNullOrEmpty
        Test-Path $real | Should -BeTrue
    }
}

Describe "Switch-Wallpaper never reaches the real Wallpaper Engine binary in this Describe block" {
    BeforeAll {
        # A stand-in for the real Wallpaper Engine binary that only ever
        # RECORDS that it was invoked -- it never touches the desktop
        # wallpaper. Get-WallpaperEngineExe is mocked (see BeforeEach) to
        # return this path for every test below, so no test in this block
        # can ever reach the real wallpaper32.exe/wallpaper64.exe no matter
        # what Switch-Wallpaper's internal logic does -- safe even while
        # exercising the pre-fix (C1) code path, which really does issue a
        # WE control command under -DryRun.
        $script:recorderDir = Join-Path $env:TEMP "we-recorder-$PID"
        New-Item -ItemType Directory -Force -Path $script:recorderDir | Out-Null
        $script:recorderLog = Join-Path $script:recorderDir "calls.log"
        $script:recorderExe = Join-Path $script:recorderDir "we-recorder.cmd"
        @"
@echo off
echo %* >> "$script:recorderLog"
"@ | Set-Content -Path $script:recorderExe -Encoding ascii
    }

    AfterAll {
        Remove-Item $script:recorderDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    BeforeEach {
        Remove-Item $script:recorderLog -Force -ErrorAction SilentlyContinue
        Mock Get-WallpaperEngineExe { return $script:recorderExe }
        # The 500ms x 20 poll delay is irrelevant to what these tests check
        # and only slows them down -- neutralize it.
        Mock Start-Sleep {}
    }

    It "issues no Wallpaper Engine control command under -DryRun (C1: the unfixed code advances the wallpaper even under -DryRun)" {
        Switch-Wallpaper -DryRun | Out-Null
        Test-Path $script:recorderLog | Should -BeFalse
    }

    It "does issue a Wallpaper Engine control command on a real (non-DryRun) call, proving the -DryRun test above is not vacuous" {
        # Deliberately NOT -DryRun -- this test exists specifically to
        # exercise the non-DryRun branch (otherwise the C1 test above would
        # be checking a tautology: "DryRun doesn't call WE" proves nothing
        # if nothing else ever does either). Still fully safe: mocking
        # Get-CurrentWallpaper to always return $null forces the
        # "Could not read the current wallpaper" guard a few lines later to
        # return BEFORE Switch-Wallpaper can reach Resolve-PreviewImage or
        # Apply-Theme -- there is no code path from here to a live Apply-
        # Theme call.
        Mock Get-CurrentWallpaper { return $null }
        Switch-Wallpaper | Out-Null
        Test-Path $script:recorderLog | Should -BeTrue
    }

    It "-Wallpaper with a path that does not exist warns and never reaches Wallpaper Engine (M5)" {
        $missing = "C:\does\not\exist-asset-$PID.pkg"
        $warnings = @()
        Switch-Wallpaper -Wallpaper $missing -DryRun -WarningVariable warnings -WarningAction SilentlyContinue | Out-Null
        Test-Path $script:recorderLog | Should -BeFalse
        ($warnings -join ' ') | Should -Match 'not found'
    }

    It "warns when the wallpaper did not change even though -Wallpaper was explicitly given (M5: previously suppressed)" {
        # Deliberately NOT -DryRun -- the "did not change" comparison only
        # happens on the real (post-control-command) branch; under -DryRun
        # $current is set to $before directly with no polling, so they're
        # trivially always equal and this warning wouldn't fire for a
        # meaningful reason. Still fully safe: Get-CurrentWallpaper is
        # mocked to a constant ("config.json never changes"), so
        # Resolve-PreviewImage is called against a path
        # (C:\same\wallpaper.pkg) with no preview.jpg/gif/png beside it --
        # it returns $null, and Switch-Wallpaper warns "No preview image"
        # and returns before Apply-Theme is ever reachable.
        Mock Get-CurrentWallpaper { return "C:\same\wallpaper.pkg" }
        $warnings = @()
        Switch-Wallpaper -Wallpaper $script:recorderExe -WarningVariable warnings -WarningAction SilentlyContinue | Out-Null
        ($warnings -join ' ') | Should -Match 'did not change'
    }
}
