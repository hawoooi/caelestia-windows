import { register } from './registry.js';

export function mediaLabel(media) {
  const s = media?.currentSession;
  if (!s || !s.title) return '';
  const base = s.artist ? `${s.title} — ${s.artist}` : s.title;
  return s.isPlaying ? base : `(Paused) ${base}`;
}

register('media', () => {
  const el = document.createElement('div');
  el.className = 'media';
  return {
    el,
    update(out) {
      const label = mediaLabel(out.media);
      el.textContent = label;
      el.style.display = label ? '' : 'none';
    },
  };
});
