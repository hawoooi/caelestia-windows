import { register } from './registry.js';

export function workspaceState(komorebi) {
  if (!komorebi || !Array.isArray(komorebi.currentWorkspaces)) return [];
  const focused = komorebi.focusedWorkspace?.name;
  return komorebi.currentWorkspaces.map(w => ({ name: w.name, focused: w.name === focused }));
}

// komorebic's `focus-workspace <TARGET>` takes a zero-indexed *position*
// (verified against `komorebic focus-workspace --help`), not the workspace
// *name* the buttons display ("1".."9" in komorebi.json, but names are
// arbitrary text as far as komorebic is concerned -- the two numbering
// schemes only look the same here because this config happens to name
// workspaces after their 1-indexed position). The command is always built
// from the button's array position, never from `w.name`.
export const KOMOREBIC_PATH = 'C:\\Users\\PC\\scoop\\shims\\komorebic.exe';

export function focusWorkspaceCommand(index) {
  return { program: KOMOREBIC_PATH, args: ['focus-workspace', String(index)] };
}

register('workspaces', ({ shell }) => {
  const el = document.createElement('div');
  el.className = 'workspaces';
  return {
    el,
    update(out) {
      const state = workspaceState(out.komorebi);
      el.replaceChildren(...state.map((w, i) => {
        const b = document.createElement('button');
        b.className = 'workspace' + (w.focused ? ' workspace--focused' : '');
        b.textContent = w.name;
        b.addEventListener('click', () => {
          if (!shell) {
            console.warn('focus-workspace: no shell handle in ctx, cannot run komorebic');
            return;
          }
          const { program, args } = focusWorkspaceCommand(i);
          // Fail soft, per the brief: a failed click warns to console and
          // never throws out of the entry -- update() is wrapped in bar.js's
          // per-entry try/catch, but a click handler runs outside that
          // wrapper, on its own event-loop turn.
          shell.shellExec(program, args).catch(e => {
            console.warn(`focus-workspace ${i} failed`, e);
          });
        });
        return b;
      }));
    },
  };
});
