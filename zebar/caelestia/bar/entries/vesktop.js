import { register } from './registry.js';

export function pingState(stdout) {
  const n = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return { pinged: false, count: 0 };
  return { pinged: true, count: n };
}

/**
 * The badge text for an unread count, in the shape Windows' own taskbar badge
 * uses: the number itself while it stays two digits, then a saturated "99+".
 *
 * The cap is a LAYOUT constraint, not a cosmetic one. This badge sits on a
 * 52px-wide bar, and an unbounded count (Discord will happily report several
 * hundred) would widen the badge past the bubble it is anchored to and push
 * the whole cluster out of alignment. Kept as a pure function so the boundary
 * is unit-tested rather than eyeballed at 99.
 */
export function badgeText(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
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
// Direct user feedback, this pass: "make it so that the discord icon has its
// own sub-bubble and always shows, and the bubble changes the background
// according to if it has a notification or not. and the badge similar to the
// badge in taskbar where it shows how many windows are open to show the amount
// of notifications in discord."
//
// Three changes follow from that, and the first is the load-bearing one:
//
// 1. **It never hides itself any more.** This used to set
//    `el.style.display = 'none'` whenever the count was zero OR the poll threw,
//    so Discord simply vanished from the bar for the entire time there was
//    nothing to report -- which is most of the time. An indicator that is
//    absent when idle cannot be READ when idle: you can't tell "no unread" from
//    "the helper died" from "I removed it". Now the bubble is always present and
//    the STATE is carried by its background, which is what makes the presence
//    itself informative.
// 2. The count is a corner BADGE anchored to the bubble, not a second line of
//    text stacked under the glyph. That is the taskbar's own idiom and it keeps
//    the entry one glyph tall whether or not there is anything to show, so
//    nothing below it moves when a notification arrives.
// 3. A failed poll is its own state (`vesktop--stale`), not a disappearance --
//    the bubble stays, the badge clears, and the tooltip says why.
register('vesktop', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'vesktop';
  const icon = document.createElement('span');
  icon.className = 'vesktop__icon fa-brands';
  icon.textContent = '\uF392';
  // aria-hidden: the glyph is decorative, the tooltip below carries the meaning.
  icon.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('span');
  badge.className = 'vesktop__badge';
  el.append(icon, badge);

  function apply(state) {
    const text = badgeText(state.count);
    badge.textContent = text;
    // Two independent facts, two independent classes -- the same split
    // evkey.js uses. `--pinged` drives the bubble's background; `--on` only
    // decides whether the badge itself is painted, so an empty badge can
    // never leave a stray dot on the bubble's corner.
    el.classList.toggle('vesktop--pinged', state.pinged);
    badge.classList.toggle('vesktop__badge--on', text !== '');
    el.classList.remove('vesktop--stale');
    el.title = state.pinged
      ? `Discord: ${state.count} unread`
      : 'Discord: no unread';
  }

  async function poll() {
    try {
      const { stdout } = await shell.shellExec(HELPER, []);
      apply(pingState(stdout));
    } catch (e) {
      console.error('vesktop poll failed', e);
      // Stay visible and say so, rather than vanishing. A missing helper and
      // a quiet Discord used to look identical (both absent); now they don't.
      badge.textContent = '';
      badge.classList.remove('vesktop__badge--on');
      el.classList.remove('vesktop--pinged');
      el.classList.add('vesktop--stale');
      el.title = 'Discord: unread count unavailable';
    }
  }

  poll();
  setInterval(poll, 5000);
  return { el, update() {} };
});
