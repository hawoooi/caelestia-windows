# Entry point: restart every Zebar widget, without re-theming anything.
#
# Same shape as hotkey-next-wallpaper.ps1 / hotkey-retheme.ps1 -- a thin file
# so the caller stays a simple -File invocation rather than a quote-nested
# -Command string. Called by the dashboard's "Reload" quick action (and
# available to bind in ~/.config/whkdrc alongside the other two).
#
# Restart-ZebarWidgets lives in Apply-Theme.ps1 and is worth reusing rather
# than reimplementing: it restarts EVERY entry in ~/.glzr/zebar/settings.json's
# startupConfigs rather than just this pack's bar (a naive restart silently
# drops the other autostarted pack), it starts each preset detached because
# `start-widget-preset` blocks its caller for as long as the widget lives, and
# it reaps the pack's orphaned helper processes first -- one of which, left
# behind, inherits zebar's listening socket on port 6124 and makes every
# subsequent start paint nothing at all.
#
# Dot-sourcing Apply-Theme.ps1 only DEFINES its functions; it themes nothing.

. "$PSScriptRoot\Apply-Theme.ps1"
Restart-ZebarWidgets
