// =============================================================================
// foobar2000 / Caelestia — PLAYLIST panel for Spider Monkey Panel (x64).
//
// ONE CARD, CUT BY HAIRLINES — the mockup's structure, drawn in one panel:
//
//     ┌ tabs ───────────────────────────────────────────┐
//     ├─────────────────────────────────────────────────┤
//     │ ART   #   TITLE / TRACK ARTIST   PLAYS   TIME   │
//     ├─────────────────────────────────────────────────┤
//     │ cover │ artist · year · album                   │
//     │       │ #  title                    plays  time │
//     │ ...                                             │
//     ├─────────────────────────────────────────────────┤
//     │ now playing                    facts   [ cover ]│
//     └─────────────────────────────────────────────────┘
//
// Putting the now-playing strip INSIDE this card rather than in a separate
// full-width panel is what the mockup asks for, and it means the bottom bar is
// only as wide as the playlist. It also removes a panel from the layout.
//
// WHY SMP AND NOT HTML
// foo_uie_webview cannot read per-item metadata, so an HTML playlist can only
// list file paths. Here fb.TitleFormat().EvalWithMetadbs() returns an array for
// the whole playlist in one call, and handles.CalcTotalDuration() gives the
// playlist total the WebView could not compute at all.
//
// COLOURS: zero literals. Every colour is THEME.<role> from theme.js, generated
// from palette.json — the same substitution point the CSS panels use.
// =============================================================================

'use strict';

var DT = {
    LEFT: 0x0, RIGHT: 0x2, CENTER: 0x1, VCENTER: 0x4,
    SINGLELINE: 0x20, NOPREFIX: 0x800, END_ELLIPSIS: 0x8000
};
var DT_ROW   = DT.SINGLELINE | DT.VCENTER | DT.NOPREFIX | DT.END_ELLIPSIS;
var DT_ROW_R = DT_ROW | DT.RIGHT;
var DT_ROW_C = DT_ROW | DT.CENTER;

// Geometry — the numbers the HTML mockup settled on, so the two agree.
// Geometry — macOS Finder list view: a section header per album, then compact
// banded rows whose columns line up across every group. The previous layout put
// a 56px cover column in front of every row, which pushed titles far to the
// right and left a dead gap in the middle of each line. Finder puts the icon in
// the header and lets the rows be dense.
var G = {
    // Backgrounds are SQUARE for now, by request; radius is spent only where it
    // marks something -- a highlight or a tab. Two separate values so the two
    // can never drift back into one.
    cardR:      0,   // panel/card/header/footer backgrounds
    tabR:       8,   // the tabs, which keep theirs
    listPad:   12,
    radius:     5,
    tabsH:     28,
    colsH:     20,
    colsDy:     2,   // header labels sit 2px low: see drawCols
    footH:     52,
    footPad:    7,
    scrollW:    9
};
// ------------------------------------------------------- the flat table ----
// The album section headers are GONE. This library is almost entirely one-track
// albums -- Porter Robinson, kmoe, kmoe, Drake, Post Malone, 8485, kuru and
// underscores each contribute one -- so a header per album put a header above
// nearly every row and roughly doubled the line count. That is what made the
// old view feel noisy. Finder's list view is a flat table with a column per
// attribute; the album is right there on the row, so grouping earns nothing.
//
// Row shape: #, cover, Title over Artist, Album, Type, Time. Stacking title and
// artist is what pays for the wide columns -- the two facts that always travel
// together take one column instead of two, so Album gets real room instead of
// being crushed to an ellipsis.
G.rowH   = 34;
G.artPx  = 26;
G.artR   = 4;    // the cover's own corners -- see roundArt
G.titleH = 15;   // the two stacked lines, tight enough that the pair sits
G.artH   = 13;   // optically centred rather than floating high

var COL = { num: 26, art: 26, type: 50, time: 46, gap: 10 };

// A field with nothing in it still gets a mark, so the row keeps its shape and
// an empty value reads as "none" rather than as something failing to render.
var DASH = '—';

// ---------------------------------------------------------- the tab strip --
G.tabBtnW  = 26;    // the + and folder controls at the left of the strip
G.tabBtnGap = 2;
G.tabSepW  = 13;    // rule between the controls and the first tab
G.tabW     = 150;   // the shared flex basis every tab gets
G.tabGap   = 2;
// EVERY TAB HAS THE SAME GEOMETRY, and only the fill differs. Inactive tabs
// used to be shorter and to sit a pixel clear of the card, so hovering one drew
// a fully rounded pill floating above the strip -- a shape no tab ever actually
// has, which is what made the hover feel detached. Now hover paints the SAME
// shape the active tab has, just dimmer: it previews what clicking would do.
G.tabActive = 26;   // bottom edge lands on colsY(), which is what makes it merge
G.tabPad   = 10;    // inside a tab
G.tabX     = 18;    // the close affordance

// Font Awesome v4 codepoints -- the only range 0xProto Nerd Font carries.
var GT = {
    plus:   String.fromCharCode(0xF067),
    folder: String.fromCharCode(0xF07B),
    times:  String.fromCharCode(0xF00D),
    list:   String.fromCharCode(0xF03A)
};

// The scratch playlist library activation lands in. It is PINNED: no close
// button, and a folder glyph instead, because it is understood to be scratch
// and is the one tab whose contents get replaced without asking.
var LIBRARY_PLAYLIST = 'Library';

// Saved playlists live beside the scripts, as .m3u8 -- UTF-8, so a name like
// "1.07 - Naul (나얼) - 바람기억.flac" round-trips. Plain
// .m3u is written in the system ANSI code page and mangles exactly that.
function playlistDir() { return fb.ProfilePath + 'caelestia-playlists\\'; }

// GAPS: every panel paints its own margin, so a SHARED edge gets both panels'
// margins while an OUTER edge gets only one. Symmetric insets therefore give
// 8px between panels but 4px at the window edge. Per-side instead: outer sides
// take the full gap, shared sides take half, and every gap comes out at 8px.
// Which sides are outer is a property of OUR layout, so it is stated, not
// detected -- SMP does not expose a panel's position within the window.
// SHARED-side insets are 2px, not 4, because a grabbable Columns UI splitter
// sits between panels: 2 + 4 (divider) + 2 = the same 8px gap every other edge
// has. Divider width 0 looks cleaner but makes panels impossible to resize --
// there is nothing to grab -- so 4px of it is the price of a draggable split.
var IN = { l: 2, t: 2, r: 8, b: 8 };   // shared edges 2, per the 2+4+2=8 above

var f_ui, f_bold, f_small, f_lab, f_np, f_npSub;
var items = [], handles = null, playlistIdx = -1;
var scroll = 0, hoverRow = -1, hoverTab = -1, hoverBtn = -1;

// ------------------------------------------------------- tab reordering ----
// A press on a tab becomes a REORDER past a slop threshold, the same rule the
// library uses to tell a click from a drag. Below the threshold the press is
// still just a tab switch, so ordinary clicking is unaffected.
//
// The dragged tab follows the cursor and an accent line marks where it will
// land. The line sits in the GAP between two tabs rather than on one of them,
// for the same reason the playlist's drop indicator does: a highlighted tab
// would say "swap with this", and the operation is an insert.
var tabPress = null;   // {t, x} while the button is down on a tab
var tabDrag  = null;   // {from, grabX, dx, target} once it has become a drag
var TAB_SLOP = 6;

// Dragging a ROW to reorder it, which is a different gesture from dragging a
// TAB and from receiving an OLE drop, so it gets its own state rather than
// overloading either.
//
// It is deliberately NOT an OLE drag (fb.DoDragDrop). An OLE drag is the right
// tool for moving tracks BETWEEN panels, where the receiving side has to be
// told what arrived; reordering happens entirely inside one playlist, and
// routing it through OLE would mean the panel dropping onto itself and then
// working out that the source was itself. Plain mouse state is simpler and has
// no such ambiguity.
var rowPress = null;   // {i, idx, y, wasSelected} while the button is down on a row
var rowDrag  = false;  // true once that press has moved far enough to be a drag
var ROW_SLOP = 5;      // px before a click becomes a drag; below a row's height
var DRAG_EDGE = 24;    // distance from the list edge that starts auto-scrolling
var art = {}, artPending = {};
var npArt = null, npKey = '';
var totalText = '';
var W = 0, H = 0;

var TF_GROUPKEY = fb.TitleFormat('%album artist% - [%album%]');

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ------------------------------------------------------------ card regions --

function card()   { return { x: IN.l, y: IN.t, w: W - IN.l - IN.r, h: H - IN.t - IN.b }; }
function tabsY()  { return IN.t; }
// No +1 here. That leftover offset left a 1px band of window ground between the
// active tab's bottom edge and the top of the column header, which read as a
// gap the tab was floating above rather than merging into.
function colsY()  { return IN.t + G.tabsH; }
function listY()  { return colsY() + G.colsH + 1; }
function footY()  { return H - IN.b - G.footH; }
function listH()  { return Math.max(0, footY() - 1 - listY()); }

function contentH() { return items.length ? items[items.length - 1].y + items[items.length - 1].h + G.listPad : 0; }
function maxScroll() { return Math.max(0, contentH() - listH()); }

// -------------------------------------------------------------- data build --

function buildItems() {
    items = []; art = {}; artPending = {};
    playlistIdx = plman.ActivePlaylist;
    if (playlistIdx < 0) { window.Repaint(); return; }

    handles = plman.GetPlaylistItems(playlistIdx);
    var n = handles.Count;

    // The playlist total: available here, and NOT obtainable from the WebView
    // host object at all -- summing lengths needs per-item metadata.
    totalText = n ? (n + '  items  ·  ' + utils.FormatDuration(handles.CalcTotalDuration())) : 'empty';

    if (!n) { window.Repaint(); return; }

    // One batch call per field. Evaluating per row is what makes a naive SMP
    // playlist crawl once the list is long.
    var f = function (spec) { return fb.TitleFormat(spec).EvalWithMetadbs(handles); };
    var album   = f('%album artist% - [%album%]');   // the ART cache key
    var albumN  = f('[%album%]');
    var title   = f('%title%');
    var artist  = f('[%artist%]');
    // Type, where the reference had "date added". $ext gives the container, not
    // the codec: an .m4a stays M4A instead of becoming "AAC", which is what the
    // filename says and therefore what the user recognises.
    var type    = f('$upper($ext(%path%))');
    var length  = f('%length%');

    // The index is zero-padded to a FIXED width for the whole playlist: 2
    // digits normally, 3 once it reaches 100. Padding to a fixed width keeps the
    // column a clean right-aligned block instead of a ragged edge that shifts
    // when the list crosses 9 or 99.
    var pad = Math.max(2, String(n).length);

    var y = G.listPad;
    for (var i = 0; i < n; i++) {
        var num = String(i + 1);
        while (num.length < pad) num = '0' + num;
        items.push({
            kind: 'track', y: y, h: G.rowH, index: i, key: album[i],
            band: (i & 1),
            num: num, title: title[i] || '?', artist: artist[i] || '',
            album: albumN[i] || '', type: type[i] || '', time: length[i]
        });
        y += G.rowH;
    }
    scroll = clamp(scroll, 0, maxScroll());
    window.Repaint();
}

// NOTE: utils.GetAlbumArtAsync, NOT fb.GetAlbumArtAsync. The bundled JSDoc
// cross-references it on `fb` twice, which is a documentation bug.
function requestArt(item) {
    if (art[item.key] !== undefined || artPending[item.key]) return;
    artPending[item.key] = true;
    utils.GetAlbumArtAsync(window.ID, handles[item.index], 0);
}

// Covers are PRE-SCALED once, on arrival, and the thumbnail is what gets
// cached. Drawing a full-resolution cover (commonly 1000x1000) scaled down to
// 39px on every frame cost ~152 ms per repaint -- measured with fb.CreateProfiler,
// not guessed, and it was the entire reason scrolling felt laggy. Resizing once
// makes the per-frame cost a straight blit.
var ART_PX = G.artPx;                 // 34 -- the cover on a track row
var NP_PX  = G.footH;                 // 52 -- the now-playing cover, full-bleed

function requestNowPlayingArt() {
    if (!fb.IsPlaying) { npArt = null; npKey = ''; return; }
    var h = fb.GetNowPlaying();
    if (!h) return;
    var k = TF_GROUPKEY.EvalWithMetadb(h);
    if (k === npKey) return;          // only re-request when the album changes
    npKey = k;
    npArt = null;
    utils.GetAlbumArtAsync(window.ID, h, 0);
}

// ROUNDED COVERS. DrawImage draws a rectangle and GdiGraphics has no clipping
// region, so the corners cannot be cut at paint time -- which is why the real
// covers had hard square corners while the missing-art placeholders, drawn with
// FillRoundRect, were rounded. The fix is to round the BITMAP: build a stencil
// and punch it into the alpha channel with ApplyMask.
//
// Done once, next to the resize, so it costs nothing per frame. Fail-soft: if
// ApplyMask is missing from this SMP build the square cover is still returned
// rather than losing the art entirely.
//
// The two mask values are an alpha stencil, NOT theme colours -- ApplyMask reads
// only luminance. Built arithmetically so no colour literal appears in a panel.
var MASK_KEEP = 255 * 16777216;                                    // opaque black
var MASK_DROP = MASK_KEEP + 255 * 65536 + 255 * 256 + 255;         // opaque white

function roundArt(img, size, r) {
    if (!img) return null;
    try {
        var mask = gdi.CreateImage(size, size);
        var mg = mask.GetGraphics();
        mg.FillSolidRect(0, 0, size, size, MASK_DROP);
        mg.SetSmoothingMode(2);
        mg.FillRoundRect(0, 0, size - 1, size - 1, r, r, MASK_KEEP);
        mg.SetSmoothingMode(0);
        mask.ReleaseGraphics(mg);
        var out = img.ApplyMask(mask);
        return out ? out : img;
    } catch (e) { return img; }
}

function on_get_album_art_done(handle, art_id, image, image_path) {
    var key = TF_GROUPKEY.EvalWithMetadb(handle);
    // 7 = HighQualityBicubic. Worth it here precisely because it happens once.
    art[key] = image ? roundArt(image.Resize(ART_PX, ART_PX, 7), ART_PX, G.artR) : null;
    if (key === npKey) npArt = image ? image.Resize(NP_PX, NP_PX, 7) : null;
    delete artPending[key];
    window.Repaint();
}

// -------------------------------------------------------------------- paint --

function fillRound(gr, x, y, w, h, r, colour) {
    if (w <= 0 || h <= 0) return;
    var rr = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
    gr.SetSmoothingMode(2);
    if (rr < 1) gr.FillSolidRect(x, y, w, h, colour);
    else        gr.FillRoundRect(x, y, w, h, rr, rr, colour);
    gr.SetSmoothingMode(0);
}

function on_paint(gr) {
    // the panel's own margin is painted surface, so the gap between panels
    // reads as the desktop ground rather than as Columns UI's splitter grey
    gr.FillSolidRect(0, 0, W, H, THEME.surface);
    var c = card();
    fillRound(gr, c.x, c.y, c.w, c.h, G.cardR, THEME.surface_container);
    gr.SetTextRenderingHint(5);

    // ORDER MATTERS. The list is scrollable, so a row that is only partly
    // inside the list region still gets drawn -- there is no clipping region in
    // GdiGraphics. Every fixed band is therefore painted AFTER the list and
    // fills its own ground, or scrolled rows bleed into the header and footer.
    // That was a real bug twice: "01 sunder" over "ART # TITLE / TRACK ARTIST".
    // Tabs BEFORE cols. The tab strip has to repaint its band as window ground,
    // and the card's rounded top now belongs to the column header directly
    // below it -- so cols must land last of the two or the strip's rounding
    // wipes the header text it sits on. That bug ate the whole "# TITLE ...
    // PLAYS TIME" row the first time round.
    drawList(gr, c);
    drawTabs(gr, c);
    drawCols(gr, c);
    drawFooter(gr, c);
}

// The two controls at the LEFT end of the strip. They act on the SET of
// playlists rather than on any one of them, which is why they sit before the
// first tab rather than after the last.
function tabBtnRects() {
    var c = card(), x = c.x + 6, y = tabsY() + Math.floor((G.tabsH - 22) / 2);
    return [
        { id: 'new',  x: x,                              y: y, w: G.tabBtnW, h: 22 },
        { id: 'open', x: x + G.tabBtnW + G.tabBtnGap,    y: y, w: G.tabBtnW, h: 22 }
    ];
}
function tabsStartX() {
    var b = tabBtnRects();
    return b[1].x + b[1].w + G.tabSepW;
}

// EVERY TAB IS THE SAME WIDTH, the way Sublime and VS Code do it: one shared
// basis, shrinking equally when crowded. Sizing each tab to its own label makes
// the strip ragged AND moves every tab's position whenever a playlist is
// renamed, so a click can land on the wrong one after a rename.
function tabRects() {
    var c = card(), n = plman.PlaylistCount;
    if (n <= 0) return [];
    var x0 = tabsStartX();
    var avail = (c.x + c.w - 6) - x0;
    var w = Math.min(G.tabW, Math.floor((avail - (n - 1) * G.tabGap) / n));
    w = Math.max(56, w);
    var out = [];
    for (var i = 0; i < n; i++) {
        var name = plman.GetPlaylistName(i);
        out.push({
            i: i, name: name, w: w,
            x: x0 + i * (w + G.tabGap),
            pinned: (name === LIBRARY_PLAYLIST)
        });
    }
    return out;
}

function drawTabs(gr, c) {
    // CHROME'S TRICK: the strip sits on the window GROUND, and only the active
    // tab is raised to the card's own colour with no bottom radius, so tab and
    // list read as one continuous object. That is why this fills surface first
    // and then re-rounds the card's top -- the card was already painted square
    // to the panel's top edge by on_paint.
    gr.FillSolidRect(c.x, c.y, c.w, colsY() - c.y, THEME.surface);

    var btns = tabBtnRects();
    for (var b = 0; b < btns.length; b++) {
        var bt = btns[b];
        if (b === hoverBtn) fillRound(gr, bt.x, bt.y, bt.w, bt.h, G.radius, THEME.stripe);
        gr.GdiDrawText(bt.id === 'new' ? GT.plus : GT.folder, f_ui,
                       b === hoverBtn ? THEME.on_surface : THEME.outline,
                       bt.x, bt.y, bt.w, bt.h, DT_ROW_C);
    }
    var sx = btns[1].x + btns[1].w + Math.floor(G.tabSepW / 2);
    gr.FillSolidRect(sx, tabsY() + 9, 1, G.tabsH - 18, THEME.rule);

    var tabs = tabRects();
    for (var t = 0; t < tabs.length; t++) {
        var tb = tabs[t];
        var active = (tb.i === plman.ActivePlaylist);
        var hot = (t === hoverTab);
        // Bottom edge lands exactly on colsY(), so a filled tab and the header
        // band below it are continuous -- that flush join IS the merge.
        var ty = tabsY() + (G.tabsH - G.tabActive), th = G.tabActive;
        var tx0 = tb.x + (tabDrag && tabDrag.from === t ? tabDrag.dx : 0);

        // extended past the card edge so only the TOP corners come out round
        if (active)   fillRound(gr, tx0, ty, tb.w, th + G.tabR, G.tabR, THEME.surface_container);
        else if (hot) fillRound(gr, tx0, ty, tb.w, th + G.tabR, G.tabR, THEME.stripe);

        // a tab being dragged ONTO lights up and takes an accent underline, so
        // the target is unambiguous even when it is the active tab
        if (t === dropTab) {
            fillRound(gr, tx0, ty, tb.w, th + G.tabR, G.tabR, THEME.surface_container_high);
            gr.FillSolidRect(tx0, ty + th - 2, tb.w, 2, THEME.primary);
        }
        // the hairline between two unfilled neighbours, as Chrome draws it
        if (!active && !hot && t > 0 &&
            tabs[t - 1].i !== plman.ActivePlaylist && (t - 1) !== hoverTab) {
            gr.FillSolidRect(tb.x - 1, ty + 6, 1, th - 12, THEME.rule);
        }

        var tx = tx0 + G.tabPad, tw = tb.w - G.tabPad * 2;
        if (tb.pinned) {
            gr.GdiDrawText(GT.folder, f_small, THEME.outline, tx, ty, 12, th,
                           DT.SINGLELINE | DT.VCENTER | DT.NOPREFIX);
            tx += 16; tw -= 16;
        } else if (active || hot) {
            gr.GdiDrawText(GT.times, f_small, THEME.outline,
                           tx0 + tb.w - G.tabX, ty, 12, th, DT_ROW_C);
            tw -= G.tabX - G.tabPad;
        }
        gr.GdiDrawText(tb.name, active ? f_bold : f_ui,
                       active ? THEME.on_surface : THEME.on_surface_variant,
                       tx, ty, Math.max(10, tw), th, DT_ROW);
    }

    // Where a reorder will drop: a line in the GAP between two tabs, not a
    // highlight on one. A highlighted tab would read as "swap with this"; the
    // operation is an insert, and the gap is where the tab actually goes.
    if (tabDrag && tabs.length) {
        var g = tabs[tabDrag.target];
        var gx = (tabDrag.target > tabDrag.from) ? g.x + g.w : g.x;
        var gy = tabsY() + (G.tabsH - G.tabActive);
        gr.FillSolidRect(gx - 1, gy, 2, G.tabActive, THEME.primary);
    }
}

function drawCols(gr, c) {
    var y = colsY();
    // The card's rounded TOP corners live here, because this band is the top of
    // the card now that the tab strip above it is painted as window ground.
    // Extended past its own height so only the top corners come out round.
    fillRound(gr, c.x, y, c.w, G.colsH + G.cardR, G.cardR, THEME.surface_container);
    gr.FillSolidRect(c.x, listY() - 1, c.w, 1, THEME.rule);
    // The labels sit colsDy lower than centre. A line box reserves descender
    // space whether or not the glyphs use it, and these are all-caps with no
    // descenders at all, so a mathematically centred label reads as high --
    // the same effect that made the stacked row text float.
    var m = metrics(c), ty = y + G.colsDy, th = G.colsH - G.colsDy;
    gr.GdiDrawText('#',     f_lab, THEME.outline, m.numX,   ty, COL.num,  th, DT_ROW_R);
    gr.GdiDrawText('TITLE', f_lab, THEME.outline, m.textX,  ty, m.titleW, th, DT_ROW);
    gr.GdiDrawText('ALBUM', f_lab, THEME.outline, m.albumX, ty, m.albumW, th, DT_ROW);
    gr.GdiDrawText('TYPE',  f_lab, THEME.outline, m.typeX,  ty, COL.type, th, DT_ROW);
    gr.GdiDrawText('TIME',  f_lab, THEME.outline, m.timeX,  ty, COL.time, th, DT_ROW_R);
}

// One place that decides where every column lives, used by the header, the
// rows and the hit-testing alike -- so they cannot drift apart.
//
// Title and Album share the leftover width 1.7 : 1.2, the ratio the mockup
// settled on: Album needs enough room to be read rather than merely present,
// and Title carries two stacked lines so it needs the larger share.
function metrics(c) {
    var left  = c.x + G.listPad;
    var right = c.x + c.w - G.listPad - G.scrollW;
    var numX  = left;
    var artX  = numX + COL.num + COL.gap;
    var textX = artX + COL.art + COL.gap;
    var timeX = right - COL.time;
    var typeX = timeX - COL.gap - COL.type;
    var flex   = Math.max(80, typeX - COL.gap - textX);
    var titleW = Math.floor(flex * 0.58);
    var albumX = textX + titleW + COL.gap;
    return {
        left: left, right: right,
        numX: numX, artX: artX, textX: textX, titleW: titleW,
        albumX: albumX, albumW: Math.max(30, typeX - COL.gap - albumX),
        typeX: typeX, timeX: timeX
    };
}

function drawList(gr, c) {
    var top = listY(), avail = listH();
    if (!items.length) {
        gr.GdiDrawText('Playlist is empty', f_ui, THEME.outline,
                       c.x + G.listPad, top, c.w - G.listPad * 2, avail,
                       DT.SINGLELINE | DT.VCENTER | DT.NOPREFIX | DT.CENTER);
        return;
    }

    var playingIdx = -1;
    if (plman.PlayingPlaylist === playlistIdx) playingIdx = plman.GetPlayingItemLocation().PlaylistItemIndex;

    var m = metrics(c);
    var rowX = m.left, rowW = m.right + G.scrollW - m.left;

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var y = top + it.y - scroll;
        if (y + it.h < top) continue;
        if (y > top + avail) break;

        var isPlaying  = (it.index === playingIdx);
        var isSelected = plman.IsPlaylistItemSelected(playlistIdx, it.index);

        // Finder's banding first, then hover, then selection on top. The band is
        // deliberately almost invisible; it is there to guide the eye across a
        // wide row, not to be seen as a colour.
        if (isSelected)          fillRound(gr, rowX, y, rowW, it.h, G.radius, THEME.raised_hover);
        else if (i === hoverRow) fillRound(gr, rowX, y, rowW, it.h, G.radius, THEME.surface_container_high);
        else if (it.band)        gr.FillSolidRect(rowX, y, rowW, it.h, THEME.stripe);

        var cTitle = isPlaying ? THEME.primary : THEME.on_surface;
        var fTitle = isPlaying ? f_bold : f_ui;

        gr.GdiDrawText(it.num, f_ui, isPlaying ? THEME.primary : THEME.outline,
                       m.numX, y, COL.num, it.h, DT_ROW_R);

        // cover. Cached per ALBUM, not per track, so a 20-track album loads one
        // image; requested only for rows actually on screen.
        requestArt(it);
        var img = art[it.key];
        var ay = y + Math.floor((it.h - COL.art) / 2);
        if (img) gr.DrawImage(img, m.artX, ay, COL.art, COL.art, 0, 0, img.Width, img.Height);
        else     fillRound(gr, m.artX, ay, COL.art, COL.art, G.artR, THEME.surface_container_high);

        // Title over Artist. The pair is centred as a BLOCK: the two line
        // heights are set tight rather than left at the font's default leading,
        // which reserved more descender space than the glyphs used and made the
        // pair sit visibly high against the cover beside it.
        var blockH = G.titleH + G.artH;
        var by = y + Math.floor((it.h - blockH) / 2);
        gr.GdiDrawText(it.title, fTitle, cTitle, m.textX, by, m.titleW, G.titleH, DT_ROW);
        // An empty artist still gets a mark. Drawing nothing leaves the row a
        // different shape from its neighbours and reads as a rendering failure
        // rather than as a track with no artist tag.
        gr.GdiDrawText(it.artist || DASH, f_small,
                       it.artist ? THEME.on_surface_variant : THEME.outline,
                       m.textX, by + G.titleH, m.titleW, G.artH, DT_ROW);

        gr.GdiDrawText(it.album || DASH, f_ui,
                       it.album ? THEME.on_surface_variant : THEME.outline,
                       m.albumX, y, m.albumW, it.h, DT_ROW);
        // Type is plain dimmed text, not a badge: a badge would give the
        // container more visual weight than the track title, and in a library
        // this FLAC-heavy it would tile the whole column in one colour.
        gr.GdiDrawText(it.type, f_small, THEME.outline, m.typeX, y, COL.type, it.h, DT_ROW);
        gr.GdiDrawText(it.time, f_small, isPlaying ? THEME.primary : THEME.on_surface_variant,
                       m.timeX, y, COL.time, it.h, DT_ROW_R);
    }

    // THE DROP INDICATOR: a line BETWEEN rows, not a highlight ON one. A
    // highlighted row says "replace this"; a line in the gap says "insert here",
    // which is what actually happens.
    if (dropAt >= 0) {
        var dy = top - scroll + (dropAt < items.length
                                 ? items[dropAt].y
                                 : items[items.length - 1].y + items[items.length - 1].h);
        if (!items.length) dy = top + G.listPad;
        if (dy >= top && dy <= top + avail) {
            gr.FillSolidRect(rowX, dy - 1, rowW, 2, THEME.primary);
        }
    }

    var total = contentH();
    if (total > avail) {
        var thumbH = Math.max(28, avail * avail / total);
        var ms = maxScroll();
        var ty = top + (avail - thumbH) * (ms > 0 ? scroll / ms : 0);
        fillRound(gr, c.x + c.w - G.scrollW - 2, ty, G.scrollW - 4, thumbH, 3, THEME.track);
    }
}

function drawFooter(gr, c) {
    var y = footY(), h = G.footH;
    requestNowPlayingArt();

    fillRound(gr, c.x, y - G.cardR, c.w, h + G.cardR, G.cardR, THEME.surface_container);
    gr.FillSolidRect(c.x, y - 1, c.w, 1, THEME.rule);

    var cs = h;
    var cx = c.x + c.w - cs, cy = y;
    if (npArt) gr.DrawImage(npArt, cx, cy, cs, cs, 0, 0, npArt.Width, npArt.Height);
    else       gr.FillSolidRect(cx, cy, cs, cs, THEME.surface_container_high);

    // THE SPLIT MATTERS. Identity is left-aligned and the facts are
    // right-aligned; drawing both into the SAME rect (which is what happened
    // before) makes them collide in the middle as soon as either is long --
    // "Post Malone . Hollywood's Bleeding" ran straight through "1520 kbps".
    // Give each its own half with a gap between.
    var pad = G.listPad;
    var avail = c.w - cs - pad * 2;
    var factsW = Math.min(300, Math.floor(avail * 0.42));
    var idW    = avail - factsW - 16;
    var tx = c.x + pad;
    var fx = tx + idW + 16;

    // BOTH lines are always drawn, on both sides. Leaving the second line out
    // when nothing is playing made the footer change height by eye and read as
    // half-rendered; a dash says "nothing here" and keeps the block's shape.
    var y1 = y + G.footPad, h1 = 20;
    var y2 = y1 + h1,       h2 = 18;

    if (fb.IsPlaying) {
        gr.GdiDrawText(fb.TitleFormat('%title%').Eval(), f_np, THEME.on_surface,
                       tx, y1, idW, h1, DT_ROW);
        var sub = fb.TitleFormat('[%artist%][   %album%]').Eval();
        gr.GdiDrawText(sub || DASH, f_npSub,
                       sub ? THEME.on_surface_variant : THEME.outline, tx, y2, idW, h2, DT_ROW);
    } else {
        gr.GdiDrawText('Nothing playing', f_np, THEME.on_surface_variant, tx, y1, idW, h1, DT_ROW);
        gr.GdiDrawText(DASH, f_npSub, THEME.outline, tx, y2, idW, h2, DT_ROW);
    }

    gr.GdiDrawText(plman.GetPlaylistName(playlistIdx) + '   ' + totalText,
                   f_small, THEME.on_surface_variant, fx, y1, factsW, h1, DT_ROW_R);
    var fmt = fb.IsPlaying
        ? fb.TitleFormat('[%codec%][   %bitrate% kbps][   %samplerate% Hz]').Eval() : '';
    gr.GdiDrawText(fmt || DASH, f_small, THEME.outline, fx, y2, factsW, h2, DT_ROW_R);
}




// -------------------------------------------------------------------- input --

function rowAt(x, y) {
    if (y < listY() || y > footY()) return -1;
    var yy = y - listY() + scroll;
    for (var i = 0; i < items.length; i++) {
        if (yy >= items[i].y && yy < items[i].y + items[i].h) return i;
    }
    return -1;
}
function tabAt(x, y) {
    if (y < tabsY() || y > tabsY() + G.tabsH) return -1;
    var tabs = tabRects();
    for (var t = 0; t < tabs.length; t++) {
        if (x >= tabs[t].x && x < tabs[t].x + tabs[t].w) return t;
    }
    return -1;
}
// Which insertion gap the dragged tab's CENTRE currently falls in.
function tabTargetAt(centreX) {
    var tabs = tabRects();
    for (var i = 0; i < tabs.length; i++) {
        if (centreX < tabs[i].x + tabs[i].w / 2) return i;
    }
    return tabs.length - 1;
}

function tabBtnAt(x, y) {
    var b = tabBtnRects();
    for (var i = 0; i < b.length; i++) {
        if (x >= b[i].x && x < b[i].x + b[i].w && y >= b[i].y && y < b[i].y + b[i].h) return i;
    }
    return -1;
}
// the close affordance occupies the tab's right end -- pinned tabs have none
function onTabClose(tb, x) { return !tb.pinned && x >= tb.x + tb.w - G.tabX; }

// ------------------------------------------------------ saved playlists ----
// .m3u8, not .m3u: the 8 means UTF-8. Plain .m3u is written in the system ANSI
// code page, so a real file in this library -- "1.07 - Naul (나얼) -
// 바람기억.flac" -- comes back mangled or unresolvable.
//
// The file is written and parsed HERE rather than handed to foobar as a
// location. Letting foobar resolve a playlist file works, but it puts the
// format and the failure modes outside our control for no gain; a playlist is
// one path per line.
function savedPlaylists() {
    try {
        var g = utils.Glob(playlistDir() + '*.m3u8');
        return g ? g : [];
    } catch (e) { return []; }
}
function baseName(p) {
    var s = p.lastIndexOf('\\'), d = p.lastIndexOf('.');
    return p.substring(s + 1, d > s ? d : p.length);
}

function savePlaylist(idx) {
    var name = plman.GetPlaylistName(idx);
    var hl = plman.GetPlaylistItems(idx);
    var paths = fb.TitleFormat('%path%').EvalWithMetadbs(hl);
    var lines = ['#EXTM3U'];
    for (var i = 0; i < paths.length; i++) lines.push(paths[i]);
    try {
        utils.CreateFolder(playlistDir());
    } catch (e) { /* already there */ }
    // NO BOM -- the third argument is the BOM flag and it must stay false.
    // The repo's house rule aside, this file is parsed by loadPlaylist below,
    // and a BOM makes the first line "﻿#EXTM3U", which no longer starts
    // with '#', so the header would be taken for a track path.
    var ok = false;
    try { ok = utils.WriteTextFile(playlistDir() + name + '.m3u8', lines.join('\r\n'), false); } catch (e2) { ok = false; }
    return ok;
}

function loadPlaylist(path) {
    var txt = '';
    try { txt = utils.ReadTextFile(path, 65001); } catch (e) { return; }
    if (!txt) return;
    // Strip a leading BOM defensively: we do not write one, but a .m3u8 saved
    // by another player very likely does, and it would turn the "#EXTM3U"
    // header into something that no longer starts with '#'.
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);
    var raw = txt.split(/\r?\n/), locs = [];
    for (var i = 0; i < raw.length; i++) {
        var s = raw[i].replace(/^\s+|\s+$/g, '');
        if (s.length && s.charAt(0) !== '#') locs.push(s);
    }
    if (!locs.length) return;
    var name = baseName(path);
    var idx = -1;
    for (var p = 0; p < plman.PlaylistCount; p++) {
        if (plman.GetPlaylistName(p) === name) { idx = p; break; }
    }
    if (idx < 0) idx = plman.CreatePlaylist(plman.PlaylistCount, name);
    plman.ClearPlaylist(idx);
    plman.AddLocations(idx, locs, true);
    plman.ActivePlaylist = idx;
}

// A NATIVE popup, not a drawn flyout. A panel cannot paint outside its own
// window, so a drawn menu would be clipped by the tab strip; the top bar's
// File/Edit menus are native for the same reason, so this is consistent rather
// than a compromise.
function showPlaylistMenu(x, y) {
    var files = savedPlaylists();
    var m = window.CreatePopupMenu();
    if (files.length) {
        for (var i = 0; i < files.length; i++) m.AppendMenuItem(0, 100 + i, baseName(files[i]));
        m.AppendMenuSeparator();
    } else {
        m.AppendMenuItem(1, 99, 'No saved playlists');   // 1 = MF_GRAYED
        m.AppendMenuSeparator();
    }
    m.AppendMenuItem(0, 1, 'Save "' + plman.GetPlaylistName(plman.ActivePlaylist) + '"');
    m.AppendMenuItem(0, 2, 'Open from file…');
    var r = m.TrackPopupMenu(x, y);
    if (r >= 100)      loadPlaylist(files[r - 100]);
    else if (r === 1)  savePlaylist(plman.ActivePlaylist);
    else if (r === 2)  fb.RunMainMenuCommand('File/Load playlist...');
    window.Repaint();
}

function on_mouse_move(x, y, mask) {
    if (tabDrag) {
        tabDrag.dx = x - tabDrag.grabX;
        var tabs = tabRects();
        var src = tabs[tabDrag.from];
        tabDrag.target = tabTargetAt(src.x + tabDrag.dx + src.w / 2);
        window.Repaint(); return;
    }
    if (tabPress && (mask & 1) && Math.abs(x - tabPress.x) > TAB_SLOP) {
        tabDrag = { from: tabPress.t, grabX: tabPress.x, dx: x - tabPress.x, target: tabPress.t };
        tabPress = null;
        window.Repaint(); return;
    }

    // Row reorder. The threshold is vertical only: this list scrolls
    // vertically and reorders vertically, so horizontal wander during a click
    // should not arm a drag.
    if (rowPress && !rowDrag && (mask & 1) && Math.abs(y - rowPress.y) > ROW_SLOP) {
        rowDrag = true;
    }
    if (rowDrag) {
        // Reuses dropAt -- the SAME indicator the OLE drop path draws, because
        // it means the same thing to the user: "the tracks land in this gap".
        // A second, separate indicator would be two visual languages for one
        // idea.
        dropAt = dropIndexAt(y);

        // Auto-scroll when dragging at the edges, or a track can never be
        // moved past the visible window. Driven by mouse movement rather than
        // a timer: a timer would have to be created, cleared on every exit
        // path (drop, leave, panel reload) and would keep firing if any one of
        // those was missed. The cost is that the list only advances while the
        // pointer is actually moving, which in practice it is.
        if (y < listY() + DRAG_EDGE)      scroll = clamp(scroll - G.rowH, 0, maxScroll());
        else if (y > footY() - DRAG_EDGE) scroll = clamp(scroll + G.rowH, 0, maxScroll());

        window.Repaint(); return;
    }
    var r = rowAt(x, y);
    if (r >= 0 && items[r].kind !== 'track') r = -1;
    var t = tabAt(x, y), b = tabBtnAt(x, y);
    if (r !== hoverRow || t !== hoverTab || b !== hoverBtn) {
        hoverRow = r; hoverTab = t; hoverBtn = b; window.Repaint();
    }
}
function on_mouse_leave() {
    hoverRow = -1; hoverTab = -1; hoverBtn = -1; tabPress = null;
    // Abandon an in-flight reorder rather than leaving dropAt painted and
    // rowDrag armed -- the next unrelated click would otherwise finish a drag
    // the user thought they had cancelled.
    if (rowDrag || rowPress) { rowDrag = false; rowPress = null; dropAt = -1; }
    window.Repaint();
}

function on_mouse_wheel(step) {
    var next = clamp(scroll - step * G.rowH * 3, 0, maxScroll());
    if (next !== scroll) { scroll = next; window.Repaint(); }
}

function on_mouse_lbtn_down(x, y) {
    var b = tabBtnAt(x, y);
    if (b === 0) {
        var n = plman.CreatePlaylist(plman.PlaylistCount, '');   // '' = foobar names it
        plman.ActivePlaylist = n; scroll = 0; buildItems(); return;
    }
    if (b === 1) {
        var br = tabBtnRects()[1];
        showPlaylistMenu(br.x, br.y + br.h);
        return;
    }

    var t = tabAt(x, y);
    if (t >= 0) {
        var tabs = tabRects();
        if (onTabClose(tabs[t], x)) {
            plman.RemovePlaylist(tabs[t].i);
            scroll = 0; buildItems(); return;
        }
        // switch immediately, as Chrome does, and remember the press in case
        // this turns out to be a reorder rather than a click
        tabPress = { t: t, x: x };
        plman.ActivePlaylist = tabs[t].i; scroll = 0; buildItems(); return;
    }
    var i = rowAt(x, y);
    if (i < 0 || items[i].kind !== 'track') return;
    var idx = items[i].index;

    // A press INSIDE an existing selection must not collapse it here, or a
    // multi-row drag would be impossible: mouse-down would throw away every
    // row but the one under the cursor before the drag had even started. The
    // collapse still happens, just on mouse-UP and only if no drag occurred --
    // which is what Explorer and Finder both do, and the same
    // "keep the selection if the press is inside it" rule on_mouse_rbtn_up
    // already uses.
    var wasSelected = plman.IsPlaylistItemSelected(playlistIdx, idx);
    if (!wasSelected) {
        plman.ClearPlaylistSelection(playlistIdx);
        plman.SetPlaylistSelectionSingle(playlistIdx, idx, true);
    }
    plman.SetPlaylistFocusItem(playlistIdx, idx);
    rowPress = { i: i, idx: idx, y: y, wasSelected: wasSelected };
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    if (tabDrag) {
        var from = tabRects()[tabDrag.from].i;
        var to   = tabRects()[tabDrag.target].i;
        tabDrag = null;
        if (from !== to) plman.MovePlaylist(from, to);
        buildItems(); window.Repaint(); return;
    }
    tabPress = null;

    if (rowDrag) {
        var gap = dropAt;
        rowDrag = false; rowPress = null; dropAt = -1;
        applyReorder(gap);
        buildItems(); window.Repaint(); return;
    }
    if (rowPress) {
        // The click that did NOT become a drag. Collapsing here rather than on
        // mouse-down is what makes dragging a multi-row selection possible at
        // all -- see the comment in on_mouse_lbtn_down.
        if (rowPress.wasSelected) {
            plman.ClearPlaylistSelection(playlistIdx);
            plman.SetPlaylistSelectionSingle(playlistIdx, rowPress.idx, true);
        }
        rowPress = null;
        window.Repaint();
    }
}

function on_mouse_lbtn_dblclk(x, y) {
    var i = rowAt(x, y);
    if (i < 0 || items[i].kind !== 'track') return;
    plman.ExecutePlaylistDefaultAction(playlistIdx, items[i].index);
}

// ---------------------------------------------------------- context menu --
// Without an on_mouse_rbtn_up that returns TRUE, SMP shows its own panel menu
// -- Reload / Edit panel script / Configure panel -- which is a developer menu,
// not something a listener ever wants. Returning true suppresses it; the menu
// built here is foobar's REAL track context menu, the same one the stock
// playlist view offers, so every component that adds entries to it still works.
function on_mouse_rbtn_up(x, y, mask) {
    var i = rowAt(x, y);
    if (i < 0 || items[i].kind !== 'track') return true;   // still suppress the dev menu

    // Right-clicking OUTSIDE the selection selects that row first, the way every
    // list does -- otherwise the menu silently acts on something else.
    if (!plman.IsPlaylistItemSelected(playlistIdx, items[i].index)) {
        plman.ClearPlaylistSelection(playlistIdx);
        plman.SetPlaylistSelectionSingle(playlistIdx, items[i].index, true);
        plman.SetPlaylistFocusItem(playlistIdx, items[i].index);
        window.Repaint();
    }

    var handles = plman.GetPlaylistSelectedItems(playlistIdx);
    if (!handles || !handles.Count) return true;

    var menu = window.CreatePopupMenu();
    var cmm = fb.CreateContextMenuManager();
    cmm.InitContext(handles);
    cmm.BuildMenu(menu, 1, -1);
    var ret = menu.TrackPopupMenu(x, y);
    if (ret > 0) cmm.ExecuteByID(ret - 1);
    return true;
}

// ------------------------------------------------------------ drop target --
// The library panel starts a real OLE drag with fb.DoDragDrop, so this receives
// it like any other drop source -- the two panels do NOT have to be merged for
// this to work, which is what the project record used to claim.
//
// The action object carries Base, Effect, Playlist, ToSelect and IsInternal;
// setting Playlist and Base is what tells foobar where the items land, and SMP
// performs the insert itself.
var DROP_NONE = 0, DROP_COPY = 1;
var dropAt = -1;      // insertion index within the list, -1 = not dropping here
var dropTab = -1;     // a tab being hovered instead, -1 = none

// The insertion point is the nearest row BOUNDARY, not the row under the
// cursor: a drop lands between two tracks, and the indicator has to say which
// gap it will land in.
function dropIndexAt(y) {
    if (!items.length) return 0;
    var yy = y - listY() + scroll;
    for (var i = 0; i < items.length; i++) {
        if (yy < items[i].y + items[i].h / 2) return i;
    }
    return items.length;
}

// Move the current selection into the gap the drag ended in.
//
// plman.MovePlaylistSelection takes a DELTA, not a destination, so the gap has
// to be converted -- and the conversion has to discount the selected rows that
// currently sit ABOVE the gap, because they vacate their positions as part of
// the same move. Without that discount, dragging downward always overshoots by
// the size of the selection.
//
// Worked through: with A B C D and B selected (index 1), dropping in the gap
// before D is gap 3; one selected row lies above it, so delta = 3 - 1 - 1 = 1,
// giving A C B D. Dropping at the very top is gap 0 with none above, so
// delta = 0 - 0 - 1 = -1, giving B A C D.
//
// Counting rows above the gap rather than assuming the selection is contiguous
// keeps this correct for a disjoint selection too, which the list cannot
// currently produce (no ctrl/shift click yet) but will.
function applyReorder(gap) {
    if (gap < 0 || !items.length) return;

    var sel = [];
    for (var i = 0; i < items.length; i++) {
        if (plman.IsPlaylistItemSelected(playlistIdx, items[i].index)) sel.push(items[i].index);
    }
    if (!sel.length) return;

    var above = 0;
    for (var k = 0; k < sel.length; k++) { if (sel[k] < gap) above++; }
    var delta = gap - above - sel[0];
    if (delta === 0) return;

    // foobar's own undo stack, so Ctrl+Z reverses a mis-drop. A reorder is
    // destructive to the user's arrangement and is exactly the kind of thing
    // people undo.
    plman.UndoBackup(playlistIdx);
    plman.MovePlaylistSelection(playlistIdx, delta);
}

function updateDrop(x, y) {
    if (y < colsY()) {                       // over the tab strip
        var t = tabAt(x, y);
        dropTab = t; dropAt = -1;
        return t >= 0;
    }
    dropTab = -1;
    dropAt = dropIndexAt(y);
    return true;
}

function on_drag_enter(action, x, y, mask) {
    action.Effect = updateDrop(x, y) ? DROP_COPY : DROP_NONE;
    window.Repaint();
}
function on_drag_over(action, x, y, mask) {
    var wasAt = dropAt, wasTab = dropTab;
    action.Effect = updateDrop(x, y) ? DROP_COPY : DROP_NONE;
    if (dropAt !== wasAt || dropTab !== wasTab) window.Repaint();
}
function on_drag_leave() { dropAt = -1; dropTab = -1; window.Repaint(); }

function on_drag_drop(action, x, y, mask) {
    updateDrop(x, y);
    if (dropTab >= 0) {
        // Dropped on a tab: append to THAT playlist and leave the view where it
        // is. Switching to it would hide the list the user was arranging.
        var tabs = tabRects();
        var pl = tabs[dropTab].i;
        action.Playlist = pl;
        action.Base = plman.PlaylistItemCount(pl);
    } else {
        action.Playlist = playlistIdx;
        action.Base = dropAt < 0 ? 0 : dropAt;
    }
    action.ToSelect = true;
    action.Effect = DROP_COPY;
    dropAt = -1; dropTab = -1;
    window.Repaint();
}

// ------------------------------------------------------------------ events --

function on_size() { W = window.Width; H = window.Height; scroll = clamp(scroll, 0, maxScroll()); }
function on_playlist_switch()          { scroll = 0; buildItems(); }
function on_playlist_items_added()     { buildItems(); }
function on_playlist_items_removed()   { buildItems(); }
function on_playlist_items_reordered() { buildItems(); }
function on_playlists_changed()        { buildItems(); }
function on_playlist_item_ensure_visible() { window.Repaint(); }
function on_item_focus_change()        { window.Repaint(); }
function on_selection_changed()        { window.Repaint(); }
function on_playback_new_track()       { npKey = ''; requestNowPlayingArt(); window.Repaint(); }
function on_playback_stop()            { npArt = null; npKey = ''; window.Repaint(); }
function on_playback_dynamic_info_track() { window.Repaint(); }

// -------------------------------------------------------------------- init --

// One typeface, matching the rest of the desktop. 0xProto has no CJK cut, so
// Japanese and Korean fall through to the system face — a fallback, not a
// second choice.
f_ui    = gdi.Font('0xProto Nerd Font', 12, 0);
f_bold  = gdi.Font('0xProto Nerd Font', 12, 1);
f_small = gdi.Font('0xProto Nerd Font', 11, 0);
f_lab   = gdi.Font('0xProto Nerd Font', 11, 0);
f_np    = gdi.Font('0xProto Nerd Font', 13, 1);
f_npSub = gdi.Font('0xProto Nerd Font', 12, 0);

W = window.Width; H = window.Height;
buildItems();
