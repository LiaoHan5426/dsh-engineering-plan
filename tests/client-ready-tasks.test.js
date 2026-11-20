import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');
const block = source.slice(
  source.indexOf('/* BEGIN READY SUMMARY */'),
  source.indexOf('/* END READY SUMMARY */'),
);
const helpers = new Function(`${block.replace(/^ {4}/gm, '')}
return { readyQuery, readyMatches, readySet, readyReasons };`)();

const change = { id: 'c1', revision: 7 };
const record = {
  changeId: 'c1', revision: 7, ready: ['A'],
  tasks: [
    { id: 'A', reasons: [] },
    { id: 'B', reasons: [{ code: 'DEPENDENCY_BLOCKED', detail: 'A' }] },
  ],
};

test('the query asks the core for the frontier of this change', () => {
  assert.deepEqual(helpers.readyQuery('c1'), { action: 'readyTasks', changeId: 'c1' });
});

test('a verdict only counts for the revision it was computed on', () => {
  assert.equal(helpers.readyMatches(record, change), true);
  assert.equal(helpers.readyMatches(record, { ...change, revision: 8 }), false);
  assert.equal(helpers.readyMatches(record, { ...change, id: 'c2' }), false);
  assert.equal(helpers.readyMatches(null, change), false);
});

test('the ready set exposes exactly the ids the core returned', () => {
  const set = helpers.readySet(record);
  assert.equal(set.has('A'), true);
  assert.equal(set.has('B'), false);
  assert.equal(helpers.readySet(null).size, 0);
});

test('reasons stay per task', () => {
  assert.equal(helpers.readyReasons(record, 'B')[0].detail, 'A');
});

test('the board prefers the core verdict once it is fresh', () => {
  assert.match(source, /const readyFresh = typeof readyMatches === "function" && readyMatches\(ready, change\);/);
  assert.match(source, /const readyIds = readyFresh \? readySet\(ready\) : null;/);
  assert.match(source, /readyIds\s*\n?\s*\? change\.tasks\.find\(\(task\) => readyIds\.has\(task\.id\)\)/);
});

test('a stale or missing verdict falls back instead of claiming a frontier', () => {
  // The fallback branch is only reached when readyIds is null, i.e. no fresh verdict.
  assert.match(source, /: approved && change\.tasks\.find\(\(task\) =>/);
});

test('the loader is bound to the loaded change and rejects mismatched responses', () => {
  assert.match(source, /async function refreshReady\(targetId\) \{/);
  assert.match(source, /const result = await command\(readyQuery\(targetId\)\);/);
  assert.match(source, /if \(!result \|\| result\.changeId !== targetId \|\| !Number\.isSafeInteger\(result\.revision\)/);
});

test('loading a change clears the frontier verdict', () => {
  assert.match(source, /setReady\(null\);\n            setReadyError\(""\);/);
});

test('the summary only shows a count when the verdict is fresh, and never on a different key', () => {
  assert.match(source, /readyFresh && h\("span", null, t\("frontierCount"\), " ", ready\.ready\.length\)/);
  assert.match(source, /frontierCount: \["当前可开始", "Ready to start"\]/);
  // readyCount already means planning readiness; reusing it here would mislabel the board.
  assert.doesNotMatch(source, /readyFresh && h\("span", null, t\("readyCount"\)/);
});
