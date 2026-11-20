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

const missingDependencies = Function(`return (${functionSource('missingDependencies')})`)();

const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('a dependency on an existing task is accepted', () => {
  assert.deepEqual(missingDependencies(tasks, ['a', 'c']), []);
  assert.deepEqual(missingDependencies(tasks, []), []);
  assert.deepEqual(missingDependencies(tasks, null), []);
  assert.deepEqual(missingDependencies(tasks, undefined), []);
});

test('dependencies on unknown task ids are reported', () => {
  assert.deepEqual(missingDependencies(tasks, ['a', 'zz']), ['zz']);
  assert.deepEqual(missingDependencies(tasks, ['x', 'y']), ['x', 'y']);
  assert.deepEqual(missingDependencies([], ['a']), ['a']);
  assert.deepEqual(missingDependencies(null, ['a']), ['a']);
});

test('tasks without an id do not satisfy a dependency', () => {
  assert.deepEqual(missingDependencies([{ id: '' }, { title: 'no id' }, { id: 'a' }], ['a', '']), ['']);
  assert.deepEqual(missingDependencies([{}, { id: 'a' }], ['a']), []);
});

function submitSource() {
  const formStart = source.indexOf('function taskForm()');
  const start = source.indexOf('onSubmit: (event) => {', formStart);
  const end = source.indexOf('t(taskEdit.index >= 0 ? "edit" : "addTask")', start);
  assert.ok(formStart > 0 && start > formStart && end > start, 'task form submit handler not found');
  return source.slice(start, end);
}

test('the task form checks every dependency id before writing tasks', () => {
  const submit = submitSource();
  const check = submit.indexOf('const missing = missingDependencies(draft.tasks, deps);');
  const error = submit.indexOf('setError(t("missingDependency") + missing.join(", "))');
  const write = submit.indexOf('edit({');
  assert.ok(check > 0, 'the form must validate dependency ids');
  assert.ok(error > check, 'a missing dependency must surface an error');
  assert.ok(write > error, 'the write must not happen before the check');
  assert.match(submit.slice(check, error), /if \(missing\.length\) \{/);
  assert.match(submit.slice(error, error + 120), /return;/, 'the submit must abort on a missing dependency');
});

test('the self-dependency guard still runs before the existence check', () => {
  const submit = submitSource();
  const self = submit.indexOf('setError(t("selfDependency"))');
  const missing = submit.indexOf('missingDependencies(');
  assert.ok(self > 0 && missing > self);
});

test('the missing-dependency message is bilingual and names the task', () => {
  const start = source.indexOf('      missingDependency: [');
  assert.ok(start > 0, 'missing locale key');
  const entry = source.slice(start, source.indexOf('],', start));
  const lines = entry.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('"'));
  assert.equal(lines.length, 2, 'zh and en strings are required');
  assert.match(lines[0], /依赖任务不存在/);
  assert.match(lines[1], /[Dd]ependency task does not exist/);
});
