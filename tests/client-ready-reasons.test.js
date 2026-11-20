import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');

function helperBlock() {
  const start = source.indexOf('const READY_REASON_KEYS');
  assert.ok(start > 0, 'ready reason keys must exist');
  const end = source.indexOf('// Which command of a task', start);
  return source.slice(start, end);
}

test('every readyTasks reason code maps to a locale key', () => {
  const block = helperBlock();
  for (const code of [
    'APPROVAL_REQUIRED',
    'TASK_NOT_PENDING',
    'DEPENDENCY_BLOCKED',
    'FILE_CONFLICT',
    'ACTIVE_RUN',
    'UNRESOLVED_UNKNOWN',
  ]) {
    assert.ok(block.includes(code + ':'), `missing mapping for ${code}`);
  }
});

test('the mapped keys all exist in the bilingual dictionary', () => {
  const block = helperBlock();
  const keys = [...block.matchAll(/: "([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.equal(keys.length, 6);
  for (const key of keys) {
    const entry = new RegExp('\\n      ' + key + ': \\["([^"]+)", "([^"]+)"\\],');
    assert.match(source, entry, `${key} must be defined with two strings`);
  }
});

test('task details show the reasons only when the ready query is fresh', () => {
  const start = source.indexOf('h("strong", null, t("readyBlockedReasons"))');
  assert.ok(start > 0, 'reasons block must be rendered');
  const before = source.slice(Math.max(0, start - 400), start);
  assert.ok(before.includes('readyFresh'), 'the block must be gated on readyFresh');
  assert.ok(source.includes('reason.detail ? " · " + reason.detail : ""'));
});
