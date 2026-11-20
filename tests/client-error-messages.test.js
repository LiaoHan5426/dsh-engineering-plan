import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');

const block = source.slice(
  source.indexOf('/* BEGIN ERROR MESSAGE SUMMARY */'),
  source.indexOf('/* END ERROR MESSAGE SUMMARY */'),
);

// The helpers call t(); the harness supplies a translator that echoes the key plus a marker, so a test can
// prove which locale key was chosen without duplicating the dictionary.
const helpers = new Function('t', `${block.replace(/^ {4}/gm, '')}
return { errorParts, errorMessageKey, errorDisplay };`)((key) => `<${key}>`);

test('a code with no detail is split cleanly', () => {
  assert.deepEqual(helpers.errorParts('APPROVAL_REQUIRED'), { code: 'APPROVAL_REQUIRED', detail: '' });
});

test('the English detail after the colon is kept separate', () => {
  assert.deepEqual(helpers.errorParts('NOT_FOUND: Change not found'), { code: 'NOT_FOUND', detail: 'Change not found' });
});

test('mapped codes resolve to a locale key instead of raw English', () => {
  assert.equal(helpers.errorMessageKey('APPROVAL_REQUIRED'), 'errApprovalRequired');
  assert.equal(helpers.errorMessageKey('PLAN_LOCKED: task ANALYZE running'), 'errPlanLocked');
  assert.equal(helpers.errorMessageKey('INCOMPLETE_PLAN: Goal, tasks'), 'planIncompleteError');
});

test('unmapped codes keep their original text rather than inventing a translation', () => {
  assert.equal(helpers.errorMessageKey('SOME_NEW_CODE: x'), '');
  assert.equal(helpers.errorDisplay('SOME_NEW_CODE: x'), 'SOME_NEW_CODE: x');
});

test('details are appended only for codes a human must act on', () => {
  assert.equal(helpers.errorDisplay('DEPENDENCY_BLOCKED: ANALYZE'), '<errDependencyBlocked> ANALYZE');
  assert.equal(helpers.errorDisplay('FILE_CONFLICT: src/a.js'), '<errFileConflict> src/a.js');
  assert.equal(helpers.errorDisplay('NOT_FOUND: Change not found'), '<errNotFound>');
});

test('an invalid transition lists the legal targets after the sentence', () => {
  assert.equal(helpers.errorDisplay('INVALID_TRANSITION: pending -> completed'), '<errInvalidTransition><errInvalidTransitionWith>pending -> completed');
});

test('the run funnel now uses errorDisplay, not the single-purpose plan key', () => {
  assert.match(source, /const message = String\(cause\?\.message \|\| cause\);\s*\n\s*if \(mounted\.current\) setError\(errorDisplay\(message\)\);/);
  assert.doesNotMatch(source, /const key = planErrorKey\(message\);/);
});

test('every mapped code has a bilingual entry', () => {
  const keys = [...source.matchAll(/([A-Z_]+): "(err[A-Za-z]+|planIncompleteError)"/g)].map((m) => m[2]);
  const unique = [...new Set(keys)];
  assert.ok(unique.length >= 18, `expected many mappings, got ${unique.length}`);
  for (const key of unique) {
    const at = source.indexOf(`      ${key}: [`);
    assert.ok(at > 0, `${key} has no dictionary entry`);
    const entry = source.slice(at, at + 300);
    assert.match(entry, /[\u4e00-\u9fa5]/, `${key} lacks Chinese`);
    assert.match(entry, /[A-Za-z]{6,}/, `${key} lacks English`);
  }
});
