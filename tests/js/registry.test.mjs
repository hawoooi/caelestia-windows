import { test } from 'node:test';
import assert from 'node:assert';
import { register, create, clear, knownTypes } from '../../zebar/caelestia/bar/entries/registry.js';

test('create returns what the registered factory produced', () => {
  clear();
  register('demo', () => ({ el: { tag: 'div' }, update() {} }));
  const made = create('demo', {});
  assert.deepStrictEqual(made.el, { tag: 'div' });
});

test('create throws on an unknown type rather than silently rendering nothing', () => {
  clear();
  assert.throws(() => create('nope', {}), /unknown entry type: nope/);
});

test('knownTypes lists every registered type', () => {
  clear();
  register('a', () => ({ el: {}, update() {} }));
  register('b', () => ({ el: {}, update() {} }));
  assert.deepStrictEqual(knownTypes().sort(), ['a', 'b']);
});

test('registering the same type twice throws', () => {
  clear();
  register('dup', () => ({ el: {}, update() {} }));
  assert.throws(() => register('dup', () => ({ el: {}, update() {} })), /already registered/);
});

test('the factory receives the context object', () => {
  clear();
  let seen = null;
  register('ctx', c => { seen = c; return { el: {}, update() {} }; });
  create('ctx', { hello: 'world' });
  assert.deepStrictEqual(seen, { hello: 'world' });
});
