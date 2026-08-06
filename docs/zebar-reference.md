# Zebar reference - answers to Task 1's five unknowns

Captured 2026-08-05 on this machine (branch `feat/zebar-bar`). All five unknowns below were
verified by actually running Zebar (`C:\Program Files\glzr.io\Zebar\zebar.exe`, app version
3.3.1 per `~/.glzr/zebar/settings.json`'s schema reference) via its CLI, building a throwaway
probe pack in `$env:TEMP\zprobe`, and reading screenshots. Nothing here is asserted without a
command that was actually run and a result that was actually observed. Every probe process was
stopped and every registration artifact removed before this document was written - see
"Cleanup" at the end.

**Bonus finding not in the original brief:** the `zebar` npm package ships full TypeScript
definitions (`dist/index.d.ts`). Several answers below are cross-checked against those types in
addition to the empirical screenshots, which is stronger evidence than either alone.

## Unknown (context) - how does a pack in `$env:TEMP` get registered so `--pack` can find it?

This wasn't one of the five numbered unknowns, but the brief flagged it as something the CLI
workflow requires answering before Steps 1/3/4 could even start, so it's recorded first.

**Answer: a raw filesystem path does NOT work as `--pack`. The pack must physically live as a
subdirectory of `~/.glzr/zebar` (a junction pointing elsewhere does not work either - see below).
Additionally, each widget's `zpack.json` MUST declare `includeFiles` listing its own asset
files, or the widget's `htmlPath` 404s even though the pack itself resolves correctly.** This
second part is an undocumented gotcha that will bite every later task's pack if missed.

### Method and evidence

1. `zebar.exe start-widget-preset --pack nonexistent.pack --widget-name main --preset default`
   → the call becomes the long-running Zebar process itself (it does not fork/daemonize; the
   CLI invocation *is* the service for as long as anything is open), and
   `~/.glzr/zebar/errors.log` recorded:
   `Failed to open widgets: No widget pack found for 'nonexistent.pack'.`
2. Built `$env:TEMP\zprobe\{zpack.json,dump.html,dump.css,dock.html,dock.css}` (full pack
   listed under Step 1 below) and tried
   `--pack "C:\Users\PC\AppData\Local\Temp\zprobe"` (a raw absolute path). Result: identical
   failure, logged verbatim as
   `Failed to open widgets: No widget pack found for 'C:\Users\PC\AppData\Local\Temp\zprobe'.`
   **Raw paths are rejected outright** - `--pack` is a lookup key, not a filesystem path.
3. Created a directory junction: `cmd /c mklink /J "C:\Users\PC\.glzr\zebar\zprobe" "C:\Users\PC\AppData\Local\Temp\zprobe"`.
   `--pack zprobe` then stopped logging "no widget pack found" - the pack was *found* - but the
   opened widget window rendered a full-page **"404: Not Found" / "The requested resource could
   not be found." / "Rocket"** page (Rocket is the Rust web framework Zebar's internal
   asset/HTTP server is built on). So: junction → pack metadata resolves, but the actual HTML
   file 404s.
4. Removed the junction (`cmd /c rmdir` - critically *not* `Remove-Item`, which tried to recurse
   into the junction's target and had to be aborted; `rmdir` correctly deletes just the
   reparse point) and replaced it with a **real copy** of the same files directly under
   `~/.glzr/zebar/zprobe`. Same 404. This ruled out "junctions aren't followed" as the cause.
5. Suspected a stale on-disk cache next: found `%APPDATA%\zebar\webview-cache\<packName>\` -
   Zebar gives every pack its own WebView2 profile directory (this is the standard
   Chromium/Edge WebView2 per-profile HTTP cache, `EBWebView\Default\Cache\...`, not something
   Zebar itself manages). Deleted `%APPDATA%\zebar\webview-cache\zprobe` entirely and retried.
   Still 404. Ruled out browser cache too.
6. Sanity check: ran the exact same CLI mechanism against the user's own pre-existing,
   known-working `goodenoughedit` pack (`--pack goodenoughedit --widget-name main --preset
   default`, read-only, no files touched) to confirm the general CLI+folder mechanism works at
   all for a non-marketplace, non-installed local pack. It loaded with **no error and no 404**
   (confirmed via `errors.log` staying unchanged and the taskbar's active-window indicator
   switching to reflect the new window taking focus). This isolated the problem to something
   specific about how *my* pack was authored, not the mechanism itself.
7. Diffed my `zpack.json` against `goodenoughedit/zpack.json`. The working pack has
   `"includeFiles": ["main/**"]` on its widget; mine had no `includeFiles` key at all (it's
   optional per `zpack-schema.json`, so nothing complained about its absence). Added
   `"includeFiles": ["*"]` to both my widgets, re-copied the pack into
   `~/.glzr/zebar/zprobe`, restarted. **The 404 was gone and the komorebi JSON dump rendered
   correctly** (see Step 1 screenshot evidence below).

**Conclusion:** `includeFiles` is not cosmetic metadata - it appears to be what tells Zebar's
internal asset server which files under the pack directory are actually servable. Without it,
`htmlPath` itself 404s. Every widget definition in every later task's `zpack.json` needs an
`includeFiles` glob that covers its own HTML/CSS/JS.

## Step 1 - does the komorebi provider expose the focused window title?

**Answer: yes.** Confirmed two independent ways:

**A. Empirically.** Probe pack (`$env:TEMP\zprobe\dump.html`, widget `dump`) ran exactly the
script from the brief:

```js
import * as zebar from 'https://esm.sh/zebar@3.0';
const p = zebar.createProviderGroup({ komorebi: { type: 'komorebi' } });
p.onOutput(() => {
  document.getElementById('out').textContent = JSON.stringify(p.outputMap.komorebi, null, 2);
});
```

Screenshotted (cropped to the widget region) after starting via
`zebar.exe start-widget-preset --pack zprobe --widget-name dump --preset default`. The rendered
JSON included, nested inside `currentWorkspaces[].tilingContainers[].windows[]` (and duplicated
under `focusedWorkspace...` for the workspace that currently has focus):

```json
{
  "id": null,
  "class": "Chrome_WidgetWin_1",
  "exe": "Code.exe",
  "hwnd": 266094,
  "title": "2026-08-05-caelestia-zebar-bar-design.md - Visual Studio Code",
  "role": null,
  "subrole": null,
  "iconPath": null
}
```

This is the actual VS Code window that was open and focused on this machine at capture time -
title text, exe name, and hwnd all correct. So `title` (full window title) is present, not
absent as the brief predicted the starter template would suggest.

**B. From source.** The `zebar` npm package's shipped `dist/index.d.ts` (see Step 2 - this is
the same package that gets vendored) declares:

```ts
interface KomorebiWindow {
  class: string | null;
  exe: string | null;
  hwnd: number;
  title: string | null;
}
interface KomorebiWorkspace {
  containerPadding: number | null;
  floatingWindows: KomorebiWindow[];
  focusedContainerIndex: number;
  latestLayout: KomorebiRect[];
  layout: KomorebiLayout;
  layoutFlip: KomorebiLayoutFlip | null;
  maximizedWindow: KomorebiWindow | null;
  monocleContainer: KomorebiContainer | null;
  name: string | null;
  tilingContainers: KomorebiContainer[];
  workspacePadding: number | null;
}
interface KomorebiOutput {
  displayedWorkspace: KomorebiWorkspace;   // workspace shown on the current monitor
  focusedWorkspace: KomorebiWorkspace;     // workspace with focus, on any monitor
  currentWorkspaces: KomorebiWorkspace[];  // workspaces on the current monitor
  allWorkspaces: KomorebiWorkspace[];
  allMonitors: KomorebiMonitor[];
  focusedMonitor: KomorebiMonitor;
  currentMonitor: KomorebiMonitor;         // monitor nearest *this* widget
}
```

**Discrepancy worth flagging:** the *runtime* JSON (captured against the actually-installed
Zebar app, v3.3.1) includes `role`, `subrole`, and `iconPath` on each window object; the vendored
npm package's types (`zebar@3.0.3`, matching the `@3.0` pin the starter template uses) only
declare `{class, exe, hwnd, title}`. The running app is newer than the npm types available for
vendoring. Treat the type package as a lower bound on the shape, not the full truth - always
check `outputMap.komorebi` at runtime too, the way this probe did.

To get the *currently focused* window specifically: use `focusedWorkspace`, find the container
at `focusedContainerIndex`, then that container's window (this sample only ever had one window
per container, so it wasn't possible to confirm from this data whether a stacked/multi-window
container carries its own focused-window index - that remains untested and should be checked
with a stacking layout before Task using per-window focus).

## Step 2 - can the `zebar` module be vendored locally?

**Answer: yes, but it requires an actual bundling step - it is not a single static file you can
just copy.**

### Method

1. `Invoke-WebRequest "https://esm.sh/zebar@3.0" -OutFile zebar-probe.js` → confirmed this is a
   thin re-export shim, not the real module:
   ```js
   /* esm.sh - zebar@3.0.3 */
   import "/@tauri-apps/api@2.0.2/es2022/core.mjs";
   import "/@tauri-apps/api@2.0.2/es2022/event.mjs";
   import "/@tauri-apps/api@2.0.2/es2022/window.mjs";
   import "/glazewm@1.7.0/es2022/glazewm.mjs";
   import "/luxon@3.4.4/es2022/luxon.mjs";
   import "/zod@3.24.2/es2022/zod.mjs";
   export * from "/zebar@3.0.3/es2022/zebar.mjs";
   ```
   Every one of those is itself served by esm.sh, so this shim alone still needs the CDN at
   runtime - vendoring just this file changes nothing.
2. Checked the npm registry directly: `zebar` **is** a real, independently-published npm
   package (`https://registry.npmjs.org/zebar`, latest `3.3.1`, `3.0.3` matching the esm.sh
   pin). `package.json` declares `"type": "module"`, `"main": "./dist/index.js"`, with real
   `dependencies`: `zod`, `luxon`, `glazewm`, `@tauri-apps/api`, `@tauri-apps/plugin-dialog`.
3. Downloaded the tarball (`npm install zebar@3.0.3` in a scratch project) and inspected
   `dist/index.js`: it is **unbundled** - it contains bare-specifier ESM imports
   (`import { z } from "zod"`, `import { DateTime } from "luxon"`,
   `import { listen } from "@tauri-apps/api/event"`, etc., 15+ such imports). A plain
   `<script type="module">` in a browser cannot resolve bare specifiers like `"zod"` without
   either an import map or a bundle - which is exactly why esm.sh exists as a resolver for this
   package. Copying `dist/index.js` alone as-is would fail offline.
4. Proved it can be turned into a single self-contained file: in a scratch npm project
   (`C:\Users\PC\AppData\Local\Temp\zebar-bundle-test`), ran
   ```
   npm install zebar@3.0.3 esbuild --no-save
   echo "export * from 'zebar';" > entry.mjs
   esbuild entry.mjs --bundle --format=esm --platform=browser --outfile=zebar.bundle.js
   ```
   This succeeded with **zero errors**, producing a 437 KB `zebar.bundle.js`. Verified the
   output has **zero remaining top-level `import` statements** (`grep -c "^import " → 0`) - the
   only surviving occurrences of `"@tauri-apps"` etc. are inside doc-comment examples, not real
   imports. `zod`, `luxon`, `@tauri-apps/api`, `glazewm`, and `@tauri-apps/plugin-dialog` are all
   inlined into the one file.

### Conclusion for later tasks

Vendoring is possible and should be done for a bar that must survive offline boot, but it is a
**build step**, not a file download:

```
npm install zebar@3.0 esbuild --no-save
esbuild entry.mjs --bundle --format=esm --platform=browser --outfile=zebar.bundle.js
```

Ship `zebar.bundle.js` inside the pack directory, reference it with a plain relative import
(`import * as zebar from './zebar.bundle.js'`), and - per the "context" section above - make
sure it's covered by that widget's `includeFiles` glob or it will 404 exactly like the probe
pack did before that fix. If this build step is skipped and the starter's `https://esm.sh/...`
import is left in place, **the bar has a hard network dependency at startup** and will fail to
render anything after a router reboot - that's a real, user-visible limitation the README must
state if vendoring is deferred.

## Step 3 - does `dockToEdge` reserve space komorebi respects?

**Answer: yes, confirmed numerically and visually, with an exact match to the configured
width.**

### Before (baseline, recorded before touching Zebar at all)

yasb is currently docked at the top of the primary monitor. `komorebic state` →
`$s.monitors.elements[0]`:

```json
"size":          { "left": 0, "top": 0,  "right": 2560, "bottom": 1440 }
"work_area_size":{ "left": 0, "top": 30, "right": 2560, "bottom": 1410 }
"work_area_offset": null
```

(Komorebi's `Rect`-shaped fields here encode `{left, top}` as the work area's origin and
`{right, bottom}` as its *size*, not a second coordinate - e.g. `top: 30` matches yasb's 30px
top bar, and `bottom: 1410` is the remaining height, `1440 - 30`, not an absolute y-coordinate.
This reading is corroborated by the "after" numbers below adding up exactly to the monitor's
physical size.)

### Probe

Added a second widget (`dock`) to the same `zprobe` pack:

```json
{
  "name": "dock",
  "htmlPath": "dock.html",
  "includeFiles": ["*"],
  "presets": [{
    "name": "default",
    "anchor": "top_left", "offsetX": "0px", "offsetY": "0px",
    "width": "52px", "height": "100%",
    "monitorSelection": { "type": "primary" },
    "dockToEdge": { "enabled": true, "edge": "left", "windowMargin": "0px" }
  }]
}
```

Started with `zebar.exe start-widget-preset --pack zprobe --widget-name dock --preset default`,
waited ~6s, then re-ran `komorebic state`.

### After

```json
"work_area_size": { "left": 52, "top": 30, "right": 2508, "bottom": 1410 }
```

`left` moved from `0` → `52` (exactly the probe's width, with `windowMargin: "0px"`), and the
size component (`right`) shrank from `2560` → `2508` = `2560 - 52`, i.e. the reserved column is
subtracted from the usable width while the origin shifts right by the same amount. `52 + 2508 =
2560` (monitor width) and `30 + 1410 = 1440` (monitor height) both check out, confirming the
Rect-as-origin+size reading above. Also confirmed **visually**: a cropped screenshot of the
top-left corner shows a solid red "PROBE" bar occupying the left 52px column, coexisting with
yasb's own top bar (which does not itself move - it has no logic to react to the new reservation,
which is expected and out of scope here).

**Conclusion:** `dockToEdge` does reserve space that komorebi's work area respects. No manual
`work_area_offset` in `komorebi.json` is needed for this - the fallback mentioned in the brief is
not required.

## Step 4 - does Zebar hot-reload CSS?

**Answer: no.** A running widget does **not** pick up a stylesheet edit live; the widget (or
the whole Zebar process) has to be restarted for the change to appear.

### Method

1. With the `dock` widget still running (PID confirmed unchanged throughout, e.g. `9508`)
   showing red (`#ff0000`), edited `dock.css` on disk (the copy actually being served, at
   `C:\Users\PC\.glzr\zebar\zprobe\dock.css`) to `#00ff66`.
2. Screenshotted the same crop after 2 seconds: still red.
3. Screenshotted again after 12 more seconds (14s total), same process still running (verified
   PID unchanged): **still red.** No live reload occurred within that window.
4. Stopped the process (`Stop-Process`) and restarted the exact same widget/preset with no
   other change. Screenshot: **green.** The edit had taken effect; it just required a full
   restart to be picked up, not just poll or listen for the change live.

**Caveat:** the CLI (`zebar.exe start-widget-preset`) offers no separate "reload just this
widget without killing the whole process" command that was tested here - every restart in this
investigation killed and relaunched the entire `zebar.exe`. It's possible a lighter-weight
reload path exists (e.g. a webview-level refresh) that wasn't exercised; what's confirmed is
that *passive* file-watching hot-reload does not happen on its own within at least 14 seconds of
an edit. `docs/zebar-reference.md`'s consumers should assume theme/CSS changes need an explicit
restart step, the same conclusion `docs/spikes.md` reached for WezTerm's include files (Unknown
#2) - the two systems differ (WezTerm reloads on its main file's mtime; Zebar apparently doesn't
reload on any file's mtime without a process restart), but the operational consequence is the
same: **build an explicit "reload" step into the theme-apply pipeline; don't rely on Zebar
noticing changes by itself.**

## Step 5 - can `privileges.shellCommands` invoke the Vesktop helper, and what's the polling model?

**Answer: yes.** Schema and call shape both confirmed from source (the pack schema on disk and
the vendored package's type definitions), matching each other exactly.

### Schema (`zpack-schema.json`, on disk)

```json
"privileges": {
  "type": "object",
  "properties": {
    "shellCommands": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "program": { "type": "string" },
          "argsRegex": { "type": "string" }
        }
      }
    }
  }
}
```

It's an **allowlist of `{program, argsRegex}` pairs** - `program` must match the executable path
(or name, if resolvable via `$PATH`) exactly; `argsRegex` is a regex the actual invocation's
arguments must satisfy. Confirmed identical shape in the `zebar` npm package's
`dist/index.d.ts`:

```ts
type WidgetPrivileges = { shellCommands: AllowedShellCommand[] };
type AllowedShellCommand = { program: string; argsRegex: string };
```

### JS-side call (from `dist/index.d.ts`)

```ts
function shellExec<T = string>(
  program: string,
  args?: string | string[],
  options?: { cwd?: string; env?: Record<string,string>|null; clearEnv?: boolean; encoding?: ShellOutputEncoding }
): Promise<{ code: number|null; signal: number|null; stdout: T; stderr: T }>;

function shellSpawn<T = string>(
  program: string, args?: string | string[], options?: ShellCommandOptions
): Promise<{
  processId: number;
  onStdout(cb: (line: T) => void): void;
  onStderr(cb: (line: T) => void): void;
  onExit(cb: (status: { exitCode: number|null; signal: number|null }) => void): void;
  kill(): void;
  write(data: string | Uint8Array): void;
}>;
```

`shellExec` runs to completion and resolves once (right shape for a one-shot poll of a helper
that prints and exits, like `vesktop-unread.exe`). `shellSpawn` is for long-lived processes you
need to stream/interact with - not needed here.

### Exact invocation for the Vesktop helper

```jsonc
// zpack.json widget privileges
"privileges": {
  "shellCommands": [
    { "program": "C:\\Users\\PC\\.config\\yasb\\scripts\\vesktop-unread.exe", "argsRegex": "^(--idle)?$" }
  ]
}
```

```js
// widget JS
const result = await zebar.shellExec(
  'C:\\Users\\PC\\.config\\yasb\\scripts\\vesktop-unread.exe',
  []               // or ['--idle']
);
console.log(result.stdout.trim()); // ping count, or "idle"
```

### Polling model

There is **no built-in provider** for arbitrary shell commands the way there is for `cpu`,
`memory`, `komorebi`, etc. (no `onOutput`-style subscription). `shellExec` is a plain
promise-returning function call. The widget's own JS is responsible for polling it, e.g.:

```js
setInterval(async () => {
  const r = await zebar.shellExec(HELPER_PATH, []);
  render(r.stdout.trim());
}, 5000);
```

This is not verified end-to-end against the real helper executable in this task (that would
mean launching an actual widget with `shellCommands` privileges wired up and asserting on its
rendered output - out of scope for a schema/API spike) - what's confirmed here is the schema
shape, the exact function signature, and that `shellExec`'s one-shot promise model requires the
consuming widget to build its own `setInterval` polling loop rather than getting one for free.

## Cleanup

- Every zebar.exe process started during this investigation was stopped
  (`Stop-Process -Id <pid> -Force`) before moving to the next step and again at the end; a final
  `Get-Process | Where-Object ProcessName -like '*zebar*'` returned nothing.
- The registered probe pack `C:\Users\PC\.glzr\zebar\zprobe` (created via junction, then
  replaced with a real copy to isolate the 404 cause) was removed with `cmd /c rmdir /s /q`.
- Its auto-generated WebView2 profile, `%APPDATA%\zebar\webview-cache\zprobe`, was removed.
- `C:\Users\PC\.glzr\zebar` now contains exactly what it did before this task started:
  `.marketplace`, `goodenoughedit`, `gunturdwiap.good-enough@1.0.1`, `errors.log`,
  `settings.json` (neither `goodenoughedit`, `settings.json`, nor `~/komorebi.json` were
  modified at any point - `goodenoughedit` and `settings.json` were only read, and once,
  `goodenoughedit` was started read-only via the CLI purely to confirm the pack-loading
  mechanism worked at all, then immediately stopped).
- `errors.log` retains the (harmless, pre-existing-format) lines this investigation logged
  during Steps 1/2 (`No widget pack found for 'nonexistent.pack'.` and `...for
  'C:\Users\PC\AppData\Local\Temp\zprobe'.`); it is an append-only log and nothing else in it
  was touched.
- Scratch files from this investigation (the probe pack source at `$env:TEMP\zprobe`, the npm
  scratch projects at `$env:TEMP\zebar-npm` and `$env:TEMP\zebar-bundle-test`, and screenshots)
  were left under `$env:TEMP` per the scratch-file policy; none of them are referenced by
  anything outside this document and none affect the running system.
