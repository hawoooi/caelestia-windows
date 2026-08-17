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
var scroll = 0, hoverRow = -1, hoverTab = -1;
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
    drawList(gr, c);
    drawCols(gr, c);
    drawTabs(gr, c);
    drawFooter(gr, c);
}

function tabRects() {
    var out = [], x = IN.l + 6;
    for (var i = 0; i < plman.PlaylistCount; i++) {
        var name = plman.GetPlaylistName(i);
        var w = gTabW(name);
        out.push({ i: i, name: name, x: x, w: w });
        x += w + 3;
    }
    return out;
}
function gTabW(name) { return (name.length * 7) + 24; }   // 0xProto is monospace

function drawTabs(gr, c) {
    // own ground, extended DOWN by the radius so the card's TOP corners stay
    // round while this fill's own bottom edge hides inside the card
    fillRound(gr, c.x, c.y, c.w, G.tabsH + G.cardR, G.cardR, THEME.surface_container);
    gr.FillSolidRect(c.x, colsY() - 1, c.w, 1, THEME.rule);

    var tabs = tabRects();
    for (var t = 0; t < tabs.length; t++) {
        var tb = tabs[t];
        var active = (tb.i === plman.ActivePlaylist);
        var y = tabsY() + 6;
        if (active)              fillRound(gr, tb.x, y, tb.w, 22, G.radius, THEME.surface_container_high);
        else if (t === hoverTab) fillRound(gr, tb.x, y, tb.w, 22, G.radius, THEME.surface_container_high);
        gr.GdiDrawText(tb.name, active ? f_bold : f_ui,
                       active ? THEME.on_surface : THEME.on_surface_variant,
                       tb.x, y, tb.w, 22, DT_ROW_C);
    }
}

function drawCols(gr, c) {
    var y = colsY();
    gr.FillSolidRect(c.x, y, c.w, G.colsH, THEME.surface_container);
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

function on_mouse_move(x, y) {
    var r = rowAt(x, y);
    if (r >= 0 && items[r].kind !== 'track') r = -1;
    var t = tabAt(x, y);
    if (r !== hoverRow || t !== hoverTab) { hoverRow = r; hoverTab = t; window.Repaint(); }
}
function on_mouse_leave() { hoverRow = -1; hoverTab = -1; window.Repaint(); }

function on_mouse_wheel(step) {
    var next = clamp(scroll - step * G.rowH * 3, 0, maxScroll());
    if (next !== scroll) { scroll = next; window.Repaint(); }
}

function on_mouse_lbtn_down(x, y) {
    var t = tabAt(x, y);
    if (t >= 0) { plman.ActivePlaylist = t; scroll = 0; buildItems(); return; }
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
