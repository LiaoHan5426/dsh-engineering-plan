import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('baseline status card does not repeat its heading as the select label', () => {
  assert.match(source, /baselineStatusSelect: \["用于比较的后续观测", "Subsequent observation to compare"\]/);
  assert.match(source, /h\("label", null, t\("baselineStatusSelect"\),/);
  assert.doesNotMatch(source, /h\("label", null, t\("baselineStatusTitle"\),/, 'card heading must not be reused as a field label');
});

test('baseline status card keeps exactly one heading for the card title', () => {
  const headings = source.match(/h\("h3", null, t\("baselineStatusTitle"\)\)/g) || [];
  assert.equal(headings.length, 1);
});
