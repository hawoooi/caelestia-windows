import { register } from './registry.js';
import './logo.js';
import './workspaces.js';
import './clock.js';
import './statusIcons.js';
import './power.js';
import './activeWindow.js';
import './media.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));

// Remaining entry type (vesktop) is added in Task 7. Until an entry lands
// here, its name must NOT appear in bar.config.json's "entries" list --
// create() throws on an unknown type by design, so listing an unimplemented
// entry would break the bar.
