. (Join-Path $PSScriptRoot "Apply-Theme.ps1")

$script:WeDir     = "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine"
$script:WeConfig  = Join-Path $script:WeDir "config.json"

function Get-WallpaperEngineExe {
    <#
      Returns the path of whichever Wallpaper Engine binary is actually
      running. This machine runs wallpaper32; both exist on disk, and the
      CLI talks to the live process, so hardcoding either one is wrong.
    #>
    [CmdletBinding()]
    param()

    $proc = Get-Process -Name 'wallpaper32', 'wallpaper64' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { return $null }
    return (Join-Path $script:WeDir "$($proc.ProcessName).exe")
}

function Get-CurrentWallpaper {
    <#
      Reads the live wallpaper path from Wallpaper Engine's own config.json.

      The `-control getWallpaper` CLI command returns nothing on this system
      (verified against both binaries, with -monitor, and with stdout
      redirected). config.json is updated live and is the reliable source.

      ConvertFrom-Json CANNOT be used: PowerShell 5.1 throws
      'the value of argument "name" is not valid' on this file. Hence regex.
    #>
    [CmdletBinding()]
    param([string]$ConfigPath = $script:WeConfig)

    if (-not (Test-Path $ConfigPath)) { return $null }
    $text = [System.IO.File]::ReadAllText($ConfigPath)

    # Narrow to the selectedwallpapers block so we do not match "file" keys
    # belonging to unrelated settings elsewhere in the config.
    $blockMatch = [regex]::Match($text, '"selectedwallpapers"\s*:\s*\{')
    if (-not $blockMatch.Success) { return $null }

    # Walk braces from the block open to find its matching close.
    $start = $blockMatch.Index + $blockMatch.Length - 1
    $depth = 0; $end = -1
    for ($i = $start; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
    }
    if ($end -lt 0) { return $null }

    $block = $text.Substring($start, $end - $start + 1)
    $fileMatch = [regex]::Match($block, '"file"\s*:\s*"([^"]+)"')
    if (-not $fileMatch.Success) { return $null }

    # Values use forward slashes; normalize for Split-Path and Test-Path.
    return $fileMatch.Groups[1].Value -replace '/', '\'
}

function Resolve-PreviewImage {
    <#
      Task 1 measured the real coverage across 57 installed wallpapers: ~70%
      are gif-only (no preview.jpg) and 2 have no preview asset at all. So
      the gif branch is the common path, not an edge case -- and matugen
      handles gifs fine given --prefer (verified). The $null return for the
      2 uncovered wallpapers is handled by the caller, which warns and
      leaves the theme unchanged.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ProjectJson)

    $dir = Split-Path $ProjectJson -Parent
    foreach ($name in 'preview.jpg', 'preview.gif', 'preview.png') {
        $p = Join-Path $dir $name
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Switch-Wallpaper {
    [CmdletBinding()]
    param(
        [string]$Wallpaper,
        [string]$Scheme = 'scheme-tonal-spot',
        [switch]$DryRun
    )

    $we = Get-WallpaperEngineExe
    if (-not $we) {
        Write-Warning "Wallpaper Engine is not running. Start it first."
        return
    }

    $before = Get-CurrentWallpaper

    if ($Wallpaper) {
        & $we -control openWallpaper -file $Wallpaper
    } else {
        & $we -control nextWallpaper
    }

    # config.json is written asynchronously after the wallpaper changes.
    # Poll for the value to change rather than guessing a fixed sleep.
    $current = $before
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $current = Get-CurrentWallpaper
        if ($current -and $current -ne $before) { break }
    }

    if (-not $current) {
        Write-Warning "Could not read the current wallpaper from $script:WeConfig"
        return
    }
    if ($current -eq $before -and -not $Wallpaper) {
        Write-Warning "Wallpaper did not change (playlist may hold a single item). Re-theming anyway."
    }

    $preview = Resolve-PreviewImage -ProjectJson $current
    if (-not $preview) {
        Write-Warning "No preview image beside $current - theme unchanged."
        return
    }

    $result = Apply-Theme -Image $preview -Scheme $Scheme -DryRun:$DryRun

    if ($result.Success -and -not $DryRun) {
        $state = [PSCustomObject]@{
            wallpaper  = $current
            preview    = $preview
            appliedUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json
        $out = Join-Path (Split-Path $PSScriptRoot -Parent) "state\current.json"
        [System.IO.File]::WriteAllText($out, $state, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Applied theme from $preview"
    }

    return $result
}
