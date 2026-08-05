import * as zebar from './vendor/zebar.js';
import { create } from './entries/registry.js';
import './entries/index.js';                   // registers every entry type
import { renderEntries, parseBarConfig } from './entries/render.js';

const providers = zebar.createProviderGroup({
  komorebi: { type: 'komorebi' },
  date:     { type: 'date', formatting: 'HH:mm' },
  audio:    { type: 'audio' },
  media:    { type: 'media' },
  network:  { type: 'network' },
  battery:  { type: 'battery' },
});

// I3: fetch as text, not `.then(r => r.json())` -- the latter throws
// straight out of this module's top-level await on malformed JSON, with
// nothing here to catch it. parseBarConfig owns its own try/catch instead
// (see entries/render.js) and degrades to an empty bar rather than a script
// that never runs at all.
const configText = await fetch('./bar.config.json').then(r => r.text());
const config = parseBarConfig(configText);
const container = document.getElementById('bar');

// ctx carries BOTH providers and the shell handle -- the vesktop entry (Task 7)
// needs `shell`, so it must be in the context from the start.
const ctx = { providers, shell: zebar.shellExec ? zebar : null };

// I3: renderEntries (entries/render.js) guards construction per-entry --
// create() throws on an unknown type (registry.js), and the old bare loop
// here let that throw abort the whole thing, blanking every entry after
// the bad one. See render.test.mjs for the reproduction.
const instances = renderEntries(config.entries, ctx, container, create);

function tick() {
  const out = providers.outputMap;
  for (const inst of instances) {
    try { inst.update(out); }
    catch (e) { console.error('entry update failed', e); }
  }
}

providers.onOutput(tick);
tick();
