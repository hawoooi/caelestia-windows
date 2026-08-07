import { register } from './registry.js';

export function workspaceState(komorebi) {
  if (!komorebi || !Array.isArray(komorebi.currentWorkspaces)) return [];
  const focused = komorebi.focusedWorkspace?.name;
  return komorebi.currentWorkspaces.map(w => ({ name: w.name, focused: w.name === focused }));
}

// The command builder moved to ../../komorebi-commands.js when the dashboard
// became its third caller -- see that file for why (and for the full account
// of why the target is a zero-indexed position, never the displayed name).
// Re-exported here so this module's existing importers keep working.
export { KOMOREBIC_PATH, focusWorkspaceCommand } from '../../komorebi-commands.js';
import { focusWorkspaceCommand } from '../../komorebi-commands.js';

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
