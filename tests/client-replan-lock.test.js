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

const { replanBlocked, activeReplanTasks } = Function(
  `${functionSource('activeReplanTasks')}\n${functionSource('replanBlocked')}\nreturn { activeReplanTasks, replanBlocked };`,
)();

test('replanBlocked is false while no task is running or verifying', () => {
  assert.equal(replanBlocked({ tasks: [] }), false);
  assert.equal(replanBlocked({}), false);
  assert.equal(replanBlocked(null), false);
  assert.equal(replanBlocked(undefined), false);
  assert.equal(replanBlocked({ tasks: [{ status: 'pending' }, { status: 'blocked' }] }), false);
  assert.equal(
    replanBlocked({ tasks: [{ status: 'pending' }, { status: 'failed' }, { status: 'completed' }] }),
    false,
  );
});

test('replanBlocked is true for a running task', () => {
  assert.equal(replanBlocked({ tasks: [{ status: 'running' }] }), true);
  assert.equal(replanBlocked({ tasks: [{ status: 'pending' }, { status: 'running' }] }), true);
  assert.deepEqual(activeReplanTasks({ tasks: [{ status: 'running' }] }).length, 1);
});

test('replanBlocked is true for a verifying task', () => {
  assert.equal(replanBlocked({ tasks: [{ status: 'verifying' }] }), true);
  assert.equal(replanBlocked({ tasks: [{ status: 'verifying' }, { status: 'completed' }] }), true);
});

test('both the replan entry and the confirmation button share the lock', () => {
  const occurrences = source.match(/unsettled \|\| replanBlocked\(change\)/g) || [];
  assert.equal(occurrences.length, 2, 'entry button and confirm button must both consult replanBlocked');
  const confirm = source.indexOf('button("replanConfirm", () => run(() => mutate("replan")), unsettled || replanBlocked(change))');
  assert.ok(confirm > 0, 'the confirm button must use the shared lock');
  assert.doesNotMatch(
    source,
    /button\("replanConfirm", \(\) => run\(\(\) => mutate\("replan"\)\), unsettled\)/,
    'the unsettled-only confirm gate must be gone',
  );
  assert.doesNotMatch(
    source,
    /change\.tasks\.some\(\(t\) => \["running", "verifying"\]\.includes\(t\.status\)\)/,
    'the inline duplicate of the lock must be gone',
  );
});

test('the dialog explains the lock while a task is active', () => {
  assert.match(
    source,
    /replanBlocked\(change\) &&\s*\n\s*h\("p", \{ role: "alert", className: "ep-warn" \}, t\("replanLockedTasks"\)\)/,
  );
  const dialog = source.slice(
    source.indexOf('replanConfirm &&\n'),
    source.indexOf('button("cancel", () => setReplanConfirm(false))'),
  );
  assert.match(dialog, /t\("replanHint"\)/, 'the existing hint must stay');
});

function localeEntry(key) {
  const start = source.indexOf(`      ${key}: [`);
  assert.ok(start > 0, `missing locale key ${key}`);
  const end = source.indexOf('],', start);
  return source.slice(start, end);
}

test('the lock reason is bilingual', () => {
  const entry = localeEntry('replanLockedTasks');
  const lines = entry.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('"'));
  assert.equal(lines.length, 2, 'zh and en strings are required');
  assert.match(lines[0], /进行中|验证中/);
  assert.match(lines[1], /running or verifying/);
});
