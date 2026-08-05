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
