import { register } from './registry.js';

// Focus is flagged at the CONTAINER level, not per window. Verified against
// zebar's index.d.ts at both 3.0.3 and 3.3.1: `KomorebiWindow` is
// {id, class, exe, hwnd, title, role, subrole, icon_path} -- there is no
// `isFocused` field at any version. Use `focusedWorkspace.focusedContainerIndex`
// to pick the container, then the window within it.
//
// There is NO within-container focused-window index in zebar's type at all:
// `KomorebiContainer` is exactly {id: string, windows: KomorebiWindow[]} at
// both 3.0.3 and 3.3.1 (checked via `npm pack zebar@<version>` and reading
// dist/index.d.ts) -- no `focusedWindowIndex` or similar field exists to read.
// This isn't a naming guess to correct; zebar simply doesn't expose which
// window in a stacked container has focus, so windows[0] is the only option
// the provider gives us. It is also correct for the common case of a
// single-window container, which is the vast majority of the time.
export function windowTitle(komorebi) {
  const ws = komorebi?.focusedWorkspace;
  const containers = ws?.tilingContainers;
  if (!Array.isArray(containers)) return '';

  const ci = ws.focusedContainerIndex;
  const container = typeof ci === 'number' ? containers[ci] : undefined;
  if (!container) return '';

  const windows = container.windows ?? [];
  return windows[0]?.title ?? '';
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
