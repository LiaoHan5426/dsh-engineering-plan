import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkSource, declaredKeys, duplicateKeys, objectBlock } from '../scripts/check-locale-keys.mjs';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const fixture = (body) => [
  'const words = {',
  '  text: {',
  ...body,
  '  };',
  '',
  '  const ERROR_KEYS = {',
  '    A: "a",',
  '    B: "b",',
  '  };',
  '',
  '  const READY_REASON_KEYS = {',
  '    C: "c",',
  '  };',
  '};',
].join('\n');

test('the shipped client has no shadowed locale keys', () => {
  const problems = checkSource(read('client.js'));
  assert.deepEqual(problems, [], `unexpected problems: ${problems.join('; ')}`);
});

test('the three blocks are really found (the check is not vacuous)', () => {
  const source = read('client.js');
  for (const declaration of ['const words = {', 'ERROR_KEYS = {', 'READY_REASON_KEYS = {']) {
    assert.ok(objectBlock(source, declaration), `${declaration} must be locatable`);
  }
});

test('a duplicate key is reported once, with the name that wins', () => {
  const source = fixture([
    '      alpha: ["甲", "Alpha"],',
    '      alpha: ["乙", "Beta"],',
    '      gamma: ["丙", "Gamma"],',
  ]);
  const problems = checkSource(source);
  assert.deepEqual(problems, ['words: duplicate key "alpha" (the later declaration wins)']);
});

test('three occurrences are still reported once', () => {
  assert.deepEqual(duplicateKeys(['a', 'a', 'a', 'b']), ['a']);
  assert.deepEqual(duplicateKeys(['a', 'b']), []);
});

test('a missing block is reported instead of passing silently', () => {
  const problems = checkSource('const nothing = {};\n');
  assert.equal(problems.length, 3);
  for (const problem of problems) assert.match(problem, /block not found/);
});

test('keys are read at the declared indentation only', () => {
  const block = objectBlock(fixture(['      alpha: ["甲", "Alpha"],', '    beta: ["乙", "Beta"],']), 'const words = {');
  assert.deepEqual(declaredKeys(block.text, 6), ['alpha'], 'a 4-space key belongs to another object');
});
