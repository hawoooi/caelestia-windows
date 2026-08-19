# foobar2000 retheming — briefing for a separate agent

You are working on ONE task, in its own terminal, alongside a larger
wallpaper-driven theming project. Read this whole file before touching anything.

## Your task, in order

1. **Back up foobar2000 first.** Nothing else happens until the backup exists and
   you have verified it.
2. **Retheme foobar2000** to match the desktop described below.

## Where foobar2000 lives

It is a **portable install**, not a Program Files one:

```
C:\Users\PC\Music\foobar2000\
```

`portable_mode_enabled` is present at the root, which means **all configuration
lives under `profile\`, not in `%APPDATA%`**. The whole tree is ~25 MB.

Relevant paths:

- `profile\` — the entire live configuration. This is what matters.
- `profile\theme.fth` — the active theme export.
- `themes\*.fth` — the stock themes that shipped with it (Black, Blue, Dark
  Grey Orange, Faded, Gray…). These are *examples of the format*, and the
  closest starting point is whichever dark one is nearest the palette below.
- `components\` — installed components. `foo_discord_rich` is one; check what
  else is there, because the UI component in use decides what "theming" even
  means (Default UI and Columns UI are configured completely differently).

**It is running right now** (`foobar2000.exe`, portable path above). foobar2000
writes its configuration on exit, so anything you change on disk while it is
running can be overwritten when it closes. Decide deliberately whether to close
it first — and if you do, tell the user, because it is their music player.

## The backup

Put it somewhere obviously outside the app:

```
C:\Users\PC\Documents\git\setup\state\foobar2000-backup\<yyyyMMdd-HHmmss>\
```

Back up **at least `profile\`**, which is the irreplaceable part; the rest is a
re-downloadable application. Backing up the whole folder is only ~25 MB and is
the safer choice.

Verify the backup by counting files and comparing against the source, and say
the number out loud in your report. A backup nobody checked is not a backup —
this project has been bitten by exactly that class of assumption.

## The palette

This desktop is themed from the current wallpaper by `matugen`, and every
surface on it uses these exact values. They are **Material You roles**, and the
mapping matters more than the hex:

| role | hex | used for |
|---|---|---|
| `surface` | `#0e1415` | the base background of every panel, bar and dock |
| `surface_container` | `#1a2121` | a raised block on that base (rows, tiles) |
| `surface_container_high` | `#252b2b` | hover/selected state, one step lighter again |
| `on_surface` | `#dde4e4` | primary text |
| `on_surface_variant` | `#bec8c9` | secondary/dimmed text |
| `outline` | `#899393` | hairlines, borders, inactive glyphs |
| `primary` | `#80d4d9` | the accent — selection, focus, the one "now" thing |
| `on_primary` | `#003739` | text ON an accent-filled surface |

**These change with the wallpaper.** Do not treat them as permanent brand
colours. If foobar2000's config format allows it, structure your work so a
future re-theme is a matter of substituting eight values — that is exactly how
the rest of this desktop works (see below). If it does not, say so plainly in
your report rather than pretending it is re-themable.

### The conventions this desktop follows

Copy these, so foobar2000 looks like it belongs:

- **Accent is used sparingly** — one accented thing per view, the item that is
  "now" (the playing track, the selected row). Everything else is surface and
  text. A UI where five things are teal reads as noise.
- **Depth comes from surface steps, not from borders or shadows.** Nothing in
  this desktop casts a shadow. A raised element is `surface_container` on
  `surface`; a hovered one is `surface_container_high`.
- **Selection is a filled rounded rectangle**, not an outline and not a full-row
  underline.
- **Dark throughout.** There is no light mode.

## The wider project, for context only

`C:\Users\PC\Documents\git\setup` is a wallpaper-driven theming pipeline:
`matugen` extracts a Material You palette from the current wallpaper and
regenerates WezTerm, starship, a Zebar desktop shell and komorebi's window
border colours. Its `CLAUDE.md` is the working knowledge for all of it.

**You are NOT being asked to wire foobar2000 into that pipeline.** That would
mean a matugen template, a staging output, a validation step and an entry in
`$script:Targets` — a much larger change. Your job is to make foobar2000 match
the palette above, by hand, and to report clearly on whether templating it
later is feasible. If you find it obviously templatable, say what the template
would need to touch; do not build it unasked.

## House rules that apply to you

These are the project's, and they exist because each was paid for:

- **Never use `Set-Content -Encoding UTF8` or `Out-File` for a config file.**
  Both emit a UTF-8 BOM, and configuration parsers here have silently rejected
  BOM'd files with an unrelated-looking error. Use
  `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`.
- **PowerShell 5.1 only.** No `&&`, no `||`, no ternary, no `??`, no `` `e ``
  escape (that is PS6+; use `[char]27`). PowerShell variable names are
  case-insensitive, so `$w` and `$W` are the same variable.
- **Verify by looking, not by reading state.** Screenshot the result. This
  project's every significant defect was found by looking at an image; several
  were missed by everything else. A clean log is not proof.
- **Report honestly.** If something did not work, say so with the output. If
  you skipped part of the task, say which part and why. Do not describe work
  you did not do.

## What to report back

1. Where the backup is, and how many files it contains.
2. Which UI component foobar2000 is actually using, and how you determined it.
3. What you changed, file by file.
4. A screenshot of the result.
5. Whether this is templatable into the matugen pipeline later, and what that
   would take.

---

# STATE AT RESTART — 2026-08-16 21:15. READ THIS BEFORE THE TASK LIST ABOVE.

An earlier agent worked this task for roughly two hours and **its transcript was
never written to disk**, because it inherited a `CLAUDE_CODE_CHILD_SESSION`
marker that silently disables transcript persistence. Its reasoning is
unrecoverable. Only the artifacts below survive, and they are the whole record.
This session is started with `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` so the
same thing does not happen twice.

**Nothing below is a suggestion to redo. It is done. Do not repeat it, and do
not undo it without saying why.**

## Established facts

- **The backup exists and is verified**:
  `state/foobar2000-backup/20260816-193112/`, **158 files**. The live install
  is 159 files / 24.9 MB, so confirm the one-file difference is benign (likely a
  lock or a file created after the copy) before relying on it.
- **All work happens in a DUPLICATE portable install:**
  `C:\Users\PC\Music\foobar2000-caelestia\` (511 files, 44.6 MB).
  **`C:\Users\PC\Music\foobar2000\` is the user's LIVE player and is RUNNING
  right now.** Never write to it. foobar2000 rewrites its configuration on
  exit, so edits to a running instance are lost anyway.
- **The UI is Columns UI** (`foo_ui_columns`), plus `foo_uie_webview`,
  `foo_discord_rich` and `foo_playcount`, all under
  `profile\user-components-x64\`.
- **Columns UI's own `.cfg` is CHECKSUMMED — never hand-patch it.** A written
  config with a stale checksum is rejected. Theming goes through the
  `foo_uie_webview` panel's HTML/CSS instead, which is why the artifacts below
  are a web page rather than a theme file.

## Artifacts already built, all under `setup/foobar2000/`

| file | what it is |
|---|---|
| `palette.json` | the eight Material You roles, and the **single substitution point** for a future matugen template |
| `render-theme-css.py` | `palette.json` -> `theme.css`; writes UTF-8 **no BOM** per the house rule |
| `theme.css` | generated; **do not hand-edit** |
| `mockup.html` | the panel design (~24 KB). Contains **zero colour literals** — every colour is `var(--role)`, the same discipline the Zebar pack enforces |
| `build-standalone.py` | inlines the CSS and rewrites every image to a `data:` URI, for a single self-contained page |
| `art/` | 53 cover images plus `manifest.json` |

## Question 5 is already answered

`render-theme-css.py` **is** the substitution point. A future matugen template
would replace that script and emit `theme.css` from the live wallpaper palette,
with no other change anywhere — because `mockup.html` holds no colour literals.
Do not re-derive this; build on it.

## The host API — established from the DLL, not inferred (2026-08-16, later)

An earlier pass in this file assumed `foo_uie_webview` exposed playback only.
**That was wrong**, and the correction matters because it decides what can be
built. The component ships two undocumented sample templates next to its DLL
(`Default-Template.html`, `Default-PlaylistTemplate.html`), and the member names
were then confirmed against the identifier strings inside `foo_uie_webview.dll`
itself.

**Available** (all verified present in the DLL's symbol table):

- transport: `stop()` `play(bool)` `togglePause()` `previous()` `next()`
  `random()` `seek(sec)` `seekDelta(sec)` `canSeek` `length` `position`
- volume: `volume` (dBFS, read/write) `volumeUp()` `volumeDown()`
  `toggleMute()` `isMuted`
- `playbackOrder` (bare index) · `stopAfterCurrent` / `toggleStopAfterCurrent()`
- now playing: `getFormattedText(<titleformat>)` · `getArtwork("front"|…)`
- playlists: `playlistCount` `activePlaylist` `playingPlaylist`
  `getPlaylistName` `setPlaylistName` `findPlaylist` `createPlaylist`
  `createAutoPlaylist` `duplicatePlaylist` `deletePlaylist` `clearPlaylist`
  `isAutoPlaylist` `getPlaylistItemCount` `getPlaylistItems`
  `getSelectedPlaylistItems` `selectPlaylistItem` `deselectPlaylistItem`
  `isPlaylistItemSelected` `clearPlaylistSelection` `getFocusedPlaylistItem`
  `setFocusedPlaylistItem` `ensurePlaylistItemVisible` `removePlaylistItem`
  `removeSelectedPlaylistItems` `executePlaylistDefaultAction` `addPath`
- filesystem: `readDirectory(path, pattern)` `readImage(path)` `readAllText`
- audio: a shared PCM buffer (`sharedbufferreceived` + `OnTimer`) with sample
  rate and channel config — **so a level meter or spectrum is real, not fake**
- events for essentially everything, including `onPlaybackOrderChanged` and the
  full playlist-mutation set

**NOT available — the two limits that shape the design:**

1. **No per-playlist-item metadata.** `getPlaylistItems()` returns objects with
   exactly two fields, `path` and `subsong` (measured live: 36 items, those two
   keys). `getFormattedText()` takes only a format string and applies to the
   **now-playing** track, and there is no `getPlaylistItemText`-style member in
   the DLL. So HTML can list, select, focus and *play* playlist items, but can
   only display their file path — no title, artist, album, duration or play
   count. **A tag-rich playlist view must stay Columns UI's own.**
2. **No main-menu command API.** Only WebView2's own `ContextMenuRequested`.
   File/Edit/View/Playback/Library/Help therefore cannot live inside the panel;
   foobar's menu bar stays a separate toolbar row above it. The mockup draws
   them on one line — the real thing cannot.

### The trap that cost a debugging pass

`foo_uie_webview` watches its template file and reloads the panel **the moment
it changes**. Writing `Template.html` before the CSS it references means the
panel reloads against assets that have not landed yet, the stylesheet 404s, and
**every icon renders as tofu** — indistinguishable from a broken webfont, which
is what it was mistaken for. `Deploy-Panels.ps1` therefore writes theme and
vendor assets FIRST and templates LAST. Proven not-a-font-problem by a probe
page that reported `document.fonts.check(...) === true`, one registered face,
and U+F04B measuring 48.00px in Font Awesome vs 39.69px in the fallback.

Related: WebView2 blocks `cssRules` on file:// stylesheets with a
`SecurityError`. That is normal and is **not** a load failure — the sheet is
applied, it just cannot be read back from script.

## Driving the Columns UI layout (done 2026-08-17)

The `.cfg` is checksummed so the layout cannot be scripted — it was built through
the Preferences GUI instead, by automation. What that established:

- **`Row` = horizontal** (children side by side), **`Column` = vertical**. The
  tree's indentation is the only clue to nesting and is easy to misread; check
  the x offset of the labels, not the apparent grouping.
- **Layout edits apply LIVE, before OK.** Pressing Escape closes the dialog but
  does *not* undo them. Two Escapes in a row will close the dialog out from
  under you — do not send stray Escapes; dismiss a popup by clicking the
  dialog's own title bar instead.
- **Ctrl+P does not open Preferences when focus is inside the WebView panel** —
  WebView2 swallows it. Click a native panel first, or use File > Preferences.
- **The template file path is PER-PANEL, not global.** This was initially
  inferred to be global (both panels rendered the same file) and that was
  WRONG: a newly added WebView simply defaults to the same path. Select the
  panel in Display > Columns UI > Layout, then open Display > **WebView** and
  set "Template file path" — it edits the selected panel. Proven by pointing
  one at `nowplaying.html` and watching only that panel change.
- **"Configure panel..." does nothing** for `foo_uie_webview`; the WebView
  preferences page is the only route.
- Splitter dividers are 2px `#333333` lines between panels. Drag them to size a
  panel; the drag must start ON the divider row (2px off does nothing). Find
  them by pixel-scanning a column for that colour rather than by eye.

**Verified live, not assumed:** clicking the panel's own order button moved
foobar's toolbar dropdown `Repeat (track)` -> `Random`, and six further clicks
returned it to `Repeat (track)`. That proves three things at once: the command
path works, `playbackOrder` is writable from JS, and there are exactly seven
playback orders (so `ORDERS` in `panels/topbar.html` has the right length, with
index 2 = Repeat (track) and 3 = Random).

The resulting layout:

```
Column                     (root, vertical)
  WebView                  -> Template.html   (top bar, ~44px)
  Row                      (horizontal)
    Playlist switcher
    Playlist view
  WebView                  -> nowplaying.html (bottom bar, ~64px)
```

## Spider Monkey Panel — the second approach (2026-08-17)

The WebView route cannot draw a real playlist (no per-item metadata, proven
above). Georgia-ReBORN solves this by not theming foobar's views at all: it
hosts **Spider Monkey Panel** inside Columns UI and draws its entire UI itself.
We now do the same, with our own code.

**SMP x64 exists and works, contrary to this project's earlier note.** The
record said SMP was "discontinued and x86-only (won't load in this x64
v2.25.9)" — that is why foo_uie_webview was chosen. False. A maintained fork,
`github.com/dima-lur/spider-monkey-panel-x64`, release **1.7.26.4.5**, installs
as two DLLs into `profile\user-components-x64\foo_spider_monkey_panel\` and
loads fine: Preferences > Components lists it in white, next to Columns UI
3.6.0 and core 2.25.9.

**What it buys:** `fb.TitleFormat(...).EvalWithMetadbs(handleList)` returns an
ARRAY — one batch call per field for a whole playlist, which is what keeps a
custom playlist fast. Plus `plman` for selection/focus/playback and
`handleList.CalcTotalDuration()` — even the playlist total the WebView could
not compute.

### The dev loop (no GUI round-trip per edit)

The panel's own script is a ONE-LINE bootstrap, pasted once:

```js
include(fb.ProfilePath + 'caelestia\\playlist.js', { always_evaluate: true });
```

`Deploy-Panels.ps1` writes `<profile>\caelestia\playlist.js` as
`theme.js + playlist.js` concatenated (SMP loads one file per panel, and
concatenating avoids relying on include() path resolution — the same tactic as
the inlined webfont). Then **right-click the panel > Reload**. Verified that
this genuinely re-reads the file from disk: a fix deployed between two reloads
produced a *different* error, so SMP's script cache is not serving stale text
when `always_evaluate` is set.

Errors surface in a `foo_spider_monkey_panel` dialog with file, line, column
and a stack trace — read that, don't guess.

### Two API traps, both of which cost a paint

1. **`utils.GetAlbumArtAsync`, NOT `fb.GetAlbumArtAsync`.** The component's own
   bundled JSDoc cross-references it twice as `{@link fb.GetAlbumArtAsync}`,
   which is a documentation bug; the member lives on `utils`. Calling it on
   `fb` throws "is not a function" from inside `on_paint`. The callback is
   `on_get_album_art_done(metadb, art_id, image, image_path)`.
2. **`FillRoundRect` throws "Arc argument has invalid value"** when the corner
   radius does not fit the rectangle — a 4px-wide scrollbar thumb with a 3px
   arc is enough, and it kills the ENTIRE paint, not just that shape. Never
   call it directly; `fillRound()` in `smp/playlist.js` clamps the radius to
   half the smaller side and falls back to `FillSolidRect` below 1px.

Also worth knowing: `Add-Type` in PowerShell refuses to compile a helper class
containing a static method named `Main` ("wrong signature to be an entry
point"). Cost two failed calls while automating the GUI.

## The all-SMP layout (2026-08-17, later)

Every band in the window is now drawn by our own code:

```
Column
  Spider Monkey Panel   -> smp/topbar.js    menu + transport + seek + volume
  Row
    Spider Monkey Panel -> smp/explorer.js  library tree
    Spider Monkey Panel -> smp/playlist.js  tabs + columns + list + now playing
```

The WebView panels and every native toolbar are gone: `Buttons`, `Playback
order`, `Seekbar`, a stray empty toolbar, the status pane, and finally the
`Menu` toolbar itself.

**The menu lives in our top bar.** `fb.CreateMainMenuManager()` + `Init('file')`
+ `BuildMenu(menu, 1, -1)` + `TrackPopupMenu` + `ExecuteByID(ret - 1)` gives
foobar's genuine File/Edit/View/Playback/Library/Help, shortcuts and all. This
is why the native menu strip -- a fixed `#333333` band no colour setting
reaches -- could be switched off. **`foo_uie_webview` could not do this**, which
is the one thing that made the mockup's single line of chrome unbuildable there.

### Traps this cost

1. **SMP splits its factory methods across objects with no inferable rule.**
   It is `fb.CreateMainMenuManager()` but `window.CreatePopupMenu()`; likewise
   `utils.GetAlbumArtAsync()` but `fb.GetLibraryItems()`. Guessing the owner
   throws "is not a function" at CLICK time, long after the panel looks fine.
   Check each name against `docs/js/foo_spider_monkey_panel.js`.
2. **`MenuObject` has no `Dispose()`.** Calling it throws *after* the menu has
   already worked, which reads as the menu being broken when it is not.
3. **Divider width 0 makes splitters ungrabbable.** Preferences > Layout > Misc
   > "Divider width" is what draws the grey lines between panels; 0 removes
   them, but then there is nothing to drag to resize a panel. To resize: set it
   to 4, drag, set it back to 0. Panel sizes persist independently.
   Find the divider by pixel-scanning a column for `#333333` -- a drag that
   starts even 1px off it does nothing at all, silently.
4. **The Layout page remembers its last TAB.** Clicking "Layout" in the left
   tree can land on `Misc`, where the panel tree does not exist and every
   right-click finds nothing. Click the `Layout` tab too.

### Gaps: why per-side insets

Every panel paints its own margin, so a SHARED edge gets both panels' margins
while an OUTER edge gets only one. Symmetric insets therefore give 8px between
panels and 4px at the window edge -- visibly inconsistent. Each panel now
declares `IN = {l,t,r,b}` with outer sides at the full gap and shared sides at
half. Measured result: every gap 7-8px (the 1px spread is corner antialiasing),
and zero `#333333` pixels anywhere in the window.

Card radius is **8px**, matching the Windows 11 window corner. That is an
informed assumption, not a measurement: the rounded corner is painted by DWM
*outside* the client rect, so a screen grab at the window origin shows only
square pixels.

### A bug shape worth remembering

A panel section that does not paint its own background lets the scrolling list
draw straight through it. This happened twice -- the playlist footer, then the
explorer footer -- with file names overlapping "view by folder structure". Any
fixed header/footer must be drawn LAST and fill its own ground, as a rounded
rect extended by the card radius so the card's outer corners stay round.

## Why scrolling was laggy — measured, and it was not what it looked like

Reported as "scrolling feels laggy and slow". Instrumented `on_paint` with
`fb.CreateProfiler()` rather than guessing, logging to the foobar console:

```
[playlist] 152.47 ms/paint avg over 30 frames | IsPlaylistItemSelected x7  CalcTextWidth x6  rows=343
```

**152 ms per repaint — about 6 fps.** The two calls that looked expensive were
innocent: only 7 and 6 of them per frame, because barely a dozen rows are ever
visible. The cost was **`gr.DrawImage` rescaling every visible album cover from
its full resolution (commonly 1000x1000) down to 39px on EVERY frame**, with
antialiasing on.

Fix: pre-scale each cover ONCE on arrival, in `on_get_album_art_done`, via
`GdiBitmap.Resize(w, h, 7)` (7 = HighQualityBicubic — affordable precisely
because it happens once), and cache the thumbnail. The per-frame draw then
becomes a straight blit.

```
before  152.47 ms/paint
after     4.37 ms/paint      -- 33x
```

**The general rule:** in an SMP panel, never hand `DrawImage` a bitmap larger
than the rectangle you are drawing it into. Resize on load, cache the result,
and keep a separate cache per display size (the list thumbnail is 39px, the
now-playing cover 76px — they are different bitmaps).

### A hit-testing bug this uncovered

`topbar.js` computed its layout twice: with a `GdiGraphics` during paint (real
`CalcTextWidth`) and with an estimated `length * 7` on mouse events, because
mouse callbacks have no `gr`. The two drifted, so `File` responded — it starts
at the same x — while `View` and everything right of it did nothing at all. The
paint layout is now cached in `_layout` and reused by every mouse handler, which
is what the code's own comment had always claimed it did.

### And a third instance of the same drawing bug

A fixed band that does not paint its own ground lets the scrolling list draw
through it. Fixed in the playlist footer, then the explorer footer, then AGAIN
in both headers — "01 sunder" was rendering on top of "ART # TITLE / TRACK
ARTIST". **There is no clipping region in GdiGraphics**, so a row that is only
partly inside the list region is still drawn in full. Every fixed band must be
painted AFTER the list and fill its own background.

## The Columns UI splitter: its colour is hardcoded, and its width is the only
## drag target (2026-08-17)

Asked to make the grey line between panels match the background. **It cannot be
done from any Columns UI setting**, and this was established by measurement, not
by reading anything:

- Set **Global** -> Scheme `Custom`, item background `surface` (#0e1415), applied,
  re-scanned the pixel row: splitter still `#333333`.
- Set **Core** -> Scheme `Custom`, item background `surface`, applied, re-scanned:
  splitter still `#333333`. (Core's item background turned out to be `#191919`,
  which is the *native playlist* background — a useful thing to know, but not
  this.)

So `#333333` is a hardcoded dark-mode constant in Columns UI.

**And the width is also the hit area.** Preferences > Layout > Misc > "Divider
width" set to **0** removes the line completely — and removes the ability to
resize the panels with it, which the user noticed immediately. "Allow manual
resizing of locked panels" being checked does **not** provide a hit area of its
own. The two requests (invisible divider, resizable panels) are therefore
mutually exclusive under Columns UI.

**Settled at 2px**, measured grabbable: a glide-drag with cursor-integrity
checking moved it from x=439 to x=375, exactly the 64px dragged. Half the visual
weight of the old 4px slab.

**The gap arithmetic that goes with it.** Every shared panel edge is
`(GAP - DIVIDER) / 2`, so two panels meeting produce exactly `GAP` between them —
the same 8px the outer rim uses. At DIVIDER=2 that is an inset of 3:

| file | value |
|---|---|
| `smp/playlist.js` | `var IN = { l: 3, t: 3, r: 8, b: 8 };` |
| `smp/explorer.js` | `var IN = { l: 8, t: 3, r: 3, b: 8 };` |
| `smp/topbar.js` | `var DIVIDER = 2; var INSET = { l: GAP, t: GAP, r: GAP, b: (GAP - DIVIDER) / 2 };` |

Verified by pixel scan after a restart: left rim 8px, panel gap 8px, right rim
8px, top rim 8px, top-bar gap 8px, bottom rim 8px. **If DIVIDER changes, all
three inset values must change with it** — there is no single place that derives
them, because each panel is a separate script.

**The real fix is the single-panel merge** (see `foobar2000/mockup-layout.html`,
section 5): one SMP panel drawing library + tabs + list, with our own divider.
Then there is no Columns UI splitter at all, the divider is `surface`-coloured
*and* draggable, and drag-and-drop between library and playlist becomes ordinary
internal state rather than an OS-level drag between two panel windows.

**Two operational notes paid for in this session:**

- **SMP does not hot-reload these scripts from disk.** Deploy-Panels.ps1 writes
  `profile\caelestia\*.js`, but the running panels kept the old geometry through
  a deploy and through a window focus change. Restarting foobar is what picks
  them up. Restart by matching `MainModule.FileName` against the *caelestia*
  path and refusing if the match is not unique — there are always two foobar
  processes running and the other one is the user's live player.
- **The Preferences window is an owned window, so `GetForegroundWindow` returns
  the main foobar window instead** and makes an open dialog look closed. Find it
  by enumerating top-level `#32770` windows by title. It also *moves* if a stray
  click lands on its title bar, so re-read `GetWindowRect` before computing any
  button coordinate rather than caching an origin.

## GdiDrawText clips to its rect, and that IS the missing clipping region

`GdiGraphics` has no clip region -- which is what made every fixed band overdraw
until each one was taught to paint its own ground. But **`GdiDrawText` clips to
the rectangle it is given**, and text alignment is anchored to *one* edge of that
rect. So the same string can be drawn twice at the same position and clipped
differently, by moving the edge that does NOT anchor the alignment:

| alignment | anchored at | move this edge to clip |
|---|---|---|
| `DT_LEFT`  | rect left  | the right edge (clips the tail) |
| `DT_RIGHT` | rect right | the left edge (clips the head)  |

**Why it was needed.** Seekbar option F puts the clocks *inside* the bar, and the
volume icon inside the volume bar. Anything drawn inside a bar sits on the fill at
one end of the bar's travel and on the empty track at the other, and one colour is
unreadable at whichever end it is wrong for. Draw the whole string in the
track-side colour, then draw it again in the fill-side colour clipped to where the
fill actually reaches (`drawInBarLeft` / `drawInBarRight` in `smp/topbar.js`).

**Verified, not assumed** -- and the obvious test is the one that proves nothing.
At full volume the icon is entirely over the fill, so a clipping and a
non-clipping `GdiDrawText` produce identical pixels. Setting the volume to ~15%
is what separates them: the speaker glyph then renders visibly **split**, dark
over the fill and light over the track, in one screenshot.

## Fonts: the panels can only draw what 0xProto Nerd Font contains

GDI needs an **installed** font. The vendored `vendor/fontawesome/*.woff2` works
only in the WebView panel, and **no Font Awesome family is installed on this
machine at all** (checked via `System.Drawing.FontFamily.Families`). Every panel
glyph therefore has to exist in `0xProto Nerd Font`.

Probed by rendering each codepoint to a bitmap and looking at it:

| codepoint | glyph | result |
|---|---|---|
| `F0DA` / `F0D7` | caret right / down | present |
| `F07B` / `F07C` | folder / folder-open | present |
| `F001` | music | present |
| `F1DE` | sliders | present |
| `F028` / `F026` | volume / muted | present |
| **`F6E2`** | **fa-ghost** | **TOFU** |

`0xProto Nerd Font` is **Nerd Fonts v3**, where Material Design Icons moved to
plane 1 (`U+F0000+`) and vacated the old v2 `U+F500-FD46` range that `F6E2` sits
in. So the ghost the design asked for cannot be drawn as text at all. The top bar
draws the **real extracted app icon** instead -- `art/foobar-icon.png`, copied to
`profile/caelestia/` by `Deploy-Panels.ps1` and loaded once via `gdi.Image`. The
cost is that a bitmap cannot follow the wallpaper palette; a logo arguably should
not anyway.

**If a glyph outside FA v4 is ever needed**, the options are: install Font Awesome
6 Free Solid as a real `.otf` (per-user installs work without admin since 1809 --
but the repo vendors woff2, not otf), draw the shape with `FillPolygon`, or use a
bitmap as above. Do not reach for a codepoint without probing it first: a wrong
codepoint in a Nerd Font usually renders *some other icon* rather than tofu,
which is worse.

## A frameless window IS possible -- via UI Wizard, not Columns UI

**A previous claim in this file's spirit was wrong and is corrected here:** the
borderless window with our own minimise/maximise/close is not blocked. Columns UI
genuinely has no "hide caption" setting and SMP cannot subclass the window, but
that was never the route. Georgia-ReBORN does it with a COMPONENT.

**`foo_ui_wizard` -- UI Wizard**, github.com/The-Wizardium/UI-Wizard. It is the
maintained successor to `foo_ui_hacks` (which is x86-only and unmaintained) and
was written specifically to support Georgia-ReBORN's x64 transition, so it is the
right one for the x64 SMP fork this project uses. It exposes a COM/ActiveX object
that Spider Monkey Panel can drive directly:

```js
const UIWizard = new ActiveXObject('UIWizard');
UIWizard.FrameStyle = 3;                  // 0 Default, 1 Small Caption, 2 No Caption, 3 No Border
UIWizard.MoveStyle  = 0;                  // 0 Caption only, 1 Middle mouse, 2 Ctrl+Alt+Left, 3 Any
UIWizard.SetCaptionAreaSize(0, 0, w, 32); // the DRAG region once the caption is gone
UIWizard.WindowMinimize();                // also ToggleMaximize / ExitMaximize / WindowRestore
UIWizard.WindowState;                     // 0 Normal, 1 Maximized, 2 Fullscreen
UIWizard.DisableWindowSizing = false;
```

Close is not UI Wizard's job -- SMP already has `fb.Exit()`.

**Consequences for the design.** The top bar becomes the caption: give
`SetCaptionAreaSize` the strip's rectangle so dragging it moves the window, and
exclude the button areas so a click on close does not start a drag. The window
controls the mockup draws on the right of the strip then become real, and the
native title bar goes away, which is what the mockup has always assumed.

### Installed and working (2026-08-18)

`foo_ui_wizard` **0.2.8**, x64 build, at
`~/Music/foobar2000-caelestia/profile/user-components-x64/foo_ui_wizard/foo_ui_wizard.dll`.
The `.fb2k-component` is a zip inside a zip and ships both architectures; take
`x64/foo_ui_wizard.dll`. **foobar must be closed to install it** -- the DLL is
locked while running. Verified loaded by checking the process module list, not
by looking at Preferences.

**The frame style is set in PREFERENCES, not from script.** Preferences >
Display > UI Wizard > Appearance > Frame = **No Caption**. Confirmed by reading
`GWL_STYLE`: `0x16CF0000` before (WS_CAPTION present) -> `0x96070000` after
(absent). A preference is persistent, survives a panel reload and has no timing
problem, so it is the better owner. That page also holds Caption area
(Left, Top, Width, Height), defaulting to `0, 0, 9999, 5` -- which confirms the
argument order of `SetCaptionAreaSize`.

**The COM object must be acquired LAZILY, and this was the whole difficulty.**
A single `new ActiveXObject('UIWizard')` at panel load **fails silently**: the
window controls simply never appear. UI Wizard does not register its ProgID in
the registry -- `HKCU\Software\Classes\UIWizard` does not exist, and the DLL
contains the string `MyCOM::HookCLSIDFromProgID`. It **hooks the API call**
instead, so the ProgID only resolves once the component has initialised, which
is after panel scripts are evaluated during startup. `topbar.js` retries on a
500ms timer, up to 20 times, and paints the controls the moment it succeeds.

**Verified live**, not inferred: clicking minimise gives `IsIconic == true`,
clicking maximise gives `IsZoomed == true`, and clicking it again returns to
normal. Close uses `fb.Exit()` and needs no component at all.

**The drag region is only the 8px rim above the bar** (`SetCaptionAreaSize(0, 0,
TW, INSET.t)`). A caption area behaves as caption, so anything inside it drags
the window rather than reaching the panel -- covering the whole strip would kill
the menus, the transport buttons and the seek bar at once. This window is
normally tiled by komorebi anyway, where dragging to move does not apply.

**What UI Wizard does NOT fix.** It has no bearing on the Columns UI splitter
colour (that is drawn by Columns UI, not by the window frame) or on
library-to-playlist drag and drop (that needs the panels merged into one). It
solves the frameless window and nothing else on the list.

### And then it was REVERTED (same day, user's call)

It worked, and it was still the wrong trade: **moving the window became too
fiddly to live with.** A caption area behaves as caption, so anything inside it
drags the window instead of reaching the panel -- which forced the drag region
down to the 8px rim above the bar and nothing more. An 8px target that komorebi
is simultaneously trying to tile is not a usable way to move a window.

Current state:

- **Frame is back to `Default`** in Preferences > Display > UI Wizard. Verified:
  `GWL_STYLE` returned to `0x97CF0000`, WS_CAPTION present.
- **The component stays installed** but inert. Changing that one dropdown to
  `No Caption` brings the frameless window straight back.
- **`topbar.js` no longer draws window controls** and no longer touches COM. The
  card, the shape-drawn buttons and the lazy-acquire helper are all recoverable
  from commit `c168bda`.

**`foobar2000.exe` was added to komorebi's ignore list** at the same time and for
the same reason -- with the window floating free rather than tiled, dragging it
by its native title bar behaves normally. Applied both ways, the same dual
approach the border colours use: `komorebic ignore-rule exe foobar2000.exe` at
runtime (no restart), and persisted into `~/komorebi.json`'s `ignore_rules`
(parse-mutate-serialize, temp-file-then-rename, count verified after write).
Backup at `~/komorebi.json.bak-before-foobar-ignore`. **Note this matches BOTH
foobar instances by exe name**, so the user's live player floats too, which is
the intent. Install into the DUPLICATE profile only.

## The visualiser is cut

Nine designs were built and compared in `foobar2000/mockup-visualizer.html`, V6
oscilloscope was chosen, and the whole feature was then **cut** -- there is no
audio source for it. SMP has no audio API at all, and the only PCM route on this
machine belongs to the `foo_uie_webview` host, which is a different panel type
and was never tested. Rather than ship a visualiser fed by a fake signal, it is
gone from `mockup-layout.html`.

`mockup-visualizer.html` is KEPT rather than deleted, the same way this project
keeps the unwired `tacky-borders.yaml` template: the comparison harness and the
nine designs are recoverable the moment a real PCM source exists.

## Drag and drop works, and the playlist panel is now an SMP PACKAGE

Library-to-playlist drag and drop is live. It does NOT need the two panels
merged into one -- an earlier claim in this file that it did was wrong.

**Source side, `explorer.js`.** `fb.DoDragDrop(window.ID, handle_list, effect)`
starts a real OLE drag out of a panel. A press becomes a drag only past a 5px
slop threshold, so an ordinary click still expands a folder. No special panel
configuration is needed to START a drag.

**Target side, `playlist.js`.** `on_drag_enter/over/leave/drop`. The action
object carries `Base`, `Effect`, `Playlist`, `ToSelect` and `IsInternal`;
setting `Playlist` and `Base` decides where the items land, and SMP performs
the insert itself. Dropping on a tab targets that playlist and appends instead,
without switching the view away from the list being arranged.

**THE PART THAT BLOCKS EVERYTHING: a panel only receives drops if it is a
PACKAGE.** `on_drag_*` never fires otherwise -- the drag shows a no-drop cursor
and nothing in the script runs, which looks exactly like a bug in the handlers
and is not one. The switch is Configure panel > Package tab > Panel behaviour >
"Drag-n-drop support", and that whole tab only appears once the script source is
a package. It persists as `"enableDragDrop": true` in the package's
`package.json`.

**How the panel is wired now:**

```
profile/foo_spider_monkey_panel/packages/{2E378163-F294-4F57-A2C5-8D1FFE198AEE}/
    package.json   -- "name": "Caelestia Playlist", "enableDragDrop": true
    main.js        -- the one-line bootstrap, include()ing profile/caelestia/playlist.js
```

`Deploy-Panels.ps1` is UNCHANGED and still writes `profile/caelestia/playlist.js`;
the package's `main.js` only bootstraps it. `explorer.js` and `topbar.js` remain
in-memory panels, because only the DROP TARGET has to be a package.

**Switching a panel's script source DESTROYS its script**, with a warning that
means it literally. The bootstrap now lives in `foobar2000/smp/bootstrap.js` --
recovered out of SMP's own editor immediately before making that switch, and it
existed nowhere else on disk or in this repo.

**Verified live:** dragging ARCAEA out of the library shows foobar's own drag
image reading "20 tracks", the cursor reads "+ Copy" over the playlist, a 2px
accent line marks the insertion point between rows, and on release all 20 tracks
land at that position -- selected, with the pre-existing item still at the top.

## What is genuinely unfinished

Establish this yourself rather than trusting this list — it is inferred from
files on disk, not from the previous agent, which cannot be asked:

1. Whether the webview panel is actually **wired into the duplicate install's
   Columns UI layout** and pointed at these files, or whether `mockup.html` is
   still only a standalone design.
2. A **screenshot of the result running inside foobar2000** — item 4 of the
   report above. A mockup rendered in a browser is not that, and this project's
   house rule is that looking at the real thing is the only proof.
