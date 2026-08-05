# Hotkey entry point: re-theme from the CURRENT wallpaper, without changing it.
#
# Bound in ~/.config/whkdrc. Useful after editing matugen/mapping.json or a
# template -- Apply-Theme with no -Image falls back to state/current.json's
# recorded preview, so no wallpaper query or change is needed.

. "$PSScriptRoot\Apply-Theme.ps1"
Apply-Theme
