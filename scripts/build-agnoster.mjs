// Recreates agnoster (github.com/agnoster/agnoster-zsh-theme) as starship
// configs, in two variants, plus a separator probe.
//
// Agnoster's structure, from its source:
//   status (X on error, lightning for root, gear for jobs) -> context
//   (user@host) -> virtualenv on cyan -> dir on BLUE -> git on GREEN when
//   clean / YELLOW when dirty -> end.
//   Separator U+E0B0, foreground black throughout.
//
// THE SEPARATORS RENDER FINE, and the belief that they could not was wrong.
//
// Every earlier candidate in this repo avoided powerline separators on the
// stated grounds that ~/.wezterm.lua's cell_width = 0.9 clips them into the
// doubled chevrons the user reported as "weird shapes on the arrows". That
// was inferred, never tested. It was tested here: agnoster was rendered in a
// real WezTerm at the live cell_width and the U+E0B0 separators came out as
// clean solid triangles with no doubling and no seam between segments. The
// earlier artifact belonged to some other glyph -- the catppuccin-powerline
// preset also uses the ROUND caps U+E0B4/U+E0B6, which are a different shape
// with a different cell fit. cell_width does not need changing, and no
// candidate needs to avoid U+E0B0 on its account.
//
// What DID come out wrong at 0.9 is agnoster's own git glyph, U+E0A0: it
// renders as a thin spindly mark rather than a branch. U+F418 is the same
// icon drawn properly in this font and is already verified present in
// CartographCF's cmap, so both variants use it. That is a substitution, and
// it is the only place either variant departs from agnoster's glyph set.
//
// THE COLOURS are the one real choice, and it is not cosmetic. Agnoster's
// identity is partly blue/green/yellow; matugen derives everything from the
// wallpaper, and this one is teal, with no green and no yellow anywhere in
// the palette:
//   agnoster-faithful -- agnoster's own colours, literal. Looks like
//                        agnoster. Does NOT follow the wallpaper.
//   agnoster-themed   -- agnoster's structure in the wallpaper palette.
//                        Follows the theme. Loses the colour identity.
//
// The themed variant uses the palette's LIGHT tones as segment backgrounds
// with the dark surface as text, because that is what makes agnoster look
// like agnoster: saturated blocks carrying near-black text. Backing the
// segments with the palette's dark containers instead was tried first and
// produced grey-on-grey text that could not be read at all.
//
// A starship limitation worth stating rather than papering over: starship has
// no conditional STYLE, so agnoster's "green when clean, yellow when dirty"
// cannot be expressed at all. This was first approximated with two blocks -- a
// clean-coloured branch and a separate dirty-coloured status block that
// appeared only when there was something to report -- and that approximation
// was ABANDONED, because it made the closing arrow undecidable: whichever
// module drew the closing arrow could not know whether the status block had
// rendered, so the arrow's colour disagreed with the block it sat against.
//
// Git is therefore ONE block in a single colour, and the `dirty` entry in the
// colour tables below is no longer used for a block. Correct arrows were worth
// more than a colour distinction starship cannot make reliably.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outDir = path.join(repo, 'state', 'prompt-candidates');
fs.mkdirSync(outDir, { recursive: true });

const theme = fs.readFileSync(path.join(repo, 'zebar/caelestia/bar/theme.css'), 'utf8');
const P = {};
for (const m of theme.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) P[m[1]] = m[2];

// The TERMINAL's own palette, read from the generated ~/.config/palette.lua
// that ~/.wezterm.lua loads as its "Matugen" colour scheme. This is a
// different and much more useful set than the bar's surface roles: matugen
// synthesizes four accent hues for the ANSI slots, so there is genuine hue
// variety here (salmon, periwinkle, teal) where the surface family has none.
// Read rather than copied, so the prompt cannot drift from the terminal it
// is printed into.
const lua = fs.readFileSync(path.join(process.env.USERPROFILE, '.config/palette.lua'), 'utf8');
const slot = (block, i) => {
  const body = lua.split(`${block} = {`)[1].split('}')[0];
  return [...body.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1])[i];
};
const ANSI = { black: slot('ansi', 0), red: slot('ansi', 1), green: slot('ansi', 2),
  yellow: slot('ansi', 3), blue: slot('ansi', 4), white: slot('ansi', 7) };
const BRIGHT = { red: slot('brights', 1), yellow: slot('brights', 3), white: slot('brights', 7) };

const SEP = '\\uE0B0';       // powerline right arrow -- agnoster's separator
// Agnoster's own git glyph is U+E0A0, which renders as a thin spindly mark in
// CartographCF at cell_width 0.9. U+F418 is the same icon drawn properly, and
// is already verified present in this font's cmap.
const BRANCH = '\\uF418';

// agnoster's own palette, as the terminal's 8-colour names resolve on this
// desktop. Kept literal: that IS the variant.
const A = {
  fg: '#0e1415',        // PRIMARY_FG, black
  context: '#dde4e4',   // user@host sits on the default (dark) background
  contextFg: '#0e1415',
  dir: '#4a7fd4',       // blue
  clean: '#63b85c',     // green
  dirty: '#d4b23f',     // yellow
  venv: '#3fb8c4',      // cyan
  error: '#d45a5a',     // red
};

// The same structure, drawn from the TERMINAL's ANSI slots rather than the
// bar's surface roles.
//
// The first attempt used surface roles (outline / primary / on-surface-variant
// / on-surface) and was right to be rejected: those are four steps along ONE
// grey-teal ramp, so the segments differed only in lightness and the whole
// prompt read as washed-out grey blocks. The ANSI slots carry matugen's four
// synthesized accent hues instead, which is where the actual contrast lives.
//
// Agnoster's own semantics are preserved slot-for-slot where the palette
// allows it -- its blue directory stays on the blue slot, its green git
// segment on the green slot. Its YELLOW "dirty" marker is the one that cannot
// survive: this palette's yellow slot is a pale teal, near-identical to blue,
// so dirty moves to the RED slot. That is the only hue in the set that is
// genuinely distinct, and "attention" is what dirty means anyway.
//
// The context segment inverts -- dark block, light text -- which is both
// closer to real agnoster (its user@host is bg=black) and what gives the
// prompt somewhere to start before the bright blocks begin.
const T = {
  fg: P['surface'],
  context: ANSI.black,
  contextFg: BRIGHT.white,
  dir: ANSI.blue,        // agnoster's blue directory, on the blue slot
  clean: ANSI.green,     // agnoster's green git segment, on the green slot
  dirty: ANSI.red,       // agnoster's yellow has no distinct counterpart here
  venv: BRIGHT.yellow,
  error: BRIGHT.red,
  deriveFg: true,
};

// Derive a segment's TEXT colour from that segment's own BACKGROUND, instead
// of painting every segment with one shared dark literal.
//
// Direct user observation: with a single flat `surface` foreground on all four
// segments, the text reads slightly differently on each, because the segment
// backgrounds are different hues (teal / periwinkle / salmon) and a neutral
// dark sits at a different apparent distance from each one.
//
// The fix keeps the foreground DARK -- it is not switched to a light colour --
// but ties it to the background it sits on. Hue and saturation are carried
// straight through from the background and only the lightness is driven down,
// so the text on the teal block is a very dark teal and the text on the salmon
// block is a very dark salmon. This is the same relationship Material expresses
// as `on_primary` / `on_error`, computed here because the generated
// palette.lua exposes only the ANSI slots, not the full role set.
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const onColour = (bg) => {
  const [r, g, b] = hexToRgb(bg).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    if (max === r) h = ((g - b) / dd + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / dd + 2) / 6;
    else h = ((r - g) / dd + 4) / 6;
  }
  // L is forced to 11%: dark enough to read as "black text" at a glance, while
  // retaining enough of the hue to belong to its own block. S is capped so a
  // fully-saturated background (the salmon slot is S=100%) does not produce a
  // text colour that reads as coloured rather than as dark.
  const L = 0.11, S = Math.min(s, 0.55);
  if (S === 0) return rgbToHex(L * 255, L * 255, L * 255);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const ch = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255);
};

const build = (c) => {
  // The faithful variant keeps agnoster's own flat PRIMARY_FG black, because
  // that literal IS the thing it is being faithful to. Only the themed variant
  // derives its foregrounds.
  const fgOn = (bg) => (c.deriveFg ? onColour(bg) : c.fg);
  return `
format = """$username$hostname$directory$git_branch$git_status$character"""

[username]
show_always = true
style_user = "bg:${c.context} fg:${c.contextFg}"
style_root = "bg:${c.error} fg:${fgOn(c.error)}"
format = '[ $user ]($style)'

[hostname]
ssh_only = false
style = "bg:${c.context} fg:${c.contextFg}"
format = "[@$hostname ]($style)[${SEP}](fg:${c.context} bg:${c.dir})"

[directory]
style = "bg:${c.dir} fg:${fgOn(c.dir)}"
format = '[ $path ]($style)'
truncation_length = 3
truncation_symbol = "\\u2026/"

[git_branch]
symbol = "${BRANCH} "
style = "bg:${c.clean} fg:${fgOn(c.clean)}"
# EVERY ARROW IS DRAWN BY A MODULE THAT KNOWS BOTH SIDES OF IT. That is the
# rule this file now follows without exception, and it is why the arrow into
# this segment lives here rather than at the end of the directory segment: an
# arrow is coloured fg=block-on-its-left, bg=block-on-its-right, so only a
# module that knows both can get it right.
format = "[${SEP}](fg:${c.dir} bg:${c.clean})[ $symbol$branch]($style)"

[git_status]
# Shares git_branch's colour and its block, and is NOT wrapped in an optional
# (...) group, so inside a repo this always renders and is therefore always
# the last block. That is what makes the closing arrow below deterministic.
style = "bg:${c.clean} fg:${fgOn(c.clean)}"
format = "[ $all_status$ahead_behind ]($style)[${SEP}](fg:${c.clean})"

[character]
# NO ARROW HERE. It used to close the prompt with an arrow coloured ${'$'}{clean},
# but [character] cannot know which block actually rendered last: with changes
# in the tree the last block was the status one, so the closing arrow came out
# in the branch colour against a different block -- the mismatch reported as
# "the arrow's colour isn't the same as the background".
#
# starship has no conditional styling and no way to ask "did that module
# render", so an arrow placed here is guessing. The closing arrow now belongs
# to git_status, the module that knows it is last. Outside a git repo no
# closing arrow is drawn at all and the directory block simply ends flat --
# a slightly shorter silhouette, but never a wrong colour.
success_symbol = ""
error_symbol = ""

[line_break]
disabled = true

[cmd_duration]
min_time = 2000
format = " took $duration"
style = "fg:${P['outline']}"
`;
};

fs.writeFileSync(path.join(outDir, '9-agnoster-faithful.toml'), build(A).trimStart(), 'utf8');
fs.writeFileSync(path.join(outDir, '10-agnoster-themed.toml'), build(T).trimStart(), 'utf8');
console.log('wrote 9-agnoster-faithful.toml and 10-agnoster-themed.toml');
console.log('agnoster colours :', JSON.stringify(A));
console.log('wallpaper mapping:', JSON.stringify(T));
console.log('derived foregrounds (themed):', JSON.stringify(
  Object.fromEntries(['dir', 'clean', 'dirty', 'error'].map((k) => [k, `${T[k]} -> ${onColour(T[k])}`]))));
