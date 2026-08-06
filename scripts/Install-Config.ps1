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

function Get-ZebarStartupConfigs {
    <#
      C1 + I4 share this as their one read path into settings.json's
      startupConfigs: I4 is the writer (Set-/Remove-ZebarStartupConfig
      below) that puts caelestia/bar into it; C1's Apply-Theme widget
      restart (scripts/Apply-Theme.ps1) uses this reader to restart EVERY
      autostarted pack/widget after killing zebar.exe, not just this one.

      Returns $null (not an empty array) when the file is missing or fails
      to parse, so a caller can tell "definitely nothing else to restart"
      apart from "couldn't determine" and fail safe accordingly, rather
      than silently treating a parse failure as "no other widgets exist".
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path $Path)) { return $null }
    try {
        $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    } catch {
        return $null
    }
    # `-not $obj.startupConfigs` would be TRUE both when the property is
    # absent AND when it's a genuinely present-but-EMPTY array (PowerShell
    # treats @() as falsy) -- collapsing "field missing" into the same
    # branch as "field present, zero entries". Get-Member checks for the
    # property's EXISTENCE, not its truthiness, so an empty (but present)
    # startupConfigs array is correctly distinguished from a missing one.
    #
    # Every return below uses `Write-Output -NoEnumerate` rather than a
    # plain `return @(...)`. A PLAIN array return of 0 or 1 elements gets
    # unrolled by PowerShell's pipeline when the caller captures it without
    # ALSO wrapping the call site in @() (`$x = Get-ZebarStartupConfigs ...`
    # would silently become $null for a genuinely empty-but-parsed array,
    # indistinguishable from this function's OWN $null "couldn't parse"
    # sentinel above -- found by this task's own test suite, not
    # hypothetical). `-NoEnumerate` emits the array as a single pipeline
    # object instead, so `.Count` is accurate (0, 1, or N) for every caller
    # with NO extra @() wrapping needed -- callers must NOT re-wrap the
    # call site in @() themselves, or they reintroduce the exact same
    # double-wrapping problem one level up.
    if (-not $obj -or -not (Get-Member -InputObject $obj -Name 'startupConfigs' -MemberType NoteProperty)) {
        Write-Output -NoEnumerate @()
        return
    }
    Write-Output -NoEnumerate @($obj.startupConfigs)
}

function Set-ZebarStartupConfig {
    <#
      I4: ~/.glzr/zebar/settings.json's `startupConfigs` array is the one
      place Zebar itself reads to decide what to autostart on login/reboot.
      Nothing in this repo ever touched it, even though the spec listed it
      as a patched target alongside whkdrc and the junction -- so the bar
      had NO autostart at all: after the reboot this repo's own docs
      prescribe as the WebView2 fix, it would not come back on its own.

      Structural JSON edit (parse/mutate/serialize), NOT a marker block --
      settings.json is Zebar's own config file with its own schema, not a
      dotfile this repo owns a delimited region inside of, and JSON has no
      comment syntax to hang a marker on anyway. Preserves every other
      startupConfigs entry (e.g. the pre-existing gunturdwiap.good-enough
      autostart) and any other top-level field (e.g. $schema) untouched.

      Idempotent: matched by Pack+Widget+Preset: calling this again with the
      same triple replaces that one entry rather than appending a
      duplicate. Widened from Pack+Widget alone (corner-overlays): the
      "corners" widget (zpack.json) runs the SAME widget name under four
      DIFFERENT presets (one per screen corner) -- matching on Pack+Widget
      only would make each subsequent Set-ZebarStartupConfig call for a
      different preset of the same widget silently evict the previous
      preset's entry, leaving at most one corner autostarted. Every existing
      caller (caelestia/bar/default) only ever registers one preset per
      pack+widget, so this widening changes nothing for them.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Pack,
        [Parameter(Mandatory)][string]$Widget,
        [string]$Preset = 'default'
    )

    $obj = $null
    if (Test-Path $Path) {
        try { $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { $obj = $null }
    }
    if (-not $obj) {
        $obj = [PSCustomObject]@{
            '$schema'      = 'https://github.com/glzr-io/zebar/raw/v3.3.1/resources/settings-schema.json'
            startupConfigs = @()
        }
    }
    if (-not (Get-Member -InputObject $obj -Name 'startupConfigs' -MemberType NoteProperty)) {
        $obj | Add-Member -NotePropertyName 'startupConfigs' -NotePropertyValue @() -Force
    }

    $others = @($obj.startupConfigs | Where-Object { -not ($_.pack -eq $Pack -and $_.widget -eq $Widget -and $_.preset -eq $Preset) })
    $entry  = [PSCustomObject]@{ pack = $Pack; widget = $Widget; preset = $Preset }
    $obj.startupConfigs = @($others) + @($entry)

    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $json = $obj | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-ZebarStartupConfig {
    <#
      I4's uninstall counterpart to Set-ZebarStartupConfig -- removes every
      entry matching Pack+Widget (deliberately NOT narrowed to a single
      Preset, unlike Set-ZebarStartupConfig's match key: corner-overlays'
      "corners" widget registers up to four entries -- one per preset/corner
      -- under the same Pack+Widget, and uninstall should clear all of them
      in one call), leaving every other startupConfigs entry (and any other
      top-level field) untouched. A no-op if the file doesn't exist or
      doesn't parse, matching Remove-PatchedBlock's already-established
      "uninstall of something never installed is harmless" contract.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Pack,
        [Parameter(Mandatory)][string]$Widget
    )

    if (-not (Test-Path $Path)) { return }
    try { $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { return }
    if (-not $obj -or -not $obj.startupConfigs) { return }

    $obj.startupConfigs = @($obj.startupConfigs | Where-Object { -not ($_.pack -eq $Pack -and $_.widget -eq $Widget) })
    $json = $obj | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Install-Config {
    <#
      Task 9: the top-level installer this whole helper file existed for but
      never gained a caller of its own. Patches marker-delimited blocks into
      user-owned dotfiles (currently just whkdrc, for the two theming
      hotkeys) via Set-PatchedBlock/Remove-PatchedBlock above, manages the
      ~/.glzr/zebar/caelestia junction via Set-ManagedJunction so the
      tracked zebar/caelestia pack in this repo is what Zebar actually
      loads, and (I4) registers caelestia/bar in
      ~/.glzr/zebar/settings.json's startupConfigs so the bar actually
      autostarts.

      .wezterm.lua is deliberately NOT in $targets -- its edits are already
      applied and live (see docs/spikes.md), and re-patching a working
      354-line config to prove this mechanism risks breaking a terminal this
      session itself runs in. See docs/wezterm-integration.md for that
      manual step, recorded rather than automated here.

      All real-machine paths are now PARAMETERS with the real paths as
      defaults, rather than hardcoded locals -- the final review found this
      function could not be exercised in isolation at all (every path was
      hardcoded), which is exactly how -Uninstall -DryRun's missing guard
      (I1, fixed below) shipped without a test catching it. Overriding
      every path lets tests run this function end-to-end against a throwaway
      fixture dir instead of the real ~/.config, ~/.glzr, and state/ trees.
    #>
    [CmdletBinding()]
    param(
        [switch]$DryRun,
        [switch]$Uninstall,
        [string]$WhkdrcPath        = "$env:USERPROFILE\.config\whkdrc",
        [string]$JunctionLink      = "$env:USERPROFILE\.glzr\zebar\caelestia",
        [string]$JunctionTarget    = (Join-Path $script:Root "zebar\caelestia"),
        [string]$BackupRoot        = (Join-Path $script:Root "state\config-backup"),
        [string]$ZebarSettingsPath = "$env:USERPROFILE\.glzr\zebar\settings.json"
    )

    $marker = 'caelestia-shell'
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $BackupRoot $stamp

    $targets = @(
        @{ Path = $WhkdrcPath; Prefix = '#';  Content = @'
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

    # corner-overlays: the "corners" widget (zpack.json) has four presets,
    # one per screen corner -- each needs its own startupConfigs entry (same
    # pack+widget, different preset; see Set-ZebarStartupConfig's widened
    # match key above) or it won't come back after a reboot, exactly the
    # gap I4 fixed for caelestia/bar itself.
    $cornerPresets = @('top-left', 'top-right', 'bottom-left', 'bottom-right')

    # Desktop-frame follow-up: the "edges" widget (zpack.json) has five
    # presets -- the same one-entry-per-preset requirement as corners above,
    # for the same reason (same pack+widget, five different presets).
    $edgePresets = @('top', 'right', 'bottom', 'bar-link-top', 'bar-link-bottom')

    if ($DryRun) {
        # I1: the junction/settings.json steps below must ALSO be a no-op
        # under -DryRun, for BOTH the install and the uninstall direction.
        # The previous version only guarded the install branch (an
        # `elseif (-not $DryRun)` wrapping ONLY the Set-ManagedJunction
        # call) -- `-Uninstall -DryRun` fell straight through to a real,
        # unconditional Remove-Item on the junction, silently deleting it
        # while the per-target loop above printed "would patch ..." and
        # README.md/docs/zebar-bar.md both promise -DryRun "touches
        # nothing". Found by external review; fixed by making the entire
        # rest of this function -- junction AND startupConfigs -- a single
        # shared no-op path whenever -DryRun is set, regardless of
        # -Uninstall.
        if ($Uninstall) {
            "would remove junction $JunctionLink"
            "would remove startupConfigs entry for caelestia/bar from $ZebarSettingsPath"
            "would remove startupConfigs entries for caelestia/corners (all presets) from $ZebarSettingsPath"
            "would remove startupConfigs entries for caelestia/edges (all presets) from $ZebarSettingsPath"
        } else {
            "would create/verify junction $JunctionLink -> $JunctionTarget"
            "would add startupConfigs entry for caelestia/bar to $ZebarSettingsPath"
            "would add startupConfigs entries for caelestia/corners ($($cornerPresets -join ', ')) to $ZebarSettingsPath"
            "would add startupConfigs entries for caelestia/edges ($($edgePresets -join ', ')) to $ZebarSettingsPath"
        }
        return
    }

    if ($Uninstall) {
        if ((Test-Path $JunctionLink) -and (Get-Item $JunctionLink -Force).LinkType -eq 'Junction') {
            Remove-Item $JunctionLink -Force
        }
        Remove-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'bar'
        Remove-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'corners'
        Remove-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'edges'
    } else {
        Set-ManagedJunction -LinkPath $JunctionLink -TargetPath $JunctionTarget | Out-Null
        Set-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'bar' -Preset 'default'
        foreach ($preset in $cornerPresets) {
            Set-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'corners' -Preset $preset
        }
        foreach ($preset in $edgePresets) {
            Set-ZebarStartupConfig -Path $ZebarSettingsPath -Pack 'caelestia' -Widget 'edges' -Preset $preset
        }
    }
}
