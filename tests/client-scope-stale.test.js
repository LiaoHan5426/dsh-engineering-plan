import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// Showing the observation time made staleness visible to a careful reader; saying it
// outright makes it visible to everyone. The gate already knows the observation's
// revision, so comparing it with the change's current revision is free.
test('the gate flags a scope summary that predates the current revision', () => {
  const core = read('src/core.js');
  const start = core.indexOf('async function scopeSummary');
  const body = core.slice(start, core.indexOf('async function readyTasks', start));
  assert.match(body, /stale: latest\.sourceRevision !== s\.revision/, 'staleness must be computed from the revision gap');
});

test('the workbench states the gap instead of leaving it to be inferred', () => {
  const client = read('client.js');
  assert.match(client, /gateScopeStale: \["该观测采集于修订 \{observed\}，当前是修订 \{current\}/, 'the sentence must name both revisions');
  assert.match(client, /gate\.scope\.stale === true/, 'the warning must be gated on the payload, not rendered always');
  assert.match(client, /\.replace\("\{observed\}", String\(gate\.scope\.sourceRevision\)\)/, 'observed revision comes from the payload');
  assert.match(client, /\.replace\("\{current\}", String\(change\.revision\)\)/, 'current revision comes from the change');
});

test('the warning is not confused with a blocker', () => {
  const client = read('client.js');
  assert.doesNotMatch(client, /gate\.scope\.stale === true[\s\S]{0,200}blocker/i, 'a stale observation is information, not a blocker');
});
