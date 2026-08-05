# Validation limits - what Apply-Theme actually catches, and what it can't

Captured 2026-08-05 on this machine (branch `feat/theming-pipeline`, Task 8), after live testing
found a structural gap in the original design. This doc exists so the gap is documented where a
future reader will find it, not just buried in a task report.

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

1. **Balanced braces.** Counts `{` vs `}` in the whole file. This alone catches the unterminated-
   block corruption above (176 open vs 175 close on the real render, confirmed by re-running the
   corruption test after this fix - see the task 8 report's re-verification section).
2. **No unresolved `{{`** (generic check, already existed, applies to every target).
3. **Selector-count sanity.** Total `{` count compared against `state/last-good/styles.css`,
   tolerance ±5%. A palette swap only rewrites color values inside existing rules; it never adds
   or removes rule blocks. Skipped when no last-good baseline exists yet (first-ever apply).
4. **Size sanity.** Staged byte length compared against last-good's, tolerance ±20%. Catches
   truncation and runaway duplication that could coincidentally preserve rule count and brace
   balance.

Each of these four checks has a corresponding Pester test in `tests/ApplyTheme.Tests.ps1`
(`Describe "Test-StagedFile yasb structural checks"`) that constructs a staged file violating
exactly that one property and asserts rejection - not just a happy-path fixture. A check that has
never rejected anything is not a check (this project already paid for that lesson once, on
Task 2's `Test-StagedFile`-adjacent work).

**The post-copy `yasb.log` grep is kept as a secondary signal**, not removed - it still catches the
one failure class it *can* see (file-level read errors), and it's nearly free to check. It must
never again be the *only* signal for this target.

## What this does NOT fix

- **These are structural checks, not a real CSS validator.** A staged file with the right brace
  count, the right rule count, and a plausible size, but genuinely wrong property values (a color
  swapped for the wrong role, a typo'd property name) will still pass. There is no offline QSS/CSS
  validator available on this machine to catch that class of error. Visual confirmation
  (screenshot the bar, per `~/.config/yasb/CLAUDE.md`) remains necessary after every real apply.
- **tacky-borders remains genuinely untestable here** - not installed/running (Task 1 finding,
  unchanged). Its post-copy log check stays conditional on the process actually running.
- **starship fails silently on some bad values** - `starship prompt` exits 0 even when a color
  name doesn't resolve to visible styling (documented in the Task 8 brief's own constraints,
  not independently re-verified this round). `Test-StagedFile`'s starship check catches a
  non-zero exit, not a silently-wrong-but-valid one.

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
behind it.
