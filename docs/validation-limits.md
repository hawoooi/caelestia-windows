# Validation limits - what Apply-Theme actually catches, and what it can't

Captured 2026-08-05 on this machine (branch `feat/theming-pipeline`, Task 8), after live testing
found a structural gap in the original design. This doc exists so the gap is documented where a
future reader will find it, not just buried in a task report.

**Retirement note (branch `feat/borders-and-yasb-retirement`):** yasb and tacky-borders were
retired as theming targets -- yasb's `[templates.yasb]` entry, its `Test-StagedFile` branch, its
post-copy `yasb.log` check, and its `$script:Targets` row are all gone from
`scripts/Apply-Theme.ps1`/`matugen/config.toml`; tacky-borders' equivalents went with it (it was
never installed on this machine to begin with). Everything below describing yasb's and
tacky-borders' validation ceiling is kept as historical record -- the reasoning (structural checks
catch corruption *shape*, not semantic correctness; a clean log is not proof of a correct render)
still applies to every remaining target, including zebar's own `Test-StagedFile` branch, which
reuses the same `Measure-CssBraces` scanner yasb's did. Nothing below describes anything this
pipeline currently renders or copies for yasb/tacky-borders.

## The yasb blind spot

**A clean `yasb.log` after `yasbc reload` is not evidence that `styles.css` rendered correctly.**
yasb can (and did, live, on this machine) deploy a visibly broken stylesheet - every chip losing
its background, border, padding, and spacing - while logging nothing that matches
`error|critical|invalid|could not be read`.

### Why, with evidence

yasb ships as a frozen PyInstaller app with no readable `.py` source, but its bundled
`library.zip` contains `.pyc` files whose string constants are plain, readable text. Extracted it
(`unzip lib/library.zip`) and inspected `core/utils/css_processor.pyc`:

- `CSSProcessor._read_css_file` wraps its file read in `try`/`except (FileNotFoundError, OSError)`
  and logs `"CSSProcessor Error '%s': %s"` on those specifically - **file-level** errors
  (missing file, permission denied), not content errors.
- yasb bundles `tinycss2`, a real, spec-compliant CSS parser. The CSS spec mandates lenient error
  recovery: parsers must skip unparseable rules and resync, not raise. This is exactly what was
  observed - Qt's own stylesheet engine (also lenient by spec) and yasb's `tinycss2`-based
  preprocessing both tolerate genuinely malformed CSS silently.
- Searched every extracted `.pyc` string table for `"invalid"` in the config/CSS-processing
  modules: no content-level validation exists anywhere in the pipeline.

### What was actually tested (not theorized)

Two live corruption attempts against the real `matugen/templates/yasb.styles.css`, each followed
by a real (non-`-DryRun`) `Apply-Theme` call and a screenshot of the bar's top 36px:

1. An orphan closing brace (`}`) prepended to the file - tolerated silently, bar visually intact.
   Inconclusive on its own.
2. An **unterminated** opening brace (`.corruption-test-unterminated-block-do-not-ship {`,
   never closed) wrapping every real selector after it - `Apply-Theme` returned `Success = $true,
   Failed = @()`, `yasb.log` stayed completely clean across the reload, and the bar was **visibly
   broken**: every chip lost its background, border, and padding; metrics ran together illegibly.

Full detail, including the SHA256-verified manual restore performed afterward (since automatic
rollback did not trigger - there was nothing to trigger it), is in
`.superpowers/sdd/2026-08-04-wallpaper-theming-pipeline/task-8-report.md`.

### The fix: move validation before the copy, make it structural

Since the post-copy log signal is provably unreachable for this failure class, `Test-StagedFile`'s
`'yasb'` case (in `scripts/Apply-Theme.ps1`) validates the **staged** file - before anything is
copied to a live path - using properties a palette swap can never legitimately change:

1. **Balanced braces, counted by a string-aware scanner (`Measure-CssBraces`), not a regex
   comment-stripper.** Scans the file once, character by character, tracking two states -
   `InComment` (entered on `/*`, exited on `*/`) and `InString` (entered on `'`/`"`, exited on the
   matching quote, respecting `\`-escapes) - and only counts `{`/`}` when in neither. An
   unterminated `/*` still open at end-of-file is itself treated as suspicious and rejected. This
   alone catches the unterminated-block corruption above (175 open vs 174 close on the real
   render, confirmed by re-running the corruption test after this fix - see the task 8 report's
   re-verification section).

   **This went through two iterations, both found live by external review, neither
   reachable through today's actual template but both latent in a general-purpose check:**

   - *v1 (regex `[regex]::Replace($text, '(?s)/\*.*?\*/', '')`) was defeated at full real-file
     scale* by deleting one closing brace from a real rule (`.cpu-widget .icon { ... }`, leaving
     it unterminated) and adding a single compensating `}` inside an unrelated header comment
     (`/* MEMORY */` -> `/* MEMORY } */`). Raw count: 175/175, masked. `Test-StagedFile` returned
     `$true`.
   - *v2 (the regex fix) was itself defeated* by a construction with no notion of string context:
     `.a { content: "/*"; color: red; .b { color: blue; } .c { content: "*/"; } .d { ... } }`. `.a`
     is genuinely unterminated (raw count 4 open / 3 close), but the `/*`/`*/` markers live inside
     *string values* in two different rules; the regex strips everything between them - deleting
     `.b`'s entire rule along with fragments of `.a`/`.c` - leaving a stripped count of 2/2,
     balanced, another false pass. **Proven empirically against the actual v1 code before landing
     the v3 fix**, not just asserted: the same construction run through the v1 regex reduces 4/3 to
     2/2; run through `Measure-CssBraces` (v3, current) it correctly reports 4/3 and rejects.

   v3 (the character-scanner) closes both: it doesn't need to find `*/` to know it's "past" a
   comment the way a greedy-vs-non-greedy regex choice would, and it never treats in-string text
   as a comment delimiter in the first place, because it tracks which context it's in as it goes
   rather than pattern-matching after the fact.

   - *v3 itself had an asymmetry, also found by external review*: `Measure-CssBraces` surfaced
     `UnterminatedComment` (an unclosed `/*` at end-of-file) but had no equivalent for strings. An
     unclosed `"` or `'` swallows everything to EOF as "inside a string" - including any real
     `{`/`}` after it - and if what's left of the count happens to balance, the file passes.
     Reviewer's reproduction: `.a{...} .b{...} .c[title="unterminated` + newline + `{ color: green;
     }` - the unterminated quote swallows the newline and the *next real rule's* opening brace as
     string content; Open=2/Close=2 (coincidentally balanced), `UnterminatedComment=$false`,
     `Test-StagedFile` returned `$true`. **Confirmed both with no baseline and with a baseline
     hand-tuned to also match on size and rule count** - i.e. this wasn't only caught by the
     other three checks as a fallback; without the fix, nothing catches it. Proven empirically
     against the pre-fix scanner before landing the fix: `Measure-CssBraces` on that exact input
     returned `Open=2; Close=2; UnterminatedComment=$false` (no `UnterminatedString` field existed
     yet), and `Test-StagedFile` returned `$true` on it.
   - v4 (current) adds an `UnterminatedString` flag, set when the scanner ends the file still
     `InString`, and `Test-StagedFile` rejects on it with its own warning
     (`"styles.css has an unterminated string literal -- truncated or corrupt"`), symmetric with
     the existing `UnterminatedComment` rejection. Verified with three regression tests: the
     reviewer's exact double-quote construction, a single-quote analog of the same shape, and a
     positive control file using well-formed (properly closed) quoted strings of the same kind -
     confirming the fix doesn't over-reject legitimate `content:`-style string values.
2. **No unresolved `{{`** (generic check, already existed, applies to every target).
3. **Selector-count sanity.** Total `{` count (from `Measure-CssBraces`, both sides) compared
   against `state/last-good/styles.css`, tolerance ±5%. A palette swap only rewrites color values
   inside existing rules; it never adds or removes rule blocks. Skipped when no last-good baseline
   exists yet (first-ever apply). String-and-comment-aware on the last-good side too - the real
   `state/last-good-prev/styles.css` carries a multi-line "Acrylic recipe" prose comment that could
   itself gain a stray brace and skew the baseline if counted naively.
4. **Size sanity.** Staged byte length compared against last-good's, tolerance ±20%. Catches
   truncation and runaway duplication that could coincidentally preserve rule count and brace
   balance. Deliberately stays on the *raw* (comment-included) byte length - a comment is
   legitimate file content, and stripping it here would let comment-based padding or truncation
   slip past this specific check.

Each of these four checks has a corresponding Pester test in `tests/ApplyTheme.Tests.ps1`
(`Describe "Test-StagedFile yasb structural checks"`) that constructs a staged file violating
exactly that one property and asserts rejection - not just a happy-path fixture. Regression tests
cover both the original comment-masking construction and the string-context attack that defeated
the first fix for it, plus a positive test confirming a file with legitimate `content: "/*"`-style
string values (not corrupt, just comment-*looking*) is correctly accepted, and an unterminated-
comment test. A check that has never rejected anything is not a check (this project already paid
for that lesson once, on Task 2's `Test-StagedFile`-adjacent work).

**The post-copy `yasb.log` grep is kept as a secondary signal**, not removed - it still catches the
one failure class it *can* see (file-level read errors), and it's nearly free to check. It must
never again be the *only* signal for this target.

### Update: the log-grep pattern itself was too broad (final fix wave, I1)

The post-copy check originally matched the whole yasb.log tail against
`(?i)error|critical|invalid|could not be read`. yasb.log carries **every widget's** own log
output on the same timeline, not just CSS-loading messages - live capture found 7 lines matching
that pattern with zero relation to `styles.css` (a `traffic_manager.py` JSON parse error, a
`glazewm_client` WebSocket reconnect warning, a `KeyError` from an unrelated menu callback). Any
one of those landing in the 8-second post-copy window triggered a full four-target rollback for a
stylesheet that was never the problem. `Test-YasbLogFailure` (in `scripts/Apply-Theme.ps1`)
narrows the match to `(?i)CSSProcessor` - the identifier this doc's own source-extraction above
confirms is unique to `CSSProcessor._read_css_file`'s error log line
(`"CSSProcessor Error '%s': %s"`), i.e. still the one failure class this check can actually see,
with the unrelated-widget false positives eliminated. tacky-borders' log check keeps the original
broad pattern - it logs only its own activity, not dozens of unrelated widgets, so this
false-positive class doesn't apply there.

### Update: tacky-borders now gets a real pre-copy structural check (final fix wave, I2)

`Test-StagedFile`'s `switch` previously had no `'tacky'` case at all, so it fell through to
`default { return $true }` - **zero validation**, verified: a staged file containing literally
`"totally: garbage`n`not even: [yaml"` passed unconditionally. It now checks for the five expected
top-level keys (`watch_config_changes`, `enable_logging`, `rendering_backend`, `global`,
`window_rules`) and a balanced quote count - a structural sanity check, same ceiling as yasb's
(no offline YAML parser available either), not a real parse.

### Update: starship's PATH guard (final fix wave, I3)

If `starship` isn't resolvable on `PATH`, `& starship prompt` previously raised a non-terminating
"term not recognized" error, leaving `$LASTEXITCODE` at whatever it was **before** that call - in
the real `Apply-Theme` flow, `0`, from matugen's own preceding success check. That stale `0` read
as "starship accepted the config", silently passing validation for a target that was never
actually checked. `Test-StagedFile`'s `'starship'` case now guards with
`Get-Command starship -ErrorAction SilentlyContinue` first and fails closed if it's missing.

## What this does NOT fix

- **These are structural checks, not a real CSS validator.** As of this fix, the structural checks
  reliably catch truncation, unbalanced braces, unterminated comments, unterminated strings, and
  unresolved template expressions - the failure shapes a corrupted or partially-rendered file
  actually takes. What they cannot catch is a staged file with the right brace count, the right
  rule count, a plausible size, no unterminated comment or string, but genuinely wrong *content* -
  a color swapped for the wrong role, a typo'd property name, any semantically wrong-but-plausible
  value. There is no offline QSS/CSS validator available on this machine to catch that class of
  error. Visual confirmation (screenshot the bar, per `~/.config/yasb/CLAUDE.md`) remains the real
  gate for that gap, and after every real apply generally.
- **tacky-borders remains genuinely untestable here** - not installed/running (Task 1 finding,
  unchanged). Its post-copy log check stays conditional on the process actually running.
- **starship fails silently on some bad values** - `starship prompt` exits 0 even when a color
  name doesn't resolve to visible styling (documented in the Task 8 brief's own constraints,
  not independently re-verified this round). `Test-StagedFile`'s starship check catches a
  non-zero exit, not a silently-wrong-but-valid one.
- **Two consecutive bad-but-undetected applies exhaust both generations.** The
  `last-good`/`last-good-prev` buffer (below) survives exactly one undetected-bad apply, not two.
  If a bad apply slips past every check, and a second bad apply slips past every check again before
  anyone notices and reapplies a genuinely good theme, `last-good-prev` now holds the first bad
  generation and `last-good` holds the second - there is no third generation to fall back to. This
  is the buffer's designed scope, not an oversight; making it explicit here so the boundary isn't
  assumed away.
- **`last-good-prev` is never read automatically.** Neither is `last-good`, as of the final fix
  wave - see "`state/pre-apply/` - the rollback source" below. `last-good-prev` is not consulted by
  any code path; it exists solely as a manual human recovery option (copy its files over live by
  hand) if `last-good` itself later turns out to have been bad. Do not assume it's an automatic
  second line of defence - it isn't wired to anything.

## `state/pre-apply/` - the rollback source (final fix wave, C2)

**Rollback no longer restores from `state/last-good/`.** It used to, and that was a real bug: the
scenario below is not hypothetical, it's the exact failure mode C2 in the final fix report exists
to close.

`last-good` is the last **validated pipeline generation** - refreshed only after a full successful
apply (see below). It is not, and was never meant to be, a snapshot of whatever happens to be live
right now. Between two applies, a live file can legitimately diverge from `last-good` with nothing
wrong at all - most concretely, a hand-edit to `~/.config/starship.toml` (or any of the other three
live configs). `~/.config` is not a git repo; a hand-edit has no history and no other backup.
If a *later* apply then fails its post-copy check, the old rollback restored `last-good` over the
live file - discarding the hand-edit and replacing it with the pipeline's own prior output, not
with what was actually live a moment before the failed apply.

`New-PreApplySnapshot` (in `scripts/Apply-Theme.ps1`) fixes this by snapshotting the CURRENTLY
LIVE content of all four targets into a directory separate from `last-good`/`last-good-prev` -
`state/pre-apply/` (gitignored: it is pure runtime scratch, rewritten in full before every live
copy, same category as `state/staging/`) - immediately before the copy loop. `Restore-
PreApplySnapshot` is what rollback now calls, on both failure paths (a partial `Copy-StagedToLive`
failure, and a post-copy log-check failure). `last-good`/`last-good-prev` keep their existing
meaning and rotation exactly as documented below - this fix does not touch or reintroduce the
Task 8 pre-copy-snapshot bug that section describes; that bug was about `last-good` being
refreshed too early (before validation), not about which directory rollback reads from.

First-apply caveat, unchanged in shape from the old `last-good`-based rollback: if a target has no
live file yet, there's nothing to snapshot for it, and a rollback finds no backup either -
`Restore-PreApplySnapshot`'s per-target `Test-Path` guard no-ops rather than erroring.

## `state/last-good/` and `state/last-good-prev/`

`Apply-Theme` only refreshes `state/last-good/` **after** an apply has passed every check -
pre-copy structural validation for all four targets, and the post-copy log check. It used to
refresh `last-good` as a pre-copy snapshot of whatever was currently live, which meant an
undetected-bad apply became the new "last known good" baseline on the very next run, silently
destroying the only real safety net. This happened live during Task 8 testing: the orphan-brace
corruption (attempt 1, undetected) got snapshotted as "last good" by attempt 2's pre-copy
snapshot step, before the human noticed anything was wrong.

Two generations are now kept: `state/last-good-prev/` holds whatever `state/last-good/` was
before the most recent successful apply, rotated in on every success. A single bad-but-undetected
apply can no longer, by itself, destroy the only known-good copy - there's one more generation
behind it (see the two-consecutive-applies caveat above for where that buffer still runs out, and
the last-good-prev-is-manual-only caveat for what "behind it" actually means in practice).

**The rotation itself is atomic**, not four independent file copies. The first version promoted
each of the four targets with its own `Copy-Item` from live straight into `last-good`/
`last-good-prev`; a crash or disk error partway through could leave the two directories holding a
*mix* of two theme generations across the four files - an inconsistent baseline that would restore
a Frankenstein theme if ever rolled back to. `Update-LastGood` (in `scripts/Apply-Theme.ps1`) now
stages the whole new generation into `state/last-good-new/` first, then promotes it as two
directory renames: `last-good` -> `last-good-prev`, `last-good-new` -> `last-good`. A rename on the
same volume is a single filesystem metadata update, not a byte copy, so the window of inconsistency
shrinks from spanning eight file copies to two renames. Verified with a dedicated Pester suite
(`Describe "Update-LastGood atomic rotation"`) against an isolated fixture, including the
first-run case (neither directory exists yet) and that a second rotation replaces
`last-good-prev` rather than accumulating a third generation.

**Even those two renames aren't a single transaction, and `Update-LastGood` accounts for the
window between them.** A crash after `last-good -> last-good-prev` succeeds but before
`last-good-new -> last-good` runs leaves `last-good` absent and `last-good-prev` populated -
reachable with no tampering at all, just bad timing. The first version of the atomic rotation
removed `last-good-prev` *unconditionally* before checking whether `last-good` existed to replace
it, so the very next successful apply would silently delete the one surviving fallback generation
with no warning - found by external review. `Update-LastGood` now only removes/replaces
`last-good-prev` when `last-good` actually exists to be promoted into it; if `last-good` is
missing but `last-good-prev` is present, `last-good-prev` is left untouched and a warning is
logged (`"last-good is missing but last-good-prev exists -- a prior rotation may have been
interrupted."`) instead of being silently discarded. Covered by its own Pester test asserting both
the file content survives and the warning fires.

**A failed rotation now surfaces instead of orphaning silently (final fix wave, I4).** Every
`Copy-Item`/`Rename-Item` inside `Update-LastGood` passes `-ErrorAction Stop`. Previously none of
them did - a mid-loop failure (e.g. one staged file missing) was non-terminating, so the loop kept
going, and both renames still ran afterward, promoting an **incomplete** `last-good-new` -
missing whichever target failed to copy - straight to `last-good`. `-ErrorAction Stop` turns that
into a terminating exception that aborts before either rename, leaving the existing `last-good`
untouched. `Apply-Theme` wraps its call to `Update-LastGood` in try/catch and warns rather than
rolling back the live apply on failure - the live theme, by the time `Update-LastGood` runs, has
already copied and passed the post-copy check; only the bookkeeping failed, which doesn't warrant
discarding a good live apply. The practical consequence of a rotation failure: the next apply's
structural baseline (and any future rollback) keeps comparing against the *previous* generation
until a future apply succeeds and `Update-LastGood` runs cleanly.

## Why `state/last-good/`+`state/last-good-prev/` are tracked in git but `state/staging/`,
## `state/last-good-new/` and `state/pre-apply/` are not (M3)

`last-good`/`last-good-prev` ARE the safety net - they need to survive a fresh clone or a rebuilt
machine, not just the current working tree, so that `Test-StagedFile`'s rule-count/size comparison
and a manual human rollback have something to work from even before this repo has ever
successfully applied a theme on that machine. Committing them costs very little (four small text
files each) and buys a baseline on day one.

`state/staging/`, `state/last-good-new/`, and `state/pre-apply/` are pure runtime scratch -
completely rewritten on every apply/rotation, carrying no information that isn't trivially
reproducible by re-running the pipeline, and would be nothing but commit noise (`staging/`
churns on every single apply, dry-run or not).

**Caveat: because `last-good`/`last-good-prev` are updated by the script via direct file writes,
not through git commits, they can desync from what's actually been committed.** Running `git
clean -fdx` won't touch them directly (`git clean` only removes *untracked* files, and these are
tracked) - but any operation that resets tracked files to `HEAD` (`git checkout -- state/last-good`,
`git reset --hard`, a fresh clone before the latest baseline was ever committed) silently reverts
them to whatever was last committed, which may be an older baseline than what the pipeline has
actually been comparing against locally. If `Test-StagedFile`'s rule-count/size checks start
rejecting an apply that looks fine, checking `git status`/`git log -- state/last-good` for
uncommitted or stale baseline drift is worth doing before reaching for `-AcceptStructuralChange`.

## WezTerm's palette.lua validation ceiling (M7)

`Test-StagedFile`'s `'wezterm'` case is structural only, same ceiling as yasb/tacky: it checks that
the staged file opens with a Lua `return { ... }` table, that braces balance (after stripping
full-line comments), and that every quoted value is a 6-digit hex color. It does **not** invoke
WezTerm's own reliable content check (`docs/wezterm-integration.md`, "Validation note -
`show-keys` exit code is not reliable" - grepping unpiped `show-keys` output for a known marker
line). That check requires spawning a real `wezterm.exe`/`wezterm-gui.exe` process against a
config that actually `dofile()`s the staged palette, which per that same doc's own testing-note
either means writing to the LIVE `~/.config/palette.lua` path (the one thing that doc explicitly
says never to do outside a sandboxed test - `automatically_reload_config` watches `.wezterm.lua`
itself and would reload the human's actual session) or building and tearing down a sandboxed
config on every single apply, which is slow and intrusive for an automated pre-copy gate. Not
wired in for that reason. Practical consequence: a `palette.lua` that is structurally valid
(balanced braces, all-hex values, opens with `return {`) but would still fail WezTerm's actual Lua
execution - e.g. a typo'd table key the `window-focus-changed` handler expects - is not caught by
`Apply-Theme`. Same gap class as yasb/tacky: structural, not semantic; visual confirmation remains
the real gate.
