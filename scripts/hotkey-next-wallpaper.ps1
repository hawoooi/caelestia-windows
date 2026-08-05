# Hotkey entry point: advance to the next wallpaper and re-theme.
#
# Bound in ~/.config/whkdrc. Kept as a separate file so the whkdrc line stays
# a simple -File invocation rather than a quote-nested -Command string.
#
# Requires an active Wallpaper Engine playlist -- `-control nextWallpaper`
# advances within a playlist and is a no-op without one. Switch-Wallpaper
# warns and re-themes from the current wallpaper in that case.

. "$PSScriptRoot\Switch-Wallpaper.ps1"
Switch-Wallpaper
