// The komorebic invocations this pack makes, in one place.
//
// The komorebi PROVIDER is read-only -- unlike the glazewm one, it exposes no
// focus/layout methods, only state. So anything that changes the WM's state
// has to shell out, and every widget that does must agree on the binary path
// and the exact argument shape, because zpack.json's `argsRegex` allowlists
// them literally: a widget that builds a command slightly differently is
// rejected at runtime with a privilege error rather than working.
//
// Previously these lived in bar/entries/workspaces.js and
// bar/entries/layoutToggle.js, with the path spelled out separately in each.
// The dashboard is the third caller, and importing a bar ENTRY module just to
// reach a string would have run that entry's `register()` side effect in a
// document that has no bar. Both entry modules now re-export from here, so
// their existing importers (and tests) are unaffected.

export const KOMOREBIC_PATH = 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe';

// `focus-workspace <TARGET>` takes a zero-indexed *position* (verified against
// `komorebic focus-workspace --help`), NOT the workspace *name* the buttons
// display. Names are arbitrary text as far as komorebic is concerned; the two
// numbering schemes only look alike here because this config happens to name
// workspaces after their 1-indexed position. Always build from the array
// position, never from `w.name`.
export function focusWorkspaceCommand(index) {
  return { program: KOMOREBIC_PATH, args: ['focus-workspace', String(index)] };
}

export function changeLayoutCommand(layout) {
  return { program: KOMOREBIC_PATH, args: ['change-layout', layout] };
}
