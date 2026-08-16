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
