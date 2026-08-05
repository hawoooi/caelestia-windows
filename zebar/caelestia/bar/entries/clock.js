import { register } from './registry.js';

export function splitClock(formatted) {
  if (typeof formatted !== 'string') return { top: '--', bottom: '--' };
  const m = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { top: '--', bottom: '--' };
  return { top: m[1], bottom: m[2] };
}

register('clock', () => {
  const el = document.createElement('div');
  el.className = 'clock';
  const top = document.createElement('div');
  const bottom = document.createElement('div');
  el.append(top, bottom);
  return {
    el,
    update(out) {
      const { top: t, bottom: b } = splitClock(out.date?.formatted);
      top.textContent = t;
      bottom.textContent = b;
    },
  };
});
