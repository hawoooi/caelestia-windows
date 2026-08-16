import { register } from './registry.js';

export function pingState(stdout) {
  const n = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return { pinged: false, count: 0 };
  return { pinged: true, count: n };
}

const HELPER = 'C:\\Users\\PC\\.config\\yasb\\scripts\\vesktop-unread.exe';

// Task 1 Step 5 flagged shellExec as source-verified-only. Task 7 confirmed
// against the live vendored bundle (zebar/caelestia/bar/vendor/zebar.js) that
// there is no `shell.exec(...)` method on a context object -- `shellExec` is
// a top-level named export of the zebar module itself, `(program, args?,
// options?) => Promise<{ code, signal, stdout, stderr }>`. bar.js already
// wires `ctx.shell = zebar.shellExec ? zebar : null`, i.e. `shell` IS the
// zebar module, so the call is `shell.shellExec(HELPER, [])`, not
// `shell.exec(HELPER, [])`.
//
// Task 3 (Font Awesome icons): this entry used to render ONLY the unread
// count as plain text, no icon at all -- there was nothing to "replace"
// glyph-wise, just a bare number. It now renders a real Discord mark
// (\uF392, "Discord") beside the count. Discord is a Font Awesome Free
// BRAND icon, not a solid icon -- brand glyphs live in a completely
// separate webfont/font-family ("Font Awesome 6 Brands", see
// ../vendor/fontawesome/fontawesome.css's own doc comment for why these
// can't be merged into one @font-face) from every other icon in this bar,
// so the icon span gets `fa-brands`, never `fa-solid`. Written as a literal
// \uXXXX escape and read back after writing, per CLAUDE.md's "Nerd Font
// glyphs" discipline (raw pasted PUA glyphs have previously been silently
// dropped to empty strings by tooling between drafting and the file write).
//
// feat/corner-overlays follow-up (direct user feedback, screenshot showed
// the glyph and the count crowding each other side by side against the
// 52px bar's edges): icon-above-count layout moved from a row to a column
// entirely in style.css's `.vesktop` rule -- this module's own DOM order
// (`el.append(icon, count)`) already put the icon before the count, so no
// JS change was needed, only the CSS axis flip. See style.css's own
// comment on `.vesktop` for the sizing/spacing rationale.
register('vesktop', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'vesktop';
  const icon = document.createElement('span');
  icon.className = 'vesktop__icon fa-brands';
  icon.textContent = '\uF392';
  const count = document.createElement('span');
  count.className = 'vesktop__count';
  el.append(icon, count);

  async function poll() {
    try {
      const { stdout } = await shell.shellExec(HELPER, []);
      const s = pingState(stdout);
      count.textContent = s.pinged ? String(s.count) : '';
      el.classList.toggle('vesktop--pinged', s.pinged);
      el.style.display = s.pinged ? '' : 'none';
    } catch (e) {
      console.error('vesktop poll failed', e);
      el.style.display = 'none';
    }
  }

  poll();
  setInterval(poll, 5000);
  return { el, update() {} };
});
