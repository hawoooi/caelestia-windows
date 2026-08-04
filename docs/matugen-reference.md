# matugen reference (v4.1.0)

Captured 2026-08-04 on this machine. `matugen --version` -> `matugen 4.1.0`, installed via
`cargo install matugen` (built from crates.io source, ~1m56s compile).

Probe image used: `C:\Program Files (x86)\Steam\steamapps\workshop\content\431960\1199910952\preview.jpg`

Command used to dump JSON:

```
matugen image $probe --mode dark --json hex --prefer darkness
```

Note: without `--prefer` (or `--source-color-index`), matugen can throw
`Multiple source colors found, no preference was inputted, and a terminal was not detected.`
when run non-interactively (e.g. from a script/redirected output) and the probe image has more
than one plausible source color. **Any automated call into matugen must pass `--prefer <PREFERENCE>`**
(or `--source-color-index N`) to avoid this failure. Valid `--prefer` values (from `--help`):
`darkness`, `lightness`, `saturation`, `less-saturation`, `value`, `closest-to-fallback`.

## Every role name in the JSON output

### Top-level JSON keys
`base16`, `colors`, `image`, `is_dark_mode`, `mode`, `palettes`

### `colors.*` roles (each has `.dark`, `.default`, `.light`, each of those has `.color`)

```
background
error
error_container
inverse_on_surface
inverse_primary
inverse_surface
on_background
on_error
on_error_container
on_primary
on_primary_container
on_primary_fixed
on_primary_fixed_variant
on_secondary
on_secondary_container
on_secondary_fixed
on_secondary_fixed_variant
on_surface
on_surface_variant
on_tertiary
on_tertiary_container
on_tertiary_fixed
on_tertiary_fixed_variant
outline
outline_variant
primary
primary_container
primary_fixed
primary_fixed_dim
scrim
secondary
secondary_container
secondary_fixed
secondary_fixed_dim
shadow
source_color
surface
surface_bright
surface_container
surface_container_high
surface_container_highest
surface_container_low
surface_container_lowest
surface_dim
surface_tint
surface_variant
tertiary
tertiary_container
tertiary_fixed
tertiary_fixed_dim
```

That's **48 color roles**. In a real template these are accessed as e.g.
`{{colors.primary.default.hex}}` or `{{colors.on_surface.default.rgba}}`.

### `base16.*` roles (each has `.dark`, `.default`, `.light`, each of those has `.color`)

`base00` through `base0f` (16 total): `base00`, `base01`, `base02`, `base03`, `base04`, `base05`,
`base06`, `base07`, `base08`, `base09`, `base0a`, `base0b`, `base0c`, `base0d`, `base0e`, `base0f`.

### `palettes.*` (tonal palettes, not scheme colors)

Groups: `primary`, `secondary`, `tertiary`, `error`, `neutral`, `neutral_variant`.
Each group has tone-stop keys: `0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100`,
each holding `{ "color": "#hex" }`.

### Other top-level fields

- `image` - the resolved path to the probe image (percent/URI-escaped, e.g.
  `/?/C:/Program Files (x86)/.../preview.jpg`)
- `is_dark_mode` - bool
- `mode` - `"dark"` or `"light"` (echoes `--mode`)

## `--json` format values (from `matugen --help`)

`hex`, `rgb`, `rgba`, `hsl`, `hsla`, `strip`

These select how colors are rendered *in the JSON dump* (`matugen image ... --json <FORMAT>`).
This is separate from the per-color accessor suffixes used inside templates (see below).

## Scheme type values (`-t`/`--type`, from `--help`)

Default: `scheme-tonal-spot`. Full list:

```
scheme-content
scheme-expressive
scheme-fidelity
scheme-fruit-salad
scheme-monochrome
scheme-neutral
scheme-rainbow
scheme-tonal-spot
scheme-vibrant
```

## Other useful `--help` flags discovered

- `--prefer <PREFER>` - required for non-interactive/scripted runs when the source image has
  multiple plausible source colors (see note above). Values: `darkness`, `lightness`,
  `saturation`, `less-saturation`, `value`, `closest-to-fallback`.
- `--source-color-index <0-4>` - alternative to `--prefer`; picks the Nth most dominant color and
  also suppresses the interactive prompt.
- `--fallback-color <STRING>` - color used if no good color is found in the image.
- `--dry-run` - does not generate templates, reload apps, set wallpaper, or run any commands.
  Useful for testing config files without side effects.
- `--contrast <-1..1>`, `--lightness-dark`, `--lightness-light` - contrast/lightness tuning knobs.
- `-m/--mode <light|dark>` - default `dark`.
- `--include-image-in-json <true|false>` - whether the `image` field appears in `--json` output.

## Template engine and filter syntax

matugen does **not** use Tera or Jinja2 — it has its own hand-rolled template engine
(`src/parser/engine*.rs`, `chumsky`-based parser). Verified directly from the installed
v4.1.0 source (`~/.cargo/registry/src/index.crates.io-*/matugen-4.1.0/src/parser/engine.rs`
and `.../parser.rs`):

- Keyword/expression delimiters: **`{{` and `}}`** (`EngineSyntax::default()`: `keyword_left = "{{"`,
  `keyword_right = "}}"`).
- Block delimiters (for `if`/`for`/`include`): **`<*` and `*>`** (not `{% %}` like Tera/Jinja).
  e.g. `<* if ... *>`, `<* endif *>`, `<* for x in y *>`, `<* endfor *>`, `<* include "name" *>`.
- Filter syntax is **pipe + colon**, not Tera's `| filter(arg=val)`:

  ```
  {{ <expr> | filter_name: arg1, arg2, ... }}
  ```

  Multiple filters chain with repeated `|`:

  ```
  {{ colors.primary.default.hex | to_color | set_alpha: 0.5 | format: "hex_alpha" }}
  ```

- Dotted access (`colors.primary.default.hex`) and bare literals/ints/floats/strings/booleans are
  supported as filter arguments.

### Exact filter syntax for alpha (Unknown-adjacent detail called out in the brief)

The color-role JSON values are plain hex strings; alpha is applied via filters/accessors, not by
the JSON dump. Two ways to get an alpha-aware value in a template, confirmed from
`src/main.rs` (filter registration + doc comments) and `src/parser/engine/replace.rs` (`FORMATS`):

1. **`set_alpha` filter** (float 0.0-1.0), chained after `to_color`:

   ```
   {{ "#000000" | to_color | set_alpha: 0.1 }}
   ```

   Applied to a color keyword instead of a literal:

   ```
   {{ colors.primary.default.hex | to_color | set_alpha: 0.5 | format: "hex_alpha" }}
   ```

2. **Format accessors** - every color keyword (e.g. `colors.primary.default`) exposes these
   suffixes directly (no filter needed), enumerated in `FORMATS` (`replace.rs`):

   ```
   hex, hex_stripped, hex_alpha, hex_alpha_stripped, alpha_hex, alpha_hex_stripped,
   rgb, rgba, hsl, hsla, red, green, blue, alpha, hue, saturation, lightness
   ```

   So `{{colors.primary.default.hex_alpha}}` and `{{colors.primary.default.alpha_hex}}` both give
   alpha-inclusive hex, differing only in whether alpha is prefixed or suffixed to the RGB hex.
   `{{colors.primary.default.rgba}}` / `.hsla` give alpha-inclusive functional notation.

### Full registered filter list (from `src/main.rs::add_engine_filters`)

**Colors category:**

| Filter | Args | Example |
|---|---|---|
| `set_red` | Int (0-255) | `{{ "#000000" \| to_color \| set_red: 255 }}` |
| `set_green` | Int (0-255) | `{{ "#000000" \| to_color \| set_green: 255 }}` |
| `set_blue` | Int (0-255) | `{{ "#000000" \| to_color \| set_blue: 255 }}` |
| `set_alpha` | Float (0.0-1.0) | `{{ "#000000" \| to_color \| set_alpha: 0.1 }}` |
| `set_hue` | Int (0-360) | `{{ "#000000" \| to_color \| set_hue: 360 }}` |
| `set_saturation` | Float (0-100) | `{{ "#000000" \| to_color \| set_saturation: 100.0 }}` |
| `set_lightness` | Int (0-100) | `{{ "#000000" \| to_color \| set_lightness: 100 }}` |
| `lighten` | Float amount | `{{ "#ffffff" \| to_color \| lighten: 20.0 }}` |
| `to_color` | none (parses a CSS color string into a color value) | `{{ "#ff00ff" \| to_color }}` |
| `invert` | none | `{{ "#ffffff" \| to_color \| invert }}` |
| `grayscale` | none | `{{ "#ff0000" \| to_color \| grayscale }}` |
| `auto_lightness` | Float amount (lightens dark colors, darkens light colors) | `{{ "#222222" \| to_color \| auto_lightness: 10.0 }}` |
| `saturate` | Float amount, String space (`"hsl"` or `"hsv"`) | `{{ "#336699" \| to_color \| saturate: 20.0, "hsl" }}` |
| `blend` | Color, Float amount (hue blend) | `{{ "#ff0000" \| to_color \| blend: ("#0000ff" \| to_color), 0.5 }}` |
| `harmonize` | Color (shifts hue toward target) | `{{ "#ff0000" \| to_color \| harmonize: ("#00ff00" \| to_color) }}` |
| `format` | String format name (any of the `FORMATS` list above) | `{{ "#ff00ff" \| to_color \| format: "hex" }}` |

**String category:**

| Filter | Args | Example |
|---|---|---|
| `snake_case` | none | `{{ "Hello World" \| snake_case }}` |
| `lower_case` | none | `{{ "Hello World" \| lower_case }}` |
| `camel_case` | none | `{{ "hello world" \| camel_case }}` |
| `pascal_case` | none | `{{ "hello world" \| pascal_case }}` |
| `kebab_case` | none | `{{ "hello world" \| kebab_case }}` |
| `replace` | String find, String replacement | `{{ "hello world" \| replace: "world", "there" }}` |

Filters that operate on colors require the value already be a `Color` type - apply `to_color`
first if starting from a string literal. Values coming from `colors.<role>.<variant>` keywords
are already color-typed and don't need `to_color`.

## Config file schema (`--config`/`-c`)

**Important, version-specific gotcha found while doing the BOM test:** the TOML config file
requires a top-level `[config]` table (even if empty) — `[templates.*]` alone is **not**
sufficient in v4.1.0 and produces:

```
TOML parse error at line 1, column 1
missing field `config`
```

Minimal valid config:

```toml
[config]

[templates.<name>]
input_path = 'C:\path\to\template.tmpl'
output_path = 'C:\path\to\output.file'
```

(Confirmed against `matugen-4.1.0/src/util/config.rs`: `ConfigFile { config: Config, templates:
HashMap<String, Template> }` - `config` is not `Option<...>`, so it's mandatory, but every field
*inside* `Config` is optional, so `[config]` with nothing under it parses fine.)

## Unknown #1 - does matugen emit a BOM? **NO.**

Test performed:

```powershell
"body: {{colors.primary.default.hex}}" | Set-Content "$env:TEMP\bomtest.tmpl" -Encoding ascii
@"
[config]

[templates.bomtest]
input_path = '$env:TEMP\bomtest.tmpl'
output_path = '$env:TEMP\bomtest.out'
"@ | Set-Content "$env:TEMP\bomtest.toml" -Encoding ascii

matugen image $probe --mode dark --config "$env:TEMP\bomtest.toml" --prefer darkness
```

Result: `$bytes = [System.IO.File]::ReadAllBytes(...)` on the rendered output gave
**first 3 bytes: `62 6F 64`** (ASCII `b`, `o`, `d` - the start of the literal text `body: `).
This is **not** `EF BB BF` (the UTF-8 BOM signature).

**Conclusion: matugen does NOT emit a UTF-8 BOM in rendered template output.** The rendered file
content was exactly `body: #a2d398` with no leading bytes of any kind. **No BOM-strip step is
needed anywhere in this pipeline** (this overrides/confirms the open question from the spec -
later tasks, including Task 8's yasb file move, do not need to guard against a BOM from matugen
itself). Note this says nothing about BOMs introduced by *other* tools in the pipeline (e.g.
PowerShell `Set-Content -Encoding UTF8` elsewhere would still add one - that risk is unrelated to
matugen and is why this project's own file-write convention uses
`[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`).
