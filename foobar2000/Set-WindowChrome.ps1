<#
.SYNOPSIS
    Paint foobar2000's title bar and window border from the wallpaper palette.

.DESCRIPTION
    The themed foobar draws every pixel INSIDE its window, but the caption and
    the frame belong to Windows, and Windows paints them from the system accent.
    That leaves a loud accent-coloured title bar sitting on top of dark surface
    panels -- reported as the foobar UI not matching the border colours.

    WHY NOT JUST CHANGE THE SYSTEM ACCENT. Because the accent is not only the
    title bar: it is every selection highlight, focus ring and hover in Windows.
    Apply-Theme maps it to `primary` on purpose, so those stay visible and
    coloured (see CLAUDE.md, "The Windows taskbar"). Re-pointing it at a surface
    tone to fix one title bar would turn all of that monochrome. DWM has offered
    PER-WINDOW caption, border and text colours since Windows 11 21H2, which
    solves this for exactly one window and leaves the rest of the desktop alone.

    A CORRECTION THIS SCRIPT ENCODES: CLAUDE.md's accent mapping says
    ColorizationColor drives title bars. Measured on this machine that is FALSE
    -- with ColorizationColor set to #252b2b the caption still painted #80d4d9,
    the `primary` value held in DWM\AccentColor. Title bars follow AccentColor.

.PARAMETER InstallRoot
    Which foobar to theme. Defaults to the Caelestia duplicate, and it REFUSES
    the live player for the same reason Deploy-Panels.ps1 does.

.PARAMETER PalettePath
    The matugen-rendered palette. Defaults to the staged one Apply-Theme writes,
    falling back to the repo copy.

.NOTES
    The attributes are not persistent: they live on the window, so this has to
    run after each foobar start. PowerShell 5.1 compatible.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = 'C:\Users\PC\Music\foobar2000-caelestia',
    [string]$PalettePath
)

$ErrorActionPreference = 'Stop'

$live = 'C:\Users\PC\Music\foobar2000'
if ([System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') -eq $live) {
    throw "Refusing to touch the live player at $live -- this pipeline only themes the duplicate."
}

$root = Split-Path $PSScriptRoot -Parent
if (-not $PalettePath) {
    $staged = Join-Path $root 'state\staging\foobar-palette.json'
    $repo   = Join-Path $PSScriptRoot 'palette.json'
    $PalettePath = if (Test-Path $staged) { $staged } else { $repo }
}
if (-not (Test-Path $PalettePath)) { throw "palette not found: $PalettePath" }
$pal = Get-Content $PalettePath -Raw | ConvertFrom-Json

# DWM wants a COLORREF: 0x00BBGGRR. Getting this backwards produces a colour
# that is wrong but plausible -- red and blue swapped -- which is exactly the
# trap CLAUDE.md documents for the ABGR/ARGB accent keys. Same care here.
function ConvertTo-ColorRef {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    if ($h.Length -ne 6) { throw "expected #RRGGBB, got '$Hex'" }
    $r = [Convert]::ToInt32($h.Substring(0,2), 16)
    $g = [Convert]::ToInt32($h.Substring(2,2), 16)
    $b = [Convert]::ToInt32($h.Substring(4,2), 16)
    return [uint32](($b -shl 16) -bor ($g -shl 8) -bor $r)
}

$sig = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FbChrome {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref uint val, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static IntPtr MainWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      // Skip tooltips and the tray helper: only the real player window is big.
      if (r.R - r.L < 300 || r.B - r.T < 200) return true;
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
}
"@
Add-Type -TypeDefinition $sig

# Documented since Windows 11 21H2 (build 22000). On an older build
# DwmSetWindowAttribute returns a failure HRESULT and nothing is painted --
# which is why every call below is checked rather than assumed.
$DWMWA_BORDER_COLOR  = 34
$DWMWA_CAPTION_COLOR = 35
$DWMWA_TEXT_COLOR    = 36

$exe = Join-Path $InstallRoot 'foobar2000.exe'
$procs = @(Get-Process foobar2000 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if (-not $procs) {
    Write-Warning "No foobar2000 running from $InstallRoot -- nothing to theme. These attributes live on the window, so run this after it starts."
    return
}

# The caption takes surface_container so it reads as the same material as the
# cards directly beneath it, and the border takes surface_container_high -- one
# step lighter, which is this desktop's standard "raised edge" pair and matches
# komorebi's own focused-border choice.
$caption = ConvertTo-ColorRef $pal.surface_container
$border  = ConvertTo-ColorRef $pal.surface_container_high
$text    = ConvertTo-ColorRef $pal.on_surface_variant

foreach ($p in $procs) {
    $hwnd = [FbChrome]::MainWindow([uint32]$p.Id)
    if ($hwnd -eq [IntPtr]::Zero) {
        Write-Warning "PID $($p.Id): no main window found (still starting?) -- skipped."
        continue
    }
    $applied = @()
    foreach ($pair in @(
        @{ Attr = $DWMWA_CAPTION_COLOR; Val = $caption; Name = "caption $($pal.surface_container)" },
        @{ Attr = $DWMWA_BORDER_COLOR;  Val = $border;  Name = "border $($pal.surface_container_high)" },
        @{ Attr = $DWMWA_TEXT_COLOR;    Val = $text;    Name = "text $($pal.on_surface_variant)" }
    )) {
        $v = [uint32]$pair.Val
        $hr = [FbChrome]::DwmSetWindowAttribute($hwnd, $pair.Attr, [ref]$v, 4)
        if ($hr -eq 0) { $applied += $pair.Name }
        else { Write-Warning "$($pair.Name) failed (HRESULT 0x{0:X8}) -- needs Windows 11 21H2 or later." -f $hr }
    }
    if ($applied.Count) { Write-Host "PID $($p.Id): $($applied -join ', ')" }
}
