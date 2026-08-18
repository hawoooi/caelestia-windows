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
var GLYPH_CARET_R     = String.fromCharCode(0xF0DA);   // fa-caret-right, closed
var GLYPH_CARET_D     = String.fromCharCode(0xF0D7);   // fa-caret-down, open

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
// DISCLOSURE CARET. fa-folder and fa-folder-open differ by a few pixels of
// flap, which at 13px is not a difference anyone can see -- shape cannot carry
// open-vs-closed at this size. A caret can, because it is read by ROTATION, and
// 90 degrees stays unmistakable however small it gets. The folder glyph stays
// beside it so a directory is still identifiable as one; the caret only says
// open or closed. Files reserve the same column without drawing into it, so
// every name still lines up.
E.twW = 9;
E.twGap = 3;
E.iconOff = E.nodePad + E.twW + E.twGap;        // row x -> folder/file glyph
// A file's name must line up with a folder's name at the same level.
E.fileIndent = E.iconOff + E.iconW + E.iconGap;
E.levelIndent = E.guideIn + E.guideOut;

var f_ui, f_bold, f_icon, f_small;
var root = null;          // {name, children:[], files:[], count, open}
var rows = [];            // flattened visible rows
var scrollY = 0;

// ------------------------------------------------------ horizontal scroll --
// Names are no longer truncated into nothing: the tree scrolls sideways to
// reach a long one. This works here in a way it could not in the browser
// mockup, where rows sized to their own content stopped at the viewport edge
// and the counts drifted out from under each other. Here the panel draws every
// row itself, so ONE offset moves the whole grid together and every column
// stays in register at any scroll position.
//
// The content width is measured from the longest row rather than the visible
// ones, so the scrollbar does not resize as you scroll vertically. 0xProto is
// MONOSPACE, so one character width measured once gives every row's extent
// without calling CalcTextWidth per row.
var scrollX = 0, contentW = 0, charW = 0;
var hThumb = null;        // {x, w} of the drawn thumb, for hit-testing
var hDrag = null;         // {grabX, startScroll} while dragging it
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
    measureContent();
    scrollX = clampE(scrollX, 0, maxScrollX());
}

function rebuild() { buildTree(); flatten(); window.Repaint(); }

// Widest row, in pixels. Recomputed whenever the visible rows change; needs
// charW, which only exists once something has been painted.
function measureContent() {
    if (!charW) { contentW = 0; return; }
    var maxW = 0;
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var text = (r.kind === 'dir') ? r.node.name : r.file.name;
        var w = E.pad + r.indent + E.fileIndent + text.length * charW;
        if (r.kind === 'dir') w += 36 + E.nodePad;      // the count column
        if (w > maxW) maxW = w;
    }
    contentW = maxW + E.pad;
}
function viewW()      { return Math.max(0, VW - IN.l - IN.r - E.scrollW); }
function maxScrollX() { return Math.max(0, contentW - viewW()); }

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
var CARD = { r: 0, headH: 28, footH: 29 };   // square backgrounds; E.radius still rounds highlights

function cardTop()  { return IN.t + CARD.headH + 1; }
function cardFoot() { return VH - IN.b - CARD.footH; }
function treeH()    { return Math.max(0, cardFoot() - 1 - cardTop()); }

function on_paint(gr) {
    gr.FillSolidRect(0, 0, VW, VH, THEME.surface);
    var cx = IN.l, cy = IN.t, cw = VW - IN.l - IN.r, ch = VH - IN.t - IN.b;
    fillRoundE(gr, cx, cy, cw, ch, CARD.r, THEME.surface_container);
    if (!root) return;
    gr.SetTextRenderingHint(5);

    // One character width, measured once. 0xProto is monospace, so this is all
    // that is needed to know how wide any row is without measuring each one.
    if (!charW) { charW = gr.CalcTextWidth('0', f_ui); measureContent(); }

    var top = cardTop();
    var availW = VW - IN.r - E.scrollW;
    // the banding spans the card, not the indented row -- see the note below
    var bandX = IN.l + E.pad, bandW = Math.max(0, availW - E.pad - bandX);

    // guide spines first, so node blocks sit on top of them
    var sp = rows.spines || [];
    for (var s = 0; s < sp.length; s++) {
        var y0 = sp[s].y0 - scrollY + top, y1 = sp[s].y1 - scrollY + top;
        var bot = cardFoot();
        if (y1 < top || y0 > bot) continue;
        gr.FillSolidRect(sp[s].x - scrollX, Math.max(y0 + 2, top), 1,
                         Math.max(0, Math.min(y1, bot) - Math.max(y0 + 2, top)), THEME.guide);
    }

    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var y = r.y - scrollY + top;
        if (y + E.rowH < top) continue;
        if (y > cardFoot()) break;

        // ONE offset moves the whole grid. Widths are computed from the
        // unscrolled origin so a row keeps its shape at any scroll position.
        var x0 = IN.l + E.pad + r.indent;
        var x = x0 - scrollX;
        var w = availW - x0 - E.pad;

        // FINDER BANDING, matching the playlist. The band spans the full card
        // width regardless of how deep the row is indented -- banding that
        // started at the indent would read as steps rather than rows. Drawn
        // from the FLATTENED row list, so alternation never restarts inside a
        // nesting level; the browser mockup needed a bled pseudo-element to get
        // the same thing, which is machinery this does not need.
        if (i % 2 === 1) gr.FillSolidRect(bandX, y, bandW, E.rowH, THEME.stripe);

        if (r.kind === 'dir') {
            // FLAT, not a raised block. The folder blocks and the banding cannot
            // both be present -- a block covers the band it sits on -- and the
            // Finder direction the rest of this design follows spends contrast
            // on the SELECTED row only. Reverting is one line: restore the
            // unconditional surface_container_high fill below.
            if (i === selected || i === hover) {
                fillRoundE(gr, x, y, w, E.rowH, E.radius,
                           i === selected ? THEME.raised_hover : THEME.surface_container_high);
            }

            gr.GdiDrawText(r.node.open ? GLYPH_CARET_D : GLYPH_CARET_R, f_small,
                           THEME.outline, x + E.nodePad, y, E.twW, E.rowH,
                           DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX | DTX.CENTER);

            gr.GdiDrawText(r.node.open ? GLYPH_FOLDER_OPEN : GLYPH_FOLDER, f_icon,
                           THEME.on_surface_variant,
                           x + E.iconOff, y, E.iconW, E.rowH,
                           DTX.SINGLELINE | DTX.VCENTER | DTX.NOPREFIX);

            var nameX = x + E.fileIndent;
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
            // above them even though the text x was identical. The caret column
            // is reserved and left empty for the same reason.
            gr.GdiDrawText(GLYPH_FILE, f_icon, THEME.outline,
                           x + E.iconOff, y, E.iconW, E.rowH,
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

    // horizontal scrollbar, along the bottom of the tree area, only when there
    // is something to reach. Its own ground is painted so scrolled rows passing
    // underneath cannot show through -- no clipping region, as everywhere else.
    hThumb = null;
    var mx = maxScrollX();
    if (mx > 0) {
        var trackX = IN.l + E.pad, trackW = viewW() - E.pad;
        var by = cardFoot() - 1 - E.scrollW;
        gr.FillSolidRect(IN.l, by, VW - IN.l - IN.r, E.scrollW, THEME.surface_container);
        var thumbW = Math.max(28, trackW * viewW() / contentW);
        var tx = trackX + (trackW - thumbW) * (scrollX / mx);
        fillRoundE(gr, tx, by + 2, thumbW, E.scrollW - 4, 3,
                   hDrag ? THEME.guide : THEME.track);
        hThumb = { x: tx, w: thumbW, y: by, h: E.scrollW, trackX: trackX, trackW: trackW };
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

// ------------------------------------------------------------ drag source --
// Dragging OUT of an SMP panel is possible after all: fb.DoDragDrop(window_id,
// handle_list, effect) starts a real OLE drag, and the playlist panel receives
// it through on_drag_enter/over/drop. Both are in this build -- checked against
// the component's own bundled JSDoc, not assumed -- so library-to-playlist drag
// and drop does NOT require merging the two panels into one, which is what the
// project record previously claimed.
//
// DoDragDrop BLOCKS until the drop completes, so nothing may be left half-set
// when it is called.
var DROP_COPY = 1;                 // DROPEFFECT_COPY
var DRAG_SLOP = 5;                 // px before a press becomes a drag
var pressAt = null;

function collectHandles(i) {
    if (i < 0 || i >= rows.length) return null;
    var lib = fb.GetLibraryItems();
    var hl = fb.CreateHandleList();
    if (rows[i].kind === 'file') hl.Add(lib[rows[i].file.index]);
    else collectFiles(rows[i].node, function (idx) { hl.Add(lib[idx]); });
    return hl.Count ? hl : null;
}

function on_mouse_move(x, y, mask) {
    if (hDrag && hThumb) {
        var span = hThumb.trackW - hThumb.w;
        var per  = span > 0 ? maxScrollX() / span : 0;
        scrollX = clampE(hDrag.start + (x - hDrag.grabX) * per, 0, maxScrollX());
        window.Repaint(); return;
    }
    // A press only becomes a drag past a slop threshold, so an ordinary click --
    // which always moves the cursor a pixel or two -- still expands a folder.
    if (pressAt && (mask & 1)) {
        if (Math.abs(x - pressAt.x) > DRAG_SLOP || Math.abs(y - pressAt.y) > DRAG_SLOP) {
            var hl = collectHandles(pressAt.row);
            pressAt = null;
            if (hl) { try { fb.DoDragDrop(window.ID, hl, DROP_COPY); } catch (e) {} }
            return;
        }
    }
    var i = rowAtE(y);
    if (i !== hover) { hover = i; window.Repaint(); }
}
function on_mouse_leave() { if (hover !== -1) { hover = -1; window.Repaint(); } }
function on_mouse_lbtn_up(x, y) { pressAt = null; if (hDrag) { hDrag = null; window.Repaint(); } }

function on_mouse_wheel(step) {
    var next = clampE(scrollY - step * E.rowH * 3, 0, maxScrollE());
    if (next !== scrollY) { scrollY = next; window.Repaint(); }
}
// tilt wheel / horizontal scroll gesture
function on_mouse_wheel_h(step) {
    var next = clampE(scrollX + step * 40, 0, maxScrollX());
    if (next !== scrollX) { scrollX = next; window.Repaint(); }
}

function on_mouse_lbtn_down(x, y) {
    // the horizontal thumb first: it overlaps the bottom row band, and a grab
    // there must scroll rather than select whatever row is behind it
    if (hThumb && y >= hThumb.y && y < hThumb.y + hThumb.h) {
        if (x >= hThumb.x && x < hThumb.x + hThumb.w) {
            hDrag = { grabX: x, start: scrollX }; window.Repaint(); return;
        }
        // clicking the empty track jumps a page toward the click
        scrollX = clampE(scrollX + (x < hThumb.x ? -viewW() : viewW()), 0, maxScrollX());
        window.Repaint(); return;
    }
    var i = rowAtE(y);
    if (i < 0) { pressAt = null; return; }
    pressAt = { x: x, y: y, row: i };
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

// The scratch playlist every library activation lands in. Because it is
// understood to be scratch, replacing its contents is not destructive and needs
// no confirmation -- which is the whole point.
var LIBRARY_PLAYLIST = 'Library';

function libraryPlaylist() {
    for (var i = 0; i < plman.PlaylistCount; i++) {
        if (plman.GetPlaylistName(i) === LIBRARY_PLAYLIST) return i;
    }
    return plman.CreatePlaylist(plman.PlaylistCount, LIBRARY_PLAYLIST);
}

// Double-click sends the folder (or the file) to the LIBRARY playlist and plays
// it.
//
// It used to call plman.ClearPlaylist(plman.ActivePlaylist) -- so browsing the
// library silently destroyed whatever the user had curated in the playlist they
// happened to be looking at, with no warning and no undo. Reported as "i dont
// like the behavior when i click on a folder and it overwrites my playlist
// view", and it should never have been the default. A dedicated scratch
// playlist gives browsing somewhere to go that is nobody's work.
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
    var pl = libraryPlaylist();
    plman.ClearPlaylist(pl);
    plman.InsertPlaylistItems(pl, 0, hl);
    plman.ActivePlaylist = pl;
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
