import { register } from './registry.js';
import './logo.js';
import './workspaces.js';
import './layoutToggle.js';
import './clock.js';
import './statusIcons.js';
import './power.js';
import './activeWindow.js';
import './media.js';
import './vesktop.js';
// statusCluster composes the statusIcons/vesktop factories registered
// above via create() -- must be imported after both (see its own comment).
import './statusCluster.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));
