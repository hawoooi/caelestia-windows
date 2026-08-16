import * as zebar from './vendor/zebar.js';
import { create } from './entries/registry.js';
import './entries/index.js';                   // registers every entry type
import { renderEntries, parseBarConfig } from './entries/render.js';
import { startFullscreenWatch } from '../fullscreen.js';
import { parseStatusConfig } from '../status-catalogue.js';

const providers = zebar.createProviderGroup({
  komorebi: { type: 'komorebi' },
  date:     { type: 'date', formatting: 'HH:mm' },
  audio:    { type: 'audio' },
  media:    { type: 'media' },
  network:  { type: 'network' },
  // battery ERRORS rather than resolving on a machine with no battery ("No
  // battery found.", confirmed live on this desktop). createProviderGroup
  // absorbs that into a null entry in outputMap, which is exactly what the
  // catalogue's available() check keys off -- see ../status-catalogue.js, so
  // a batteryless machine simply never renders a battery row.
  battery:  { type: 'battery' },
  // Added for the status dropdown (bar.config.json's `status` block). Field
  // shapes for all three were read live over CDP before anything consumed
  // them -- cpu.usage, memory.usage/usedMemory/totalMemory, and
  // disk.disks[].{mountPoint,totalSpace,availableSpace} -- rather than
  // assumed; see docs/zebar-bar.md.
  cpu:      { type: 'cpu' },
  memory:   { type: 'memory' },
  disk:     { type: 'disk' },
  // EVKey's input mode is read from its TRAY TOOLTIP (see
  // entries/evkey.js). A provider subscription, not a poll -- nothing here
  // spawns a process.
  systray:  { type: 'systray' },
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
// statusConfig carries the pinned/dropdown split (bar.config.json's "status"
// block) to entries/statusCluster.js. Parsed once here, not per entry, and
// normalised so a malformed block degrades loudly to the shipped default
// instead of taking the bar down -- see parseStatusConfig.
const ctx = {
  providers,
  shell: zebar.shellExec ? zebar : null,
  statusConfig: parseStatusConfig(config.status),
  // Passed through verbatim; the clock panel parses it in the flyout so the
  // validation lives next to the timezone code that depends on it.
  clockConfig: config.clock ?? null,
};

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

// User feedback: the bar (and the rest of the desktop frame -- corners.js,
// edges/edges.js run the same watch independently, since each is a
// separate widget window) should disappear along with the frame when
// something goes fullscreen.
startFullscreenWatch(ctx.shell, (isFullscreen) => {
  document.body.classList.toggle('fullscreen-hidden', isFullscreen);
});
