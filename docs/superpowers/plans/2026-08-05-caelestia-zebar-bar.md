# Caelestia-style Zebar Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A docked vertical Zebar bar reproducing Caelestia's entry model, themed by the existing wallpaper pipeline, with one morphing interaction.

**Architecture:** A buildless Zebar pack authored in this repo and junctioned into `~/.glzr/zebar/`. Plain HTML/CSS/JS — no bundler, because a bundler owns the CSS and matugen must be able to write `theme.css`. Entries are config-driven, mirroring `Bar.qml`'s `DelegateChooser`. Colour lives only in the generated `theme.css`; `style.css` contains none.

**Tech Stack:** Zebar 3.x (WebView2, Chromium 151), vanilla JS + ES modules, Windows PowerShell 5.1, Pester 6, `node --test` (Node 22), matugen 4.1.0.

**Spec:** `docs/superpowers/specs/2026-08-05-caelestia-zebar-bar-design.md`

## Global Constraints

- **Windows PowerShell 5.1 only.** No `pwsh`, `&&`, `||`, ternary, `??`. Use `;` and `if ($?) { }`.
- **All PowerShell file writes:** `[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`. Never `Set-Content -Encoding UTF8` / `Out-File` for a file another tool reads.
- **`style.css` must contain ZERO colour literals.** Every colour is `var(--…)` resolved from the generated `theme.css`. This is what removes the migration risk the yasb work suffered — do not undermine it.
- **A human is using this machine.** yasb, komorebi, WezTerm and VS Code are running and must keep running. Never kill them. Screenshots are the sanctioned way to verify visuals.
- **yasb keeps running throughout.** This bar coexists; it does not replace anything in this plan.
- Every new test must be **proven to fail before the fix**. This project shipped vacuous tests twice.
- Commit per task.

## Zebar API — ground truth

Taken verbatim from `C:\Program Files\glzr.io\Zebar\_up_\_up_\resources\starter\with-komorebi.html`:

```js
import * as zebar from 'https://esm.sh/zebar@3.0';

const providers = zebar.createProviderGroup({
  network:  { type: 'network' },
  komorebi: { type: 'komorebi' },
  date:     { type: 'date', formatting: 'EEE d MMM t' },
  audio:    { type: 'audio' },
  media:    { type: 'media' },
});

providers.outputMap;            // current values, keyed as above
providers.onOutput(() => { });  // subscribe to changes
```

Confirmed komorebi output shape: `output.komorebi.currentWorkspaces` (array, each with `.name`) and `output.komorebi.focusedWorkspace.name`.

---

### Task 1: Spike — resolve open unknowns

Nothing else starts until this lands. Three unknowns could change the design and one could break the bar at boot.

**Files:**
- Create: `docs/zebar-reference.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/zebar-reference.md`, the authoritative answer to each unknown. Every later task reads it before writing provider code.

- [ ] **Step 1: Does the komorebi provider expose the focused window title?**

Build a throwaway probe widget in `$env:TEMP` that dumps the whole komorebi output as JSON into the page body, load it, and screenshot. The starter template shows only `currentWorkspaces` and `focusedWorkspace`, so expect this to be **absent** — confirm either way.

```html
<script type="module">
  import * as zebar from 'https://esm.sh/zebar@3.0';
  const p = zebar.createProviderGroup({ komorebi: { type: 'komorebi' } });
  p.onOutput(() => {
    document.body.textContent = JSON.stringify(p.outputMap.komorebi, null, 2);
  });
</script>
```

Record the full output shape. If no window title, `activeWindow` uses the `EnumWindows` fallback (Step 5).

- [ ] **Step 2: Can the `zebar` module be vendored locally?**

The starter imports from `https://esm.sh/zebar@3.0` — a CDN. A bar that needs internet at boot will fail after a router reboot, which is unacceptable for a status bar.

```powershell
Invoke-WebRequest "https://esm.sh/zebar@3.0" -OutFile "$env:TEMP\zebar-probe.js"
Get-Content "$env:TEMP\zebar-probe.js" -Head 20
```

esm.sh usually returns a re-export shim pointing at further URLs. Determine whether a self-contained copy is obtainable (follow the redirects, or check for a bundled build on npm). Record: **can it be vendored, and if so how.** If not, record that the bar has a hard network dependency at startup — that is a real limitation the README must state.

- [ ] **Step 3: Does `dockToEdge` reserve space komorebi respects?**

Create a minimal pack in `$env:TEMP` with `dockToEdge: { enabled: true, edge: "left", windowMargin: "0px" }`, width `52px`, height `100%`. Register it, start it, then:

```powershell
$s = komorebic state 2>$null | Out-String | ConvertFrom-Json
$s.monitors.elements[0].work_area_size | Format-List
```

`left` should become ~52. If it does not, the fallback is a manual `work_area_offset` in `komorebi.json` — record which is needed.

**Clean up the probe widget afterward.**

- [ ] **Step 4: Does Zebar hot-reload CSS?**

With the probe widget running, edit its stylesheet on disk (change a background colour) and screenshot before and after without restarting Zebar. Record whether the change appears, and how quickly.

- [ ] **Step 5: Can `privileges.shellCommands` invoke the Vesktop helper?**

The helper already exists and is proven: `C:\Users\PC\.config\yasb\scripts\vesktop-unread.exe`. It prints a ping count, or `idle` with `--idle`.

Determine from `resources/zpack-schema.json` (on disk at `C:\Program Files\glzr.io\Zebar\_up_\_up_\resources\zpack-schema.json`) what `privileges.shellCommands` accepts — an allowlist of programs? shell strings? — and what the JS-side call looks like. Record the exact invocation and the polling model.

- [ ] **Step 6: Write `docs/zebar-reference.md` and commit**

Record all five answers with the evidence for each. **State only what you ran.** A prior task in this project shipped a comment claiming something was "verified" when nothing had been rendered.

```powershell
cd C:\Users\PC\Documents\git\setup
git add docs/zebar-reference.md
git commit -m "docs: resolve Zebar unknowns for the vertical bar"
```

---

### Task 2: `Install-Config.ps1`

Installs untracked live config idempotently. Built before the pack because the junction is what makes the pack loadable.

**Files:**
- Create: `scripts/Install-Config.ps1`
- Create: `tests/InstallConfig.Tests.ps1`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Set-ManagedJunction -LinkPath <string> -TargetPath <string>` — creates/repairs a directory junction; returns `$true` if it points at the target after the call.
  - `Set-PatchedBlock -Path <string> -Marker <string> -Content <string> -CommentPrefix <string>` — inserts or replaces a marker-delimited block; idempotent.
  - `Remove-PatchedBlock -Path <string> -Marker <string> -CommentPrefix <string>`
  - `Install-Config [-DryRun] [-Uninstall]`

- [ ] **Step 1: Write the failing tests**

`tests/InstallConfig.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot\..\scripts\Install-Config.ps1"
    $script:tmp = Join-Path $env:TEMP "installcfg-tests"
}

BeforeEach {
    if (Test-Path $script:tmp) { Remove-Item $script:tmp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $script:tmp | Out-Null
}

Describe "Set-PatchedBlock" {
    It "appends a block when the marker is absent" {
        $f = Join-Path $script:tmp "a.conf"
        [System.IO.File]::WriteAllText($f, "existing line`n", (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
        $t = [System.IO.File]::ReadAllText($f)
        $t | Should -Match 'existing line'
        $t | Should -Match '# >>> caelestia >>>'
        $t | Should -Match 'hello'
        $t | Should -Match '# <<< caelestia <<<'
    }

    It "is idempotent -- running twice produces identical content" {
        $f = Join-Path $script:tmp "b.conf"
        [System.IO.File]::WriteAllText($f, "keep`n", (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
        $once = [System.IO.File]::ReadAllText($f)
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'hello' -CommentPrefix '#'
        [System.IO.File]::ReadAllText($f) | Should -BeExactly $once
    }

    It "replaces existing block content without touching the rest" {
        $f = Join-Path $script:tmp "c.conf"
        [System.IO.File]::WriteAllText($f, "before`n", (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'v1' -CommentPrefix '#'
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'v2' -CommentPrefix '#'
        $t = [System.IO.File]::ReadAllText($f)
        $t | Should -Match 'before'
        $t | Should -Match 'v2'
        $t | Should -Not -Match 'v1'
        ([regex]::Matches($t, '>>> caelestia >>>')).Count | Should -Be 1
    }

    It "writes without a BOM" {
        $f = Join-Path $script:tmp "d.conf"
        [System.IO.File]::WriteAllText($f, "x`n", (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'y' -CommentPrefix '#'
        $b = [System.IO.File]::ReadAllBytes($f)
        ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) | Should -BeFalse
    }

    It "supports a Lua comment prefix" {
        $f = Join-Path $script:tmp "e.lua"
        [System.IO.File]::WriteAllText($f, "return {}`n", (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'local x = 1' -CommentPrefix '--'
        [System.IO.File]::ReadAllText($f) | Should -Match '-- >>> caelestia >>>'
    }
}

Describe "Remove-PatchedBlock" {
    It "removes the block and leaves surrounding content byte-identical" {
        $f = Join-Path $script:tmp "f.conf"
        $orig = "line one`nline two`n"
        [System.IO.File]::WriteAllText($f, $orig, (New-Object System.Text.UTF8Encoding($false)))
        Set-PatchedBlock -Path $f -Marker 'caelestia' -Content 'temp' -CommentPrefix '#'
        Remove-PatchedBlock -Path $f -Marker 'caelestia' -CommentPrefix '#'
        [System.IO.File]::ReadAllText($f) | Should -BeExactly $orig
    }

    It "is a no-op when the marker is absent" {
        $f = Join-Path $script:tmp "g.conf"
        $orig = "untouched`n"
        [System.IO.File]::WriteAllText($f, $orig, (New-Object System.Text.UTF8Encoding($false)))
        Remove-PatchedBlock -Path $f -Marker 'caelestia' -CommentPrefix '#'
        [System.IO.File]::ReadAllText($f) | Should -BeExactly $orig
    }
}

Describe "Set-ManagedJunction" {
    It "creates a junction pointing at the target" {
        $target = Join-Path $script:tmp "target"; New-Item -ItemType Directory -Force -Path $target | Out-Null
        $link   = Join-Path $script:tmp "link"
        Set-ManagedJunction -LinkPath $link -TargetPath $target | Should -BeTrue
        (Get-Item $link).LinkType | Should -Be 'Junction'
    }

    It "is idempotent" {
        $target = Join-Path $script:tmp "target2"; New-Item -ItemType Directory -Force -Path $target | Out-Null
        $link   = Join-Path $script:tmp "link2"
        Set-ManagedJunction -LinkPath $link -TargetPath $target | Out-Null
        Set-ManagedJunction -LinkPath $link -TargetPath $target | Should -BeTrue
    }

    It "repoints a junction aimed at the wrong target" {
        $t1 = Join-Path $script:tmp "t1"; New-Item -ItemType Directory -Force -Path $t1 | Out-Null
        $t2 = Join-Path $script:tmp "t2"; New-Item -ItemType Directory -Force -Path $t2 | Out-Null
        $link = Join-Path $script:tmp "link3"
        Set-ManagedJunction -LinkPath $link -TargetPath $t1 | Out-Null
        Set-ManagedJunction -LinkPath $link -TargetPath $t2 | Should -BeTrue
        (Get-Item $link).Target | Should -Be $t2
    }

    It "refuses to replace a real directory that is not a junction" {
        $real = Join-Path $script:tmp "realdir"; New-Item -ItemType Directory -Force -Path $real | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $real "keep.txt"), "data", (New-Object System.Text.UTF8Encoding($false)))
        $target = Join-Path $script:tmp "t3"; New-Item -ItemType Directory -Force -Path $target | Out-Null
        { Set-ManagedJunction -LinkPath $real -TargetPath $target } | Should -Throw
        Test-Path (Join-Path $real "keep.txt") | Should -BeTrue
    }
}
```

That last test is the important one — a junction helper that silently deletes a real directory would destroy `~/.glzr/zebar/goodenoughedit` if pointed at the wrong path.

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
Import-Module Pester -MinimumVersion 5.0.0
Invoke-Pester tests/InstallConfig.Tests.ps1 -Output Detailed
```

Expected: FAIL — the script does not exist.

- [ ] **Step 3: Implement `scripts/Install-Config.ps1`**

```powershell
$script:Root = Split-Path $PSScriptRoot -Parent

function Set-ManagedJunction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$LinkPath,
        [Parameter(Mandatory)][string]$TargetPath
    )

    if (-not (Test-Path $TargetPath)) { throw "Junction target does not exist: $TargetPath" }

    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        if ($item.LinkType -ne 'Junction') {
            throw "$LinkPath exists and is NOT a junction. Refusing to replace a real directory."
        }
        if ($item.Target -contains $TargetPath) { return $true }
        Remove-Item $LinkPath -Force
    }

    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
    $after = Get-Item $LinkPath -Force
    return ($after.LinkType -eq 'Junction' -and $after.Target -contains $TargetPath)
}

function Set-PatchedBlock {
    <#
      Insert or replace a marker-delimited block inside a file the USER owns.
      Idempotent: identical Content produces a byte-identical file.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $block = "$open`n$Content`n$close"

    $text = ''
    if (Test-Path $Path) { $text = [System.IO.File]::ReadAllText($Path) }

    $pattern = [regex]::Escape($open) + '.*?' + [regex]::Escape($close)
    if ([regex]::IsMatch($text, $pattern, 'Singleline')) {
        $new = [regex]::Replace($text, $pattern, { param($m) $block }, 'Singleline')
    } else {
        $sep = if ($text.Length -eq 0 -or $text.EndsWith("`n")) { '' } else { "`n" }
        $new = $text + $sep + "`n" + $block + "`n"
    }

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-PatchedBlock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    if (-not (Test-Path $Path)) { return }

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $text  = [System.IO.File]::ReadAllText($Path)

    # Consume the blank line the insert added, so removal restores the original.
    $pattern = "\n?\n" + [regex]::Escape($open) + '.*?' + [regex]::Escape($close) + "\n?"
    $new = [regex]::Replace($text, $pattern, '', 'Singleline')

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}
```

`Install-Config` itself is added in Task 9, once there is a pack to install. This task delivers only the three primitives and their tests.

- [ ] **Step 4: Run the tests to verify they pass**

Expected: 11 passed.

- [ ] **Step 5: Commit**

```powershell
git add scripts/Install-Config.ps1 tests/InstallConfig.Tests.ps1
git commit -m "feat: add idempotent junction and marker-block config primitives"
```

---

### Task 3: Minimal pack that renders

Proves geometry, docking and loading before any entry logic exists.

**Files:**
- Create: `zebar/caelestia/zpack.json`
- Create: `zebar/caelestia/bar/index.html`
- Create: `zebar/caelestia/bar/style.css`
- Create: `zebar/caelestia/bar/theme.css`

**Interfaces:**
- Consumes: `Set-ManagedJunction` (Task 2); the vendoring answer from Task 1 Step 2.
- Produces: a loadable pack named `caelestia` with a widget named `bar`.

- [ ] **Step 1: Write `zebar/caelestia/zpack.json`**

Schema and field names taken from the on-disk starter pack.

```json
{
  "$schema": "https://github.com/glzr-io/zebar/raw/v3.3.1/resources/zpack-schema.json",
  "name": "caelestia",
  "version": "0.1.0",
  "description": "Caelestia-style vertical bar",
  "tags": ["sidebar"],
  "previewImages": [],
  "repositoryUrl": "",
  "widgets": [
    {
      "name": "bar",
      "htmlPath": "./bar/index.html",
      "zOrder": "normal",
      "shownInTaskbar": false,
      "focused": false,
      "resizable": false,
      "transparent": true,
      "includeFiles": ["*"],
      "caching": { "defaultDuration": 0, "rules": [] },
      "privileges": { "shellCommands": [] },
      "presets": [
        {
          "name": "default",
          "anchor": "top_left",
          "offsetX": "0px",
          "offsetY": "0px",
          "width": "52px",
          "height": "100%",
          "monitorSelection": { "type": "all" },
          "dockToEdge": { "enabled": true, "edge": "left", "windowMargin": "0px" }
        }
      ]
    }
  ]
}
```

Two things here are load-bearing and were established the hard way in Task 1:

- **`caching.defaultDuration` is 0**, not the starter's 604800 — a cached bar would not pick up a regenerated `theme.css`.
- **`includeFiles` must be `["*"]`.** With a narrower glob the pack is found but the widget's `htmlPath` silently **404s**. This is documented nowhere in the schema or the starter template and cost Task 1 most of its investigation time. Do not "tidy" it to `["bar/**"]`.

Also note: `--pack` takes a pack **ID**, never a filesystem path, and the pack must live directly under `~/.glzr/zebar`. That is why the junction exists.

- [ ] **Step 2: Write `bar/style.css` — tokens and layout, ZERO colours**

```css
:root {
  --space-sm: 4px;  --space-md: 8px;  --space-lg: 14px;
  --pad-lg: 12px;
  --radius-sm: 8px; --radius-lg: 18px; --radius-full: 999px;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --dur: 300ms;
  --bar-w: 52px;
}

html, body { margin: 0; padding: 0; height: 100%; background: transparent; overflow: hidden; }

#bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  height: 100%;
  padding: var(--pad-lg) 0;
  box-sizing: border-box;
  background: var(--surface);
  color: var(--on-surface);
  font-family: "0xProto Nerd Font", monospace;
  font-size: 12px;
}

.entry { display: flex; flex-direction: column; align-items: center; }
.entry--spacer { flex: 1 1 auto; }
```

- [ ] **Step 3: Write a placeholder `bar/theme.css`**

Generated by matugen from Task 9 onward. A committed placeholder keeps the pack loadable before the pipeline is wired.

```css
/* Placeholder. Overwritten by matugen once the zebar target is wired up. */
:root {
  --surface: #0e1416;
  --on-surface: #dee3e5;
  --on-surface-variant: #bfc8ca;
  --primary: #83d2e5;
  --on-primary: #00363f;
  --outline: #899295;
}
```

- [ ] **Step 4: Write `bar/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./theme.css" />
    <link rel="stylesheet" href="./style.css" />
    <title>Caelestia bar</title>
  </head>
  <body>
    <div id="bar">
      <div class="entry">▲</div>
      <div class="entry entry--spacer"></div>
      <div class="entry">■</div>
    </div>
  </body>
</html>
```

`theme.css` is linked **before** `style.css` so layout can override a token if it ever needs to.

- [ ] **Step 5: Install and verify it renders**

```powershell
. .\scripts\Install-Config.ps1
Set-ManagedJunction -LinkPath "$env:USERPROFILE\.glzr\zebar\caelestia" -TargetPath "$PWD\zebar\caelestia"
```

Then start the widget from Zebar's UI (or via its CLI if Task 1 recorded one) and **screenshot the left edge of the screen**. Expected: a 52px dark strip with ▲ at top and ■ at bottom.

Then confirm the docking finding from Task 1 Step 3:

```powershell
$s = komorebic state 2>$null | Out-String | ConvertFrom-Json
"work area left: $($s.monitors.elements[0].work_area_size.left)"
```

If Task 1 found `dockToEdge` works, this should be ~52. If Task 1 found it does not, apply the `work_area_offset` fallback to `komorebi.json` now and say so in the report.

**yasb must still be running and visible at the top throughout.**

- [ ] **Step 6: Commit**

```powershell
git add zebar/
git commit -m "feat: add minimal Caelestia zebar pack with docked vertical geometry"
```

---

### Task 4: Entry framework

Config-driven rendering, mirroring `Bar.qml`'s `Repeater` + `DelegateChooser`.

**Files:**
- Create: `zebar/caelestia/bar/bar.config.json`
- Create: `zebar/caelestia/bar/entries/registry.js`
- Create: `zebar/caelestia/bar/bar.js`
- Create: `tests/js/registry.test.mjs`
- Modify: `zebar/caelestia/bar/index.html`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `registry.js` exporting `register(type, factory)` and `create(type, ctx)`, where `factory(ctx)` returns `{ el: HTMLElement, update(output): void }`.
  - `renderEntries(container, entryList, ctx)` in `bar.js`.

- [ ] **Step 1: Write the failing test**

`tests/js/registry.test.mjs` — run with Node 22's built-in runner, no framework to install.

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { register, create, clear, knownTypes } from '../../zebar/caelestia/bar/entries/registry.js';

test('create returns what the registered factory produced', () => {
  clear();
  register('demo', () => ({ el: { tag: 'div' }, update() {} }));
  const made = create('demo', {});
  assert.deepStrictEqual(made.el, { tag: 'div' });
});

test('create throws on an unknown type rather than silently rendering nothing', () => {
  clear();
  assert.throws(() => create('nope', {}), /unknown entry type: nope/);
});

test('knownTypes lists every registered type', () => {
  clear();
  register('a', () => ({ el: {}, update() {} }));
  register('b', () => ({ el: {}, update() {} }));
  assert.deepStrictEqual(knownTypes().sort(), ['a', 'b']);
});

test('registering the same type twice throws', () => {
  clear();
  register('dup', () => ({ el: {}, update() {} }));
  assert.throws(() => register('dup', () => ({ el: {}, update() {} })), /already registered/);
});

test('the factory receives the context object', () => {
  clear();
  let seen = null;
  register('ctx', c => { seen = c; return { el: {}, update() {} }; });
  create('ctx', { hello: 'world' });
  assert.deepStrictEqual(seen, { hello: 'world' });
});
```

The second test matters most: an unknown entry type must fail loudly. Silently skipping it would mean a typo in `bar.config.json` produces a bar with a missing widget and no explanation.

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --test tests/js/
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `entries/registry.js`**

```js
const factories = new Map();

export function register(type, factory) {
  if (factories.has(type)) throw new Error(`entry type already registered: ${type}`);
  factories.set(type, factory);
}

export function create(type, ctx) {
  const factory = factories.get(type);
  if (!factory) throw new Error(`unknown entry type: ${type}`);
  return factory(ctx);
}

export function knownTypes() {
  return [...factories.keys()];
}

// Test-only: reset between cases.
export function clear() {
  factories.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Expected: 5 passing.

- [ ] **Step 5: Write `bar.config.json` and `bar.js`**

`bar.config.json`:

```json
{
  "entries": ["logo", "workspaces", "activeWindow", "media",
              "spacer", "vesktop", "clock", "statusIcons", "power"]
}
```

**Note:** the spec's entry table lists both `tray` and `statusIcons`. Those became
duplicates once unknown 1 resolved — `tray` had been a general systray host, and when
it was reduced to a status-icon cluster it collapsed into `statusIcons`. There is one
entry, named `statusIcons`. Nine entries, not ten.

`bar.js`:

```js
import * as zebar from './vendor/zebar.js';   // or the CDN URL, per Task 1 Step 2
import { create } from './entries/registry.js';
import './entries/index.js';                   // registers every entry type

const providers = zebar.createProviderGroup({
  komorebi: { type: 'komorebi' },
  date:     { type: 'date', formatting: 'HH:mm' },
  audio:    { type: 'audio' },
  media:    { type: 'media' },
  network:  { type: 'network' },
  battery:  { type: 'battery' },
});

const config = await fetch('./bar.config.json').then(r => r.json());
const container = document.getElementById('bar');
const instances = [];

// ctx carries BOTH providers and the shell handle -- the vesktop entry (Task 7)
// needs `shell`, so it must be in the context from the start.
const ctx = { providers, shell: zebar.shellExec ? zebar : null };

for (const type of config.entries) {
  const inst = create(type, ctx);
  inst.el.classList.add('entry');
  container.appendChild(inst.el);
  instances.push(inst);
}

function tick() {
  const out = providers.outputMap;
  for (const inst of instances) {
    try { inst.update(out); }
    catch (e) { console.error('entry update failed', e); }
  }
}

providers.onOutput(tick);
tick();
```

The per-entry `try/catch` is deliberate: one entry throwing must not stop the others from updating.

Adjust the `zebar` import to match Task 1 Step 2's finding — vendored path if vendoring works, CDN URL if not.

- [ ] **Step 6: Create a stub `entries/index.js` so the page loads**

```js
import { register } from './registry.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));
```

Every other type is added in Tasks 5–7. Until then, **remove the unimplemented names from `bar.config.json`** so `create` does not throw — add each back as its entry lands.

- [ ] **Step 7: Point `index.html` at `bar.js` and verify**

```html
<script type="module" src="./bar.js"></script>
```

Screenshot the bar. Expected: still renders, no console errors. Check Zebar's log or the widget devtools for exceptions.

- [ ] **Step 8: Commit**

```powershell
git add zebar/ tests/js/
git commit -m "feat: add config-driven entry registry and bar renderer"
```

---

### Task 5: Provider entries — logo, workspaces, clock, statusIcons, power

**Files:**
- Create: `zebar/caelestia/bar/entries/logo.js`
- Create: `zebar/caelestia/bar/entries/workspaces.js`
- Create: `zebar/caelestia/bar/entries/clock.js`
- Create: `zebar/caelestia/bar/entries/statusIcons.js`
- Create: `zebar/caelestia/bar/entries/power.js`
- Create: `tests/js/entries.test.mjs`
- Modify: `zebar/caelestia/bar/entries/index.js`, `bar.config.json`, `style.css`

**Interfaces:**
- Consumes: `register` / `create` from Task 4.
- Produces: five registered entry types. Each exports a pure formatter that tests can call without a DOM.

- [ ] **Step 1: Write the failing tests for the pure formatters**

Entry modules touch the DOM, which Node cannot run. So each module exports its **pure logic** separately, and that is what gets tested.

`tests/js/entries.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { splitClock } from '../../zebar/caelestia/bar/entries/clock.js';
import { workspaceState } from '../../zebar/caelestia/bar/entries/workspaces.js';

test('splitClock splits HH:mm into stacked parts', () => {
  assert.deepStrictEqual(splitClock('21:40'), { top: '21', bottom: '40' });
});

test('splitClock tolerates a missing value', () => {
  assert.deepStrictEqual(splitClock(undefined), { top: '--', bottom: '--' });
});

test('splitClock tolerates an unexpected format', () => {
  assert.deepStrictEqual(splitClock('nonsense'), { top: '--', bottom: '--' });
});

test('workspaceState marks the focused workspace', () => {
  const out = workspaceState({
    currentWorkspaces: [{ name: '1' }, { name: '2' }, { name: '3' }],
    focusedWorkspace: { name: '2' },
  });
  assert.deepStrictEqual(out, [
    { name: '1', focused: false },
    { name: '2', focused: true },
    { name: '3', focused: false },
  ]);
});

test('workspaceState returns empty when komorebi output is absent', () => {
  assert.deepStrictEqual(workspaceState(undefined), []);
});

test('workspaceState handles a null focusedWorkspace', () => {
  const out = workspaceState({ currentWorkspaces: [{ name: '1' }], focusedWorkspace: null });
  assert.deepStrictEqual(out, [{ name: '1', focused: false }]);
});
```

The absent/null cases are not padding — komorebi is not running at Zebar startup on every boot, so these are the normal first frames.

- [ ] **Step 2: Run to verify failure**

```powershell
node --test tests/js/
```

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the formatters and entries**

`entries/clock.js`:

```js
import { register } from './registry.js';

export function splitClock(formatted) {
  if (typeof formatted !== 'string') return { top: '--', bottom: '--' };
  const m = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { top: '--', bottom: '--' };
  return { top: m[1], bottom: m[2] };
}

register('clock', () => {
  const el = document.createElement('div');
  el.className = 'clock';
  const top = document.createElement('div');
  const bottom = document.createElement('div');
  el.append(top, bottom);
  return {
    el,
    update(out) {
      const { top: t, bottom: b } = splitClock(out.date?.formatted);
      top.textContent = t;
      bottom.textContent = b;
    },
  };
});
```

`entries/workspaces.js`:

```js
import { register } from './registry.js';

export function workspaceState(komorebi) {
  if (!komorebi || !Array.isArray(komorebi.currentWorkspaces)) return [];
  const focused = komorebi.focusedWorkspace?.name;
  return komorebi.currentWorkspaces.map(w => ({ name: w.name, focused: w.name === focused }));
}

register('workspaces', () => {
  const el = document.createElement('div');
  el.className = 'workspaces';
  return {
    el,
    update(out) {
      const state = workspaceState(out.komorebi);
      el.replaceChildren(...state.map(w => {
        const b = document.createElement('button');
        b.className = 'workspace' + (w.focused ? ' workspace--focused' : '');
        b.textContent = w.name;
        return b;
      }));
    },
  };
});
```

`entries/logo.js`:

```js
import { register } from './registry.js';

register('logo', () => {
  const el = document.createElement('div');
  el.className = 'logo';
  el.textContent = '\u25C6';
  return { el, update() {} };
});
```

`entries/statusIcons.js` — a cluster, not a systray host (see spec unknown 1):

```js
import { register } from './registry.js';

export function statusSummary(out) {
  return {
    volume: out.audio?.defaultPlaybackDevice?.volume ?? null,
    online: Boolean(out.network?.defaultInterface),
    battery: out.battery ? Math.round(out.battery.chargePercent) : null,
  };
}

register('statusIcons', () => {
  const el = document.createElement('div');
  el.className = 'status-icons';
  return {
    el,
    update(out) {
      const s = statusSummary(out);
      const parts = [];
      parts.push(s.online ? '\uF1EB' : '\uF127');
      if (s.volume !== null) parts.push(s.volume > 0 ? '\uF028' : '\uF026');
      if (s.battery !== null) parts.push(`${s.battery}%`);
      el.replaceChildren(...parts.map(t => {
        const d = document.createElement('div');
        d.textContent = t;
        return d;
      }));
    },
  };
});
```

`entries/power.js` — confirms before acting:

```js
import { register } from './registry.js';

register('power', () => {
  const el = document.createElement('button');
  el.className = 'power';
  el.textContent = '\u23FB';
  el.addEventListener('click', () => {
    if (confirm('Shut down?')) console.warn('power action not yet wired');
  });
  return { el, update() {} };
});
```

The power action is deliberately unwired until Task 1 Step 5's `shellCommands` finding is applied — a half-understood shutdown call is worse than none.

**The bottom of the strip is occluded, and probably not clickable.** Task 3 measured the native taskbar (`Shell_TrayWnd`) at `y=1392–1440`, full width, sitting above `zOrder: "normal"` windows. So the power button will be both hidden and, more importantly, likely unable to receive clicks — the taskbar intercepts them.

Decide this explicitly rather than discovering it after wiring the action:

- **Nudge the interactive elements up** from the true bottom edge with a `padding-bottom` on `#bar` roughly equal to the taskbar height. Simplest, costs a little vertical space, works regardless of taskbar settings.
- **`zOrder: "always_on_top"`** on the widget. Fixes clickability but puts the bar above *everything*, including fullscreen apps — likely worse.
- **Rely on taskbar auto-hide.** The user has asked for that separately (see the spec's "Future phases"), but it is not implemented yet, so do not depend on it now.

Take the first option unless something argues against it, and **verify the power button actually receives a click** — screenshot alone will not tell you, since a visible button can still be input-dead.

- [ ] **Step 4: Run to verify tests pass**

Expected: 6 passing (plus Task 4's 5).

- [ ] **Step 5: Register them, add to config, style them**

Import all five in `entries/index.js`. Add `"logo"`, `"workspaces"`, `"clock"`, `"statusIcons"`, `"power"` to `bar.config.json`.

Add to `style.css` — colours via `var()` only:

```css
.workspace {
  width: 26px; height: 26px;
  border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--on-surface-variant);
  font: inherit; cursor: pointer;
}
.workspace--focused { background: var(--primary); color: var(--on-primary); }
.clock { line-height: 1.1; text-align: center; }
.status-icons { display: flex; flex-direction: column; gap: var(--space-sm); }
.power { background: transparent; border: none; color: var(--on-surface-variant); cursor: pointer; }
```

- [ ] **Step 6: Verify visually and commit**

Screenshot the bar. Expected: logo, workspace buttons with the focused one filled, stacked clock, status icons, power glyph.

```powershell
git add zebar/ tests/js/
git commit -m "feat: add logo, workspaces, clock, status icons and power entries"
```

---

### Task 6: activeWindow and media, rotated

**Files:**
- Create: `zebar/caelestia/bar/entries/activeWindow.js`
- Create: `zebar/caelestia/bar/entries/media.js`
- Modify: `tests/js/entries.test.mjs`, `entries/index.js`, `bar.config.json`, `style.css`

**Interfaces:**
- Consumes: the Task 1 Step 1 finding on where the window title comes from.
- Produces: `activeWindow` and `media` entries; `mediaLabel(mediaOutput)` exported for testing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/js/entries.test.mjs`:

```js
import { mediaLabel } from '../../zebar/caelestia/bar/entries/media.js';

test('mediaLabel formats title and artist', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Reset', artist: 'Tiger JK', isPlaying: true } }),
    'Reset \u2014 Tiger JK',
  );
});

test('mediaLabel marks a paused session', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Reset', artist: 'Tiger JK', isPlaying: false } }),
    '(Paused) Reset \u2014 Tiger JK',
  );
});

test('mediaLabel returns empty string when nothing is playing', () => {
  assert.strictEqual(mediaLabel({ currentSession: null }), '');
  assert.strictEqual(mediaLabel(undefined), '');
});

test('mediaLabel omits the dash when artist is missing', () => {
  assert.strictEqual(
    mediaLabel({ currentSession: { title: 'Untitled', artist: '', isPlaying: true } }),
    'Untitled',
  );
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — `media.js` does not exist.

- [ ] **Step 3: Implement**

`entries/media.js`:

```js
import { register } from './registry.js';

export function mediaLabel(media) {
  const s = media?.currentSession;
  if (!s || !s.title) return '';
  const base = s.artist ? `${s.title} \u2014 ${s.artist}` : s.title;
  return s.isPlaying ? base : `(Paused) ${base}`;
}

register('media', () => {
  const el = document.createElement('div');
  el.className = 'media';
  return {
    el,
    update(out) {
      const label = mediaLabel(out.media);
      el.textContent = label;
      el.style.display = label ? '' : 'none';
    },
  };
});
```

`entries/activeWindow.js` — **the source depends on Task 1 Step 1.** If the komorebi provider supplies a title, read it. If not, this entry polls the `EnumWindows` fallback and its `update` reads from that instead; record which in the report.

```js
import { register } from './registry.js';

// Focus is flagged at the CONTAINER level, not per window. Verified against
// zebar's index.d.ts at both 3.0.3 and 3.3.1: `KomorebiWindow` is
// {id, class, exe, hwnd, title, role, subrole, icon_path} -- there is no
// `isFocused` field at any version. Use `focusedWorkspace.focusedContainerIndex`
// to pick the container, then the window within it.
//
// `focusedWindowIndex` below is NOT verified -- check index.d.ts for the real
// name of the within-container index and correct it. Falling back to windows[0]
// is right for the common single-window container.
export function windowTitle(komorebi) {
  const ws = komorebi?.focusedWorkspace;
  const containers = ws?.tilingContainers;
  if (!Array.isArray(containers)) return '';

  const ci = ws.focusedContainerIndex;
  const container = typeof ci === 'number' ? containers[ci] : undefined;
  if (!container) return '';

  const windows = container.windows ?? [];
  const wi = container.focusedWindowIndex;
  const win = typeof wi === 'number' ? windows[wi] : windows[0];
  return win?.title ?? '';
}

register('activeWindow', () => {
  const el = document.createElement('div');
  el.className = 'active-window';
  return {
    el,
    update(out) {
      const t = windowTitle(out.komorebi);
      el.textContent = t;
      el.style.display = t ? '' : 'none';
    },
  };
});
```

- [ ] **Step 4: Rotate them in CSS**

```css
.media, .active-window {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  max-height: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--on-surface-variant);
}
```

`max-height` matters — an unbounded rotated title will push every entry below it off the bar.

- [ ] **Step 5: Run tests, verify visually, commit**

Play something in foobar2000 so the media entry has content. Screenshot: title should read top-to-bottom down the bar.

```powershell
node --test tests/js/
git add zebar/ tests/js/
git commit -m "feat: add rotated active window and media entries"
```

---

### Task 7: Vesktop entry via shellCommands

**Files:**
- Create: `zebar/caelestia/bar/entries/vesktop.js`
- Modify: `zebar/caelestia/zpack.json`, `entries/index.js`, `bar.config.json`, `tests/js/entries.test.mjs`

**Interfaces:**
- Consumes: Task 1 Step 5's exact `shellCommands` invocation and polling model.
- Produces: `vesktop` entry; `pingState(stdout)` exported for testing.

- [ ] **Step 1: Write the failing tests**

The helper's contract is documented in `~/.config/yasb/CLAUDE.md`: a ping prints a count; `--idle` prints `idle` only when there is no ping.

```js
import { pingState } from '../../zebar/caelestia/bar/entries/vesktop.js';

test('pingState reads a ping count', () => {
  assert.deepStrictEqual(pingState('3'), { pinged: true, count: 3 });
});

test('pingState treats empty output as no ping', () => {
  assert.deepStrictEqual(pingState(''), { pinged: false, count: 0 });
  assert.deepStrictEqual(pingState('   \n'), { pinged: false, count: 0 });
});

test('pingState treats non-numeric output as no ping', () => {
  assert.deepStrictEqual(pingState('idle'), { pinged: false, count: 0 });
});

test('pingState ignores a zero count', () => {
  assert.deepStrictEqual(pingState('0'), { pinged: false, count: 0 });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

```js
import { register } from './registry.js';

export function pingState(stdout) {
  const n = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return { pinged: false, count: 0 };
  return { pinged: true, count: n };
}

const HELPER = 'C:\\Users\\PC\\.config\\yasb\\scripts\\vesktop-unread.exe';

register('vesktop', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'vesktop';

  async function poll() {
    try {
      const { stdout } = await shell.exec(HELPER, []);
      const s = pingState(stdout);
      el.textContent = s.pinged ? String(s.count) : '';
      el.classList.toggle('vesktop--pinged', s.pinged);
      el.style.display = s.pinged ? '' : 'none';
    } catch (e) {
      console.error('vesktop poll failed', e);
      el.style.display = 'none';
    }
  }

  poll();
  setInterval(poll, 5000);
  return { el, update() {} };
});
```

**Adjust `shell.exec` to the exact API Task 1 Step 5 recorded** — the name and shape are unverified until that spike runs. Add the helper path to `privileges.shellCommands` in `zpack.json`.

The 5s poll matches yasb's cadence; failure hides the chip rather than showing a stale count.

- [ ] **Step 3: Verify against a real ping**

Have a Discord message arrive, or use `--idle` to check the inverse. Screenshot both states.

- [ ] **Step 4: Commit**

```powershell
git add zebar/ tests/js/
git commit -m "feat: add vesktop ping entry reusing the existing helper"
```

---

### Task 8: The media morph

**Files:**
- Create: `zebar/caelestia/bar/drawer.js`
- Modify: `entries/media.js`, `style.css`, `zpack.json`

**Interfaces:**
- Consumes: the `media` entry from Task 6.
- Produces: `toggleDrawer(barEl, open)` — morphs between collapsed and expanded.

- [ ] **Step 1: Widen the widget so the drawer has room**

An expanded drawer cannot paint outside the widget's window. Change the preset `width` from `52px` to `340px` and add to `style.css`:

```css
body { width: 340px; }
#bar { width: var(--bar-w); }
body:not(.drawer-open) { pointer-events: none; }
body:not(.drawer-open) #bar { pointer-events: auto; }
```

The `pointer-events` rule is essential: a 340px-wide transparent window would otherwise swallow clicks meant for windows underneath it.

**`dockToEdge` must still reserve only 52px.** If it reserves the full 340px, tiled windows lose 288px — verify with `komorebic state` and, if so, record it as a constraint and fall back to a fixed `work_area_offset` of 52.

- [ ] **Step 2: Implement `drawer.js`**

```js
export function toggleDrawer(barEl, open) {
  const apply = () => {
    document.body.classList.toggle('drawer-open', open);
    barEl.classList.toggle('media-open', open);
  };
  if (document.startViewTransition) {
    document.startViewTransition(apply);
  } else {
    apply();   // snaps rather than morphs; still correct
  }
}
```

- [ ] **Step 3: Style the morph**

```css
.media { view-transition-name: media-pill; cursor: pointer; }

.media-panel {
  display: none;
  view-transition-name: media-panel;
  background: var(--surface);
  color: var(--on-surface);
  border-radius: var(--radius-lg);
  padding: var(--pad-lg);
  margin-left: var(--space-md);
  width: 260px;
}
.drawer-open .media-panel { display: block; }

::view-transition-old(media-pill),
::view-transition-new(media-pill),
::view-transition-old(media-panel),
::view-transition-new(media-panel) {
  animation-duration: var(--dur);
  animation-timing-function: var(--ease);
}
```

- [ ] **Step 4: Wire the click in `media.js`**

Add a click handler on the media element calling `toggleDrawer(document.getElementById('bar'), !document.body.classList.contains('drawer-open'))`, and render the panel (album art via `out.media.currentSession.artworkUrl` if present, title, artist, transport buttons, elapsed/total).

- [ ] **Step 5: Verify the morph and the fallback**

Screenshot collapsed, click, screenshot expanded. Then confirm the fallback path by temporarily stubbing `document.startViewTransition = undefined` in devtools — the panel must still open, just without animation.

**Also verify clicks pass through** the transparent region: click something in a window behind the widget's 340px area and confirm it receives the click.

- [ ] **Step 6: Commit**

```powershell
git add zebar/
git commit -m "feat: morph the media pill into a player panel via View Transitions"
```

---

### Task 9: Theming — the fifth pipeline target

**Files:**
- Create: `matugen/templates/zebar.theme.css`
- Modify: `matugen/config.toml`, `scripts/Apply-Theme.ps1`, `scripts/Install-Config.ps1`, `tests/ApplyTheme.Tests.ps1`

**Interfaces:**
- Consumes: `Test-StagedFile`, `$script:Targets`, `Update-LastGood` from `Apply-Theme.ps1`.
- Produces: a `zebar` target rendering to `zebar/caelestia/bar/theme.css`; `Install-Config` gaining its top-level function.

- [ ] **Step 1: Write the template**

Role choices reuse Task 4's validated pairings from the pipeline work — `surface`/`on_surface`, `primary`/`on_primary`, `outline`.

```css
/* Generated by matugen. Do not edit -- see setup/matugen/templates/zebar.theme.css */
:root {
  --surface: {{colors.surface.default.hex}};
  --on-surface: {{colors.on_surface.default.hex}};
  --on-surface-variant: {{colors.on_surface_variant.default.hex}};
  --primary: {{colors.primary.default.hex}};
  --on-primary: {{colors.on_primary.default.hex}};
  --outline: {{colors.outline.default.hex}};
  --surface-container: {{colors.surface_container.default.hex}};
}
```

- [ ] **Step 2: Add the matugen target**

In `matugen/config.toml`:

```toml
[templates.zebar]
input_path = 'C:\Users\PC\Documents\git\setup\matugen\templates\zebar.theme.css'
output_path = 'C:\Users\PC\Documents\git\setup\state\staging\theme.css'
```

- [ ] **Step 3: Write the failing tests**

```powershell
Describe "Test-StagedFile zebar branch" {
    It "accepts a well-formed custom-property block" {
        $p = "$env:TEMP\zt-good.css"
        Set-Content $p ":root {`n  --surface: #0e1416;`n  --primary: #83d2e5;`n}" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeTrue
    }
    It "rejects an unrendered expression" {
        $p = "$env:TEMP\zt-unrendered.css"
        Set-Content $p ":root { --surface: {{colors.surface.default.hex}}; }" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
    It "rejects unbalanced braces" {
        $p = "$env:TEMP\zt-brace.css"
        Set-Content $p ":root { --surface: #0e1416;" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
    It "rejects a non-custom-property declaration" {
        $p = "$env:TEMP\zt-decl.css"
        Set-Content $p ":root {`n  color: red;`n}" -Encoding ascii
        Test-StagedFile -Name 'zebar' -Path $p | Should -BeFalse
    }
}
```

The last test is what keeps layout out of the generated file — the invariant the whole design rests on.

- [ ] **Step 4: Implement the branch and the target row**

Add a `'zebar'` case to `Test-StagedFile` reusing `Measure-CssBraces`, plus a check that every non-blank line inside `:root { }` matches `^\s*--[\w-]+\s*:`. Add to `$script:Targets`:

```powershell
@{ Name='zebar'; Staged='theme.css'; Live="$script:Root\zebar\caelestia\bar\theme.css" }
```

Note this target is **inside the repo**, unlike the other four. That is intentional — the pack is tracked, and `theme.css` is a committed generated artifact, same as `styles.css` was for yasb.

**Reload is REQUIRED, and the obvious command does not do it.**

Task 1 established Zebar does **not** hot-reload CSS — a running widget still showed the old colour 14+ seconds after the stylesheet changed. Task 4 then established that `start-widget-preset` against an **already-running** widget of the same pack/widget/preset is a **no-op**: it neither reloads nor duplicates. So this alone does nothing:

```powershell
& "C:\Program Files\glzr.io\Zebar\zebar.exe" start-widget-preset --pack caelestia --widget-name bar --preset default
```

The widget only picks up a new `theme.css` after the **`zebar.exe` process is stopped and restarted**. So `Apply-Theme` needs, after the copy:

```powershell
Get-Process zebar -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
& "C:\Program Files\glzr.io\Zebar\zebar.exe" start-widget-preset --pack caelestia --widget-name bar --preset default
```

Two consequences to handle rather than discover:

- **Killing `zebar.exe` kills every Zebar widget**, not just this bar. Harmless today (only this one runs), but note it — and check whether any other widget was running before assuming it is safe.
- **The bar disappears for the restart interval.** Combined with yasb's 8-second settle, a wallpaper switch already has visible downtime; do not add more than needed.

If a gentler reload exists (a Zebar CLI verb, a settings toggle, an IPC call), prefer it and say what you found — but do not assume one exists because it would be convenient.

- [ ] **Step 5: Add `Install-Config` proper**

```powershell
function Install-Config {
    [CmdletBinding()]
    param([switch]$DryRun, [switch]$Uninstall)

    $marker = 'caelestia-shell'
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $script:Root "state\config-backup\$stamp"

    $targets = @(
        @{ Path = "$env:USERPROFILE\.config\whkdrc"; Prefix = '#';  Content = @'
alt + w                       : Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\PC\Documents\git\setup\scripts\hotkey-next-wallpaper.ps1'
ctrl + alt + w                : Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\PC\Documents\git\setup\scripts\hotkey-retheme.ps1'
'@ }
    )

    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $backup | Out-Null }

    foreach ($t in $targets) {
        if ($DryRun) { "would patch $($t.Path)"; continue }
        if (Test-Path $t.Path) { Copy-Item $t.Path $backup -Force }
        if ($Uninstall) { Remove-PatchedBlock -Path $t.Path -Marker $marker -CommentPrefix $t.Prefix }
        else            { Set-PatchedBlock  -Path $t.Path -Marker $marker -CommentPrefix $t.Prefix -Content $t.Content }
    }

    if ($Uninstall) {
        $link = "$env:USERPROFILE\.glzr\zebar\caelestia"
        if ((Test-Path $link) -and (Get-Item $link -Force).LinkType -eq 'Junction') { Remove-Item $link -Force }
    } elseif (-not $DryRun) {
        Set-ManagedJunction -LinkPath "$env:USERPROFILE\.glzr\zebar\caelestia" `
                            -TargetPath (Join-Path $script:Root "zebar\caelestia") | Out-Null
    }
}
```

`.wezterm.lua` is deliberately **not** in `$targets` — its edits are already applied and live, and re-patching a working 354-line config to prove a mechanism risks breaking a terminal this session runs in. Record it as a documented manual step in `docs/wezterm-integration.md` instead.

- [ ] **Step 6: Run the full suite, verify a real apply, commit**

```powershell
Import-Module Pester -MinimumVersion 5.0.0
Invoke-Pester tests\ -Output Detailed
. .\scripts\Apply-Theme.ps1
Apply-Theme -DryRun
```

Then one real `Apply-Theme` and screenshot the bar — it should recolour. Back up the live theme files independently first.

```powershell
git add matugen/ scripts/ tests/ zebar/
git commit -m "feat: add zebar as a fifth theming target"
```

---

### Task 10: Docs and coexistence check

**Files:**
- Create: `docs/zebar-bar.md`
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: findings from every prior task.
- Produces: documentation only.

- [ ] **Step 1: Write `docs/zebar-bar.md`**

Cover: the pack layout and why it is buildless; the junction and why not a copy; the entry registry and how to add an entry type; the `style.css` / `theme.css` split and the rule that `style.css` holds no colours; the drawer's `pointer-events` requirement; and every answer from `docs/zebar-reference.md`.

- [ ] **Step 2: Update `CLAUDE.md` and `README.md`**

`CLAUDE.md` gains the zebar target in its stack table and pipeline flow. `README.md` gains a line on starting the bar and the fact that yasb still runs alongside it.

- [ ] **Step 3: Verify coexistence explicitly**

Confirm and screenshot: yasb still renders at the top, the Zebar bar renders at the left, komorebi tiles between them without overlapping either, and `komorebic state` shows both reservations.

- [ ] **Step 4: Commit**

```powershell
git add docs/ CLAUDE.md README.md
git commit -m "docs: document the zebar bar and verify yasb coexistence"
```

## Verification

After Task 10:

- [ ] `Invoke-Pester tests\` — all pass
- [ ] `node --test tests/js/` — all pass
- [ ] Both bars visible simultaneously; komorebi tiles without overlapping either
- [ ] `alt + w` re-themes both yasb and the Zebar bar
- [ ] Clicking the media pill morphs the drawer open and closed
- [ ] Clicks pass through the drawer's transparent region when closed
- [ ] `Install-Config -DryRun` writes nothing; `-Uninstall` removes the junction and the whkdrc block, leaving surrounding content byte-identical
- [ ] `git status` clean in both repos
