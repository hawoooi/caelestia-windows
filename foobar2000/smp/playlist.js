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
    cardR:      8,   // = the Windows 11 window corner radius
    rowH:      24,   // a track row: compact, Finder-dense
    hdrH:      30,   // an album section header
    hdrArt:    24,   // the cover in that header
    hdrGap:    10,
    rowPad:     8,   // permanent, so highlighting shifts nothing
    listPad:   12,
    groupGap:  12,   // above a header, except the first
    radius:     5,
    tabsH:     34,
    colsH:     26,
    footH:     72,
    scrollW:    9
};
// Track text starts where the header text starts, so the two align.
G.textX = G.listPad + G.hdrArt + G.hdrGap;
var COL = { num: 32, plays: 44, time: 46, gap: 10 };

// ---------------------------------------------------------- the tab strip --
G.tabBtnW  = 26;    // the + and folder controls at the left of the strip
G.tabBtnGap = 2;
G.tabSepW  = 13;    // rule between the controls and the first tab
G.tabW     = 150;   // the shared flex basis every tab gets
G.tabGap   = 2;
G.tabInact = 26;    // inactive tab height; the active one runs to the card edge
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
var IN = { l: 3, t: 3, r: 8, b: 8 };

var f_ui, f_bold, f_small, f_lab, f_np, f_npSub;
var items = [], handles = null, playlistIdx = -1;
var scroll = 0, hoverRow = -1, hoverTab = -1, hoverBtn = -1;
var art = {}, artPending = {};
var npArt = null, npKey = '';
var totalText = '';
var W = 0, H = 0;

var TF_GROUPKEY = fb.TitleFormat('%album artist% - [%album%]');

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ------------------------------------------------------------ card regions --

function card()   { return { x: IN.l, y: IN.t, w: W - IN.l - IN.r, h: H - IN.t - IN.b }; }
function tabsY()  { return IN.t; }
function colsY()  { return IN.t + G.tabsH + 1; }
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
    var album   = f('%album artist% - [%album%]');
    var artist  = f('[%album artist%]');
    var albumN  = f('[%album%]');
    var year    = f('[$year(%date%)]');
    var track   = f('[%tracknumber%]');
    var title   = f('%title%');
    var tArtist = f("$if($strcmp(%artist%,%album artist%),,[%artist%])");
    var plays   = f('[%play_count%]');
    var length  = f('%length%');

    var y = G.listPad, lastKey = null, band = 0;
    for (var i = 0; i < n; i++) {
        var key = album[i];
        if (key !== lastKey) {
            if (lastKey !== null) y += G.groupGap;
            items.push({ kind: 'group', y: y, h: G.hdrH, index: i, key: key,
                         artist: artist[i] || '?', album: albumN[i] || '', year: year[i] || '' });
            y += G.hdrH; lastKey = key;
        }
        // `band` runs across the WHOLE list, not per group, so the striping
        // reads as one continuous table the way Finder's does.
        items.push({ kind: 'track', y: y, h: G.rowH, index: i, key: key, band: (band++ & 1),
                     num: track[i], title: title[i], tArtist: tArtist[i],
                     plays: plays[i], time: length[i] });
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
var ART_PX = G.hdrArt;                // 24 -- the cover in a section header
var NP_PX  = G.footH;                 // 72 -- the now-playing cover

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

function on_get_album_art_done(handle, art_id, image, image_path) {
    var key = TF_GROUPKEY.EvalWithMetadb(handle);
    // 7 = HighQualityBicubic. Worth it here precisely because it happens once.
    art[key] = image ? image.Resize(ART_PX, ART_PX, 7) : null;
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
        var ty, th;
        if (active) {
            ty = tabsY() + (G.tabsH - 30); th = 30;
            // extended past the card edge so only its TOP corners show round
            fillRound(gr, tb.x, ty, tb.w, th + G.cardR, G.cardR, THEME.surface_container);
        } else {
            ty = tabsY() + (G.tabsH - G.tabInact) - 2; th = G.tabInact;
            if (hot) fillRound(gr, tb.x, ty, tb.w, th, G.cardR, THEME.stripe);
            // the hairline between two inactive neighbours, as Chrome draws it
            if (t > 0 && !hot && tabs[t - 1].i !== plman.ActivePlaylist) {
                gr.FillSolidRect(tb.x - 1, ty + 6, 1, th - 12, THEME.rule);
            }
        }

        var tx = tb.x + G.tabPad, tw = tb.w - G.tabPad * 2;
        if (tb.pinned) {
            gr.GdiDrawText(GT.folder, f_small, THEME.outline, tx, ty, 12, th,
                           DT.SINGLELINE | DT.VCENTER | DT.NOPREFIX);
            tx += 16; tw -= 16;
        } else if (active || hot) {
            gr.GdiDrawText(GT.times, f_small, THEME.outline,
                           tb.x + tb.w - G.tabX, ty, 12, th, DT_ROW_C);
            tw -= G.tabX - G.tabPad;
        }
        gr.GdiDrawText(tb.name, active ? f_bold : f_ui,
                       active ? THEME.on_surface : THEME.on_surface_variant,
                       tx, ty, Math.max(10, tw), th, DT_ROW);
    }
}

function drawCols(gr, c) {
    var y = colsY();
    // The card's rounded TOP corners live here, because this band is the top of
    // the card now that the tab strip above it is painted as window ground.
    // Extended past its own height so only the top corners come out round.
    fillRound(gr, c.x, y, c.w, G.colsH + G.cardR, G.cardR, THEME.surface_container);
    gr.FillSolidRect(c.x, listY() - 1, c.w, 1, THEME.rule);
    var m = metrics(c);
    gr.GdiDrawText('#',     f_lab, THEME.outline, m.numX,   y, COL.num,   G.colsH, DT_ROW_R);
    gr.GdiDrawText('TITLE', f_lab, THEME.outline, m.titleX, y, m.titleW,  G.colsH, DT_ROW);
    gr.GdiDrawText('PLAYS', f_lab, THEME.outline, m.playsX, y, COL.plays, G.colsH, DT_ROW_R);
    gr.GdiDrawText('TIME',  f_lab, THEME.outline, m.timeX,  y, COL.time,  G.colsH, DT_ROW_R);
}

// One place that decides where every column lives, used by the header, the
// rows and the hit-testing alike -- so they cannot drift apart.
function metrics(c) {
    var right = c.x + c.w - G.listPad - G.scrollW;
    var timeX  = right - COL.time;
    var playsX = timeX - COL.gap - COL.plays;
    var numX   = c.x + G.textX;
    var titleX = numX + COL.num + COL.gap;
    return {
        left: c.x + G.listPad, right: right,
        numX: numX, titleX: titleX, playsX: playsX, timeX: timeX,
        titleW: Math.max(40, playsX - COL.gap - titleX)
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

        if (it.kind === 'group') {
            requestArt(it);
            var img = art[it.key];
            var ax = c.x + G.listPad, ay = y + Math.floor((G.hdrH - G.hdrArt) / 2);
            if (img) gr.DrawImage(img, ax, ay, G.hdrArt, G.hdrArt, 0, 0, img.Width, img.Height);
            else     fillRound(gr, ax, ay, G.hdrArt, G.hdrArt, 4, THEME.surface_container_high);

            // artist in full, then year and album dimmed after it
            var gx = c.x + G.textX, gw = m.right - gx;
            var aw = Math.min(gr.CalcTextWidth(it.artist, f_bold), gw);
            gr.GdiDrawText(it.artist, f_bold, THEME.on_surface, gx, y, aw, it.h, DT_ROW);
            var rest = '';
            if (it.year)  rest += '   ' + it.year;
            if (it.album) rest += '   ' + it.album;
            if (rest && aw < gw) {
                gr.GdiDrawText(rest, f_ui, THEME.on_surface_variant, gx + aw, y, gw - aw, it.h, DT_ROW);
            }
            continue;
        }

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

        gr.GdiDrawText(it.num, f_small, isPlaying ? THEME.primary : THEME.outline,
                       m.numX, y, COL.num, it.h, DT_ROW_R);
        gr.GdiDrawText(it.title, fTitle, cTitle, m.titleX, y, m.titleW, it.h, DT_ROW);
        if (it.tArtist) {
            var tw = gr.CalcTextWidth(it.title, fTitle);
            if (tw + 24 < m.titleW) {
                gr.GdiDrawText('   ' + it.tArtist, f_ui, THEME.outline,
                               m.titleX + tw, y, m.titleW - tw, it.h, DT_ROW);
            }
        }
        gr.GdiDrawText(it.plays, f_small, THEME.outline, m.playsX, y, COL.plays, it.h, DT_ROW_R);
        gr.GdiDrawText(it.time, f_small, isPlaying ? THEME.primary : THEME.on_surface_variant,
                       m.timeX, y, COL.time, it.h, DT_ROW_R);
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

    if (fb.IsPlaying) {
        gr.GdiDrawText(fb.TitleFormat('%title%').Eval(), f_np, THEME.on_surface,
                       tx, y + 14, idW, 22, DT_ROW);
        gr.GdiDrawText(fb.TitleFormat('[%artist%][   %album%]').Eval(), f_npSub,
                       THEME.on_surface_variant, tx, y + 36, idW, 20, DT_ROW);
    } else {
        gr.GdiDrawText('Nothing playing', f_np, THEME.on_surface_variant, tx, y + 14, idW, 22, DT_ROW);
    }

    gr.GdiDrawText(plman.GetPlaylistName(playlistIdx) + '   ' + totalText,
                   f_small, THEME.on_surface_variant, fx, y + 14, factsW, 22, DT_ROW_R);
    if (fb.IsPlaying) {
        gr.GdiDrawText(fb.TitleFormat('[%codec%][   %bitrate% kbps][   %samplerate% Hz]').Eval(),
                       f_small, THEME.outline, fx, y + 36, factsW, 20, DT_ROW_R);
    }
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

function on_mouse_move(x, y) {
    var r = rowAt(x, y);
    if (r >= 0 && items[r].kind !== 'track') r = -1;
    var t = tabAt(x, y), b = tabBtnAt(x, y);
    if (r !== hoverRow || t !== hoverTab || b !== hoverBtn) {
        hoverRow = r; hoverTab = t; hoverBtn = b; window.Repaint();
    }
}
function on_mouse_leave() { hoverRow = -1; hoverTab = -1; hoverBtn = -1; window.Repaint(); }

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
        plman.ActivePlaylist = tabs[t].i; scroll = 0; buildItems(); return;
    }
    var i = rowAt(x, y);
    if (i < 0 || items[i].kind !== 'track') return;
    var idx = items[i].index;
    plman.ClearPlaylistSelection(playlistIdx);
    plman.SetPlaylistSelectionSingle(playlistIdx, idx, true);
    plman.SetPlaylistFocusItem(playlistIdx, idx);
    window.Repaint();
}

function on_mouse_lbtn_dblclk(x, y) {
    var i = rowAt(x, y);
    if (i < 0 || items[i].kind !== 'track') return;
    plman.ExecutePlaylistDefaultAction(playlistIdx, items[i].index);
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
