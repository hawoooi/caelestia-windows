$script:Root = Split-Path $PSScriptRoot -Parent

function Set-ManagedJunction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$LinkPath,
        [Parameter(Mandatory)][string]$TargetPath
    )

    if (-not (Test-Path $TargetPath)) { throw "Junction target does not exist: $TargetPath" }

    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        if ($item.LinkType -ne 'Junction') {
            throw "$LinkPath exists and is NOT a junction. Refusing to replace a real directory."
        }
        if ($item.Target -contains $TargetPath) { return $true }
        Remove-Item $LinkPath -Force
    }

    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
    $after = Get-Item $LinkPath -Force
    return ($after.LinkType -eq 'Junction' -and $after.Target -contains $TargetPath)
}

function Set-PatchedBlock {
    <#
      Insert or replace a marker-delimited block inside a file the USER owns.
      Idempotent: identical Content produces a byte-identical file.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $block = "$open`n$Content`n$close"

    $text = ''
    if (Test-Path $Path) { $text = [System.IO.File]::ReadAllText($Path) }

    $pattern = [regex]::Escape($open) + '.*?' + [regex]::Escape($close)
    if ([regex]::IsMatch($text, $pattern, 'Singleline')) {
        $new = [regex]::Replace($text, $pattern, { param($m) $block }, 'Singleline')
    } else {
        # NOTE: deliberately no extra blank-line separator here (the brief's
        # original draft inserted one via `$sep + "`n" + $block`). That extra
        # "`n" is indistinguishable, byte-wise, from the file's own trailing
        # newline once written, so Remove-PatchedBlock's matching "\n?\n"
        # prefix ate the ORIGINAL trailing newline instead of the inserted
        # one -- a real round-trip data-loss bug, not a vacuous-test issue.
        # Appending the block directly after $text (separated only by $sep,
        # which is only added when $text doesn't already end in a newline)
        # keeps insertion and removal symmetric: Remove-PatchedBlock only
        # ever has to strip exactly what this branch added.
        $sep = if ($text.Length -eq 0 -or $text.EndsWith("`n")) { '' } else { "`n" }
        $new = $text + $sep + $block + "`n"
    }

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-PatchedBlock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    if (-not (Test-Path $Path)) { return }

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $text  = [System.IO.File]::ReadAllText($Path)

    # Mirrors Set-PatchedBlock's insertion exactly: the block plus the single
    # trailing newline it always appends after $close. No leading "\n?" here
    # -- consuming an extra newline before $open would eat the original
    # file's own trailing newline (see the note in Set-PatchedBlock).
    $pattern = [regex]::Escape($open) + '.*?' + [regex]::Escape($close) + "\n?"
    $new = [regex]::Replace($text, $pattern, '', 'Singleline')

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}

function Install-Config {
    <#
      Task 9: the top-level installer this whole helper file existed for but
      never gained a caller of its own. Patches marker-delimited blocks into
      user-owned dotfiles (currently just whkdrc, for the two theming
      hotkeys) via Set-PatchedBlock/Remove-PatchedBlock above, and manages
      the ~/.glzr/zebar/caelestia junction via Set-ManagedJunction so the
      tracked zebar/caelestia pack in this repo is what Zebar actually loads.

      .wezterm.lua is deliberately NOT in $targets -- its edits are already
      applied and live (see docs/spikes.md), and re-patching a working
      354-line config to prove this mechanism risks breaking a terminal this
      session itself runs in. See docs/wezterm-integration.md for that
      manual step, recorded rather than automated here.
    #>
    [CmdletBinding()]
    param([switch]$DryRun, [switch]$Uninstall)

    $marker = 'caelestia-shell'
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $script:Root "state\config-backup\$stamp"

    $targets = @(
        @{ Path = "$env:USERPROFILE\.config\whkdrc"; Prefix = '#';  Content = @'
alt + w                       : Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\PC\Documents\git\setup\scripts\hotkey-next-wallpaper.ps1'
ctrl + alt + w                : Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\PC\Documents\git\setup\scripts\hotkey-retheme.ps1'
'@ }
    )

    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $backup | Out-Null }

    foreach ($t in $targets) {
        if ($DryRun) { "would patch $($t.Path)"; continue }
        if (Test-Path $t.Path) { Copy-Item $t.Path $backup -Force }
        if ($Uninstall) { Remove-PatchedBlock -Path $t.Path -Marker $marker -CommentPrefix $t.Prefix }
        else            { Set-PatchedBlock  -Path $t.Path -Marker $marker -CommentPrefix $t.Prefix -Content $t.Content }
    }

    if ($Uninstall) {
        $link = "$env:USERPROFILE\.glzr\zebar\caelestia"
        if ((Test-Path $link) -and (Get-Item $link -Force).LinkType -eq 'Junction') { Remove-Item $link -Force }
    } elseif (-not $DryRun) {
        Set-ManagedJunction -LinkPath "$env:USERPROFILE\.glzr\zebar\caelestia" `
                            -TargetPath (Join-Path $script:Root "zebar\caelestia") | Out-Null
    }
}
