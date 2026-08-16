import { register } from './registry.js';
// The one place that knows how to get every window out of a komorebi
// workspace. There are FOUR places komorebi can put one -- tiling containers,
// floating windows, a maximized window, and a monocle container -- and
// counting only `tilingContainers.length` would both miss the other three and
// count an empty container as occupied.
import { workspaceWindows } from '../../dock-items.js';

/**
 * The workspaces to show, in order.
 *
 * Direct user request: "can we make the workspaces on the left bar not appear
 * when the desktop hasn't been used?" -- komorebi always reports all nine, so
 * the bar used to show nine buttons of which seven were usually empty.
 *
 * An EMPTY workspace is the one that has not been used; komorebi keeps no
 * "visited" flag, and none is wanted -- a workspace you opened once and
 * emptied should disappear again.
 *
 * The focused workspace is always kept even when empty. Dropping it would mean
 * that stepping onto an empty workspace makes the bar show no current position
 * at all, which is worse than one extra button.
 *
 * `index` is the workspace's ORIGINAL position, and is load-bearing:
 * `komorebic focus-workspace` takes a zero-indexed position, not the displayed
 * name, and the two only look alike. Once the list is filtered, the position
 * in THIS array is no longer the position komorebi means -- clicking "5" in a
 * filtered list of two would focus workspace 2. Callers must use `.index`, and
 * never the map index.
 */
export function workspaceState(komorebi, { onlyOccupied = true } = {}) {
  if (!komorebi || !Array.isArray(komorebi.currentWorkspaces)) return [];
  const focused = komorebi.focusedWorkspace?.name;
  const all = komorebi.currentWorkspaces.map((w, index) => ({
    name: w.name,
    index,
    focused: w.name === focused,
    occupied: workspaceWindows(w).length > 0,
  }));
  return onlyOccupied ? all.filter((w) => w.occupied || w.focused) : all;
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
      el.replaceChildren(...state.map((w) => {
        const b = document.createElement('button');
        b.className = 'workspace' + (w.focused ? ' workspace--focused' : '');
        b.textContent = w.name;
        b.addEventListener('click', () => {
          if (!shell) {
            console.warn('focus-workspace: no shell handle in ctx, cannot run komorebic');
            return;
          }
          // w.index, NOT this button's position in the rendered list. The list
          // is filtered to occupied workspaces, so the two differ as soon as
          // any workspace is empty -- and komorebic takes a position.
          const { program, args } = focusWorkspaceCommand(w.index);
          // Fail soft, per the brief: a failed click warns to console and
          // never throws out of the entry -- update() is wrapped in bar.js's
          // per-entry try/catch, but a click handler runs outside that
          // wrapper, on its own event-loop turn.
          shell.shellExec(program, args).catch(e => {
            console.warn(`focus-workspace ${w.index} failed`, e);
          });
        });
        return b;
      }));
    },
  };
});
