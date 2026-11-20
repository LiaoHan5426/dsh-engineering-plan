import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');

// Run states produced by the verification and dispatch stores. Badges render
// them through textStatus(), which silently falls back to the raw value when a
// key is missing — so a missing key shows English inside a Chinese UI.
const RUN_STATES = [
  'reserved',
  'starting',
  'running',
  'returned',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'error',
  'unknown',
];

function entry(key) {
  const match = new RegExp(`\\n {6}${key}: (\\[[\\s\\S]*?\\]),`).exec(source);
  assert.ok(match, `locale key ${key} must exist`);
  return JSON.parse(match[1]);
}

test('every run state has a label in both languages', () => {
  for (const state of RUN_STATES) {
    const parts = entry(state);
    assert.equal(parts.length, 2, `${state} needs exactly two strings`);
    for (const part of parts) assert.ok(part.length > 0, `${state} must not be blank`);
    assert.notEqual(parts[0], parts[1], `${state} needs a real translation`);
    assert.equal(/[A-Za-z]/.test(parts[0].replace(/[A-Za-z]+\/[A-Za-z]+/g, '')), false, `${state} Chinese label must stay Chinese`);
  }
});

test('textStatus is what renders run states, so the keys must match the values', () => {
  assert.ok(source.includes('const textStatus = (value) => (words[value] ? t(value) : String(value || ""));'));
  for (const state of RUN_STATES) {
    assert.equal(new RegExp(`words\\[["']${state}["']\\]`).test(source), false, 'lookup goes through textStatus, not a hardcoded list');
  }
});

test('the per-command badge and the run card both use badge()', () => {
  assert.ok(source.includes('badge(run.state)'));
  assert.ok(source.includes('badge(task.status)'));
});
