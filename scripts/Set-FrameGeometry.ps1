$script:Root = Split-Path $PSScriptRoot -Parent

function Get-FrameScreenBounds {
    <#
      Reads the PRIMARY monitor's real pixel size via
      System.Windows.Forms.Screen -- deliberately not a hardcoded 2560x1440,
      per this task's own instruction ("derive from screen size and bar
      width -- read them, do not hardcode 2560/1440 a second time"). This is
      the same number `komorebic state`'s monitors[].size reports on this
      machine, but doesn't require komorebi to be running to read it (unlike
      Get-KomorebiWorkspaceTargets below, which genuinely needs a live
      komorebi to enumerate workspaces).
    #>
    [CmdletBinding()]
    param()
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return [PSCustomObject]@{ Width = [int]$bounds.Width; Height = [int]$bounds.Height }
}

function ConvertFrom-PxString {
    <#
      "52px" -> 52. zpack.json's own preset fields are always px strings
      (see zpack-schema.json) -- this is the one place that assumption is
      encoded, so a future non-px unit (e.g. "100%", which the bar's own
      `height` field already legitimately uses) throws loudly instead of
      silently parsing to 0/garbage.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^(\d+)px$') {
        throw "ConvertFrom-PxString: '$Value' is not a plain '<integer>px' value"
    }
    return [int]$Matches[1]
}

function Get-FrameGeometryTable {
    <#
      Pure computation, no I/O -- returns the same shape both -DryRun and a
      real run print/act on, so there is exactly one place the seven
      presets' geometry is derived (matches the task's own tunability goal:
      "adjust the thickness later without hand-editing four files" implies
      also not hand-deriving the arithmetic four different ways in this
      script).

      Left-frame-removal pass (direct user feedback -- "the elements on
      this have an extra space from the border on the side... remove the
      extra border on the left and move the arcs in"): the `edges/left`
      preset (sixth pass) is GONE -- there are now only SEVEN presets, not
      eight. The bar's own right edge (x = B) is once again the content
      hole's left edge, and the two left corner widgets shed their own
      left-band term (they go back to being R wide, not T+R -- the same
      "no left band, narrow left corners" shape the fifth pass used,
      combined with THIS pass's own thinner T=8/R=16 values, not the fifth
      pass's old T=20/R=24 ones). The two right corners and the right edge
      are completely unaffected by any of this -- their own formulas below
      are untouched from the previous (sixth) pass.

      Formulas (screen WxH, bar width B, thickness T, radius R, corner size
      C = T + R):

        corners/top-left     = (B,          0,          R, C)
        corners/top-right    = (W-C,        0,          C, C)
        corners/bottom-left  = (B,          H-C,        R, C)
        corners/bottom-right = (W-C,        H-C,        C, C)
        edges/top             = (B+R,        0,   (W-C)-(B+R), T)
        edges/bottom          = (B+R,        H-T, (W-C)-(B+R), T)
        edges/right            = (W-T,        C,          T, H-2C)

      Verified against this task's own target table (T=8, R=16, B=52,
      W=2560, H=1440 -> C=24): every one of the seven rows below matches
      exactly (edges/top: offsetX=68, width=2468).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int]$Thickness,
        [Parameter(Mandatory)][int]$Radius,
        [Parameter(Mandatory)][int]$BarWidth,
        [Parameter(Mandatory)][int]$ScreenWidth,
        [Parameter(Mandatory)][int]$ScreenHeight
    )

    $T = $Thickness
    $R = $Radius
    $B = $BarWidth
    $W = $ScreenWidth
    $H = $ScreenHeight
    $C = $T + $R

    return @(
        [PSCustomObject]@{ Widget = 'corners'; Preset = 'top-left';     OffsetX = $B;       OffsetY = 0;        Width = $R;         Height = $C }
        [PSCustomObject]@{ Widget = 'corners'; Preset = 'top-right';    OffsetX = $W - $C;  OffsetY = 0;        Width = $C;         Height = $C }
        [PSCustomObject]@{ Widget = 'corners'; Preset = 'bottom-left';  OffsetX = $B;       OffsetY = $H - $C;  Width = $R;         Height = $C }
        [PSCustomObject]@{ Widget = 'corners'; Preset = 'bottom-right'; OffsetX = $W - $C;  OffsetY = $H - $C;  Width = $C;         Height = $C }
        [PSCustomObject]@{ Widget = 'edges';   Preset = 'top';          OffsetX = $B + $R;  OffsetY = 0;        Width = ($W - $C) - ($B + $R); Height = $T }
        [PSCustomObject]@{ Widget = 'edges';   Preset = 'bottom';       OffsetX = $B + $R;  OffsetY = $H - $T;  Width = ($W - $C) - ($B + $R); Height = $T }
        [PSCustomObject]@{ Widget = 'edges';   Preset = 'right';        OffsetX = $W - $T;  OffsetY = $C;       Width = $T;         Height = $H - 2*$C }
    )
}

function Set-FrameZpackGeometry {
    <#
      Structural JSON edit (parse/mutate/serialize) against zpack.json,
      same family of pattern as Set-ZebarStartupConfig/Set-KomorebiBorderColours
      -- preserves every field this script doesn't touch (privileges,
      htmlPath, zOrder, includeFiles, monitorSelection, dockToEdge, the
      "bar" widget entirely, ...), matching only by widget name + preset
      name and rewriting exactly offsetX/offsetY/width/height on each match.
      A preset name in $Table with no matching entry in the live file is
      APPENDED (this is how a first run adds a brand-new preset that does
      not exist yet on an older checkout) rather than silently ignored.

      Left-frame-removal pass: $Table is now the SOLE source of truth for
      which presets should exist on the 'corners'/'edges' widgets --
      any preset already in the live file, on a widget this Table touches,
      whose name does NOT appear in $Table for that widget is REMOVED
      (this is how "edges/left", present in an older zpack.json, actually
      goes away rather than lingering as stale dead geometry forever).
      Safe to do unconditionally because every preset on 'corners'/'edges'
      is exclusively managed by this script -- there is no hand-authored
      preset on either widget this pruning could accidentally delete.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][array]$Table
    )

    $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ($null -eq $obj -or $obj -isnot [System.Management.Automation.PSCustomObject]) {
        throw "Set-FrameZpackGeometry: '$Path' did not parse to a JSON object -- refusing to write"
    }

    foreach ($row in $Table) {
        $widget = $obj.widgets | Where-Object { $_.name -eq $row.Widget } | Select-Object -First 1
        if (-not $widget) { throw "Set-FrameZpackGeometry: no '$($row.Widget)' widget in '$Path'" }

        $preset = $widget.presets | Where-Object { $_.name -eq $row.Preset } | Select-Object -First 1
        if ($preset) {
            $preset.offsetX = "$($row.OffsetX)px"
            $preset.offsetY = "$($row.OffsetY)px"
            $preset.width   = "$($row.Width)px"
            $preset.height  = "$($row.Height)px"
        } else {
            # New preset (e.g. a first run against an older zpack.json
            # missing a preset this pass introduced) -- append with the
            # same shape every other corners/edges preset already uses.
            $newPreset = [PSCustomObject]@{
                name              = $row.Preset
                anchor            = 'top_left'
                offsetX           = "$($row.OffsetX)px"
                offsetY           = "$($row.OffsetY)px"
                width             = "$($row.Width)px"
                height            = "$($row.Height)px"
                monitorSelection  = [PSCustomObject]@{ type = 'all' }
                dockToEdge        = [PSCustomObject]@{ enabled = $false }
            }
            $widget.presets = @($widget.presets) + @($newPreset)
        }
    }

    # Prune: for every widget $Table actually touches, drop any preset NOT
    # named in $Table for that widget (e.g. a stale "left" left over from
    # zpack.json predating this pass's edges/left removal).
    $widgetNames = $Table | ForEach-Object { $_.Widget } | Select-Object -Unique
    foreach ($widgetName in $widgetNames) {
        $widget = $obj.widgets | Where-Object { $_.name -eq $widgetName } | Select-Object -First 1
        if (-not $widget) { continue }
        $wanted = @($Table | Where-Object { $_.Widget -eq $widgetName } | ForEach-Object { $_.Preset })
        $widget.presets = @($widget.presets | Where-Object { $wanted -contains $_.name })
    }

    $json = $obj | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Set-FrameCssVariable {
    <#
      Surgical single-line regex replace of one `--name: <n>px;` custom
      property inside a :root { } block -- never touches anything else in
      the file (the prose comments explaining the geometry, the actual
      paint rules, etc.). Throws if the property isn't found, rather than
      silently no-op'ing (a renamed/removed variable should fail loudly,
      not leave the file un-retuned with no error).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][int]$ValuePx
    )

    $text = [System.IO.File]::ReadAllText($Path)
    $pattern = "(--$([regex]::Escape($Name))\s*:\s*)\d+px(\s*;)"
    if (-not [regex]::IsMatch($text, $pattern)) {
        throw "Set-FrameCssVariable: '--$Name' not found in '$Path'"
    }
    $new = [regex]::Replace($text, $pattern, { param($m) "$($m.Groups[1].Value)${ValuePx}px$($m.Groups[2].Value)" }, 1)
    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}

function Set-KomorebiFramePadding {
    <#
      Persists the computed workspace/container padding split into
      ~/komorebi.json's default_workspace_padding/default_container_padding
      fields. Deliberately the SAME parse -> mutate -> serialize ->
      temp-file -> Move-Item -Force pattern as Set-KomorebiBorderColours
      (scripts/Apply-Theme.ps1), including its guard against content that
      parses to $null (empty/whitespace/literal `null`) or to anything
      other than a JSON object -- see that function's own doc comment for
      the full rationale (an unguarded write silently truncated a 7-byte
      fixture to 0 bytes in testing) and for why `Move-Item -Force` is used
      over `[System.IO.File]::Replace` (short-name-expansion failure on
      this machine, confirmed reproducible).

      $Path is backed up first (caller's responsibility -- see
      Set-FrameGeometry's own Copy-Item call -- kept as a separate step so
      a backup failure and a write failure are two distinguishable
      problems, not one function that can partially do either).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$WorkspacePadding,
        [Parameter(Mandatory)][int]$ContainerPadding,
        [Parameter(Mandatory)][int]$Thickness
    )

    if (-not (Test-Path $Path)) { throw "Set-KomorebiFramePadding: komorebi.json not found at $Path" }

    $obj = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ($null -eq $obj) {
        throw "Set-KomorebiFramePadding: '$Path' parsed to `$null (empty, whitespace-only, or literal 'null' content) -- refusing to write, to avoid silently truncating the file"
    }
    if ($obj -isnot [System.Management.Automation.PSCustomObject]) {
        throw "Set-KomorebiFramePadding: '$Path' does not have a JSON OBJECT at its root (got $($obj.GetType().Name)) -- refusing to mutate it"
    }

    if (-not (Get-Member -InputObject $obj -Name 'default_workspace_padding' -MemberType NoteProperty)) {
        $obj | Add-Member -NotePropertyName 'default_workspace_padding' -NotePropertyValue $WorkspacePadding -Force
    } else {
        $obj.default_workspace_padding = $WorkspacePadding
    }
    if (-not (Get-Member -InputObject $obj -Name 'default_container_padding' -MemberType NoteProperty)) {
        $obj | Add-Member -NotePropertyName 'default_container_padding' -NotePropertyValue $ContainerPadding -Force
    } else {
        $obj.default_container_padding = $ContainerPadding
    }

    # There is no left frame band -- the bar itself is the left side of the
    # frame (a deliberate user call: a left band made the 52px bar read as a
    # 60px surface with its contents 4px off-centre). Without one, the left
    # side never spends `Thickness` out of komorebi's padding the way the
    # other three do, so its visible wallpaper gap comes out a full band
    # WIDER than top/right/bottom -- the exact inconsistency this pulls back
    # into line.
    #
    # `left` shifts the work area's origin; `right` shrinks its WIDTH, and
    # the two are independent (komorebic's own help says "set right to left
    # * 2 to maintain right padding"). So left == right == -Thickness moves
    # the left edge in by Thickness while leaving the right edge exactly
    # where it was.
    #
    # WARNING: komorebi reads this only at STARTUP, and never reflects it
    # back in `komorebic state`'s monitor.work_area_offset -- that field
    # stays empty even when the offset is demonstrably in effect. Two
    # separate attempts were written off as no-ops on the strength of that
    # field before the real check (pixel-scanning where tiled windows
    # actually land) proved it works. `komorebic global-work-area-offset`
    # IS genuinely a no-op here, exits 0 and changes nothing. Verify by
    # measuring windows, not by reading state.
    $offset = [PSCustomObject]@{ left = -$Thickness; top = 0; right = -$Thickness; bottom = 0 }
    if (-not (Get-Member -InputObject $obj -Name 'global_work_area_offset' -MemberType NoteProperty)) {
        $obj | Add-Member -NotePropertyName 'global_work_area_offset' -NotePropertyValue $offset -Force
    } else {
        $obj.global_work_area_offset = $offset
    }

    $json = $obj | ConvertTo-Json -Depth 10
    if ([string]::IsNullOrEmpty($json)) {
        throw "Set-KomorebiFramePadding: ConvertTo-Json produced no output for '$Path' -- refusing to write"
    }

    $tmpPath = Join-Path (Split-Path $Path -Parent) ("$(Split-Path $Path -Leaf).tmp-$PID-$(Get-Random)")
    [System.IO.File]::WriteAllText($tmpPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    try {
        Move-Item -Path $tmpPath -Destination $Path -Force
    } finally {
        if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue }
    }
}

function Update-KomorebiFramePaddingLive {
    <#
      Runtime half of the padding update: `komorebic workspace-padding
      <monitor> <workspace> <size>` / `container-padding` per workspace,
      for every monitor/workspace komorebi currently knows about (read via
      `komorebic state`, not a hardcoded "9 workspaces on monitor 0" --
      this machine happens to have 9 right now, but hardcoding that would
      silently stop covering a 10th workspace added later). Entirely
      fail-soft, same contract as Set-KomorebiBorderColour
      (scripts/Apply-Theme.ps1): a WM being down, or `komorebic` missing
      from PATH, must never throw out of this function -- it warns and
      returns. Set-KomorebiFramePadding (the persisted half) already ran
      by the time this is called, so a dead komorebi still gets the new
      padding on its next start.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int]$WorkspacePadding,
        [Parameter(Mandatory)][int]$ContainerPadding
    )

    if (-not (Get-Command komorebic -ErrorAction SilentlyContinue)) {
        Write-Warning "komorebic is not on PATH -- skipping the live workspace/container-padding update"
        return
    }
    if (-not (Get-Process komorebi -ErrorAction SilentlyContinue)) {
        Write-Warning "komorebi is not running -- skipping the live workspace/container-padding update (komorebi.json will still be updated so the next start picks up the new padding)"
        return
    }

    try {
        $state = (& komorebic state 2>&1 | Out-String) | ConvertFrom-Json
    } catch {
        Write-Warning "Failed to read/parse 'komorebic state' -- skipping the live workspace/container-padding update: $($_.Exception.Message)"
        return
    }
    if (-not $state -or -not $state.monitors -or -not $state.monitors.elements) {
        Write-Warning "'komorebic state' did not return a usable monitors list -- skipping the live workspace/container-padding update"
        return
    }

    for ($m = 0; $m -lt $state.monitors.elements.Count; $m++) {
        $monitor = $state.monitors.elements[$m]
        $workspaceCount = 0
        if ($monitor.workspaces -and $monitor.workspaces.elements) {
            $workspaceCount = $monitor.workspaces.elements.Count
        }
        for ($w = 0; $w -lt $workspaceCount; $w++) {
            try {
                & komorebic workspace-padding $m $w $WorkspacePadding 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "komorebic workspace-padding failed for monitor $m workspace $w (exit $LASTEXITCODE)"
                }
            } catch {
                Write-Warning "komorebic workspace-padding threw for monitor $m workspace $w`: $($_.Exception.Message)"
            }
            try {
                & komorebic container-padding $m $w $ContainerPadding 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "komorebic container-padding failed for monitor $m workspace $w (exit $LASTEXITCODE)"
                }
            } catch {
                Write-Warning "komorebic container-padding threw for monitor $m workspace $w`: $($_.Exception.Message)"
            }
        }
    }
}

function Set-FrameGeometry {
    <#
      The tunability knob for the desktop frame (bar's corner arcs + edge
      strips + komorebi's own tiling padding), per this task's item 4:
      retune the frame's thickness/gap/radius from one command instead of
      hand-editing zpack.json, corners.css, edges.css and ~/komorebi.json
      separately and risking them drifting out of sync with each other.

      Invariant this function exists to preserve: gap == komorebi's total
      padding (workspace + container) minus the frame's own thickness, on
      EVERY side, including the left one (see corners.css's :root comment
      for why the left side needed a real band added, not just this
      script, to make that true structurally). G defaults to exactly T (a
      1:1 ratio) but is independently tunable via -GapRatio.

      -DryRun prints the computed table (widget/preset/offset/size, plus
      the derived padding split) and writes nothing at all -- no zpack.json
      edit, no CSS edit, no komorebi.json edit, no `komorebic` call.
    #>
    [CmdletBinding()]
    param(
        [int]$Thickness = 8,
        [double]$GapRatio = 1.0,
        [int]$Radius = 16,
        [switch]$DryRun,

        # Override points for testing against fixtures instead of the real
        # machine -- same rationale as Install-Config's own path parameters
        # (scripts/Install-Config.ps1): a function whose every path is
        # hardcoded can't be exercised against a throwaway fixture.
        [string]$ZpackPath        = (Join-Path $script:Root "zebar\caelestia\zpack.json"),
        [string]$CornersCssPath   = (Join-Path $script:Root "zebar\caelestia\corners\corners.css"),
        [string]$EdgesCssPath     = (Join-Path $script:Root "zebar\caelestia\edges\edges.css"),
        [string]$KomorebiJsonPath = "$env:USERPROFILE\komorebi.json",
        [string]$BackupRoot       = (Join-Path $script:Root "state\config-backup"),
        [Nullable[int]]$ScreenWidth,
        [Nullable[int]]$ScreenHeight
    )

    if ($Thickness -le 0) { throw "Set-FrameGeometry: -Thickness must be a positive integer, got $Thickness" }
    if ($Radius -le 0) { throw "Set-FrameGeometry: -Radius must be a positive integer, got $Radius" }
    if ($GapRatio -lt 0) { throw "Set-FrameGeometry: -GapRatio must not be negative, got $GapRatio" }

    # G = round(T * GapRatio) -- AwayFromZero so e.g. a 0.5px midpoint
    # rounds up (7px), not to whichever side happens to be even (banker's
    # rounding, .NET's [math]::Round default) -- more intuitive for a
    # human tuning a visual gap by hand.
    $G = [int][math]::Round($Thickness * $GapRatio, 0, [MidpointRounding]::AwayFromZero)
    $P = $Thickness + $G

    # The SPLIT of P between workspace and container padding is not free, and
    # an even 50/50 split -- which is what this used to do -- is wrong.
    #
    # komorebi applies workspace padding once at the edge of the work area and
    # container padding around every container, so the two wallpaper gaps a
    # user actually sees are:
    #
    #     gap at the frame  = workspacePadding + containerPadding - Thickness
    #                       = P - Thickness = G          (independent of the split)
    #     gap BETWEEN windows = 2 * containerPadding     (all of it the split)
    #
    # With T=8, G=8, P=16, a 50/50 split gave containerPadding=8 and therefore
    # 16px between windows against 8px at the frame -- a 2:1 mismatch, measured
    # on screen (window borders 16px apart, but 8px from the bar and bands).
    # The frame's whole premise is that every wallpaper gap is the same width,
    # so the split has to be derived from G rather than from P:
    $containerPadding = [int][math]::Round($G / 2.0, 0, [MidpointRounding]::AwayFromZero)
    $workspacePadding = $P - $containerPadding
    # An odd G cannot halve exactly, so the between-windows gap lands on the
    # nearest even number instead. Say so rather than silently missing by 1px.
    $interWindowGap = 2 * $containerPadding

    if (-not (Test-Path $ZpackPath)) { throw "Set-FrameGeometry: zpack.json not found at $ZpackPath" }
    $zpack = [System.IO.File]::ReadAllText($ZpackPath) | ConvertFrom-Json
    $barWidget = $zpack.widgets | Where-Object { $_.name -eq 'bar' } | Select-Object -First 1
    if (-not $barWidget) { throw "Set-FrameGeometry: no 'bar' widget found in $ZpackPath" }
    $barPreset = $barWidget.presets | Where-Object { $_.name -eq 'default' } | Select-Object -First 1
    if (-not $barPreset) { throw "Set-FrameGeometry: no 'default' preset on the 'bar' widget in $ZpackPath" }
    $barWidth = ConvertFrom-PxString -Value $barPreset.width

    if ($ScreenWidth -and $ScreenHeight) {
        $screen = [PSCustomObject]@{ Width = $ScreenWidth; Height = $ScreenHeight }
    } else {
        $screen = Get-FrameScreenBounds
    }

    $table = Get-FrameGeometryTable -Thickness $Thickness -Radius $Radius -BarWidth $barWidth `
                                     -ScreenWidth $screen.Width -ScreenHeight $screen.Height

    $summary = [PSCustomObject]@{
        Thickness         = $Thickness
        GapRatio          = $GapRatio
        Gap               = $G
        Radius            = $Radius
        CornerSize        = $Thickness + $Radius
        TotalPadding      = $P
        WorkspacePadding  = $workspacePadding
        ContainerPadding  = $containerPadding
        InterWindowGap    = $interWindowGap
        BarWidth          = $barWidth
        ScreenWidth       = $screen.Width
        ScreenHeight      = $screen.Height
        Table             = $table
    }

    if ($DryRun) {
        Write-Output "Set-FrameGeometry -DryRun -- computed geometry (nothing written):"
        Write-Output "  Thickness=$Thickness Gap=$G (ratio $GapRatio) Radius=$Radius CornerSize=$($Thickness + $Radius)"
        Write-Output "  komorebi padding: workspace=$workspacePadding container=$containerPadding (total=$P, gap == total - thickness == $($P - $Thickness))"
        Write-Output "  wallpaper gaps:   at the frame=$G, between windows=$interWindowGap$(if ($interWindowGap -ne $G) { "  <-- differ, because gap $G cannot halve exactly" })"
        $table | Format-Table -AutoSize | Out-String | Write-Output
        return $summary
    }

    # 1. zpack.json -- all eight presets.
    Set-FrameZpackGeometry -Path $ZpackPath -Table $table

    # 2. corners.css -- --frame-band / --corner-radius.
    Set-FrameCssVariable -Path $CornersCssPath -Name 'frame-band' -ValuePx $Thickness
    Set-FrameCssVariable -Path $CornersCssPath -Name 'corner-radius' -ValuePx $Radius

    # 3. edges.css -- --frame-band (documentation/parity property, see
    #    edges.css's own :root comment -- not read by any paint rule, each
    #    preset's real thickness comes from its own zpack.json width/height).
    Set-FrameCssVariable -Path $EdgesCssPath -Name 'frame-band' -ValuePx $Thickness

    # 4. ~/komorebi.json -- back up first, then the guarded atomic write.
    if (Test-Path $KomorebiJsonPath) {
        if (-not (Test-Path $BackupRoot)) { New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupPath = Join-Path $BackupRoot "komorebi.json.bak-frame-geometry-$stamp"
        Copy-Item -Path $KomorebiJsonPath -Destination $backupPath -Force
        Set-KomorebiFramePadding -Path $KomorebiJsonPath -WorkspacePadding $workspacePadding -ContainerPadding $containerPadding -Thickness $Thickness
    } else {
        Write-Warning "Set-FrameGeometry: $KomorebiJsonPath not found -- skipping the komorebi.json padding update"
    }

    # 5. Live nudge -- fail-soft, per Update-KomorebiFramePaddingLive's own
    #    doc comment; never affects this function's own success.
    Update-KomorebiFramePaddingLive -WorkspacePadding $workspacePadding -ContainerPadding $containerPadding

    return $summary
}
