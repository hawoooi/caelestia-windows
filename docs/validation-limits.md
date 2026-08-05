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

   v3 (the current character-scanner) closes both: it doesn't need to find `*/` to know it's
   "past" a comment the way a greedy-vs-non-greedy regex choice would, and it never treats
   in-string text as a comment delimiter in the first place, because it tracks which context it's
   in as it goes rather than pattern-matching after the fact.
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
- **Two consecutive bad-but-undetected applies exhaust both generations.** The
  `last-good`/`last-good-prev` buffer (below) survives exactly one undetected-bad apply, not two.
  If a bad apply slips past every check, and a second bad apply slips past every check again before
  anyone notices and reapplies a genuinely good theme, `last-good-prev` now holds the first bad
  generation and `last-good` holds the second - there is no third generation to fall back to. This
  is the buffer's designed scope, not an oversight; making it explicit here so the boundary isn't
  assumed away.
- **`last-good-prev` is never read automatically.** The rollback path in `Apply-Theme` only ever
  restores from `last-good` when the post-copy log check fails; `last-good-prev` is not consulted
  by any code path. It exists solely as a manual human recovery option (copy its files over live
  by hand) if `last-good` itself later turns out to have been bad. Do not assume it's an automatic
  second line of defence - it isn't wired to anything.

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
