import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQuery, matchScore, rank, moveSelection,
  COMMAND_PREFIX, COMMANDS,
  parseAppList, parseIcons, listAppsCommand, appIconsCommand,
  launchCommand, isSafeAppPath, appFolder, APP_LIST_PATH, EXPLORER,
} from '../../zebar/caelestia/launcher-data.js';

// --- parseQuery -------------------------------------------------------------

test('plain text searches applications', () => {
  assert.deepEqual(parseQuery('firefox'), { mode: 'app', term: 'firefox' });
});

test('the > prefix switches to commands on the FIRST character, not the space', () => {
  // Requiring "> " would flip the mode on the second keystroke, changing the
  // list under the user after they had already committed to a command.
  assert.deepEqual(parseQuery('>'), { mode: 'command', term: '' });
  assert.deepEqual(parseQuery('>l'), { mode: 'command', term: 'l' });
  assert.deepEqual(parseQuery('> lock'), { mode: 'command', term: 'lock' });
});

test('parseQuery never throws and always returns a usable shape', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const q = parseQuery(bad);
    assert.equal(q.mode, 'app');
    assert.equal(q.term, '');
  }
});

// --- matchScore -------------------------------------------------------------

test('an empty term matches everything equally', () => {
  assert.equal(matchScore('Firefox', ''), 0);
});

test('a subsequence matches -- initials find multi-word names', () => {
  assert.notEqual(matchScore('Visual Studio Code', 'vsc'), null);
  assert.notEqual(matchScore('Firefox', 'ffx'), null);
  assert.equal(matchScore('Firefox', 'xyz'), null);
});

test('characters must appear IN ORDER', () => {
  assert.equal(matchScore('Firefox', 'xof'), null);
});

test('word-boundary initials beat the same letters buried mid-word', () => {
  // "Visual Studio Code" matches v/s/c at three word starts; "Avascular"
  // matches the same three letters entirely inside one word (A-v-a-s-c-ular).
  // Both are valid subsequences, and the boundary rule is the only thing that
  // separates them -- which is exactly what makes "vsc" usable as a shortcut.
  const good = matchScore('Visual Studio Code', 'vsc');
  const bad = matchScore('Avascular', 'vsc');
  assert.ok(good !== null, 'boundary case should match');
  assert.ok(bad !== null, 'mid-word case should still match');
  assert.ok(good < bad, `expected ${good} < ${bad}`);
});

test('a prefix beats the same letters buried mid-word', () => {
  assert.ok(matchScore('Code', 'code') < matchScore('Xcode Legacy', 'code'));
});

test('a CONTIGUOUS match beats a scattered one -- the real Start Menu case', () => {
  // Found against this machine's actual app list: querying "code" ranked
  // "Corel DESIGNER 2025" above "CodeBlocks", because every letter of "code"
  // inside "CodeBlocks" is mid-word and takes the non-boundary penalty, while
  // Corel's d and e land at word starts and escape it.
  const contiguous = matchScore('CodeBlocks', 'code');
  const scattered = matchScore('Corel DESIGNER 2025', 'code');
  assert.ok(scattered !== null, 'the scattered case really does match');
  assert.ok(contiguous < scattered, `expected ${contiguous} < ${scattered}`);
});

test('a substring at a word start beats one buried inside a word', () => {
  const atWordStart = matchScore('Visual Studio Code', 'code');
  const insideWord = matchScore('Barcodex Utility', 'code');
  assert.ok(atWordStart !== null && insideWord !== null);
  assert.ok(atWordStart < insideWord, `expected ${atWordStart} < ${insideWord}`);
});

test('and a leading prefix still beats a mid-string word start', () => {
  assert.ok(matchScore('CodeBlocks', 'code') < matchScore('Visual Studio Code', 'code'));
});

test('a shorter name wins when both match the same way', () => {
  assert.ok(matchScore('Code', 'code') < matchScore('Code Insiders Setup Helper', 'code'));
});

test('matching is case-insensitive in both directions', () => {
  assert.notEqual(matchScore('FIREFOX', 'firefox'), null);
  assert.notEqual(matchScore('firefox', 'FIREFOX'), null);
});

test('a non-string name scores null rather than throwing', () => {
  assert.equal(matchScore(undefined, 'a'), null);
  assert.equal(matchScore(null, 'a'), null);
});

// --- rank -------------------------------------------------------------------

const APPS = [
  { name: 'Adobe Acrobat', path: 'a.lnk' },
  { name: 'Visual Studio Code', path: 'b.lnk' },
  { name: 'Service Console', path: 'c.lnk' },
  { name: 'Steam', path: 'd.lnk' },
];

test('rank returns best-first and drops non-matches', () => {
  const r = rank(APPS, 'vsc');
  assert.equal(r[0].name, 'Visual Studio Code');
  assert.ok(!r.some((e) => e.name === 'Steam'));
});

test('rank honours the limit', () => {
  assert.equal(rank(APPS, '', { limit: 2 }).length, 2);
  assert.equal(rank(APPS, '', { limit: 0 }).length, 0);
});

test('ties keep their incoming order, so the highlighted row does not jump', () => {
  const same = [{ name: 'aaa' }, { name: 'aab' }, { name: 'aac' }];
  assert.deepEqual(rank(same, '', { limit: 3 }).map((e) => e.name), ['aaa', 'aab', 'aac']);
});

test('rank can match a field other than name', () => {
  const r = rank(APPS, 'd.lnk', { key: 'path' });
  assert.equal(r[0].name, 'Steam');
});

test('rank tolerates junk without throwing', () => {
  assert.deepEqual(rank(null, 'x'), []);
  assert.deepEqual(rank([null, undefined, {}], 'x'), []);
});

// --- moveSelection ----------------------------------------------------------

test('the selection wraps at both ends', () => {
  assert.equal(moveSelection(0, -1, 3), 2);
  assert.equal(moveSelection(2, 1, 3), 0);
  assert.equal(moveSelection(1, 1, 3), 2);
});

test('an empty list cannot produce a negative or NaN index', () => {
  assert.equal(moveSelection(0, 1, 0), 0);
  assert.equal(moveSelection(3, -1, 0), 0);
  assert.equal(moveSelection(0, 1, NaN), 0);
});

// --- commands ---------------------------------------------------------------

test('every command is complete and has a distinct id', () => {
  const ids = new Set();
  for (const c of COMMANDS) {
    assert.ok(c.id && c.name && c.detail, `incomplete: ${JSON.stringify(c)}`);
    assert.ok(c.run && c.run.program && Array.isArray(c.run.args), `no run: ${c.id}`);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
  }
});

test('command glyphs are escaped, never raw private-use characters', () => {
  // Raw PUA characters have been silently stripped from a config in this repo
  // before, taking every icon with them. This asserts the codepoints are the
  // intended Font Awesome ones rather than that the source text is escaped --
  // which is what actually matters at runtime.
  for (const c of COMMANDS) {
    assert.equal(c.glyph.length, 1, `${c.id} glyph should be one codepoint`);
    const cp = c.glyph.codePointAt(0);
    assert.ok(cp >= 0xf000 && cp <= 0xf8ff, `${c.id} glyph U+${cp.toString(16)} outside Font Awesome`);
  }
});

test('commands are searchable by name', () => {
  assert.equal(rank(COMMANDS, 'lock')[0].id, 'lock');
  assert.equal(rank(COMMANDS, 'wall')[0].id, 'wallpaper');
});

// --- app-list plumbing ------------------------------------------------------

test('listAppsCommand and appIconsCommand build the right argv', () => {
  assert.deepEqual(listAppsCommand(), { program: APP_LIST_PATH, args: ['list'] });
  assert.deepEqual(appIconsCommand(['a.lnk', 'b.lnk']),
    { program: APP_LIST_PATH, args: ['icons', 'a.lnk', 'b.lnk'] });
});

test('parseAppList reads the tool output', () => {
  const out = parseAppList('{"apps":[{"name":"Steam","path":"s.lnk"},{"name":"Code","path":"c.lnk","icon":"data:image/png;base64,AA"}]}');
  assert.equal(out.length, 2);
  assert.equal(out[0].icon, null, 'a missing icon normalises to null');
  assert.equal(out[1].icon, 'data:image/png;base64,AA');
});

test('parseAppList drops entries missing a name or path rather than rendering blanks', () => {
  const out = parseAppList('{"apps":[{"name":"","path":"a.lnk"},{"name":"O","path":""},{"name":"Good","path":"g.lnk"}]}');
  assert.deepEqual(out.map((a) => a.name), ['Good']);
});

test('parseAppList never throws on junk', () => {
  for (const bad of ['', '   ', 'not json', '{}', '{"apps":null}', null, undefined, 5]) {
    assert.deepEqual(parseAppList(bad), []);
  }
});

test('parseIcons maps path -> dataUrl, with null for "no icon"', () => {
  const m = parseIcons('{"icons":{"a.lnk":"data:image/png;base64,AA","b.lnk":null,"c.lnk":""}}');
  assert.equal(m['a.lnk'], 'data:image/png;base64,AA');
  assert.equal(m['b.lnk'], null, 'null is cached, so a missing icon is not re-probed forever');
  assert.equal(m['c.lnk'], null, 'an empty string is also "no icon"');
});

test('parseIcons never throws on junk', () => {
  for (const bad of ['', 'nope', '{}', '{"icons":5}', null]) {
    assert.deepEqual(parseIcons(bad), {});
  }
});

// --- launching --------------------------------------------------------------

test('launching goes through explorer, which resolves a .lnk', () => {
  assert.deepEqual(launchCommand('C:\\x\\Steam.lnk'), { program: EXPLORER, args: ['C:\\x\\Steam.lnk'] });
});

test('only .lnk paths are considered safe to hand to the shell', () => {
  assert.ok(isSafeAppPath('C:\\Programs\\Steam.lnk'));
  assert.ok(isSafeAppPath('C:\\Programs\\Steam.LNK'), 'extension check is case-insensitive');
  assert.ok(!isSafeAppPath('C:\\Windows\\System32\\cmd.exe'));
  assert.ok(!isSafeAppPath('C:\\x\\evil".lnk'), 'a quote could break out of the argument');
  assert.ok(!isSafeAppPath(''));
  assert.ok(!isSafeAppPath(null));
  assert.ok(!isSafeAppPath('x'.repeat(600) + '.lnk'));
});

// --- appFolder --------------------------------------------------------------

const SM = String.raw`C:\Users\PC\AppData\Roaming\Microsoft\Windows\Start Menu\Programs`;

test('appFolder shows the Start Menu folder, not the path', () => {
  // The raw path is useless as a subtitle: every entry shares the same ~60
  // leading characters, so the only distinguishing part is off the right edge
  // and every row reads identically.
  assert.equal(appFolder(SM + String.raw`\Visual Studio Code\Visual Studio Code.lnk`), 'Visual Studio Code');
});

test('appFolder is empty for an item sitting directly in Programs', () => {
  assert.equal(appFolder(SM + String.raw`\Steam.lnk`), '');
});

test('appFolder joins nested folders readably', () => {
  assert.equal(appFolder(SM + String.raw`\Accessories\System Tools\Task Manager.lnk`),
    'Accessories / System Tools');
});

test('appFolder matches the Start Menu marker case-insensitively', () => {
  assert.equal(appFolder(String.raw`C:\x\START MENU\PROGRAMS\Games\Solitaire.lnk`), 'Games');
});

test('appFolder never throws on junk', () => {
  for (const bad of [null, undefined, 42, '']) assert.equal(appFolder(bad), '');
});
