import { register } from './registry.js';

register('spacer', () => ({
  el: Object.assign(document.createElement('div'), { className: 'entry--spacer' }),
  update() {},
}));

// Every other entry type (logo, workspaces, activeWindow, media, vesktop, clock,
// statusIcons, power) is added in Tasks 5-7. Until an entry lands here, its name
// must NOT appear in bar.config.json's "entries" list -- create() throws on an
// unknown type by design, so listing an unimplemented entry would break the bar.
