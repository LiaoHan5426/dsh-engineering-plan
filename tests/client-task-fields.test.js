import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text-level assertions only: the embedded Mermaid vendor bundle is never evaluated.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

// The pure task-execution helpers live between explicit markers so they can be evaluated alone.
const fields = Function(
  `${sliceBetween('/* BEGIN TASK EXECUTION FIELDS */', '/* END TASK EXECUTION FIELDS */')}
  return { EXECUTORS, EXECUTOR_LABELS, RETRY_LIMIT, parseModules, executorOf, approvalOf, retriesOf,
    taskExecution, taskMetaText };`,
)();

const { EXECUTORS, EXECUTOR_LABELS, RETRY_LIMIT, parseModules, executorOf, approvalOf, retriesOf,
  taskExecution, taskMetaText } = fields;

const formSource = sliceBetween('function taskForm()', 'function taskEditor(');
const editorSource = sliceBetween('function taskEditor(task, index) {', 'async function refreshDispatchRuns(target = null)');

function fieldSlice(name) {
  const start = formSource.indexOf(`"${name}"`);
  assert.ok(start >= 0, `the task form must render the ${name} field`);
  return formSource.slice(start, start + 420);
}

test('the task form renders all four execution fields and binds them to the draft', () => {
  const modules = fieldSlice('affectedModules');
  assert.match(modules, /\(affectedModules\) => patch\(\{ affectedModules \}\)/, 'modules field writes the draft');
  assert.doesNotMatch(modules, /multiline: true/, 'modules stay a single line input');

  const executor = fieldSlice('executor');
  assert.match(executor, /\(executor\) => patch\(\{ executor \}\)/, 'executor field writes the draft');
  assert.match(executor, /choices: EXECUTORS\.map\(\(id\) => \[id, t\(EXECUTOR_LABELS\[id\]\)\]\)/,
    'executor is a select over local/subagent/external');

  const retries = fieldSlice('maxRetries');
  assert.match(retries, /\(maxRetries\) => patch\(\{ maxRetries \}\)/, 'retries field writes the draft');
  assert.match(retries, /type: "number"/, 'retries is a number input');
  assert.match(retries, /min: 0/, 'retries lower bound');
  assert.match(retries, /max: RETRY_LIMIT/, 'retries upper bound');
  assert.match(retries, /step: 1/, 'retries are whole numbers');

  assert.match(formSource, /checked: !!taskEdit\.requiredApproval/, 'approval checkbox reflects the draft');
  assert.match(formSource, /requiredApproval: event\.target\.checked/, 'approval checkbox writes the draft');
  assert.match(formSource, /t\("requiresApproval"\)/, 'the checkbox carries a label');
});

test('editing a task prefills every execution field from the stored defaults', () => {
  assert.match(editorSource, /const execution = taskExecution\(task\);/, 'defaults come from one projection');
  assert.match(editorSource, /\.\.\.execution,/, 'the projection seeds the edit draft');
  assert.match(editorSource, /affectedModules: execution\.affectedModules\.join\(", "\)/,
    'stored modules are edited as comma separated text');
  assert.match(editorSource, /maxRetries: execution\.maxRetries,/, 'retries are prefilled numerically');
});

test('the submit projection writes the four keys and nothing read-only', () => {
  const submit = sliceBetween('onSubmit: (event) => {', 'edit({');
  const modules = submit.indexOf('...taskExecution(task)');
  assert.ok(modules > 0, 'submit must project the execution fields');
  assert.ok(modules > submit.indexOf('verificationCommands: lines(task.verificationCommands)'),
    'projection happens after the existing fields');
  assert.match(submit, /verificationCommands: lines\(task\.verificationCommands\),\s*\n\s*\.\.\.taskExecution\(task\),/,
    'the projection sits inside the task object');
  assert.deepEqual(Object.keys(taskExecution({})), [
    'affectedModules',
    'executor',
    'requiredApproval',
    'maxRetries',
  ], 'the shared projection carries exactly the four core keys');
});

test('the save patch sends the four keys and no status or evidence', () => {
  const payload = sliceBetween('tasks: draft.tasks.map((task) => ({', 'references: draft.references');
  assert.match(payload, /\.\.\.taskExecution\(task\)/, 'the patch carries the execution fields');
  assert.match(payload, /"verificationCommands",/, 'the existing strict key list survives');
  assert.doesNotMatch(payload, /"status"/, 'status is read only');
  assert.doesNotMatch(payload, /"evidence"/, 'evidence is read only');
});

test('the task card shows a compact meta line between the header and the dependency block', () => {
  const meta = source.indexOf('taskMetaText(task, t)');
  assert.ok(meta > 0, 'the card must render the meta line');
  assert.ok(meta > source.indexOf('badge(task.status)'), 'the meta line follows the header badge');
  assert.ok(meta < source.indexOf('t("taskDependencies")'), 'dependency rendering keeps its order');
  assert.ok(source.indexOf('t("dependsOn")') < source.indexOf('requestControls("task", task.id)'),
    'dispatch controls still render last');
});

test('modules are split on both comma styles, trimmed, deduplicated and emptied', () => {
  assert.deepEqual(parseModules('a, b'), ['a', 'b']);
  assert.deepEqual(parseModules('a，b'), ['a', 'b']);
  assert.deepEqual(parseModules(' a ,，b ,, c '), ['a', 'b', 'c']);
  assert.deepEqual(parseModules('a,a,A'), ['a', 'A']);
  assert.deepEqual(parseModules('a\nb\r\nc'), ['a', 'b', 'c']);
  assert.deepEqual(parseModules(''), []);
  assert.deepEqual(parseModules('   ,  ， '), []);
  assert.deepEqual(parseModules(null), []);
  assert.deepEqual(parseModules(undefined), []);
  assert.deepEqual(parseModules([' a ', 'a', '', 'b']), ['a', 'b']);
});

test('the executor, approval and retry readers fall back to the core defaults', () => {
  for (const value of EXECUTORS) assert.equal(executorOf(value), value);
  assert.equal(executorOf(undefined), 'local');
  assert.equal(executorOf('Local'), 'local');
  assert.equal(executorOf('remote'), 'local');

  assert.equal(approvalOf(true), true);
  assert.equal(approvalOf(false), false);
  assert.equal(approvalOf(undefined), false);
  assert.equal(approvalOf('true'), false);

  assert.equal(retriesOf(0), 0);
  assert.equal(retriesOf(3), 3);
  assert.equal(retriesOf(RETRY_LIMIT), RETRY_LIMIT);
  assert.equal(retriesOf(RETRY_LIMIT + 5), RETRY_LIMIT);
  assert.equal(retriesOf(-4), 0);
  assert.equal(retriesOf('7'), 7);
  assert.equal(retriesOf('3.9'), 3);
  assert.equal(retriesOf(''), 0);
  assert.equal(retriesOf('many'), 0);
  assert.equal(retriesOf(undefined), 0);
  assert.equal(RETRY_LIMIT, 10);
});

test('a legacy task without the four keys reads as defaults and renders without crashing', () => {
  const legacy = { id: 'a', title: 'Legacy', dependencies: [], acceptanceCriteria: [] };
  assert.deepEqual(taskExecution(legacy), {
    affectedModules: [],
    executor: 'local',
    requiredApproval: false,
    maxRetries: 0,
  });
  assert.deepEqual(taskExecution(undefined), taskExecution({}));

  const translate = (key) => key;
  assert.equal(taskMetaText(legacy, translate), 'executor: executorLocal');
  assert.equal(
    taskMetaText(
      { affectedModules: ['src/a.js'], executor: 'external', requiredApproval: true, maxRetries: 2 },
      translate,
    ),
    'affectedModulesLabel: src/a.js · executor: executorExternal · approvalRequiredNote · retriesLabel: 2',
  );
});

test('the new locale keys exist once in both languages', () => {
  const keys = [
    'affectedModules',
    'affectedModulesLabel',
    'executor',
    'executorLocal',
    'executorSubagent',
    'executorExternal',
    'requiresApproval',
    'approvalRequiredNote',
    'maxRetries',
    'retriesLabel',
    ...Object.values(EXECUTOR_LABELS),
  ];
  for (const key of new Set(keys)) {
    const pattern = new RegExp(`^ {6}${key}: \\[([\\s\\S]*?)\\],$`, 'gm');
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `${key} must be defined exactly once`);
    const parts = [...matches[0][1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    assert.equal(parts.length, 2, `${key} must carry exactly one Chinese and one English string`);
    assert.ok(parts[0].trim() && parts[1].trim(), `${key} must not carry an empty translation`);
    assert.notEqual(parts[0], parts[1], `${key} translations must differ`);
  }
  assert.match(source, /t\("requiresApproval"\)/, 'the checkbox label is wired');
  for (const key of Object.values(EXECUTOR_LABELS)) assert.match(source, new RegExp(`^ {6}${key}: \\[`, 'm'));
});
