import { test } from 'node:test';
import assert from 'node:assert';
import { renderEntries, parseBarConfig } from '../../zebar/caelestia/bar/entries/render.js';

// I3: bar.js's per-entry try/catch protected update() but NOT create() --
// create() throws on an unknown type (registry.js), which aborted the
// whole `for` loop and left every entry after the bad one (and #bar itself,
// on the first iteration) never appended. Skipping the documented "add an
// entry" workflow's import step (write module -> import -> add to config)
// silently blanked the entire bar, with nothing in errors.log to explain
// why -- per this branch's own finding, JS errors never reach that log.

function fakeContainer() {
  return {
    children: [],
    appendChild(el) { this.children.push(el); },
  };
}

function fakeEl(tag) {
  return { tag, classList: { added: [], add(c) { this.added.push(c); } } };
}

test('renderEntries skips an entry whose factory throws instead of aborting the whole bar', () => {
  const ctx = {};
  const createFn = (type) => {
    if (type === 'bad') throw new Error(`unknown entry type: ${type}`);
    return { el: fakeEl(type), update() {} };
  };
  const entries = ['logo', 'bad', 'clock', 'power'];

  // First, reproduce the OLD bar.js loop verbatim to prove this is a real,
  // exercised regression -- not a hypothetical -- against the exact same
  // createFn/entries fixture used to prove the fix below.
  const oldContainer = fakeContainer();
  let oldThrew = false;
  try {
    for (const type of entries) {
      const inst = createFn(type, ctx);
      inst.el.classList.add('entry');
      oldContainer.appendChild(inst.el);
    }
  } catch (e) {
    oldThrew = true;
  }
  assert.strictEqual(oldThrew, true, 'the old unguarded loop must actually throw for this fixture');
  assert.strictEqual(oldContainer.children.length, 1, 'old loop: only "logo" made it in before the throw aborted everything after it');

  // Now the fix: unknown/throwing entries are skipped, not fatal.
  const container = fakeContainer();
  const instances = renderEntries(entries, ctx, container, createFn);

  assert.strictEqual(container.children.length, 3, 'logo, clock, power should all render; only "bad" is skipped');
  assert.strictEqual(instances.length, 3);
  assert.deepStrictEqual(container.children.map(el => el.tag), ['logo', 'clock', 'power']);
});

test('renderEntries adds the "entry" class to every successfully-created element', () => {
  const container = fakeContainer();
  const createFn = (type) => ({ el: fakeEl(type), update() {} });
  renderEntries(['logo', 'clock'], {}, container, createFn);
  for (const el of container.children) {
    assert.ok(el.classList.added.includes('entry'));
  }
});

test('renderEntries renders every entry unchanged when none throw (regression control)', () => {
  const container = fakeContainer();
  const createFn = (type) => ({ el: fakeEl(type), update() {} });
  const instances = renderEntries(['logo', 'workspaces', 'clock'], {}, container, createFn);
  assert.strictEqual(instances.length, 3);
  assert.strictEqual(container.children.length, 3);
});

test('parseBarConfig returns the parsed entries array for well-formed JSON', () => {
  const config = parseBarConfig('{ "entries": ["logo", "clock"] }');
  assert.deepStrictEqual(config.entries, ['logo', 'clock']);
});

test('parseBarConfig does not throw on malformed JSON, and returns an empty entries array', () => {
  // The original bar.js did `await fetch(...).then(r => r.json())` at
  // MODULE SCOPE -- a malformed bar.config.json threw straight out of the
  // module with nothing catching it, which is strictly worse than a
  // blanked bar: the whole script fails to evaluate at all.
  assert.doesNotThrow(() => parseBarConfig('not json {{{'));
  const config = parseBarConfig('not json {{{');
  assert.deepStrictEqual(config.entries, []);
});

test('parseBarConfig returns an empty entries array when "entries" is missing or not an array', () => {
  assert.deepStrictEqual(parseBarConfig('{}').entries, []);
  assert.deepStrictEqual(parseBarConfig('{ "entries": "logo" }').entries, []);
  assert.deepStrictEqual(parseBarConfig('null').entries, []);
});
