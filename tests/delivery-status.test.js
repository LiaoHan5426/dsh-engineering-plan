import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const status = readFileSync(join(root, 'docs', 'DELIVERY-STATUS.md'), 'utf8');

test('the delivery matrix covers every stage of the original plan', () => {
  for (const stage of [
    'P0 contract',
    'P0 planner',
    'P0 storage',
    'P0 policy',
    'P1 workflow',
    'P1 verifier',
    'P1 UI',
    'P2 agent-adapter',
    'P2 knowledge',
  ]) {
    assert.ok(status.includes('| ' + stage + ' |'), `missing row for ${stage}`);
  }
});

test('the status file keeps stating that it is not a completion claim', () => {
  assert.ok(status.includes('不作为整体完成声明'));
  assert.ok(status.includes('只有单元测试支撑的'));
});

test('the status file points at the pending human approval instead of claiming success', () => {
  assert.ok(status.includes('9dd058d6-8a19-4c3c-b8bc-11a1d7dc6a4c'));
  assert.ok(status.includes('由用户本人点'));
  assert.equal(status.includes('正向闭环已完成'), false);
});
