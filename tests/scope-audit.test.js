import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditScope } from '../src/scope-audit.js';

const tasks = [
  { id: 'CORE', expectedFiles: ['src/core.js', 'docs/'] },
  { id: 'UI', expectedFiles: ['src/../client.js', 'client.js'] },
];

test('paths declared by a task are attributed to it', () => {
  const result = auditScope({ tasks, changedPaths: ['src/core.js'], untrackedPaths: [] });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0], { path: 'src/core.js', kind: 'tracked', declaredBy: ['CORE'] });
  assert.deepEqual(result.undeclared, []);
});

test('a trailing slash declares a directory prefix', () => {
  const result = auditScope({ tasks, changedPaths: ['docs/DESIGN.md', 'docs/sub/a.md'], untrackedPaths: [] });
  assert.deepEqual(result.undeclared, []);
  assert.deepEqual(result.entries.map((entry) => entry.declaredBy), [['CORE'], ['CORE']]);
});

test('paths outside every declaration are listed as undeclared', () => {
  const result = auditScope({ tasks, changedPaths: ['src/core.js', 'package.json'], untrackedPaths: ['tmp/a.js'] });
  assert.deepEqual(result.undeclared, ['package.json', 'tmp/a.js']);
  assert.equal(result.declaredCount, 1);
  assert.equal(result.changedCount, 2);
  assert.equal(result.untrackedCount, 1);
});

test('declared and observed paths match case-insensitively, like the conflict gate', () => {
  const changey = [{ id: 'CORE', expectedFiles: ['SRC/Core.js', 'Docs/'] }];
  const result = auditScope({ tasks: changey, changedPaths: ['src/core.js', 'DOCS/guide.md'], untrackedPaths: [] });
  assert.deepEqual(result.undeclared, []);
  assert.deepEqual(result.entries.map((entry) => entry.declaredBy), [['CORE'], ['CORE']]);
  // The observed spelling is preserved in the evidence.
  assert.deepEqual(result.entries.map((entry) => entry.path), ['DOCS/guide.md', 'src/core.js']);
  assert.deepEqual(result.untouched, []);
});

test('a declaration that differs only in case is still an untouched miss when nothing matched', () => {
  const changey = [{ id: 'CORE', expectedFiles: ['src/other.js'] }];
  const result = auditScope({ tasks: changey, changedPaths: ['SRC/Core.js'], untrackedPaths: [] });
  assert.deepEqual(result.undeclared, ['SRC/Core.js']);
  assert.deepEqual(result.untouched, [{ taskId: 'CORE', path: 'src/other.js' }]);
});


test('declarations without an observed path are reported as untouched', () => {
  const result = auditScope({ tasks, changedPaths: [], untrackedPaths: [] });
  assert.deepEqual(result.untouched, [
    { taskId: 'CORE', path: 'docs/' },
    { taskId: 'CORE', path: 'src/core.js' },
    { taskId: 'UI', path: 'client.js' },
    { taskId: 'UI', path: 'src/../client.js' },
  ]);
});

test('dot segments are not collapsed, so an odd spelling stays visible', () => {
  const result = auditScope({ tasks: [{ id: 'UI', expectedFiles: ['src/../client.js'] }], changedPaths: ['client.js'] });
  // Case is folded, but `src/../client.js` is still not treated as `client.js`; the audit reports rather than guesses.
  assert.deepEqual(result.undeclared, ['client.js']);
});

test('backslashes are normalized and duplicates are removed', () => {
  const result = auditScope({
    tasks: [{ id: 'CORE', expectedFiles: ['src\\core.js', 'src/core.js'] }],
    changedPaths: ['src\\core.js', 'src/core.js'],
    untrackedPaths: [],
  });
  assert.deepEqual(result.entries.map((entry) => entry.path), ['src/core.js']);
  assert.deepEqual(result.undeclared, []);
  assert.deepEqual(result.untouched, []);
});

test('both changed and untracked lists are reported with their kind', () => {
  const result = auditScope({
    tasks: [{ id: 'CORE', expectedFiles: ['src/core.js'] }],
    changedPaths: ['src/core.js'],
    untrackedPaths: ['docs/new.md'],
  });
  assert.deepEqual(result.entries, [
    { path: 'src/core.js', kind: 'tracked', declaredBy: ['CORE'] },
    { path: 'docs/new.md', kind: 'untracked', declaredBy: [] },
  ]);
});

test('malformed input is rejected instead of silently coerced', () => {
  assert.throws(() => auditScope({ tasks: [{ id: '', expectedFiles: [] }] }), /task id/);
  assert.throws(() => auditScope({ tasks: [], changedPaths: 'src/a.js' }), /array of paths/);
  assert.throws(() => auditScope({ tasks: [], changedPaths: [''] }), /non-empty/);
  assert.throws(() => auditScope({ tasks: [], changedPaths: ['a\u0000b'] }), /NUL/);
  assert.throws(() => auditScope({ tasks: [], untrackedPaths: ['a'], changedPaths: new Array(2001).fill('a') }), /2000/);
});

test('a path declared by two tasks is attributed to both', () => {
  const result = auditScope({
    tasks: [{ id: 'A', expectedFiles: ['src/core.js'] }, { id: 'B', expectedFiles: ['src/core.js'] }],
    changedPaths: ['src/core.js'],
  });
  assert.deepEqual(result.entries[0].declaredBy, ['A', 'B']);
  assert.deepEqual(result.untouched, []);
});
