import { register } from './registry.js';

export function statusSummary(out) {
  return {
    volume: out.audio?.defaultPlaybackDevice?.volume ?? null,
    online: Boolean(out.network?.defaultInterface),
    battery: out.battery ? Math.round(out.battery.chargePercent) : null,
  };
}

// Split out as a pure function so the PUA glyph codepoints that actually
// land in the DOM are directly assertable in a node test (see
// tests/js/entries.test.mjs) -- per CLAUDE.md, raw pasted Nerd Font PUA
// glyphs have previously been silently dropped to empty strings by tooling
// between drafting and the file write, so these are written as literal
// \uXXXX escapes: \uF1EB (wifi), \uF127 (disconnected), \uF028 (volume-up),
// \uF026 (muted). `kind` drives styling in style.css: glyph parts get the
// icon-sized/centered treatment, the battery percentage gets its own
// (smaller, text) treatment -- they were previously rendered as
// visually-identical plain divs.
export function statusIconParts(s) {
  const parts = [];
  parts.push({ text: s.online ? '\uF1EB' : '\uF127', kind: 'glyph' });
  if (s.volume !== null) parts.push({ text: s.volume > 0 ? '\uF028' : '\uF026', kind: 'glyph' });
  if (s.battery !== null) parts.push({ text: `${s.battery}%`, kind: 'battery' });
  return parts;
}

register('statusIcons', () => {
  const el = document.createElement('div');
  el.className = 'status-icons';
  return {
    el,
    update(out) {
      const s = statusSummary(out);
      const parts = statusIconParts(s);
      el.replaceChildren(...parts.map(p => {
        const d = document.createElement('div');
        d.className = p.kind === 'glyph' ? 'status-icons__glyph' : 'status-icons__battery';
        d.textContent = p.text;
        return d;
      }));
    },
  };
});
