import { register } from './registry.js';

// Task 3 (Font Awesome icons): was the raw Unicode power symbol (a BMP
// character, survives typed raw -- see logo.js's own note). Now Font
// Awesome Free 6.x Solid's "power-off" icon (\uF011, "Power Off"),
// rendered through the locally vendored webfont via the `fa-solid` class.
register('power', () => {
  const el = document.createElement('button');
  el.type = 'button';
  // 'bar-btn' (style.css) is the one shared clickable-affordance style --
  // circular hover/press background -- applied only to elements with a
  // real click handler. This button already has one (below), so the
  // affordance is honest, not decorative.
  el.className = 'power bar-btn fa-solid';
  el.textContent = '\uF011';
  el.addEventListener('click', () => {
    if (confirm('Shut down?')) console.warn('power action not yet wired');
  });
  return { el, update() {} };
});
