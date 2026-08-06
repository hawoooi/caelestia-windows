import { register } from './registry.js';

// Task 3 (Font Awesome icons): was the raw Unicode diamond character (a BMP
// character -- these survive typed raw, per CLAUDE.md's "Nerd Font glyphs"
// note; only Private-Use-Area glyphs have been observed to get dropped).
// Now Font Awesome Free 6.x Solid's own "diamond" icon (\uF219, "Diamond"),
// rendered through the locally vendored webfont via the `fa-solid` class --
// a literal diamond shape, keeping the bar's original mark rather than
// swapping in an unrelated icon. Written as a literal \uXXXX escape and
// read back after writing, per CLAUDE.md's "Nerd Font glyphs" discipline.
register('logo', () => {
  const el = document.createElement('div');
  el.className = 'logo fa-solid';
  el.textContent = '\uF219';
  return { el, update() {} };
});
