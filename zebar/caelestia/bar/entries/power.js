import { register } from './registry.js';

register('power', () => {
  const el = document.createElement('button');
  el.className = 'power';
  el.textContent = '⏻';
  el.addEventListener('click', () => {
    if (confirm('Shut down?')) console.warn('power action not yet wired');
  });
  return { el, update() {} };
});
