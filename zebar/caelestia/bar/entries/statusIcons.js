import { register } from './registry.js';

export function statusSummary(out) {
  return {
    volume: out.audio?.defaultPlaybackDevice?.volume ?? null,
    online: Boolean(out.network?.defaultInterface),
    battery: out.battery ? Math.round(out.battery.chargePercent) : null,
  };
}

// Task 3 (Font Awesome icons): these were Nerd Font PUA codepoints before
// (a font-patched-in copy of old Font Awesome 4.7 glyphs at the SAME
// codepoints, rendered through the system "0xProto Nerd Font", not a
// vendored, licensed webfont -- see docs/zebar-bar.md). Now real Font
// Awesome Free 6.x Solid codepoints, rendered through the locally vendored
// webfont (../vendor/fontawesome/fontawesome.css) via the `fa-solid` class
// added below -- confirmed against Font Awesome's own metadata/icons.json
// for the 6.x release (not guessed/carried over from the old Nerd Font
// mapping, which used the older 4.7 "signal-slash"-adjacent codepoint
// \uF127 (chain-broken) as a wifi-disconnected stand-in): \uF1EB (wifi,
// "Wifi"), \uE560 (plug-circle-xmark, "Plug Circle Xmark" -- FA6 Free has
// no dedicated "wifi-slash" solid glyph, so a broken-connection glyph
// stands in for "disconnected", same idea as the old mapping but a real,
// confirmed-present Free icon this time), \uF028 (volume-high), \uF027
// (volume-low), \uF026 (volume-off). Split out as a pure function so these
// codepoints are directly assertable in a node test (see
// tests/js/entries.test.mjs), per the same "write \uXXXX escapes, then
// read the file back" discipline CLAUDE.md's "Nerd Font glyphs" note
// established after raw pasted PUA glyphs were once silently dropped to
// empty strings between drafting and the file write.
//
// Volume is now a real three-tier muted/low/high split driven by the
// actual level (previously a binary >0 check that only ever chose between
// "some sound" and "off"): 0 -> volume-off, 1-50 -> volume-low, 51-100 ->
// volume-high. `kind` still drives styling in style.css: glyph parts get
// the icon-sized/centered treatment plus the `fa-solid` font, the battery
// percentage gets its own (smaller, plain-text, no icon font) treatment.
export function volumeGlyph(volume) {
  if (volume <= 0) return '\uF026';
  if (volume <= 50) return '\uF027';
  return '\uF028';
}

export function statusIconParts(s) {
  const parts = [];
  parts.push({ text: s.online ? '\uF1EB' : '\uE560', kind: 'glyph' });
  if (s.volume !== null) parts.push({ text: volumeGlyph(s.volume), kind: 'glyph' });
  if (s.battery !== null) parts.push({ text: `${s.battery}%`, kind: 'battery' });
  return parts;
}

register('statusIcons', () => {
  const el = document.createElement('div');
  el.className = 'status-icons';
  return {
    el,
    update(out) {
      const s = statusSummary(out);
      const parts = statusIconParts(s);
      el.replaceChildren(...parts.map(p => {
        const d = document.createElement('div');
        d.className = p.kind === 'glyph' ? 'status-icons__glyph fa-solid' : 'status-icons__battery';
        d.textContent = p.text;
        return d;
      }));
    },
  };
});
