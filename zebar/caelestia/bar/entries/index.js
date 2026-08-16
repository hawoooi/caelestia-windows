import { register } from './registry.js';
import './logo.js';
import './evkey.js';
import './workspaces.js';
import './layoutToggle.js';
import './clock.js';
import './power.js';
import './activeWindow.js';
import './media.js';
import './vesktop.js';
// statusCluster composes the vesktop factory registered above via create(),
// so it must be imported after it.
//
// The 'statusIcons' entry that used to sit in this list was RETIRED in the
// pinned/dropdown pass: its wifi/volume/battery glyph logic moved to
// ../../status-catalogue.js, which statusCluster renders directly from the
// configured pinned list. It was deleted rather than left registered so
// there is exactly one place that decides which glyph a given status means
// -- the retired copy had already drifted (it picked a volume glyph purely
// by level, ignoring the device's isMuted flag).
import './statusCluster.js';
// The system-tray trigger: a bar button that opens the panels flyout's 'tray'
// panel. Independent of statusCluster (no shared state) -- just another entry.
import './trayToggle.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));
