import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function functionSource(name, indent = '    ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end).trim();
}

const matrixTallies = Function(`return (${functionSource('matrixTallies')})`)();

const row = (id, criterion, outcome) => ({
  task: { id },
  criterion,
  latest: outcome === undefined ? null : { outcome },
});

test('tasks without an acceptance criterion are counted apart, not as pending evidence', () => {
  const rows = [
    row('t1', 'works', 'passed'),
    row('t2', null, undefined),
    row('t3', 'is fast', undefined),
  ];
  assert.deepEqual(matrixTallies(rows), { passed: 1, failed: 0, pending: 1, noCriteria: 1 });
});

test('passed, failed and pending only count rows that have a criterion', () => {
  const rows = [row('t1', 'a', 'passed'), row('t2', 'b', 'failed'), row('t3', null, undefined), row('t4', 'c', 'passed')];
  assert.deepEqual(matrixTallies(rows), { passed: 2, failed: 1, pending: 0, noCriteria: 1 });
});

test('every row lands in exactly one bucket', () => {
  const rows = [
    row('t1', 'a', 'passed'),
    row('t2', 'b', 'failed'),
    row('t3', null, undefined),
    row('t4', 'c', undefined),
    row('t5', null, 'passed'),
  ];
  const tallies = matrixTallies(rows);
  assert.equal(tallies.passed + tallies.failed + tallies.pending + tallies.noCriteria, rows.length);
  assert.equal(tallies.noCriteria, 2);
});

test('an evidence row on a criterion-less task never becomes pending evidence', () => {
  // Outcome present but criterion missing: still not a criterion row.
  const tallies = matrixTallies([{ task: { id: 't1' }, criterion: null, latest: { outcome: 'passed' } }]);
  assert.deepEqual(tallies, { passed: 0, failed: 0, pending: 0, noCriteria: 1 });
  assert.deepEqual(matrixTallies([]), { passed: 0, failed: 0, pending: 0, noCriteria: 0 });
  assert.deepEqual(matrixTallies(null), { passed: 0, failed: 0, pending: 0, noCriteria: 0 });
});

function matrixSource() {
  const start = source.indexOf('const tallies = matrixTallies(rows);');
  const end = source.indexOf('t("evidenceTruth")', start);
  assert.ok(start > 0 && end > start, 'matrix badge block not found');
  return source.slice(start, end);
}

test('the matrix badges read the shared tallies', () => {
  const block = matrixSource();
  assert.match(block, /\[\["passed", tallies\.passed\], \["failed", tallies\.failed\], \["pendingCriteria", tallies\.pending\]\]/);
  assert.match(block, /tallies\.noCriteria > 0/);
  assert.match(block, /t\("noCriteria"\), " ", tallies\.noCriteria/);
  assert.doesNotMatch(
    block,
    /rows\.filter\(\(\{ latest \}\) => latest\?\.outcome === outcome\)/,
    'the unguarded outcome filter must be gone',
  );
});

test('the outcome cell still renders a dash for a criterion-less row', () => {
  const cell = source.indexOf('criterion || t("noCriteria")');
  assert.ok(cell > 0, 'the criterion-less cell branch must stay');
  assert.match(source.slice(cell, cell + 400), /"—"/);
});
