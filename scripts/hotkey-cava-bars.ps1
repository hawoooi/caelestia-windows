# Hotkey entry point: make cava's bars thinner (more of them) or fatter (fewer).
#
# WHY THIS SCRIPT EXISTS AT ALL. cava documents Left/Right as "decrease/increase
# number of bars", and `cava -h` prints that on this machine -- but **no key
# works on the Windows build**. In cava 1.0.0's own cava.c the variable the key
# switch reads is assigned in exactly two places, one guarded `#ifdef NCURSES`
# (this build reports "cava was built without ncurses support") and one guarded
# `#ifndef _WIN32`. So the whole switch is unreachable here; verified by feeding
# 200 'q' keystrokes on stdin and watching cava not quit. The help text is
# shared across platforms and is simply wrong for this build.
#
# What makes a hotkey work instead is `live-config = 1` in ~/.config/cava/config
# (set there deliberately): cava polls that file's mtime and size every frame and
# re-runs its whole config load on a change. Proven with a control arm -- bar
# count moved 8 -> 16 mid-run with it on, stayed at 8 with it off. So editing the
# file IS the keybind.
#
# IT ADJUSTS bar_width, NOT bars, on purpose. That is what cava's own (dead) key
# handler did -- `case 68: p.bar_width++` / `case 67: if (p.bar_width > 1)
# p.bar_width--`. It also cannot fail: with `bars = 0` the count is derived as
# (pane_width + bar_spacing) / (bar_width + bar_spacing), so it always fits.
# Pinning `bars = N` instead would make cava REFUSE TO START in any pane too
# narrow for N ("window is too narrow for number of bars set"), which is a poor
# thing to hand a global hotkey that has no idea how wide the pane is.

[CmdletBinding()]
param(
    # 'more' thins the bars (bar_width - 1), 'fewer' fattens them (bar_width + 1).
    [Parameter(Mandatory)][ValidateSet('more', 'fewer')][string]$Adjust
)

$ConfigPath = Join-Path $env:USERPROFILE '.config\cava\config'
$MinWidth = 1    # cava clamps to 1 itself (config.c), so going below is a no-op
$MaxWidth = 12   # past this the bars read as blocks, not a spectrum

if (-not (Test-Path $ConfigPath)) {
    Write-Warning "No cava config at $ConfigPath -- launch cava once to generate it."
    return
}

$text = [System.IO.File]::ReadAllText($ConfigPath)

# A pinned, non-zero `bars` overrides the derived count entirely, so changing
# bar_width would visibly do nothing. Say so rather than no-op silently.
$pinned = [regex]::Match($text, '(?m)^[ \t]*bars[ \t]*=[ \t]*(\d+)[ \t]*\r?$')
if ($pinned.Success -and [int]$pinned.Groups[1].Value -ne 0) {
    Write-Warning "cava's config pins bars = $($pinned.Groups[1].Value); bar_width has no effect on the count until that is 0 (auto)."
}

# Only ACTIVE lines count -- the config carries several commented `; bar_width`
# lines documenting the SDL/sdl_glsl pixel defaults, and those must not be
# touched or uncommented.
$active = [regex]::Match($text, '(?m)^[ \t]*bar_width[ \t]*=[ \t]*(\d+)[ \t]*\r?$')
$current = if ($active.Success) { [int]$active.Groups[1].Value } else { 2 }  # cava's own default

$new = if ($Adjust -eq 'more') { $current - 1 } else { $current + 1 }
if ($new -lt $MinWidth) { $new = $MinWidth }
if ($new -gt $MaxWidth) { $new = $MaxWidth }

if ($new -eq $current -and $active.Success) { return }   # already at the stop

if ($active.Success) {
    $updated = $text.Remove($active.Index, $active.Length).Insert($active.Index, "bar_width = $new")
} else {
    # No active line yet: insert one directly under [general] so it is the first
    # occurrence in the section. GetPrivateProfileString -- which is what reads
    # this file on Windows, not iniparser -- takes the first match.
    $header = [regex]::Match($text, '(?m)^\[general\][ \t]*\r?$')
    if (-not $header.Success) {
        Write-Warning "cava's config has no [general] section -- refusing to guess where bar_width belongs."
        return
    }
    # The match ends before the line's \r/\n, so insert a fresh newline and
    # let the original terminator close our line.
    $at = $header.Index + $header.Length
    $updated = $text.Insert($at, "`nbar_width = $new")
}

# The pipeline's BOM rule: never Set-Content/Out-File a config file.
[System.IO.File]::WriteAllText($ConfigPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
