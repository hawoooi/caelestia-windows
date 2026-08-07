import { register } from './registry.js';

// Task 3 (Font Awesome icons): was the raw Unicode diamond character, then
// Font Awesome Free 6.x Solid's "diamond" (\uF219). Now Font Awesome Free
// 6.x Solid's "ghost" icon (\uF6E2, "Ghost") -- the bar's top mark, chosen
// by the user. Kept on the Solid style deliberately (`fa-solid`): every
// non-brand icon in this bar shares one FA style so a future "switch icon
// style" option has a single family to swap; Free only ships Solid +
// Brands anyway (see fontawesome.css). Glyph presence in the vendored
// fa-solid-900.woff2 was verified via fontTools before writing (cmap
// contains U+F6E2), per CLAUDE.md's "check a glyph exists" discipline.
// Written as a literal \uXXXX escape and read back after writing.
register('logo', () => {
  const el = document.createElement('div');
  el.className = 'logo fa-solid';
  el.textContent = '\uF6E2';
  return { el, update() {} };
});
