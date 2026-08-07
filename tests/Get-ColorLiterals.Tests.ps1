BeforeAll {
    . "$PSScriptRoot\..\scripts\Get-ColorLiterals.ps1"
    $script:fixture = "$PSScriptRoot\fixtures\sample.css"
}

Describe "Get-ColorLiterals" {
    It "finds every distinct color" {
        $r = Get-ColorLiterals -Path $script:fixture
        $r.Count | Should -Be 5
    }

    It "treats hex case-insensitively and counts both uses" {
        $r = Get-ColorLiterals -Path $script:fixture
        ($r | Where-Object { $_.Literal -eq '#cba6f7' }).Count | Should -Be 2
    }

    It "emits hex literals lowercased even when uppercase appears first" {
        $r = Get-ColorLiterals -Path $script:fixture
        @($r | Where-Object { $_.Literal -ceq '#abcdef' }).Count | Should -Be 1
        @($r | Where-Object { $_.Literal -ceq '#ABCDEF' }).Count | Should -Be 0
    }

    It "normalizes whitespace inside rgba() and counts both uses" {
        $r = Get-ColorLiterals -Path $script:fixture
        ($r | Where-Object { $_.Literal -eq 'rgba(17,17,27,0.8)' }).Count | Should -Be 2
    }

    It "sorts by count descending" {
        $r = Get-ColorLiterals -Path $script:fixture
        $r[0].Count | Should -BeGreaterOrEqual $r[-1].Count
    }
}

Describe "The zebar bar's zero-color-literal invariant (I5)" {
    <#
      This is the branch's central invariant -- style.css (structure/layout
      only) must never regress into hardcoding a colour that belongs in
      theme.css (the matugen-generated palette). Before this test, only a
      hand-grep enforced it, and the erosion path is already live: see
      style.css's comment on `.vesktop--pinged` settling for var(--primary)
      because no red token exists yet. Machinery already existed
      (Get-ColorLiterals); it just had no caller pointed at the real file.
    #>
    BeforeAll {
        $script:styleCss   = "$PSScriptRoot\..\zebar\caelestia\bar\style.css"
        $script:themeCss   = "$PSScriptRoot\..\zebar\caelestia\bar\theme.css"
        # corner-overlays: corners.css is a second structural stylesheet
        # added alongside style.css (a different widget in the same pack --
        # see zpack.json's "corners" widget) and is bound by the exact same
        # invariant: every colour it paints (var(--surface), for the
        # radial-gradient corner mask) must come from theme.css, never a
        # literal.
        $script:cornersCss = "$PSScriptRoot\..\zebar\caelestia\corners\corners.css"
        # Desktop-frame follow-up: edges.css is a third structural
        # stylesheet (the "edges" widget in zpack.json) under the exact
        # same invariant -- its only colour, the frame-line fill, must come
        # from theme.css's var(--primary), never a literal.
        $script:edgesCss   = "$PSScriptRoot\..\zebar\caelestia\edges\edges.css"
        # Task 3 (Font Awesome icons): fontawesome.css is a fourth
        # structural stylesheet -- @font-face declarations and a shared
        # font-metrics reset only, no fills of its own -- bound by the same
        # invariant: icon colour always comes from whatever element applies
        # the font, inheriting `color` from a var(--...) rule elsewhere,
        # never a literal set in this file.
        $script:fontawesomeCss = "$PSScriptRoot\..\zebar\caelestia\bar\vendor\fontawesome\fontawesome.css"
        # Horizontal-layout-menu pass: layoutmenu.css is a fifth structural
        # stylesheet (the "layoutmenu" widget in zpack.json -- the layout
        # flyout that had to become its own window to paint outside the
        # bar's 52px one). It paints a full panel: surface, hover, and the
        # active item's --primary fill -- more colour surface area than
        # corners.css or edges.css -- so it is the one most likely to
        # acquire a literal by accident, and is bound by the same invariant.
        $script:layoutMenuCss = "$PSScriptRoot\..\zebar\caelestia\layoutmenu\layoutmenu.css"
        # Status-icons pass: statusmenu.css is a sixth structural stylesheet
        # (the "statusmenu" widget in zpack.json -- the status pill's
        # dropdown). It paints the most colour surface of any file here:
        # panel, hover, the secondary --outline detail line and the value
        # column, so it is the likeliest to acquire a literal by accident.
        $script:statusMenuCss = "$PSScriptRoot\..\zebar\caelestia\statusmenu\statusmenu.css"
        # Taskbar-replacement pass: dock.css is the widget that replaces the
        # Windows taskbar. Its whole point is matching the bar's own
        # var(--surface), so a literal here would be exactly the bug the
        # user asked to have fixed.
        $script:dockCss = "$PSScriptRoot\..\zebar\caelestia\dock\dock.css"
    }

    It "style.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:styleCss).Count | Should -Be 0
    }

    It "corners.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:cornersCss).Count | Should -Be 0
    }

    It "edges.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:edgesCss).Count | Should -Be 0
    }

    It "layoutmenu.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:layoutMenuCss).Count | Should -Be 0
    }

    It "statusmenu.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:statusMenuCss).Count | Should -Be 0
    }

    It "dock.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:dockCss).Count | Should -Be 0
    }

    It "fontawesome.css contains zero colour literals" {
        @(Get-ColorLiterals -Path $script:fontawesomeCss).Count | Should -Be 0
    }

    It "is non-vacuous: theme.css (which legitimately hardcodes the matugen palette) returns a nonzero count" {
        # Proves the check above can actually fail against a real file with
        # real colour literals in it -- theme.css is the one file in this
        # pack that is SUPPOSED to have them (it's the matugen-generated
        # palette style.css's var(--...) tokens point at), so if this ever
        # returned 0 it would mean Get-ColorLiterals itself silently broke,
        # not that theme.css became clean. 8, not 7, as of change 1
        # (lower-cluster restyle): --surface-container-high was added
        # (matugen/templates/zebar.theme.css) for the hover/press circle
        # behind actually-clickable lower-bar items (see style.css's
        # .bar-btn:hover/:active).
        @(Get-ColorLiterals -Path $script:themeCss).Count | Should -Be 8
    }
}
