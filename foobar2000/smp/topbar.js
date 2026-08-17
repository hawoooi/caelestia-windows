// =============================================================================
// foobar2000 / Caelestia — TOP BAR panel for Spider Monkey Panel (x64).
//
// The mockup's one line of chrome: menu, transport, seek and volume together.
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ File Edit View Playback Library Help │ ⏹ ⏮ ▶ ⏭ │ ↻ ⤨ │ 1:42 ══ 2:29 │ 🔊 ══ │
//   └──────────────────────────────────────────────────────────────────────┘
//
// WHY THIS REPLACED THE WEBVIEW VERSION
// foo_uie_webview has no main-menu command API, so its top bar could not host
// File/Edit/View and foobar's own menu strip had to stay above it -- an extra
// band in a fixed grey that no theme setting reaches. SMP has
// window.CreateMainMenuManager(), so the real menus live here and that strip
// can be switched off entirely.
//
// GAPS
// Every panel paints its own margin, so a shared edge gets BOTH panels' margins
// and an outer edge gets only one. Symmetric insets therefore give 8px between
// panels but 4px at the window edge. INSET is per-side instead: outer sides use
// the full gap, shared sides use half, and every gap in the window comes out
// the same. Which sides are outer is a property of OUR layout, so it is stated
// here rather than detected.
//
// COLOURS: zero literals. Every colour is THEME.<role> from theme.js.
// =============================================================================

'use strict';

var DTT = {
    LEFT: 0x0, RIGHT: 0x2, CENTER: 0x1, VCENTER: 0x4,
    SINGLELINE: 0x20, NOPREFIX: 0x800, END_ELLIPSIS: 0x8000
};
var DTT_C = DTT.SINGLELINE | DTT.VCENTER | DTT.NOPREFIX | DTT.CENTER;
var DTT_L = DTT.SINGLELINE | DTT.VCENTER | DTT.NOPREFIX;
var DTT_R = DTT_L | DTT.RIGHT;

var GAP = 8;
// A shared edge is (GAP - DIVIDER) / 2, so two panels meeting produce exactly
// GAP between them -- the same GAP the outer rim uses.
//
// DIVIDER is Columns UI's own splitter, set in Preferences > Layout > Misc. Its
// colour is HARDCODED (#333333) and is not reachable from any colour setting --
// proven by setting both the Global and the Core element to a Custom scheme with
// a surface background and re-measuring: the splitter did not move. Its width is
// also the only drag target for resizing panels, so 0px means an invisible
// divider that CANNOT be resized. 2px is the compromise: a hairline rather than
// a slab, still grabbable. The real fix is to merge the panels into one SMP
// panel and draw our own divider -- see docs/foobar2000-briefing.md.
var DIVIDER = 2;
var INSET = { l: GAP, t: GAP, r: GAP, b: (GAP - DIVIDER) / 2 };
var CARD_R = 8;                                        // = Windows 11 window radius

var T = {
    btnW:     28,
    btnH:     26,
    // "File" must line up with "LIBRARY" in the panel below it. That label is
    // drawn at card.x + 14; here the text sits at card.x + pad + menuPad, so
    // pad + menuPad must stay 14. Both cards use the same 8px outer inset, so
    // the two start at the same 22px from the window edge.
    pad:       8,   // inside the card, left
    menuPad:   6,   // horizontal padding inside a menu label
    // Right padding is NOT pad. The app icon's ink is ~12px inside an 18px box,
    // so it carries ~3px of side bearing; equal INK gaps of 16px need
    // gapR 10 + margin 3 + bearing 3 on the left and bearing 3 + padR 13 on the
    // right. Spacing the boxes evenly instead leaves 18 against 11.
    padR:     13,
    sep:      11,   // width taken by a separator incl. its margins
    // Seekbar option F: at 20px the bar reads as a container rather than a line,
    // which is what lets the clocks live inside it -- and that hands the seekbar
    // back the ~90px the two outside clocks were spending. Radius 2, not a pill:
    // a pill radius is half the thickness, which at 20px is a lozenge.
    barH:     20,
    barR:      2,
    barPad:    8,   // inset of a label drawn inside a bar
    volW:    112,
    iconW:    18,
    gapR:     10    // seek -> volume -> app icon, identical on both sides
};

// Font Awesome v4 codepoints, which 0xProto Nerd Font embeds at U+F000-U+F2E0.
// Escapes, never literal PUA characters -- those mutate across encoding hops.
var GL = {
    stop:  String.fromCharCode(0xF04D),
    prev:  String.fromCharCode(0xF048),
    play:  String.fromCharCode(0xF04B),
    pause: String.fromCharCode(0xF04C),
    next:  String.fromCharCode(0xF051),
    repeat: String.fromCharCode(0xF01E),
    shuffle: String.fromCharCode(0xF074),
    volOn: String.fromCharCode(0xF028),
    volMute: String.fromCharCode(0xF026)
};

var MENUS = ['File', 'Edit', 'View', 'Playback', 'Library', 'Help'];

var f_ui, f_icon, f_small;
var TW = 0, TH = 0;
var hoverBtn = -1, hoverMenu = -1;
var dragging = null;
var seekPos = 0;

function clampT(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function cardT() { return { x: INSET.l, y: INSET.t, w: TW - INSET.l - INSET.r, h: TH - INSET.t - INSET.b }; }

function fillRoundT(gr, x, y, w, h, r, colour) {
    if (w <= 0 || h <= 0) return;
    var rr = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
    gr.SetSmoothingMode(2);
    if (rr < 1) gr.FillSolidRect(x, y, w, h, colour);
    else        gr.FillRoundRect(x, y, w, h, rr, rr, colour);
    gr.SetSmoothingMode(0);
}

function fmtT(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
}

// ------------------------------------------------------------------ layout --
// Computed during paint (where a GdiGraphics exists to measure text with) and
// CACHED, because mouse events have no gr. An earlier version recomputed with
// an estimated character width on every mouse event; the estimate drifted from
// the measured widths, so File happened to work -- it starts at the same x --
// while View and everything right of it did not respond at all. Hit-testing now
// uses the same numbers that were drawn, which is what the code always claimed.
var _layout = null;

function L_current() { return _layout || layout(null); }

function layout(gr) {
    var c = cardT();
    var y = c.y, h = c.h;
    var L = { menus: [], btns: [], c: c };
    var x = c.x + T.pad;

    for (var i = 0; i < MENUS.length; i++) {
        var w = (gr ? gr.CalcTextWidth(MENUS[i], f_ui) : MENUS[i].length * 7) + T.menuPad * 2;
        L.menus.push({ i: i, x: x, w: w, name: MENUS[i] });
        x += w;
    }

    x += T.sep;
    L.sep1 = x - Math.floor(T.sep / 2);
    var ids = ['stop', 'prev', 'play', 'next'];
    for (var b = 0; b < ids.length; b++) { L.btns.push({ id: ids[b], x: x, w: T.btnW }); x += T.btnW; }

    x += T.sep;
    L.sep2 = x - Math.floor(T.sep / 2);
    var ids2 = ['order', 'shuffle'];
    for (var b2 = 0; b2 < ids2.length; b2++) { L.btns.push({ id: ids2[b2], x: x, w: T.btnW }); x += T.btnW; }

    x += T.sep;
    L.sep3 = x - Math.floor(T.sep / 2);

    // Right-anchored: app icon, then volume, then the seek bar takes the rest.
    // There is deliberately NO separator between the seek and volume bars -- the
    // volume bar's own track already separates them, and the rule made the gap
    // on its left 17px against 5px on its right.
    var iconX = c.x + c.w - T.padR - T.iconW;
    var volX  = iconX - T.gapR - T.volW;
    L.icon = { x: iconX, w: T.iconW };
    L.vol  = { x: volX,  w: T.volW };
    L.seek = { x: x, w: Math.max(60, volX - T.gapR - x) };
    return L;
}

// ------------------------------------------------------------------- paint --

// A 20px slab. Returns where the fill reaches, which the inline labels need.
function drawSlab(gr, x, y, w, fill, colFill) {
    var by = y + Math.floor((cardT().h - T.barH) / 2);
    fillRoundT(gr, x, by, w, T.barH, T.barR, THEME.track);
    var fw = Math.round(w * clampT(fill, 0, 1));
    if (fw > 0) fillRoundT(gr, x, by, fw, T.barH, T.barR, colFill);
    return { y: by, h: T.barH, fillR: x + fw };
}

// CONTENT DRAWN INSIDE A BAR NEEDS TWO COLOURS, because it sits on the fill at
// one end of the bar's travel and on the empty track at the other, and one
// colour is unreadable at whichever end it is wrong for.
//
// There is no clipping region in GdiGraphics -- but GdiDrawText clips to the
// rect it is given, and alignment is anchored to one edge of that rect. So the
// same string can be drawn twice at the SAME position and clipped differently:
// move the edge that does NOT anchor the alignment.
//
//   left-aligned  -> anchored at the rect's LEFT, so narrowing the right edge
//                    clips the tail without moving the glyphs
//   right-aligned -> anchored at the rect's RIGHT, so raising the left edge
//                    clips the head without moving the glyphs
function drawInBarLeft(gr, s, font, x, right, fillR, sb) {
    gr.GdiDrawText(s, font, THEME.on_surface_variant, x, sb.y, right - x, sb.h, DTT_L);
    if (fillR > x) gr.GdiDrawText(s, font, THEME.on_primary, x, sb.y, fillR - x, sb.h, DTT_L);
}
function drawInBarRight(gr, s, font, x, right, fillR, sb) {
    gr.GdiDrawText(s, font, THEME.on_primary, x, sb.y, right - x, sb.h, DTT_R);
    if (fillR < right) {
        var l = Math.max(x, fillR);
        gr.GdiDrawText(s, font, THEME.on_surface_variant, l, sb.y, right - l, sb.h, DTT_R);
    }
}

function on_paint(gr) {
    gr.FillSolidRect(0, 0, TW, TH, THEME.surface);
    var c = cardT();
    fillRoundT(gr, c.x, c.y, c.w, c.h, CARD_R, THEME.surface_container);
    gr.SetTextRenderingHint(5);

    var L = layout(gr);
    _layout = L;      // reused by every mouse handler

    for (var i = 0; i < L.menus.length; i++) {
        var m = L.menus[i];
        if (i === hoverMenu) fillRoundT(gr, m.x, c.y + 5, m.w, c.h - 10, 4, THEME.surface_container_high);
        gr.GdiDrawText(m.name, f_ui, i === hoverMenu ? THEME.on_surface : THEME.on_surface_variant,
                       m.x, c.y, m.w, c.h, DTT_C);
    }

    var playing = fb.IsPlaying && !fb.IsPaused;
    for (var b = 0; b < L.btns.length; b++) {
        var bt = L.btns[b];
        var by = c.y + Math.floor((c.h - T.btnH) / 2);
        var on = false, glyph = '';
        if (bt.id === 'stop')       glyph = GL.stop;
        else if (bt.id === 'prev')  glyph = GL.prev;
        else if (bt.id === 'play')  glyph = playing ? GL.pause : GL.play;
        else if (bt.id === 'next')  glyph = GL.next;
        else if (bt.id === 'order') { glyph = GL.repeat;  on = plman.PlaybackOrder === 1 || plman.PlaybackOrder === 2; }
        else if (bt.id === 'shuffle') { glyph = GL.shuffle; on = plman.PlaybackOrder >= 3; }

        if (b === hoverBtn || on) fillRoundT(gr, bt.x + 1, by, bt.w - 2, T.btnH, 4, THEME.surface_container_high);
        // play/pause leads by being brighter, not by being filled -- the teal is
        // already spoken for by the seek fill beside it
        var col = (bt.id === 'play') ? THEME.on_surface
                : (b === hoverBtn || on) ? THEME.on_surface : THEME.on_surface_variant;
        gr.GdiDrawText(glyph, f_icon, col, bt.x, c.y, bt.w, c.h, DTT_C);
    }

    gr.FillSolidRect(L.sep1, c.y + 8, 1, c.h - 16, THEME.rule);
    gr.FillSolidRect(L.sep2, c.y + 8, 1, c.h - 16, THEME.rule);
    gr.FillSolidRect(L.sep3, c.y + 8, 1, c.h - 16, THEME.rule);

    // seek bar, with both clocks inside it
    var len = fb.PlaybackLength || 0;
    var pos = (dragging === 'seek') ? seekPos : (fb.PlaybackTime || 0);
    var sb = drawSlab(gr, L.seek.x, c.y, L.seek.w, len > 0 ? pos / len : 0, THEME.primary);
    var tl = L.seek.x + T.barPad, tr = L.seek.x + L.seek.w - T.barPad;
    drawInBarLeft(gr, fmtT(pos), f_small, tl, tr, sb.fillR, sb);
    if (len > 0) drawInBarRight(gr, fmtT(len), f_small, tl, tr, sb.fillR, sb);

    // volume bar, with its icon inside it. The fill is `outline`, not `primary`,
    // so the icon over it takes surface_container rather than on_primary.
    var vb = drawSlab(gr, L.vol.x, c.y, L.vol.w, dbToPct(fb.Volume), THEME.outline);
    var vx = L.vol.x + T.barPad, vw = 14;
    var muted = fb.Volume <= -100;
    var vg = muted ? GL.volMute : GL.volOn;
    gr.GdiDrawText(vg, f_icon, THEME.on_surface_variant, vx, vb.y, vw, vb.h, DTT_L);
    if (vb.fillR > vx) {
        gr.GdiDrawText(vg, f_icon, THEME.surface_container, vx, vb.y,
                       Math.min(vw, vb.fillR - vx), vb.h, DTT_L);
    }

    // The app mark. Drawn as the real extracted icon rather than a glyph: the
    // Font Awesome ghost is U+F6E2, and 0xProto Nerd Font is Nerd Fonts v3,
    // where Material Design Icons moved to plane 1 and left that codepoint
    // empty -- it renders as tofu. No Font Awesome family is installed system
    // wide either, and GDI cannot use the vendored woff2. Verified by rendering
    // the codepoint, not assumed.
    if (appIcon) {
        var iy = c.y + Math.floor((c.h - T.iconW) / 2);
        gr.DrawImage(appIcon, L.icon.x, iy, T.iconW, T.iconW, 0, 0, appIcon.Width, appIcon.Height);
    }
}

// fb2k reports volume in dBFS: 0 is full, about -100 silence. Below -60 the
// difference is inaudible, so the slider maps that range and nothing wider.
function dbToPct(db) { if (db >= 0) return 1; if (db <= -60) return 0; return (db + 60) / 60; }
function pctToDb(p)  { return -60 + p * 60; }

// ------------------------------------------------------------------- input --

function hitBtn(L, x, y) {
    var c = L.c;
    if (y < c.y || y > c.y + c.h) return -1;
    for (var b = 0; b < L.btns.length; b++) {
        if (x >= L.btns[b].x && x < L.btns[b].x + L.btns[b].w) return b;
    }
    return -1;
}
function hitMenu(L, x, y) {
    var c = L.c;
    if (y < c.y || y > c.y + c.h) return -1;
    for (var i = 0; i < L.menus.length; i++) {
        if (x >= L.menus[i].x && x < L.menus[i].x + L.menus[i].w) return i;
    }
    return -1;
}

function on_mouse_move(x, y) {
    var L = L_current();
    var b = hitBtn(L, x, y), m = hitMenu(L, x, y);
    if (dragging === 'seek') {
        var len = fb.PlaybackLength || 0;
        seekPos = clampT((x - L.seek.x) / L.seek.w, 0, 1) * len;
        window.Repaint(); return;
    }
    if (dragging === 'vol') {
        fb.Volume = pctToDb(clampT((x - L.vol.x) / L.vol.w, 0, 1));
        window.Repaint(); return;
    }
    if (b !== hoverBtn || m !== hoverMenu) { hoverBtn = b; hoverMenu = m; window.Repaint(); }
}
function on_mouse_leave() { hoverBtn = -1; hoverMenu = -1; window.Repaint(); }

function on_mouse_lbtn_down(x, y) {
    var L = L_current(), c = L.c;
    var m = hitMenu(L, x, y);
    if (m >= 0) { showMenu(m, L.menus[m].x, c.y + c.h); return; }

    if (y >= c.y && y <= c.y + c.h) {
        if (x >= L.seek.x && x <= L.seek.x + L.seek.w) {
            dragging = 'seek';
            seekPos = clampT((x - L.seek.x) / L.seek.w, 0, 1) * (fb.PlaybackLength || 0);
            window.Repaint(); return;
        }
        if (x >= L.vol.x && x <= L.vol.x + L.vol.w) {
            dragging = 'vol';
            fb.Volume = pctToDb(clampT((x - L.vol.x) / L.vol.w, 0, 1));
            window.Repaint(); return;
        }
    }

    var b = hitBtn(L, x, y);
    if (b < 0) return;
    var id = L.btns[b].id;
    if (id === 'stop') fb.Stop();
    else if (id === 'prev') fb.Prev();
    else if (id === 'next') fb.Next();
    else if (id === 'play') { if (fb.IsPlaying) fb.PlayOrPause(); else fb.Play(); }
    else if (id === 'order') plman.PlaybackOrder = (plman.PlaybackOrder === 1) ? 0 : 1;
    else if (id === 'shuffle') plman.PlaybackOrder = (plman.PlaybackOrder >= 3) ? 0 : 4;
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    if (dragging === 'seek') { if (fb.PlaybackLength > 0) fb.PlaybackTime = seekPos; }
    dragging = null;
    window.Repaint();
}

function on_mouse_wheel(step) {
    fb.Volume = clampT(fb.Volume + step * 2, -60, 0);
    window.Repaint();
}

// The real File/Edit/View/Playback/Library/Help menus, built by foobar itself.
//
// NOTE THE TWO DIFFERENT OWNERS. It is fb.CreateMainMenuManager() but
// window.CreatePopupMenu() — SMP splits its factory methods across `fb`,
// `window` and `utils` with no rule you can infer, so each one has to be
// checked against the docs. Getting this wrong throws "is not a function" only
// when the menu is first clicked, long after the panel looks fine.
function showMenu(i, x, y) {
    var mm = fb.CreateMainMenuManager();
    mm.Init(MENUS[i].toLowerCase());
    var menu = window.CreatePopupMenu();
    mm.BuildMenu(menu, 1, -1);
    var ret = menu.TrackPopupMenu(x, y);
    if (ret > 0) mm.ExecuteByID(ret - 1);
    // No menu.Dispose() here: MenuObject has no such method in this build and
    // calling it throws AFTER the menu has already worked, which reads as the
    // menu being broken when it is not. It is garbage-collected.
    hoverMenu = -1;
    window.Repaint();
}

// ------------------------------------------------------------------ events --

function on_size() { TW = window.Width; TH = window.Height; }
function on_playback_new_track()   { window.Repaint(); }
function on_playback_stop()        { window.Repaint(); }
function on_playback_pause()       { window.Repaint(); }
function on_playback_seek()        { window.Repaint(); }
function on_playback_time()        { if (dragging !== 'seek') window.Repaint(); }
function on_volume_change()        { window.Repaint(); }
function on_playback_order_changed() { window.Repaint(); }

// -------------------------------------------------------------------- init --

f_ui    = gdi.Font('0xProto Nerd Font', 11, 0);   // menus: 11px, tighter padding
f_icon  = gdi.Font('0xProto Nerd Font', 12, 0);
f_small = gdi.Font('0xProto Nerd Font', 11, 0);

// The app mark, copied next to the scripts by Deploy-Panels.ps1. Loaded once --
// gdi.Image hits the disk, and this is a paint path.
var appIcon = null;
try { appIcon = gdi.Image(fb.ProfilePath + 'caelestia\\foobar-icon.png'); } catch (e) { appIcon = null; }

TW = window.Width; TH = window.Height;
