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
