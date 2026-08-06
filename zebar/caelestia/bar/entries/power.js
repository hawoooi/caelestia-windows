import { register } from './registry.js';

register('power', () => {
  const el = document.createElement('button');
  el.type = 'button';
  // 'bar-btn' (style.css) is the one shared clickable-affordance style --
  // circular hover/press background -- applied only to elements with a
  // real click handler. This button already has one (below), so the
  // affordance is honest, not decorative.
  el.className = 'power bar-btn';
  el.textContent = '⏻';
  el.addEventListener('click', () => {
    if (confirm('Shut down?')) console.warn('power action not yet wired');
  });
  return { el, update() {} };
});
