// I3: extracted from bar.js so its two riskiest steps -- constructing every
// configured entry, and parsing bar.config.json -- are plain, DOM-free
// functions that can be unit tested with node --test (no fetch, no
// document, no top-level await needed).

export function renderEntries(entryTypes, ctx, container, createFn) {
  // registry.js's create() throws on an unknown type (by design -- see its
  // own test). The old bar.js called it bare inside the loop: a single bad
  // name in bar.config.json (e.g. the documented "add an entry" workflow's
  // import step skipped) threw out of the loop entirely, leaving every
  // entry after the bad one -- and #bar itself, if the throw happened on
  // the first iteration -- never appended. Guarding construction per-entry
  // means one bad/unknown type is skipped (loudly, via console.error) and
  // every other configured entry still renders.
  const instances = [];
  for (const type of entryTypes) {
    let inst;
    try {
      inst = createFn(type, ctx);
    } catch (e) {
      console.error(`bar.config.json: failed to create entry '${type}'`, e);
      continue;
    }
    inst.el.classList.add('entry');
    container.appendChild(inst.el);
    instances.push(inst);
  }
  return instances;
}

export function parseBarConfig(text) {
  // The old bar.js did `await fetch('./bar.config.json').then(r => r.json())`
  // at MODULE SCOPE -- a malformed bar.config.json threw straight out of
  // the module (uncaught), failing the whole script before it ever got a
  // chance to render anything, including entries that would have been
  // perfectly fine. Parsing explicitly here, with its own try/catch, means
  // a malformed config degrades to an empty bar (still bad, but recoverable
  // and loud) instead of a script that never even starts.
  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    console.error('bar.config.json is not valid JSON', e);
    return { entries: [] };
  }
  if (!config || !Array.isArray(config.entries)) {
    console.error('bar.config.json is missing an "entries" array');
    return { entries: [] };
  }
  return config;
}
