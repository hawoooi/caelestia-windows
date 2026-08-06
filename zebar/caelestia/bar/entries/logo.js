import { register } from './registry.js';

register('logo', () => {
  const el = document.createElement('div');
  el.className = 'logo';
  el.textContent = '◆';
  return { el, update() {} };
});
