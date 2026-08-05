import { register } from './registry.js';

export function statusSummary(out) {
  return {
    volume: out.audio?.defaultPlaybackDevice?.volume ?? null,
    online: Boolean(out.network?.defaultInterface),
    battery: out.battery ? Math.round(out.battery.chargePercent) : null,
  };
}

register('statusIcons', () => {
  const el = document.createElement('div');
  el.className = 'status-icons';
  return {
    el,
    update(out) {
      const s = statusSummary(out);
      const parts = [];
      parts.push(s.online ? '\uF1EB' : '\uF127');
      if (s.volume !== null) parts.push(s.volume > 0 ? '\uF028' : '\uF026');
      if (s.battery !== null) parts.push(`${s.battery}%`);
      el.replaceChildren(...parts.map(t => {
        const d = document.createElement('div');
        d.textContent = t;
        return d;
      }));
    },
  };
});
