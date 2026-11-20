import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// The gate scope summary shows how many changed paths are declared by tasks. Those
// numbers are only as good as the observation they came from: an observation taken
// three days and forty revisions ago looks exactly like a fresh one unless the
// timestamp travels with it.
test('the gate scope summary carries the observation time', () => {
  const core = read('src/core.js');
  const start = core.indexOf('async function scopeSummary');
  assert.notEqual(start, -1, 'scopeSummary must still exist');
  const body = core.slice(start, core.indexOf('async function readyTasks', start));

  assert.match(body, /observedAt: null/, 'the no-observation branch must report a null time');
  assert.match(
    body,
    /observedAt: latest\.finishedAt \?\? latest\.capturedAt \?\? null/,
    'the included branch must carry the observation timestamp'
  );
});

test('the workbench renders that time next to the observation id', () => {
  const client = read('client.js');
  assert.match(
    client,
    /gateScopeIncluded: \["已声明 \{declared\} \/ 共 \{changed\} 条路径（观测 \{observation\}，\{at\}）"/,
    'the Chinese template must expose the time placeholder'
  );
  assert.match(
    client,
    /\.replace\("\{at\}", String\(gate\.scope\.observedAt \|\| ""\)/,
    'the render path must fill the placeholder from the scope payload'
  );
});

test('a missing timestamp degrades to a dash instead of "undefined"', () => {
  const client = read('client.js');
  assert.match(client, /\|\| "—"\)/, 'an absent time must not leak "undefined" into the sentence');
  assert.doesNotMatch(client, /String\(gate\.scope\.observedAt\)\.replace/, 'no unguarded interpolation');
});
