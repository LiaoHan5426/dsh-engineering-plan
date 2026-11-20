import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');

function extract(begin, end) {
  const from = source.indexOf(begin);
  const to = source.indexOf(end, from);
  assert.ok(from > 0 && to > from, `markers ${begin} missing`);
  return new Function(`${source.slice(from, to)}\nreturn { latestCommandRun };`)();
}

const { latestCommandRun } = extract('/* BEGIN READY SUMMARY */', '/* END READY SUMMARY */');

const runs = [
  { runId: 'a', taskId: 'T1', commandIndex: 0, state: 'failed', updatedAt: '2026-11-20T01:00:00.000Z', exitCode: 1 },
  { runId: 'b', taskId: 'T1', commandIndex: 0, state: 'succeeded', updatedAt: '2026-11-20T02:00:00.000Z', exitCode: 0 },
  { runId: 'c', taskId: 'T1', commandIndex: 1, state: 'running', updatedAt: '2026-11-20T03:00:00.000Z', exitCode: null },
  { runId: 'd', taskId: 'T2', commandIndex: 0, state: 'succeeded', updatedAt: '2026-11-20T04:00:00.000Z', exitCode: 0 },
];

test('the newest attempt for that task and command wins', () => {
  assert.equal(latestCommandRun(runs, 'T1', 0).runId, 'b');
  assert.equal(latestCommandRun(runs, 'T1', 1).runId, 'c');
});

test('other tasks and other command indexes never leak in', () => {
  assert.equal(latestCommandRun(runs, 'T2', 0).runId, 'd');
  assert.equal(latestCommandRun(runs, 'T2', 1), null);
  assert.equal(latestCommandRun(runs, 'T3', 0), null);
});

test('a missing or unloaded run list yields nothing rather than throwing', () => {
  assert.equal(latestCommandRun(null, 'T1', 0), null);
  assert.equal(latestCommandRun(undefined, 'T1', 0), null);
  assert.equal(latestCommandRun([], 'T1', 0), null);
});

test('the task detail shows the last run state beside each command', () => {
  assert.ok(source.includes('t("commandNeverRan")'));
  assert.ok(source.includes('latestCommandRun('));
  assert.ok(source.includes('typeof verificationRuns === "undefined" ? null : verificationRuns'));
});

test('no element is created with a null type', () => {
  // h(null, ...) renders nothing at runtime and throws "Element type is invalid";
  // multi-child wrappers must use React.Fragment. The vendored Mermaid blob contains
  // its own `h(null` text, so the check runs on the source outside the embed.
  const from = source.indexOf('/* BEGIN EMBEDDED MERMAID');
  const to = source.indexOf('/* END EMBEDDED MERMAID');
  const own = from > 0 && to > from ? source.slice(0, from) + source.slice(to) : source;
  assert.equal(own.includes('h(null'), false);
});
