// Reading EVKey's current input mode (Vietnamese or English) out of its system
// tray entry.
//
// EVKey (https://evkeyvn.com) is a third-party Vietnamese input method editor.
// It is NOT a Windows keyboard layout -- this machine's installed Windows
// languages are English and Chinese, with no Vietnamese among them, so zebar's
// own `keyboard` provider reports `en-US` regardless of what EVKey is doing.
// Checking that first is what stopped this being built against the wrong
// signal entirely.
//
// **Where the state actually lives.** Three candidates were checked:
//
//   * `setting.ini`'s `Lang=` key, in EVKey's own folder. Rejected: the file's
//     mtime was hours stale while EVKey was plainly in use, so it is written on
//     exit (or on settings changes), not on every toggle. A stale source is
//     worse than none -- it would show a confident wrong answer.
//   * The registry. Nothing under HKCU\Software matches EVKey at all.
//   * The TRAY TOOLTIP, which updates live. This is what is used.
//
// The tooltip costs nothing extra: zebar has a `systray` provider, so there is
// no helper process, no poll and no shellExec -- which matters in a pack that
// already spawns fullscreen-detect.exe ~10x/second across nine widgets.
//
// **The tooltip describes the ACTION, not the state**, and that inversion is
// the whole subtlety here:
//
//     "EVKey - Kích để mở bàn phím Tiếng Việt"
//      = "EVKey - Click to open the VIETNAMESE keyboard"
//
// which means EVKey is currently in ENGLISH. Reading that string as the
// current mode would produce an indicator that is confidently backwards in
// both states.

/** EVKey's tray entry is the one whose tooltip starts with this. */
export const EVKEY_PREFIX = 'EVKey';

/**
 * Finds EVKey's tray entry among the systray provider's icons.
 *
 * Never throws: the provider's shape is not this module's to guarantee, and a
 * bar entry must not be able to take the whole bar down (bar.js wraps
 * update() in a per-entry try/catch, but a bad shape here would throw inside
 * that and silently blank the entry anyway).
 */
export function findEvkeyIcon(systray) {
  const icons = systray && Array.isArray(systray.icons) ? systray.icons : [];
  return icons.find((i) => i && typeof i.tooltip === 'string' && i.tooltip.startsWith(EVKEY_PREFIX)) ?? null;
}

/**
 * The mode EVKey is currently IN, derived from the action its tooltip offers.
 *
 * Returns 'vi', 'en', or null when it cannot be told -- and null genuinely
 * means unknown, so the caller can render nothing rather than guess. Guessing a
 * default here would put a wrong flag on the bar, which is worse than an
 * absent one for an indicator whose entire job is to tell you which mode you
 * are typing in.
 *
 * Matching is on the language WORD rather than the whole sentence, so a
 * reworded or re-localised tooltip keeps working as long as it still names the
 * language it will switch to. Accents are stripped first: the same string has
 * been seen with and without them depending on the code page a reader used.
 */
export function evkeyMode(tooltip) {
  if (typeof tooltip !== 'string' || tooltip === '') return null;
  const flat = stripAccents(tooltip).toLowerCase();

  // "Tiếng Việt" -> the click would switch TO Vietnamese -> currently English.
  const offersVietnamese = flat.includes('tieng viet') || flat.includes('vietnamese');
  // "Tiếng Anh" -> the click would switch TO English -> currently Vietnamese.
  const offersEnglish = flat.includes('tieng anh') || flat.includes('english');

  // Both or neither is not something to resolve by precedence -- it means the
  // tooltip is not the shape this was built against, and a guess would be
  // indistinguishable from a reading.
  if (offersVietnamese === offersEnglish) return null;
  return offersVietnamese ? 'en' : 'vi';
}

/**
 * Vietnamese uses a lot of combining diacritics, and the same tooltip has been
 * observed both precomposed and decomposed. Normalising to NFD and dropping
 * the combining marks makes the match independent of which form arrives.
 */
export function stripAccents(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    // The combining diacritical marks block, as \u escapes rather than the
    // raw characters. Written literally, this range is invisible in an editor
    // and indistinguishable from a corrupted line -- and this repo has already
    // had a config silently stripped of exactly such characters, taking every
    // glyph with it.
    .replace(/[\u0300-\u036f]/g, '')
    // Vietnamese d-with-stroke is a distinct LETTER, not a base plus a
    // combining mark, so NFD leaves it intact and it needs its own rule.
    // Case is preserved: this is a general string utility, and the caller
    // lowercases separately.
    .replace(/\u0111/g, 'd')   // d-with-stroke, lowercase
    .replace(/\u0110/g, 'D');  // D-with-stroke, uppercase
}

/** The two-letter label shown on the bar. */
export function modeLabel(mode) {
  if (mode === 'vi') return 'VI';
  if (mode === 'en') return 'EN';
  return '';
}
