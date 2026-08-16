// Generates the starship prompt candidates that Show-PromptCandidates.ps1
// prints. Run:  node scripts/build-prompt-candidates.mjs
//
// These are PREVIEW configs: the live matugen palette is baked in as literal
// hex so they render truthfully right now. That is also why none of them may
// be installed as-is -- a literal palette stops following the wallpaper. The
// chosen one gets ported into matugen/templates/starship.toml, where the hex
// becomes {{colors.*}} expressions.
//
// Constraints, each of which already cost a round:
//   * NO powerline separators. ~/.wezterm.lua sets cell_width = 0.9, which
//     clips them into doubled chevrons; fixing that re-spaces every character
//     in the terminal.
//   * The font is Nerd Fonts v2 (CartographCF). v3 Material Design codepoints
//     are absent. Only glyphs verified present in its cmap are used.
//   * starship's FORMAT parser has its own escape set, separate from TOML's:
//     a literal paren is backslash-paren, and a backslash-u codepoint escape
//     is rejected outright with "expected escaped_char".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outDir = path.join(repo, 'state', 'prompt-candidates');
fs.mkdirSync(outDir, { recursive: true });

// The live palette, read from the generated theme so a preview cannot drift
// from the desktop it has to sit beside.
const theme = fs.readFileSync(path.join(repo, 'zebar/caelestia/bar/theme.css'), 'utf8');
const P = {};
for (const m of theme.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) P[m[1]] = m[2];

const primary = P['primary'];
const onSurface = P['on-surface'];
const variant = P['on-surface-variant'];
const outline = P['outline'];
const container = P['surface-container'];
const containerHigh = P['surface-container-high'];
const error = '#ffb4ab';

// Verified present in CartographCF's cmap, and rendered and looked at.
const BRANCH = '\\uF418';
const FOLDER = '\\uF07B';
const CLOCK = '\\uF43A';
const GHOST = '\\uF79F';

const tail = `
[line_break]
disabled = true

[cmd_duration]
min_time = 2000
format = "took $duration "
style = "fg:${outline}"
`;

const gitPlain = `
[git_branch]
symbol = "${BRANCH} "
style = "fg:${variant}"
format = '[$symbol$branch ]($style)'

[git_status]
style = "fg:${outline}"
format = '[($all_status$ahead_behind )]($style)'
`;

const dirFull = (style, fmt) => `
[directory]
style = "${style}"
format = "${fmt}"
truncation_length = 0
truncate_to_repo = false
`;

const candidates = {
  // 1 -- One quiet line. Colour only where it means something.
  '1-minimal': `
format = """$directory$git_branch$git_status$character"""
${dirFull(`fg:${primary}`, '[$path ]($style)')}${gitPlain}
[character]
success_symbol = "[\\u276F](bold fg:${primary})"
error_symbol = "[\\u276F](bold fg:${error})"
${tail}`,

  // 2 -- The path owns a line; the command always starts at the left margin,
  //      however deep the directory is.
  '2-twoline': `
format = """$directory$git_branch$git_status$line_break$character"""
${dirFull(`fg:${primary}`, `[${FOLDER} $path ]($style)`)}${gitPlain}
[line_break]
disabled = false

[character]
success_symbol = "[\\u276F](bold fg:${primary})"
error_symbol = "[\\u276F](bold fg:${error})"

[cmd_duration]
min_time = 2000
format = "took $duration "
style = "fg:${outline}"
`,

  // 3 -- One raised surface for the path, everything else flat. The desktop's
  //      own grammar: a single container, one accent, no chain of blocks.
  '3-pill': `
format = """$directory$git_branch$git_status$time$character"""
${dirFull(`bg:${container} fg:${primary}`, '[ $path ]($style)')}${gitPlain}
[time]
disabled = false
time_format = "%R"
style = "fg:${outline}"
format = '[  $time]($style)'

[character]
success_symbol = "[ \\u276F](bold fg:${primary})"
error_symbol = "[ \\u276F](bold fg:${error})"
${tail}`,

  // 4 -- Structure from punctuation rather than colour, so it survives a
  //      low-contrast wallpaper palette.
  '4-bracket': `
format = """$directory$git_branch$git_status$character"""
${dirFull(`fg:${onSurface}`, '[\\u276F $path]($style) ')}
[git_branch]
symbol = ""
style = "fg:${primary}"
format = '[\\($branch]($style)'

[git_status]
style = "fg:${outline}"
format = '[$all_status$ahead_behind](fg:${outline})[\\)](fg:${primary}) '

[character]
success_symbol = "[\\u2192](bold fg:${primary})"
error_symbol = "[\\u2192](bold fg:${error})"
${tail}`,

  // 5 -- The bar's own ghost as the prompt character, path truncated to three.
  '5-ghost': `
format = """$directory$git_branch$git_status$character"""

[directory]
style = "fg:${primary}"
format = "[$path ]($style)"
truncation_length = 3
truncate_to_repo = false
${gitPlain}
[character]
success_symbol = "[${GHOST}](fg:${primary})"
error_symbol = "[${GHOST}](fg:${error})"
${tail}`,

  // 6 -- Everything on one raised surface, the way the bar groups related
  //      items onto a single continuous pill rather than separate chips.
  '6-grouped': `
format = """$directory$git_branch$git_status$character"""
${dirFull(`bg:${container} fg:${primary}`, '[ $path ]($style)')}
[git_branch]
symbol = "${BRANCH} "
style = "bg:${container} fg:${variant}"
format = '[$symbol$branch ]($style)'

[git_status]
style = "bg:${container} fg:${outline}"
format = '[($all_status$ahead_behind )]($style)'

[character]
success_symbol = "[ \\u276F](bold fg:${primary})"
error_symbol = "[ \\u276F](bold fg:${error})"
${tail}`,

  // 7 -- Just the directory NAME, not the path. The shortest thing that still
  //      answers "where am I" for someone who lives in a few repos.
  '7-basename': `
format = """$directory$git_branch$git_status$character"""

[directory]
style = "fg:${primary}"
format = "[$path ]($style)"
truncation_length = 1
truncate_to_repo = false
${gitPlain}
[character]
success_symbol = "[\\u276F](bold fg:${primary})"
error_symbol = "[\\u276F](bold fg:${error})"
${tail}`,

  // 8 -- Two lines with a rule down the left, so a long command and a long
  //      path never crowd each other.
  '8-rail': `
format = """[\\u256D\\u2500 ](fg:${outline})$directory$git_branch$git_status$line_break[\\u2570\\u2500](fg:${outline})$character"""
${dirFull(`fg:${primary}`, '[$path ]($style)')}${gitPlain}
[line_break]
disabled = false

[character]
success_symbol = "[\\u276F](bold fg:${primary})"
error_symbol = "[\\u276F](bold fg:${error})"

[cmd_duration]
min_time = 2000
format = "took $duration "
style = "fg:${outline}"
`,
};

for (const [name, body] of Object.entries(candidates)) {
  fs.writeFileSync(path.join(outDir, `${name}.toml`), body.trimStart(), 'utf8');
}
console.log(`wrote ${Object.keys(candidates).length} candidates to ${outDir}`);
console.log('palette:', JSON.stringify({ primary, onSurface, variant, outline, container, containerHigh }));
