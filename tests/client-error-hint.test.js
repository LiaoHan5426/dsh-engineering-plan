import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');

const start = source.indexOf('    // 只有版本冲突才需要');
const end = source.indexOf('    function dispatchRequestBlock');
const block = source.slice(start, end);
const helpers = new Function(`${block}
return { revisionConflict };`)();

test('only REVISION_CONFLICT counts as a revision conflict', () => {
  assert.equal(helpers.revisionConflict('REVISION_CONFLICT: State revision changed'), true);
  assert.equal(helpers.revisionConflict('CORRUPT_STATE: State JSON is corrupt'), false);
  assert.equal(helpers.revisionConflict('NOT_FOUND: Change not found'), false);
  assert.equal(helpers.revisionConflict('REVISION_REQUIRED: expectedRevision is required'), false);
});

test('non-string errors never claim a conflict', () => {
  assert.equal(helpers.revisionConflict(undefined), false);
  assert.equal(helpers.revisionConflict(null), false);
  assert.equal(helpers.revisionConflict({ code: 'REVISION_CONFLICT' }), false);
});

test('the draft hint is rendered only for revision conflicts', () => {
  assert.match(source, /draft && revisionConflict\(error\) && h\("p", null, t\("conflictHint"\)\)/);
  assert.doesNotMatch(source, /draft && h\("p", null, t\("conflictHint"\)\)/);
});
