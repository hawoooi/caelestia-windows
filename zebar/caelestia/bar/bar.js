import * as zebar from './vendor/zebar.js';
import { create } from './entries/registry.js';
import './entries/index.js';                   // registers every entry type

const providers = zebar.createProviderGroup({
  komorebi: { type: 'komorebi' },
  date:     { type: 'date', formatting: 'HH:mm' },
  audio:    { type: 'audio' },
  media:    { type: 'media' },
  network:  { type: 'network' },
  battery:  { type: 'battery' },
});

const config = await fetch('./bar.config.json').then(r => r.json());
const container = document.getElementById('bar');
const instances = [];

// ctx carries BOTH providers and the shell handle -- the vesktop entry (Task 7)
// needs `shell`, so it must be in the context from the start.
const ctx = { providers, shell: zebar.shellExec ? zebar : null };

for (const type of config.entries) {
  const inst = create(type, ctx);
  inst.el.classList.add('entry');
  container.appendChild(inst.el);
  instances.push(inst);
}

function tick() {
  const out = providers.outputMap;
  for (const inst of instances) {
    try { inst.update(out); }
    catch (e) { console.error('entry update failed', e); }
  }
}

providers.onOutput(tick);
tick();
