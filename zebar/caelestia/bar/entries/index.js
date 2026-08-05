import { register } from './registry.js';
import './logo.js';
import './workspaces.js';
import './clock.js';
import './statusIcons.js';
import './power.js';
import './activeWindow.js';
import './media.js';
import './vesktop.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));
