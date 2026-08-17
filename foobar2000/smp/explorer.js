// =============================================================================
// foobar2000 / Caelestia — LIBRARY EXPLORER panel for Spider Monkey Panel.
//
// The folder tree from the mockup, built from the media library rather than
// from disk: fb.GetLibraryRelativePath(handle) gives each track's path relative
// to the configured library root, which IS foobar's own "by folder structure"
// view. Walking the filesystem instead would show folders foobar does not know
// about and miss nothing useful.
//
// Shape, matching the mockup exactly:
//   * a folder is a raised rounded block with a folder glyph and a track count
//   * a file is a plain indented line, its name aligned with folder names
//   * an open folder's children carry a guide spine down their left, inset
//     --guide-in from the block edge with --guide-out clearance to the right
//
// Icons are U+F07B / U+F07C (folder, folder-open). Those live in Font Awesome
// v4's range, which 0xProto Nerd Font embeds at U+F000-U+F2E0 — so the tree
// gets the same glyphs as the CSS panels with no extra font shipped.
//
// Colours: zero literals. Every colour is THEME.<role> from theme.js.
// =============================================================================

'use strict';

var DTX = {
    LEFT: 0x0, RIGHT: 0x2, VCENTER: 0x4, SINGLELINE: 0x20,
    NOPREFIX: 0x800, END_ELLIPSIS: 0x8000
};
var DTX_ROW = DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX | DTX.END_ELLIPSIS;
var DTX_ROW_R = DTX_ROW | DTX.RIGHT;

// Written as escapes, never as literal private-use characters: a raw PUA glyph
// in a source file survives one encoding hop and silently becomes a different
// codepoint on the next, which reads as a font problem and is not one.
var GLYPH_FOLDER      = String.fromCharCode(0xF07B);   // fa-folder
var GLYPH_FILE        = String.fromCharCode(0xF001);   // fa-music
var GLYPH_FOLDER_OPEN = String.fromCharCode(0xF07C);   // fa-folder-open

var E = {
    rowH:      20,
    pad:       12,   // inside the scroll area
    nodePad:   12,   // inside a node block
    iconW:     13,
    iconGap:    9,
    guideIn:    9,   // block edge -> spine (also the per-level indent)
    guideOut:   8,   // spine -> the blocks it brackets
    radius:     6,
    scrollW:    9,
    gapY:       2    // between node blocks
};
// A file's name must line up with a folder's name at the same level.
E.fileIndent = E.nodePad + E.iconW + E.iconGap;
E.levelIndent = E.guideIn + E.guideOut;

var f_ui, f_bold, f_icon, f_small;
var root = null;          // {name, children:[], files:[], count, open}
var rows = [];            // flattened visible rows
var scrollY = 0;
var hover = -1;
var selected = -1;
var VW = 0, VH = 0;
var building = false;

function clampE(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function contentHeight() { return rows.length ? rows[rows.length - 1].y + E.rowH + E.pad : 0; }
// NOTE: treeH()/cardTop()/cardFoot() are defined further down with the card
// geometry; they are used above only from inside functions, never at load time.
function maxScrollE() { return Math.max(0, contentHeight() - treeH()); }

// ---------------------------------------------------------------- the tree --

function makeNode(name) {
    return { name: name, dirs: {}, dirOrder: [], files: [], count: 0, open: false };
}

// Build the whole tree once from relative paths. This is string work, not I/O,
// so even a large library is cheap; the expensive part (handles) is kept as
// indices into the library list rather than copied.
function buildTree() {
    building = true;
    root = makeNode('');
    var lib = fb.GetLibraryItems();
    var n = lib.Count;
    for (var i = 0; i < n; i++) {
        var rel = fb.GetLibraryRelativePath(lib[i]);
        if (!rel || !rel.length) continue;          // not under a library root
        var parts = rel.split('\\');
        var node = root;
        node.count++;
        for (var p = 0; p < parts.length - 1; p++) {
            var seg = parts[p];
            if (!node.dirs[seg]) { node.dirs[seg] = makeNode(seg); node.dirOrder.push(seg); }
            node = node.dirs[seg];
            node.count++;
        }
        node.files.push({ name: parts[parts.length - 1], index: i });
    }
    sortNode(root);
    building = false;
}

// Folders before files, each case-insensitively by name — the order foobar's
// own folder view uses, so the two do not disagree.
function sortNode(node) {
    node.dirOrder.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    node.files.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    for (var i = 0; i < node.dirOrder.length; i++) sortNode(node.dirs[node.dirOrder[i]]);
}

// Flatten the open parts of the tree into drawable rows, recording for each
// level where its guide spine runs and how far it extends.
function flatten() {
    rows = [];
    var spines = [];
    var y = E.pad;

    function walk(node, depth, indent) {
        var startY = y;
        var kids = 0;
        for (var i = 0; i < node.dirOrder.length; i++) {
            var d = node.dirs[node.dirOrder[i]];
            rows.push({ kind: 'dir', node: d, depth: depth, indent: indent, y: y });
            y += E.rowH + E.gapY;
            kids++;
            if (d.open) walk(d, depth + 1, indent + E.levelIndent);
        }
        for (var j = 0; j < node.files.length; j++) {
            rows.push({ kind: 'file', file: node.files[j], depth: depth, indent: indent, y: y });
            y += E.rowH + E.gapY;
            kids++;
        }
        // record the spine for this level, if it has anything to bracket
        if (depth > 0 && kids) {
            // spine x is absolute, so it must include the card inset the rows use
            spines.push({ x: IN.l + E.pad + indent - E.levelIndent + E.guideIn,
                          y0: startY, y1: y - E.gapY });
        }
    }

    walk(root, 0, 0);
    rows.spines = spines;
    scrollY = clampE(scrollY, 0, maxScrollE());
}

function rebuild() { buildTree(); flatten(); window.Repaint(); }

// -------------------------------------------------------------------- paint --

function fillRoundE(gr, x, y, w, h, r, colour) {
    if (w <= 0 || h <= 0) return;
    var rr = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
    gr.SetSmoothingMode(2);
    if (rr < 1) gr.FillSolidRect(x, y, w, h, colour);
    else        gr.FillRoundRect(x, y, w, h, rr, rr, colour);
    gr.SetSmoothingMode(0);
}

// The card structure the mockup asks for: header / tree / footer, all one
// surface cut by hairlines, inset from the panel edge so the gap between panels
// reads as the desktop ground rather than Columns UI's splitter grey.
// r matches the Windows 11 window corner radius, so the cards agree with the
// frame foobar itself is drawn in.
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
var IN = { l: 8, t: 3, r: 3, b: 8 };
var CARD = { r: 8, headH: 28, footH: 29 };

function cardTop()  { return IN.t + CARD.headH + 1; }
function cardFoot() { return VH - IN.b - CARD.footH; }
function treeH()    { return Math.max(0, cardFoot() - 1 - cardTop()); }

function on_paint(gr) {
    gr.FillSolidRect(0, 0, VW, VH, THEME.surface);
    var cx = IN.l, cy = IN.t, cw = VW - IN.l - IN.r, ch = VH - IN.t - IN.b;
    fillRoundE(gr, cx, cy, cw, ch, CARD.r, THEME.surface_container);
    if (!root) return;
    gr.SetTextRenderingHint(5);



    var top = cardTop();
    var availW = VW - IN.r - E.scrollW;

    // guide spines first, so node blocks sit on top of them
    var sp = rows.spines || [];
    for (var s = 0; s < sp.length; s++) {
        var y0 = sp[s].y0 - scrollY + top, y1 = sp[s].y1 - scrollY + top;
        var bot = cardFoot();
        if (y1 < top || y0 > bot) continue;
        gr.FillSolidRect(sp[s].x, Math.max(y0 + 2, top), 1,
                         Math.max(0, Math.min(y1, bot) - Math.max(y0 + 2, top)), THEME.guide);
    }

    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var y = r.y - scrollY + top;
        if (y + E.rowH < top) continue;
        if (y > cardFoot()) break;

        var x = IN.l + E.pad + r.indent;
        var w = availW - x - E.pad;

        if (r.kind === 'dir') {
            // A folder reads as a raised block, which is what distinguishes it
            // from a file. Its resting tone is already the lightest surface
            // role, so hover/selection has to lift ABOVE it -- hence
            // THEME.raised_hover, pre-blended toward outline.
            var bg = (i === selected || i === hover) ? THEME.raised_hover
                                                     : THEME.surface_container_high;
            fillRoundE(gr, x, y, w, E.rowH, E.radius, bg);

            gr.GdiDrawText(r.node.open ? GLYPH_FOLDER_OPEN : GLYPH_FOLDER, f_icon,
                           THEME.on_surface_variant,
                           x + E.nodePad, y, E.iconW, E.rowH,
                           DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX);

            var nameX = x + E.nodePad + E.iconW + E.iconGap;
            var cntW = 36;
            gr.GdiDrawText(r.node.name, (i === selected) ? f_bold : f_ui, THEME.on_surface,
                           nameX, y, w - (nameX - x) - E.nodePad - cntW, E.rowH, DTX_ROW);
            gr.GdiDrawText(String(r.node.count), f_small, THEME.outline,
                           x + w - E.nodePad - cntW, y, cntW, E.rowH, DTX_ROW_R);
        } else {
            if (i === hover || i === selected) {
                fillRoundE(gr, x, y, w, E.rowH, E.radius, THEME.surface_container_high);
            }
            // A track gets its own glyph in the SAME column a folder's sits in.
            // Without it the icon column was empty for files, so their names
            // read as floating at a different left offset from the folders
            // above them even though the text x was identical.
            gr.GdiDrawText(GLYPH_FILE, f_icon, THEME.outline,
                           x + E.nodePad, y, E.iconW, E.rowH,
                           DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX);
            gr.GdiDrawText(r.file.name, f_ui,
                           (i === hover || i === selected) ? THEME.on_surface : THEME.on_surface_variant,
                           x + E.fileIndent, y, w - E.fileIndent - E.nodePad, E.rowH, DTX_ROW);
        }
    }

    // scrollbar
    var total = contentHeight(), avail = treeH();
    if (total > avail) {
        var thumbH = Math.max(28, avail * avail / total);
        var ms = maxScrollE();
        var ty = top + (avail - thumbH) * (ms > 0 ? scrollY / ms : 0);
        fillRoundE(gr, VW - IN.r - E.scrollW + 2, ty, E.scrollW - 4, thumbH, 3, THEME.track);
    }

    // Header drawn AFTER the tree and painting its own ground: a scrolled row
    // that is only partly inside the tree region still gets drawn (there is no
    // clipping region in GdiGraphics), and would otherwise bleed into it --
    // the same collision that put "01 sunder" over the playlist's column
    // header. Extended DOWN by the radius so the card's TOP corners stay round.
    fillRoundE(gr, cx, cy, cw, CARD.headH + CARD.r, CARD.r, THEME.surface_container);
    gr.GdiDrawText('LIBRARY', f_small, THEME.outline, cx + 14, cy, cw - 28, CARD.headH,
                   DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX);
    gr.FillSolidRect(cx, cardTop() - 1, cw, 1, THEME.rule);

    drawFooterE(gr, cx, cw);
}

// Drawn LAST and painting its own ground: a tree row that straddles the
// boundary would otherwise show through it, which is exactly what happened --
// file names were overlapping "view by folder structure". Extended upward by
// the card radius so the card's BOTTOM corners stay round while this fill's own
// top edge is hidden inside the card.
function drawFooterE(gr, cx, cw) {
    var fy = cardFoot();
    fillRoundE(gr, cx, fy - CARD.r, cw, CARD.footH + CARD.r, CARD.r, THEME.surface_container);
    gr.FillSolidRect(cx, fy - 1, cw, 1, THEME.rule);
    gr.GdiDrawText('view', f_small, THEME.outline, cx + 14, fy, 40, CARD.footH,
                   DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX);
    gr.GdiDrawText('by folder structure', f_ui, THEME.on_surface_variant,
                   cx + 54, fy, cw - 68, CARD.footH,
                   DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX | DTX.END_ELLIPSIS);
}

// -------------------------------------------------------------------- input --

function rowAtE(y) {
    if (y < cardTop() || y > cardFoot()) return -1;
    var yy = y - cardTop() + scrollY;
    for (var i = 0; i < rows.length; i++) {
        if (yy >= rows[i].y && yy < rows[i].y + E.rowH) return i;
    }
    return -1;
}

function on_mouse_move(x, y) {
    var i = rowAtE(y);
    if (i !== hover) { hover = i; window.Repaint(); }
}
function on_mouse_leave() { if (hover !== -1) { hover = -1; window.Repaint(); } }

function on_mouse_wheel(step) {
    var next = clampE(scrollY - step * E.rowH * 3, 0, maxScrollE());
    if (next !== scrollY) { scrollY = next; window.Repaint(); }
}

function on_mouse_lbtn_down(x, y) {
    var i = rowAtE(y);
    if (i < 0) return;
    selected = i;
    if (rows[i].kind === 'dir') {
        rows[i].node.open = !rows[i].node.open;
        var keep = rows[i].node;
        flatten();
        // keep the clicked folder selected after the flatten renumbers rows
        for (var k = 0; k < rows.length; k++) {
            if (rows[k].kind === 'dir' && rows[k].node === keep) { selected = k; break; }
        }
    }
    window.Repaint();
}

// Double-click sends the folder (or the file) to the active playlist and plays
// it — the same thing double-clicking does everywhere else in foobar.
function on_mouse_lbtn_dblclk(x, y) {
    var i = rowAtE(y);
    if (i < 0) return;
    var lib = fb.GetLibraryItems();
    var handles = [];
    if (rows[i].kind === 'file') {
        handles.push(lib[rows[i].file.index]);
    } else {
        collectFiles(rows[i].node, function (idx) { handles.push(lib[idx]); });
    }
    if (!handles.length) return;
    var hl = fb.CreateHandleList();
    for (var h = 0; h < handles.length; h++) hl.Add(handles[h]);
    var pl = plman.ActivePlaylist;
    plman.ClearPlaylist(pl);
    plman.InsertPlaylistItems(pl, 0, hl);
    plman.ExecutePlaylistDefaultAction(pl, 0);
}

function collectFiles(node, fn) {
    for (var i = 0; i < node.files.length; i++) fn(node.files[i].index);
    for (var d = 0; d < node.dirOrder.length; d++) collectFiles(node.dirs[node.dirOrder[d]], fn);
}

// ------------------------------------------------------------------ events --

function on_size() {
    VW = window.Width; VH = window.Height;
    scrollY = clampE(scrollY, 0, maxScrollE());
}
function on_library_items_added()   { rebuild(); }
function on_library_items_removed() { rebuild(); }
function on_library_items_changed() { rebuild(); }

// -------------------------------------------------------------------- init --

f_ui    = gdi.Font('0xProto Nerd Font', 12, 0);
f_bold  = gdi.Font('0xProto Nerd Font', 12, 1);
f_small = gdi.Font('0xProto Nerd Font', 11, 0);
f_icon  = gdi.Font('0xProto Nerd Font', 11, 0);

VW = window.Width; VH = window.Height;
rebuild();
