import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function removeHandler() {
  const start = source.indexOf('"remove",\n');
  assert.ok(start > 0, 'task card must render a remove button');
  return source.slice(start, start + 900);
}

test('removing a task is refused while other tasks still depend on it', () => {
  const handler = removeHandler();
  assert.match(handler, /const dependents = draft\.tasks\.filter\(/, 'handler computes dependents');
  assert.match(handler, /item\.dependencies\.includes\(task\.id\)/, 'dependents are matched by dependency id');
  assert.match(handler, /if \(dependents\.length\) \{[\s\S]*?setError\(/, 'refusal surfaces a message');
  assert.match(handler, /dependents\.map\(\(item\) => item\.id\)\.join\(", "\)/, 'message lists the blocking task ids');
});

test('the refusal returns before mutating the draft', () => {
  const handler = removeHandler();
  const refusal = handler.indexOf('if (dependents.length)');
  const mutate = handler.indexOf('edit({ tasks: draft.tasks.filter');
  assert.ok(refusal > 0 && mutate > refusal, 'draft mutation happens only after the dependency check');
  assert.match(
    handler.slice(refusal, mutate),
    /return;/,
    'the refusal branch returns instead of falling through to the mutation',
  );
});

test('removal still works when nothing depends on the task', () => {
  const handler = removeHandler();
  assert.match(handler, /setError\(""\);\s*\n\s*edit\(\{ tasks: draft\.tasks\.filter\(\(item\) => item !== task\) \}\);/);
});
