"""
!!! THIS SCRIPT DOES NOT WORK. DO NOT USE IT TO THEME COLUMNS UI. !!!

foo_ui_columns.dll.cfg is integrity-checked. Changing even three bytes of it --
a colour value OR an inert comment string -- makes foobar2000 refuse the file
with "Error reading configuration file (Corrupted configuration file)" on the
next start. Header layout is:

    magic GUID(16) | contentHash(16) | payloadLen:u32 | payload

Bytes 16..31 demonstrably vary with payload content across two foobar-written
samples, but the hash is not a stock digest: md5 / sha1 / sha256 / sha512 /
blake2b / blake2s / ripemd160 / sm3 over eight span constructions in three byte
orders all failed to reproduce it. Until that is cracked, this file must only be
written by foobar2000 itself.

Columns UI colours therefore have to be set through its Preferences GUI
(Display > Columns UI > Colours and fonts), and the wallpaper-driven theming
belongs in the foo_uie_webview panel instead -- see render-theme-css.py, whose
output is plain CSS with no integrity checking at all.

Kept only because the decode below is accurate and was expensive to obtain, and
because --restore is a working way back from a botched experiment.

---- original description ----

Patch Columns UI's colour table in foo_ui_columns.dll.cfg from palette.json.

The config is a binary blob of GUID-keyed records. Colour clients (playlist view,
filter panels, item details, ...) each serialise a fixed 49-byte entry:

    GUID(16)  mode:u32(4)  colour[7] * (R,G,B,pad = 4)  trailing(1)

All seven colours are stored as R,G,B,0 -- i.e. a Win32 COLORREF in
little-endian byte order. NOTE: every stock default is a grey (#ffffff, #191919,
#626262, #333333, #777777), so the file alone cannot prove the channel order.
It is confirmed visually instead: `primary` is strongly teal, and a swapped
order renders it as khaki. See docs -- verify by looking, not by reading state.

Usage:
    py apply-cui-colours.py --cfg <path> [--palette palette.json] [--dry-run]
                            [--mode N] [--restore]

foobar2000 MUST NOT be running against that profile: it rewrites this file on
exit and would discard the patch.
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys

# The seven colour slots, in the order Columns UI serialises them.
# Slot semantics are Columns UI's standard colour-client set; the mapping to
# Material You roles below follows the desktop's conventions: depth from surface
# steps, accent used sparingly (the "now" item only).
SLOTS = [
    ("text",                        "on_surface"),
    ("selected_text",               "on_surface"),
    ("selected_text_no_focus",      "on_surface_variant"),
    ("background",                  "surface"),
    ("selected_background",         "surface_container_high"),
    ("selected_background_no_focus","surface_container"),
    ("active_item_frame",           "primary"),
]

# Stock defaults, used to locate the entries without needing absolute offsets.
DEFAULT_BLOCK = bytes([
    0xff, 0xff, 0xff, 0x00,
    0xff, 0xff, 0xff, 0x00,
    0xff, 0xff, 0xff, 0x00,
    0x19, 0x19, 0x19, 0x00,
    0x62, 0x62, 0x62, 0x00,
    0x33, 0x33, 0x33, 0x00,
    0x77, 0x77, 0x77, 0x00,
])


def hex_to_bgr_pad(h):
    """'#rrggbb' -> bytes(R, G, B, 0) as stored on disk."""
    h = h.lstrip('#')
    if len(h) != 6:
        raise ValueError("bad hex colour: %r" % h)
    r = int(h[0:2], 16)
    g = int(h[2:4], 16)
    b = int(h[4:6], 16)
    return bytes([r, g, b, 0])


def build_block(palette):
    out = bytearray()
    for slot, role in SLOTS:
        if role not in palette:
            raise KeyError("palette is missing role %r (needed by slot %r)" % (role, slot))
        out += hex_to_bgr_pad(palette[role])
    assert len(out) == 28
    return bytes(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cfg', required=True)
    ap.add_argument('--palette', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'palette.json'))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--mode', type=int, default=None,
                    help="also force the per-entry u32 mode field (e.g. 1 = custom colours)")
    ap.add_argument('--restore', action='store_true', help="restore from the .orig backup and exit")
    ap.add_argument('--entries', default='all',
                    help="which matched blocks to patch: 'all', or a comma list / range like '1-12'")
    ap.add_argument('--slots', default='all',
                    help="which of the 7 colour slots to patch: 'all', or a comma list / range like '0-3'")
    args = ap.parse_args()

    backup = args.cfg + '.orig'

    if args.restore:
        if not os.path.exists(backup):
            print("no backup at %s" % backup); return 1
        shutil.copyfile(backup, args.cfg)
        print("restored %s from %s" % (args.cfg, backup))
        return 0

    data = bytearray(open(args.cfg, 'rb').read())
    palette = json.load(open(args.palette, 'r', encoding='utf-8'))

    new_block = build_block(palette)

    hits = [m.start() for m in re.finditer(re.escape(DEFAULT_BLOCK), bytes(data))]
    print("cfg      : %s (%d bytes)" % (args.cfg, len(data)))
    print("palette  : %s" % args.palette)
    print("entries  : %d colour blocks matched the stock defaults" % len(hits))
    if not hits:
        print("NOTHING MATCHED -- the config is not at stock defaults (already patched?).")
        return 2

    print("\nslot mapping:")
    for i, (slot, role) in enumerate(SLOTS):
        print("  %-30s <- %-24s %s" % (slot, role, palette[role]))

    # narrow to the requested subset
    if args.entries != 'all':
        want = set()
        for part in args.entries.split(','):
            part = part.strip()
            if '-' in part:
                a, b = part.split('-', 1)
                want.update(range(int(a), int(b) + 1))
            elif part:
                want.add(int(part))
        sel = [h for i, h in enumerate(hits) if i in want]
        print("\nselecting entries %s -> %d of %d blocks" % (args.entries, len(sel), len(hits)))
        hits = sel

    print("\noffsets  : %s" % hits)

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    if not os.path.exists(backup):
        shutil.copyfile(args.cfg, backup)
        print("\nbackup   : %s" % backup)

    def parse_set(spec, n):
        if spec == 'all':
            return set(range(n))
        out = set()
        for part in spec.split(','):
            part = part.strip()
            if '-' in part:
                a, b = part.split('-', 1)
                out.update(range(int(a), int(b) + 1))
            elif part:
                out.add(int(part))
        return out

    slots = parse_set(args.slots, len(SLOTS))
    print("slots    : %s" % sorted(slots))

    for off in hits:
        for si in sorted(slots):
            data[off + si * 4: off + si * 4 + 4] = new_block[si * 4: si * 4 + 4]
        if args.mode is not None:
            # mode u32 sits 4 bytes before the colour block (GUID(16) then mode(4))
            struct.pack_into('<I', data, off - 4, args.mode)

    with open(args.cfg, 'wb') as f:
        f.write(bytes(data))
    print("\npatched  : %d entries%s" % (len(hits), "" if args.mode is None else " (mode forced to %d)" % args.mode))
    return 0


if __name__ == '__main__':
    sys.exit(main())
