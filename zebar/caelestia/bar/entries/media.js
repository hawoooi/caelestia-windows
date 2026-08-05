import { register } from './registry.js';
import { toggleDrawer } from '../drawer.js';

export function mediaLabel(media) {
  const s = media?.currentSession;
  if (!s || !s.title) return '';
  const base = s.artist ? `${s.title} — ${s.artist}` : s.title;
  return s.isPlaying ? base : `(Paused) ${base}`;
}

// zebar's MediaSession exposes `startTime`/`endTime`/`position` as plain
// numbers with no documented unit in either the zpack schema or the
// vendored bundle (createMediaProvider just forwards the Rust-side output
// as-is). Confirmed empirically against this machine's live session (Task 8):
// a real track reported `{ startTime: 0, endTime: 180, position: 49 }` --
// 180 as a track *length* only makes sense as seconds (a 3-minute song; as
// milliseconds it would be an 0.18s clip), and 49 lines up with "elapsed
// just under a minute". So these are seconds, not ms and not 100ns ticks.
export function formatMediaTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

register('media', () => {
  const el = document.createElement('div');
  el.className = 'media';

  // The panel is appended directly to <body> (a sibling of #bar), not
  // nested inside the rotated `.media` pill -- `.media` sets
  // `writing-mode: vertical-rl`, which inherits into descendants, so a
  // panel nested inside it would render sideways too. Appending to body
  // also sidesteps #bar's `align-items: center`, which would otherwise
  // center (and half-clip offscreen) a 260px panel inside a 52px column.
  // `position: fixed; left: var(--bar-w)` (added in style.css alongside
  // the brief's verbatim `.media-panel` rule) anchors it beside the strip
  // regardless of where in the DOM it lives.
  const panel = document.createElement('div');
  panel.className = 'media-panel';

  const art = document.createElement('img');
  art.className = 'media-panel__art';
  const title = document.createElement('div');
  title.className = 'media-panel__title';
  const artist = document.createElement('div');
  artist.className = 'media-panel__artist';
  const transport = document.createElement('div');
  transport.className = 'media-panel__transport';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = '⏮';
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = '⏯';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = '⏭';
  transport.append(prevBtn, playBtn, nextBtn);
  const time = document.createElement('div');
  time.className = 'media-panel__time';

  panel.append(art, title, artist, transport, time);
  document.body.appendChild(panel);

  let media = null;
  prevBtn.addEventListener('click', () => media?.previous?.());
  playBtn.addEventListener('click', () => media?.togglePlayPause?.());
  nextBtn.addEventListener('click', () => media?.next?.());

  el.addEventListener('click', () => {
    const barEl = document.getElementById('bar');
    toggleDrawer(barEl, !document.body.classList.contains('drawer-open'));
  });

  function renderPanel(m) {
    const s = m?.currentSession;
    if (!s) {
      title.textContent = '';
      artist.textContent = '';
      time.textContent = '';
      art.style.display = 'none';
      return;
    }
    if (s.artworkUrl) {
      art.src = s.artworkUrl;
      art.style.display = '';
    } else {
      art.removeAttribute('src');
      art.style.display = 'none';
    }
    title.textContent = s.title || '';
    artist.textContent = s.artist || '';
    playBtn.textContent = s.isPlaying ? '⏸' : '▶';
    const total = typeof s.endTime === 'number' && typeof s.startTime === 'number'
      ? s.endTime - s.startTime
      : undefined;
    time.textContent = `${formatMediaTime(s.position)} / ${formatMediaTime(total)}`;
  }

  return {
    el,
    update(out) {
      media = out.media;
      const label = mediaLabel(out.media);
      el.textContent = label;
      el.style.display = label ? '' : 'none';
      renderPanel(out.media);
    },
  };
});
