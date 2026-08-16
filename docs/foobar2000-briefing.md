# foobar2000 retheming — briefing for a separate agent

You are working on ONE task, in its own terminal, alongside a larger
wallpaper-driven theming project. Read this whole file before touching anything.

## Your task, in order

1. **Back up foobar2000 first.** Nothing else happens until the backup exists and
   you have verified it.
2. **Retheme foobar2000** to match the desktop described below.

## Where foobar2000 lives

It is a **portable install**, not a Program Files one:

```
C:\Users\PC\Music\foobar2000\
```

`portable_mode_enabled` is present at the root, which means **all configuration
lives under `profile\`, not in `%APPDATA%`**. The whole tree is ~25 MB.

Relevant paths:

- `profile\` — the entire live configuration. This is what matters.
- `profile\theme.fth` — the active theme export.
- `themes\*.fth` — the stock themes that shipped with it (Black, Blue, Dark
  Grey Orange, Faded, Gray…). These are *examples of the format*, and the
  closest starting point is whichever dark one is nearest the palette below.
- `components\` — installed components. `foo_discord_rich` is one; check what
  else is there, because the UI component in use decides what "theming" even
  means (Default UI and Columns UI are configured completely differently).

**It is running right now** (`foobar2000.exe`, portable path above). foobar2000
writes its configuration on exit, so anything you change on disk while it is
running can be overwritten when it closes. Decide deliberately whether to close
it first — and if you do, tell the user, because it is their music player.

## The backup

Put it somewhere obviously outside the app:

```
C:\Users\PC\Documents\git\setup\state\foobar2000-backup\<yyyyMMdd-HHmmss>\
```

Back up **at least `profile\`**, which is the irreplaceable part; the rest is a
re-downloadable application. Backing up the whole folder is only ~25 MB and is
the safer choice.

Verify the backup by counting files and comparing against the source, and say
the number out loud in your report. A backup nobody checked is not a backup —
this project has been bitten by exactly that class of assumption.

## The palette

This desktop is themed from the current wallpaper by `matugen`, and every
surface on it uses these exact values. They are **Material You roles**, and the
mapping matters more than the hex:

| role | hex | used for |
|---|---|---|
| `surface` | `#0e1415` | the base background of every panel, bar and dock |
| `surface_container` | `#1a2121` | a raised block on that base (rows, tiles) |
| `surface_container_high` | `#252b2b` | hover/selected state, one step lighter again |
| `on_surface` | `#dde4e4` | primary text |
| `on_surface_variant` | `#bec8c9` | secondary/dimmed text |
| `outline` | `#899393` | hairlines, borders, inactive glyphs |
| `primary` | `#80d4d9` | the accent — selection, focus, the one "now" thing |
| `on_primary` | `#003739` | text ON an accent-filled surface |

**These change with the wallpaper.** Do not treat them as permanent brand
colours. If foobar2000's config format allows it, structure your work so a
future re-theme is a matter of substituting eight values — that is exactly how
the rest of this desktop works (see below). If it does not, say so plainly in
your report rather than pretending it is re-themable.

### The conventions this desktop follows

Copy these, so foobar2000 looks like it belongs:

- **Accent is used sparingly** — one accented thing per view, the item that is
  "now" (the playing track, the selected row). Everything else is surface and
  text. A UI where five things are teal reads as noise.
- **Depth comes from surface steps, not from borders or shadows.** Nothing in
  this desktop casts a shadow. A raised element is `surface_container` on
  `surface`; a hovered one is `surface_container_high`.
- **Selection is a filled rounded rectangle**, not an outline and not a full-row
  underline.
- **Dark throughout.** There is no light mode.

## The wider project, for context only

`C:\Users\PC\Documents\git\setup` is a wallpaper-driven theming pipeline:
`matugen` extracts a Material You palette from the current wallpaper and
regenerates WezTerm, starship, a Zebar desktop shell and komorebi's window
border colours. Its `CLAUDE.md` is the working knowledge for all of it.

**You are NOT being asked to wire foobar2000 into that pipeline.** That would
mean a matugen template, a staging output, a validation step and an entry in
`$script:Targets` — a much larger change. Your job is to make foobar2000 match
the palette above, by hand, and to report clearly on whether templating it
later is feasible. If you find it obviously templatable, say what the template
would need to touch; do not build it unasked.

## House rules that apply to you

These are the project's, and they exist because each was paid for:

- **Never use `Set-Content -Encoding UTF8` or `Out-File` for a config file.**
  Both emit a UTF-8 BOM, and configuration parsers here have silently rejected
  BOM'd files with an unrelated-looking error. Use
  `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`.
- **PowerShell 5.1 only.** No `&&`, no `||`, no ternary, no `??`, no `` `e ``
  escape (that is PS6+; use `[char]27`). PowerShell variable names are
  case-insensitive, so `$w` and `$W` are the same variable.
- **Verify by looking, not by reading state.** Screenshot the result. This
  project's every significant defect was found by looking at an image; several
  were missed by everything else. A clean log is not proof.
- **Report honestly.** If something did not work, say so with the output. If
  you skipped part of the task, say which part and why. Do not describe work
  you did not do.

## What to report back

1. Where the backup is, and how many files it contains.
2. Which UI component foobar2000 is actually using, and how you determined it.
3. What you changed, file by file.
4. A screenshot of the result.
5. Whether this is templatable into the matugen pipeline later, and what that
   would take.

---

# STATE AT RESTART — 2026-08-16 21:15. READ THIS BEFORE THE TASK LIST ABOVE.

An earlier agent worked this task for roughly two hours and **its transcript was
never written to disk**, because it inherited a `CLAUDE_CODE_CHILD_SESSION`
marker that silently disables transcript persistence. Its reasoning is
unrecoverable. Only the artifacts below survive, and they are the whole record.
This session is started with `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` so the
same thing does not happen twice.

**Nothing below is a suggestion to redo. It is done. Do not repeat it, and do
not undo it without saying why.**

## Established facts

- **The backup exists and is verified**:
  `state/foobar2000-backup/20260816-193112/`, **158 files**. The live install
  is 159 files / 24.9 MB, so confirm the one-file difference is benign (likely a
  lock or a file created after the copy) before relying on it.
- **All work happens in a DUPLICATE portable install:**
  `C:\Users\PC\Music\foobar2000-caelestia\` (511 files, 44.6 MB).
  **`C:\Users\PC\Music\foobar2000\` is the user's LIVE player and is RUNNING
  right now.** Never write to it. foobar2000 rewrites its configuration on
  exit, so edits to a running instance are lost anyway.
- **The UI is Columns UI** (`foo_ui_columns`), plus `foo_uie_webview`,
  `foo_discord_rich` and `foo_playcount`, all under
  `profile\user-components-x64\`.
- **Columns UI's own `.cfg` is CHECKSUMMED — never hand-patch it.** A written
  config with a stale checksum is rejected. Theming goes through the
  `foo_uie_webview` panel's HTML/CSS instead, which is why the artifacts below
  are a web page rather than a theme file.

## Artifacts already built, all under `setup/foobar2000/`

| file | what it is |
|---|---|
| `palette.json` | the eight Material You roles, and the **single substitution point** for a future matugen template |
| `render-theme-css.py` | `palette.json` -> `theme.css`; writes UTF-8 **no BOM** per the house rule |
| `theme.css` | generated; **do not hand-edit** |
| `mockup.html` | the panel design (~24 KB). Contains **zero colour literals** — every colour is `var(--role)`, the same discipline the Zebar pack enforces |
| `build-standalone.py` | inlines the CSS and rewrites every image to a `data:` URI, for a single self-contained page |
| `art/` | 53 cover images plus `manifest.json` |

## Question 5 is already answered

`render-theme-css.py` **is** the substitution point. A future matugen template
would replace that script and emit `theme.css` from the live wallpaper palette,
with no other change anywhere — because `mockup.html` holds no colour literals.
Do not re-derive this; build on it.

## What is genuinely unfinished

Establish this yourself rather than trusting this list — it is inferred from
files on disk, not from the previous agent, which cannot be asked:

1. Whether the webview panel is actually **wired into the duplicate install's
   Columns UI layout** and pointed at these files, or whether `mockup.html` is
   still only a standalone design.
2. A **screenshot of the result running inside foobar2000** — item 4 of the
   report above. A mockup rendered in a browser is not that, and this project's
   house rule is that looking at the real thing is the only proof.
